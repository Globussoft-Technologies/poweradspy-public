'use strict';

const fs = require('fs').promises;
const path = require('path');
const { storeInNas } = require('../../../insertion/helpers/nasClient');

const QR_INDEX = process.env.QR_ELASTIC_INDEX || 'quora_search_mix';
const EXPECTED_NETWORK = 'quora';

const MIME_TO_EXT = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
};
const IMAGE_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'];

/** Read the ES update result across client major versions (v7 wraps in `body`). */
function esResult(res) {
  return res?.result || res?.body?.result || null;
}

/** Best-effort image extension from the upload's mimetype, then its original filename. */
function resolveImageExt(file) {
  const mime = String(file.mimetype || '').toLowerCase();
  if (MIME_TO_EXT[mime]) return MIME_TO_EXT[mime];
  const origExt = path.parse(file.originalname || '').ext.replace(/^\./, '').toLowerCase();
  if (IMAGE_EXTS.includes(origExt)) return origExt;
  return 'jpg';
}

/** True when the upload looks like an image (mimetype OR filename extension). */
function looksLikeImage(file) {
  const mime = String(file.mimetype || '').toLowerCase();
  if (mime.startsWith('image/')) return true;
  // Raw binary posts often arrive as octet-stream / empty — allow them through.
  if (mime === 'application/octet-stream' || mime === '') return true;
  const origExt = path.parse(file.originalname || '').ext.replace(/^\./, '').toLowerCase();
  return IMAGE_EXTS.includes(origExt);
}

/**
 * POST /api/v1/quora/ads/update-nas-image
 *
 * Stores an uploaded image binary in NAS as the video THUMBNAIL (under the ad's id,
 * thumbnail/ subfolder → .../stream/quora/thumbnail/<YYYYMM>/<id>.<ext>) and writes
 * that NAS path into the ad's `new_nas_image_url` field in Elasticsearch
 * (`quora_search_mix`), replacing the "/DefaultImage.jpg" placeholder. The frontend
 * renders the Quora video poster from `new_nas_image_url`, so the path is recorded
 * there even though the file lives in the thumbnail/ folder.
 *
 * Body (multipart/form-data):
 *   - ad_id:   internal quora_ad id (required)
 *   - network: must equal "quora" — a safety guard so the wrong network's
 *              worker can't write here (required)
 *   - image:   the image file/binary (required)
 *
 * Returns the stored NAS path and how many ES docs were updated.
 */
async function updateNasImage(req, db, logger) {
  const adId = req.body?.ad_id ?? req.query?.ad_id;
  const network = String(req.body?.network ?? req.query?.network ?? '').trim().toLowerCase();
  const file = req.file; // multer .single('image')

  // Track the current temp path (it gets renamed to add an extension) so every
  // exit path can clean it up.
  let tempPath = file?.path || null;
  const cleanup = async () => { if (tempPath) { await fs.unlink(tempPath).catch(() => {}); tempPath = null; } };

  // ── Validation ──
  if (!adId) { await cleanup(); return { code: 400, message: 'Missing required field: ad_id' }; }
  if (!network) { await cleanup(); return { code: 400, message: 'Missing required field: network' }; }
  if (network !== EXPECTED_NETWORK) {
    await cleanup();
    return { code: 400, message: `Invalid network '${network}': this endpoint only serves '${EXPECTED_NETWORK}'` };
  }
  if (!file || !file.path) return { code: 400, message: 'Missing image binary (multipart field name: image)' };
  if (!looksLikeImage(file)) { await cleanup(); return { code: 415, message: 'Uploaded file is not an image' }; }
  if (!db.elastic) { await cleanup(); return { code: 503, message: 'Elasticsearch connection not available' }; }

  try {
    // multer's disk storage saves the temp file WITHOUT an extension, but storeInNas
    // derives the stored file's extension from the path — so give the temp file a real
    // image extension first, otherwise new_nas_image_url would end in a bare ".".
    const ext = resolveImageExt(file);
    const withExt = `${file.path}.${ext}`;
    await fs.rename(file.path, withExt);
    tempPath = withExt;

    // 1. Store the image in NAS as the video THUMBNAIL → path like
    //    /<bucket>/stream/quora/thumbnail/<YYYYMM>/<adId>.<ext> (the video-poster
    //    folder). We still record this path in `new_nas_image_url` below, because the
    //    frontend reads the Quora video poster from that field — not the ES `thumbnail`
    //    field — so writing there is what actually makes the poster render.
    const nasPath = await storeInNas('THUMBNAIL', withExt, adId, EXPECTED_NETWORK, String(adId));
    await cleanup();

    if (!nasPath || String(nasPath).includes('DefaultImage')) {
      logger.error('Quora NAS image store failed', { adId, nasPath });
      return { code: 502, message: 'Image could not be stored in NAS', data: { ad_id: adId, new_nas_image_url: nasPath || null } };
    }

    const index = db.elastic.indexName || QR_INDEX;

    // 2. Locate the ES doc(s) for this ad. `quora_search_mix` can hold duplicate
    //    docs per ad (PHP hash _id vs Node numeric _id), so match & update ALL.
    const search = await db.elastic.search({
      index,
      body: { query: { term: { 'quora_ad.id': Number(adId) } }, size: 100, _source: false },
    });
    const hits = search?.hits?.hits || search?.body?.hits?.hits || [];
    if (hits.length === 0) {
      return { code: 404, message: 'Ad not found in Elasticsearch', data: { ad_id: adId, new_nas_image_url: nasPath } };
    }

    // 3. Overwrite new_nas_image_url on every matching doc.
    let updated = 0;
    for (const hit of hits) {
      const res = await db.elastic.update({
        index,
        type: 'doc',
        id: hit._id,
        body: { doc: { new_nas_image_url: nasPath }, detect_noop: false },
      });
      const r = esResult(res);
      if (r === 'updated' || r === 'noop') updated++;
    }

    logger.info('Quora new_nas_image_url updated from uploaded image', { adId, nasPath, docsMatched: hits.length, docsUpdated: updated });
    return {
      code: 200,
      message: 'Image stored in NAS and new_nas_image_url updated successfully',
      data: { ad_id: adId, new_nas_image_url: nasPath, docs_matched: hits.length, docs_updated: updated },
    };
  } catch (err) {
    await cleanup();
    logger.error('Error in updateNasImage (quora)', { error: err.message, stack: err.stack, adId });
    return { code: 500, message: 'Error storing image / updating new_nas_image_url', error: err.message };
  }
}

module.exports = { updateNasImage };
