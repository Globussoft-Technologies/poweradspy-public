'use strict';

const { normalizeParams } = require('../helpers/paramParser');

// ─── 1. getLikeCommentFollowerCount ────────────────────────

const LCS_SQL = `
  SELECT
    linkedin_ad_analytics.likes,
    linkedin_ad_analytics.comments,
    linkedin_ad_analytics.followers,
    linkedin_ad_analytics.hits,
    linkedin_ad_analytics.date,
    linkedin_ad_meta_data.platform,
    linkedin_ad_analytics.linkedin_ad_id
  FROM linkedin_ad_analytics
  LEFT JOIN linkedin_ad_meta_data ON linkedin_ad_analytics.linkedin_ad_id = linkedin_ad_meta_data.linkedin_ad_id
  WHERE linkedin_ad_analytics.linkedin_ad_id = ?
  ORDER BY linkedin_ad_analytics.date ASC
`;

const POST_DATE_SQL = `SELECT post_date FROM linkedin_ad WHERE id = ? LIMIT 1`;

async function getLikeCommentFollowerCount(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.linkedin_ad_id || !p.user_id) {
    return { code: 401, message: 'Missing parameters: linkedin_ad_id and user_id are required' };
  }
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const rows = await db.sql.query(LCS_SQL, [parseInt(p.linkedin_ad_id, 10)]);
    if (!rows || rows.length === 0) return { code: 400, message: 'No data found.', data: null };

    // Prepend initial zero row (mirrors PHP logic by Danish)
    let postDate;
    try {
      const pdRows = await db.sql.query(POST_DATE_SQL, [p.linkedin_ad_id]);
      postDate = pdRows?.[0]?.post_date || null;
    } catch { postDate = null; }

    if (postDate) {
      const pd = new Date(postDate);
      if (pd.getTime() <= 0) {
        const firstDate = new Date(rows[0].date);
        firstDate.setDate(firstDate.getDate() - 1);
        postDate = firstDate.toISOString().split('T')[0];
      } else {
        postDate = pd.toISOString().split('T')[0];
      }
    } else {
      const firstDate = new Date(rows[0].date);
      firstDate.setDate(firstDate.getDate() - 1);
      postDate = firstDate.toISOString().split('T')[0];
    }

    const initialRow = {
      id: 0,
      linkedin_ad_id: rows[0].linkedin_ad_id,
      likes: 0,
      comments: 0,
      followers: 0,
      date: postDate,
      platform: rows[0].platform,
    };

    for (const r of rows) {
      if (r.date) r.date = new Date(r.date).toISOString().split('T')[0];
    }

    return { code: 200, message: 'Linkedin Analytics Details.', data: [initialRow, ...rows] };
  } catch (err) {
    logger.error('Error in getLikeCommentFollowerCount', { error: err.message });
    return { code: 500, message: 'Error fetching LCS details', error: err.message };
  }
}

// ─── 2. getLinkedinAdCountry ────────────────────────────

const COUNTRY_SQL = `
  SELECT country_only.country, linkedin_ad_countries_only.linkedin_ad_id, country_data.iso
  FROM linkedin_ad_countries_only
  LEFT JOIN country_only ON linkedin_ad_countries_only.country_only_id = country_only.id
  LEFT JOIN country_data ON country_only.country = country_data.nicename
  WHERE linkedin_ad_countries_only.linkedin_ad_id = ?
    AND country_only.country IS NOT NULL
`;

function fixCountryIso(country, iso) {
  const name = (country || '').toLowerCase();
  if (country === 'Czechia') return 'CZ';
  if (country === 'Russia') return 'RU';
  if (name.includes('congo') && (!iso || iso === 'null')) return 'CD';
  return iso;
}

async function getLinkedinAdCountry(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.linkedin_ad_id || !p.user_id) {
    return { code: 401, message: 'Missing parameters: linkedin_ad_id and user_id are required' };
  }
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const rows = await db.sql.query(COUNTRY_SQL, [parseInt(p.linkedin_ad_id, 10)]);
    if (!rows || rows.length === 0) return { code: 400, message: 'No data found.' };

    const resArray = rows.map(row => ({
      country: row.country ? row.country.replace(/\b\w/g, c => c.toUpperCase()) : row.country,
      iso: fixCountryIso(row.country, row.iso),
    }));

    return { code: 200, message: 'Linkedin country data fetched.', data: resArray };
  } catch (err) {
    logger.error('Error in getLinkedinAdCountry', { error: err.message });
    return { code: 500, message: 'Error fetching country data', error: err.message };
  }
}

// ─── 3. getLinkedinOutgoings ────────────────────────────

const OUTGOING_SQL = `
  SELECT source_url, redirect_url, final_url
  FROM linkedin_ad_outgoing_links
  WHERE linkedin_ad_id = ?
`;

