'use strict';

/**
 * Reddit OCR/OCB — data repository (raw parameterized SQL).
 *
 * Faithful port of the Laravel model methods used by the two PHP endpoints
 * (AdDetailsController getImagesUrl / updateImageDetails, model Reddit_ad_variants).
 * One function per DB operation — same shape as the quora ocr / native ocr repositories.
 *
 * Every function takes `exec` as its first arg: the `db.sql` pool wrapper with
 * `query(sql, params) -> rows | ResultSetHeader`. Pass `db.sql` for autocommit.
 *
 * Table (DB pasdev_reddit):
 *   reddit_ad_variants  (PK id, FK reddit_ad_id → reddit_ad.id)
 *   reddit_ad           (join only, for type = 'IMAGE')
 */

const rows = (r) => (Array.isArray(r) ? r : []);
const affected = (r) => (r && typeof r.affectedRows === 'number' ? r.affectedRows : 0);

// ── reddit_ad_variants ──────────────────────────────────────────────────────────

/**
 * PHP getImagesUrl(): up to 20 IMAGE-type ads at the given image_url_status,
 * newest first. `withOcr` adds the image_ocr column (status 4 / OCR queue).
 */
async function getImagesUrl(exec, imageUrlStatus, withOcr) {
  const select = [
    'reddit_ad_variants.reddit_ad_id AS ad_id',
    'reddit_ad_variants.image_url',
  ];
  if (withOcr) select.push('reddit_ad_variants.image_ocr');

  const sql = `
    SELECT ${select.join(', ')}
      FROM reddit_ad_variants
      LEFT JOIN reddit_ad ON reddit_ad.id = reddit_ad_variants.reddit_ad_id
     WHERE reddit_ad.type = 'IMAGE'
       AND reddit_ad_variants.image_url_status = ?
     ORDER BY reddit_ad_variants.reddit_ad_id DESC
     LIMIT 20`;
  return rows(await exec.query(sql, [imageUrlStatus]));
}

/** PHP updateStatus(): bulk image_url_status flip for the fetched ids. */
async function updateStatusMultiple(exec, adIds, imageUrlStatus) {
  const ids = (Array.isArray(adIds) ? adIds : [adIds]).filter((v) => v !== undefined && v !== null);
  if (!ids.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const sql = `UPDATE reddit_ad_variants SET image_url_status = ? WHERE reddit_ad_id IN (${placeholders})`;
  return affected(await exec.query(sql, [imageUrlStatus, ...ids]));
}

/** PHP Reddit_ad_variants::where('reddit_ad_id',$id)->first(): single variant row or null. */
async function getVariantByAdId(exec, adId) {
  const r = rows(await exec.query('SELECT * FROM reddit_ad_variants WHERE reddit_ad_id = ? LIMIT 1', [adId]));
  return r.length ? r[0] : null;
}

/** PHP updateData(): UPDATE reddit_ad_variants ... WHERE reddit_ad_id = ?. Skips undefined keys. */
async function updateVariant(exec, adId, data) {
  const cols = Object.keys(data).filter((k) => data[k] !== undefined);
  if (!cols.length) return 0;
  const sql = `UPDATE reddit_ad_variants SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE reddit_ad_id = ?`;
  return affected(await exec.query(sql, [...cols.map((c) => data[c]), adId]));
}

module.exports = {
  getImagesUrl,
  updateStatusMultiple,
  getVariantByAdId,
  updateVariant,
};
