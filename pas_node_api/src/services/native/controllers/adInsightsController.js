'use strict';

const { normalizeParams } = require('../helpers/paramParser');


// ─── 1. getNativeAdCountry ──────────────────────────────

const COUNTRY_SQL = `
  SELECT native_country_only.country, native_ad_countries_only.count, country_data.iso
  FROM native_ad_countries_only
  LEFT JOIN native_country_only ON native_ad_countries_only.country_only_id = native_country_only.id
  LEFT JOIN country_data ON native_country_only.country = country_data.nicename
  WHERE native_ad_countries_only.native_ad_id = ?
    AND native_country_only.country IS NOT NULL
`;

function fixCountryIso(country, iso) {
  const name = (country || '').toLowerCase();
  if (country === 'Czechia') return 'CZ';
  if (country === 'Russia') return 'RU';
  if (name.includes('congo') && (!iso || iso === 'null')) return 'CD';
  return iso;
}

async function getNativeAdCountry(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.native_ad_id || !p.user_id) {
    return { code: 401, message: 'Missing parameters: native_ad_id and user_id are required' };
  }
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const rows = await db.sql.query(COUNTRY_SQL, [parseInt(p.native_ad_id, 10)]);
    if (!rows || rows.length === 0) return { code: 400, message: 'No data found.' };

    // Collect all country names for batch lookup
    const allCountryNames = rows.map(row => row.country).filter(Boolean);
    const isoMap = await batchCountryLookup(db, allCountryNames);

    const resArray = rows.map(row => {
      let country = row.country || '';
      let iso = fixCountryIso(country, row.iso);

      // Try multiple lookup strategies
      let lookup = isoMap.get(country);
      if (!lookup && country) {
        // Try case-insensitive lookup
        lookup = isoMap.get(country.toLowerCase()) || isoMap.get(country.toUpperCase());
      }

      if (lookup) {
        country = lookup.country;
        iso = lookup.iso;
      }

      if (country) country = country.replace(/\b\w/g, c => c.toUpperCase());

      return {
        country: country || row.country,
        iso,
        count: row.count,
      };
    });

    return { code: 200, message: 'Native country data fetched.', data: resArray };
  } catch (err) {
    logger.error('Error in getNativeAdCountry', { error: err.message });
    return { code: 500, message: 'Error fetching country data', error: err.message };
  }
}

// ─── 2. getTargetSite ──────────────────────────────────

const TARGET_SITE_SQL = `
  SELECT target_site_id, count, date
  FROM native_ad_target_site
  WHERE native_ad_id = ?
`;

async function getTargetSite(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.ad_id) return { code: 400, message: 'No ad_id Recieved' };
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const rows = await db.sql.query(TARGET_SITE_SQL, [parseInt(p.ad_id, 10)]);
    if (!rows || rows.length === 0) return { code: 400, message: 'Ad_id not found' };

    // Group counts by unique date
    const dateMap = {};
    for (const row of rows) {
      const date = row.date;
      if (!dateMap[date]) dateMap[date] = 0;
      dateMap[date] += Number(row.count) || 0;
    }

    const data = Object.entries(dateMap).map(([date, count]) => ({ date, count }));

    return { code: 200, message: 'Data fetched sucssesfully', data };
  } catch (err) {
    logger.error('Error in getTargetSite', { error: err.message });
    return { code: 401, message: err.message };
  }
}

// ─── 3. getAdNetwork ──────────────────────────────────

const AD_NETWORK_SQL = `
  SELECT networks.network
  FROM native_ad_network
  LEFT JOIN networks ON native_ad_network.network_id = networks.id
  WHERE native_ad_network.native_ad_id = ?
`;

async function getAdNetwork(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.native_ad_id || !p.user_id) {
    return { code: 401, message: 'Missing parameters' };
  }
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const rows = await db.sql.query(AD_NETWORK_SQL, [parseInt(p.native_ad_id, 10)]);
    if (!rows || rows.length === 0) {
      return { code: 400, message: 'No data found.' };
    }
    return { code: 200, message: 'native network data fetched.', data: rows };
  } catch (err) {
    logger.error('Error in getAdNetwork', { error: err.message });
    return { code: 500, message: err.message };
  }
}

// ─── 4. getRedirect ────────────────────────────────────

const REDIRECT_SQL = `
  SELECT url, url_type
  FROM native_ad_url
  WHERE native_ad_id = ?
`;

