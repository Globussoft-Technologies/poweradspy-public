'use strict';

/**
 * Facebook landers — uploadFileToServer.
 *
 * Faithful port of BlackHatController@uploadFileToServer (api app): store the lander
 * screenshot (`media`) and HTML bundle (`zip`) in NAS.
 *
 * The multipart files are parsed by multer (disk storage) before this runs, so each
 * file is already a temp file on disk. We upload it to NAS via the shared
 * `storeInNas` helper (folder BLACKHAT for status=1, WHITEHAT for status=2 — exactly
 * as PHP did), then unlink the temp file. The NAS key base mirrors the PHP filename
 * `{ad_id}_{country}_{status}_{ts}` (StoreInNAS2 always stores it as `.jpg`).
 *
 * Response shape matches PHP: { code, message, image_path? }.
 */

const fs = require('fs');
const { storeInNas } = require('../../../insertion/helpers/nasClient');

const NETWORK = 'facebook';

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
      const facebookId = req.body?.ad_id;
      const folder = folderForStatus(status);
      const ts = Math.floor(Date.now() / 1000);

      if (media) {
        tempPaths.push(media.path);
        if (folder) {
          const baseName = `${facebookId}_${country}_${status}_${ts}`;
          response.image_path = await storeInNas(folder, media.path, facebookId, NETWORK, baseName);
        }
      }

      if (zip) {
        tempPaths.push(zip.path);
        if (folder) {
          const baseName = `${facebookId}_${country}_${status}_${ts}`;
          response.image_path = await storeInNas(folder, zip.path, facebookId, NETWORK, baseName);
        }
      }

      response.code = 200;
      response.message = 'files are stored successfully';
    } else {
      response.code = 404;
      response.message = 'no file found';
    }
  } catch (e) {
    log?.error?.('landers.uploadFileToServer failed', { error: e.message });
    response.code = 400;
    response.message = 'Error occured in the function uploadFileToServer';
  } finally {
    // Always clean up the temp files multer wrote to disk (mirrors PHP unlink()).
    for (const p of tempPaths) safeUnlink(p);
  }

  return response;
}

module.exports = { uploadFileToServer };
