'use strict';

/**
 * Get total ad count for TikTok from Elasticsearch.
 */
async function getAdsCount(req, db, logger) {
  if (!db.elastic) {
    return { code: 503, message: 'Elasticsearch connection not available' };
  }

  try {

    const result = await db.elastic.search({
      index: process.env.TT_ELASTIC_INDEX || 'tiktok_ads',
      body: {
        size: 0,
        track_total_hits: true,
        query: {
          match_all: {}
        }
      }
    });

    const hits = result.hits || result.body?.hits;
    const count = typeof hits.total === 'object' ? hits.total.value : hits.total;

    return {
      code: 200,
      data: { count },
      message: 'Ad count fetched successfully',
    };

  } catch (err) {
    logger.error('Error in getAdsCount (tiktok)', { error: err.message });

    return {
      code: 500,
      message: 'Error occurred while fetching ad count',
      error: err.message,
    };
  }
}

module.exports = { getAdsCount };
