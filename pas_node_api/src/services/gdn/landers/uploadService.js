'use strict';

/**
 * GDN landers — upload_gdn_blackhat (BlackhatController@uploadBlackhatContent).
 *
 * Stores the lander screenshot (`media`) and HTML bundle (`zip`) in NAS via the
 * shared insertion nasClient.storeInNas (BLACKHAT for status=1, WHITEHAT for
 * status=2 — same as PHP). multer (disk storage) has already written each file to a
 * temp path; we upload then unlink.
 *
 * Response matches the PHP: { code, message, image_path?, html_path? } — the
 * screenshot comes back under `image_path` and the zip under `html_path`.
 */

const fs = require('fs');
const { storeInNas } = require('../../../insertion/helpers/nasClient');

const NETWORK = 'gdn';

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
      const gdnId = req.body?.ad_id;
      const folder = folderForStatus(status);
      const ts = Math.floor(Date.now() / 1000);

      if (media) {
        tempPaths.push(media.path);
        if (folder) {
          const baseName = `${gdnId}_${country}_${status}_${ts}_media`;
          response.image_path = await storeInNas(folder, media.path, gdnId, NETWORK, baseName);
        }
      }

      if (zip) {
        tempPaths.push(zip.path);
        if (folder) {
          const baseName = `${gdnId}_${country}_${status}_${ts}_zip`;
          response.html_path = await storeInNas(folder, zip.path, gdnId, NETWORK, baseName);
        }
      }

      response.code = 200;
      response.message = 'files are stored successfully';
    } else {
      response.code = 404;
      response.message = 'no file found';
    }
  } catch (e) {
    log?.error?.('landers.uploadBlackhatContent failed', { error: e.message, stack: e.stack });
    response.code = 400;
    response.message = e.message;
  } finally {
    for (const p of tempPaths) safeUnlink(p);
  }

  return response;
}

module.exports = { uploadBlackhatContent };
