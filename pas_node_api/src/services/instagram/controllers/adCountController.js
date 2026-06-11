'use strict';



/**
 * Get total ad count for the instagram platform from Elasticsearch.
 * Uses the ES count API with the same image filter condition as search.
 *
 * @param {Object} req    - Express request
 * @param {Object} db     - { sql, elastic } injected database connections
 * @param {Object} logger - service logger
 * @returns {Object}      - { code, data: { count } }
 */
async function getAdsCount(req, db, logger) {
  if (!db.elastic) {
    return { code: 503, message: 'Elasticsearch connection not available' };
  }

  try {

    const result = await db.elastic.search({
      index: db.elastic.indexName,
      body: {
        size: 0,
        track_total_hits: true,
        query: {
          bool: {
            filter: [
              { terms: { 'instagram_ad.status': [1, 5, 6] } },
              {
                bool: {
                  should: [
                    // IMAGE ads must have NAS image URL
                    {
                      bool: {
                        filter: [
                          { term: { 'instagram_ad.type.keyword': 'IMAGE' } },
                          { exists: { field: 'new_nas_image_url' } }
                        ]
                      }
                    },
                    // VIDEO ads must have thumbnail
                    {
                      bool: {
                        filter: [
                          { term: { 'instagram_ad.type.keyword': 'VIDEO' } },
                          { exists: { field: 'thumbnail' } }
                        ]
                      }
                    },
                    // All other types (not IMAGE, not VIDEO) pass through
                    {
                      bool: {
                        must_not: [
                          { terms: { 'instagram_ad.type.keyword': ['IMAGE', 'VIDEO'] } }
                        ]
                      }
                    }
                  ],
                  minimum_should_match: 1
                }
              }
            ]
          }
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
    logger.error('Error in getAdsCount', { error: err.message });

    return {
      code: 500,
      message: 'Error occurred while fetching ad count',
      error: err.message,
    };
  }
}
module.exports = { getAdsCount };
