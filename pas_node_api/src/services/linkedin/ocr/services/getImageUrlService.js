'use strict';

/**
 * LinkedIn OCR/OCB — getImagesUrl (lease work).
 *
 * Faithful port of api_linkedin UserController@getImagesUrl, the handler behind
 * `GET get-linkedin-image-url`. Hands out up to 20 IMAGE ads queued for processing,
 * resolves each image_url to an absolute NAS URL, and marks the batch in-progress
 * (image_url_status = 2) so the next call does not hand out the same ads.
 *
 *   status 0 → OCB queue (object / celebrity / brand) — selects ad_id, image_url
 *   status 4 → OCR queue (text)                        — also selects image_ocr
 *                                                        (from linkedin_ad_ocr_ocb_details)
 *
 * Like GDN, the LinkedIn lease has NO 10-day last_seen window. Returns
 * { code, message, data, exe_time } — HTTP is always 200; the outcome is body `code`.
 *
 * Image-URL resolution: the PHP split relative paths between env(AWS_URL) and
 * env(API_URL) (the latter only when the path contains "/image/"). Modern SFTP-written
 * paths are `/<bucket>/stream/linkedin/adImage/...` (no "/image/", not absolute), so they
 * all take the AWS_URL branch — i.e. a single media base. We resolve via the shared
 * `resolveMediaUrl` (config.insertion.nas.mediaUrl), identical to the Facebook / GDN /
 * YouTube OCR migrations; absolute (http/https) values are returned unchanged.
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
    log?.error?.('linkedin.ocr.getImagesUrl failed', { error: e.message });
    return { code: 401, message: 'No More Image are present', data: [], exe_time: exeTime() };
  }
}

module.exports = { leaseImages };
