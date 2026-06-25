'use strict';

/**
 * Reddit adsData pipeline — port of RedditUserController::redditAdsData().
 * Handles one ad and returns { code, message, data? }.
 *
 * DB writes for INSERT happen inside ONE transaction and are committed together.
 * ES indexing + ADGPT run after commit.
 */

const config = require('../../../config');
const repo = require('./repository');
const { validateRedditAds } = require('./validate');
const { normalizeRedditAds, checkVersion, parseOtherMultimedia } = require('./normalize');
const { buildSearchMixDoc } = require('./esDocBuilder');
const api = require('../../../insertion/helpers/apiClients');
const media = require('../../../insertion/helpers/mediaUpload');
const { toInt } = require('../../../insertion/helpers/util');
const { ok, rejected, serverError } = require('../../../insertion/helpers/responses');
const { upsertPostOwner, saveOwnerImage } = require('./postOwner');

const ES_INDEX = 'reddit_search_mix';

async function processRedditAd(ad, ctx) {
  const { db, log, network = 'reddit' } = ctx;
  const sql = db.sql;

  if (!sql) {
    return serverError(503, 'Database connection is not available, so the ad could not be saved.');
  }

  // 1. Guard: ad_id and reddit_id required
  if (!ad.ad_id || String(ad.ad_id).trim() === '') {
    return rejected(400, 'Missing ad_id — every ad must carry a unique ad_id.', {
      field: 'ad_id',
      hint: 'Add the platform ad_id to the payload and resend.',
    });
  }

  if (!ad.reddit_id || String(ad.reddit_id).trim() === '') {
    return rejected(400, 'Missing reddit_id — every ad must carry a reddit_id.', {
      field: 'reddit_id',
      hint: 'Add the reddit_id to the payload and resend.',
    });
  }

  // 2. Validation
  const v = validateRedditAds(ad);
  if (v.code !== 200) return v;

  // 3. Version checks
  const versionErr = checkVersion(ad.platform, ad.version);
  if (versionErr) return versionErr;

  // 4. Normalize
  const normalized = normalizeRedditAds(ad);

  try {
    // 5. Parallel pre-TX lookups
    const [userRes, existing, translation] = await Promise.all([
      repo.getUserByRedditId(sql, ad.reddit_id),
      repo.getAdByAdId(sql, ad.ad_id),
      api.translate({
        call_to_action: ad.call_to_action ?? '',
        text: ad.ad_text ?? '',
        title: ad.ad_title ?? '',
        newsfeed_description: ad.news_feed_description ?? '',
      }),
    ]);

    if (userRes.code !== 200) {
      return rejected(401, 'Current reddit_id not found.', {
        field: 'reddit_id',
        hint: 'Ensure the reddit_id exists in the system.',
      });
    }

    const userId = userRes.data[0].id;

    if (!translation.ok && config.insertion.api.translationRequired) {
      return serverError(503, 'The language-translation service is unavailable.', {
        hint: 'Please retry shortly.',
      });
    }

    const translationData = translation.ok ? translation.data : null;

    // 6. Branch: INSERT or UPDATE
    if (existing.code === 400) {
      return await insertRedditAd(sql, db, normalized, userId, translationData, ctx);
    } else {
      const internalId = existing.data[0].id;
      return await updateRedditAd(sql, db, normalized, internalId, translationData, ctx);
    }
  } catch (err) {
    log?.error('Error processing Reddit ad', {
      error: err.message,
      stack: err.stack,
      adId: ad.ad_id,
    });
    return serverError(500, 'An error occurred while processing the ad.', { error: err.message });
  }
}

