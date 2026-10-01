'use strict';

/**
 * ChatGPT Ads — shared post-owner upsert (mirrors facebook's postOwner.js shape, trimmed to
 * what this network's schema actually has — no `verified`/`original_post_owner_image`
 * columns in chatgptads_ad_post_owners, since the real payload has no `verified` field).
 *
 * Row upsert (fast, in-tx) and image upload (slow network) are split so the image upload
 * can run AFTER commit, in parallel with the ad-media upload — same reasoning as facebook's.
 */

const repo = require('./repository');
const media = require('../../../insertion/helpers/mediaUpload');

/** Upload the post-owner image to NAS and persist post_owner_image. */
async function saveOwnerImage(exec, ownerId, imageUrl, network) {
  if (!imageUrl) return null;
  const up = await media.uploadPostOwner(imageUrl, ownerId, network).catch(() => null);
  const stored = up && up.post_owner_image;
  if (!stored) return null;
  await repo.updatePostOwner(exec, { post_owner_image: stored }, ownerId).catch(() => {});
  return { post_owner_image: stored };
}

/**
 * @param {Object} tx - transaction executor
 * @param {Object} n  - normalized ad payload (uses post_owner, post_owner_image)
 * @param {string} network - must be the literal "chatgptads" (the config slug), not the
 *   payload's own "network":"chatgpt" field — see normalize.js's comment on n.network.
 * @param {Object} [opts]
 * @param {boolean} [opts.skipImage] - when true, only the row is written; caller uploads
 *   the image later via saveOwnerImage (lets it run after commit).
 * @returns {Promise<number>} post_owner id
 */
async function upsertPostOwner(tx, n, network, opts = {}) {
  const lower = String(n.post_owner ?? '').toLowerCase();
  const existing = await repo.getPostOwner(tx, lower);

  let ownerId;
  if (existing.code !== 200) {
    ownerId = await repo.insertPostOwner(tx, {
      post_owner_name: n.post_owner,
      post_owner_image: n.post_owner_image ?? null,
      ads_count: 1,
    });
  } else {
    ownerId = existing.data[0].id;
    await repo.updatePostOwner(tx, { ads_count: (existing.data[0].ads_count || 0) + 1 }, ownerId);
  }

  if (!opts.skipImage) await saveOwnerImage(tx, ownerId, n.post_owner_image, network);
  return ownerId;
}

module.exports = { upsertPostOwner, saveOwnerImage };
