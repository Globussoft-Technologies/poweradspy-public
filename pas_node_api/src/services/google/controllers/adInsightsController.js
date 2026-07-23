'use strict';

const { normalizeParams } = require('../helpers/paramParser');

// ─── 1. getGoogleAdCountry ──────────────────────────────

const COUNTRY_SQL = `
  SELECT google_text_country_only.country, country_data.iso
  FROM google_text_ad_countries_only
  LEFT JOIN google_text_country_only ON google_text_ad_countries_only.country_only_id = google_text_country_only.id
  LEFT JOIN country_data ON google_text_country_only.country = country_data.nicename
  WHERE google_text_ad_countries_only.google_text_ad_id = ?
    AND google_text_country_only.country IS NOT NULL
`;

function fixCountryIso(country, iso) {
  const name = (country || '').toLowerCase();
  if (country === 'Czechia') return 'CZ';
  if (country === 'Russia') return 'RU';
  if (name.includes('congo') && (!iso || iso === 'null')) return 'CD';
  if (country === 'South Sudan') return 'SD';
  if (country === 'South Korea') return 'KP';
  if (country === 'Syria') return 'SY';
  if (country === 'Tanzania') return 'TZ';
  return iso;
}

async function getGoogleAdCountry(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.google_text_ad_id || !p.user_id) {
    return { code: 401, message: 'Missing parameters: google_text_ad_id and user_id are required' };
  }
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const rows = await db.sql.query(COUNTRY_SQL, [parseInt(p.google_text_ad_id, 10)]);
    if (!rows || rows.length === 0) return { code: 400, message: 'No data found.' };

    const resArray = rows.map(row => ({
      country: row.country ? row.country.replace(/\b\w/g, c => c.toUpperCase()) : row.country,
      iso: fixCountryIso(row.country, row.iso),
    }));

    return { code: 200, message: 'Google country data fetched.', data: resArray };
  } catch (err) {
    logger.error('Error in getGoogleAdCountry', { error: err.message });
    return { code: 500, message: 'Error fetching country data', error: err.message };
  }
}

// ─── 2. getGoogleOutgoings ──────────────────────────────

const OUTGOING_SQL = `
  SELECT source_url, redirect_url, final_url
  FROM google_ad_outgoing_links
  WHERE google_text_ad_id = ?
`;

async function getGoogleOutgoings(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.ad_id) return { code: 401, message: 'Missing parameters: ad_id is required' };
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const rows = await db.sql.query(OUTGOING_SQL, [p.ad_id]);
    if (rows && rows.length > 0) return { code: 200, data: rows };
    return { code: 400, data: [] };
  } catch (err) {
    logger.error('Error in getGoogleOutgoings', { error: err.message });
    return { code: 401, data: [] };
  }
}

// ─── 3. Advertiser-level helpers ────────────────────────

const AD_META_SQL = `
  SELECT gta.last_seen, gtapo.post_owner_name, gta.post_owner_id
  FROM google_text_ad gta
  JOIN google_text_ad_post_owners gtapo ON gta.post_owner_id = gtapo.id
  WHERE gta.id = ?
  LIMIT 1
`;

// Country is a small, bounded dimension (~250 ISO countries worldwide), so a
// terms bucket of 500 covers the entire universe with zero truncation. We do
// NOT aggregate on post_owner_name (it's a text-analyzed field used only for
// the match_phrase filter) — only on `country`, which on the v2 index is a
// keyword field directly (aggregatable; no `.keyword` sub-field). `id` is the
// ad's unique key (ES _id), aggregatable for the distinct-ad cardinality.
const COUNTRY_TERMS_SIZE = 500;
const ID_CARDINALITY_PRECISION = 40000;

function getYearRange(year) {
  return {
    gte: `${year}-01-01 00:00:00`,
    lte: `${year}-12-31 23:59:59`,
    format: "yyyy-MM-dd' 'HH:mm:ss",
  };
}

function getCustomDateRange(from, to) {
  return {
    gte: `${from} 00:00:00`,
    lte: `${to} 23:59:59`,
    format: "yyyy-MM-dd' 'HH:mm:ss",
  };
}

// Both ES 6.8 (`res.aggregations`) and the 7.x client wrapper
// (`res.body.aggregations`) shapes are tolerated, mirroring the dual-shape
// reads used elsewhere in this controller / adSearchController.
function readAggs(esResult) {
  return esResult?.aggregations || esResult?.body?.aggregations || null;
}

