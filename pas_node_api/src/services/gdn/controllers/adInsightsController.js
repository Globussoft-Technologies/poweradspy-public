'use strict';

const { normalizeParams } = require('../helpers/paramParser');

// ─── ISO fix helpers (mirrors PHP) ──────────────────────────────────────────

function fixCountryIso(country, iso) {
  const name = (country || '').toLowerCase();
  if (country === 'Czechia') return 'CZ';
  if (country === 'Russia')  return 'RU';
  if (name.includes('congo') && (!iso || iso === 'null')) return 'CD';
  if (country === 'DR Congo' || name === 'democratic republic of the congo') return 'CD';
  return iso;
}

// ─── 1. getGdnAdCountry ─────────────────────────────────────────────────────
//
// Mirrors PHP AdDetailsController@getAdCountry.
// Joins gdn_ad_countries_only → gdn_country_only → country_data to get ISO codes.

const COUNTRY_SQL = `
  SELECT gdn_country_only.country, country_data.iso
  FROM gdn_ad_countries_only
  LEFT JOIN gdn_country_only ON gdn_ad_countries_only.country_only_id = gdn_country_only.id
  LEFT JOIN country_data     ON country_data.nicename                 = gdn_country_only.country
  WHERE gdn_ad_countries_only.gdn_ad_id = ?
    AND gdn_country_only.country IS NOT NULL
`;

async function getGdnAdCountry(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p   = normalizeParams(raw);

  if (!p.gdn_ad_id || !p.user_id) {
    return { code: 401, message: 'Missing parameters: gdn_ad_id and user_id are required' };
  }

  // Prefer SQL path; fall back to ES if SQL unavailable
  if (db.sql) {
    try {
      const rows = await db.sql.query(COUNTRY_SQL, [p.gdn_ad_id]);

      if (!rows || rows.length === 0) {
        return { code: 401, message: 'Something Went Wrong' };
      }

      const data = rows.map(row => ({
        country: row.country ? row.country.replace(/\b\w/g, c => c.toUpperCase()) : row.country,
        iso:     fixCountryIso(row.country, row.iso),
      }));

      return { code: 200, message: 'gdn country data fetched.', data };
    } catch (err) {
      logger.warn('SQL country query failed in GDN getGdnAdCountry, trying ES fallback', { error: err.message });
    }
  }

  // ES fallback — read gdn_country_only.country from ES source
  if (!db.elastic) {
    return { code: 503, message: 'Neither SQL nor Elasticsearch available' };
  }

  try {
    const esResult = await db.elastic.search({
      index: db.elastic.indexName || 'gdn_search_mix',
      body: {
        query: {
          bool: { filter: { terms: { 'gdn_ad.id': [parseInt(p.gdn_ad_id, 10)] } } },
        },
      },
    });

    const hits = esResult.hits || esResult.body?.hits;
    if (!hits?.hits?.length) return { code: 401, message: 'Something Went Wrong' };

    let countryData = hits.hits[0]._source['gdn_country_only.country'];
    if (!countryData) return { code: 401, message: 'Something Went Wrong' };
    if (!Array.isArray(countryData)) countryData = [countryData];

    const data = countryData.map(name => ({
      country: name ? name.replace(/\b\w/g, c => c.toUpperCase()) : name,
      iso:     fixCountryIso(name, null),
    }));

    return { code: 200, message: 'gdn country data fetched.', data };
  } catch (err) {
    logger.error('Error in GDN getGdnAdCountry', { error: err.message });
    return { code: 500, message: 'Error fetching country data', error: err.message };
  }
}

// ─── 2. getGdnOutgoings ──────────────────────────────────────────────────────
//
// Mirrors PHP AdDetailsController@getRedirectOutgoingUrls.

const OUTGOING_SQL = `
  SELECT source_url, redirect_url, final_url
  FROM gdn_ad_outgoing_links
  WHERE gdn_ad_id = ?
`;

