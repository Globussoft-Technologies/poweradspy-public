'use strict';

const { normalizeParams } = require('../helpers/paramParser');

// ─── 1. getPinterestAdCountry ───────────────────────────

const COUNTRY_SQL = `
  SELECT pinterest_country_only.country, pinterest_ad_countries_only.pinterest_ad_id, country_data.iso
  FROM pinterest_ad_countries_only
  LEFT JOIN pinterest_country_only ON pinterest_ad_countries_only.country_only_id = pinterest_country_only.id
  LEFT JOIN country_data ON pinterest_country_only.country = country_data.nicename
  WHERE pinterest_ad_countries_only.pinterest_ad_id = ?
    AND pinterest_country_only.country IS NOT NULL
`;

function fixCountryIso(country, iso) {
  const name = (country || '').toLowerCase();
  if (country === 'Czechia') return 'CZ';
  if (country === 'Russia') return 'RU';
  if (!iso || iso === 'null') {
    if (
      name === 'congo - brazzaville' ||
      name === 'republic of the congo' ||
      name === 'republic of congo' ||
      name === 'congo republic' ||
      name === 'congo'
    ) return 'CG';
    if (
      name === 'congo - kinshasa' ||
      name === 'dr congo' ||
      name === 'democratic republic of the congo' ||
      name === 'democratic republic of congo'
    ) return 'CD';
  }
  return iso;
}

// Pinterest stores multi-country ads as CSV strings (e.g. "Poland,Finland,Cyprus")
// in both MySQL `pinterest_country_only.country` and the ES mirror. Split on
// commas, trim whitespace, drop empties, and normalise case so downstream ISO
// lookup and de-duping work on clean single-country tokens.
function splitCountryTokens(value) {
  if (value == null) return [];
  const parts = Array.isArray(value) ? value : [value];
  const out = [];
  const seen = new Set();
  for (const p of parts) {
    if (p == null) continue;
    for (const raw of String(p).split(',')) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const normalised = trimmed.replace(/\b\w+/g, w =>
        w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
      );
      if (seen.has(normalised)) continue;
      seen.add(normalised);
      out.push(normalised);
    }
  }
  return out;
}

async function getPinterestAdCountry(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.pinterest_ad_id || !p.user_id) {
    return { code: 401, message: 'Missing parameters: pinterest_ad_id and user_id are required' };
  }
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const rows = await db.sql.query(COUNTRY_SQL, [parseInt(p.pinterest_ad_id, 10)]);
    if (!rows || rows.length === 0) return { code: 400, message: 'No data found.' };

    // Some rows arrive as CSV blobs ("Poland,Finland,Cyprus,..."); split into
    // individual countries and resolve each ISO via country_data.
    const tokens = [];
    const seen = new Set();
    for (const row of rows) {
      for (const t of splitCountryTokens(row.country)) {
        if (seen.has(t)) continue;
        seen.add(t);
        tokens.push(t);
      }
    }
    if (tokens.length === 0) return { code: 400, message: 'No data found.' };

    const isoMap = await batchCountryLookup(db, tokens);
    const resArray = tokens.map(name => {
      const lookup = isoMap.get(name);
      const country = lookup?.country || name;
      const iso = fixCountryIso(country, lookup?.iso || null);
      return { country, iso };
    });

    return { code: 200, message: 'Pinterest country data fetched.', data: resArray };
  } catch (err) {
    logger.error('Error in getPinterestAdCountry', { error: err.message });
    return { code: 500, message: 'Error fetching country data', error: err.message };
  }
}

// ─── 2. getPinterestOutgoings ───────────────────────────

const OUTGOING_SQL = `
  SELECT source_url, redirect_url, final_url
  FROM pinterest_ad_outgoing_links
  WHERE pinterest_ad_id = ?
`;

async function getPinterestOutgoings(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.pinterest_ad_id) return { code: 401, message: 'Missing parameters: pinterest_ad_id is required' };
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const rows = await db.sql.query(OUTGOING_SQL, [p.pinterest_ad_id]);
    if (rows && rows.length > 0) return { code: 200, data: rows, message: 'Urls found' };
    return { code: 400, data: null, message: 'No urls found' };
  } catch (err) {
    logger.error('Error in getPinterestOutgoings', { error: err.message });
    return { code: 401, data: [] };
  }
}

// ─── 3. Advertiser-level helpers ────────────────────────

// ─── 3. Advertiser-level helpers ────────────────────────

const AD_META_SQL = `
  SELECT pa.last_seen, papo.post_owner_name, pa.post_owner_id
  FROM pinterest_ad pa
  JOIN pinterest_ad_post_owners papo ON pa.post_owner_id = papo.id
  WHERE pa.id = ?
  LIMIT 1
`;

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

async function fetchAvailableYears(elastic, index, filter) {
  // date_histogram aggregation replaces a 10k-doc fetch+JS-extract pass.
  // `interval: 'year'` (not `calendar_interval`) for ES 6.x compatibility.
  try {
    const esResult = await elastic.search({
      index,
      body: {
        size: 0,
        query: { bool: { filter: [filter] } },
        aggs: {
          years: {
            date_histogram: {
              field: 'pinterest_ad.last_seen',
              interval: 'year',
              format: 'yyyy',
              min_doc_count: 1,
            },
          },
        },
      },
    });

    const buckets =
      (esResult.aggregations || esResult.body?.aggregations)?.years?.buckets ||
      [];

    return buckets
      .map(b => parseInt(b.key_as_string, 10))
      .filter(y => Number.isFinite(y) && y > 1970)
      .sort((a, b) => b - a);
  } catch {
    return [];
  }
}

