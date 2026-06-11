'use strict';

/**
 * Get total GDN ad count from Elasticsearch.
 * Uses the same EXTRA_CONDITION filter as the search (IMAGE ads must have NAS image).
 */
async function getAdsCount(req, db, logger) {
  if (!db.elastic) {
    return { code: 503, message: 'Elasticsearch connection not available' };
  }

  try {
    const result = await db.elastic.search({
      index: db.elastic.indexName || 'gdn_search_mix',
      body: {
        size: 0,
        track_total_hits: true,
        query: {
          bool: {
            filter: [
              {
                bool: {
                  should: [
                    {
                      bool: {
                        must: [
                          {
                            bool: {
                              should: [
                                { term: { 'gdn_ad.type.keyword': 'IMAGE' } },
                                { term: { 'gdn_ad.type.keyword': '' } },
                              ],
                              minimum_should_match: 1,
                            },
                          },
                          { exists: { field: 'new_nas_image_url' } },
                        ],
                      },
                    },
                    {
                      bool: {
                        must_not: [
                          {
                            bool: {
                              should: [
                                { term: { 'gdn_ad.type.keyword': 'IMAGE' } },
                                { term: { 'gdn_ad.type.keyword': '' } },
                              ],
                              minimum_should_match: 1,
                            },
                          },
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

    const hits  = result.hits || result.body?.hits;
    const count = typeof hits.total === 'object' ? hits.total.value : hits.total;

    return { code: 200, data: { count }, message: 'GDN ad count fetched successfully' };
  } catch (err) {
    logger.error('Error in GDN getAdsCount', { error: err.message });
    return { code: 500, message: 'Error occurred while fetching GDN ad count', error: err.message };
  }
}

module.exports = { getAdsCount };
