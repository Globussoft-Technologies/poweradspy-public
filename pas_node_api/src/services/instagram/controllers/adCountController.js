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
                    // IMAGE / STORIES ads must have a real NAS image URL
                    {
                      bool: {
                        filter: [
                          { terms: { 'instagram_ad.type.keyword': ['IMAGE', 'STORIES'] } },
                          { exists: { field: 'new_nas_image_url' } }
                        ],
                        must_not: [
                          { wildcard: { 'new_nas_image_url.keyword': { value: '*DefaultImage*' } } }
                        ]
                      }
                    },
                    // VIDEO ads must have a real thumbnail
                    {
                      bool: {
                        filter: [
                          { term: { 'instagram_ad.type.keyword': 'VIDEO' } },
                          { exists: { field: 'thumbnail' } }
                        ],
                        must_not: [
                          { wildcard: { 'thumbnail.keyword': { value: '*DefaultImage*' } } }
                        ]
                      }
                    },
                    // All other types need new_nas_image_url or othermedia, none may be DefaultImage
                    {
                      bool: {
                        must_not: [
                          { terms: { 'instagram_ad.type.keyword': ['IMAGE', 'VIDEO', 'STORIES'] } }
                        ],
                        filter: [
                          {
                            bool: {
                              should: [
                                { exists: { field: 'new_nas_image_url' } },
                                { exists: { field: 'othermedia' } }
                              ],
                              minimum_should_match: 1
                            }
                          }
                        ],
                        must_not: [
                          { wildcard: { 'new_nas_image_url.keyword': { value: '*DefaultImage*' } } },
                          { wildcard: { 'othermedia.keyword': { value: '*DefaultImage*' } } }
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
