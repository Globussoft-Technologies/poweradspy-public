'use strict';

/**
 * updateImageDetailsService — persists OCR/OCB results returned by the image
 * scraper back into MySQL (instagram_ad_variants) and Elasticsearch
 * (instagram_search_mix).
 *
 * Faithful port of PHP AdDetails@updateImageDetails.
 *   status 1 → OCB result (object / celebrity / brand) → sets object_update_date
 *   status 4 → OCR result (text)                        → sets ocr_updated_date
 *   other    → image_url_status reset to 0
 *
 * Follows the native OCR shape: takes `db` + `log`, derives `db.sql` / `db.elastic`,
 * delegates all SQL to ./repository.
 *
 * IMPORTANT — field encoding parity with PHP:
 *   Each of object/celebrity/brand_logo/ocr is first delimiter-normalized
 *   (`||,` and `||` → `|`). If the result then contains `|` it is stored as a
 *   JSON-encoded array string (PHP json_encode(explode('|', ...))); otherwise as
 *   the scalar value, or null when empty. That SAME value is written to BOTH MySQL
 *   and every Elasticsearch field (incl. the _ru/_fr/_sp/_exactly family) — exactly
 *   as the live PHP does (the array-valued ES branch is commented out in the source).
 */

const repo = require('../repository');

const ES_INDEX = 'instagram_search_mix';

/** PHP date('Y-m-d H:i:s', time()). */
function mysqlNow() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/** PHP str_replace(['||,', '||'], '|', value) — order-preserving (`||,` before `||`). */
function normalizeDelimiter(value) {
  return String(value ?? '').split('||,').join('|').split('||').join('|');
}

/**
 * PHP object/celebrity/brand_logo encoding:
 *   contains '|'  → json_encode(explode('|', value))  (a JSON array string)
 *   otherwise     → value, or null when empty string
 */
function encodeField(normalized) {
  if (normalized.includes('|')) {
    return JSON.stringify(normalized.split('|'));
  }
  return normalized !== '' ? normalized : null;
}

/** PHP loose `== 0` (also treats null as 0, matching the PHP comparison intent). */
function isZeroish(v) {
  return v === null || v === undefined || Number(v) === 0;
}

/** Read the ES update result across client major versions (v7 wraps in `body`). */
function esResult(res) {
  return res?.result || res?.body?.result || null;
}

/**
 * @param {Object} postData - { ad_id, status, object, celebrity, brand_logo, ocr }
 * @param {Object} db       - service.db ({ sql, mongo, elastic })
 * @param {Object} [log]
 * @returns {{code:number,message:string}}
 */
async function updateImageDetails(postData, db, log) {
  const sql = db?.sql;
  const elastic = db?.elastic;
  const adId = postData.ad_id;
  const reqStatus = Number(postData.status);

  // 1. Load the existing variant row (PHP: ::where('instagram_ad_id',$id)->first()).
  const variant = await repo.getVariantByAdId(sql, adId);
  if (!variant) {
    return { code: 400, message: 'Some Error occurred' };
  }

  // 2. Normalize + encode each field exactly like PHP.
  const object = encodeField(normalizeDelimiter(postData.object));
  const celebrity = encodeField(normalizeDelimiter(postData.celebrity));
  const brandLogo = encodeField(normalizeDelimiter(postData.brand_logo));

  // ocr: if it has a delimiter → JSON array string; else keep the existing
  // image_ocr when present, otherwise the incoming value or null.
  const ocrNorm = normalizeDelimiter(postData.ocr);
  let ocr;
  if (ocrNorm.includes('|')) {
    ocr = JSON.stringify(ocrNorm.split('|'));
  } else {
    ocr = variant.image_ocr != null ? variant.image_ocr : (ocrNorm !== '' ? ocrNorm : null);
  }

  // 3. Build the MySQL update payload (mirrors PHP field-by-field).
  // image_url_status: only 1 or 4 are honoured; anything else resets to 0.
  const status = reqStatus === 1 || reqStatus === 4 ? reqStatus : 0;

  const updateVariants = {};
  if (isZeroish(variant.image_text_final_status)) {
    updateVariants.image_text_final_status = postData.status; // raw request status
  }
  updateVariants.image_object = object;
  updateVariants.image_celebrity = celebrity;
  updateVariants.image_brand_logo = brandLogo;
  updateVariants.image_ocr = ocr;
  updateVariants.image_url_status = status;
  if (reqStatus === 1) updateVariants.object_update_date = mysqlNow();
  if (reqStatus === 4) updateVariants.ocr_updated_date = mysqlNow();

  await repo.updateVariant(sql, adId, updateVariants);

  // 4. Mirror the update into Elasticsearch (instagram_search_mix).
  if (!elastic) {
    // No ES configured — SQL update already succeeded.
    return { code: 200, message: ' Image Data Updated Successfully' };
  }

  const search = await elastic.search({
    index: ES_INDEX,
    body: { query: { match: { 'instagram_ad.id': adId } } },
  });
  const hits = search?.hits?.hits || search?.body?.hits?.hits || [];
  if (hits.length === 0) {
    return { code: 400, message: 'ad not found' };
  }

  let docValue = {
    'instagram_ad_variants.image_object': object,
    'instagram_ad_variants.image_object_ru': object,
    'instagram_ad_variants.image_object_fr': object,
    'instagram_ad_variants.image_object_sp': object,
    'instagram_ad_variants.image_object_exactly': object,
    'instagram_ad_variants.image_celebrity': celebrity,
    'instagram_ad_variants.image_celebrity_ru': celebrity,
    'instagram_ad_variants.image_celebrity_fr': celebrity,
    'instagram_ad_variants.image_celebrity_sp': celebrity,
    'instagram_ad_variants.image_celebrity_exactly': celebrity,
    'instagram_ad_variants.image_brand_logo': brandLogo,
    'instagram_ad_variants.image_brand_logo_ru': brandLogo,
    'instagram_ad_variants.image_brand_logo_fr': brandLogo,
    'instagram_ad_variants.image_brand_logo_sp': brandLogo,
    'instagram_ad_variants.image_brand_logo_exactly': brandLogo,
  };

  // The OCR field family is mirrored only on an OCR pass (status 4).
  if (reqStatus === 4) {
    docValue = {
      ...docValue,
      'instagram_ad_variants.image_ocr': ocr,
      'instagram_ad_variants.image_ocr_ru': ocr,
      'instagram_ad_variants.image_ocr_fr': ocr,
      'instagram_ad_variants.image_ocr_sp': ocr,
      'instagram_ad_variants.image_ocr_exactly': ocr,
    };
  }

  const updateRes = await elastic.update({
    index: ES_INDEX,
    type: 'doc',
    id: hits[0]._id,
    body: { doc: docValue, detect_noop: false },
  });

  if (esResult(updateRes) === 'updated') {
    return { code: 200, message: ' Image Data Updated Successfully' };
  }
  return { code: 400, message: 'ad not found' };
}

module.exports = { updateImageDetails };
