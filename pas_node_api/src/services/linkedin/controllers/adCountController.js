'use strict';

/**
 * Get total ad count for the LinkedIn platform from Elasticsearch.
 * Uses the ES count API with the same image filter condition as search.
 */
async function getAdsCount(req, db, logger) {
  if (!db.elastic) {
    return { code: 503, message: 'Elasticsearch connection not available' };
  }

  try {
    // const result = await db.elastic.search({
    //   index: process.env.LI_ELASTIC_INDEX || 'linkedin_ads_data',
    //   body: {
    //     size: 0,
    //     track_total_hits: true,
    //     query: {
    //       bool: {
    //         filter: [
    //           // { terms: { 'linkedin_ad.status': [1, 5, 6] } },
    //           {
    //             bool: {
    //               should: [
    //                 // IMAGE ads must have PowerAdspy image
    //                 {
    //                   bool: {
    //                     filter: [
    //                       { term: { 'ad_type.keyword': 'IMAGE' } },
    //                       { exists: { field: 'new_nas_image_url' } },
    //                       { wildcard: { 'new_nas_image_url.keyword': '*PowerAdspy*' } },
    //                     ],
    //                   },
    //                 },
    //                 // All other types (not IMAGE)
    //                 {
    //                   bool: {
    //                     must_not: [
    //                       { term: { 'ad_type.keyword': 'IMAGE' } },
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
  index: process.env.LI_ELASTIC_INDEX || 'linkedin_ads_data',
  body: {
    size: 0, // no documents, only count
    track_total_hits: true,
    query: {
      bool: {
        // must: [
        //   {
        //     query_string: {
        //       default_field: "ad_position",
        //       query: "(FEED) OR (SIDE)"
        //     }
        //   }
        // ],
        filter: [
          {
            bool: {
              should: [
                // IMAGE ads must have NAS image
                {
                  bool: {
                    must: [
                      { term: { "ad_type.keyword": "IMAGE" } },
                      { exists: { field: "new_nas_image_url" } }
                    ]
                  }
                },
                // Non-IMAGE ads
                {
                  bool: {
                    must_not: [
                      { term: { "ad_type.keyword": "IMAGE" } }
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
    logger.error('Error in getAdsCount (linkedin)', { error: err.message });
    return {
      code: 500,
      message: 'Error occurred while fetching ad count',
      error: err.message,
    };
  }
}

module.exports = { getAdsCount };
