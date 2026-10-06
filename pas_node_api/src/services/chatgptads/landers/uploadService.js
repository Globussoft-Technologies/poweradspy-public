'use strict';

/**
 * ChatGPT Ads landers — uploadFileToServer.
 *
 * Mirrors facebook/landers/uploadService.js: store the lander screenshot (`media`) and
 * HTML bundle (`zip`) in NAS.
 *
 * The multipart files are parsed by multer (disk storage) before this runs, so each
 * file is already a temp file on disk. We upload it to NAS via the shared `storeInNas`
 * helper (folder BLACKHAT for status=1, WHITEHAT for status=2), then unlink the temp file.
 * NAS key base: `{ad_id}_{country}_{status}_{ts}`; the zip gets a `_zip` suffix so it can
 * never share a key with the screenshot, e.g. /pas-dev/stream/gpt/whiteHatAd/202610/63_in_2_1791193138_zip.zip
 *
 * Difference from facebook: the screenshot and zip paths are returned separately
 * (image_path / html_path) instead of the zip overwriting image_path.
 *
 * Response shape: { code, message, image_path?, html_path? }.
 */

const fs = require('fs');
const { storeInNas } = require('../../../insertion/helpers/nasClient');

const NETWORK = 'chatgptads';

function folderForStatus(status) {
  const s = String(status);
  if (s === '1') return 'BLACKHAT'; // blackhat ad
  if (s === '2') return 'WHITEHAT'; // whitehat ad
  return null;
}

function safeUnlink(p) {
  try {
    if (p && fs.existsSync(p)) fs.unlinkSync(p);
  } catch { /* ignore */ }
}

async function uploadFileToServer(req, log) {
  const response = {};
  const files = req.files || {};
  const media = files.media && files.media[0];
  const zip = files.zip && files.zip[0];

  const tempPaths = [];
  try {
    if (media || zip) {
      const country = req.body?.country;
      const status = req.body?.status;
      const adId = req.body?.ad_id;
      const folder = folderForStatus(status);
      const ts = Math.floor(Date.now() / 1000);
      const baseName = `${adId}_${country}_${status}_${ts}`;

      if (media) {
        tempPaths.push(media.path);
        if (folder) {
          response.image_path = await storeInNas(folder, media.path, adId, NETWORK, baseName);
        }
      }

      if (zip) {
        tempPaths.push(zip.path);
        if (folder) {
          response.html_path = await storeInNas(folder, zip.path, adId, NETWORK, `${baseName}_zip`);
        }
      }

      response.code = 200;
      response.message = 'files are stored successfully';
    } else {
      response.code = 404;
      response.message = 'no file found';
    }
  } catch (e) {
    log?.error?.('chatgptads.landers.uploadFileToServer failed', { error: e.message });
    response.code = 400;
    response.message = 'Error occured in the function uploadFileToServer';
  } finally {
    // Always clean up the temp files multer wrote to disk.
    for (const p of tempPaths) safeUnlink(p);
  }

  return response;
}

module.exports = { uploadFileToServer };
