'use strict';

/**
 * Cross-network ad media patch service.
 *
 * Accepts a NAS/media path for image, thumbnail, video and/or other_multimedia
 * and writes it to the correct SQL columns + ES fields for the given network.
 *
 * NOTE: This is a manual repair/admin API. It does NOT download or re-upload
 * media to NAS; the caller must already have the final NAS/remote URL.
 */

const serviceRegistry = require('../../ServiceRegistry');
const { validationError } = require('../../../insertion/helpers/responses');

const ALLOWED_NETWORKS = new Set([
  'facebook', 'instagram', 'gdn', 'google', 'linkedin',
  'youtube', 'pinterest', 'native', 'reddit', 'quora',
]);

const NETWORK_CONFIG = {
  facebook: {
    tableAd: 'facebook_ad',
    tableVariant: 'facebook_ad_variants',
    fkVariant: 'facebook_ad_id',
    colImage: 'image_url',
    colImageOriginal: 'image_url_original',
    hasImageVideo: true,
    tableImageVideo: 'facebook_ad_image_video',
    fkImageVideo: 'facebook_ad_id',
    esFieldImage: 'facebook_ad_variants.image_url',
    esFieldNewNas: 'new_nas_image_url',
    esFieldVideo: 'nas_video_url',
    esFieldOtherMedia: 'othermedia',
    esNestedImageVideo: 'facebook_ad_image_video.ad_image_video',
  },
  instagram: {
    tableAd: 'instagram_ad',
    tableVariant: 'instagram_ad_variants',
    fkVariant: 'instagram_ad_id',
    colImage: 'image_url',
    colImageOriginal: 'image_url_original',
    hasImageVideo: true,
    tableImageVideo: 'instagram_ad_image_video',
    fkImageVideo: 'instagram_ad_id',
    esFieldImage: 'instagram_ad_variants.image_url',
    esFieldNewNas: 'new_nas_image_url',
    esFieldVideo: 'nas_video_url',
    esFieldOtherMedia: 'othermedia',
    esNestedImageVideo: 'instagram_ad_image_video.ad_image_video',
  },
  gdn: {
    tableAd: 'gdn_ad',
    tableVariant: 'gdn_ad_variants',
    fkVariant: 'gdn_ad_id',
    colImage: 'image_url',
    colImageOriginal: 'image_url_original',
    hasImageVideo: false,
    esFieldImage: 'gdn_ad_variants.image_url',
    esFieldNewNas: 'new_nas_image_url',
  },
  google: {
    tableAd: 'google_text_ad',
    tableVariant: 'google_text_ad_variants',
    fkVariant: 'google_text_ad_id',
    colImage: 'image_url',
    colImageOriginal: 'image_url_original',
    hasImageVideo: false,
    esFieldImage: 'image_url',
    esFieldNewNas: 'new_nas_image_url',
    esFieldImageVideo: 'image_video_url',
  },
  linkedin: {
    tableAd: 'linkedin_ad',
    tableVariant: 'linkedin_ad_variants',
    fkVariant: 'linkedin_ad_id',
    colImage: 'image_url',
    colImageOriginal: 'image_url_original',
    hasImageVideo: true,
    tableImageVideo: 'linkedin_ad_image_video',
    fkImageVideo: 'linkedin_ad_id',
    esFieldImage: 'ad_image',
    esFieldNewNas: 'new_nas_image_url',
    esFieldVideo: 'ad_video',
    esFieldOtherMedia: 'ad_image',
    esNestedImageVideo: 'linkedin_ad_image_video.ad_image_video',
  },
  youtube: {
    tableAd: 'youtube_ad',
    tableVariant: 'youtube_ad_variants',
    fkVariant: 'youtube_ad_id',
    colImage: 'thumbnail_url',
    colImageOriginal: 'thumbnail_url_original',
    colVideo: 'video_url',
    colVideoOriginal: 'video_url_original',
    hasImageVideo: true,
    tableImageVideo: 'youtube_ad_image_video',
    fkImageVideo: 'youtube_ad_id',
    esFieldImage: 'ad_image_or_video',
    esFieldThumbnail: 'thumbnail_url',
    esFieldNewNas: 'new_nas_image_url',
    esFieldVideo: 'nas_video_url',
    esFieldOtherMedia: 'ad_image_or_video',
    esNestedImageVideo: 'youtube_ad_image_video.ad_image_video',
  },
  pinterest: {
    tableAd: 'pinterest_ad',
    tableVariant: 'pinterest_ad_variants',
    fkVariant: 'pinterest_ad_id',
    colImage: 'image_url',
    colImageOriginal: 'image_url_original',
    hasImageVideo: false,
    esFieldImage: 'pinterest_ad_variants.image_url',
    esFieldNewNas: 'new_nas_image_url',
    esFieldThumbnail: 'thumbnail',
  },
  native: {
    tableAd: 'native_ad',
    tableVariant: 'native_ad_variants',
    fkVariant: 'native_ad_id',
    colImage: 'image_url',
    colImageOriginal: 'image_url_original',
    hasImageVideo: false,
    esFieldImage: 'native_ad.nas_url',
    esFieldNewNas: 'new_nas_image_url',
    esFieldAws: 'native_ad.aws_url',
  },
  reddit: {
    tableAd: 'reddit_ad',
    tableVariant: 'reddit_ad_variants',
    fkVariant: 'reddit_ad_id',
    colImage: 'image_url',
    colImageOriginal: 'image_url_original',
    hasImageVideo: true,
    tableImageVideo: 'reddit_ad_image_video',
    fkImageVideo: 'reddit_ad_id',
    esFieldImage: 'reddit_ad_variants.image_url',
    esFieldNewNas: 'new_nas_image_url',
    esFieldOtherMedia: 'reddit_ad_image_video.othermedia',
    esNestedImageVideo: 'reddit_ad_image_video.ad_image_video',
  },
  quora: {
    tableAd: 'quora_ad',
    tableVariant: 'quora_ad_variants',
    fkVariant: 'quora_ad_id',
    colImage: 'image_url',
    colImageOriginal: 'image_url_original',
    colVideo: 'video_url',
    hasImageVideo: true,
    tableImageVideo: 'quora_ad_image_video',
    fkImageVideo: 'quora_ad_id',
    esFieldNewNas: 'new_nas_image_url',
    esFieldThumbnail: 'thumbnail',
    esNestedImageVideo: 'quora_ad_image_video.ad_image_video',
  },
};