async function getLinkedinOutgoings(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.linkedin_ad_id) return { code: 401, message: 'Missing parameters: linkedin_ad_id is required' };
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const rows = await db.sql.query(OUTGOING_SQL, [p.linkedin_ad_id]);
    if (rows && rows.length > 0) return { code: 200, data: rows, message: 'Urls found' };
    return { code: 400, data: null, message: 'No urls found' };
  } catch (err) {
    logger.error('Error in getLinkedinOutgoings', { error: err.message });
    return { code: 401, data: [] };
  }
}

// ─── 4. Advertiser-level helpers ────────────────────────

// ─── 4. Advertiser-level helpers ────────────────────────

const AD_META_SQL = `
  SELECT la.last_seen, lapo.post_owner_name, la.post_owner_id
  FROM linkedin_ad la
  JOIN linkedin_ad_post_owners lapo ON la.post_owner_id = lapo.id
  WHERE la.id = ?
  LIMIT 1
`;

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function getYearRange(year) {
  const gte = Math.floor(new Date(`${year}-01-01T00:00:00Z`).getTime() / 1000);
  const lte = Math.floor(new Date(`${year}-12-31T23:59:59Z`).getTime() / 1000);
  return { gte, lte, format: 'epoch_second' };
}

function getCustomDateRange(from, to) {
  const gte = Math.floor(new Date(`${from}T00:00:00Z`).getTime() / 1000);
  const lte = Math.floor(new Date(`${to}T23:59:59Z`).getTime() / 1000);
  return { gte, lte, format: 'epoch_second' };
}

async function fetchAvailableYears(elastic, index, filter) {
  // date_histogram aggregation replaces a 10k-doc fetch+JS-extract pass.
  // `interval: 'year'` (not `calendar_interval`) for ES 6.x compatibility.
  // LinkedIn stores last_seen as epoch_second; date_histogram on a numeric
  // epoch field still produces year buckets correctly because ES treats
  // any date-typed field uniformly. (If the mapping is `long` instead of
  // `date`, this aggregation would fail and we fall through to []; that
  // failure mode is the same as the legacy code's empty-result path.)
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
  } catch {
    return [];
  }
}

