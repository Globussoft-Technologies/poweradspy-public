'use strict';

const { normalizeParams } = require('../helpers/paramParser');

// ─── 1. getLikeCommentShareDetails ────────────────────────

async function getLikeCommentShareDetails(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.youtube_ad_id || !p.user_id) {
    return { code: 401, message: 'Missing parameters: youtube_ad_id and user_id are required' };
  }
  if (!db.elastic) return { code: 503, message: 'Elasticsearch connection not available' };

  try {
    const adId = parseInt(p.youtube_ad_id, 10);
    const esResult = await db.elastic.search({
      index: db.elastic.indexName || 'youtube_ads_data',
      body: {
        size: 1,
        _source: ['ad_id', 'reactions.likes', 'comments', 'views', 'last_seen'],
        query: {
          bool: {
            filter: { terms: { ad_id: [adId] } },
          },
        },
      },
    });

    const hits = (esResult.hits || esResult.body?.hits)?.hits;
    if (!hits?.length) {
      return { code: 400, message: 'No data found.', data: null };
    }

    const source = hits[0]._source || {};
    const data = [{
      youtube_ad_id: adId,
      likes: Number(source.reactions?.likes) || 0,
      comment: Number(source.comments) || 0,
      view: Number(source.views) || 0,
      date: source.last_seen == null ? null : Number(source.last_seen),
    }];

    return { code: 200, message: 'Youtube analytics details.', data };
  } catch (err) {
    logger.error('Error in getLikeCommentShareDetails (youtube)', { error: err.message });
    return { code: 500, message: 'Error fetching LCS details', error: err.message };
  }
}

// ─── 2. getYoutubeAdCountry ─────────────────────────────

/**
 * Fix known country ISO mapping quirks (mirrors PHP logic).
 */
function fixCountryIso(country, iso) {
  const name = (country || '').toLowerCase();
  if (country === 'Czechia') return 'CZ';
  if (country === 'Russia') return 'RU';
  if (name.includes('congo') && (!iso || iso === 'null')) return 'CD';
  if (country === 'DR Congo' || name === 'democratic republic of the congo' || name === 'republic of the congo') return 'CD';
  return iso;
}

function countryLookupKey(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveCountry(value, isoMap) {
  const lookup = isoMap.get(countryLookupKey(value));
  let country = lookup?.country || value;
  let iso = lookup?.iso || null;

  // ES can contain an ISO value (for example "US") alongside the country name.
  if (!iso && typeof value === 'string' && /^[a-z]{2}$/i.test(value.trim())) {
    iso = value.trim().toUpperCase();
  }
  iso = fixCountryIso(country, iso);
  if (iso) iso = String(iso).toUpperCase();
  if (country) country = country.replace(/\b\w/g, c => c.toUpperCase());

  return { country, iso };
}

function canonicalCountryKey(country, iso) {
  return iso ? `iso:${iso}` : `name:${countryLookupKey(country)}`;
}

async function getYoutubeAdCountry(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.youtube_ad_id || !p.user_id) {
    return { code: 401, message: 'Missing parameters: youtube_ad_id and user_id are required' };
  }
  if (!db.elastic) return { code: 503, message: 'Elasticsearch connection not available' };

  try {
    const esResult = await db.elastic.search({
      index: db.elastic.indexName,
      body: {
        query: {
          bool: {
            filter: { terms: { ad_id: [parseInt(p.youtube_ad_id, 10)] } },
          },
        },
      },
    });

    const hits = esResult.hits || esResult.body?.hits;
    if (!hits?.hits?.length) {
      return { code: 400, message: 'No data found.' };
    }

    const countries = hits.hits[0]._source.countries;
    if (!countries || !Array.isArray(countries) || countries.length === 0) {
      return { code: 400, message: 'No data found.' };
    }

    // Batch lookup all country ISO codes in a single query
    const isoMap = await batchCountryLookup(db, countries);

    const countryDataMap = new Map();
    for (const name of countries) {
      const resolved = resolveCountry(name, isoMap);
      const key = canonicalCountryKey(resolved.country, resolved.iso);
      const existing = countryDataMap.get(key);

      // Prefer a descriptive country name over a raw two-letter alias.
      if (!existing || (String(existing.country || '').length <= 2 && String(resolved.country || '').length > 2)) {
        countryDataMap.set(key, resolved);
      }
    }

    const countryData = [...countryDataMap.values()];
    return { code: 200, message: 'youtube country data fetched.', data: countryData };
  } catch (err) {
    logger.error('Error in getYoutubeAdCountry', { error: err.message });
    return { code: 500, message: 'Error fetching country data', error: err.message };
  }
}

// ─── 3. getYoutubeOutgoings ─────────────────────────────

const OUTGOING_SQL = `
  SELECT source_url, redirect_url, final_url
  FROM youtube_ad_outgoing_links
  WHERE youtube_ad_id = ?
`;

