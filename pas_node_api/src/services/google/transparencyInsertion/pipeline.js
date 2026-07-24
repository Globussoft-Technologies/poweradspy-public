'use strict';

const repo = require('./repository');
const config = require('../../../config');
const api = require('../../../insertion/helpers/apiClients');
const { validateTransparencyPayload } = require('./validate');
const { normalizeTransparencyPayload, mysqlDateTime, daysRunning } = require('./normalize');
const { buildTransparencyDoc } = require('./esDocBuilder');
const { createTransparencyTrace } = require('./trace');
const { searchIdQuery, firstHitSource } = require('../insertion/esDocBuilder');
const media = require('../../../insertion/helpers/mediaUpload');
const { enqueueVideoDownload } = require('../../../insertion/helpers/nasDownloadQueue');
const { ok, updated, serverError } = require('../../../insertion/helpers/responses');

function validStoredPath(value) {
  return typeof value === 'string' && value.trim() !== '' && !value.includes('DefaultImage');
}

function mediaCategoryFromUrl(value) {
  try {
    const pathname = new URL(value).pathname;
    return /\.(?:mp4|mov|webm|m4v|avi|mkv|mpeg|mpg|3gp|ogv)$/i.test(pathname)
      ? 'video'
      : 'image';
  } catch {
    return 'image';
  }
}

function parseNasOtherMultimedia(value, sourceUrls = []) {
  let list = value;
  if (typeof list === 'string') {
    try { list = JSON.parse(list); } catch { list = []; }
  }
  if (!Array.isArray(list)) return [];
  return list.map((item, index) => {
    if (typeof item === 'string') {
      return { source_url: sourceUrls[index] || null, nas_path: item };
    }
    return {
      source_url: item?.source_url || sourceUrls[index] || null,
      nas_path: item?.nas_path || null,
    };
  }).filter((item) =>
    item.source_url &&
    item.nas_path !== item.source_url &&
    validStoredPath(item.nas_path)
  );
}

