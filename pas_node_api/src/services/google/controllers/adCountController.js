'use strict';

async function getAdsCount(req, db, logger) {
  if (!db.elastic) return { code: 503, message: 'Elasticsearch connection not available' };

  try {
    const result = await db.elastic.search({
      index: process.env.GOOG_ELASTIC_INDEX || 'google_ads_data_v2',
      body: {
        size: 0,
        track_total_hits: true,
        query: {
          bool: {
            filter: [
              { terms: { status: [1] } },
            ],
            must_not: [
              // Exclude IMAGE ads without NAS image. v2: `type` is keyword+
              // normalizer (lowercased) and new_nas_image_url is a plain keyword
              // (no `.keyword` sub-field).
              {
                bool: {
                  must: [
                    { term: { type: 'image' } },
                    {
                      bool: {
                        should: [
                          { bool: { must_not: [{ exists: { field: 'new_nas_image_url' } }] } },
                          { term: { new_nas_image_url: '' } },
                        ],
                      },
                    },
                  ],
                },
              },
              // Exclude ORGANIC SEARCH (term on the lowercased keyword field).
              { term: { type: 'organic search' } },
            ],
          },
        },
      },
    });

    const hits = result.hits || result.body?.hits;
    const count = typeof hits.total === 'object' ? hits.total.value : hits.total;
    return { code: 200, data: { count }, message: 'Ad count fetched successfully' };
  } catch (err) {
    logger.error('Error in getAdsCount (google)', { error: err.message });
    return { code: 500, message: 'Error occurred while fetching ad count', error: err.message };
  }
}

module.exports = { getAdsCount };