async function aggregateCountryData(db, hits) {
  if (!hits || hits.length === 0) return null;

  const countryMap = {};
  for (const hit of hits) {
    // Support both shapes — _source (legacy / date-range variant) and
    // docvalue_fields (perf-optimised getAdvertiserCountryData). docvalue
    // fields always come back as arrays even for single values.
    const src = hit._source;
    const f = hit.fields;
    const adId = src ? src['pinterest_ad.id'] : f?.['pinterest_ad.id']?.[0];
    if (!adId) continue;

    const rawCountries = src
      ? src['pinterest_country_only.country']
      : (f?.['pinterest_country_only.country.keyword'] || f?.['pinterest_country_only.country']);
    // Pinterest ES stores multi-country ads as CSV strings — split each
    // value into individual country tokens (also handles the space-prefixed
    // variants like " Belgium" observed in production).
    const countries = splitCountryTokens(rawCountries);
    if (countries.length === 0) continue;

    for (const country of countries) {
      if (!countryMap[country]) countryMap[country] = new Set();
      countryMap[country].add(adId);
    }
  }

  if (Object.keys(countryMap).length === 0) return null;

  const allCountryNames = Object.keys(countryMap);
  const isoMap = await batchCountryLookup(db, allCountryNames);

  const result = [];
  const countryEntries = Object.entries(countryMap).sort((a, b) => b[1].size - a[1].size);

  for (const [name, idSet] of countryEntries) {
    const adIds = [...idSet];
    const lookup = isoMap.get(name);
    let country = lookup?.country || name;
    let iso = lookup?.iso || null;

    iso = fixCountryIso(country, iso);
    if (country) country = country.replace(/\b\w/g, c => c.toUpperCase());

    result.push({ country, iso, ad_ids: adIds, ad_count: adIds.length });
  }
  return result;
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
  if (!p.pinterest_ad_id) return { code: 401, message: 'Missing pinterest_ad_id', data: null };

  const metaRows = await db.sql.query(AD_META_SQL, [p.pinterest_ad_id]);
  const postOwnerName = metaRows?.[0]?.post_owner_name || null;
  const postOwnerId = metaRows?.[0]?.post_owner_id || null;
  const adLastSeen = metaRows?.[0]?.last_seen || null;

  if (!postOwnerName || !db.elastic) return { code: 400, message: 'Advertiser not found', data: null };

  const adYear = p.year || (adLastSeen ? new Date(adLastSeen).getFullYear() : new Date().getFullYear());
  const dateRange = getYearRange(adYear);
  const index = 'pinterest_search_mix';

  const advertiserFilter = { match_phrase: { 'pinterest_ad_post_owners.post_owner_name': postOwnerName } };
  const [availableYears, esResult] = await Promise.allSettled([
    fetchAvailableYears(db.elastic, index, advertiserFilter),
    // docvalue_fields + _source:false + filter_path + track_total_hits:false
    // — same perf optimisation pattern as Google/Native. Doc values are
    // columnar so reading them is significantly cheaper than materialising
    // the JSON _source per hit.
    db.elastic.search({
      index,
      filter_path: 'hits.hits.fields',
      body: {
        size: 10000,
        track_total_hits: false,
        _source: false,
        docvalue_fields: ['pinterest_ad.id', 'pinterest_country_only.country.keyword'],
        query: {
          bool: {
            filter: [
              advertiserFilter,
              { range: { 'pinterest_ad.last_seen': dateRange } },
            ],
          },
        },
      },
    }),
  ]);

  const hits = (esResult.status === 'fulfilled') ?
    (esResult.value.hits || esResult.value.body?.hits)?.hits : [];

  if (!hits || hits.length === 0) {
    return {
      code: 200,
      message: 'No data found for this year.',
      post_owner_id: postOwnerId,
      year: adYear,
      available_years: availableYears.status === 'fulfilled' ? availableYears.value : [],
      data: []
    };
  }

  const data = await aggregateCountryData(db, hits);

  return {
    code: 200,
    message: 'Advertiser country data fetched.',
    post_owner_id: postOwnerId,
    year: adYear,
    available_years: availableYears.status === 'fulfilled' ? availableYears.value : [],
    data: data || []
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
    `SELECT post_owner_name FROM pinterest_ad_post_owners WHERE id = ? LIMIT 1`,
    [post_owner_id]
  );
  const postOwnerName = advertiserRows?.[0]?.post_owner_name;
  if (!postOwnerName || !db.elastic) return { code: 400, message: 'Advertiser not found' };

  const dateRange = getCustomDateRange(from_date, to_date);
  const base = { from_date, to_date, post_owner_id };
  const index = 'pinterest_search_mix';

  const targetType = (type || 'country').toLowerCase();

  if (targetType === 'country') {
    const esResult = await db.elastic.search({
      index,
      body: {
        size: 10000,
        _source: ['pinterest_ad.id', 'pinterest_country_only.country'],
        query: {
          bool: {
            filter: [
              { match_phrase: { 'pinterest_ad_post_owners.post_owner_name': postOwnerName } },
              { range: { 'pinterest_ad.last_seen': dateRange } },
            ],
          },
        },
      },
    });

    const hits = (esResult.hits || esResult.body?.hits)?.hits;
    if (!hits || hits.length === 0) return { code: 400, message: 'No data found.', ...base, data: [] };

    const data = await aggregateCountryData(db, hits);
    return { code: 200, message: 'Advertiser country data fetched.', ...base, data: data || [] };
  }

  return { code: 400, message: `Insight type '${targetType}' not supported for this platform.` };
}

module.exports = {
  getPinterestAdCountry,
  getPinterestOutgoings,
  getAdvertiserCountryData,
  getAdvertiserInsightsByDateRange,
};
