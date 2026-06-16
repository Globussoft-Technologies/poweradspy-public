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
 */

const { resolveMediaUrl } = require('../../../../insertion/helpers/nasClient');
const repo = require('../repository');

const IN_PROGRESS = 2;

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

    const result = await repo.leaseImageAds(sql, statusNum, withOcr);

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

module.exports = { leaseImages };
