'use strict';

/**
 * getImageUrlService — fetches Pinterest image ads queued for OCR/OCB processing
 * and marks them in-progress (image_url_status = 2).
 *
 * Faithful port of PHP UserController@getImagesUrl.
 *   status 0 → pending OCB (object / celebrity / brand) jobs
 *   status 4 → pending OCR (text) jobs (also returns image_ocr column)
 *
 * Follows the native OCR shape: takes `db` + `log`, derives `db.sql`,
 * delegates all SQL to ./repository.
 */

const repo = require('../repository');
const { resolveMediaUrl } = require('../../../../insertion/helpers/nasClient');

const IN_PROGRESS_STATUS = 2;

/**
 * Build the absolute image URL from a possibly-relative stored value.
 * Takes the segment before the first "||" (multi-image variants) and resolves it
 * through the shared NAS media base (nasClient) these files were uploaded to.
 * Already-absolute URLs are left untouched.
 *
 * (Collapses the PHP's two bases — env AWS_URL for normal paths, env API_URL for
 * "/image/" paths — into the single shared NAS media base, exactly as the native
 * OCR migration does; Pinterest insertion uploads via the same nasClient.)
 */
function resolveImageUrl(imageUrl) {
  if (!imageUrl) return imageUrl;
  const variable = imageUrl.includes('||')
    ? imageUrl.slice(0, imageUrl.indexOf('||'))
    : imageUrl;
  return resolveMediaUrl(variable);
}

/**
 * @param {Object} db     - service.db ({ sql, mongo, elastic })
 * @param {number} status - request status (0 = OCB queue, 4 = OCR queue)
 * @param {Object} [log]
 * @returns {{code:number,message:string,data:Array}}
 */
async function getImageUrl(db, status, log) {
  const sql = db?.sql;
  if (!sql) {
    return { code: 401, message: 'No More Image are present', data: [] };
  }

  const withOcr = status === 4;
  // image_url_status filter follows PHP: status 0 → 0, status 4 → 4.
  const imageUrlStatus = status === 4 ? 4 : 0;

  const result = await repo.getImagesUrl(sql, imageUrlStatus, withOcr);
  if (!result.length) {
    return { code: 400, message: 'No More Image are present', data: [] };
  }

  // Resolve relative image URLs to absolute (via nasClient).
  const data = result.map((row) => ({
    ...row,
    image_url: resolveImageUrl(row.image_url),
  }));

  // Mark the fetched ads as in-progress so they are not handed out again.
  const adIds = data.map((row) => row.ad_id).filter((id) => id !== undefined && id !== null);
  if (adIds.length) {
    await repo.updateStatusMultiple(sql, adIds, IN_PROGRESS_STATUS);
  }

  return { code: 200, message: 'Image Url fetched successfully', data };
}

module.exports = { getImageUrl, resolveImageUrl };