function uploadedMultimediaPaths(result) {
  if (!result?.ad_image_video) return [];
  try {
    const parsed = JSON.parse(result.ad_image_video);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function hasTranslationContent(translation) {
  return ['title', 'text', 'newsfeed_description'].some((field) =>
    typeof translation?.[field] === 'string' && translation[field].trim() !== ''
  );
}

function earlierSql(left, right) {
  if (!left) return mysqlDateTime(right);
  if (!right) return mysqlDateTime(left);
  return new Date(left).getTime() <= new Date(right).getTime() ? mysqlDateTime(left) : mysqlDateTime(right);
}

function laterSql(left, right) {
  if (!left) return mysqlDateTime(right);
  if (!right) return mysqlDateTime(left);
  return new Date(left).getTime() >= new Date(right).getTime() ? mysqlDateTime(left) : mysqlDateTime(right);
}

function sqlDateToRfc3339(value) {
  if (!value) return null;
  const sqlValue = mysqlDateTime(value);
  return sqlValue ? `${sqlValue.replace(' ', 'T')}Z` : null;
}

function deliveryRowsToContract(rows) {
  return (rows || []).map((row) => ({
    country: row.country,
    country_code: row.country_code,
    first_seen: sqlDateToRfc3339(row.first_seen),
    last_seen: sqlDateToRfc3339(row.last_seen),
    times_shown: row.impressions_operator ? {
      min: row.impressions_min,
      max: row.impressions_max,
      operator: row.impressions_operator,
    } : null,
  }));
}

async function processTransparencyAd(payload, ctx) {
  const trace = createTransparencyTrace(ctx.log, payload, ctx);
  trace('REQUEST_RECEIVED', {
    platform: payload?.platform,
    type: payload?.type,
    subnetwork: payload?.subnetwork,
    payload_fields: payload && typeof payload === 'object' ? Object.keys(payload) : [],
  });
  const validation = validateTransparencyPayload(payload);
  if (validation.code !== 200) {
    trace('VALIDATION_REJECTED', { code: validation.code, errors: validation.errors });
    return validation;
  }
  trace('VALIDATION_PASSED', { contract_version: payload.version });
  if (!ctx.db.sql) {
    trace('SQL_UNAVAILABLE');
    return serverError(503, 'Database connection is not available, so the ad could not be saved.');
  }

  const data = {
    ...normalizeTransparencyPayload(payload),
    // NAS policy is server-owned. Scrapers cannot enable/disable media writes
    // through the insertion payload.
    nasPolicy: {
      image: config.insertion.nas.store.image === true,
      video: config.insertion.nas.store.video === true,
    },
  };
  trace('PAYLOAD_NORMALIZED', {
    sql_projection: {
      post_date: data.postDateSql,
      first_seen: data.firstSeenSql,
      last_seen: data.lastSeenSql,
      ad_position: data.adPosition,
      subnetwork: data.subnetwork,
      domain: data.domain,
    },
    country_count: data.country.length,
    country_delivery_count: data.countryDetailsSql.length,
    other_multimedia_count: data.othermultimedia.length,
  });
  trace('TRANSLATION_API_REQUEST', {
    endpoint_configured: Boolean(config.insertion.api.translationUrl),
    title: data.ad_title || '',
    text: data.ad_text || '',
    newsfeed_description: '',
  });
  const translationResult = await api.translate({
    call_to_action: '',
    text: data.ad_text || '',
    title: data.ad_title || '',
    newsfeed_description: '',
  });
  if (!translationResult.ok && config.insertion.api.translationRequired) {
    trace('TRANSLATION_API_FAILED_REQUIRED', {
      error: translationResult.error,
      sql_started: false,
    });
    return serverError(503, 'Translation/language detection service is unavailable, so the ad was not saved.', {
      error: translationResult.error,
      hint: 'Check LANGUAGE_TRANSLATION_API, or set insertion.api.translationRequired=false only for an intentional best-effort environment.',
    });
  }
  const rawTranslation = translationResult.ok ? translationResult.data : null;
  const translation = hasTranslationContent(rawTranslation) ? rawTranslation : null;
  const languageShouldUpdate = translationResult.ok;
  const translationForSql = translationResult.ok
    ? (translation || { title: '', text: '', newsfeed_description: '' })
    : null;
  const translationEvent = translation
    ? 'TRANSLATION_API_SUCCEEDED'
    : translationResult.ok
      ? 'TRANSLATION_API_EMPTY_RESULT'
      : 'TRANSLATION_API_FAILED_OPTIONAL';
  trace(translationEvent, {
    api_ok: translationResult.ok,
    translation_content_present: Boolean(translation),
    raw_detected_language: rawTranslation?.detected_language || null,
    detected_language: translation?.detected_language || null,
    language_name: translation?.language_name || null,
    translated_title: translation?.title ?? null,
    translated_text: translation?.text ?? null,
    translated_newsfeed_description: translation?.newsfeed_description ?? null,
    error: translationResult.ok ? null : translationResult.error,
  });
  try {
    trace('SQL_TRANSACTION_BEGIN', {
      canonical_table: 'google_text_ad',
      transparency_tables: [
        'google_transparency_ad_payload',
        'google_transparency_country_delivery',
      ],
    });
    const saved = await repo.withTransaction(ctx.db.sql, async (tx) => {
      const existing = await repo.getAd(tx, data.ad_id);
      trace('SQL_CANONICAL_LOOKUP', {
        table: 'google_text_ad',
        lookup_ad_id: data.ad_id,
        found: Boolean(existing),
        internal_id: existing?.id || null,
      });
      const postOwnerName = data.post_owner || (!existing ? data.advertiser_id : null);
      const postOwnerId = postOwnerName
        ? await repo.ensurePostOwner(tx, postOwnerName, !existing)
        : existing?.post_owner_id;
      const domainId = await repo.ensureDomain(tx, data.domain);
      const languageId = translation?.detected_language
        ? await repo.ensureLanguage(tx, translation.detected_language, translation.language_name)
        : languageShouldUpdate ? 0 : existing?.language_id || 0;
      const countryIds = data.country.length
        ? await repo.ensureCountry(tx, data.country[0])
        : { countryId: 0, countryOnlyId: 0 };
      trace('SQL_DIMENSIONS_RESOLVED', {
        tables: [
          'google_text_ad_post_owners',
          'google_text_ad_domains',
          'languages',
          'google_text_country',
          'google_text_country_only',
        ],
        post_owner: {
          payload_value: data.post_owner,
          canonical_value: postOwnerName,
          id: postOwnerId,
          fallback_used: !data.post_owner && !existing,
        },
        domain: { value: data.domain, id: domainId },
        language: {
          detected_language: translation?.detected_language || null,
          language_name: translation?.language_name || null,
          id: languageId,
        },
        primary_country: {
          value: data.country[0] || null,
          country_id: countryIds.countryId,
          country_only_id: countryIds.countryOnlyId,
        },
      });
      const effectiveFirstSeen = existing
        ? (data.hasPayloadFirstSeen
          ? earlierSql(existing.first_seen, data.firstSeenSql)
          : mysqlDateTime(existing.first_seen) || data.firstSeenSql)
        : data.firstSeenSql;
      const effectiveLastSeen = existing
        ? laterSql(existing.last_seen, data.lastSeenSql)
        : data.lastSeenSql;
      const existingPostDateSql = mysqlDateTime(existing?.post_date);
      const existingHasRealPostDate = existingPostDateSql &&
        existingPostDateSql > '1000-01-01 00:00:00';
      const effectivePostDateSql = existingHasRealPostDate
        ? existingPostDateSql
        : data.postDateSql;
      const common = {
        ...data, ...countryIds, postOwnerId, domainId, languageId, languageShouldUpdate,
        firstSeenSql: effectiveFirstSeen,
        lastSeenSql: effectiveLastSeen,
        daysRunning: daysRunning(effectiveFirstSeen, effectiveLastSeen),
      };
      const googleTextAdId = existing ? existing.id : await repo.insertAd(tx, common);
      if (existing) await repo.updateAd(tx, googleTextAdId, common);
      trace(existing ? 'SQL_CANONICAL_UPDATED' : 'SQL_CANONICAL_INSERTED', {
        table: 'google_text_ad',
        internal_id: googleTextAdId,
        values: {
          ad_id: data.ad_id,
          type: data.type,
          ad_position: data.adPosition,
          post_date: data.postDateSql,
          first_seen: effectiveFirstSeen,
          last_seen: effectiveLastSeen,
          language_id: languageId,
          country_id: countryIds.countryId,
          country_only_id: countryIds.countryOnlyId,
          post_owner_id: postOwnerId,
        },
      });
      await repo.upsertVariant(tx, googleTextAdId, data);
      trace('SQL_VARIANT_UPSERTED', {
        table: 'google_text_ad_variants',
        internal_id: googleTextAdId,
        title: data.ad_title,
        text: data.ad_text,
        image_url_original: data.image_url_original,
      });
      await repo.upsertTranslation(tx, googleTextAdId, translationForSql);
      trace('SQL_TRANSLATION_UPSERTED', {
        table: 'google_ad_translation',
        internal_id: googleTextAdId,
        skipped: !translationForSql,
        cleared_empty_translation: languageShouldUpdate && !translation,
        language_id: languageId,
        stored_title: translationForSql?.title ?? null,
        stored_text: translationForSql?.text ?? null,
        stored_newsfeed_description: translationForSql?.newsfeed_description ?? null,
      });
      await repo.upsertMeta(tx, googleTextAdId, common);
      trace('SQL_METADATA_UPSERTED', {
        table: 'google_text_ad_meta_data',
        internal_id: googleTextAdId,
        platform: 18,
        version: data.version,
        destination_url: data.destination_url,
      });
      await repo.upsertTransparency(tx, googleTextAdId, data);
      trace('SQL_TRANSPARENCY_PAYLOAD_UPSERTED', {
        table: 'google_transparency_ad_payload',
        internal_id: googleTextAdId,
        advertiser_id: data.advertiser_id,
        ad_url: data.ad_url,
        subnetwork: data.subnetwork,
        region_code: data.region_code,
        impressions: data.impressions,
        video_url_original: data.video_url_original,
        redirect_url: data.redirect_url,
        othermultimedia: data.othermultimedia,
      });
      const deliveryRows = await repo.mergeCountryDelivery(
        tx, googleTextAdId, data.countryDetailsSql, data.country, effectiveLastSeen
      );
      trace('SQL_COUNTRY_DELIVERY_MERGED', {
        tables: [
          'google_transparency_country_delivery',
          'google_text_ad_countries',
          'google_text_ad_countries_only',
        ],
        internal_id: googleTextAdId,
        country_details: deliveryRowsToContract(deliveryRows),
      });
      const storedPostOwnerImage = await repo.getPostOwnerImage(tx, postOwnerId);
      return {
        googleTextAdId, postOwnerId, inserted: !existing,
        nasImageUrl: existing?.nas_image_url || null,
        storedPostOwnerImage,
        postDateEs: effectivePostDateSql > '1000-01-01 00:00:00'
          ? effectivePostDateSql
          : null,
        firstSeenSql: effectiveFirstSeen,
        lastSeenSql: effectiveLastSeen,
        daysRunning: common.daysRunning,
        languageId,
        languageShouldUpdate,
        detectedLanguage: translation?.detected_language
          ? String(translation.detected_language).slice(0, 2).toLowerCase()
          : null,
        countryDetails: deliveryRowsToContract(deliveryRows),
      };
    });
    trace('SQL_TRANSACTION_COMMITTED', {
      internal_id: saved.googleTextAdId,
      operation: saved.inserted ? 'insert' : 'update',
      language_id: saved.languageId,
      post_date_es: saved.postDateEs,
      country_details: saved.countryDetails,
    });

    const esIndex = ctx.db.elastic?.indexName || 'google_ads_data';
    let existingEs = {};
    if (!saved.inserted && ctx.db.elastic) {
      try {
        if (typeof ctx.db.elastic.get === 'function') {
          const response = await ctx.db.elastic.get({
            index: esIndex,
            type: 'doc',
            id: String(saved.googleTextAdId),
          });
          existingEs = response?.body?._source || response?._source || {};
        } else {
          existingEs = firstHitSource(
            await ctx.db.elastic.search(searchIdQuery(esIndex, saved.googleTextAdId))
          ) || {};
        }
        trace('ELASTICSEARCH_EXISTING_DOCUMENT_READ', {
          index: esIndex,
          internal_id: saved.googleTextAdId,
          found: Object.keys(existingEs).length > 0,
          preserved_fields: {
            nas_video_url: existingEs.nas_video_url || null,
            othermultimedia: existingEs.othermultimedia || [],
            lang_detect: existingEs.lang_detect || null,
            ad_title: existingEs.ad_title ?? null,
            ad_text: existingEs.ad_text ?? null,
          },
        });
      } catch (error) {
        trace('ELASTICSEARCH_EXISTING_DOCUMENT_READ_FAILED', {
          index: esIndex,
          internal_id: saved.googleTextAdId,
          error: error.message,
          fatal: false,
        });
      }
    }

    const shouldUploadImage = data.nasPolicy.image && data.image_url_original &&
      !validStoredPath(saved.nasImageUrl);
    const shouldUploadOwner = data.nasPolicy.image &&
      data.post_owner_image && saved.postOwnerId &&
      !validStoredPath(saved.storedPostOwnerImage);
    const existingNasOther = parseNasOtherMultimedia(
      // Read the short-lived legacy trace field once, if present, so an
      // already-uploaded file is reused while the document transitions to the
      // public `othermultimedia` NAS-path array.
      existingEs.nas_othermultimedia || existingEs.othermultimedia,
      data.othermultimedia
    );
    const existingNasOtherBySource = new Map(
      existingNasOther.map((item) => [item.source_url, item.nas_path])
    );
    const missingOtherMultimedia = data.othermultimedia
      .map((sourceUrl, index) => ({ sourceUrl, index }))
      .filter(({ sourceUrl }) =>
        data.nasPolicy[mediaCategoryFromUrl(sourceUrl)] &&
        !validStoredPath(existingNasOtherBySource.get(sourceUrl))
      );
    trace('NAS_UPLOAD_PLAN', {
      internal_id: saved.googleTextAdId,
      type: data.type,
      primary_image: {
        source_url: data.image_url_original,
        existing_path: saved.nasImageUrl,
        upload_required: Boolean(shouldUploadImage),
        target_folder: data.type === 'TEXT' ? 'gt/adT' : 'gt/adImage',
      },
      post_owner_image: {
        source_url: data.post_owner_image,
        existing_path: saved.storedPostOwnerImage,
        upload_required: Boolean(shouldUploadOwner),
        target_folder: 'gt/postowner',
      },
      othermultimedia: {
        source_urls: data.othermultimedia,
        existing_paths: existingNasOther,
        missing_source_urls: missingOtherMultimedia.map((item) => item.sourceUrl),
        upload_required: missingOtherMultimedia.length > 0,
        target_folder: 'gt/otherMultiMedia',
      },
      nas_config_policy: data.nasPolicy,
    });
    const [imageUpload, ownerUpload] = await Promise.all([
      shouldUploadImage
        ? (data.type === 'TEXT'
          ? media.uploadTransparencyTextImage(data.image_url_original, saved.googleTextAdId)
          : media.uploadImage(data.image_url_original, saved.googleTextAdId, 'google')
        ).catch(() => null)
        : null,
      shouldUploadOwner
        ? media.uploadPostOwner(data.post_owner_image, saved.postOwnerId, 'google').catch(() => null)
        : null,
    ]);
    let nasImageUrl = validStoredPath(saved.nasImageUrl) ? saved.nasImageUrl : imageUpload?.nas_path || null;
    let primaryImageSqlUpdated = false;
    if (imageUpload?.nas_path && validStoredPath(imageUpload.nas_path)) {
      nasImageUrl = imageUpload.nas_path;
      try {
        await repo.setVariantNasImage(ctx.db.sql, saved.googleTextAdId, nasImageUrl);
        primaryImageSqlUpdated = true;
      } catch (error) {
        trace('NAS_PRIMARY_IMAGE_SQL_UPDATE_FAILED', {
          table: 'google_text_ad_variants',
          path: nasImageUrl,
          error: error.message,
          fatal: false,
        });
      }
    }
    trace('NAS_PRIMARY_IMAGE_RESULT', {
      attempted: Boolean(shouldUploadImage),
      reused_existing: validStoredPath(saved.nasImageUrl),
      nas_path: nasImageUrl,
      sql_table: 'google_text_ad_variants',
      sql_image_url_updated: primaryImageSqlUpdated,
      success: validStoredPath(nasImageUrl),
    });
    let otherUpload = null;
    if (missingOtherMultimedia.length) {
      otherUpload = await media.uploadMultimedia(
        missingOtherMultimedia.map((item) => item.sourceUrl),
        data.type,
        saved.googleTextAdId,
        'google',
        {
          indexes: missingOtherMultimedia.map((item) => item.index),
          store: data.nasPolicy,
        }
      ).catch(() => null);
    }
    const uploadedPaths = uploadedMultimediaPaths(otherUpload);
    const uploadedBySource = new Map(
      missingOtherMultimedia.map((item, index) => [item.sourceUrl, uploadedPaths[index] || null])
    );
    const nasOtherMultimedia = data.othermultimedia.map((sourceUrl) => ({
      source_url: sourceUrl,
      nas_path: validStoredPath(existingNasOtherBySource.get(sourceUrl))
        ? existingNasOtherBySource.get(sourceUrl)
        : uploadedBySource.get(sourceUrl) || null,
    }));
    const othermultimediaNasPaths = nasOtherMultimedia
      .map((item) => validStoredPath(item.nas_path) ? item.nas_path : null);
    trace('NAS_OTHER_MULTIMEDIA_RESULT', {
      attempted: missingOtherMultimedia.length > 0,
      reused_count: data.othermultimedia.length - missingOtherMultimedia.length,
      source_urls: data.othermultimedia,
      result: otherUpload,
      persisted_es_paths: othermultimediaNasPaths,
      note: 'Original URLs stay in SQL; successful NAS paths are stored in Elasticsearch othermultimedia.',
    });
    let postOwnerImage = validStoredPath(saved.storedPostOwnerImage)
      ? saved.storedPostOwnerImage
      : ownerUpload?.post_owner_image || null;
    let ownerSqlUpdated = false;
    if (ownerUpload?.post_owner_image && validStoredPath(ownerUpload.post_owner_image)) {
      postOwnerImage = ownerUpload.post_owner_image;
      try {
        await repo.setPostOwnerImage(ctx.db.sql, saved.postOwnerId, postOwnerImage);
        ownerSqlUpdated = true;
      } catch (error) {
        trace('NAS_POST_OWNER_SQL_UPDATE_FAILED', {
          table: 'google_text_ad_post_owners',
          path: postOwnerImage,
          error: error.message,
          fatal: false,
        });
      }
    }
    if (!postOwnerImage) {
      postOwnerImage = data.post_owner_image ? '/DefaultImage.jpg' : null;
    }
    trace('NAS_POST_OWNER_RESULT', {
      attempted: Boolean(shouldUploadOwner),
      reused_existing: validStoredPath(saved.storedPostOwnerImage),
      nas_path: postOwnerImage,
      sql_table: 'google_text_ad_post_owners',
      sql_post_owner_image_updated: ownerSqlUpdated,
      success: validStoredPath(postOwnerImage),
    });

    const countries = saved.countryDetails.length
      ? saved.countryDetails.map((detail) => detail.country)
      : data.country;
    const nasVideoUrl = data.type === 'VIDEO' && validStoredPath(existingEs.image_video_url)
      ? existingEs.image_video_url
      : validStoredPath(existingEs.nas_video_url) ? existingEs.nas_video_url : null;
    const effectiveTranslation = translation || (!saved.languageShouldUpdate && !saved.inserted ? {
      title: existingEs.ad_title ?? null,
      text: existingEs.ad_text ?? null,
      newsfeed_description: existingEs.news_feed_description ?? null,
    } : null);
    const effectiveDetectedLanguage = saved.languageShouldUpdate
      ? saved.detectedLanguage
      : saved.detectedLanguage || existingEs.lang_detect || null;
    const firstSeenForSearch = data.hasPayloadFirstSeen
      ? saved.firstSeenSql
      : existingEs.first_seen ?? null;
    const lastSeenForSearch = data.hasPayloadLastSeen
      ? saved.lastSeenSql
      : null;
    if (ctx.db.elastic) {
      const document = buildTransparencyDoc(
        {
          ...data,
          post_owner_image: postOwnerImage,
          postDateEs: saved.postDateEs,
          firstSeenSql: saved.firstSeenSql,
          lastSeenSql: saved.lastSeenSql,
          daysRunning: saved.daysRunning,
          country: countries,
          countryDetailsSql: saved.countryDetails,
          nasVideoUrl,
          othermultimediaNasPaths,
          firstSeenForSearch,
          lastSeenForSearch,
          languageId: saved.languageId,
          detectedLanguage: effectiveDetectedLanguage,
          translation: effectiveTranslation,
        },
        saved.googleTextAdId,
        nasImageUrl
      );
      trace('ELASTICSEARCH_INDEX_REQUEST', {
        index: esIndex,
        document_id: String(saved.googleTextAdId),
        document_summary: {
          ad_id: document.ad_id,
          platform: document.platform,
          type: document.type,
          ad_position: document.ad_position,
          subnetwork: document.subnetwork,
          post_date: document.post_date,
          first_seen: document.first_seen,
          last_seen: document.last_seen,
          language_id: document.language_id,
          lang_detect: document.lang_detect,
          ad_title: document.ad_title,
          ad_text: document.ad_text,
          country: document.country,
          country_details: document.country_details,
          new_nas_image_url: document.new_nas_image_url,
          othermultimedia: document.othermultimedia,
          image_video_url: document.image_video_url,
        },
      });
      try {
        await ctx.db.elastic.index({
          index: esIndex,
          type: 'doc',
          id: String(saved.googleTextAdId),
          body: document,
        });
        trace('ELASTICSEARCH_INDEX_SUCCEEDED', {
          index: esIndex,
          document_id: String(saved.googleTextAdId),
        });
      } catch (error) {
        trace('ELASTICSEARCH_INDEX_FAILED', {
          index: esIndex,
          document_id: String(saved.googleTextAdId),
          error: error.message,
          fatal: false,
        });
        ctx.log.warn('google transparency ES index failed', {
          ad_id: data.ad_id, id: saved.googleTextAdId, error: error.message,
        });
      }
    } else {
      trace('ELASTICSEARCH_SKIPPED', { reason: 'connection unavailable' });
    }

    if (data.nasPolicy.video && data.type === 'VIDEO' && data.video_url_original && !nasVideoUrl) {
      enqueueVideoDownload({
        network: 'google',
        esIndex,
        idField: 'id',
        idValue: saved.googleTextAdId,
        videoUrl: data.video_url_original,
        fieldName: 'image_video_url',
      });
      trace('NAS_VIDEO_DOWNLOAD_QUEUED', {
        source_url: data.video_url_original,
        target_folder: 'gt/adVideo',
        es_index: esIndex,
        document_id: saved.googleTextAdId,
      });
    } else {
      trace('NAS_VIDEO_DOWNLOAD_SKIPPED', {
        type: data.type,
        source_url: data.video_url_original,
        existing_nas_video_url: nasVideoUrl,
        nas_config_policy: data.nasPolicy,
      });
    }

    const extra = shouldUploadImage && !nasImageUrl
      ? { warning: 'Ad data was saved, but the image could not be stored in NAS.' }
      : {};
    const result = saved.inserted
      ? ok(saved.googleTextAdId, 'Google Transparency ad inserted successfully.', extra)
      : updated(saved.googleTextAdId, extra.warning);
    trace('PROCESS_COMPLETED', {
      code: result.code,
      operation: saved.inserted ? 'insert' : 'update',
      internal_id: saved.googleTextAdId,
      warning: result.warning || null,
    });
    return result;
  } catch (error) {
    trace('PROCESS_FAILED_SQL_ROLLBACK_OR_PIPELINE_ERROR', {
      error: error.message,
      stack: error.stack,
    });
    ctx.log.error('google transparency insertion failed', { ad_id: payload.ad_id, error: error.message });
    return serverError(500, 'The Google Transparency ad could not be saved.', { error: error.message });
  }
}

module.exports = { processTransparencyAd };
