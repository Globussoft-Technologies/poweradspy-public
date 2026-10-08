'use strict';

/**
 * Facebook OCR/OCB — getImageUrl (lease work).
 *
 * Faithful port of Userv2Controller@getImageUrl (api app), the handler behind
 * `GET getFBImageUrl`. Hands out up to 20 IMAGE ads queued for processing, resolves
 * each image_url to an absolute URL, and marks the batch in-progress
 * (image_url_status = 2) so the next call does not hand out the same ads.
 *
 *   status 0 → OCB queue (object / celebrity / brand) — selects ad_id, image_url
 *   status 4 → OCR queue (text)                        — also selects image_ocr
 *
 * Returns { code, message, data, exe_time } — HTTP is always 200; the real outcome
 * is the body `code` (preserves the PHP contract so existing scrapers keep working).
 *
 * Which lease query runs (config.json facebookOcr, read per call so a config
 * reload applies without a restart):
 *   - leaseWindowDays + leaseBatchSize set → id-window lease: ads created in the last
 *     leaseWindowDays (as a minimum facebook_ad.id, cached leaseMinIdCacheMs).
 *   - either unset/invalid, the min-id lookup fails/finds nothing, or the id-window
 *     query fails (e.g. MAX_EXECUTION_TIME) → the 10-day last_seen lease, so the
 *     OCB/OCR queue keeps flowing exactly as before.
 */

const config = require('../../../../config');
const { resolveMediaUrl } = require('../../../../insertion/helpers/nasClient');
const repo = require('../repository');

const IN_PROGRESS = 2;

// leaseWindowDays → { minAdId, at }. Per process; refreshed after leaseMinIdCacheMs.
const minAdIdCache = new Map();

async function resolveMinAdId(sql, windowDays, cacheMs) {
  const hit = minAdIdCache.get(windowDays);
  if (hit && cacheMs > 0 && Date.now() - hit.at < cacheMs) return hit.minAdId;
  const minAdId = await repo.getMinAdIdSince(sql, windowDays);
  if (minAdId > 0) minAdIdCache.set(windowDays, { minAdId, at: Date.now() });
  return minAdId;
}

/** Id-window lease when configured; otherwise (or on any failure) the 10-day lease. */
async function leaseRows(sql, log, statusNum, withOcr) {
  const { leaseWindowDays, leaseBatchSize, leaseMaxExecutionMs, leaseMinIdCacheMs } =
    config.facebookOcr || {};

  if (Number.isInteger(leaseWindowDays) && leaseWindowDays > 0 &&
      Number.isInteger(leaseBatchSize) && leaseBatchSize > 0) {
    try {
      const minAdId = await resolveMinAdId(sql, leaseWindowDays, leaseMinIdCacheMs);
      if (minAdId > 0) {
        const windowRows = await repo.leaseImageAdsFromId(sql, statusNum, withOcr, {
          minAdId,
          batchSize: leaseBatchSize,
          maxExecutionMs: leaseMaxExecutionMs,
        });
        // Empty window → still try the 10-day lease: it also covers ads created
        // before the window but seen recently, which the old flow handed out.
        if (windowRows.length) return windowRows;
      } else {
        log?.error?.('facebook.ocr.getImageUrl no ad in lease window; using 10-day lease', {
          leaseWindowDays,
        });
      }
    } catch (e) {
      log?.error?.('facebook.ocr.getImageUrl id-window lease failed; using 10-day lease', {
        error: e.message,
        status: statusNum,
      });
    }
  }

  return repo.leaseImageAds(sql, statusNum, withOcr, leaseMaxExecutionMs);
}

/**
 * Resolve a stored image_url to an absolute URL: take the segment before the first
 * `||` (multi-image variants), then resolve relative paths onto the NAS media base.
 */
function resolveImageUrl(stored) {
  if (stored === null || stored === undefined) return stored;
  const s = String(stored);
  const variable = s.includes('||') ? s.slice(0, s.indexOf('||')) : s;
  return resolveMediaUrl(variable);
}

async function leaseImages(db, log, status) {
  const started = Date.now();
  const sql = db?.sql;
  const exeTime = () => (Date.now() - started) / 1000;

  try {
    if (!sql) {
      return { code: 401, message: 'No More Image are present', data: [], exe_time: exeTime() };
    }

    const statusNum = Number(status);
    const withOcr = statusNum === 4;

    const result = await leaseRows(sql, log, statusNum, withOcr);

    if (!result.length) {
      return { code: 400, message: 'No More Image are present', data: [], exe_time: exeTime() };
    }

    for (const row of result) {
      row.image_url = resolveImageUrl(row.image_url);
    }

    // Mark the whole leased batch in-progress so it is not handed out again.
    const adIds = result.map((r) => r.ad_id);
    await repo.updateStatusByAdIds(sql, adIds, IN_PROGRESS);

    return {
      code: 200,
      message: 'Image Url fetched successfully',
      data: result,
      exe_time: exeTime(),
    };
  } catch (e) {
    log?.error?.('facebook.ocr.getImageUrl failed', { error: e.message });
    return { code: 401, message: 'No More Image are present', data: [], exe_time: exeTime() };
  }
}

/** Test hook: forget cached window min-ids. */
function resetMinAdIdCache() {
  minAdIdCache.clear();
}

module.exports = { leaseImages, resetMinAdIdCache };
