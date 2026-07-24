'use strict';

const { normalizeParams } = require('../helpers/paramParser');

// ─── 1. getLikeCommentShareDetails ────────────────────────

const LCS_SQL = `
  SELECT
    instagram_ad_analytics.id,
    instagram_ad_analytics.instagram_ad_id,
    instagram_ad_analytics.likes,
    instagram_ad_analytics.comments AS comment,
    instagram_ad_analytics.shares   AS share,
    UNIX_TIMESTAMP(instagram_ad_analytics.date) AS date
  FROM instagram_ad_analytics
  WHERE instagram_ad_analytics.instagram_ad_id = ?
  ORDER BY instagram_ad_analytics.date ASC
`;

async function getLikeCommentShareDetails(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.instagram_ad_id || !p.user_id) {
    return { code: 401, message: 'Missing parameters: instagram_ad_id and user_id are required' };
  }
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const adId = parseInt(p.instagram_ad_id, 10);
    const rows = await db.sql.query(LCS_SQL, [adId]);

    if (!rows || rows.length === 0) {
      return { code: 400, message: 'No data found.', data: null };
    }

    // Convert date from BigInt to Number (UNIX_TIMESTAMP returns BigInt in mysql2)
    for (const r of rows) {
      if (r.date != null) r.date = Number(r.date);
    }

    return { code: 200, message: 'Instagram analytics details.', data: rows };
  } catch (err) {
    logger.error('Error in getLikeCommentShareDetails', { error: err.message });
    return { code: 500, message: 'Error fetching LCS details', error: err.message };
  }
}

// ─── 2. getInstagramAdCountry ─────────────────────────────

const COUNTRY_SQL = `
  SELECT instagram_country_only.country
  FROM instagram_ad_countries_only
  LEFT JOIN instagram_country_only
    ON instagram_ad_countries_only.country_only_id = instagram_country_only.id
  WHERE instagram_ad_countries_only.instagram_ad_id = ?
    AND instagram_country_only.country IS NOT NULL
`;

const COUNTRY_ISO_SQL = `SELECT nicename AS country, 	instagram_country_iso FROM country_data WHERE nicename = ? LIMIT 1`;

/**
 * Fix known country ISO mapping quirks (mirrors PHP/Facebook logic).
 */
function fixCountryIso(country, iso) {
  const name = (country || '').toLowerCase();
  if (country === 'Czechia') return 'CZ';
  if (country === 'Russia') return 'RU';
  if (name.includes('congo') && (!iso || iso === 'null')) return 'CD';
  return iso;
}

async function getInstagramAdCountry(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.instagram_ad_id || !p.user_id) {
    return { code: 401, message: 'Missing parameters: instagram_ad_id and user_id are required' };
  }
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const adId = parseInt(p.instagram_ad_id, 10);
    const rows = await db.sql.query(COUNTRY_SQL, [adId]);

    if (!rows || rows.length === 0) {
      return { code: 400, message: 'No data found.' };
    }

    // Get unique country names and map to ISO codes
    const seen = new Set();
    const resArray = [];
    for (const row of rows) {
      if (!row.country || seen.has(row.country)) continue;
      seen.add(row.country);

      let iso = null;
      try {
        const isoRows = await db.sql.query(COUNTRY_ISO_SQL, [row.country]);
        if (isoRows?.length > 0) {
          iso = isoRows[0].instagram_country_iso;
          row.country = isoRows[0].country; // use proper name from country_data
        }
      } catch { /* skip */ }

      iso = fixCountryIso(row.country, iso);
      resArray.push({
        country: row.country ? row.country.replace(/\b\w/g, c => c.toUpperCase()) : row.country,
        iso,
      });
    }

    return { code: 200, message: 'instagram country data fetched.', data: resArray };
  } catch (err) {
    logger.error('Error in getInstagramAdCountry', { error: err.message });
    return { code: 500, message: 'Error fetching country data', error: err.message };
  }
}

