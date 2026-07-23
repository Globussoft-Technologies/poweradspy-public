'use strict';

/**
 * Shared aggregation helpers for the Google "competitive intelligence" endpoints
 * (trends, keyword insight, advertiser profile) — the SpyFu/SEMrush-style
 * surfaces built on top of the existing `google_ads_data_v2` index.
 *
 * Design notes:
 *  - All three endpoints reuse GoogleSearchQueryBuilder so they share *identical*
 *    filter semantics with the main search (ORGANIC SEARCH + NAS-image
 *    exclusions, country/type/date filters). They only swap hits for aggregations.
 *  - `id` is the ad dedup unit; unique counts use `cardinality(id)` (same field
 *    the search builder collapses on), NOT `hits.total`, which is inflated by the
 *    ~4% duplicate docs in the index.
 *  - Field forms below are aligned to the v2 Google mapping. `country` is the
 *    aggregatable field directly on the new index, while the fallback logic
 *    below still tolerates older `.keyword` layouts if a stale worker hits one.
 */

const GoogleSearchQueryBuilder = require('../builders/GoogleSearchQueryBuilder');
const { ensureArray } = require('./paramParser');

// Centralized aggregation field names — one place to adjust per-mapping.
const AGG_FIELD = {
  advertiser: 'post_owner_lower', // dedicated lowercased keyword field for advertiser aggregation
  domain: 'domain',
  keyword: 'target_keyword',
  country: 'country',
  position: 'ad_position',
  subPosition: 'ad_sub_position',
  type: 'type',
};

const ID_PRECISION = 40000;
// Distinct-ad count: the aggregation equivalent of the search builder's collapse(id).
const UNIQUE_ADS = { cardinality: { field: 'id', precision_threshold: ID_PRECISION } };
const UNIQUE_ADVERTISERS = { cardinality: { field: AGG_FIELD.advertiser, precision_threshold: ID_PRECISION } };
const UNIQUE_DOMAINS = { cardinality: { field: AGG_FIELD.domain, precision_threshold: ID_PRECISION } };
const UNIQUE_KEYWORDS = { cardinality: { field: AGG_FIELD.keyword, precision_threshold: ID_PRECISION } };

// Cardinality-agg factory with a caller-chosen precision_threshold. The fixed
// UNIQUE_* constants above (precision 40000) are sized for the single-bucket
// Tier-1 live endpoints, where cost is proportional to matched docs, not
// bucket count. A bulk composite-agg sweep multiplies this cost by every
// bucket in the page — measured against production ES (~197M docs,
// google_ads_data_v2), 5 cardinality-family sub-aggs at precision 40000 cost
// ~18.5s for a 200-bucket page (~12h for a full 464k-keyword sweep); the same
// sub-aggs at precision 1000 cost ~300-370ms for a 1000-bucket page (~3min
// full sweep). Use this factory for anything that runs per-bucket at scale.
function cardinalityAgg(field, precisionThreshold) {
  return { cardinality: { field, precision_threshold: precisionThreshold } };
}

// Domains that are ad-network redirects (unresolved aclk), not the real
// advertiser landing domain — noise in any "top domains" view.
const REDIRECT_DOMAINS = ['googleadservices.com', 'google.com'];

function readAggs(esResult) {
  return esResult?.aggregations || esResult?.body?.aggregations || null;
}

function readHits(esResult) {
  const hits = esResult?.hits || esResult?.body?.hits;
  return (hits && hits.hits) || [];
}

// ES 6.8 uses `interval` (not `calendar_interval`); whitelist + matching format.
function resolveInterval(v) {
  const i = String(v || 'month').toLowerCase();
  const map = {
    day: { interval: 'day', format: 'yyyy-MM-dd' },
    week: { interval: 'week', format: 'yyyy-MM-dd' },
    month: { interval: 'month', format: 'yyyy-MM' },
    quarter: { interval: 'quarter', format: 'yyyy-MM' },
    year: { interval: 'year', format: 'yyyy' },
  };
  return map[i] || map.month;
}

function clampSize(v, def, max) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(n, max);
}

// Only date-only fields are accepted to avoid `last_seen <-> first_seen` typos
// silently producing empty histograms.
function resolveDateField(v) {
  const f = String(v || 'last_seen').toLowerCase();
  return ['last_seen', 'first_seen', 'post_date'].includes(f) ? f : 'last_seen';
}

/**
 * Build the base ES filter query from a search-style payload, reusing the
 * production search builder. Returns the `bool` query object. Extra exact
 * filter clauses (e.g. a specific advertiser) can be appended.
 */
function buildBaseQuery(p, indexName, extraFilters = []) {
  const builder = new GoogleSearchQueryBuilder(indexName);

  if (p.keyword) builder.setKeyword(p.keyword);
  if (p.advertiser) builder.setPostOwnerName(p.advertiser);
  if (p.domain) builder.setUrl(p.domain);
  if (p.country) builder.setCountry(ensureArray(p.country));
  if (p.type) builder.setAdType(ensureArray(p.type));
  if (p.target_keyword) builder.setTargetKeyword(ensureArray(p.target_keyword));
  if (p.target_keywords) builder.setTargetKeyword(ensureArray(p.target_keywords));
  if (p.ad_position) builder.setAdPosition(ensureArray(p.ad_position));
  if (p.ad_sub_position) builder.setAdSubPosition(ensureArray(p.ad_sub_position));
  if (p.source) builder.setSource(ensureArray(p.source));

  // Date range applies to last_seen (the field the search/year aggs use).
  if (p.from_date && p.to_date) {
    builder.setLastSeen({
      lower_date: `${p.from_date} 00:00:00`,
      upper_date: `${p.to_date} 23:59:59`,
    });
  }

  const { body } = builder.build();
  const query = body.query;

  if (extraFilters.length) {
    query.bool = query.bool || {};
    query.bool.filter = query.bool.filter || [];
    query.bool.filter.push(...extraFilters);
  }
  return query;
}

