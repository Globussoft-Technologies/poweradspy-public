'use strict';

async function getAdsCount(req, db, logger) {
  if (!db.elastic) return { code: 503, message: 'Elasticsearch connection not available' };

  try {
    const result = await db.elastic.search({
      index: process.env.PIN_ELASTIC_INDEX || 'pinterest_search_mix',
      body: {
        size: 0,
        track_total_hits: true,
        query: {
          bool: {
            filter: [
              // { terms: { 'pinterest_ad.status': [1] } },
              {
                bool: {
                  should: [
                    { bool: { filter: [
                      { term: { 'pinterest_ad.type.keyword': 'IMAGE' } },
                      { exists: { field: 'new_nas_image_url' } },
                    ] } },
                    { bool: { filter: [
                      { term: { 'pinterest_ad.type.keyword': 'VIDEO' } },
                      { exists: { field: 'thumbnail' } },
                    ] } },
                    { bool: { must_not: [{ terms: { 'pinterest_ad.type.keyword': ['IMAGE', 'VIDEO'] } }] } },
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
    logger.error('Error in getAdsCount (pinterest)', { error: err.message });
    return { code: 500, message: 'Error occurred while fetching ad count', error: err.message };
  }
}

module.exports = { getAdsCount };
