'use strict';

/**
 * Keyword Explorer — competitive board for a single bidding keyword.
 *
 * POST /api/v1/google/keywords/insight
 *
 * Body:
 *   - keyword           (required) the bidding keyword to analyze (target_keyword)
 *   - from_date/to_date (optional) yyyy-MM-dd range on last_seen
 *   - country           (optional) restrict to a country
 *   - top_n             (optional) advertisers/domains to return (default 20, max 100)
 *   - interval          (optional) trend bucketing (default month)
 *   - creatives         (optional) number of sample SERP creatives (default 12, max 50)
 *
 * Returns, in a single ES round-trip: total advertisers/domains/ads competing on
 * the keyword, the top advertisers and landing domains ranked by distinct ads,
 * the TOP/BOTTOM SERP-slot mix, an ad-count + advertiser-count trend, and a
 * sample of live (deduped) creatives for the SERP-styled wall.
 */

const { normalizeParams, cleanAdsData } = require('../helpers/paramParser');
const {
  AGG_FIELD,
  UNIQUE_ADS,
  UNIQUE_ADVERTISERS,
  UNIQUE_DOMAINS,
  readAggs,
  readHits,
  resolveInterval,
  clampSize,
  buildBaseQuery,
  termsByUniqueAds,
  mapTermBuckets,
  REDIRECT_DOMAINS,
} = require('../helpers/aggregations');

const CREATIVE_SOURCE = [
  'id', 'ad_id', 'ad_title', 'title', 'ad_text', 'text', 'newsfeed_description',
  'post_owner_name', 'domain', 'destination_url', 'target_keyword',
  'ad_position', 'ad_sub_position', 'country', 'first_seen', 'last_seen', 'days_running',
];

async function getKeywordInsight(req, db, logger) {
  const p = normalizeParams({ ...req.body, ...req.query });
  if (!p.keyword) return { code: 400, message: 'Missing parameter: keyword is required' };
  if (!db.elastic) return { code: 503, message: 'Elasticsearch connection not available' };

  const index = db.elastic?.indexName || process.env.GOOG_ELASTIC_INDEX || 'google_ads_data_v2';
  const topN = clampSize(p.top_n, 20, 100);
  const creativeN = clampSize(p.creatives, 12, 50);
  const { interval, format } = resolveInterval(p.interval);

  // The keyword is the *bidding* keyword (target_keyword), not free-text ad copy.
  const query = buildBaseQuery({ target_keyword: p.keyword, country: p.country, from_date: p.from_date, to_date: p.to_date }, index);

  const body = {
    size: creativeN,
    track_total_hits: false,
    collapse: { field: 'id' }, // dedupe sample creatives by ad id
    _source: CREATIVE_SOURCE,
    sort: [{ last_seen: 'desc' }, { id: 'desc' }],
    query,
    aggs: {
      total_ads: UNIQUE_ADS,
      advertiser_count: UNIQUE_ADVERTISERS,
      // Distinct landing domains — EXCLUDING the same redirect/ad-service domains
      // (REDIRECT_DOMAINS: googleadservices.com/google.com) that the Top Domains
      // list below drops. Without this filter the headline count includes those
      // noise domains while the list hides them, so the number never matched the
      // list (e.g. count 2 vs 1 shown). Filtered cardinality keeps them consistent.
      domain_count: {
        filter: { bool: { must_not: [{ terms: { [AGG_FIELD.domain]: REDIRECT_DOMAINS } }] } },
        aggs: { unique: UNIQUE_DOMAINS },
      },
      top_advertisers: termsByUniqueAds(AGG_FIELD.advertiser, topN, {
        // resolve the lowercased agg key back to a display name
        name: { top_hits: { size: 1, _source: ['post_owner_name'] } },
      }),
      top_domains: termsByUniqueAds(AGG_FIELD.domain, topN, {}, REDIRECT_DOMAINS),
      position_mix: termsByUniqueAds(AGG_FIELD.subPosition, 5),
      trend: {
        date_histogram: { field: 'last_seen', interval, format, min_doc_count: 1 },
        aggs: { ads: UNIQUE_ADS, advertisers: UNIQUE_ADVERTISERS },
      },
    },
  };

  try {
    const esResult = await db.elastic.search({ index, body });
    const aggs = readAggs(esResult) || {};
    const creatives = readHits(esResult).map((h) => h._source);

    return {
      code: 200,
      message: 'Keyword insight fetched.',
      data: {
        keyword: p.keyword,
        summary: {
          ads: aggs.total_ads?.value ?? 0,
          advertisers: aggs.advertiser_count?.value ?? 0,
          domains: aggs.domain_count?.unique?.value ?? 0,
        },
        top_advertisers: mapTermBuckets(aggs.top_advertisers?.buckets, 'advertiser'),
        top_domains: mapTermBuckets(aggs.top_domains?.buckets, 'domain'),
        position_mix: mapTermBuckets(aggs.position_mix?.buckets, 'position'),
        trend: (aggs.trend?.buckets || []).map((b) => ({
          date: b.key_as_string,
          ads: b.ads?.value ?? 0,
          advertisers: b.advertisers?.value ?? 0,
        })),
        creatives: cleanAdsData(creatives),
      },
    };
  } catch (err) {
    logger.error('Error in getKeywordInsight (google)', { error: err.message });
    return { code: 500, message: 'Error fetching keyword insight', error: err.message };
  }
}

module.exports = { getKeywordInsight };