async function aggregateCountryData(db, hits) {
  if (!hits || hits.length === 0) return null;

  const countryMap = {};
  for (const hit of hits) {
    const src = hit._source;
    // LinkedIn ES uses _id as the ad identifier, not a nested field
    const adId = hit._id || src.post_owner_id;
    if (!adId) continue;

    // LinkedIn ES stores countries as a flat 'countries' array
    let countries = src.countries;
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

// ─── 5. getAdvertiserLCSData ────────────────────────────

/**
 * Fetch advertiser-level monthly LCS data for the last 12 months.
 * LinkedIn has: likes, comments, followers (no shares).
 */
async function getAdvertiserLCSData(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);
  if (!p.linkedin_ad_id) return { code: 401, message: 'Missing linkedin_ad_id', data: null };

  const metaRows = await db.sql.query(AD_META_SQL, [p.linkedin_ad_id]);
  const postOwnerName = metaRows?.[0]?.post_owner_name || null;
  const postOwnerId = metaRows?.[0]?.post_owner_id || null;
  if (!postOwnerName || !db.elastic) return { code: 400, message: 'Advertiser not found', data: null };

  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
  const dateRange = {
    gte: Math.floor(twelveMonthsAgo.getTime() / 1000),
    lte: Math.floor(Date.now() / 1000),
    format: 'epoch_second',
  };

  const esResult = await db.elastic.search({
    index: 'linkedin_ads_data',
    body: {
      size: 10000,
      _source: ['last_seen'],
      query: {
        bool: {
          filter: [
            { match_phrase: { post_owner: postOwnerName } },
            { range: { last_seen: dateRange } },
          ],
        },
      },
    },
  });

  const hits = (esResult.hits || esResult.body?.hits)?.hits;
  if (!hits || hits.length === 0) return { code: 400, message: 'No data found.', data: null };

  const monthlyIds = {};
  for (const hit of hits) {
    const src = hit._source;
    const adId = hit._id;
    const rawPostDate = src.last_seen;
    if (!adId || !rawPostDate) continue;

    // LinkedIn stores last_seen as Unix timestamp (epoch seconds)
    const ts = Number(rawPostDate);
    const dt = ts > 1e9 ? new Date(ts * 1000) : new Date(rawPostDate);
    if (isNaN(dt.getTime())) continue;

    const key = `${MONTH_NAMES[dt.getMonth()]}_${dt.getFullYear()}`;
    if (!monthlyIds[key]) monthlyIds[key] = [];
    monthlyIds[key].push(adId);
  }

  if (Object.keys(monthlyIds).length === 0) return { code: 400, message: 'No data found.', data: null };

  const uniqueIds = [...new Set(Object.values(monthlyIds).flat())];
  if (uniqueIds.length === 0) return { code: 400, message: 'No data found.', data: null };

  const placeholders = uniqueIds.map(() => '?').join(',');
  const analyticsRows = await db.sql.query(
    `SELECT a.linkedin_ad_id, SUM(a.likes) AS total_likes, SUM(a.comments) AS total_comments, SUM(a.followers) AS total_followers
     FROM linkedin_ad_analytics a
     INNER JOIN (
       SELECT linkedin_ad_id, MAX(date) AS max_date
       FROM linkedin_ad_analytics
       WHERE linkedin_ad_id IN (${placeholders})
       GROUP BY linkedin_ad_id
     ) latest ON a.linkedin_ad_id = latest.linkedin_ad_id AND a.date = latest.max_date
     WHERE a.linkedin_ad_id IN (${placeholders})
     GROUP BY a.linkedin_ad_id`,
    [...uniqueIds, ...uniqueIds]
  );

  const analyticsMap = {};
  if (analyticsRows) {
    for (const row of analyticsRows) {
      analyticsMap[row.linkedin_ad_id] = {
        likes: Number(row.total_likes) || 0,
        comments: Number(row.total_comments) || 0,
        followers: Number(row.total_followers) || 0,
      };
    }
  }

  const result = {};
  const sortedKeys = Object.keys(monthlyIds).sort((a, b) => {
    const [mA, yA] = a.split('_');
    const [mB, yB] = b.split('_');
    return (Number(yA) - Number(yB)) || (MONTH_NAMES.indexOf(mA) - MONTH_NAMES.indexOf(mB));
  });

  for (const key of sortedKeys) {
    const ids = monthlyIds[key];
    let totalLikes = 0, totalComments = 0, totalFollowers = 0;
    for (const id of ids) {
      const stats = analyticsMap[id];
      if (stats) {
        totalLikes += stats.likes;
        totalComments += stats.comments;
        totalFollowers += stats.followers;
      }
    }
    result[key] = {
      ad_ids: ids,
      total_ads: ids.length,
      likes: totalLikes,
      comments: totalComments,
      followers: totalFollowers,
    };
  }

  return { code: 200, message: 'Advertiser LCS data fetched.', post_owner_id: postOwnerId, data: result };
}

// ─── 6. getAdvertiserCountryData ────────────────────────

/**
 * Fetch advertiser-level country data. Default to ad's year.
 */
async function getAdvertiserCountryData(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);
  if (!p.linkedin_ad_id) return { code: 401, message: 'Missing linkedin_ad_id', data: null };

  const metaRows = await db.sql.query(AD_META_SQL, [p.linkedin_ad_id]);
  const postOwnerName = metaRows?.[0]?.post_owner_name || null;
  const postOwnerId = metaRows?.[0]?.post_owner_id || null;
  const rawPostDate = metaRows?.[0]?.last_seen || null;

  if (!postOwnerName || !db.elastic) return { code: 400, message: 'Advertiser not found', data: null };

  // SQL last_seen may be a Date object, Unix timestamp, or date string
  let adYear;
  if (p.year) {
    adYear = p.year;
  } else if (rawPostDate) {
    let d;
    if (rawPostDate instanceof Date) {
      d = rawPostDate;
    } else {
      const ts = Number(rawPostDate);
      d = (ts > 1e9 && ts < 1e11) ? new Date(ts * 1000) : new Date(rawPostDate);
    }
    adYear = !isNaN(d.getTime()) ? d.getFullYear() : new Date().getFullYear();
  } else {
    adYear = new Date().getFullYear();
  }
  const dateRange = getYearRange(adYear);
  const index = 'linkedin_ads_data';

  const [availableYears, esResult] = await Promise.allSettled([
    fetchAvailableYears(db.elastic, index, { match_phrase: { post_owner: postOwnerName } }),
    db.elastic.search({
      index,
      body: {
        size: 10000,
        _source: ['countries'],
        query: {
          bool: {
            filter: [
              { match_phrase: { post_owner: postOwnerName } },
              { range: { last_seen: dateRange } },
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

// ─── 7. getAdvertiserInsightsByDateRange ────────────────

async function getAdvertiserInsightsByDateRange(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  const { post_owner_id, from_date, to_date, type } = p;
  if (!post_owner_id || !from_date || !to_date) {
    return { code: 401, message: 'Missing parameters: post_owner_id, from_date, to_date are required' };
  }

  const advertiserRows = await db.sql.query(
    `SELECT post_owner_name FROM linkedin_ad_post_owners WHERE id = ? LIMIT 1`,
    [post_owner_id]
  );
  const postOwnerName = advertiserRows?.[0]?.post_owner_name;
  if (!postOwnerName || !db.elastic) return { code: 400, message: 'Advertiser not found' };

  const dateRange = getCustomDateRange(from_date, to_date);
  const base = { from_date, to_date, post_owner_id };
  const index = 'linkedin_ads_data';

  const targetType = (type || 'country').toLowerCase();

  if (targetType === 'country') {
    const esResult = await db.elastic.search({
      index,
      body: {
        size: 10000,
        _source: ['countries'],
        query: {
          bool: {
            filter: [
              { match_phrase: { post_owner: postOwnerName } },
              { range: { last_seen: dateRange } },
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
  getLikeCommentFollowerCount,
  getLinkedinAdCountry,
  getLinkedinOutgoings,
  getAdvertiserLCSData,
  getAdvertiserCountryData,
  getAdvertiserInsightsByDateRange,
};