async function getYoutubeOutgoings(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.ad_id) {
    return { code: 401, message: 'Missing parameters: ad_id is required' };
  }
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const rows = await db.sql.query(OUTGOING_SQL, [p.ad_id]);

    if (rows && rows.length > 0) {
      return { code: 200, data: rows };
    }
    return { code: 400, data: [] };
  } catch (err) {
    logger.error('Error in getYoutubeOutgoings', { error: err.message });
    return { code: 401, data: [] };
  }
}

// ─── 4. Advertiser-level helpers ────────────────────────

// ─── 4. Advertiser-level helpers ────────────────────────

const AD_META_SQL = `
  SELECT ya.last_seen, yapo.post_owner_name, ya.post_owner_id
  FROM youtube_ad ya
  JOIN youtube_ad_post_owners yapo ON ya.post_owner_id = yapo.id
  WHERE ya.id = ?
  LIMIT 1
`;

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Robustly parse dates from ES hits.
 * Handles: ISO strings, Unix timestamps (seconds), and milliseconds.
 */
function parseESDate(val) {
  if (!val) return new Date();
  let dt;
  if (typeof val === 'number') {
    // If it looks like seconds (e.g. 1640995200), convert to ms
    dt = new Date(val < 10000000000 ? val * 1000 : val);
  } else {
    dt = new Date(val);
  }

  if (isNaN(dt.getTime())) return new Date();
  return dt;
}

function localDateToUnix(y, m, d, h = 0, min = 0, sec = 0) {
  // Use local time (not UTC) to match how epoch_second data was indexed
  return Math.floor(new Date(y, m - 1, d, h, min, sec).getTime() / 1000);
}

function getYearRange(year) {
  const y = Number(year);
  return {
    gte: localDateToUnix(y, 1, 1, 0, 0, 0),
    lte: localDateToUnix(y, 12, 31, 23, 59, 59),
  };
}

function getCustomDateRange(from, to) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return {
    gte: localDateToUnix(fy, fm, fd, 0, 0, 0),
    lte: localDateToUnix(ty, tm, td, 23, 59, 59),
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
              field: 'last_seen',
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
  } catch (err) {
    return [];
  }
}

function aggregateLCSData(hits) {
  if (!hits || hits.length === 0) return null;

  const monthlyData = {};
  for (const hit of hits) {
    const src = hit._source || {};
    const adId = src['ad_id'];
    const rawPostDate = src['last_seen'];
    if (!adId || !rawPostDate) continue;

    const dt = parseESDate(rawPostDate);
    const key = `${MONTH_NAMES[dt.getMonth()]}_${dt.getFullYear()}`;
    if (!monthlyData[key]) {
      monthlyData[key] = {
        ad_ids: [],
        total_ads: 0,
        likes: 0,
        dislikes: 0,
        comments: 0,
        views: 0,
      };
    }

    const month = monthlyData[key];
    month.ad_ids.push(adId);
    month.total_ads += 1;
    month.likes += Number(src.reactions?.likes ?? src['reactions.likes']) || 0;
    month.dislikes += Number(src.dislikes) || 0;
    month.comments += Number(src.comments) || 0;
    month.views += Number(src.views) || 0;
  }

  if (Object.keys(monthlyData).length === 0) return null;

  const result = {};
  const sortedKeys = Object.keys(monthlyData).sort((a, b) => {
    const [mA, yA] = a.split('_');
    const [mB, yB] = b.split('_');
    return (Number(yA) - Number(yB)) || (MONTH_NAMES.indexOf(mA) - MONTH_NAMES.indexOf(mB));
  });

  for (const key of sortedKeys) {
    result[key] = monthlyData[key];
  }
  return result;
}

