'use strict';

/**
 * updateImageOcrService — persists OCR/OCB results returned by the image
 * scraper back into MySQL (native_ad_variants) and Elasticsearch
 * (native_search_mix).
 *
 * Faithful port of PHP UserController@updateImageOcrDetails.
 *   status 1 → OCB result (object / celebrity / brand) → sets object_update_date
 *   status 4 → OCR result (text)                        → sets ocr_updated_date
 *   status 2 → re-queue / partial                       → status derived from null check
 *
 * Follows the gdn/google landers shape: takes `db` + `log`, derives
 * `db.sql` / `db.elastic`, delegates all SQL to ./repository.
 */

const repo = require('../repository');

const ES_INDEX = 'native_search_mix';

/** PHP `in_array(null, $row)` — true when any column of the variant row is null. */
function hasNullColumn(row) {
  return Object.values(row).some((v) => v === null);
}

/** PHP date('Y-m-d H:i:s') */
function mysqlNow() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/** PHP explode("||", $value) — null/undefined → ['']. */
function splitDelimited(value) {
  if (value === null || value === undefined) return [''];
  return String(value).split('||');
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
async function updateImageOcrDetails(postData, db, log) {
  const sql = db?.sql;
  const elastic = db?.elastic;
  const adId = postData.ad_id;
  const status = Number(postData.status);

  // 1. Load the existing variant row.
  const variant = await repo.getVariantByAdId(sql, adId);
  if (!variant) {
    return { code: 400, message: 'Please enter valid ad_id' };
  }

  // 2. Build the MySQL update payload (mirrors PHP field-by-field).
  const updateVariants = {};

  if (variant.image_text_final_status === 0) {
    updateVariants.image_text_final_status = status;
  }

  updateVariants.image_object = postData.object ?? null;
  updateVariants.image_celebrity = postData.celebrity ?? null;
  updateVariants.image_brand_logo = postData.brand_logo ?? null;
  updateVariants.image_ocr =
    postData.ocr !== undefined && postData.ocr !== null
      ? postData.ocr
      : variant.image_ocr;

  if (status === 1 || status === 4) {
    updateVariants.image_url_status = status;
  } else if (status === 2) {
    updateVariants.image_url_status = hasNullColumn(variant) ? 3 : 1;
  }

  if (status === 1) updateVariants.object_update_date = mysqlNow();
  if (status === 4) updateVariants.ocr_updated_date = mysqlNow();

  await repo.updateVariant(sql, adId, updateVariants);

  // 3. Mirror the update into Elasticsearch (native_search_mix).
  if (!elastic) {
    // No ES configured — SQL update already succeeded.
    return { code: 200, message: 'Image Data Updated Successfully' };
  }

  const object = splitDelimited(postData.object);
  const celebrity = splitDelimited(postData.celebrity);
  const brandLogo = splitDelimited(postData.brand_logo);
  const ocr = splitDelimited(postData.ocr);

  // Locate the ES document by internal native_ad id.
  const search = await elastic.search({
    index: ES_INDEX,
    body: { query: { match: { 'native_ad.id': adId } } },
  });
  const hits = search?.hits?.hits || search?.body?.hits?.hits || [];
  if (hits.length === 0) {
    return { code: 400, message: 'ad not found' };
  }

  let docValue = {
    'native_ad_variants.image_object': object,
    'native_ad_variants.image_celebrity': celebrity,
    'native_ad_variants.image_brand_logo': brandLogo,
    'native_ad_variants.image_object_ru': object,
    'native_ad_variants.image_object_fr': object,
    'native_ad_variants.image_object_sp': object,
    'native_ad_variants.image_object_exactly': object,
    'native_ad_variants.image_celebrity_ru': celebrity,
    'native_ad_variants.image_celebrity_fr': celebrity,
    'native_ad_variants.image_celebrity_sp': celebrity,
    'native_ad_variants.image_celebrity_exactly': celebrity,
    'native_ad_variants.image_brand_logo_ru': brandLogo,
    'native_ad_variants.image_brand_logo_fr': brandLogo,
    'native_ad_variants.image_brand_logo_sp': brandLogo,
    'native_ad_variants.image_brand_logo_exactly': brandLogo,
  };

  if (status === 4) {
    docValue = {
      ...docValue,
      'native_ad_variants.image_ocr_ru': ocr,
      'native_ad_variants.image_ocr': ocr,
      'native_ad_variants.image_ocr_fr': ocr,
      'native_ad_variants.image_ocr_sp': ocr,
      'native_ad_variants.image_ocr_exactly': ocr,
    };
  }

  const updateRes = await elastic.update({
    index: ES_INDEX,
    type: 'doc',
    id: hits[0]._id,
    body: { doc: docValue, detect_noop: false },
  });

  if (esResult(updateRes) === 'updated') {
    return { code: 200, message: 'Image Data Updated Successfully' };
  }
  return { code: 400, message: 'Image Object not updated' };
}

module.exports = { updateImageOcrDetails };
