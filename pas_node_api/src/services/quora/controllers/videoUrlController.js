'use strict';

const { resolveBucket } = require('../../../insertion/helpers/nasClient');

const QR_INDEX = process.env.QR_ELASTIC_INDEX || 'quora_search_mix';

// Video URL for a Quora ad lives in the variants row; the top-level
// `image_url_original` is kept as a fallback for older/API-ingested docs.
const VIDEO_URL_FIELD = 'quora_ad_variants.image_url_original';
const ID_FIELD = 'quora_ad.id';

/**
 * GET /api/v1/quora/ads/get-ad-url
 *
 * Returns the video URL + ad id of the latest Quora VIDEO ads that do NOT yet have
 * a correct thumbnail — i.e. their `new_nas_image_url` is not a NAS thumbnail path
 * of the form "/<bucket>/stream/quora/thumbnail/...". Ads whose new_nas_image_url
 * looks like that already have a correct thumbnail (uploaded via update-nas-image)
 * and are excluded; everything else ("/DefaultImage.jpg" or any other value) is
 * returned for processing. <bucket> is resolved dynamically (pas-dev in dev,
 * pas-prod in production) via the same resolveBucket() that storeInNas uses.
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

  // A correct thumbnail lives at "/<bucket>/stream/quora/thumbnail/...". Resolve the
  // bucket the same way storeInNas does (pas-dev in dev, pas-prod in production) so the
  // exclude pattern matches exactly where update-nas-image writes the file.
  const bucket = resolveBucket();
  const correctThumbGlob = `*/${bucket}/stream/quora/thumbnail/*`;

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
            // Only ads that actually have a video URL — otherwise `video_url` comes back
            // null. video_url resolves from quora_ad_variants.image_url_original, falling
            // back to top-level image_url_original, so require at least one to exist.
            {
              bool: {
                should: [
                  { exists: { field: VIDEO_URL_FIELD } },
                  { exists: { field: 'image_url_original' } },
                ],
                minimum_should_match: 1,
              },
            },
          ],
          // Exclude ads that already have a correct thumbnail (new_nas_image_url points
          // at the bucket's thumbnail path). Everything else — "/DefaultImage.jpg", any
          // other placeholder/legacy value, or a missing field — is returned.
          must_not: [
            { wildcard: { 'new_nas_image_url.keyword': correctThumbGlob } },
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
