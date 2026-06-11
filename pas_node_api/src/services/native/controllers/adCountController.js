'use strict';

/**
 * Get total ad count for the Native platform from Elasticsearch.
 * Uses the ES count API with the same NAS image filter condition as search.
 */
async function getAdsCount(req, db, logger) {
  if (!db.elastic) {
    return { code: 503, message: 'Elasticsearch connection not available' };
  }

  try {
    // const result = await db.elastic.search({
    //   index: process.env.NAT_ELASTIC_INDEX || 'native_search_mix',
    //   body: {
    //     size: 0,
    //     track_total_hits: true,
    //     query: {
    //       bool: {
    //         filter: [
    //           // { terms: { 'native_ad.status': [1] } },
    //           {
    //             bool: {
    //               should: [
    //                 // IMAGE ads must have PowerAdspy NAS image
    //                 {
    //                   bool: {
    //                     filter: [
    //                       { term: { 'native_ad.type.keyword': 'IMAGE' } },
    //                       { exists: { field: 'native_ad.nas_url' } },
    //                       { wildcard: { 'native_ad.nas_url.keyword': '*PowerAdspy*' } },
    //                     ],
    //                   },
    //                 },
    //                 // All other types (not IMAGE)
    //                 {
    //                   bool: {
    //                     must_not: [
    //                       { term: { 'native_ad.type.keyword': 'IMAGE' } },
    //                     ],
    //                   },
    //                 },
    //               ],
    //               minimum_should_match: 1,
    //             },
    //           },
    //         ],
    //       },
    //     },
    //   },
    // });


    const result = await db.elastic.search({
      index: process.env.NAT_ELASTIC_INDEX || 'native_search_mix',
      body: {
        query: {
          bool: {
            // must: [
            //   {
            //     query_string: {
            //       default_field: "native_ad.ad_position",
            //       query: "(FEED) OR (SIDE)"
            //     }
            //   }
            // ],
            filter: [
              {
                bool: {
                  should: [
                    // IMAGE and VIDEO ads must have NAS URL (shared field)
                    {
                      bool: {
                        must: [
                          { terms: { "native_ad.type.keyword": ["IMAGE", "VIDEO"] } },
                          { exists: { field: "native_ad.nas_url" } }
                        ]
                      }
                    },
                    // All other types (not IMAGE, not VIDEO) pass through
                    {
                      bool: {
                        must_not: [
                          { terms: { "native_ad.type.keyword": ["IMAGE", "VIDEO"] } }
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
    logger.error('Error in getAdsCount (native)', { error: err.message });
    return {
      code: 500,
      message: 'Error occurred while fetching ad count',
      error: err.message,
    };
  }
}

module.exports = { getAdsCount };
