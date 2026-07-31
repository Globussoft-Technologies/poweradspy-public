'use strict';

const { getDisplayableMediaFilter } = require('../../common/helpers/displayableMediaFilters');

/**
 * Get total ad count for the Facebook platform from Elasticsearch.
 * Uses the shared displayable-media gate so the count stays aligned with the
 * same NAS/placeholder rules the live search path uses.
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
    const displayableMediaFilter = getDisplayableMediaFilter('facebook') || [];

    const result = await db.elastic.search({
      index: process.env.FB_ES_INDEX,
      body: {
        size: 0,
        track_total_hits: true,
        query: {
          bool: {
            filter: [
              { terms: { 'facebook_ad.status': [1, 5, 6] } },
              ...displayableMediaFilter,
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
