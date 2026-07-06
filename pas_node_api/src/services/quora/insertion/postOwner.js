'use strict';

/**
 * Quora insertion — post-owner upsert logic.
 * Mirrors Facebook: check by post_owner_name, insert or increment ads_count.
 * Image upload is deferred (after commit).
 */

const repo = require('./repository');
const { ensureUtf8mb3Compatible, latin1Safe } = require('../../../insertion/helpers/util');

async function upsertPostOwner(exec, ad, userId, log) {
  // quora_ad_post_owners.post_owner_name is a latin1 column, so a name carrying a
  // char outside latin1 (e.g. "WeJñān" — the ā is U+0101) makes mysql2 throw
  // 'Conversion from collation utf8mb4_unicode_ci into latin1_swedish_ci impossible
  // for parameter' on BOTH the WHERE lookup and the INSERT, rolling back the whole ad.
  // Strip the out-of-latin1 code points up front so the value binds cleanly (documented
  // latin1 stopgap; the lossless fix is ALTERing the column to utf8mb4).
  const postOwnerName = ad.post_owner ? latin1Safe(ad.post_owner.trim()) : '';
  log && log.info('upsertPostOwner called', { postOwnerName, hasPostOwner: !!ad.post_owner, adPostOwner: ad.post_owner });

  if (!postOwnerName) {
    log && log.warn('Post owner name is empty, skipping insert');
    return {
      code: 200,
      postOwnerId: null,
      isNew: false,
    };
  }

  // Check if post owner already exists
  const existing = await repo.getPostOwnerByName(exec, postOwnerName);

  if (existing.code === 200 && existing.data.length) {
    // Update ads_count only — DO NOT change post owner image
    // (Post owner image is shared; once set, it stays the same per PHP behavior)
    const current = existing.data[0];
    const newCount = (current.ads_count || 0) + 1;
    await repo.updateQuoraAdPostOwner(exec, { ads_count: newCount }, current.id);
    log && log.info('Post owner exists, updated ads_count', { postOwnerId: current.id, newCount });
    return {
      code: 200,
      postOwnerId: current.id,
      isNew: false,
    };
  }

  // Insert new post owner (without image URL — will be uploaded post-commit)
  const data = {
    post_owner_name: ensureUtf8mb3Compatible(postOwnerName),
    post_owner_image: null,
    original_post_owner_image: null,
    ads_count: 1,
    image_updated: 0,
  };

  const id = await repo.insertQuoraAdPostOwner(exec, data);
  log && log.info('Post owner inserted', { postOwnerId: id, postOwnerName });
  return {
    code: 200,
    postOwnerId: id,
    isNew: true,
  };
}

/**
 * Upload post-owner image and update DB with NAS path (synchronously, within transaction).
 * Matches PHP behavior: insert → upload → update with NAS path
 */
async function updatePostOwnerImagePath(exec, postOwnerId, imageUrl, network, media, log) {
  if (!imageUrl || imageUrl.trim() === '') {
    return '/DefaultImage.jpg';
  }

  try {
    const result = await media.uploadPostOwner(imageUrl, postOwnerId, network);
    const nasPath = (result && result.post_owner_image) ? result.post_owner_image : '/DefaultImage.jpg';

    // Update the post_owner_image with NAS path (within transaction)
    await repo.updateQuoraAdPostOwner(exec, { post_owner_image: nasPath }, postOwnerId);
    log && log.info('Post owner image uploaded and updated', { postOwnerId, nasPath });

    return nasPath;
  } catch (err) {
    log && log.warn('Failed to upload post owner image', { postOwnerId, error: err.message });
    return '/DefaultImage.jpg';
  }
}

module.exports = { upsertPostOwner, updatePostOwnerImagePath };