function validateInput(body) {
  const errors = [];
  if (!body.network || !ALLOWED_NETWORKS.has(body.network)) {
    errors.push('The network field is required and must be one of: ' + [...ALLOWED_NETWORKS].join(', '));
  }
  if (!body.ad_id || String(body.ad_id).trim() === '') {
    errors.push('The ad_id field is required.');
  }
  const hasMedia =
    body.image !== undefined ||
    body.thumbnail !== undefined ||
    body.video !== undefined ||
    body.other_multimedia !== undefined;
  if (!hasMedia) {
    errors.push('At least one of image, thumbnail, video or other_multimedia must be provided.');
  }
  if (body.other_multimedia !== undefined && !Array.isArray(body.other_multimedia)) {
    errors.push('The other_multimedia field must be an array.');
  }
  if (errors.length) return validationError(errors);
  return { code: 200 };
}

async function findAd(exec, cfg, adId) {
  const rows = await exec.query(
    `SELECT id, type FROM ${cfg.tableAd} WHERE ad_id = ? LIMIT 1`,
    [adId]
  );
  return rows && rows[0] ? rows[0] : null;
}

async function updateVariantImage(exec, cfg, internalId, imageUrl) {
  const params = [imageUrl, imageUrl, internalId];
  await exec.query(
    `UPDATE ${cfg.tableVariant}
     SET ${cfg.colImage} = ?, ${cfg.colImageOriginal} = ?
     WHERE ${cfg.fkVariant} = ?`,
    params
  );
}

async function updateVariantVideo(exec, cfg, internalId, videoUrl) {
  if (!cfg.colVideo) return;
  await exec.query(
    `UPDATE ${cfg.tableVariant}
     SET ${cfg.colVideo} = ?, ${cfg.colVideoOriginal || cfg.colVideo} = ?
     WHERE ${cfg.fkVariant} = ?`,
    [videoUrl, videoUrl, internalId]
  );
}

async function upsertImageVideo(exec, cfg, internalId, adType, mediaArray) {
  if (!cfg.hasImageVideo || !mediaArray || !mediaArray.length) return;
  const existing = await exec.query(
    `SELECT ${cfg.fkImageVideo} FROM ${cfg.tableImageVideo} WHERE ${cfg.fkImageVideo} = ? LIMIT 1`,
    [internalId]
  );
  const json = JSON.stringify(mediaArray);
  if (existing && existing.length) {
    await exec.query(
      `UPDATE ${cfg.tableImageVideo} SET ad_type = ?, ad_image_video = ? WHERE ${cfg.fkImageVideo} = ?`,
      [adType, json, internalId]
    );
  } else {
    await exec.query(
      `INSERT INTO ${cfg.tableImageVideo} (${cfg.fkImageVideo}, ad_type, ad_image_video) VALUES (?, ?, ?)`,
      [internalId, adType, json]
    );
  }
}

