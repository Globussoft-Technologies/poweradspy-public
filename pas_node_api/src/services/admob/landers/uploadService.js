'use strict';

const fs = require('fs');
const nasService = require('../../../landers/helpers/nasService');
const repo = require('./repository');

function parseStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) ? status : null;
}

function folderName(status) {
  if (status === 1) return 'BLACKHAT';
  if (status === 2) return 'WHITEHAT';
  return null;
}

async function uploadAdmobBlackhatContent(req, db, log) {
  const response = {};
  const files = req.files || {};
  const media = files.media && files.media[0];
  const zip = files.zip && files.zip[0];
  const requestAdId = req.body?.ad_id == null ? '' : String(req.body.ad_id).trim();
  const status = parseStatus(req.body?.status);
  const country = req.body?.country_iso ?? req.body?.country ?? '';
  const folder = folderName(status);

  const tempPaths = [];
  try {
    if (!media && !zip) {
      return { code: 404, message: 'no file found' };
    }

    if (!folder) {
      return { code: 400, message: 'status must be 1 (blackhat) or 2 (whitehat)' };
    }

    if (!requestAdId) {
      return { code: 400, message: 'ad_id is required' };
    }

    if (!db?.sql) {
      return { code: 503, message: 'The AdMob MySQL connection is unavailable.' };
    }

    // Mirror primary AdMob media storage: NAS keys should be based on the PAS
    // internal id, not the public crawler ad_id, so stored lander paths stay
    // aligned with image_url/image_url_original handling and do not leak ad_id.
    const adRow = await repo.getAdByLanderApiId(db.sql, requestAdId);
    if (!adRow?.id) {
      return { code: 400, message: 'ad not found' };
    }
    const internalId = Number(adRow.id);

    if (media) {
      tempPaths.push(media.path);
      response.image_path = await nasService.uploadToNAS(media.path, internalId, status, 'admob');
    }

    if (zip) {
      tempPaths.push(zip.path);
      response.html_path = await nasService.uploadToNAS(zip.path, internalId, status, 'admob');
    }

    response.code = 200;
    response.message = 'files are stored successfully';
    response.country = country;
    response.id = internalId;
    return response;
  } catch (error) {
    log?.error?.('admob.landers.uploadBlackhatContent failed', { ad_id: requestAdId, error: error.message });
    return {
      code: 400,
      message: 'Error occured in the function uploadBlackhatContent',
    };
  } finally {
    for (const tempPath of tempPaths) {
      try {
        if (tempPath && fs.existsSync(tempPath)) {
          await nasService.deleteTempFile(tempPath);
        }
      } catch {
        // Temp-file cleanup should never block the HTTP response.
      }
    }
  }
}

module.exports = { uploadAdmobBlackhatContent };
