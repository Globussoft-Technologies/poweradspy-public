'use strict';

/**
 * Shared post-owner upsert (used by both metaAds and adsLibrary pipelines).
 *
 * Faithful to PHP adsdata() post_owner handling (lines 464-621):
 *   - NEW owner      → insert, then upload post_owner_image and set image_updated.
 *   - EXISTING owner → bump ads_count, set verified, AND (when an image is provided)
 *                      RE-UPLOAD the image, refreshing post_owner_image / image_updated.
 *
 * For speed, the row upsert (DB) and the image upload (slow network) are split:
 *   - upsertPostOwner(tx, n, network, {skipImage:true}) writes only the row (fast, in tx).
 *   - saveOwnerImage(exec, ownerId, imageUrl, network) uploads + updates the image,
 *     and can run AFTER commit, in parallel with the ad-media upload.
 */

const repo = require('./repository');
const media = require('../../../insertion/helpers/mediaUpload');
const { toInt } = require('../../../insertion/helpers/util');

function verifiedFlag(n) {
  return n.verified === 1 || n.verified === '1' ? 1 : 0;
}

/** Upload the post-owner image to NAS and persist post_owner_image / image_updated. */
async function saveOwnerImage(exec, ownerId, imageUrl, network) {
  if (!imageUrl) return null;
  const up = await media.uploadPostOwner(imageUrl, ownerId, network).catch(() => null);
  const stored = up && up.post_owner_image;
  if (!stored) return null;
  const image_updated = String(stored).includes('DefaultImage') ? 0 : 1;
  await repo.updatePostOwner(exec, { post_owner_image: stored, image_updated }, ownerId).catch(() => {});
  return { post_owner_image: stored, image_updated };
}

/**
 * @param {Object} tx       - transaction executor
 * @param {Object} n        - normalized ad payload (uses post_owner, post_owner_image, verified)
 * @param {string} network  - e.g. 'facebook'
 * @param {Object} [opts]
 * @param {boolean} [opts.skipImage] - when true, only the row is written; caller uploads the
 *                                     image later via saveOwnerImage (lets it run after commit).
 * @returns {Promise<number>} post_owner id
 */
async function upsertPostOwner(tx, n, network, opts = {}) {
  const lower = String(n.post_owner ?? '').toLowerCase();
  const existing = await repo.getPostOwner(tx, lower);
  const verified = verifiedFlag(n);

  let ownerId;
  if (existing.code !== 200) {
    ownerId = await repo.insertPostOwner(tx, {
      post_owner_name: n.post_owner,
      post_owner_image: n.post_owner_image,
      original_post_owner_image: n.post_owner_image,
      ads_count: 1,
      verified,
    });
  } else {
    ownerId = existing.data[0].id;
    const update = { ads_count: toInt(existing.data[0].ads_count) + 1, verified };
    if (n.post_owner_image) update.original_post_owner_image = n.post_owner_image;
    await repo.updatePostOwner(tx, update, ownerId);
  }

  // Inline image upload only when the caller did not opt to defer it.
  if (!opts.skipImage) await saveOwnerImage(tx, ownerId, n.post_owner_image, network);
  return ownerId;
}

module.exports = { upsertPostOwner, saveOwnerImage };
