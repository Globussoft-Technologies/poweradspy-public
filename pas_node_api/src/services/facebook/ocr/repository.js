'use strict';

/**
 * Facebook OCR/OCB — data repository.
 *
 * Faithful port of the Facebook_ad_variants model methods used by the two PHP
 * endpoints in Userv2Controller (api app):
 *   - getImageUrl            → lease a batch of IMAGE ads queued for OCB/OCR
 *   - updateImageOcrDetails  → persist scraper output back to MySQL
 *
 * One function per DB operation. No business logic here — the services orchestrate.
 * Every function takes `exec` (an object with `query(sql, params) -> rows|ResultSetHeader`)
 * as its first arg, so the same writers run standalone (db.sql) or inside a transaction.
 * Mirrors the gdn/facebook landers repository style (function-per-op, no model class).
 *
 * Tables:
 *   facebook_ad_variants  (PK id; keyed for OCR by facebook_ad_id)
 *   facebook_ad           (join only — type = 'IMAGE', last_seen window)
 */

const rows = (r) => (Array.isArray(r) ? r : []);
const affected = (r) => (r && typeof r.affectedRows === 'number' ? r.affectedRows : 0);

/**
 * PHP Facebook_ad_variants::getImageUrlFBs(): up to 20 IMAGE ads at the given
 * image_url_status, seen in the last 10 days, newest first. For the OCR queue
 * (status 4) the stored image_ocr is also selected so it can be re-sent.
 */
async function leaseImageAds(exec, status, withOcr) {
  const ocrCol = withOcr ? ', variants.image_ocr' : '';
  const sql = `
    SELECT STRAIGHT_JOIN variants.facebook_ad_id AS ad_id,
           variants.image_url${ocrCol}
      FROM facebook_ad_variants AS variants
      FORCE INDEX (idx_image_url_status_facebook_ad_id)
      INNER JOIN facebook_ad AS ads ON ads.id = variants.facebook_ad_id
     WHERE variants.image_url_status = ?
       AND ads.type = 'IMAGE'
       AND ads.last_seen BETWEEN DATE_SUB(NOW(), INTERVAL 10 DAY) AND NOW()
     ORDER BY variants.facebook_ad_id DESC
     LIMIT 20`;
  return rows(await exec.query(sql, [status]));
}

/**
 * PHP updateStatus(): bulk flip image_url_status for a list of facebook_ad_ids
 * (UPDATE ... WHERE facebook_ad_id IN (...)). Used to mark a leased batch in-progress.
 */
async function updateStatusByAdIds(exec, adIds, status) {
  const ids = (Array.isArray(adIds) ? adIds : [adIds]).filter((v) => v !== undefined && v !== null);
  if (!ids.length) return 0;
  const placeholders = ids.map(() => '?').join(', ');
  const sql = `UPDATE facebook_ad_variants SET image_url_status = ? WHERE facebook_ad_id IN (${placeholders})`;
  return affected(await exec.query(sql, [status, ...ids]));
}

/** PHP Facebook_ad_variants::where('facebook_ad_id', $id)->first(): the full variant row. */
async function getVariantByAdId(exec, adId) {
  const r = rows(await exec.query(
    'SELECT * FROM facebook_ad_variants WHERE facebook_ad_id = ? LIMIT 1',
    [adId]
  ));
  return r.length ? r[0] : null;
}

/** PHP updateData(): UPDATE facebook_ad_variants SET ... WHERE facebook_ad_id = ?. */
async function updateVariant(exec, adId, data) {
  const cols = Object.keys(data);
  if (!cols.length) return 0;
  const sql = `UPDATE facebook_ad_variants SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE facebook_ad_id = ?`;
  return affected(await exec.query(sql, [...Object.values(data), adId]));
}

module.exports = {
  leaseImageAds,
  updateStatusByAdIds,
  getVariantByAdId,
  updateVariant,
};
