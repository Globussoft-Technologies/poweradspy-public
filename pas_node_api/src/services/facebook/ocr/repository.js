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
 *   facebook_ad           (join only — type = 'IMAGE', last_seen / created_date window)
 */

const { fitOcrColumns } = require('../../common/helpers/ocrColumnFit');

// Prod facebook_ad_variants OCR/OCB columns: latin1 varchar(256).
const OCR_COL_LIMITS = { image_ocr: 256, image_object: 256, image_celebrity: 256, image_brand_logo: 256 };

const rows = (r) => (Array.isArray(r) ? r : []);
const affected = (r) => (r && typeof r.affectedRows === 'number' ? r.affectedRows : 0);

// Values interpolated into SQL (LIMIT, INTERVAL, optimizer hint) must be positive
// integers: the pool uses prepared statements, where `LIMIT ?` is unreliable.
const positiveInt = (v) => Number.isInteger(v) && v > 0;
const timeCapHint = (maxExecutionMs) =>
  positiveInt(maxExecutionMs) ? ` /*+ MAX_EXECUTION_TIME(${maxExecutionMs}) */` : '';

/**
 * PHP Facebook_ad_variants::getImageUrlFBs(): up to 20 IMAGE ads at the given
 * image_url_status, seen in the last 10 days, newest first. For the OCR queue
 * (status 4) the stored image_ocr is also selected so it can be re-sent.
 * Fallback lease when the id-window lease is not configured or fails.
 *
 * Driven from facebook_ad (idx_type_last_seen range) so the scan is bounded by the
 * 10-day IMAGE window. Driving from the status index instead walks the whole status
 * bucket — which never shrinks (non-IMAGE / stale ads stay at 0 forever) — whenever
 * fewer than 20 rows qualify. Both indexes are forced: left alone, the optimizer picks a
 * reverse PRIMARY scan on facebook_ad for ORDER BY ... LIMIT, which is unbounded too.
 * The (image_url_status, facebook_ad_id) probe rejects non-matching ads inside the
 * index without reading the variant row. MAX_EXECUTION_TIME caps a slow run so polls
 * can't pile up (not a positive integer → no cap).
 */
async function leaseImageAds(exec, status, withOcr, maxExecutionMs) {
  const ocrCol = withOcr ? ', variants.image_ocr' : '';
  const hint = timeCapHint(maxExecutionMs);
  const sql = `
    SELECT${hint} STRAIGHT_JOIN
           variants.facebook_ad_id AS ad_id,
           variants.image_url${ocrCol}
      FROM facebook_ad AS ads FORCE INDEX (idx_type_last_seen)
      INNER JOIN facebook_ad_variants AS variants
            FORCE INDEX (idx_image_url_status_facebook_ad_id)
              ON variants.facebook_ad_id = ads.id
             AND variants.image_url_status = ?
     WHERE ads.type = 'IMAGE'
       AND ads.last_seen BETWEEN DATE_SUB(NOW(), INTERVAL 10 DAY) AND NOW()
     ORDER BY ads.id DESC
     LIMIT 20`;
  return rows(await exec.query(sql, [status]));
}

/**
 * First facebook_ad.id created within the last `windowDays` days (uses the
 * created_date index). facebook_ad.id is auto-increment, so every ad at or above
 * this id belongs to the window. Returns null when no ad falls in the window.
 */
async function getMinAdIdSince(exec, windowDays) {
  if (!positiveInt(windowDays)) return null;
  const r = rows(await exec.query(
    `SELECT id FROM facebook_ad
      WHERE created_date >= NOW() - INTERVAL ${windowDays} DAY
      ORDER BY created_date
      LIMIT 1`,
    []
  ));
  return r.length ? Number(r[0].id) : null;
}

/**
 * Id-window lease: up to `batchSize` IMAGE ads at the given image_url_status with
 * facebook_ad_id >= minAdId, newest first (same row shape as leaseImageAds).
 *
 * Walks the (image_url_status, facebook_ad_id) index from the top of the window
 * and stops once batchSize ads match, so it is fast while work is pending. When
 * fewer than batchSize match it scans every status row in the window — bounded by
 * the window, and by MAX_EXECUTION_TIME. The inner query selects only the variant
 * id (covered by the index); image_url is read for the final rows only.
 */
async function leaseImageAdsFromId(exec, status, withOcr, { minAdId, batchSize, maxExecutionMs } = {}) {
  if (!positiveInt(minAdId) || !positiveInt(batchSize)) return [];
  const ocrCol = withOcr ? ', v.image_ocr' : '';
  const hint = timeCapHint(maxExecutionMs);
  const sql = `
    SELECT${hint} v.facebook_ad_id AS ad_id,
           v.image_url${ocrCol}
      FROM (
        SELECT STRAIGHT_JOIN v.id AS variant_id
          FROM facebook_ad_variants AS v FORCE INDEX (idx_image_url_status_facebook_ad_id)
          INNER JOIN facebook_ad AS a ON a.id = v.facebook_ad_id
         WHERE v.image_url_status = ?
           AND v.facebook_ad_id >= ?
           AND a.type = 'IMAGE'
         ORDER BY v.facebook_ad_id DESC
         LIMIT ${batchSize}
      ) AS t
      INNER JOIN facebook_ad_variants AS v ON v.id = t.variant_id
     ORDER BY v.facebook_ad_id DESC`;
  return rows(await exec.query(sql, [status, minAdId]));
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
  // A non-latin1 char or an over-long value in an OCR/OCB column fails the whole UPDATE
  // (STRICT_TRANS_TABLES) → 401 "Image Object not updated". ES still gets the full text.
  fitOcrColumns(data, OCR_COL_LIMITS);
  const cols = Object.keys(data);
  if (!cols.length) return 0;
  const sql = `UPDATE facebook_ad_variants SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE facebook_ad_id = ?`;
  return affected(await exec.query(sql, [...Object.values(data), adId]));
}

module.exports = {
  leaseImageAds,
  getMinAdIdSince,
  leaseImageAdsFromId,
  updateStatusByAdIds,
  getVariantByAdId,
  updateVariant,
};