// ─── 3. getInstagramUserData ──────────────────────────────

const AD_USERS_SQL = `
  SELECT * FROM instagram_ad_users WHERE instagram_ad_id = ?
`;

const IG_USERS_SQL = (ids) => `
  SELECT * FROM instagram_user WHERE id IN (${ids.map(() => '?').join(',')})
`;

async function getInstagramUserData(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.instagram_ad_id || !p.user_id) {
    return { code: 401, message: 'Missing parameters' };
  }
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    // Step 1: Get user IDs linked to this ad
    const adUserRows = await db.sql.query(AD_USERS_SQL, [p.instagram_ad_id]);

    if (!adUserRows || adUserRows.length === 0) {
      return { code: 201, message: 'No users connected to this ad', data: null };
    }

    const userIds = adUserRows.map(r => r.user_id).filter(Boolean);
    if (userIds.length === 0) {
      return { code: 201, message: 'No users connected to this ad', data: null };
    }

    // Step 2: Fetch user details
    const users = await db.sql.query(IG_USERS_SQL(userIds), userIds);

    if (!users || users.length === 0) {
      return { code: 400, message: 'No data found.', data: null };
    }

    return { code: 200, message: 'Instagram_users details.', data: users };
  } catch (err) {
    logger.error('Error in getInstagramUserData', { error: err.message });
    return { code: 500, message: 'Error fetching user data', error: err.message };
  }
}

// ─── 4. getRedirectOutgoingUrls ──────────────────────────

const OUTGOING_SQL = `
  SELECT instagram_ad_url.url_type, instagram_ad_url.url
  FROM instagram_ad_url
  WHERE instagram_ad_url.instagram_ad_id = ?
`;

async function getRedirectOutgoingUrls(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.instagram_ad_id || !p.user_id) {
    return { code: 401, message: 'Missing parameters: instagram_ad_id and user_id are required' };
  }
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const rows = await db.sql.query(OUTGOING_SQL, [p.instagram_ad_id]);

    if (rows && rows.length > 0) {
      return { code: 200, message: 'FacebookAd details.', data: rows };
    }
    return { code: 400, message: 'No data found.', data: null };
  } catch (err) {
    logger.error('Error in getRedirectOutgoingUrls', { error: err.message });
    return { code: 401, message: err.message, data: null };
  }
}


// ─── 5. getAdsLibUserData ────────────────────────────────

const ADS_LIB_USER_SQL = `
  SELECT gender_details, age_details
  FROM instagram_page_details
  WHERE instagram_ad_id = ?
  LIMIT 1
`;

async function getAdsLibUserData(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.instagram_ad_id || !p.user_id) {
    return { code: 401, message: 'Missing parameters' };
  }
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const rows = await db.sql.query(ADS_LIB_USER_SQL, [parseInt(p.instagram_ad_id, 10)]);

    if (!rows || rows.length === 0) {
      return { code: 400, message: 'No data found.', data: null };
    }

    const row = rows[0];
    return {
      code: 200,
      message: 'Data Fetched Successfully',
      data: {
        genderData: JSON.parse(row.gender_details || '{}'),
        ageData: JSON.parse(row.age_details || '{}'),
      },
    };
  } catch (err) {
    logger.error('Error in getAdsLibUserData', { error: err.message });
    return { code: 401, message: 'Some Exception Occured', data: null };
  }
}

// ─── 6. Advertiser-level helpers ────────────────────────

const AD_META_SQL = `
  SELECT ia.last_seen, ia.post_owner_id, iapo.post_owner_name
  FROM instagram_ad ia
  JOIN instagram_ad_post_owners iapo ON ia.post_owner_id = iapo.id
  WHERE ia.id = ?
  LIMIT 1
`;

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Build ES date range filter for a specific year.
 */