async function insertRedditAd(sql, db, ad, userId, translationData, ctx) {
  const { log } = ctx;

  const result = await repo.withTransaction(sql, async (tx) => {
    // Disable FK checks during transaction (matches Quora pattern)
    await tx.query('SET FOREIGN_KEY_CHECKS=0');

    try {
      // Upsert post owner (without image)
      const poRes = await upsertPostOwner(tx, ad, userId, log);
      const postOwnerId = poRes.postOwnerId;

    // Insert main ad row (minimal fields - only what's required)
    const now = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const nowDt = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;

    const adRow = {
      ad_id: ad.ad_id || null,
      discoverer_user_id: userId,
      type: String(ad.type).toUpperCase(),
      post_date: nowDt,
      first_seen: nowDt,
      last_seen: nowDt,
      created_date: nowDt,
      post_owner_id: postOwnerId,
      ad_position: ad.ad_position || null,
      source: ad.source || null,
      category_id: 1,
    };

    const redditAdId = await repo.insertRedditAd(tx, adRow);
    if (!redditAdId) {
      const e = new Error(`This ad_id "${ad.ad_id}" already exists (duplicate).`);
      e.insertionCode = 402;
      e.insertionHint = 'No action needed unless you expected an update — the ad is already stored.';
      throw e;
    }

    // Upload image/thumbnail and get NAS path (BEFORE inserting variant, like PHP does)
    let nasImagePath = null;
    if (ad.type === 'VIDEO') {
      const thumbnailUrl = ad.thumbnail_url || ad.image_video_url;
      if (thumbnailUrl) {
        try {
          const uploadResult = await media.uploadThumbnail(thumbnailUrl, redditAdId, 'reddit');
          nasImagePath = uploadResult.image_video_url;
          console.log(`✅ Uploaded thumbnail for VIDEO ad ${redditAdId}: ${nasImagePath}`);
        } catch (err) {
          console.warn(`⚠️ Thumbnail upload failed for ad ${redditAdId}: ${err.message}`);
        }
      }
    } else if (ad.type === 'IMAGE') {
      const imageUrl = ad.image_video_url || ad.image_url;
      if (imageUrl) {
        try {
          const uploadResult = await media.uploadImage(imageUrl, redditAdId, 'reddit');
          nasImagePath = uploadResult.nas_path;
          console.log(`✅ Uploaded image for ad ${redditAdId}: ${nasImagePath}`);
        } catch (err) {
          console.warn(`⚠️ Image upload failed for ad ${redditAdId}: ${err.message}`);
        }
      }
    }

    // Insert variant row WITH the image_url
    const variantId = await repo.insertRedditAdVariants(tx, {
      reddit_ad_id: redditAdId,
      title: ad.ad_title || null,
      text: ad.ad_text || null,
      newsfeed_description: ad.news_feed_description || null,
      image_url_original: ad.image_video_url || null,
      image_url: nasImagePath || null,
    });

    // Update default variant back-reference
    await repo.updateRedditAd(tx, { default_variant_id: variantId }, redditAdId);

    // Insert meta data (only if destination_url exists)
    if (ad.destination_url) {
      await repo.insertMetaData(tx, {
        reddit_ad_id: redditAdId,
        ad_url: ad.ad_url || null,
        destination_url: ad.destination_url,
        built_with: ad.built_with || null,
        built_with_analytics_tracking: ad.built_with_analytics_tracking || null,
      });
    }

    // Insert translation
    if (translationData) {
      await repo.upsertTranslation(tx, {
        reddit_ad_id: redditAdId,
        news_feed_description: translationData.newsfeed_description ?? ad.news_feed_description,
        ad_title: translationData.title ?? ad.ad_title,
        ad_text: translationData.text ?? ad.ad_text,
      });
    }

      return { redditAdId, variantId, postOwnerId };
    } finally {
      // Re-enable FK checks after transaction
      await tx.query('SET FOREIGN_KEY_CHECKS=1').catch(() => null);
    }
  });

  // After commit: media uploads run in PARALLEL
  const [, mediaPaths] = await Promise.all([
    saveOwnerImage(sql, result.postOwnerId, ad.post_owner_image, 'reddit').catch(() => null),
    uploadAdMedia(sql, ad, result.redditAdId, result.variantId, 'reddit'),
  ]);
  result.mediaPaths = mediaPaths;

  // ES index + ADGPT (non-transactional)
  await indexAd(ctx, result.redditAdId).catch((e) => log?.warn('ES index failed', { error: e.message }));

  const warning = media.mediaIssueWarning(mediaPaths, ad.type);
  return ok(result.redditAdId, 'Ad inserted successfully', warning ? { warning } : {});
}

