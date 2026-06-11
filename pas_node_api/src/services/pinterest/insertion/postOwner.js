'use strict';

/**
 * Pinterest post-owner upsert — mirrors native/facebook pattern.
 * PHP uses post_owner_name (not lower case) for lookup.
 */

const repo  = require('./repository');
const media = require('../../../insertion/helpers/mediaUpload');

async function saveOwnerImage(exec, ownerId, imageUrl, network) {
  if (!imageUrl) return null;
  const up = await media.uploadPostOwner(imageUrl, ownerId, network).catch(() => null);
  const stored = up && up.post_owner_image;
  if (!stored) return null;
  await repo.updatePostOwner(exec, { post_owner_image: stored }, ownerId).catch(() => {});
  return { post_owner_image: stored };
}

async function upsertPostOwner(tx, n, network, opts = {}) {
  const existing = await repo.getPostOwner(tx, n.post_owner);

  let ownerId;
  if (existing.code !== 200) {
    ownerId = await repo.insertPostOwner(tx, {
      post_owner_name:  n.post_owner,
      post_owner_image: n.post_owner_image || '/DefaultImage.jpg',
      ads_count:        1,
    });
  } else {
    ownerId = existing.data[0].id;
    const upd = { ads_count: (existing.data[0].ads_count ?? 0) + 1 };
    if (n.post_owner_image) upd.post_owner_image = n.post_owner_image;
    await repo.updatePostOwner(tx, upd, ownerId);
  }

  if (!opts.skipImage) await saveOwnerImage(tx, ownerId, n.post_owner_image, network);
  return ownerId;
}

module.exports = { upsertPostOwner, saveOwnerImage };