async function getRedirect(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.native_ad_id) {
    return { code: 401, message: 'Missing parameters: native_ad_id is required' };
  }
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const rows = await db.sql.query(REDIRECT_SQL, [parseInt(p.native_ad_id, 10)]);
    if (!rows || rows.length === 0) {
      return { code: 400, message: 'Redirect_url not found', data: [] };
    }
    return { code: 200, message: 'Redirect_url found', data: rows };
  } catch (err) {
    logger.error('Error in getRedirect', { error: err.message });
    return { code: 401, message: err.message, data: [] };
  }
}

// ─── 5. getRedirectOutgoingUrls ────────────────────────

const OUTGOING_URLS_SQL = `
  SELECT source_url, redirect_url, final_url
  FROM native_ad_outgoing_links
  WHERE native_ad_id = ?
`;

async function getRedirectOutgoingUrls(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.native_ad_id) {
    return { code: 401, message: 'Missing parameters' };
  }
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const rows = await db.sql.query(OUTGOING_URLS_SQL, [parseInt(p.native_ad_id, 10)]);
    if (!rows || rows.length === 0) {
      return { code: 400, data: null, message: 'No urls found' };
    }
    return { code: 200, data: rows, message: 'Urls found' };
  } catch (err) {
    logger.error('Error in getRedirectOutgoingUrls', { error: err.message });
    return { code: 500, data: null, message: err.message };
  }
}

// ─── 6. Advertiser-level helpers ────────────────────────

