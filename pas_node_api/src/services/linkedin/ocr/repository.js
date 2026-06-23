'use strict';

/**
 * LinkedIn OCR/OCB — data repository.
 *
 * Faithful port of the LinkedinAdVariants + LinkedinAdOcrOcbDetails model methods used
 * by the two PHP endpoints in api_linkedin UserController:
 *   - getImagesUrl            → lease a batch of IMAGE ads queued for OCB/OCR
 *   - updateImageOcrDetails   → persist scraper output back to MySQL (two tables) + ES
 *
 * One function per DB operation. No business logic here — the services orchestrate.
 * Every function takes `exec` (an object with `query(sql, params) -> rows|ResultSetHeader`)
 * as its first arg. Mirrors the gdn/google OCR repository style (function-per-op, no
 * model class; the service passes db.sql / db.elastic in).
 *
 * Tables (UNLIKE GDN, OCR/OCB data lives in a SEPARATE table):
 *   linkedin_ad_variants          (keyed by linkedin_ad_id; image_url, image_url_status, image_text_final_status)
 *   linkedin_ad_ocr_ocb_details   (keyed by linkedin_ad_id; image_object/celebrity/brand_logo/ocr + *_date)
 *   linkedin_ad                   (join only — type = 'IMAGE')
 *
 * NOTE: like GDN, the LinkedIn lease has NO last_seen window (the PHP getImagesUrl
 * filters only type='IMAGE' + image_url_status).
 */

const rows = (r) => (Array.isArray(r) ? r : []);
const affected = (r) => (r && typeof r.affectedRows === 'number' ? r.affectedRows : 0);

/**
 * PHP LinkedinAdVariants::getImagesUrl(): up to 20 IMAGE ads at the given
 * image_url_status, newest first. For the OCR queue (status 4) the stored image_ocr is
 * also selected — it lives in linkedin_ad_ocr_ocb_details, so that table is joined.
 */
async function leaseImageAds(exec, status, withOcr) {
  const ocrCol = withOcr ? ', linkedin_ad_ocr_ocb_details.image_ocr' : '';
  const sql = `
    SELECT linkedin_ad_variants.linkedin_ad_id AS ad_id,
           linkedin_ad_variants.image_url${ocrCol}
      FROM linkedin_ad_variants
      LEFT JOIN linkedin_ad ON linkedin_ad.id = linkedin_ad_variants.linkedin_ad_id
      LEFT JOIN linkedin_ad_ocr_ocb_details
        ON linkedin_ad_ocr_ocb_details.linkedin_ad_id = linkedin_ad_variants.linkedin_ad_id
     WHERE linkedin_ad_variants.image_url_status = ?
       AND linkedin_ad.type = 'IMAGE'
     ORDER BY linkedin_ad_variants.linkedin_ad_id DESC
     LIMIT 20`;
  return rows(await exec.query(sql, [status]));
}

/**
 * PHP updateStatus(): bulk flip image_url_status for a list of linkedin_ad_ids
 * (UPDATE ... WHERE linkedin_ad_id IN (...)). Marks a leased batch in-progress.
 */
async function updateStatusByAdIds(exec, adIds, status) {
  const ids = (Array.isArray(adIds) ? adIds : [adIds]).filter((v) => v !== undefined && v !== null);
  if (!ids.length) return 0;
  const placeholders = ids.map(() => '?').join(', ');
  const sql = `UPDATE linkedin_ad_variants SET image_url_status = ? WHERE linkedin_ad_id IN (${placeholders})`;
  return affected(await exec.query(sql, [status, ...ids]));
}

/** PHP LinkedinAdVariants::where('linkedin_ad_id', $id)->first(): the full variant row (or null). */
async function getVariantByAdId(exec, adId) {
  const r = rows(await exec.query(
    'SELECT * FROM linkedin_ad_variants WHERE linkedin_ad_id = ? LIMIT 1',
    [adId]
  ));
  return r.length ? r[0] : null;
}

/** PHP LinkedinAdOcrOcbDetails::where('linkedin_ad_id', $id)->first(): the full OCR/OCB row (or null). */
async function getOcrDetailByAdId(exec, adId) {
  const r = rows(await exec.query(
    'SELECT * FROM linkedin_ad_ocr_ocb_details WHERE linkedin_ad_id = ? LIMIT 1',
    [adId]
  ));
  return r.length ? r[0] : null;
}

/** PHP LinkedinAdVariants::updateData(): UPDATE linkedin_ad_variants SET ... WHERE linkedin_ad_id = ?. */
async function updateVariant(exec, adId, data) {
  const cols = Object.keys(data);
  if (!cols.length) return 0;
  const sql = `UPDATE linkedin_ad_variants SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE linkedin_ad_id = ?`;
  return affected(await exec.query(sql, [...Object.values(data), adId]));
}

/** PHP LinkedinAdOcrOcbDetails::updateData(): UPDATE linkedin_ad_ocr_ocb_details SET ... WHERE linkedin_ad_id = ?. */
async function updateOcrDetail(exec, adId, data) {
  const cols = Object.keys(data);
  if (!cols.length) return 0;
  const sql = `UPDATE linkedin_ad_ocr_ocb_details SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE linkedin_ad_id = ?`;
  return affected(await exec.query(sql, [...Object.values(data), adId]));
}

module.exports = {
  leaseImageAds,
  updateStatusByAdIds,
  getVariantByAdId,
  getOcrDetailByAdId,
  updateVariant,
  updateOcrDetail,
};
