'use strict';

const QR_INDEX = process.env.QR_ELASTIC_INDEX || 'quora_search_mix';

// Video URL for a Quora ad lives in the variants row; the top-level
// `image_url_original` is kept as a fallback for older/API-ingested docs.
const VIDEO_URL_FIELD = 'quora_ad_variants.image_url_original';
const ID_FIELD = 'quora_ad.id';

/**
 * GET /api/v1/quora/ads/get-ad-url
 *
 * Returns the video URL + ad id of the latest Quora VIDEO ads whose
 * `new_nas_image_url` is still the placeholder "/DefaultImage.jpg"
 * (i.e. the video has not been streamed to NAS yet).
 *
 * Query params:
 *   - limit: number of ads to return (default 1)
 *
 * Inspired by TikTok's get-ad-url endpoint, adapted for Quora's ES index.
 */
async function getLatestVideoAdUrls(req, db, logger) {
  if (!db.elastic) return { code: 503, message: 'Elasticsearch connection not available' };

  // Parse & clamp limit → default 1, min 1, capped to avoid oversized scans.
  let limit = parseInt(req.query.limit, 10);
  if (!Number.isFinite(limit) || limit < 1) limit = 1;
  if (limit > 500) limit = 500;

  const esParams = {
    index: db.elastic.indexName || QR_INDEX,
    body: {
      size: limit,
      // Latest first — highest ad id is the most recently inserted ad.
      sort: [{ [ID_FIELD]: 'desc' }],
      query: {
        bool: {
          filter: [
            { term: { 'quora_ad.type.keyword': 'VIDEO' } },
            { term: { 'new_nas_image_url.keyword': '/DefaultImage.jpg' } },
          ],
        },
      },
      _source: [ID_FIELD, VIDEO_URL_FIELD, 'image_url_original'],
    },
  };

  try {
    const result = await db.elastic.search(esParams);
    const hits = result.hits || result.body?.hits;
    const total = typeof hits.total === 'object' ? hits.total.value : hits.total;
    const esHits = hits.hits || [];

    const data = esHits.map((hit) => {
      const src = hit._source || {};
      return {
        ad_id: src[ID_FIELD] ?? hit._id,
        video_url: src[VIDEO_URL_FIELD] || src.image_url_original || null,
      };
    });

    return { code: 200, data, total, message: 'Latest video ads fetched successfully' };
  } catch (err) {
    logger.error('Error in getLatestVideoAdUrls (quora)', { error: err.message, stack: err.stack });
    return { code: 500, message: 'Error fetching latest video ad urls', error: err.message };
  }
}

module.exports = { getLatestVideoAdUrls };