function getYearRange(year) {
  return {
    gte: `${year}-01-01 00:00:00`,
    lte: `${year}-12-31 23:59:59`,
    format: "yyyy-MM-dd' 'HH:mm:ss",
  };
}

/**
 * Build ES date range filter from explicit from/to date strings (YYYY-MM-DD).
 */
function getCustomDateRange(fromDate, toDate) {
  return {
    gte: `${fromDate} 00:00:00`,
    lte: `${toDate} 23:59:59`,
    format: "yyyy-MM-dd' 'HH:mm:ss",
  };
}

/**
 * Fetch all distinct years an advertiser has ads in ES.
 *
 * date_histogram aggregation with `size: 0` — ES never materialises hits.
 * `interval: 'year'` (not `calendar_interval`) for ES 6.x compatibility.
 */
async function fetchAvailableYears(db, postOwnerName) {
  try {
    const esResult = await db.elastic.search({
      index: process.env.IG_ES_INDEX,
      body: {
        size: 0,
        query: {
          bool: {
            filter: [
              { match: { 'instagram_ad_post_owners.post_owner_name_exactly': postOwnerName } },
              { range: { 'instagram_ad.last_seen': { gte: '2000-01-01 00:00:00', lte: '2099-12-31 23:59:59', format: "yyyy-MM-dd' 'HH:mm:ss" } } },
            ],
          },
        },
        aggs: {
          years: {
            date_histogram: {
              field: 'instagram_ad.last_seen',
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
      .filter(y => Number.isFinite(y))
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/**
 * Core logic: given a postOwnerName + ES date range, fetch monthly LCS from ES + SQL.
 */
async function fetchMonthlyLCSForAdvertiser(db, postOwnerName, dateRange) {
  const esResult = await db.elastic.search({
    index: process.env.IG_ES_INDEX,
    body: {
      size: 10000,
      _source: ['instagram_ad.id', 'instagram_ad.last_seen'],
      query: {
        bool: {
          filter: [
            { match: { 'instagram_ad_post_owners.post_owner_name_exactly': postOwnerName } },
            { range: { 'instagram_ad.last_seen': dateRange } },
          ],
        },
      },
    },
  });

  const hits = (esResult.hits || esResult.body?.hits)?.hits;
  if (!hits || hits.length === 0) return null;

  // Segregate ad IDs by month
  const monthlyIds = {};
  const yearSet = new Set();
  for (const hit of hits) {
    const src = hit._source;
    const adId = src['instagram_ad.id'];
    const postDate = src['instagram_ad.last_seen'];
    if (!adId || !postDate) continue;

    const dt = new Date(postDate);
    if (isNaN(dt.getTime())) continue;

    const year = dt.getFullYear();
    yearSet.add(year);
    const key = `${MONTH_NAMES[dt.getMonth()]}_${year}`;
    if (!monthlyIds[key]) monthlyIds[key] = [];
    monthlyIds[key].push(adId);
  }

  if (Object.keys(monthlyIds).length === 0) return null;

  // Batch fetch summed LCS from instagram_ad_analytics for all IDs at once
  const uniqueIds = [...new Set(Object.values(monthlyIds).flat())];
  const placeholders = uniqueIds.map(() => '?').join(',');
  const analyticsRows = await db.sql.query(
    `SELECT a.instagram_ad_id, SUM(a.likes) AS total_likes, SUM(a.comments) AS total_comments, SUM(a.shares) AS total_shares
     FROM instagram_ad_analytics a
     INNER JOIN (
       SELECT instagram_ad_id, MAX(date) AS max_date
       FROM instagram_ad_analytics
       WHERE instagram_ad_id IN (${placeholders})
       GROUP BY instagram_ad_id
     ) latest ON a.instagram_ad_id = latest.instagram_ad_id AND a.date = latest.max_date
     WHERE a.instagram_ad_id IN (${placeholders})
     GROUP BY a.instagram_ad_id`,
    [...uniqueIds, ...uniqueIds]
  );

  const analyticsMap = {};
  if (analyticsRows) {
    for (const row of analyticsRows) {
      analyticsMap[row.instagram_ad_id] = {
        likes: Number(row.total_likes) || 0,
        comments: Number(row.total_comments) || 0,
        shares: Number(row.total_shares) || 0,
      };
    }
  }

  // Build monthly response sorted chronologically
  const monthlyData = {};
  const sortedKeys = Object.keys(monthlyIds).sort((a, b) => {
    const [mA, yA] = a.split('_');
    const [mB, yB] = b.split('_');
    return (Number(yA) - Number(yB)) || (MONTH_NAMES.indexOf(mA) - MONTH_NAMES.indexOf(mB));
  });

  for (const key of sortedKeys) {
    const ids = monthlyIds[key];
    let totalLikes = 0, totalComments = 0, totalShares = 0;
    for (const id of ids) {
      const stats = analyticsMap[id];
      if (stats) {
        totalLikes += stats.likes;
        totalComments += stats.comments;
        totalShares += stats.shares;
      }
    }
    monthlyData[key] = {
      ad_ids: ids,
      total_ads: ids.length,
      likes: totalLikes,
      comments: totalComments,
      shares: totalShares,
    };
  }

  const years = [...yearSet].sort((a, b) => a - b);
  return { monthlyData, years };
}

/**
 * Batch-fetch ISO codes for multiple country names in a single query.
 * Returns a Map keyed by a normalized country name:
 * normalized nicename → { country, iso }
 */
async function batchCountryLookup(db, names) {
  if (!db.sql || !names || names.length === 0) return new Map();
  const uniqueNames = [...new Set(names.map(normalizeCountryKey).filter(Boolean))];
  if (uniqueNames.length === 0) return new Map();
  const placeholders = uniqueNames.map(() => '?').join(',');
  try {
    const rows = await db.sql.query(
      `SELECT nicename, nicename AS country, instagram_country_iso AS iso FROM country_data WHERE LOWER(TRIM(nicename)) IN (${placeholders})`,
      uniqueNames
    );
    const map = new Map();
    if (rows) {
      for (const row of rows) {
        const key = normalizeCountryKey(row.nicename);
        if (key) map.set(key, { country: row.country, iso: row.iso });
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

function normalizeCountryKey(country) {
  return String(country ?? '').trim().toLowerCase();
}

function formatCountryName(country) {
  const value = String(country ?? '').trim();
  if (normalizeCountryKey(value) === 'all') return 'ALL';
  return value.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// ─── 7. getAdvertiserLCSData ────────────────────────────

/**
 * Fetch advertiser-level monthly LCS data for the year of the ad's post_date.
 * Returns { monthlyData, years, post_owner_id, year, available_years }
 */
async function getAdvertiserLCSData(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);
  if (!p.instagram_ad_id) return { code: 401, message: 'Missing instagram_ad_id', data: null };
  if (!db.elastic) return { code: 503, message: 'Search service not available', data: null };

  const metaRows = await db.sql.query(AD_META_SQL, [p.instagram_ad_id]);
  const meta = metaRows?.[0];
  const postOwnerName = meta?.post_owner_name || null;
  if (!postOwnerName) return { code: 400, message: 'Advertiser not found', data: null };

  const postOwnerId = meta?.post_owner_id || null;
  const adPostDate = meta?.last_seen ? new Date(meta.last_seen) : null;
  const adYear = adPostDate && !isNaN(adPostDate.getTime()) ? adPostDate.getFullYear() : new Date().getFullYear();

  // Fetch data for the ad's year (monthly breakdown) + available years in parallel
  const results = await Promise.allSettled([
    fetchMonthlyLCSForAdvertiser(db, postOwnerName, getYearRange(adYear)),
    fetchAvailableYears(db, postOwnerName),
  ]);

  const yearResult = results[0].status === 'fulfilled' ? results[0].value : null;
  const availableYears = results[1].status === 'fulfilled' ? results[1].value : [];

  if (!yearResult) return { code: 400, message: 'No data found.', data: null };

  return {
    code: 200,
    message: 'Advertiser LCS data fetched.',
    post_owner_id: postOwnerId,
    year: adYear,
    available_years: availableYears,
    data: yearResult.monthlyData,
  };
}

/**
 * Shared: country aggregation from ES hits.
 */
async function aggregateCountryData(db, hits) {
  const countryMap = new Map();
  for (const hit of hits) {
    // Support both shapes — _source (legacy) and docvalue_fields (perf path).
    // docvalue fields always come back as arrays even for single values.
    const src = hit._source;
    const f = hit.fields;
    const adId = src ? src['instagram_ad.id'] : f?.['instagram_ad.id']?.[0];
    if (!adId) continue;
    let countries = src
      ? src['instagram_country_only.country']
      : (f?.['instagram_country_only.country.keyword'] || f?.['instagram_country_only.country']);
    if (!countries) continue;
    if (!Array.isArray(countries)) countries = [countries];
    for (const country of countries) {
      const key = normalizeCountryKey(country);
      if (!key) continue;
      if (!countryMap.has(key)) {
        countryMap.set(key, { originalName: String(country).trim(), adIds: new Set() });
      }
      countryMap.get(key).adIds.add(adId);
    }
  }
  if (countryMap.size === 0) return null;

  const isoMap = await batchCountryLookup(db, [...countryMap.keys()]);
  const result = [];
  const sortedEntries = [...countryMap.entries()].sort((a, b) => b[1].adIds.size - a[1].adIds.size);

  for (const [key, entry] of sortedEntries) {
    const adIds = [...entry.adIds];
    const lookup = isoMap.get(key);
    let country = lookup?.country || entry.originalName;
    let iso = fixCountryIso(country, lookup?.iso || null);
    country = formatCountryName(country);
    result.push({ country, iso, ad_ids: adIds, ad_count: adIds.length });
  }
  return result;
}

// ─── 8. getAdvertiserCountryData ────────────────────────

/**
 * Fetch advertiser-level country data for the year of the ad's post_date.
 */
async function getAdvertiserCountryData(req, db) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);
  if (!p.instagram_ad_id) return { code: 401, message: 'Missing instagram_ad_id', data: null };

  const metaRows = await db.sql.query(AD_META_SQL, [p.instagram_ad_id]);
  const meta = metaRows?.[0];
  const postOwnerName = meta?.post_owner_name || null;
  if (!postOwnerName || !db.elastic) return { code: 400, message: 'Advertiser not found', data: null };
  const postOwnerId = meta?.post_owner_id || null;

  const adPostDate = meta?.last_seen ? new Date(meta.last_seen) : null;
  const adYear = adPostDate && !isNaN(adPostDate.getTime()) ? adPostDate.getFullYear() : new Date().getFullYear();

  const advertiserFilter = { match: { 'instagram_ad_post_owners.post_owner_name_exactly': postOwnerName } };
  const results = await Promise.allSettled([
    // docvalue_fields + _source:false + filter_path + track_total_hits:false
    // — same perf pattern as Google/Native/Facebook.
    db.elastic.search({
      index: process.env.IG_ES_INDEX,
      filter_path: 'hits.hits.fields',
      body: {
        size: 10000,
        track_total_hits: false,
        _source: false,
        docvalue_fields: ['instagram_ad.id', 'instagram_country_only.country.keyword'],
        query: {
          bool: {
            filter: [
              advertiserFilter,
              { range: { 'instagram_ad.last_seen': getYearRange(adYear) } },
            ],
          },
        },
      },
    }),
    fetchAvailableYears(db, postOwnerName),
  ]);

  const esResult = results[0].status === 'fulfilled' ? results[0].value : null;
  const availableYears = results[1].status === 'fulfilled' ? results[1].value : [];

  const hits = (esResult?.hits || esResult?.body?.hits)?.hits;
  if (!hits || hits.length === 0) return { code: 400, message: 'No data found.', data: null };

  const data = await aggregateCountryData(db, hits);
  if (!data) return { code: 400, message: 'No data found.', data: null };

  return { code: 200, message: 'Advertiser country data fetched.', post_owner_id: postOwnerId, year: adYear, available_years: availableYears, data };
}

const POST_OWNER_NAME_SQL = `SELECT post_owner_name FROM instagram_ad_post_owners WHERE id = ? LIMIT 1`;

/**
 * Unified advertiser insights by date range.
 * Body: { post_owner_id, from_date, to_date, type }
 *   - type: "lcs" | "country"
 */
async function getAdvertiserInsightsByDateRange(req, db) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  const userId = p.user_id || req.user?.id;
  if (!userId) return { code: 401, message: 'Missing user_id', data: null };

  if (!p.post_owner_id) return { code: 400, message: 'Missing post_owner_id', data: null };
  if (!p.from_date || !p.to_date) return { code: 400, message: 'Missing from_date or to_date', data: null };

  const type = (p.type || 'lcs').toLowerCase();
  if (!['lcs', 'country'].includes(type)) {
    return { code: 400, message: 'Invalid type. Must be one of: lcs, country', data: null };
  }

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRe.test(p.from_date) || !dateRe.test(p.to_date)) {
    return { code: 400, message: 'Invalid date format. Use YYYY-MM-DD', data: null };
  }
  if (p.from_date > p.to_date) {
    return { code: 400, message: 'from_date must be before or equal to to_date', data: null };
  }

  if (!db.elastic) return { code: 503, message: 'Search service not available', data: null };

  const ownerRows = await db.sql.query(POST_OWNER_NAME_SQL, [p.post_owner_id]);
  const postOwnerName = ownerRows?.[0]?.post_owner_name || null;
  if (!postOwnerName) return { code: 400, message: 'Advertiser not found', data: null };

  const dateRange = getCustomDateRange(p.from_date, p.to_date);
  const base = { from_date: p.from_date, to_date: p.to_date, post_owner_id: p.post_owner_id };

  if (type === 'lcs') {
    const result = await fetchMonthlyLCSForAdvertiser(db, postOwnerName, dateRange);
    if (!result) return { code: 400, message: 'No data found.', data: null };
    return { code: 200, message: 'Advertiser LCS data fetched.', ...base, available_years: result.years, data: result.monthlyData };
  }

  // country — docvalue_fields path
  const esResult = await db.elastic.search({
    index: process.env.IG_ES_INDEX,
    filter_path: 'hits.hits.fields',
    body: {
      size: 10000,
      track_total_hits: false,
      _source: false,
      docvalue_fields: ['instagram_ad.id', 'instagram_country_only.country.keyword'],
      query: {
        bool: {
          filter: [
            { match: { 'instagram_ad_post_owners.post_owner_name_exactly': postOwnerName } },
            { range: { 'instagram_ad.last_seen': dateRange } },
          ],
        },
      },
    },
  });

  const hits = (esResult.hits || esResult.body?.hits)?.hits;
  if (!hits || hits.length === 0) return { code: 400, message: 'No data found.', data: null };

  const data = await aggregateCountryData(db, hits);
  if (!data) return { code: 400, message: 'No data found.', data: null };
  return { code: 200, message: 'Advertiser country data fetched.', ...base, data };
}

module.exports = {
  getLikeCommentShareDetails,
  getInstagramAdCountry,
  getInstagramUserData,
  getRedirectOutgoingUrls,
  getAdsLibUserData,
  getAdvertiserLCSData,
  getAdvertiserCountryData,
  getAdvertiserInsightsByDateRange,
};