async function findEsDoc(es, index, adId, cfg) {
  const searchBody = {
    query: { term: { ad_id: adId } },
    size: 1,
  };
  const res = await es.search({ index, body: searchBody });
  const hits = res && res.body && res.body.hits ? res.body.hits.hits : (res && res.hits ? res.hits.hits : []);
  return hits[0] || null;
}

function buildEsDoc(cfg, type, payload) {
  const doc = {};

  // Primary image / thumbnail
  if (payload.image !== undefined || payload.thumbnail !== undefined) {
    const value = payload.image !== undefined ? payload.image : payload.thumbnail;
    if (cfg.esFieldImage) doc[cfg.esFieldImage] = value;
    if (cfg.esFieldNewNas) doc[cfg.esFieldNewNas] = value;
    if (cfg.esFieldThumbnail) doc[cfg.esFieldThumbnail] = value;
    if (cfg.esFieldAws) doc[cfg.esFieldAws] = value;
    if (cfg.esFieldImageVideo) doc[cfg.esFieldImageVideo] = value;
  }

  // Video
  if (payload.video !== undefined) {
    if (cfg.esFieldVideo) doc[cfg.esFieldVideo] = payload.video;
    // YouTube keeps video_url in SQL; ES only has nas_video_url currently.
  }

  // Other multimedia / carousel
  if (payload.other_multimedia !== undefined && cfg.esFieldOtherMedia) {
    doc[cfg.esFieldOtherMedia] = payload.other_multimedia;
  }
  if (payload.other_multimedia !== undefined && cfg.esNestedImageVideo) {
    doc[cfg.esNestedImageVideo] = payload.other_multimedia;
  }

  return doc;
}

async function updateEsDoc(es, index, hit, doc) {
  if (!hit || !Object.keys(doc).length) return { updated: false, reason: 'no_es_doc_or_no_fields' };
  await es.update({
    index,
    type: 'doc',
    id: hit._id,
    body: { doc },
    refresh: 'wait_for',
  });
  return { updated: true };
}

async function updateAdMedia(payload, log) {
  const validation = validateInput(payload);
  if (validation.code !== 200) return validation;

  const { network, ad_id: adId, image, thumbnail, video, other_multimedia: otherMultimedia } = payload;
  const cfg = NETWORK_CONFIG[network];
  const service = serviceRegistry.getService(network);
  if (!service || !service.db || !service.db.sql) {
    return { code: 503, message: `SQL connection not available for network ${network}.` };
  }

  const sql = service.db.sql;
  const es = service.db.elastic;
  const esIndex = es && es.indexName ? es.indexName : null;

  try {
    const ad = await findAd(sql, cfg, adId);
    if (!ad) {
      return { code: 404, message: `Ad not found for network ${network} with ad_id ${adId}.` };
    }

    const internalId = ad.id;
    const adType = ad.type;

    const sqlUpdates = [];

    if (image !== undefined || thumbnail !== undefined) {
      const value = image !== undefined ? image : thumbnail;
      await updateVariantImage(sql, cfg, internalId, value);
      sqlUpdates.push(cfg.colImage);
    }

    if (video !== undefined && cfg.colVideo) {
      await updateVariantVideo(sql, cfg, internalId, video);
      sqlUpdates.push(cfg.colVideo);
    }

    if (otherMultimedia !== undefined) {
      await upsertImageVideo(sql, cfg, internalId, adType, otherMultimedia);
      sqlUpdates.push('other_multimedia');
    }

    let esResult = { updated: false, reason: 'es_not_configured' };
    if (es && esIndex) {
      const hit = await findEsDoc(es, esIndex, adId, cfg);
      const doc = buildEsDoc(cfg, adType, { image, thumbnail, video, other_multimedia: otherMultimedia });
      esResult = await updateEsDoc(es, esIndex, hit, doc);
    }

    const result = {
      network,
      ad_id: adId,
      internal_id: internalId,
      type: adType,
      sql_updated: sqlUpdates,
      es_updated: esResult.updated,
    };

    if (log) log.info('ad media patched', result);
    return { code: 200, status: 'ok', message: 'Ad media updated successfully.', data: result };
  } catch (err) {
    if (log) log.error('ad media patch failed', { network, ad_id: adId, error: err.message, stack: err.stack });
    return { code: 500, status: 'server_error', message: 'Failed to update ad media.', error: err.message };
  }
}

module.exports = { updateAdMedia, NETWORK_CONFIG };
