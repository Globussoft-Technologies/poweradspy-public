'use strict';

const { normalizeParams, cleanAdsData } = require('../helpers/paramParser');
const { mapIndustriesToCategories } = require('../helpers/industries');

const TT_INDEX = process.env.TT_ELASTIC_INDEX || 'tiktok_ads';
const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

// ─── 1. getLCS ─────────────────────────────────────────

const LCS_SQL = `
  SELECT likes, comments, shares, createdAt AS date
  FROM tiktok_ad_analytics
  WHERE ad_id = ?
  ORDER BY createdAt ASC
`;

async function getLCS(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);
  const id = p.ad_id;

  if (!id || !p.user_id) return { code: 401, message: 'Missing parameters: ad_id and user_id are required' };
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const rows = await db.sql.query(LCS_SQL, [parseInt(id, 10)]);
    if (!rows || rows.length === 0) return { code: 400, message: 'No ad found with ad_id', data: null };

    const data = rows.map(r => ({
      likes: r.likes,
      comments: r.comments,
      shares: r.shares,
      date: r.date,
    }));

    return { code: 200, message: 'LCS fetched successfully', data };
  } catch (err) {
    logger.error('Error in getLCS (tiktok)', { error: err.message });
    return { code: 500, message: 'Error fetching LCS', error: err.message };
  }
}

// ─── 2. getAnalytics ──────────────────────────────────

async function getAnalytics(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);
  const id = p.ad_id;

  if (!id || !p.user_id) return { code: 401, message: 'Missing parameters: ad_id and user_id are required' };
  if (!db.elastic) return { code: 503, message: 'Elasticsearch connection not available' };

  try {
    const esResult = await db.elastic.search({
      index: process.env.TT_ELASTIC_INDEX || 'tiktok_ads',
      body: { query: { term: { sql_id: parseInt(id, 10) } } },
    });

    const hits = esResult.hits || esResult.body?.hits;
    if (!hits?.hits?.length) {
      return { code: 400, message: 'No data found with that id', data: null };
    }
    const cleaned = cleanAdsData([hits.hits[0]._source]);
    return { code: 200, message: 'Found analytics data', data: cleaned[0] || hits.hits[0]._source };
  } catch (err) {
    logger.error('Error in getAnalytics (tiktok)', { error: err.message });
    return { code: 500, message: 'Error fetching analytics', error: err.message };
  }
}



// ─── 3. getIndustries ─────────────────────────────────

async function getIndustries(req, db, logger) {
  if (!db.elastic) return { code: 503, message: 'Elasticsearch connection not available' };

  try {
    const result = await db.elastic.search({
      index: process.env.TT_ELASTIC_INDEX || 'tiktok_ads',
      body: {
        size: 0,
        aggs: {
          industries: { terms: { field: 'industry', size: 100 } },
        },
      },
    });

    const aggs = result.aggregations || result.body?.aggregations;
    const buckets = aggs?.industries?.buckets || [];
    const industries = buckets.map(b => b.key);
    // console.log(industries,"9012");
    const categories = mapIndustriesToCategories(industries);

    return { code: 200, message: 'Industries fetched successfully', data: categories };
  } catch (err) {
    logger.error('Error in getIndustries (tiktok)', { error: err.message });
    return { code: 500, message: 'Error fetching industries', error: err.message };
  }
}

// ─── 4. Advertiser-level helpers ────────────────────────

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

/**
 * Fetch all distinct years an advertiser has ads in ES (by post_owner_id).
 *
 * date_histogram aggregation with `size: 0` — ES never materialises hits.
 *
 * NOTE on the interval parameter: TikTok runs on ES 8.x where the legacy
 * `interval` parameter was REMOVED in 8.0; only `calendar_interval` /
 * `fixed_interval` are accepted. Every other platform here is on ES 6.x
 * which only knows the legacy `interval`. So this file uses
 * `calendar_interval: 'year'` while all the other controllers use
 * `interval: 'year'` — same semantics, two different spellings.
 */
