'use strict';

/**
 * Reddit insertion — post owner upsert + deferred image upload.
 */

const repo = require('./repository');
const media = require('../../../insertion/helpers/mediaUpload');

/**
 * Upsert the post_owner row (without image URL).
 * Called within the transaction.
 */
async function upsertPostOwner(tx, ad, userId, log) {
  const poRes = await repo.upsertPostOwner(tx, {
    post_owner_name: ad.post_owner || 'Unknown',
  });
  const postOwnerId = poRes.postOwnerId;
  log?.info('Post owner upserted', { postOwnerId, postOwnerName: ad.post_owner });
  return poRes;
}

/**
 * Upload post owner image and persist the NAS path.
 * Called AFTER transaction commit, on the pool connection.
 */
async function saveOwnerImage(sql, postOwnerId, imageUrl, network) {
  if (!imageUrl || String(imageUrl).trim() === '') return null;
  const result = await media.uploadPostOwner(imageUrl, postOwnerId, network);
  const nasPath = result.post_owner_image;
  if (nasPath === media.DEFAULT_IMAGE) return null;

  try {
    await repo.updatePostOwnerImagePath(sql, postOwnerId, nasPath);
    console.log(`✅ Post owner image updated: ${nasPath}`);
  } catch (err) {
    console.error(`❌ Failed to update post owner image path:`, err.message);
  }
  return nasPath;
}

/**
 * Update post owner image path in the database.
 */
async function updatePostOwnerImagePath(tx, postOwnerId, imagePath) {
  return await repo.updatePostOwnerImagePath(tx, postOwnerId, imagePath);
}

module.exports = { upsertPostOwner, saveOwnerImage, updatePostOwnerImagePath };