async function getGdnOutgoings(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p   = normalizeParams(raw);

  if (!p.gdn_ad_id) {
    return { code: 401, message: 'Missing parameters: gdn_ad_id is required' };
  }
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const rows = await db.sql.query(OUTGOING_SQL, [p.gdn_ad_id]);
    if (rows && rows.length > 0) {
      return { code: 200, data: rows };
    }
    return { code: 400, data: [] };
  } catch (err) {
    logger.error('Error in GDN getGdnOutgoings', { error: err.message });
    return { code: 401, data: [] };
  }
}

// ─── 3. Advertiser-level helpers ────────────────────────

// ─── 3. Advertiser-level helpers ────────────────────────

const AD_META_SQL = `
  SELECT ga.last_seen, gapo.post_owner_name, ga.post_owner_id
  FROM gdn_ad ga
  JOIN gdn_ad_post_owners gapo ON ga.post_owner_id = gapo.id
  WHERE ga.id = ?
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
              field: 'gdn_ad.last_seen',
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
    // docvalue_fields (perf-optimised getAdvertiserCountryData).
    const src = hit._source;
    const f = hit.fields;
    const adId = src ? src['gdn_ad.id'] : f?.['gdn_ad.id']?.[0];
    if (!adId) continue;

    let countries = src
      ? src['gdn_country_only.country']
      : (f?.['gdn_country_only.country.keyword'] || f?.['gdn_country_only.country']);
    if (!countries) continue;
    if (!Array.isArray(countries)) countries = [countries];

    for (const country of countries) {
      if (!country) continue;
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
  if (!p.gdn_ad_id) return { code: 401, message: 'Missing gdn_ad_id', data: null };

  const metaRows = await db.sql.query(AD_META_SQL, [p.gdn_ad_id]);
  const postOwnerName = metaRows?.[0]?.post_owner_name || null;
  const postOwnerId = metaRows?.[0]?.post_owner_id || null;
  const adLastSeen = metaRows?.[0]?.last_seen || null;

  if (!postOwnerName || !db.elastic) return { code: 400, message: 'Advertiser not found', data: null };

  const adYear = p.year || (adLastSeen ? new Date(adLastSeen).getFullYear() : new Date().getFullYear());
  const dateRange = getYearRange(adYear);
  const index = db.elastic.indexName || 'gdn_search_mix';

  const advertiserFilter = { match: { 'gdn_ad_post_owners.post_owner_name_exactly': postOwnerName } };
  const [availableYears, esResult] = await Promise.allSettled([
    fetchAvailableYears(db.elastic, index, advertiserFilter),
    // docvalue_fields + _source:false + filter_path + track_total_hits:false
    db.elastic.search({
      index,
      filter_path: 'hits.hits.fields',
      body: {
        size: 10000,
        track_total_hits: false,
        _source: false,
        docvalue_fields: ['gdn_ad.id', 'gdn_country_only.country.keyword'],
        query: {
          bool: {
            filter: [
              advertiserFilter,
              { range: { 'gdn_ad.last_seen': dateRange } },
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
    `SELECT post_owner_name FROM gdn_ad_post_owners WHERE id = ? LIMIT 1`,
    [post_owner_id]
  );
  const postOwnerName = advertiserRows?.[0]?.post_owner_name;
  if (!postOwnerName || !db.elastic) return { code: 400, message: 'Advertiser not found' };

  const dateRange = getCustomDateRange(from_date, to_date);
  const base = { from_date, to_date, post_owner_id };
  const index = db.elastic.indexName || 'gdn_search_mix';

  const targetType = (type || 'country').toLowerCase();

  if (targetType === 'country') {
    const esResult = await db.elastic.search({
      index,
      body: {
        size: 10000,
        _source: ['gdn_ad.id', 'gdn_country_only.country'],
        query: {
          bool: {
            filter: [
              { match: { 'gdn_ad_post_owners.post_owner_name_exactly': postOwnerName } },
              { range: { 'gdn_ad.last_seen': dateRange } },
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

module.exports = { getGdnAdCountry, getGdnOutgoings, getAdvertiserCountryData, getAdvertiserInsightsByDateRange };