async function fetchAvailableYears(elastic, postOwnerId) {
  try {
    const esResult = await elastic.search({
      index: TT_INDEX,
      body: {
        size: 0,
        query: { bool: { filter: [{ term: { post_owner_id: postOwnerId } }] } },
        aggs: {
          years: {
            date_histogram: {
              field: 'last_seen',
              calendar_interval: 'year',
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

// ─── 5. getAdvertiserLCSData ────────────────────────────

/**
 * Fetch advertiser-level monthly LCS data for a given year.
 * LCS (likes, comments, shares) are read directly from the ES document.
 * Body: { tiktok_ad_id, year?, user_id }  — uses tiktok_ad_id to look up post_owner_id via ES.
 */
async function getAdvertiserLCSData(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);
  if (!p.tiktok_ad_id) return { code: 401, message: 'Missing tiktok_ad_id', data: null };
  if (!db.elastic) return { code: 503, message: 'Search service not available', data: null };

  // Resolve post_owner_id from the ad's ES document
  const adDoc = await db.elastic.search({
    index: TT_INDEX,
    body: {
      size: 1,
      _source: ['post_owner_id', 'last_seen'],
      query: { term: { sql_id: parseInt(p.tiktok_ad_id, 10) } },
    },
  });
  const adHit = (adDoc.hits || adDoc.body?.hits)?.hits?.[0];
  if (!adHit) return { code: 400, message: 'Ad not found', data: null };

  const postOwnerId = adHit._source.post_owner_id;
  if (!postOwnerId) return { code: 400, message: 'Advertiser not found for this ad', data: null };

  const adLastSeen = adHit._source.last_seen ? new Date(adHit._source.last_seen) : null;
  const adYear = p.year || (adLastSeen && !isNaN(adLastSeen.getTime()) ? adLastSeen.getFullYear() : new Date().getFullYear());
  const dateRange = getYearRange(adYear);

  const [availableYears, esResult] = await Promise.allSettled([
    fetchAvailableYears(db.elastic, postOwnerId),
    db.elastic.search({
      index: TT_INDEX,
      body: {
        size: 10000,
        _source: ['sql_id', 'last_seen', 'likes', 'comments', 'shares'],
        query: {
          bool: {
            filter: [
              { term: { post_owner_id: postOwnerId } },
              { range: { last_seen: dateRange } },
            ],
          },
        },
      },
    }),
  ]);

  const hits = esResult.status === 'fulfilled'
    ? (esResult.value.hits || esResult.value.body?.hits)?.hits
    : [];

  if (!hits || hits.length === 0) {
    return {
      code: 200,
      message: 'No data found for this year.',
      post_owner_id: postOwnerId,
      year: adYear,
      available_years: availableYears.status === 'fulfilled' ? availableYears.value : [],
      data: {},
    };
  }

  // Aggregate LCS by month
  const monthlyData = {};
  for (const hit of hits) {
    const src = hit._source;
    const rawDate = src.last_seen;
    if (!rawDate) continue;
    const d = new Date(rawDate);
    if (isNaN(d.getTime())) continue;

    const key = `${MONTH_NAMES[d.getMonth()]}_${d.getFullYear()}`;
    if (!monthlyData[key]) {
      monthlyData[key] = { ad_ids: [], total_ads: 0, likes: 0, comments: 0, shares: 0 };
    }
    monthlyData[key].ad_ids.push(src.sql_id);
    monthlyData[key].total_ads += 1;
    monthlyData[key].likes += Number(src.likes) || 0;
    monthlyData[key].comments += Number(src.comments) || 0;
    monthlyData[key].shares += Number(src.shares) || 0;
  }

  // Sort keys chronologically
  const sortedData = {};
  Object.keys(monthlyData)
    .sort((a, b) => {
      const [mA, yA] = a.split('_');
      const [mB, yB] = b.split('_');
      return (Number(yA) - Number(yB)) || (MONTH_NAMES.indexOf(mA) - MONTH_NAMES.indexOf(mB));
    })
    .forEach(k => { sortedData[k] = monthlyData[k]; });

  return {
    code: 200,
    message: 'Advertiser LCS data fetched.',
    post_owner_id: postOwnerId,
    year: adYear,
    available_years: availableYears.status === 'fulfilled' ? availableYears.value : [],
    data: sortedData,
  };
}

// ─── 6. getAdvertiserCountryData ────────────────────────

/**
 * Fetch advertiser-level country data for a given year.
 * Countries are ISO codes stored directly in the ES document.
 * Body: { tiktok_ad_id, year?, user_id }
 */
async function getAdvertiserCountryData(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);
  if (!p.tiktok_ad_id) return { code: 401, message: 'Missing tiktok_ad_id', data: null };
  if (!db.elastic) return { code: 503, message: 'Search service not available', data: null };

  // Resolve post_owner_id from the ad's ES document
  const adDoc = await db.elastic.search({
    index: TT_INDEX,
    body: {
      size: 1,
      _source: ['post_owner_id', 'last_seen'],
      query: { term: { sql_id: parseInt(p.tiktok_ad_id, 10) } },
    },
  });
  const adHit = (adDoc.hits || adDoc.body?.hits)?.hits?.[0];
  if (!adHit) return { code: 400, message: 'Ad not found', data: null };

  const postOwnerId = adHit._source.post_owner_id;
  if (!postOwnerId) return { code: 400, message: 'Advertiser not found for this ad', data: null };

  const adLastSeen = adHit._source.last_seen ? new Date(adHit._source.last_seen) : null;
  const adYear = p.year || (adLastSeen && !isNaN(adLastSeen.getTime()) ? adLastSeen.getFullYear() : new Date().getFullYear());
  const dateRange = getYearRange(adYear);

  const [availableYears, esResult] = await Promise.allSettled([
    fetchAvailableYears(db.elastic, postOwnerId),
    db.elastic.search({
      index: TT_INDEX,
      body: {
        size: 10000,
        _source: ['sql_id', 'countries'],
        query: {
          bool: {
            filter: [
              { term: { post_owner_id: postOwnerId } },
              { range: { last_seen: dateRange } },
            ],
          },
        },
      },
    }),
  ]);

  const hits = esResult.status === 'fulfilled'
    ? (esResult.value.hits || esResult.value.body?.hits)?.hits
    : [];

  if (!hits || hits.length === 0) {
    return {
      code: 200,
      message: 'No data found for this year.',
      post_owner_id: postOwnerId,
      year: adYear,
      available_years: availableYears.status === 'fulfilled' ? availableYears.value : [],
      data: [],
    };
  }

  // Aggregate countries — TikTok stores ISO codes directly, no SQL lookup needed
  const countryMap = {};
  for (const hit of hits) {
    const src = hit._source;
    const adId = src.sql_id;
    if (!adId) continue;
    let countries = src.countries;
    if (!countries) continue;
    if (!Array.isArray(countries)) countries = [countries];
    for (const iso of countries) {
      if (!iso) continue;
      if (!countryMap[iso]) countryMap[iso] = new Set();
      countryMap[iso].add(adId);
    }
  }

  if (Object.keys(countryMap).length === 0) {
    return {
      code: 200,
      message: 'No country data found.',
      post_owner_id: postOwnerId,
      year: adYear,
      available_years: availableYears.status === 'fulfilled' ? availableYears.value : [],
      data: [],
    };
  }

  const data = Object.entries(countryMap)
    .sort((a, b) => b[1].size - a[1].size)
    .map(([iso, idSet]) => ({
      iso: iso.toUpperCase(),
      ad_ids: [...idSet],
      ad_count: idSet.size,
    }));

  return {
    code: 200,
    message: 'Advertiser country data fetched.',
    post_owner_id: postOwnerId,
    year: adYear,
    available_years: availableYears.status === 'fulfilled' ? availableYears.value : [],
    data,
  };
}

// ─── 7. getAdvertiserInsightsByDateRange ────────────────

/**
 * Fetch advertiser-level country or LCS data for a custom date range.
 * Body: { post_owner_id, from_date, to_date, type, user_id }
 *   type: "country" | "lcs"
 */
async function getAdvertiserInsightsByDateRange(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.post_owner_id) return { code: 400, message: 'Missing post_owner_id', data: null };
  if (!p.from_date || !p.to_date) return { code: 400, message: 'Missing from_date or to_date', data: null };
  if (!db.elastic) return { code: 503, message: 'Search service not available', data: null };

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(p.from_date) || !dateRe.test(p.to_date)) {
    return { code: 400, message: 'Invalid date format. Use YYYY-MM-DD', data: null };
  }
  if (p.from_date > p.to_date) {
    return { code: 400, message: 'from_date must be before or equal to to_date', data: null };
  }

  const type = (p.type || 'country').toLowerCase();
  if (!['country', 'lcs'].includes(type)) {
    return { code: 400, message: 'Invalid type. Must be one of: country, lcs', data: null };
  }

  const postOwnerId = parseInt(p.post_owner_id, 10);
  const dateRange = getCustomDateRange(p.from_date, p.to_date);
  const base = { from_date: p.from_date, to_date: p.to_date, post_owner_id: postOwnerId };

  if (type === 'country') {
    const esResult = await db.elastic.search({
      index: TT_INDEX,
      body: {
        size: 10000,
        _source: ['sql_id', 'countries'],
        query: {
          bool: {
            filter: [
              { term: { post_owner_id: postOwnerId } },
              { range: { last_seen: dateRange } },
            ],
          },
        },
      },
    });

    const hits = (esResult.hits || esResult.body?.hits)?.hits;
    if (!hits || hits.length === 0) return { code: 400, message: 'No data found.', ...base, data: [] };

    const countryMap = {};
    for (const hit of hits) {
      const src = hit._source;
      const adId = src.sql_id;
      if (!adId) continue;
      let countries = src.countries;
      if (!countries) continue;
      if (!Array.isArray(countries)) countries = [countries];
      for (const iso of countries) {
        if (!iso) continue;
        if (!countryMap[iso]) countryMap[iso] = new Set();
        countryMap[iso].add(adId);
      }
    }

    if (Object.keys(countryMap).length === 0) return { code: 400, message: 'No data found.', ...base, data: [] };

    const data = Object.entries(countryMap)
      .sort((a, b) => b[1].size - a[1].size)
      .map(([iso, idSet]) => ({
        iso: iso.toUpperCase(),
        ad_ids: [...idSet],
        ad_count: idSet.size,
      }));

    return { code: 200, message: 'Advertiser country data fetched.', ...base, data };
  }

  // type === 'lcs'
  const esResult = await db.elastic.search({
    index: TT_INDEX,
    body: {
      size: 10000,
      _source: ['sql_id', 'last_seen', 'likes', 'comments', 'shares'],
      query: {
        bool: {
          filter: [
            { term: { post_owner_id: postOwnerId } },
            { range: { last_seen: dateRange } },
          ],
        },
      },
    },
  });

  const hits = (esResult.hits || esResult.body?.hits)?.hits;
  if (!hits || hits.length === 0) return { code: 400, message: 'No data found.', ...base, data: {} };

  const monthlyData = {};
  for (const hit of hits) {
    const src = hit._source;
    const rawDate = src.last_seen;
    if (!rawDate) continue;
    const d = new Date(rawDate);
    if (isNaN(d.getTime())) continue;

    const key = `${MONTH_NAMES[d.getMonth()]}_${d.getFullYear()}`;
    if (!monthlyData[key]) {
      monthlyData[key] = { ad_ids: [], total_ads: 0, likes: 0, comments: 0, shares: 0 };
    }
    monthlyData[key].ad_ids.push(src.sql_id);
    monthlyData[key].total_ads += 1;
    monthlyData[key].likes += Number(src.likes) || 0;
    monthlyData[key].comments += Number(src.comments) || 0;
    monthlyData[key].shares += Number(src.shares) || 0;
  }

  const sortedData = {};
  Object.keys(monthlyData)
    .sort((a, b) => {
      const [mA, yA] = a.split('_');
      const [mB, yB] = b.split('_');
      return (Number(yA) - Number(yB)) || (MONTH_NAMES.indexOf(mA) - MONTH_NAMES.indexOf(mB));
    })
    .forEach(k => { sortedData[k] = monthlyData[k]; });

  return { code: 200, message: 'Advertiser LCS data fetched.', ...base, data: sortedData };
}

module.exports = { getLCS, getAnalytics, getIndustries, getAdvertiserLCSData, getAdvertiserCountryData, getAdvertiserInsightsByDateRange };