'use strict';

/**
 * updateImageOcrService — persists OCR/OCB results returned by the image
 * scraper back into MySQL (reddit_ad_variants) and Elasticsearch
 * (reddit_search_mix).
 *
 * Faithful port of PHP AdDetailsController@updateImageDetails.
 *   status 1 → OCB result (object / celebrity / brand) → sets object_update_date
 *   status 4 → OCR result (text)                        → sets ocr_updated_date
 *
 * ⚠️ Reddit's PHP differs from the quora/native variants in three ways, all
 * preserved here:
 *   1. Multi-value delimiter. Each field is normalised with
 *      str_replace(['||,','||'], '|', value) and then split on '|' (not '||').
 *      Multi-value fields are stored in MySQL as a JSON-encoded array string;
 *      single values are stored as the raw scalar (or NULL).
 *   2. image_url_status. Reddit only writes status 1 or 4 through; any other
 *      status (incl. 2) leaves image_url_status = 0. The quora "status 2 →
 *      3/1 null-check" branch does NOT exist in the reddit PHP (commented out).
 *   3. ocr is kept from the existing row when present (image_ocr != null),
 *      unless the posted ocr is itself multi-valued ('|' present).
 *
 * Follows the quora / native ocr shape: takes `db` + `log`, derives
 * `db.sql` / `db.elastic`, delegates all SQL to ./repository.
 */

const repo = require('../repository');

const ES_INDEX = 'reddit_search_mix';

/** PHP date('Y-m-d H:i:s') */
function mysqlNow() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

/** Read the ES update result across client major versions (v7 wraps in `body`). */
function esResult(res) {
  return res?.result || res?.body?.result || null;
}

/**
 * PHP: str_replace(['||,', '||'], '|', value). null/undefined → ''.
 * The two search terms are applied sequentially over the whole string.
 */
function normalizeDelimiters(value) {
  if (value === null || value === undefined) return '';
  return String(value).split('||,').join('|').split('||').join('|');
}

/**
 * PHP scalar-branch search-mix value:
 *   strpos($v, ',') == true ? json_decode($v) : $v
 * The loose `== true` means a comma at position 0 (or no comma) keeps the raw
 * scalar; a comma elsewhere triggers json_decode (which yields null on invalid
 * JSON). NULL stays NULL. Faithfully reproduces the quirky PHP.
 */
function scalarSearchMix(stored) {
  if (stored === null || stored === undefined) return stored;
  const pos = String(stored).indexOf(',');
  if (pos > 0) {
    try {
      return JSON.parse(stored);
    } catch (_e) {
      return null; // PHP json_decode() returns null on malformed input
    }
  }
  return stored;
}

/**
 * Compute the MySQL `stored` value and the Elasticsearch `searchMix` value for a
 * field, mirroring the reddit PHP per-field block.
 *
 * @param {string} replaced  - field value after normalizeDelimiters()
 * @param {string|null} [scalarFallback] - value to use when single-valued and the
 *        posted value is empty (ocr passes the existing image_ocr here).
 */
function computeField(replaced, scalarFallback) {
  if (replaced.includes('|')) {
    const searchMix = replaced.split('|');
    return { stored: JSON.stringify(searchMix), searchMix };
  }
  let stored;
  if (scalarFallback !== undefined && scalarFallback !== null) {
    // ocr: keep existing image_ocr when present (PHP precedence).
    stored = scalarFallback;
  } else {
    stored = replaced !== '' ? replaced : null;
  }
  return { stored, searchMix: scalarSearchMix(stored) };
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
  const rawStatus = postData.status;
  const status = Number(rawStatus);

  // 1. Load the existing variant row. Missing / unknown ad_id → "ad_id is not available".
  const variant = adId === undefined || adId === null || adId === ''
    ? null
    : await repo.getVariantByAdId(sql, adId);
  if (!variant) {
    return { code: 400, message: 'ad_id is not available' };
  }

  // 2. Normalise each field, then derive MySQL `stored` + ES `searchMix` values.
  const objField = computeField(normalizeDelimiters(postData.object));
  const celField = computeField(normalizeDelimiters(postData.celebrity));
  const brandField = computeField(normalizeDelimiters(postData.brand_logo));
  // ocr keeps the existing row's image_ocr when present (PHP precedence).
  const ocrField = computeField(
    normalizeDelimiters(postData.ocr),
    variant.image_ocr !== null && variant.image_ocr !== undefined ? variant.image_ocr : null
  );

  // 3. image_url_status: only 1 or 4 are written through; everything else stays 0.
  const imageUrlStatus = status === 1 || status === 4 ? status : 0;

  // 4. Build the MySQL update payload (mirrors PHP field-by-field).
  const updateVariants = {};
  if (Number(variant.image_text_final_status) === 0) {
    updateVariants.image_text_final_status = status;
  }
  updateVariants.image_object = objField.stored;
  updateVariants.image_celebrity = celField.stored;
  updateVariants.image_brand_logo = brandField.stored;
  updateVariants.image_ocr = ocrField.stored;
  updateVariants.image_url_status = imageUrlStatus;
  if (status === 1) updateVariants.object_update_date = mysqlNow();
  if (status === 4) updateVariants.ocr_updated_date = mysqlNow();

  await repo.updateVariant(sql, adId, updateVariants);

  // 5. Mirror the update into Elasticsearch (reddit_search_mix).
  if (!elastic) {
    // No ES configured — SQL update already succeeded.
    return { code: 200, message: ' Image Data Updated Successfully' };
  }

  // Locate the ES document by internal reddit_ad id.
  const search = await elastic.search({
    index: ES_INDEX,
    body: { query: { match: { 'reddit_ad.id': adId } } },
  });
  const hits = search?.hits?.hits || search?.body?.hits?.hits || [];
  if (hits.length === 0) {
    // PHP: "Ad not found" . "<br>"
    return { code: 400, message: 'Ad not found<br>' };
  }

  let docValue = {
    'reddit_ad_variants.image_object': objField.searchMix,
    'reddit_ad_variants.image_object_ru': objField.searchMix,
    'reddit_ad_variants.image_object_fr': objField.searchMix,
    'reddit_ad_variants.image_object_sp': objField.searchMix,
    'reddit_ad_variants.image_object_exactly': objField.searchMix,
    'reddit_ad_variants.image_celebrity': celField.searchMix,
    'reddit_ad_variants.image_celebrity_ru': celField.searchMix,
    'reddit_ad_variants.image_celebrity_fr': celField.searchMix,
    'reddit_ad_variants.image_celebrity_sp': celField.searchMix,
    'reddit_ad_variants.image_celebrity_exactly': celField.searchMix,
    'reddit_ad_variants.image_brand_logo': brandField.searchMix,
    'reddit_ad_variants.image_brand_logo_ru': brandField.searchMix,
    'reddit_ad_variants.image_brand_logo_fr': brandField.searchMix,
    'reddit_ad_variants.image_brand_logo_sp': brandField.searchMix,
    'reddit_ad_variants.image_brand_logo_exactly': brandField.searchMix,
  };

  // image_ocr* family is added only on the OCR pass (status 4).
  if (status === 4) {
    docValue = {
      ...docValue,
      'reddit_ad_variants.image_ocr': ocrField.searchMix,
      'reddit_ad_variants.image_ocr_ru': ocrField.searchMix,
      'reddit_ad_variants.image_ocr_fr': ocrField.searchMix,
      'reddit_ad_variants.image_ocr_sp': ocrField.searchMix,
      'reddit_ad_variants.image_ocr_exactly': ocrField.searchMix,
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