const AD_OWNER_SQL = `
  SELECT na.last_seen, napo.post_owner_name, na.post_owner_id
  FROM native_ad na
  JOIN native_ad_post_owners napo ON na.post_owner_id = napo.id
  WHERE na.id = ?
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
  // Use a date_histogram aggregation instead of pulling 10k docs and computing
  // distinct years in JS. The aggregation returns one bucket per year that has
  // at least one ad — typically a few hundred bytes total, regardless of how
  // many ads the advertiser has. `size: 0` means ES skips hits entirely.
  // `interval: 'year'` (not `calendar_interval`) for ES 6.x compatibility —
  // `calendar_interval` was only introduced in ES 7.2.
  try {
    const esResult = await elastic.search({
      index,
      body: {
        size: 0,
        query: { bool: { filter: [filter] } },
        aggs: {
          years: {
            date_histogram: {
              field: 'native_ad.last_seen',
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
    // Support both shapes:
    //   - _source path (legacy): hit._source['native_ad.id'] / hit._source['native_country_only.country']
    //   - docvalue_fields path: hit.fields['native_ad.id'][0] / hit.fields['native_country_only.country.keyword']
    // docvalue_fields always returns arrays even for single values, so we
    // unwrap on read. The advertiser-country main query was switched to
    // docvalue_fields for perf; getAdvertiserInsightsByDateRange still uses
    // _source so this helper handles both.
    const src = hit._source;
    const f = hit.fields;
    const adId = src ? src['native_ad.id'] : f?.['native_ad.id']?.[0];
    if (!adId) continue;

    let countries = src
      ? src['native_country_only.country']
      : (f?.['native_country_only.country.keyword'] || f?.['native_country_only.country']);
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
  const dedupMap = new Map(); // Deduplicate by ISO code first, then by normalized country name
  const countryEntries = Object.entries(countryMap).sort((a, b) => b[1].size - a[1].size);

  for (const [name, idSet] of countryEntries) {
    const adIds = [...idSet];
    const lookup = isoMap.get(name);
    let country = lookup?.country || name;
    let iso = lookup?.iso || null;

    iso = fixCountryIso(country, iso);
    if (country) country = country.replace(/\b\w/g, c => c.toUpperCase());

    // Create dedup key: prefer ISO code, fallback to normalized country name
    const dedupKey = iso || country.toUpperCase();

    // If we already have this entry (by ISO or country name), merge the ad IDs
    if (dedupMap.has(dedupKey)) {
      const existing = dedupMap.get(dedupKey);
      existing.ad_ids.push(...adIds);
      existing.ad_count = existing.ad_ids.length;
      // Update country/iso with the lookup version if this has better data
      if (iso && !existing.iso) existing.iso = iso;
      if (country && !existing.country) existing.country = country;
      continue;
    }

    const entry = { country, iso, ad_ids: adIds, ad_count: adIds.length };
    dedupMap.set(dedupKey, entry);
    result.push(entry);
  }
  return result;
}

async function batchCountryLookup(db, names) {
  if (!db.sql || !names || names.length === 0) return new Map();
  const uniqueNames = [...new Set(names)];
  const placeholders = uniqueNames.map(() => '?').join(',');
  try {
    // Query both nicename and iso columns to handle cases where input is ISO code
    // Also search in lowercase for case-insensitive matching
    const rows = await db.sql.query(
      `SELECT nicename, name AS country, iso FROM country_data
       WHERE nicename IN (${placeholders})
          OR iso IN (${placeholders})
          OR LOWER(iso) IN (${placeholders.split(',').map(() => 'LOWER(?)').join(',')})`,
      [...uniqueNames, ...uniqueNames, ...uniqueNames]
    );
    const map = new Map();
    if (rows) {
      for (const row of rows) {
        // Map nicename, iso (both cases), and country name variants
        map.set(row.nicename, { country: row.country, iso: row.iso });
        if (row.iso) {
          map.set(row.iso, { country: row.country, iso: row.iso });
          map.set(row.iso.toLowerCase(), { country: row.country, iso: row.iso });
          map.set(row.iso.toUpperCase(), { country: row.country, iso: row.iso });
        }
        // Also map the country name itself
        if (row.country) {
          map.set(row.country.toLowerCase(), { country: row.country, iso: row.iso });
          map.set(row.country.toUpperCase(), { country: row.country, iso: row.iso });
        }
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

// ─── 7. getAdvertiserCountryData ────────────────────────

/**
 * Fetch advertiser-level country data. Default to ad's year.
 */
async function getAdvertiserCountryData(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);
  if (!p.native_ad_id) return { code: 401, message: 'Missing native_ad_id', data: null };

  const metaRows = await db.sql.query(AD_OWNER_SQL, [parseInt(p.native_ad_id, 10)]);
  const postOwnerName = metaRows?.[0]?.post_owner_name || null;
  const postOwnerId = metaRows?.[0]?.post_owner_id || null;
  const lastSeen = metaRows?.[0]?.last_seen || null;

  if (!postOwnerName || !db.elastic) return { code: 400, message: 'Advertiser not found', data: null };

  const adYear = p.year || (lastSeen ? new Date(lastSeen).getFullYear() : new Date().getFullYear());
  const dateRange = getYearRange(adYear);
  const index = 'native_search_mix';

  const advertiserFilter = { match_phrase: { 'native_ad_post_owners.post_owner_name': postOwnerName } };
  const [availableYears, esResult] = await Promise.allSettled([
    fetchAvailableYears(db.elastic, index, advertiserFilter),
    // docvalue_fields + _source:false reads `native_ad.id` and the country
    // `.keyword` sub-field from ES doc values (columnar) instead of
    // materialising the JSON _source per hit. For an advertiser with
    // thousands of ads this typically cuts the ES coordinator's
    // serialization cost and the network payload by 3-5x. filter_path
    // strips everything we don't read (took, shards, _score etc.) so the
    // response is even smaller. track_total_hits: false lets ES skip the
    // exhaustive hit count.
    db.elastic.search({
      index,
      filter_path: 'hits.hits.fields',
      body: {
        size: 10000,
        track_total_hits: false,
        _source: false,
        docvalue_fields: ['native_ad.id', 'native_country_only.country.keyword'],
        query: {
          bool: {
            filter: [
              advertiserFilter,
              { range: { 'native_ad.last_seen': dateRange } },
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

// ─── 8. getAdvertiserInsightsByDateRange ────────────────

async function getAdvertiserInsightsByDateRange(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  const { post_owner_id, from_date, to_date, type } = p;
  if (!post_owner_id || !from_date || !to_date) {
    return { code: 401, message: 'Missing parameters: post_owner_id, from_date, to_date are required' };
  }

  const advertiserRows = await db.sql.query(
    `SELECT post_owner_name FROM native_ad_post_owners WHERE id = ? LIMIT 1`,
    [post_owner_id]
  );
  const postOwnerName = advertiserRows?.[0]?.post_owner_name;
  if (!postOwnerName || !db.elastic) return { code: 400, message: 'Advertiser not found' };

  const dateRange = getCustomDateRange(from_date, to_date);
  const base = { from_date, to_date, post_owner_id };
  const index = 'native_search_mix';

  const targetType = (type || 'country').toLowerCase();

  if (targetType === 'country') {
    const esResult = await db.elastic.search({
      index,
      body: {
        size: 10000,
        _source: ['native_ad.id', 'native_country_only.country'],
        query: {
          bool: {
            filter: [
              { match_phrase: { 'native_ad_post_owners.post_owner_name': postOwnerName } },
              { range: { 'native_ad.last_seen': dateRange } },
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
  getNativeAdCountry,
  getTargetSite,
  getAdNetwork,
  getRedirect,
  getRedirectOutgoingUrls,
  getAdvertiserCountryData,
  getAdvertiserInsightsByDateRange,
};
