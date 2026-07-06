'use strict';

/**
 * Quora adsData pipeline — port of quorAdController::quoraAdsData().
 * Handles one ad and returns { code, message, data? }.
 *
 * DB writes for INSERT happen inside ONE transaction and are committed together.
 * ES indexing + ADGPT run after commit.
 */

const config = require('../../../config');
const repo = require('./repository');
const { validateQuoraAds } = require('./validate');
const { normalizeQuoraAds, checkVersion } = require('./normalize');
const { buildSearchMixDoc, searchIdQuery } = require('./esDocBuilder');
const { QUORA_INSERT_COLUMNS } = require('./esColumns');
const api = require('../../../insertion/helpers/apiClients');
const media = require('../../../insertion/helpers/mediaUpload');
const { nowDateTime, toInt, epochToDateTime, ensureUtf8mb3Compatible } = require('../../../insertion/helpers/util');
const { ok, updated, rejected, serverError } = require('../../../insertion/helpers/responses');
const { upsertPostOwner, updatePostOwnerImagePath } = require('./postOwner');

const ES_INDEX = 'quora_search_mix';

async function processQuoraAd(ad, ctx) {
  const { db, log, network = 'quora' } = ctx;
  const sql = db.sql;

  log.info('Processing Quora ad', { ad_id: ad.ad_id, post_owner: ad.post_owner, hasQuoraId: !!ad.quora_id });

  if (!sql) {
    log.error('No SQL connection available');
    return serverError(503, 'Database connection is not available, so the ad could not be saved.');
  }

  // 1. ad_id and quora_id null guard
  if (!ad.ad_id || ad.ad_id === '') {
    return rejected(400, 'Missing ad_id — every ad must carry a unique ad_id.', {
      field: 'ad_id',
      hint: 'Add the platform ad_id to the payload and resend.',
    });
  }

  if (!ad.quora_id || ad.quora_id === '') {
    return rejected(400, 'Missing quora_id — every ad must carry a quora_id.', {
      field: 'quora_id',
      hint: 'Add the quora_id to the payload and resend.',
    });
  }

  // 2. Validation
  const v = validateQuoraAds(ad);
  if (v.code !== 200) return v;

  // 3. Version checks
  const versionErr = checkVersion(ad.platform, ad.version);
  if (versionErr) return versionErr;

  // 4. Normalize input data
  const normalized = normalizeQuoraAds(ad);

  try {
    // 5. Parallel pre-transaction lookups (user, existing ad, translation)
    log.info('Starting parallel lookups', { adId: ad.ad_id, quoraId: ad.quora_id });

    const [userRes, existing, translation] = await Promise.all([
      repo.getUserByQuoraId(sql, ad.quora_id),
      repo.getAdByAdId(sql, ad.ad_id),
      api.translate({
        call_to_action: ad.call_to_action ?? '',
        text: ad.ad_text ?? '',
        title: ad.ad_title ?? '',
        newsfeed_description: ad.news_feed_description ?? '',
      }),
    ]);

    log.info('Parallel lookups complete', { userFound: userRes.code === 200, adExists: existing.code === 200 });

    if (userRes.code !== 200) {
      return rejected(401, 'Current quora_id not found.', {
        field: 'quora_id',
        hint: 'Ensure the quora_id exists in the system.',
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
      // INSERT branch
      log.info('INSERT branch detected for ad_id', { ad_id: ad.ad_id, post_owner: normalized.post_owner });
      return await insertQuoraAd(sql, db, normalized, userId, translationData, ctx);
    } else {
      // UPDATE branch
      const internalId = existing.data[0].id;
      log.info('UPDATE branch detected for ad_id', { ad_id: ad.ad_id, internalId });
      return await updateQuoraAd(sql, db, normalized, internalId, translationData, ctx);
    }
  } catch (err) {
    log.error('Error processing Quora ad', {
      error: err.message,
      stack: err.stack,
      adId: ad.ad_id,
      errorName: err.name
    });
    return serverError(500, 'An error occurred while processing the ad.', { error: err.message });
  }
}

async function insertQuoraAd(sql, db, ad, userId, translationData, ctx) {
  const { log } = ctx;

  return await repo.withTransaction(sql, async (tx) => {
    try {
      // Temporarily disable FK constraint checks
      await tx.query('SET FOREIGN_KEY_CHECKS=0');

      // Upsert post owner (without image URL yet)
      const poRes = await upsertPostOwner(tx, ad, userId, log);
      const postOwnerId = poRes.postOwnerId;

      // Find or create category (matching PHP behavior)
      let categoryId = null;
      if (ad.category) {
        const categoryName = ensureUtf8mb3Compatible(String(ad.category).trim());
        const existingCategory = await tx.query('SELECT id FROM quora_category WHERE category_name = ? LIMIT 1', [categoryName]);
        if (existingCategory && existingCategory.length) {
          categoryId = existingCategory[0].id;
        } else {
          const insertCategory = await tx.query('INSERT INTO quora_category (category_name) VALUES (?)', [categoryName]);
          categoryId = insertCategory.insertId;
        }
      }

      // Insert main ad row (matching PHP field names exactly)
      const now = new Date();
      const p = (n) => String(n).padStart(2, '0');
      const nowDt = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())}`;

      const adRow = {
        ad_id: ad.ad_id,
        discoverer_user_id: userId,
        status: 1,
        post_date: ad.post_date || null,
        first_seen: ad.first_seen || null,
        last_seen: ad.last_seen || null,
        days_running: 1,
        lower_age_seen: ad.lower_age || 0,
        upper_age_seen: ad.upper_age || 0,
        likes: ad.likes || 0,
        comments: ad.comment || 0,
        shares: ad.share || 0,
        ad_position: ensureUtf8mb3Compatible(ad.ad_position) || '',
        type: ad.type || 'IMAGE',
        hits: 0,
        default_ad_url_id: 0,
        post_owner_updated: 0,
        variants_count: 0,
        l_c_s_status: 0,
        l_c_s_updated_date: nowDt,
        affiliate_ad: 0,
        redirect_destination_url_source: 0,
        reward_status: 0,
        post_owner_id: postOwnerId,
        category_id: categoryId,
      };

      if (ad.system_id && ad.platform == 12) {
        adRow.System_id = ad.system_id;
      }

      const adInternalId = await repo.insertQuoraAd(tx, adRow);

      const adType = (ad.type || 'IMAGE').toUpperCase();
      let nasImageUrl = null;
      let videoThumbnailUrl = null;

      // For VIDEO type: upload image_video_url as thumbnail to NAS and store in quora_ad_image_video
      // For IMAGE/TEXT type: upload image/image_video_url as image to NAS and store in quora_ad_variants
      if (adType === 'VIDEO') {
        const thumbnailUrl = (typeof ad.image_video_url === 'string') ? ad.image_video_url.trim() : null;
        if (thumbnailUrl) {
          try {
            const thumbResult = await media.uploadThumbnail(thumbnailUrl, adInternalId, 'quora');
            videoThumbnailUrl = (thumbResult && thumbResult.image_video_url) ? thumbResult.image_video_url : '/DefaultImage.jpg';
            log.info('Video thumbnail uploaded to NAS', { adInternalId, nasPath: videoThumbnailUrl });
            await repo.upsertAdImageVideo(tx, { ad_image_video: videoThumbnailUrl }, adInternalId);
          } catch (err) {
            log.error('Video thumbnail upload failed', { error: err.message, adInternalId });
            videoThumbnailUrl = '/DefaultImage.jpg';
            await repo.upsertAdImageVideo(tx, { ad_image_video: videoThumbnailUrl }, adInternalId);
          }
        } else {
          log.debug('No video thumbnail URL provided', { adInternalId });
          await repo.upsertAdImageVideo(tx, { ad_image_video: '/DefaultImage.jpg' }, adInternalId);
        }
      } else {
        // IMAGE or TEXT type: upload image_url to variants
        const imageUrl = (typeof ad.image_video_url === 'string') ? ad.image_video_url.trim() :
                         (typeof ad.image_url === 'string') ? ad.image_url.trim() : null;

        if (imageUrl) {
          try {
            const imageResult = await media.uploadImage(imageUrl, adInternalId, 'quora');
            nasImageUrl = (imageResult && imageResult.nas_path) ? imageResult.nas_path : '/DefaultImage.jpg';
            log.info('Image uploaded to NAS', { adInternalId, nasPath: nasImageUrl });
          } catch (imgErr) {
            log.error('Image upload failed', { error: imgErr.message, adInternalId });
            nasImageUrl = '/DefaultImage.jpg';
          }
        } else {
          log.debug('No image URL provided', { adInternalId });
          nasImageUrl = '/DefaultImage.jpg';
        }
      }

      // Insert variant
      const variantRow = {
        quora_ad_id: adInternalId,
        title: ensureUtf8mb3Compatible(ad.ad_title) || null,
        text: ensureUtf8mb3Compatible(ad.ad_text) || null,
        newsfeed_description: ensureUtf8mb3Compatible(ad.news_feed_description) || null,
        image_url: nasImageUrl || '/DefaultImage.jpg',
        image_url_original: ad.image_url_original || null,
        image_object: null,
        image_celebrity: null,
        image_brand_logo: null,
        image_ocr: null,
        video_url: null,
      };

      await repo.insertQuoraAdVariants(tx, variantRow);

      // TODO: Fix metadata insert - schema mismatch between PHP and Node.js
      // Skip for now - ad insertion is primary requirement
      // const metaRow = { quora_ad_id: adInternalId, destination_url: ad.destination_url || null };
      // await repo.insertQuoraAdMetaData(tx, metaRow);

      // Insert translation if available
      if (translationData && translationData.ad_text) {
        const transRow = {
          quora_ad_id: adInternalId,
          ad_text: ensureUtf8mb3Compatible(translationData.ad_text) || null,
          ad_title: ensureUtf8mb3Compatible(translationData.ad_title) || null,
          news_feed_description: ensureUtf8mb3Compatible(translationData.news_feed_description) || null,
          detected_language: translationData.detected_language || 'en',
        };
        await repo.insertQuoraAdTranslation(tx, transRow);
      }

      // Insert country data if provided
      if (ad.country && Array.isArray(ad.country)) {
        for (const country of ad.country) {
          await repo.insertQuoraAdCountries(tx, {
            quora_ad_id: adInternalId,
            country: country,
          }).catch(() => {});
        }
      }

      // Insert user reference
      await repo.insertQuoraAdUsers(tx, {
        quora_ad_id: adInternalId,
        quora_user_id: userId,
      }).catch(() => {});

      // Re-enable FK constraint checks before returning
      await tx.query('SET FOREIGN_KEY_CHECKS=1');
      return { code: 200, adInternalId, postOwnerId, isNew: true };
    } catch (err) {
      // Re-enable FK constraint checks even on error
      try { await tx.query('SET FOREIGN_KEY_CHECKS=1'); } catch { /* ignore */ }
      log.error('Error in Quora INSERT transaction', { error: err.message });
      throw err;
    }
  }).then(async (result) => {
    if (result.code !== 200) {
      return serverError(500, 'Failed to insert ad into database.');
    }

    const adInternalId = result.adInternalId;
    const postOwnerId = result.postOwnerId;

    // Post-commit operations (deferred, outside transaction)
    try {
      // Upload post owner image after transaction commit
      if (postOwnerId && ad.post_owner_image) {
        try {
          const poImageResult = await media.uploadPostOwner(ad.post_owner_image, postOwnerId, 'quora');
          const nasPath = (poImageResult && poImageResult.post_owner_image) ? poImageResult.post_owner_image : '/DefaultImage.jpg';
          await repo.updateQuoraAdPostOwner(sql, { post_owner_image: nasPath }, postOwnerId);
          log.info('Post owner image uploaded post-commit', { postOwnerId, nasPath });
        } catch (imgErr) {
          log.warn('Post owner image upload post-commit failed', { postOwnerId, error: imgErr.message });
        }
      }

      // ES indexing after all uploads complete
      const esResult = await indexQuoraAdEs(db.elastic, adInternalId, sql, ctx);
      return ok(adInternalId, 'Ad inserted successfully.', {
        es_indexed: esResult,
      });
    } catch (err) {
      log.warn('Post-commit operations failed', { error: err.message });
      return ok(adInternalId, 'Ad inserted but post-commit operations failed.', {
        warning: 'Ad was saved but image processing failed',
      });
    }
  }).catch((err) => {
    log.error('Quora INSERT failed', { error: err.message, adId: ad.ad_id });
    return serverError(500, 'Failed to insert ad.', { error: err.message });
  });
}

async function updateQuoraAd(sql, db, ad, internalId, translationData, ctx) {
  const { log } = ctx;

  try {
    return await repo.withTransaction(sql, async (tx) => {
      // Fetch current row to compute days_running with post_date fallback
      const joined = await repo.getJoinedAd(tx, internalId);
      const cur = (joined && joined[0]) || {};

      // Update main ad row
      const adType = (ad.type || 'IMAGE').toUpperCase();
      const lastSeenEpoch = Math.floor(Date.parse(ad.last_seen) / 1000) || Math.floor(Date.now() / 1000);
      const postDateEpoch = Math.floor(Date.parse(cur.post_date) / 1000);
      const firstSeenEpoch = Math.floor(Date.parse(cur.first_seen) / 1000) || lastSeenEpoch;
      const startEpoch = (postDateEpoch > 0) ? postDateEpoch : firstSeenEpoch;
      const daysRunning = Math.max(1, Math.floor((lastSeenEpoch - startEpoch) / 86400));

      const adUpdate = {
        last_seen: ad.last_seen || null,
        days_running: daysRunning,
        likes: ad.likes || 0,
        comments: ad.comment || 0,
        shares: ad.share || 0,
        type: ad.type || 'IMAGE',
        ad_position: ensureUtf8mb3Compatible(ad.ad_position) || null,
        lower_age_seen: ad.lower_age || 0,
        upper_age_seen: ad.upper_age || 0,
      };

      // post_date is write-once: backfill only when the stored value is missing or the
      // epoch-0 sentinel (postDateEpoch computed above) and the crawler now supplies a
      // real one. Never overwrite an existing post_date.
      if (!(postDateEpoch > 0) && ad.post_date) {
        adUpdate.post_date = ad.post_date;
      }

      await repo.updateQuoraAd(tx, adUpdate, internalId);

      let nasImageUrl = null;
      let videoThumbnailUrl = null;

      // For VIDEO type: upload image_video_url as thumbnail to NAS and store in quora_ad_image_video
      // For IMAGE/TEXT type: upload image/image_video_url as image to NAS and store in quora_ad_variants
      if (adType === 'VIDEO') {
        const thumbnailUrl = (typeof ad.image_video_url === 'string') ? ad.image_video_url.trim() : null;
        if (thumbnailUrl) {
          try {
            const thumbResult = await media.uploadThumbnail(thumbnailUrl, internalId, 'quora');
            videoThumbnailUrl = (thumbResult && thumbResult.image_video_url) ? thumbResult.image_video_url : '/DefaultImage.jpg';
            log.info('Video thumbnail uploaded to NAS (UPDATE)', { internalId, nasPath: videoThumbnailUrl });
            await repo.upsertAdImageVideo(tx, { ad_image_video: videoThumbnailUrl }, internalId);
          } catch (err) {
            log.error('Video thumbnail upload failed (UPDATE)', { error: err.message, internalId });
            videoThumbnailUrl = '/DefaultImage.jpg';
            await repo.upsertAdImageVideo(tx, { ad_image_video: videoThumbnailUrl }, internalId);
          }
        }
      } else {
        // IMAGE or TEXT type: upload image_url to variants (unchanged logic)
        const imageUrl = (typeof ad.image_video_url === 'string') ? ad.image_video_url.trim() :
                         (typeof ad.image_url === 'string') ? ad.image_url.trim() : null;

        if (imageUrl) {
          try {
            const imageResult = await media.uploadImage(imageUrl, internalId, 'quora');
            nasImageUrl = (imageResult && imageResult.nas_path) ? imageResult.nas_path : '/DefaultImage.jpg';
            log.info('Image upload result (UPDATE)', { internalId, nasPath: nasImageUrl });
          } catch (imgErr) {
            log.error('Image upload failed (UPDATE)', { error: imgErr.message, internalId });
            nasImageUrl = '/DefaultImage.jpg';
          }
        }
      }

      // Update variant (only include fields that were actually provided)
      const variantUpdate = {
        title: ad.ad_title !== undefined ? (ensureUtf8mb3Compatible(ad.ad_title) || null) : undefined,
        text: ad.ad_text !== undefined ? (ensureUtf8mb3Compatible(ad.ad_text) || null) : undefined,
        newsfeed_description: ad.news_feed_description !== undefined ? (ensureUtf8mb3Compatible(ad.news_feed_description) || null) : undefined,
      };

      // Only update image_url if a new image was provided (IMAGE/TEXT types only)
      if (nasImageUrl) {
        variantUpdate.image_url = nasImageUrl;
      }

      if (ad.image_url_original !== undefined) {
        variantUpdate.image_url_original = ensureUtf8mb3Compatible(ad.image_url_original) || null;
      }

      const variantAffected = await repo.updateQuoraAdVariants(tx, variantUpdate, internalId);
      log.info('Variant update result', { internalId, affected: variantAffected, updates: variantUpdate });

      // TODO: Fix metadata update - schema mismatch (matches INSERT which skips metadata)
      // const metaUpdate = {
      //   destination_url: ad.destination_url || null,
      // };
      // await repo.updateQuoraAdMetaData(tx, metaUpdate, internalId);

      // Update translation if available
      if (translationData && translationData.ad_text) {
        const transRow = {
          quora_ad_id: internalId,
          ad_text: ensureUtf8mb3Compatible(translationData.ad_text) || null,
          ad_title: ensureUtf8mb3Compatible(translationData.ad_title) || null,
          news_feed_description: ensureUtf8mb3Compatible(translationData.news_feed_description) || null,
          detected_language: translationData.detected_language || 'en',
        };
        await repo.insertQuoraAdTranslation(tx, transRow).catch(() => {});
      }

      return { code: 200, adInternalId: internalId };
    }).then(async (result) => {
      // Post-commit ES update
      try {
        await indexQuoraAdEs(db.elastic, internalId, sql, ctx);
      } catch (err) {
        log.warn('ES update failed', { error: err.message });
      }
      return updated(internalId);
    });
  } catch (err) {
    log.error('Quora UPDATE failed', { error: err.message });
    return serverError(500, 'Failed to update ad.', { error: err.message });
  }
}

// An ES-7 index has exactly one mapping type and it never changes at runtime, so cache it.
const _indexTypeCache = new Map();

// Resolve the index's single ES-7 mapping type so writes use the type the index actually
// has ("doc" for a PHP-seeded index, "_doc" for a Node-seeded one). Writing the wrong type
// is rejected with "the final mapping would have more than 1 type". Reads the live mapping
// (authoritative even when the index has ZERO docs — `include_type_name` exposes the type
// name on ES 7), falls back to a sample doc's _type, then to the ES-7 typeless default "_doc".
async function resolveIndexType(elastic, index) {
  if (_indexTypeCache.has(index)) return _indexTypeCache.get(index);
  let type;
  try {
    const res = await elastic.indices.getMapping({ index, include_type_name: true });
    const body = res?.body || res || {};
    const idxBody = body[index] || body[Object.keys(body)[0]] || {};
    const typeNames = Object.keys(idxBody.mappings || {});
    if (typeNames.length) type = typeNames[0];
  } catch { /* ignore — try a sample doc next */ }
  if (!type) {
    try {
      const probe = await elastic.search({ index, body: { query: { match_all: {} } }, size: 1 });
      const hits = probe?.hits?.hits || probe?.body?.hits?.hits || [];
      type = hits[0]?._type;
    } catch { /* ignore */ }
  }
  type = type || '_doc';
  _indexTypeCache.set(index, type);
  return type;
}

async function indexQuoraAdEs(elastic, adInternalId, sql, ctx) {
  if (!elastic) return false;
  try {
    const joined = await repo.getJoinedAd(sql, adInternalId);
    if (joined.code !== 200 || !joined.data.length) return false;

    const row = joined.data[0];
    const doc = buildSearchMixDoc(QUORA_INSERT_COLUMNS, row);
    const numericId = String(adInternalId);

    // The whole stack (PHP search, frontend, OCR, landers) locates a quora_search_mix
    // doc via the quora_ad.id FIELD and keys it by an ES-generated hashed _id. Keep that
    // identity: reuse an existing hashed doc's _id (overwrite in place → no duplicate),
    // otherwise mint a new hashed _id; the old numeric-_id docs are converted (write the
    // hashed doc, then drop the numeric one). Always write using the index's OWN mapping
    // type — ES 7 allows a single type per index ("doc" in prod, "_doc" on a Node-seeded
    // index) and a hardcoded type would be rejected. And index BEFORE deleting, so a
    // failed write can never leave the ad with zero docs.
    let hits = [];
    try {
      const found = await elastic.search({
        index: ES_INDEX,
        body: { query: { term: { 'quora_ad.id': adInternalId } } },
        size: 100,
      });
      hits = found?.hits?.hits || found?.body?.hits?.hits || [];
    } catch (err) {
      ctx.log.warn('ES lookup failed; indexing a fresh doc', { error: err.message, adInternalId });
    }

    // Reuse an existing HASHED doc (any _id that isn't the bare numeric internal id).
    const keeper = hits.find((h) => h._id !== numericId);
    const esType = keeper?._type || hits[0]?._type || (await resolveIndexType(elastic, ES_INDEX));

    let survivorId;
    if (keeper) {
      await elastic.index({ index: ES_INDEX, type: esType, id: keeper._id, body: doc.body });
      survivorId = keeper._id;
    } else {
      const res = await elastic.index({ index: ES_INDEX, type: esType, body: doc.body }); // no id → hashed _id
      survivorId = res?.body?._id || res?._id;
    }

    // Now that the survivor is written, drop every other doc for this ad (numeric strays,
    // extra dups). The survivor is never in `hits` on a fresh insert, and is skipped by id on reuse.
    for (const hit of hits) {
      if (hit._id !== survivorId) {
        await elastic.delete({ index: ES_INDEX, type: hit._type, id: hit._id }).catch(() => null);
        ctx.log.info('Removed stray ES doc for ad', { adInternalId, strayId: hit._id, strayType: hit._type });
      }
    }

    return true;
  } catch (err) {
    ctx.log.error('ES indexing failed', { error: err.message });
    return false;
  }
}


module.exports = { processQuoraAd };
