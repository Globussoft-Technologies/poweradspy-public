'use strict';

/**
 * Instagram OCR/OCB — data repository (raw parameterized SQL).
 *
 * Faithful port of the Laravel model methods used by the two PHP endpoints
 * (AdDetails@getImageUrls / AdDetails@updateImageDetails, model Instagram_ad_variants).
 * One function per DB operation — same shape as the native/gdn OCR repositories.
 *
 * Every function takes `exec` as its first arg: the `db.sql` pool wrapper with
 * `query(sql, params) -> rows | ResultSetHeader`. Pass `db.sql` for autocommit.
 *
 * Table (DB pasdev_instagram / instagram_sql):
 *   instagram_ad_variants  (PK id, FK instagram_ad_id → instagram_ad.id)
 *   instagram_ad           (join only, for type IN ('IMAGE','STORIES'))
 */

const rows = (r) => (Array.isArray(r) ? r : []);
const affected = (r) => (r && typeof r.affectedRows === 'number' ? r.affectedRows : 0);

/** PHP date('Y-m-d H:i:s', ...) for a Date instance. */
function mysqlDate(d) {
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

// ── instagram_ad_variants ─────────────────────────────────────────────────────

/**
 * PHP Instagram_ad_variants::getImagesUrl(): up to 20 IMAGE/STORIES ads at the
 * given image_url_status, last seen within the trailing 10-day window, newest
 * first. `withOcr` adds the image_ocr column (status 4 / OCR queue).
 *
 * NOTE: the original PHP query used a buggy `orWhere([...])` (two equality
 * predicates on the same `type` column OR'd against the status filter). This is
 * a faithful port of the *intent* — status filter AND type IN ('IMAGE','STORIES')
 * AND last_seen within the trailing 10 days — expressed as a well-formed query.
 */
async function getImagesUrl(exec, imageUrlStatus, withOcr) {
  const select = [
    'instagram_ad_variants.instagram_ad_id AS ad_id',
    'instagram_ad_variants.image_url',
  ];
  if (withOcr) select.push('instagram_ad_variants.image_ocr');

  const now = new Date();
  const tenDaysAgo = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);

  const sql = `
    SELECT ${select.join(', ')}
      FROM instagram_ad_variants
      JOIN instagram_ad ON instagram_ad.id = instagram_ad_variants.instagram_ad_id
     WHERE instagram_ad_variants.image_url_status = ?
       AND instagram_ad.type IN ('IMAGE', 'STORIES')
       AND instagram_ad.last_seen BETWEEN ? AND ?
     ORDER BY instagram_ad_variants.instagram_ad_id DESC
     LIMIT 20`;
  return rows(await exec.query(sql, [imageUrlStatus, mysqlDate(tenDaysAgo), mysqlDate(now)]));
}

/** PHP updateStatus(): bulk image_url_status flip for the fetched ids. */
async function updateStatusMultiple(exec, adIds, imageUrlStatus) {
  const ids = (Array.isArray(adIds) ? adIds : [adIds]).filter((v) => v !== undefined && v !== null);
  if (!ids.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const sql = `UPDATE instagram_ad_variants SET image_url_status = ? WHERE instagram_ad_id IN (${placeholders})`;
  return affected(await exec.query(sql, [imageUrlStatus, ...ids]));
}

/** PHP Instagram_ad_variants::where('instagram_ad_id',$id)->first(): single row or null. */
async function getVariantByAdId(exec, adId) {
  const r = rows(await exec.query('SELECT * FROM instagram_ad_variants WHERE instagram_ad_id = ? LIMIT 1', [adId]));
  return r.length ? r[0] : null;
}

/** PHP updateData(): UPDATE instagram_ad_variants ... WHERE instagram_ad_id = ?. Skips undefined keys. */
async function updateVariant(exec, adId, data) {
  const cols = Object.keys(data).filter((k) => data[k] !== undefined);
  if (!cols.length) return 0;
  const sql = `UPDATE instagram_ad_variants SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE instagram_ad_id = ?`;
  return affected(await exec.query(sql, [...cols.map((c) => data[c]), adId]));
}

module.exports = {
  getImagesUrl,
  updateStatusMultiple,
  getVariantByAdId,
  updateVariant,
};