async function uploadAdMedia(sql, ad, redditAdId, variantId, network, existingImageUrl) {
  const mediaPaths = {};

  if (ad.type === 'VIDEO') {
    const thumbnailUrl = ad.thumbnail_url || ad.image_video_url || existingImageUrl;
    if (thumbnailUrl) {
      try {
        const result = await media.uploadThumbnail(thumbnailUrl, redditAdId, network);
        const nasPath = result.image_video_url;
        mediaPaths.image_url = nasPath;

        if (nasPath && nasPath !== media.DEFAULT_IMAGE) {
          const updateResult = await sql.query(
            'UPDATE reddit_ad_variants SET image_url = ? WHERE reddit_ad_id = ?',
            [nasPath, redditAdId]
          );
          const affectedRows = updateResult && Array.isArray(updateResult) && updateResult[0]?.affectedRows;
          if (affectedRows === 0) {
            await repo.insertRedditAdVariants(sql, {
              reddit_ad_id: redditAdId,
              image_url: nasPath,
              image_url_original: ad.image_video_url || null,
            });
            console.log(`✅ Ad variant created with thumbnail: ${nasPath}`);
          } else if (affectedRows > 0) {
            console.log(`✅ Ad thumbnail updated: ${nasPath}`);
          }
        }
      } catch (err) {
        console.error(`❌ Failed to upload thumbnail:`, err.message);
      }
    }
  } else if (ad.type === 'IMAGE') {
    const imageUrl = ad.image_video_url || ad.image_url || existingImageUrl;
    if (imageUrl) {
      try {
        const result = await media.uploadImage(imageUrl, redditAdId, network);
        const nasPath = result.nas_path;
        mediaPaths.image_url = nasPath;

        if (nasPath && nasPath !== media.DEFAULT_IMAGE) {
          const updateResult = await sql.query(
            'UPDATE reddit_ad_variants SET image_url = ? WHERE reddit_ad_id = ?',
            [nasPath, redditAdId]
          );
          const affectedRows = updateResult && Array.isArray(updateResult) && updateResult[0]?.affectedRows;
          if (affectedRows === 0) {
            await repo.insertRedditAdVariants(sql, {
              reddit_ad_id: redditAdId,
              image_url: nasPath,
              image_url_original: existingImageUrl || null,
            });
            console.log(`✅ Ad variant created with image: ${nasPath}`);
          } else if (affectedRows > 0) {
            console.log(`✅ Ad image updated: ${nasPath}`);
          }
        }
      } catch (err) {
        console.error(`❌ Failed to update ad image path:`, err.message);
      }
    }
  }

  // ── Carousel / other_multimedia: upload each extra image/video to NAS and
  // persist the JSON array into reddit_ad_image_video. ES (getJoinedAd → indexAd)
  // already reads ad_image_video and emits it as reddit_ad_image_video.othermedia.
  // Faithful to legacy RedditUserController (other_multimedia → upload_multiple_*).
  const adTypeUpper = String(ad.type).toUpperCase();
  const om = parseOtherMultimedia(ad.other_multimedia);
  if (om.present && (adTypeUpper === 'IMAGE' || adTypeUpper === 'VIDEO')) {
    try {
      const mm = await media.uploadMultimedia(om.images, adTypeUpper, redditAdId, network);
      await repo.upsertAdImageVideo(sql, {
        reddit_ad_id: redditAdId,
        ad_type: adTypeUpper,
        ad_image_video: mm.ad_image_video,
      });
      mediaPaths.multimedia = mm.ad_image_video;
      console.log(`✅ Stored ${om.images.length} other_multimedia item(s) for ad ${redditAdId}`);
    } catch (err) {
      console.error(`❌ Failed to upload other_multimedia for ad ${redditAdId}:`, err.message);
    }
  }

  return mediaPaths;
}

