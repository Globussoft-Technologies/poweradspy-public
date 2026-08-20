'use strict';

const fs = require('fs');
const { uploadToNAS, deleteTempFile } = require('../../../landers/helpers/nasService');

function parseStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) ? status : null;
}

function folderName(status) {
  if (status === 1) return 'BLACKHAT';
  if (status === 2) return 'WHITEHAT';
  return null;
}

async function uploadAdmobBlackhatContent(req, log) {
  const response = {};
  const files = req.files || {};
  const media = files.media && files.media[0];
  const zip = files.zip && files.zip[0];
  const adId = req.body?.ad_id;
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

    if (media) {
      tempPaths.push(media.path);
      // The shared NAS helper generates a deterministic path per adId/network.
      response.image_path = await uploadToNAS(media.path, adId, status, 'admob');
    }

    if (zip) {
      tempPaths.push(zip.path);
      response.html_path = await uploadToNAS(zip.path, adId, status, 'admob');
    }

    response.code = 200;
    response.message = 'files are stored successfully';
    response.country = country;
    return response;
  } catch (error) {
    log?.error?.('admob.landers.uploadBlackhatContent failed', { error: error.message });
    return {
      code: 400,
      message: 'Error occured in the function uploadBlackhatContent',
    };
  } finally {
    for (const tempPath of tempPaths) {
      try {
        if (tempPath && fs.existsSync(tempPath)) {
          await deleteTempFile(tempPath);
        }
      } catch {
        // Temp-file cleanup should never block the HTTP response.
      }
    }
  }
}

module.exports = { uploadAdmobBlackhatContent };
