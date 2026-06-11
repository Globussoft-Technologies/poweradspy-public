'use strict';

/**
 * TikTok getAdsByAdvertiser — mirrors other networks' shape so shareAdController
 * can fetch a TikTok ad by id through the same polymorphic `adHandlers` map.
 *
 * TikTok's ad primary key in Elasticsearch is `sql_id`, so we map ad_id → sql_id.
 */

const { cleanAdsData } = require('../helpers/paramParser');

const TIKTOK_AD_SOURCE_FIELDS = [
  'sql_id', 'likes', 'comments', 'shares', 'ctr', 'popularity',
  'impression', 'ad_title', 'video_url', 'video_cover',
  'post_owner_id', 'library_url', 'industry',
  'post_owner', 'last_seen', 'budget',
];

async function getAdsByAdvertiser(req, db, logger) {
  try {
    const { ad_id } = req.body || {};
    if (!ad_id) {
      return { code: 400, message: 'ad_id is required', data: null };
    }
    if (!db?.elastic) {
      return { code: 503, message: 'Elasticsearch connection not available', data: null };
    }

    const result = await db.elastic.search({
      index: db.elastic.indexName || process.env.TT_ELASTIC_INDEX || 'tiktok_ads',
      body: {
        query: { term: { sql_id: parseInt(ad_id, 10) } },
        size: 1,
        _source: TIKTOK_AD_SOURCE_FIELDS,
      },
    });

    const hits = result.hits || result.body?.hits;
    const docs = (hits?.hits || []).map(h => h._source);
    if (!docs.length) {
      return { code: 400, message: 'No ads found', data: null };
    }

    return { code: 200, data: cleanAdsData(docs) };
  } catch (err) {
    logger?.error?.('tiktok getAdsByAdvertiser failed', { error: err.message });
    return { code: 500, message: 'Failed to fetch tiktok ad', data: null };
  }
}

module.exports = { getAdsByAdvertiser };