async function aggregateCountryData(db, hits) {
  if (!hits || hits.length === 0) return null;

  const countryMap = {};
  for (const hit of hits) {
    // Support both shapes — _source (legacy / date-range variant) and
    // docvalue_fields (perf-optimised getAdvertiserCountryData).
    const src = hit._source;
    const f = hit.fields;
    const adId = src ? src['ad_id'] : f?.['ad_id']?.[0];
    if (!adId) continue;

    let countries = src
      ? src['countries']
      : (f?.['countries.keyword'] || f?.['countries']);
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

  const canonicalMap = new Map();
  for (const [name, idSet] of Object.entries(countryMap)) {
    const resolved = resolveCountry(name, isoMap);
    const key = canonicalCountryKey(resolved.country, resolved.iso);
    const existing = canonicalMap.get(key);

    if (!existing) {
      canonicalMap.set(key, { ...resolved, adIds: new Set(idSet) });
      continue;
    }

    for (const adId of idSet) existing.adIds.add(adId);
    if (String(existing.country || '').length <= 2 && String(resolved.country || '').length > 2) {
      existing.country = resolved.country;
    }
  }

  return [...canonicalMap.values()]
    .map(({ country, iso, adIds }) => {
      const ids = [...adIds];
      return { country, iso, ad_ids: ids, ad_count: ids.length };
    })
    .sort((a, b) => b.ad_count - a.ad_count);
}

async function batchCountryLookup(db, names) {
  if (!db.sql || !names || names.length === 0) return new Map();
  const uniqueNames = [...new Set(names)];
  const placeholders = uniqueNames.map(() => '?').join(',');
  try {
    const rows = await db.sql.query(
      `SELECT nicename, name AS country, iso
       FROM country_data
       WHERE nicename IN (${placeholders}) OR iso IN (${placeholders})`,
      [...uniqueNames, ...uniqueNames]
    );
    const map = new Map();
    if (rows) {
      for (const row of rows) {
        const value = { country: row.country, iso: row.iso };
        map.set(countryLookupKey(row.nicename), value);
        map.set(countryLookupKey(row.iso), value);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

// ─── 5. getAdvertiserLCSData ────────────────────────────

/**
 * Fetch advertiser-level monthly LCS data. Default to ad's year.
 */
async function getAdvertiserLCSData(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);
  if (!p.youtube_ad_id) return { code: 401, message: 'Missing youtube_ad_id', data: null };
  if (!db.elastic) return { code: 400, message: 'Advertiser not found', data: null };

  const index = db.elastic.indexName || 'youtube_ads_data';
  const metaResult = await db.elastic.search({
    index,
    body: {
      size: 1,
      _source: ['post_owner', 'post_owner_id', 'last_seen'],
      query: {
        bool: {
          filter: { terms: { ad_id: [parseInt(p.youtube_ad_id, 10)] } },
        },
      },
    },
  });
  const metaSource = (metaResult.hits || metaResult.body?.hits)?.hits?.[0]?._source;
  const postOwnerName = metaSource?.post_owner || null;
  const postOwnerId = metaSource?.post_owner_id || null;
  const adLastSeen = metaSource?.last_seen || null;

  if (!postOwnerName) return { code: 400, message: 'Advertiser not found', data: null };

  const adYear = p.year || (adLastSeen ? parseESDate(adLastSeen).getFullYear() : new Date().getFullYear());
  const dateRange = getYearRange(adYear);

  const lcsQuery = {
    index,
    body: {
      size: 10000,
      _source: ['ad_id', 'last_seen', 'reactions.likes', 'dislikes', 'comments', 'views'],
      query: {
        bool: {
          filter: [
            { match_phrase: { 'post_owner': postOwnerName } },
            { range: { 'last_seen': dateRange } },
          ],
        },
      },
    },
  };
  // console.log('[getAdvertiserLCSData] ES query:', JSON.stringify(lcsQuery, null, 2));

  const [availableYears, esResult] = await Promise.allSettled([
    fetchAvailableYears(db.elastic, index, { match_phrase: { 'post_owner': postOwnerName } }),
    db.elastic.search(lcsQuery),
  ]);

  const hits = (esResult.status === 'fulfilled') ?
    (esResult.value.hits || esResult.value.body?.hits)?.hits : [];

  // console.log('[getAdvertiserLCSData] status:', esResult.status, '| hits:', hits?.length ?? 0);
  if (esResult.status === 'rejected') console.error('[getAdvertiserLCSData] ES error:', esResult.reason);

  if (!hits || hits.length === 0) {
    return {
      code: 200,
      message: 'No data found for this year.',
      post_owner_id: postOwnerId,
      year: adYear,
      available_years: availableYears.status === 'fulfilled' ? availableYears.value : [],
      data: {}
    };
  }

  const data = aggregateLCSData(hits);

  return {
    code: 200,
    message: 'Advertiser LCS data fetched.',
    post_owner_id: postOwnerId,
    year: adYear,
    available_years: availableYears.status === 'fulfilled' ? availableYears.value : [],
    data: data || {}
  };
}

// ─── 6. getAdvertiserCountryData ────────────────────────

/**
 * Fetch advertiser-level country data. Default to ad's year.
 */
async function getAdvertiserCountryData(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);
  if (!p.youtube_ad_id) return { code: 401, message: 'Missing youtube_ad_id', data: null };

  const metaRows = await db.sql.query(AD_META_SQL, [p.youtube_ad_id]);
  const postOwnerName = metaRows?.[0]?.post_owner_name || null;
  const postOwnerId = metaRows?.[0]?.post_owner_id || null;
  const adLastSeen = metaRows?.[0]?.last_seen || null;

  if (!postOwnerName || !db.elastic) return { code: 400, message: 'Advertiser not found', data: null };

  const adYear = p.year || (adLastSeen ? parseESDate(adLastSeen).getFullYear() : new Date().getFullYear());
  const dateRange = getYearRange(adYear);
  const index = db.elastic.indexName;

  // docvalue_fields + _source:false + filter_path + track_total_hits:false
  // — same perf pattern as Google/Native. Doc values read columnar so
  // reading them is markedly cheaper than materialising the JSON _source.
  const advertiserFilter = { match_phrase: { 'post_owner': postOwnerName } };
  const countryQuery = {
    index,
    filter_path: 'hits.hits.fields',
    body: {
      size: 10000,
      track_total_hits: false,
      _source: false,
      docvalue_fields: ['ad_id', 'countries.keyword'],
      query: {
        bool: {
          filter: [
            advertiserFilter,
            { range: { 'last_seen': dateRange } },
          ],
        },
      },
    },
  };

  const [availableYears, esResult] = await Promise.allSettled([
    fetchAvailableYears(db.elastic, index, advertiserFilter),
    db.elastic.search(countryQuery),
  ]);

  const hits = (esResult.status === 'fulfilled') ?
    (esResult.value.hits || esResult.value.body?.hits)?.hits : [];

  // console.log('[getAdvertiserCountryData] status:', esResult.status, '| hits:', hits?.length ?? 0);
  if (esResult.status === 'rejected') console.error('[getAdvertiserCountryData] ES error:', esResult.reason);

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

// ─── 7. getAdvertiserInsightsByDateRange ────────────────

async function getAdvertiserInsightsByDateRange(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  const { post_owner_id, from_date, to_date, type } = p;
  if (!post_owner_id || !from_date || !to_date) {
    return { code: 401, message: 'Missing parameters: post_owner_id, from_date, to_date are required' };
  }

  try {
    const advertiserRows = await db.sql.query(
      `SELECT post_owner_name FROM youtube_ad_post_owners WHERE id = ? LIMIT 1`,
      [post_owner_id]
    );
    const postOwnerName = advertiserRows?.[0]?.post_owner_name;
    if (!postOwnerName || !db.elastic) return { code: 400, message: 'Advertiser not found' };

    const dateRange = getCustomDateRange(from_date, to_date);
    const base = { from_date, to_date, post_owner_id };
    const index = db.elastic.indexName;

    const targetType = (type || 'country').toLowerCase();

    if (targetType === 'country') {
      // docvalue_fields path — aggregateCountryData reads either shape.
      const esQuery = {
        index,
        filter_path: 'hits.hits.fields',
        body: {
          size: 10000,
          track_total_hits: false,
          _source: false,
          docvalue_fields: ['ad_id', 'countries.keyword'],
          query: {
            bool: {
              filter: [
                { match_phrase: { 'post_owner': postOwnerName } },
                { range: { 'last_seen': dateRange } },
              ],
            },
          },
        },
      };
      const esResult = await db.elastic.search(esQuery);

      const hits = (esResult.hits || esResult.body?.hits)?.hits;
      // console.log('[getAdvertiserInsightsByDateRange:country] hits:', hits?.length ?? 0);
      if (!hits || hits.length === 0) return { code: 400, message: 'No data found.', ...base, data: [] };

      const data = await aggregateCountryData(db, hits);
      return { code: 200, message: 'Advertiser country data fetched.', ...base, data: data || [] };
    }

    if (targetType === 'lcs') {
      const esQuery = {
        index,
        body: {
          size: 10000,
          _source: ['ad_id', 'last_seen', 'reactions.likes', 'dislikes', 'comments', 'views'],
          query: {
            bool: {
              filter: [
                { match_phrase: { 'post_owner': postOwnerName } },
                { range: { 'last_seen': dateRange } },
              ],
            },
          },
        },
      };
      // console.log('[getAdvertiserInsightsByDateRange:lcs] ES query:', JSON.stringify(esQuery, null, 2));
      const esResult = await db.elastic.search(esQuery);

      const hits = (esResult.hits || esResult.body?.hits)?.hits;
      // console.log('[getAdvertiserInsightsByDateRange:lcs] hits:', hits?.length ?? 0);
      if (!hits || hits.length === 0) return { code: 400, message: 'No data found.', ...base, data: {} };

      const data = aggregateLCSData(hits);
      return { code: 200, message: 'Advertiser LCS data fetched.', ...base, data: data || {} };
    }

    return { code: 400, message: `Insight type '${targetType}' not supported for this platform.` };
  } catch (err) {
    logger.error('Error in getAdvertiserInsightsByDateRange (youtube)', { error: err.message, stack: err.stack });
    return { code: 500, message: 'Error fetching advertiser insights', error: err.message };
  }
}

module.exports = {
  getLikeCommentShareDetails,
  getYoutubeAdCountry,
  getYoutubeOutgoings,
  getAdvertiserLCSData,
  getAdvertiserCountryData,
  getAdvertiserInsightsByDateRange,
};
