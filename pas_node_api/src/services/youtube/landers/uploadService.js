'use strict';

/**
 * YouTube landers — upload_blackhat_image_zip (BlackhatControllerYoutube@uploadBlackhatContent).
 *
 * Stores the lander screenshot (`media`) and HTML bundle (`zip`) in NAS via the shared
 * insertion nasClient.storeInNas (BLACKHAT for status=1, WHITEHAT for status=2). multer
 * (disk storage) wrote each file to a temp path; we upload then unlink. Distinct
 * `_media`/`_zip` key bases so the two files don't overwrite each other.
 *
 * Response matches the PHP: { code, message, image_path?, html_path? }.
 */

const fs = require('fs');
const { storeInNas } = require('../../../insertion/helpers/nasClient');

const NETWORK = 'youtube';

function folderForStatus(status) {
  const s = String(status);
  if (s === '1') return 'BLACKHAT';
  if (s === '2') return 'WHITEHAT';
  return null;
}

function safeUnlink(p) {
  try {
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  } catch { /* ignore */ }
}

async function uploadBlackhatContent(req, log) {
  const response = {};
  const files = req.files || {};
  const media = files.media && files.media[0];
  const zip = files.zip && files.zip[0];

  const tempPaths = [];
  try {
    if (media || zip) {
      const country = req.body?.country;
      const status = req.body?.status;
      const youtubeId = req.body?.ad_id;
      const folder = folderForStatus(status);
      const ts = Math.floor(Date.now() / 1000);

      if (media) {
        tempPaths.push(media.path);
        if (folder) {
          const baseName = `${youtubeId}_${country}_${status}_${ts}_media`;
          response.image_path = await storeInNas(folder, media.path, youtubeId, NETWORK, baseName);
        }
      }

      if (zip) {
        tempPaths.push(zip.path);
        if (folder) {
          const baseName = `${youtubeId}_${country}_${status}_${ts}_zip`;
          response.html_path = await storeInNas(folder, zip.path, youtubeId, NETWORK, baseName);
        }
      }

      response.code = 200;
      response.message = 'files are stored successfully';
    } else {
      response.code = 404;
      response.message = 'no file found';
    }
  } catch (e) {
    log?.error?.('landers.uploadBlackhatContent failed', { error: e.message });
    response.code = 400;
    response.message = e.message;
  } finally {
    for (const p of tempPaths) safeUnlink(p);
  }

  return response;
}

module.exports = { uploadBlackhatContent };
