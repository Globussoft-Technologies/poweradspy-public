'use strict';

/**
 * Instagram shared post-owner upsert (mirrors the Facebook helper, instagram repo).
 *   - NEW owner      → insert row, then upload image + set image_updated.
 *   - EXISTING owner → bump ads_count, set verified, re-upload image when provided.
 * Row upsert (DB) and image upload (network) are split so the upload can run AFTER
 * commit, in parallel with the ad-media upload.
 */

const repo = require('./repository');
const media = require('../../../insertion/helpers/mediaUpload');
const { toInt } = require('../../../insertion/helpers/util');

const verifiedFlag = (n) => (n.verified === 1 || n.verified === '1' ? 1 : 0);

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
 * @param {Object} tx
 * @param {Object} n        - normalized ad (uses post_owner, post_owner_image, verified)
 * @param {string} network  - 'instagram'
 * @param {Object} [opts]   - { skipImage } defer the image upload to after commit
 * @returns {Promise<number>} post_owner id
 */
async function upsertPostOwner(tx, n, network, opts = {}) {
  // instagram_ad.post_owner_id is a NOT NULL FK with no id=0 sentinel, so even an owner-less ad
  // must resolve to a real row — fall back to a '(none)' placeholder owner.
  const ownerName = n.post_owner || '(none)';
  const existing = await repo.getPostOwner(tx, ownerName); // PHP dedups by post_owner_name
  const verified = verifiedFlag(n);

  let ownerId;
  if (existing.code !== 200) {
    ownerId = await repo.insertPostOwner(tx, {
      post_owner_name: ownerName,
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

  if (!opts.skipImage) await saveOwnerImage(tx, ownerId, n.post_owner_image, network);
  return ownerId;
}

module.exports = { upsertPostOwner, saveOwnerImage };
