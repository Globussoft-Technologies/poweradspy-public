'use strict';

/**
 * Get total ad count for the Reddit platform from Elasticsearch.
 */
async function getAdsCount(req, db, logger) {
  if (!db.elastic) {
    return { code: 503, message: 'Elasticsearch connection not available' };
  }

  try {
    const result = await db.elastic.search({
      index: process.env.RED_ELASTIC_INDEX || 'reddit_search_mix',
      body: {
        size: 0,
        track_total_hits: true,
        query: {
          bool: {
            filter: [
              { terms: { 'reddit_ad.status': [1] } },
              {
                bool: {
                  should: [
                    {
                      bool: {
                        filter: [
                          { term: { 'reddit_ad.type.keyword': 'IMAGE' } },
                          { exists: { field: 'new_nas_image_url' } },
                        ],
                      },
                    },
                    {
                      bool: {
                        must_not: [
                          { term: { 'reddit_ad.type.keyword': 'IMAGE' } },
                        ],
                      },
                    },
                  ],
                  minimum_should_match: 1,
                },
              },
            ],
          },
        },
      },
    });

    const hits = result.hits || result.body?.hits;
    const count = typeof hits.total === 'object' ? hits.total.value : hits.total;

    return { code: 200, data: { count }, message: 'Ad count fetched successfully' };
  } catch (err) {
    logger.error('Error in getAdsCount (reddit)', { error: err.message });
    return { code: 500, message: 'Error occurred while fetching ad count', error: err.message };
  }
}

module.exports = { getAdsCount };
