'use strict';

/**
 * Google ad TRENDS — time-series of ad activity for any search/filter context.
 *
 * POST /api/v1/google/ads/trends
 *
 * Accepts the same filter payload as /ads/search (keyword, advertiser, domain,
 * country, type, target_keyword, ad_position, ad_sub_position, source,
 * from_date/to_date) plus:
 *   - interval:   day | week | month | quarter | year   (default month)
 *   - date_field: last_seen | first_seen | post_date     (default last_seen)
 *   - split:      none | sub_position | position | type  (default none)
 *
 * Returns one point per interval bucket with distinct-ad and distinct-advertiser
 * counts — the foundation for every timeline (advertiser ad-count over time,
 * keyword competition over time, SERP top/bottom share over time).
 */

const { normalizeParams } = require('../helpers/paramParser');
const {
  AGG_FIELD,
  UNIQUE_ADS,
  UNIQUE_ADVERTISERS,
  readAggs,
  resolveInterval,
  resolveDateField,
  buildBaseQuery,
} = require('../helpers/aggregations');

const SPLIT_FIELD = {
  sub_position: AGG_FIELD.subPosition,
  position: AGG_FIELD.position,
  type: AGG_FIELD.type,
};

async function getAdTrends(req, db, logger) {
  const p = normalizeParams({ ...req.body, ...req.query });
  if (!db.elastic) return { code: 503, message: 'Elasticsearch connection not available' };

  const index = db.elastic?.indexName || process.env.GOOG_ELASTIC_INDEX || 'google_ads_data_v2';
  const { interval, format } = resolveInterval(p.interval);
  const dateField = resolveDateField(p.date_field);
  const splitField = SPLIT_FIELD[String(p.split || '').toLowerCase()] || null;

  const query = buildBaseQuery(p, index);

  const histAggs = { ads: UNIQUE_ADS, advertisers: UNIQUE_ADVERTISERS };
  if (splitField) {
    histAggs.split = { terms: { field: splitField, size: 10 }, aggs: { ads: UNIQUE_ADS } };
  }

  const body = {
    size: 0,
    track_total_hits: false,
    query,
    aggs: {
      trend: {
        date_histogram: { field: dateField, interval, format, min_doc_count: 1 },
        aggs: histAggs,
      },
    },
  };

  try {
    const esResult = await db.elastic.search({
      index,
      filter_path: 'aggregations.trend.buckets',
      body,
    });
    const buckets = readAggs(esResult)?.trend?.buckets || [];

    const points = buckets.map((b) => {
      const point = {
        date: b.key_as_string,
        ads: b.ads?.value ?? b.doc_count ?? 0,
        advertisers: b.advertisers?.value ?? 0,
      };
      if (splitField) {
        point.split = (b.split?.buckets || []).map((s) => ({
          key: s.key,
          ads: s.ads?.value ?? s.doc_count ?? 0,
        }));
      }
      return point;
    });

    return {
      code: 200,
      message: 'Trend data fetched.',
      data: { interval, date_field: dateField, split: splitField ? p.split : null, points },
    };
  } catch (err) {
    logger.error('Error in getAdTrends (google)', { error: err.message });
    return { code: 500, message: 'Error fetching trend data', error: err.message };
  }
}

module.exports = { getAdTrends };