async function updateRedditAd(sql, db, ad, redditAdId, translationData, ctx) {
  const { log } = ctx;

  await repo.withTransaction(sql, async (tx) => {
    const now = new Date();
    const p = (n) => String(n).padStart(2, '0');
    const nowDt = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;

    await repo.updateRedditAd(tx, {
      type: String(ad.type).toUpperCase(),
      last_seen: nowDt,
      ad_position: ad.ad_position || null,
    }, redditAdId);

    await repo.updateRedditAdVariants(tx, {
      title: ad.ad_title || null,
      text: ad.ad_text || null,
      newsfeed_description: ad.news_feed_description || null,
      image_url_original: ad.image_video_url || null,
    }, redditAdId);

    if (ad.destination_url) {
      await repo.updateMetaData(tx, {
        destination_url: ad.destination_url,
        built_with: ad.built_with || null,
        built_with_analytics_tracking: ad.built_with_analytics_tracking || null,
      }, redditAdId);
    }

    if (translationData) {
      await repo.upsertTranslation(tx, {
        reddit_ad_id: redditAdId,
        news_feed_description: translationData.newsfeed_description ?? ad.news_feed_description,
        ad_title: translationData.title ?? ad.ad_title,
        ad_text: translationData.text ?? ad.ad_text,
      });
    }
  });

  // After commit: get current data and upload media
  const adData = await repo.getJoinedAd(sql, redditAdId);
  if (adData.code !== 200) return serverError(500, 'Ad not found after update');

  const { default_variant_id: variantId, post_owner_id: postOwnerId, image_url: existingThumbnail, image_url_original: existingVideoUrl, type: adType } = adData.data[0];

  // For VIDEO ads, use existing THUMBNAIL; for IMAGE ads, use image_url_original
  const existingMediaUrl = adType === 'VIDEO' ? existingThumbnail : existingVideoUrl;

  // Upload BOTH post owner + ad images in parallel
  await Promise.all([
    saveOwnerImage(sql, postOwnerId, ad.post_owner_image, 'reddit').catch(() => null),
    uploadAdMedia(sql, ad, redditAdId, variantId, 'reddit', existingMediaUrl).catch(() => null),
  ]);

  // Re-index in ES with fresh data
  await indexAd(ctx, redditAdId).catch((e) => log?.warn('ES index failed', { error: e.message }));

  return ok(redditAdId, 'Ad updated successfully');
}

async function indexAd(ctx, redditAdId) {
  const { db, log } = ctx;
  const adRes = await repo.getJoinedAd(db.sql, redditAdId);
  if (adRes.code !== 200) {
    log?.warn('Ad not found for ES indexing', { redditAdId });
    return;
  }

  const adRow = adRes.data[0];
  const doc = buildSearchMixDoc(adRow);

  // Find and delete ALL old documents for this ad
  try {
    const searchRes = await db.elastic.search({
      index: ES_INDEX,
      body: {
        query: {
          bool: {
            should: [
              { term: { 'reddit_ad.id': redditAdId } },
              { term: { 'reddit_ad_id': redditAdId } },
            ],
          },
        },
      },
      size: 100,
    }).catch(() => ({ hits: { hits: [] } }));

    // Delete each old document by its ID
    const hits = searchRes?.hits?.hits || [];
    for (const hit of hits) {
      if (hit._id !== String(redditAdId)) {
        await db.elastic.delete({
          index: ES_INDEX,
          id: hit._id,
        }).catch(() => null);
      }
    }
    if (hits.length > 0) console.log(`✅ Deleted ${hits.length} old ES document(s) for ad ${redditAdId}`);
  } catch (err) {
    log?.warn('Failed to clean old ES documents', { error: err.message });
  }

  // Index the new document with nested structure
  await db.elastic.index({
    index: ES_INDEX,
    id: String(redditAdId),
    body: doc.body,
  }).catch((e) => log?.warn('ES index error', { error: e.message }));

  console.log(`✅ Re-indexed ad ${redditAdId} with new NAS path`);
}

module.exports = { processRedditAd };
