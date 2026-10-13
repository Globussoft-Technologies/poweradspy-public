'use strict';

/**
 * POST /api/v1/imageGen/upload — accepts the user's "Product image" (and any
 * extra reference images) from the Recreate modal, stores it to NAS via the
 * same storeInNas() helper every crawler pipeline uses (see nasClient.js's
 * new PRODUCT subfolder), and returns a servable URL. Ad Studio's generate
 * endpoint only accepts URLs (image_urls), not raw bytes — this is what turns
 * a browser file into something Ad Studio can actually fetch.
 */

const fs = require('fs');
const { storeInNas, resolveMediaUrl, storedPathFromUrl } = require('../../../insertion/helpers/nasClient');
const { queueImageDeletion } = require('../helpers/nasCleanup');
const { ok, rejected, serverError } = require('../helpers/responses');

async function uploadProductImage(req, res) {
  const userId = req.user?.user_id ?? req.user?.id;
  if (!userId) return res.status(401).json(rejected(401, 'Unauthorized.'));

  const file = req.file;
  if (!file) return res.status(422).json(rejected(422, 'No image file was uploaded.'));

  try {
    // userId is its own NAS folder level now (storeInNas inserts it for type
    // PRODUCT — imagegen/<userId>/product/<yearMonth>/<file>), so the filename
    // itself no longer needs to repeat it.
    const keyBaseName = String(Date.now());
    const nasPath = await storeInNas('PRODUCT', file.path, userId, 'imagegen', keyBaseName);
    if (!nasPath || String(nasPath).includes('DefaultImage')) {
      return res.status(502).json(serverError(502, 'Could not store this image right now. Please try again.'));
    }
    return res.json(ok('Uploaded.', { url: resolveMediaUrl(nasPath) }));
  } catch (err) {
    return res.status(500).json(serverError(500, 'Upload failed.', { error: err.message }));
  } finally {
    // storeInNas reads the file synchronously/streams it immediately (small image,
    // in-request upload) — safe to clean up the temp file right after it returns.
    fs.unlink(file.path, () => {});
  }
}

/** DELETE /api/v1/imageGen/upload — removes a reference image the user uploaded
 * in the Recreate modal but then removed before ever submitting a generation
 * with it (so no job doc references it yet). Does NOT delete from NAS inline —
 * just queues it (see nasCleanup.js); imageGenNasCleanupSweep.js does the
 * actual delete later, re-checking it isn't referenced by a job by then either. */
async function deleteUpload(req, res) {
  const db = req.imageGenDb;
  const userId = req.user?.user_id ?? req.user?.id;
  if (!userId) return res.status(401).json(rejected(401, 'Unauthorized.'));

  const url = req.body?.url;
  if (!url || typeof url !== 'string') return res.status(422).json(rejected(422, 'The url field is required.'));

  // Ownership check via the NAS key itself — imagegen uploads are keyed
  // imagegen/<userId>/product/... (nasClient.js's storeInNas PRODUCT branch) —
  // so a user can only ever queue deletion of their OWN uploads.
  const storedPath = storedPathFromUrl(url);
  const escapedUserId = String(userId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const ownKeyPattern = new RegExp(`^/[^/]+/stream/imagegen/${escapedUserId}/product/`);
  if (!storedPath || !ownKeyPattern.test(storedPath)) {
    return res.status(403).json(rejected(403, 'This image does not belong to you.'));
  }

  await queueImageDeletion(db, [url], userId);
  return res.json(ok('Queued for deletion.'));
}

module.exports = { uploadProductImage, deleteUpload };
