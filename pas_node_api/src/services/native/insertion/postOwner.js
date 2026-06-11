'use strict';

/**
 * Native post-owner upsert — mirrors the Facebook postOwner.js pattern.
 * Row upsert (fast, in tx) is separate from image upload (slow, post-commit).
 */

const repo  = require('./repository');
const media = require('../../../insertion/helpers/mediaUpload');

async function saveOwnerImage(exec, ownerId, imageUrl, network) {
  if (!imageUrl) return null;
  const up = await media.uploadPostOwner(imageUrl, ownerId, network).catch(() => null);
  const stored = up && up.post_owner_image;
  if (!stored) return null;
  const image_updated = String(stored).includes('DefaultImage') ? 0 : 1;
  await repo.updatePostOwner(exec, { post_owner_image: stored, image_updated }, ownerId).catch(() => {});
  return { post_owner_image: stored, image_updated };
}

async function upsertPostOwner(tx, n, network, opts = {}) {
  const lower = String(n.post_owner ?? '').toLowerCase();
  const existing = await repo.getPostOwner(tx, lower);

  let ownerId;
  if (existing.code !== 200) {
    // NEW post owner
    const hasImage = n.post_owner_image && n.post_owner_image !== '';
    ownerId = await repo.insertPostOwner(tx, {
      post_owner_name:  n.post_owner,
      post_owner_image: hasImage ? n.post_owner_image : '/DefaultImage.jpg',
      ads_count:        1,
      image_updated:    hasImage ? 1 : 0,
    });
  } else {
    // EXISTING post owner — bump ads_count, optionally refresh image
    ownerId = existing.data[0].id;
    const update = { ads_count: (existing.data[0].ads_count ?? 0) + 1 };
    if (n.post_owner_image) {
      update.post_owner_image = n.post_owner_image;
      update.image_updated    = 1;
    }
    await repo.updatePostOwner(tx, update, ownerId);
  }

  if (!opts.skipImage) await saveOwnerImage(tx, ownerId, n.post_owner_image, network);
  return ownerId;
}

module.exports = { upsertPostOwner, saveOwnerImage };
