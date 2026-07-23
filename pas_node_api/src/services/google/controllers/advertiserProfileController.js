'use strict';

/**
 * Advertiser Profile — full competitive profile for one advertiser.
 *
 * POST /api/v1/google/advertiser/profile
 *
 * Body (one of post_owner_id / post_owner_name required):
 *   - post_owner_id     advertiser id (google_text_ad_post_owners.id)
 *   - post_owner_name   advertiser name (used directly if id not given)
 *   - from_date/to_date (optional) yyyy-MM-dd range on last_seen
 *   - top_n             (optional) keywords/domains to return (default 25, max 100)
 *   - interval          (optional) trend bucketing (default month)
 *   - creatives         (optional) sample creatives (default 12, max 50)
 *
 * Returns: summary (distinct ads/keywords/domains + active window), keyword
 * portfolio, top landing domains, SERP-position mix, country spread, ad-count
 * trend, and a sample creative gallery — all from the index, no 10k cap.
 */

const { normalizeParams, cleanAdsData } = require('../helpers/paramParser');
const {
  AGG_FIELD,
  UNIQUE_ADS,
  UNIQUE_KEYWORDS,
  UNIQUE_DOMAINS,
  readAggs,
  readHits,
  resolveInterval,
  clampSize,
  buildBaseQuery,
  termsByUniqueAds,
  mapTermBuckets,
  fetchCountrySpread,
  REDIRECT_DOMAINS,
} = require('../helpers/aggregations');

const COUNTRY_TERMS_SIZE = 250;
const CREATIVE_SOURCE = [
  'id', 'ad_id', 'ad_title', 'title', 'ad_text', 'text', 'newsfeed_description',
  'post_owner_name', 'domain', 'destination_url', 'target_keyword',
  'ad_position', 'ad_sub_position', 'country', 'first_seen', 'last_seen', 'days_running',
];

async function resolveAdvertiserName(p, db) {
  if (p.post_owner_name) return p.post_owner_name;
  if (p.post_owner_id && db.sql) {
    const rows = await db.sql.query(
      'SELECT post_owner_name FROM google_text_ad_post_owners WHERE id = ? LIMIT 1',
      [p.post_owner_id]
    );
    return rows?.[0]?.post_owner_name || null;
  }
  return null;
}

async function getAdvertiserProfile(req, db, logger) {
  const p = normalizeParams({ ...req.body, ...req.query });
  if (!p.post_owner_id && !p.post_owner_name) {
    return { code: 400, message: 'Missing parameter: post_owner_id or post_owner_name is required' };
  }
  if (!db.elastic) return { code: 503, message: 'Elasticsearch connection not available' };

  const advertiserName = await resolveAdvertiserName(p, db);
  if (!advertiserName) return { code: 404, message: 'Advertiser not found' };

  const index = db.elastic?.indexName || process.env.GOOG_ELASTIC_INDEX || 'google_ads_data_v2';
  const topN = clampSize(p.top_n, 25, 100);
  const creativeN = clampSize(p.creatives, 12, 50);
  const { interval, format } = resolveInterval(p.interval);

  // Exact advertiser match on the lowercased keyword field (vs the search
  // builder's fuzzy prefix match — a profile must be one advertiser only).
  const exactAdvertiser = { term: { [AGG_FIELD.advertiser]: advertiserName.toLowerCase() } };
  const query = buildBaseQuery(
    { country: p.country, from_date: p.from_date, to_date: p.to_date },
    index,
    [exactAdvertiser]
  );

  const body = {
    size: creativeN,
    track_total_hits: false,
    collapse: { field: 'id' },
    _source: CREATIVE_SOURCE,
    sort: [{ last_seen: 'desc' }, { id: 'desc' }],
    query,
    aggs: {
      total_ads: UNIQUE_ADS,
      keyword_count: UNIQUE_KEYWORDS,
      domain_count: UNIQUE_DOMAINS,
      first_seen: { min: { field: 'first_seen' } },
      last_seen: { max: { field: 'last_seen' } },
      keyword_portfolio: termsByUniqueAds(AGG_FIELD.keyword, topN),
      top_domains: termsByUniqueAds(AGG_FIELD.domain, topN, {}, REDIRECT_DOMAINS),
      position_mix: termsByUniqueAds(AGG_FIELD.subPosition, 5),
      trend: {
        date_histogram: { field: 'last_seen', interval, format, min_doc_count: 1 },
        aggs: { ads: UNIQUE_ADS },
      },
    },
  };

  try {
    // Country spread runs as its own request (mapping-divergence fallback), in
    // parallel with the main aggregation; a country failure can't break the profile.
    const [esResult, countryBuckets] = await Promise.all([
      db.elastic.search({ index, body }),
      fetchCountrySpread(db.elastic, index, query, COUNTRY_TERMS_SIZE, logger),
    ]);
    const aggs = readAggs(esResult) || {};
    const creatives = readHits(esResult).map((h) => h._source);

    return {
      code: 200,
      message: 'Advertiser profile fetched.',
      data: {
        advertiser: advertiserName,
        post_owner_id: p.post_owner_id || null,
        summary: {
          ads: aggs.total_ads?.value ?? 0,
          keywords: aggs.keyword_count?.value ?? 0,
          domains: aggs.domain_count?.value ?? 0,
          first_seen: aggs.first_seen?.value_as_string || null,
          last_seen: aggs.last_seen?.value_as_string || null,
        },
        keyword_portfolio: mapTermBuckets(aggs.keyword_portfolio?.buckets, 'keyword'),
        top_domains: mapTermBuckets(aggs.top_domains?.buckets, 'domain'),
        position_mix: mapTermBuckets(aggs.position_mix?.buckets, 'position'),
        country_spread: mapTermBuckets(countryBuckets, 'country'),
        trend: (aggs.trend?.buckets || []).map((b) => ({
          date: b.key_as_string,
          ads: b.ads?.value ?? 0,
        })),
        creatives: cleanAdsData(creatives),
      },
    };
  } catch (err) {
    logger.error('Error in getAdvertiserProfile (google)', { error: err.message });
    return { code: 500, message: 'Error fetching advertiser profile', error: err.message };
  }
}

module.exports = { getAdvertiserProfile };