// terms agg that ranks by distinct-ad count rather than raw doc_count.
// `exclude` drops exact term values (e.g. REDIRECT_DOMAINS) before ranking.
function termsByUniqueAds(field, size, extraAggs = {}, exclude = null) {
  const terms = { field, size, order: { ads: 'desc' } };
  if (exclude && exclude.length) terms.exclude = exclude;
  return {
    terms,
    aggs: { ads: UNIQUE_ADS, ...extraAggs },
  };
}

/**
 * Country aggregation with mapping-divergence fallback.
 *
 * Confirmed divergence: on some indices the populated aggregatable country
 * field is `country.keyword` (the form adInsightsController uses in prod), on
 * others it is bare `country` (verified populated on the gtext dev index, where
 * `country.keyword` is empty). Bare `country` may be a text field WITHOUT
 * fielddata on prod, so aggregating it there throws — which is why this runs as
 * its own try/catch request rather than inline in the main agg (a throw must
 * not take down the whole profile). Tries the keyword sub-field first, falls
 * back to bare `country` only if it returns empty or is unavailable.
 */
async function fetchCountrySpread(elastic, index, query, size, logger) {
  for (const field of ['country', 'country.keyword']) {
    try {
      const esResult = await elastic.search({
        index,
        filter_path: 'aggregations.country_spread.buckets',
        body: {
          size: 0,
          track_total_hits: false,
          query,
          aggs: { country_spread: termsByUniqueAds(field, size) },
        },
      });
      const buckets = readAggs(esResult)?.country_spread?.buckets || [];
      if (buckets.length) return buckets;
    } catch (err) {
      // e.g. "Fielddata is disabled on text fields" for bare `country` on prod.
      if (logger) logger.warn('country_spread agg failed; trying next field', { field, error: err.message });
    }
  }
  return [];
}

// Map a terms-by-unique-ads bucket array → a clean list. Each item carries a
// uniform `key` (for generic consumers) AND a type-named alias (`keyName`, e.g.
// `advertiser`/`domain`/`position`) for readability; `display` is the resolved
// human label when a top_hits name sub-agg was attached (advertisers).
function mapTermBuckets(buckets, keyName = 'key') {
  return (buckets || []).map((b) => {
    const display = b.name?.hits?.hits?.[0]?._source?.post_owner_name;
    return {
      key: b.key,
      [keyName]: b.key,
      ads: b.ads?.value ?? b.doc_count ?? 0,
      ...(display ? { display } : {}),
    };
  });
}

// Two-window "trailing 30d vs prior 30d" filter aggs, wrapping a cardinality
// agg — used by refreshKeywordStats.js to derive a growth_pct without a
// second query. `now` is injectable for deterministic tests; defaults to the
// real clock. `cardinalityAgg` defaults to UNIQUE_ADS (precision 40000, fine
// for the single-bucket Tier-1 live endpoints) but a bulk composite-agg sweep
// over hundreds of thousands of buckets should pass a much cheaper one — see
// refreshKeywordStats.js's BULK_UNIQUE_ADS (precision 40000 there measured at
// ~18s/200-bucket page against production ES; precision 1000 measured
// ~300ms/1000-bucket page for the same full sub-agg set).
function last2WindowAggs(dateField = 'last_seen', now = new Date(), cardinalityAgg = UNIQUE_ADS) {
  const day = 24 * 60 * 60 * 1000;
  const iso = (d) => d.toISOString().slice(0, 19).replace('T', ' ');
  const d0 = new Date(now.getTime());
  const d30 = new Date(now.getTime() - 30 * day);
  const d60 = new Date(now.getTime() - 60 * day);
  return {
    ads_30d: { filter: { range: { [dateField]: { gte: iso(d30), lte: iso(d0) } } }, aggs: { ads: cardinalityAgg } },
    ads_prior_30d: { filter: { range: { [dateField]: { gte: iso(d60), lt: iso(d30) } } }, aggs: { ads: cardinalityAgg } },
  };
}

// A small terms sub-agg used purely to pick a "majority" bucket (category,
// sub-category, dominant ad type, top country) per composite-agg key —
// size is intentionally small since only the top bucket is read.
function majorityTermsAgg(field, size = 3) {
  return { terms: { field, size } };
}

// Highest-doc_count bucket key from a terms-agg bucket array, or null.
function majorityBucketKey(buckets) {
  if (!buckets || !buckets.length) return null;
  return buckets.reduce((best, b) => (b.doc_count > (best?.doc_count ?? -1) ? b : best), null)?.key ?? null;
}

module.exports = {
  AGG_FIELD,
  ID_PRECISION,
  UNIQUE_ADS,
  UNIQUE_ADVERTISERS,
  UNIQUE_DOMAINS,
  UNIQUE_KEYWORDS,
  REDIRECT_DOMAINS,
  readAggs,
  readHits,
  resolveInterval,
  resolveDateField,
  clampSize,
  buildBaseQuery,
  termsByUniqueAds,
  mapTermBuckets,
  fetchCountrySpread,
  last2WindowAggs,
  majorityTermsAgg,
  majorityBucketKey,
  cardinalityAgg,
};