async function fetchAvailableYears(elastic, index, filter) {
  // Use a date_histogram aggregation instead of pulling 10k docs and computing
  // distinct years in JS. The aggregation returns one bucket per year that has
  // at least one ad — typically a few hundred bytes total, regardless of how
  // many ads the advertiser has. `size: 0` means ES skips hits entirely.
  try {
    const esResult = await elastic.search({
      index,
      body: {
        size: 0,
        query: { bool: { filter: [filter] } },
        aggs: {
          years: {
            date_histogram: {
              field: 'last_seen',
              // `interval` (not `calendar_interval`) for compatibility with
              // ES < 7.2 in production. `calendar_interval` is the modern
              // spelling, but it's rejected by older clusters with
              // "unknown field [calendar_interval], parser not found".
              // `interval: 'year'` works on every ES version we target.
              interval: 'year',
              format: 'yyyy',
              min_doc_count: 1,
            },
          },
        },
      },
    });

    const buckets = readAggs(esResult)?.years?.buckets || [];

    return buckets
      .map(b => parseInt(b.key_as_string, 10))
      .filter(y => Number.isFinite(y) && y > 1970)
      .sort((a, b) => b - a);
  } catch {
    return [];
  }
}

// Scalable, non-truncated advertiser-country aggregation.
// Replaces the previous size:10000 `_source`/docvalue pull + JS `Set`
// bucketing, which truncated advertisers with >10k ads. A single
// `terms(country)` → `cardinality(id)` aggregation returns one bucket
// per country with an accurate distinct-ad count regardless of advertiser
// size, transferring only a few KB.
async function fetchCountryAgg(elastic, index, filterClauses) {
  const esResult = await elastic.search({
    index,
    // We only need the aggregation, never hits.
    filter_path: 'aggregations.by_country.buckets',
    body: {
      size: 0,
      track_total_hits: false,
      query: { bool: { filter: filterClauses } },
      aggs: {
        by_country: {
          terms: {
            field: 'country',
            size: COUNTRY_TERMS_SIZE,
            order: { unique_ads: 'desc' },
          },
          aggs: {
            // distinct ad ids in this country — the JS-Set equivalent.
            unique_ads: {
              cardinality: { field: 'id', precision_threshold: ID_CARDINALITY_PRECISION },
            },
          },
        },
      },
    },
  });

  return readAggs(esResult)?.by_country?.buckets || [];
}

// Map ES terms-agg buckets → the legacy response shape:
//   [{ country, iso, ad_ids, ad_count }]
// `ad_ids` is kept (empty) for response-shape compatibility — the only
// consumer (new-ui-react transformAdvertiserCountry) reads `ad_count` first
// and only falls back to `ad_ids.length`, so a populated `ad_count` is
// sufficient and the per-country id list is no longer materialised.
async function aggregateCountryBuckets(db, buckets) {
  if (!buckets || buckets.length === 0) return null;

  const names = buckets.map(b => b.key).filter(Boolean);
  if (names.length === 0) return null;

  const isoMap = await batchCountryLookup(db, names);

  const result = [];
  for (const b of buckets) {
    const name = b.key;
    if (!name) continue;
    const adCount = b.unique_ads?.value ?? b.doc_count ?? 0;
    if (!adCount) continue;

    const lookup = isoMap.get(name);
    let country = lookup?.country || name;
    let iso = lookup?.iso || null;

    iso = fixCountryIso(country, iso);
    if (country) country = country.replace(/\b\w/g, c => c.toUpperCase());

    result.push({ country, iso, ad_ids: [], ad_count: adCount });
  }

  // terms agg already orders by unique_ads desc, but re-sort defensively in
  // case the lookup collapsed names.
  result.sort((a, b) => b.ad_count - a.ad_count);
  return result.length > 0 ? result : null;
}

async function batchCountryLookup(db, names) {
  if (!db.sql || !names || names.length === 0) return new Map();
  const uniqueNames = [...new Set(names)];
  const placeholders = uniqueNames.map(() => '?').join(',');
  try {
    const rows = await db.sql.query(
      `SELECT nicename, name AS country, iso FROM country_data WHERE nicename IN (${placeholders})`,
      uniqueNames
    );
    const map = new Map();
    if (rows) {
      for (const row of rows) map.set(row.nicename, { country: row.country, iso: row.iso });
    }
    return map;
  } catch {
    return new Map();
  }
}

