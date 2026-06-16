'use strict';

/**
 * Pinterest OCR/OCB — data repository (raw parameterized SQL).
 *
 * Faithful port of the Laravel model methods used by the two PHP endpoints
 * (UserController getImagesUrl / updateImageOcrDetails, model PinterestAdVariants).
 * One function per DB operation — same shape as the native OCR repository.
 *
 * Every function takes `exec` as its first arg: the `db.sql` pool wrapper with
 * `query(sql, params) -> rows | ResultSetHeader`. Pass `db.sql` for autocommit.
 *
 * Table (DB pinterest pool):
 *   pinterest_ad_variants  (PK id, FK pinterest_ad_id → pinterest_ad.id)
 *   pinterest_ad           (join only, for type = 'IMAGE')
 */

const rows = (r) => (Array.isArray(r) ? r : []);
const affected = (r) => (r && typeof r.affectedRows === 'number' ? r.affectedRows : 0);

// ── pinterest_ad_variants ─────────────────────────────────────────────────────

/**
 * PHP getImagesUrl(): up to 20 IMAGE-type ads at the given image_url_status,
 * newest first. `withOcr` adds the image_ocr column (status 4 / OCR queue).
 */
async function getImagesUrl(exec, imageUrlStatus, withOcr) {
  const select = [
    'pinterest_ad_variants.pinterest_ad_id AS ad_id',
    'pinterest_ad_variants.image_url',
  ];
  if (withOcr) select.push('pinterest_ad_variants.image_ocr');

  const sql = `
    SELECT ${select.join(', ')}
      FROM pinterest_ad_variants
      LEFT JOIN pinterest_ad ON pinterest_ad.id = pinterest_ad_variants.pinterest_ad_id
     WHERE pinterest_ad.type = 'IMAGE'
       AND pinterest_ad_variants.image_url_status = ?
     ORDER BY pinterest_ad_variants.pinterest_ad_id DESC
     LIMIT 20`;
  return rows(await exec.query(sql, [imageUrlStatus]));
}

/** PHP updateStatus(): bulk image_url_status flip for the fetched ids. */
async function updateStatusMultiple(exec, adIds, imageUrlStatus) {
  const ids = (Array.isArray(adIds) ? adIds : [adIds]).filter((v) => v !== undefined && v !== null);
  if (!ids.length) return 0;
  const placeholders = ids.map(() => '?').join(',');
  const sql = `UPDATE pinterest_ad_variants SET image_url_status = ? WHERE pinterest_ad_id IN (${placeholders})`;
  return affected(await exec.query(sql, [imageUrlStatus, ...ids]));
}

/** PHP PinterestAdVariants::where('pinterest_ad_id',$id)->first(): single variant row or null. */
async function getVariantByAdId(exec, adId) {
  const r = rows(await exec.query('SELECT * FROM pinterest_ad_variants WHERE pinterest_ad_id = ? LIMIT 1', [adId]));
  return r.length ? r[0] : null;
}

/** PHP updateData(): UPDATE pinterest_ad_variants ... WHERE pinterest_ad_id = ?. Skips undefined keys. */
async function updateVariant(exec, adId, data) {
  const cols = Object.keys(data).filter((k) => data[k] !== undefined);
  if (!cols.length) return 0;
  const sql = `UPDATE pinterest_ad_variants SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE pinterest_ad_id = ?`;
  return affected(await exec.query(sql, [...cols.map((c) => data[c]), adId]));
}

module.exports = {
  getImagesUrl,
  updateStatusMultiple,
  getVariantByAdId,
  updateVariant,
};
