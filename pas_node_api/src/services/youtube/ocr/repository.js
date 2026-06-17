'use strict';

/**
 * YouTube OCR/OCB — data repository.
 *
 * Faithful port of the YoutubeAdVariants + YoutubeAdOcb model methods used by the two
 * PHP endpoints in api_youtube VideoURLController:
 *   - getOcbUrl       → lease a batch of ads queued for OCB (getImageUrl / getVideoUrl)
 *   - insertUpdateOcb → upsert youtube_ad_ocb, flip youtube_ad_variants.ocb_url_status,
 *                       and patch youtube_ads_data ES (done in the service)
 *
 * One function per DB operation. No business logic here — the services orchestrate.
 * Every function takes `exec` (db.sql with `query(sql, params)`).
 *
 * Tables:
 *   youtube_ad_variants  (lease source; status column = ocb_url_status; keyed by youtube_ad_id)
 *   youtube_ad           (join only — type IMAGE/DISPLAY)
 *   youtube_ad_ocb       (OCB result store; upserted, keyed by youtube_ad_id)
 */

const rows = (r) => (Array.isArray(r) ? r : []);
const affected = (r) => (r && typeof r.affectedRows === 'number' ? r.affectedRows : 0);

// ── Lease (youtube_ad_variants) ──────────────────────────────────────────────

/** type=1 image lease: IMAGE/DISPLAY ads with a video_url at the given ocb_url_status. */
async function leaseImageAds(exec, status) {
  const sql = `
    SELECT youtube_ad_variants.youtube_ad_id AS ad_id,
           youtube_ad_variants.video_url AS image_url
      FROM youtube_ad_variants
      LEFT JOIN youtube_ad ON youtube_ad.id = youtube_ad_variants.youtube_ad_id
     WHERE youtube_ad_variants.video_url IS NOT NULL
       AND youtube_ad_variants.ocb_url_status = ?
       AND (youtube_ad.type = 'IMAGE' OR youtube_ad.type = 'DISPLAY')
     ORDER BY youtube_ad_variants.youtube_ad_id DESC
     LIMIT 20`;
  return rows(await exec.query(sql, [status]));
}

/** PHP updateStatus(): bulk flip ocb_url_status for a list of youtube_ad_ids. */
async function updateVariantStatusByAdIds(exec, adIds, status) {
  const ids = (Array.isArray(adIds) ? adIds : [adIds]).filter((v) => v !== undefined && v !== null);
  if (!ids.length) return 0;
  const placeholders = ids.map(() => '?').join(', ');
  const sql = `UPDATE youtube_ad_variants SET ocb_url_status = ? WHERE youtube_ad_id IN (${placeholders})`;
  return affected(await exec.query(sql, [status, ...ids]));
}

// ── Report (youtube_ad_ocb upsert + variant status) ──────────────────────────

/** Does an OCB row already exist for this ad? (drives the updateOrInsert branch). */
async function ocbRowExists(exec, adId) {
  const r = rows(await exec.query('SELECT 1 FROM youtube_ad_ocb WHERE youtube_ad_id = ? LIMIT 1', [adId]));
  return r.length > 0;
}

async function insertOcb(exec, adId, data) {
  const cols = ['youtube_ad_id', ...Object.keys(data)];
  const vals = [adId, ...Object.values(data)];
  const sql = `INSERT INTO youtube_ad_ocb (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`;
  await exec.query(sql, vals);
  return true; // PHP insert path → truthy
}

/** Returns affectedRows (0 means "nothing changed" → PHP "Image Data is already updated"). */
async function updateOcb(exec, adId, data) {
  const cols = Object.keys(data);
  if (!cols.length) return 0;
  const sql = `UPDATE youtube_ad_ocb SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE youtube_ad_id = ?`;
  return affected(await exec.query(sql, [...Object.values(data), adId]));
}

/** PHP: UPDATE youtube_ad_variants SET ocb_url_status = <status> WHERE youtube_ad_id = ?. */
async function updateVariantStatus(exec, adId, status) {
  return affected(await exec.query(
    'UPDATE youtube_ad_variants SET ocb_url_status = ? WHERE youtube_ad_id = ?',
    [status, adId]
  ));
}

module.exports = {
  leaseImageAds,
  updateVariantStatusByAdIds,
  ocbRowExists,
  insertOcb,
  updateOcb,
  updateVariantStatus,
};