// ─── 4. getAdvertiserCountryData ────────────────────────

/**
 * Fetch advertiser-level country data. Default to ad's year.
 */
async function getAdvertiserCountryData(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);
  if (!p.google_text_ad_id) return { code: 401, message: 'Missing google_text_ad_id', data: null };

  const metaRows = await db.sql.query(AD_META_SQL, [p.google_text_ad_id]);
  const postOwnerName = metaRows?.[0]?.post_owner_name || null;
  const postOwnerId = metaRows?.[0]?.post_owner_id || null;
  const adLastSeen = metaRows?.[0]?.last_seen || null;

  if (!postOwnerName || !db.elastic) return { code: 400, message: 'Advertiser not found', data: null };

  const adYear = p.year || (adLastSeen ? new Date(adLastSeen).getFullYear() : new Date().getFullYear());
  const dateRange = getYearRange(adYear);
  const index = db.elastic?.indexName || process.env.GOOG_ELASTIC_INDEX || 'google_ads_data_v2';

  const advertiserFilter = { match_phrase: { post_owner_name: postOwnerName } };
  const filterClauses = [advertiserFilter, { range: { last_seen: dateRange } }];

  const [availableYears, countryAgg] = await Promise.allSettled([
    fetchAvailableYears(db.elastic, index, advertiserFilter),
    // Scalable terms+cardinality aggregation — no 10k hit cap.
    fetchCountryAgg(db.elastic, index, filterClauses),
  ]);

  const years = availableYears.status === 'fulfilled' ? availableYears.value : [];
  const buckets = countryAgg.status === 'fulfilled' ? countryAgg.value : [];

  if (!buckets || buckets.length === 0) {
    return {
      code: 200,
      message: 'No data found for this year.',
      post_owner_id: postOwnerId,
      year: adYear,
      available_years: years,
      data: [],
    };
  }

  const data = await aggregateCountryBuckets(db, buckets);

  return {
    code: 200,
    message: 'Advertiser country data fetched.',
    post_owner_id: postOwnerId,
    year: adYear,
    available_years: years,
    data: data || [],
  };
}

// ─── 5. getAdvertiserInsightsByDateRange ────────────────

async function getAdvertiserInsightsByDateRange(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  const { post_owner_id, from_date, to_date, type } = p;
  if (!post_owner_id || !from_date || !to_date) {
    return { code: 401, message: 'Missing parameters: post_owner_id, from_date, to_date are required' };
  }

  const advertiserRows = await db.sql.query(
    `SELECT post_owner_name FROM google_text_ad_post_owners WHERE id = ? LIMIT 1`,
    [post_owner_id]
  );
  const postOwnerName = advertiserRows?.[0]?.post_owner_name;
  if (!postOwnerName || !db.elastic) return { code: 400, message: 'Advertiser not found' };

  const dateRange = getCustomDateRange(from_date, to_date);
  const base = { from_date, to_date, post_owner_id };
  const index = db.elastic?.indexName || process.env.GOOG_ELASTIC_INDEX || 'google_ads_data_v2';

  // For Google/GDN etc, we only support country in this specific request context
  const targetType = (type || 'country').toLowerCase();

  if (targetType === 'country') {
    const filterClauses = [
      { match_phrase: { post_owner_name: postOwnerName } },
      { range: { last_seen: dateRange } },
    ];

    let buckets = [];
    try {
      buckets = await fetchCountryAgg(db.elastic, index, filterClauses);
    } catch (err) {
      if (logger) logger.error('Error in getAdvertiserInsightsByDateRange country agg', { error: err.message });
      return { code: 400, message: 'No data found.', ...base, data: [] };
    }

    if (!buckets || buckets.length === 0) return { code: 400, message: 'No data found.', ...base, data: [] };

    const data = await aggregateCountryBuckets(db, buckets);
    return { code: 200, message: 'Advertiser country data fetched.', ...base, data: data || [] };
  }

  return { code: 400, message: `Insight type '${targetType}' not supported for this platform.` };
}

module.exports = {
  getGoogleAdCountry,
  getGoogleOutgoings,
  getAdvertiserCountryData,
  getAdvertiserInsightsByDateRange,
};
