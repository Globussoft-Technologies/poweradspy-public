'use strict';

/**
 * GDN OCR/OCB — data repository.
 *
 * Faithful port of the GdnAdVariants model methods used by the two PHP endpoints in
 * api_gdn ApiController:
 *   - getImageUrl           → lease a batch of IMAGE ads queued for OCB/OCR (getImagesUrl)
 *   - insertGDNImageData    → persist scraper output back to MySQL (Eloquent ->save())
 *
 * One function per DB operation. No business logic here — the services orchestrate.
 * Every function takes `exec` (an object with `query(sql, params) -> rows|ResultSetHeader`)
 * as its first arg. Mirrors the gdn/google landers repository style (function-per-op,
 * no model class; the service passes db.sql / db.elastic in).
 *
 * Tables:
 *   gdn_ad_variants  (PK id; keyed for OCR by gdn_ad_id)
 *   gdn_ad           (join only — type = 'IMAGE')
 *
 * NOTE: unlike Facebook, the GDN lease has NO last_seen window (the PHP getImagesUrl
 * filters only type='IMAGE' + image_url_status).
 */

const rows = (r) => (Array.isArray(r) ? r : []);
const affected = (r) => (r && typeof r.affectedRows === 'number' ? r.affectedRows : 0);

/**
 * PHP GdnAdVariants::getImagesUrl(): up to 20 IMAGE ads at the given image_url_status,
 * newest first. For the OCR queue (status 4) the stored image_ocr is also selected.
 */
async function leaseImageAds(exec, status, withOcr) {
  const ocrCol = withOcr ? ', gdn_ad_variants.image_ocr' : '';
  const sql = `
    SELECT gdn_ad_variants.gdn_ad_id AS ad_id,
           gdn_ad_variants.image_url${ocrCol}
      FROM gdn_ad_variants
      LEFT JOIN gdn_ad ON gdn_ad.id = gdn_ad_variants.gdn_ad_id
     WHERE gdn_ad.type = 'IMAGE'
       AND gdn_ad_variants.image_url_status = ?
     ORDER BY gdn_ad_variants.gdn_ad_id DESC
     LIMIT 20`;
  return rows(await exec.query(sql, [status]));
}

/**
 * PHP updateStatus(): bulk flip image_url_status for a list of gdn_ad_ids
 * (UPDATE ... WHERE gdn_ad_id IN (...)). Marks a leased batch in-progress.
 */
async function updateStatusByAdIds(exec, adIds, status) {
  const ids = (Array.isArray(adIds) ? adIds : [adIds]).filter((v) => v !== undefined && v !== null);
  if (!ids.length) return 0;
  const placeholders = ids.map(() => '?').join(', ');
  const sql = `UPDATE gdn_ad_variants SET image_url_status = ? WHERE gdn_ad_id IN (${placeholders})`;
  return affected(await exec.query(sql, [status, ...ids]));
}

/** PHP GdnAdVariants::where('gdn_ad_id', $id)->first(): the full variant row (or null). */
async function getVariantByAdId(exec, adId) {
  const r = rows(await exec.query(
    'SELECT * FROM gdn_ad_variants WHERE gdn_ad_id = ? LIMIT 1',
    [adId]
  ));
  return r.length ? r[0] : null;
}

/** PHP $updatedata->save(): UPDATE gdn_ad_variants SET ... WHERE gdn_ad_id = ?. */
async function updateVariant(exec, adId, data) {
  const cols = Object.keys(data);
  if (!cols.length) return 0;
  const sql = `UPDATE gdn_ad_variants SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE gdn_ad_id = ?`;
  return affected(await exec.query(sql, [...Object.values(data), adId]));
}

module.exports = {
  leaseImageAds,
  updateStatusByAdIds,
  getVariantByAdId,
  updateVariant,
};
