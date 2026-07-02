'use strict';

const { normalizeParams } = require('../helpers/paramParser');

/**
 * Fix known country ISO mapping quirks (mirrors PHP logic).
 */
function fixCountryIso(country, iso) {
  const name = (country || '').toLowerCase();
  if (country === 'Czechia') return 'CZ';
  if (country === 'Russia') return 'RU';
  if (name.includes('congo') && (!iso || iso === 'null')) return 'CD';
  return iso;
}

/**
 * Normalize country name to title case.
 */
function normalizeCountryName(name) {
  return name
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Batch-fetch ISO codes for multiple country names in a single query.
 * Returns a Map: nicename → { country, iso }
 */
async function batchCountryLookup(db, names) {
  if (!db.sql || !names || names.length === 0) return new Map();
  const uniqueNames = [...new Set(names)];
  const normalizedNames = uniqueNames.map(normalizeCountryName);
  const placeholders = normalizedNames.map(() => '?').join(',');
  try {
    const rows = await db.sql.query(
      `SELECT nicename, name AS country, iso FROM country_data WHERE nicename IN (${placeholders})`,
      normalizedNames
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

// ─── 1. getLikeCommentShareDetails ────────────────────────

const LCS_SQL = `
  SELECT
    facebook_ad_analytics.id,
    facebook_ad_analytics.facebook_ad_id,
    facebook_ad_analytics.likes,
    facebook_ad_analytics.comments AS comment,
    facebook_ad_analytics.shares   AS share,
    facebook_ad_analytics.engagement_rate,
    facebook_ad_analytics.date
  FROM facebook_ad_analytics
  WHERE facebook_ad_analytics.facebook_ad_id = ?
  ORDER BY facebook_ad_analytics.date ASC
`;

// Combined: fetch post_date + advertiser name in one query (avoids 2 round-trips)
const AD_META_SQL = `
  SELECT fa.last_seen, fa.post_owner_id, fapo.post_owner_name
  FROM facebook_ad fa
  JOIN facebook_ad_post_owners fapo ON fa.post_owner_id = fapo.id
  WHERE fa.id = ?
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
 * Implemented as a `date_histogram` aggregation with `size: 0` so ES never
 * materialises the underlying hits — we only need year buckets. Replaces a
 * 10k-doc fetch+JS-extract pass that dominated latency for big advertisers.
 * `interval: 'year'` (not `calendar_interval`) for ES 6.x compatibility.
 */
async function fetchAvailableYears(db, postOwnerName) {
  try {
    const esResult = await db.elastic.search({
      index: process.env.FB_ES_INDEX,
      body: {
        size: 0,
        query: {
          bool: {
            filter: [
              { match: { 'facebook_ad_post_owners.post_owner_name_exactly': postOwnerName } },
              { range: { 'facebook_ad.last_seen': { gte: '2000-01-01 00:00:00', lte: '2099-12-31 23:59:59', format: "yyyy-MM-dd' 'HH:mm:ss" } } },
            ],
          },
        },
        aggs: {
          years: {
            date_histogram: {
              field: 'facebook_ad.last_seen',
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
 * Returns { monthlyData, years } where monthlyData is keyed by "mon_YYYY"
 * and years is a sorted array of distinct years found in the data.
 */
async function fetchMonthlyLCSForAdvertiser(db, postOwnerName, dateRange) {
  const esResult = await db.elastic.search({
    index: process.env.FB_ES_INDEX,
    body: {
      size: 10000,
      _source: ['facebook_ad.id', 'facebook_ad.last_seen'],
      query: {
        bool: {
          filter: [
            { match: { 'facebook_ad_post_owners.post_owner_name_exactly': postOwnerName } },
            { range: { 'facebook_ad.last_seen': dateRange } },
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
    const adId = src['facebook_ad.id'];
    const postDate = src['facebook_ad.last_seen'];
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

  // Batch fetch summed LCS from facebook_ad_analytics for all IDs at once
  const uniqueIds = [...new Set(Object.values(monthlyIds).flat())];
  const placeholders = uniqueIds.map(() => '?').join(',');
  const analyticsRows = await db.sql.query(
    `SELECT a.facebook_ad_id, SUM(a.likes) AS total_likes, SUM(a.comments) AS total_comments, SUM(a.shares) AS total_shares, SUM(a.engagement_rate) AS total_engagement_rate
     FROM facebook_ad_analytics a
     INNER JOIN (
       SELECT facebook_ad_id, MAX(date) AS max_date
       FROM facebook_ad_analytics
       WHERE facebook_ad_id IN (${placeholders})
       GROUP BY facebook_ad_id
     ) latest ON a.facebook_ad_id = latest.facebook_ad_id AND a.date = latest.max_date
     WHERE a.facebook_ad_id IN (${placeholders})
     GROUP BY a.facebook_ad_id`,
    [...uniqueIds, ...uniqueIds]
  );

  const analyticsMap = {};
  if (analyticsRows) {
    for (const row of analyticsRows) {
      analyticsMap[row.facebook_ad_id] = {
        likes: Number(row.total_likes) || 0,
        comments: Number(row.total_comments) || 0,
        shares: Number(row.total_shares) || 0,
        engagement_rate: Number(row.total_engagement_rate) || 0,
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
    let totalLikes = 0, totalComments = 0, totalShares = 0, totalEngagementRate = 0;
    for (const id of ids) {
      const stats = analyticsMap[id];
      if (stats) {
        totalLikes += stats.likes;
        totalComments += stats.comments;
        totalShares += stats.shares;
        totalEngagementRate += stats.engagement_rate;
      }
    }
    monthlyData[key] = {
      ad_ids: ids,
      total_ads: ids.length,
      likes: totalLikes,
      comments: totalComments,
      shares: totalShares,
      engagement_rate: parseFloat(totalEngagementRate.toFixed(2)),
    };
  }

  const years = [...yearSet].sort((a, b) => a - b);
  return { monthlyData, years };
}


const POST_DATE_SQL = `SELECT post_date FROM facebook_ad WHERE id = ? LIMIT 1`;

async function getLikeCommentShareDetails(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.facebook_ad_id || !p.user_id) {
    return { code: 401, message: 'Missing parameters: facebook_ad_id and user_id are required' };
  }
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const rows = await db.sql.query(LCS_SQL, [p.facebook_ad_id]);

    if (!rows || rows.length === 0) {
      return { code: 400, message: 'No data found.', data: null };
    }

    // Get post_date and prepend initial zero-point row (mirrors PHP logic by Danish)
    let postDate;
    try {
      const pdRows = await db.sql.query(POST_DATE_SQL, [p.facebook_ad_id]);
      postDate = pdRows?.[0]?.post_date || null;
    } catch { postDate = null; }

    const safeDate = (val) => {
      if (!val) return null;
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d;
    };

    if (postDate) {
      const pd = safeDate(postDate);
      if (!pd || pd.getTime() <= 0) {
        const firstDate = safeDate(rows[0].date);
        if (firstDate) { firstDate.setDate(firstDate.getDate() - 1); postDate = firstDate.toISOString().split('T')[0]; }
        else postDate = null;
      } else {
        postDate = pd.toISOString().split('T')[0];
      }
    } else {
      const firstDate = safeDate(rows[0].date);
      if (firstDate) { firstDate.setDate(firstDate.getDate() - 1); postDate = firstDate.toISOString().split('T')[0]; }
      else postDate = null;
    }

    // Prepend initial zero row
    const initialRow = {
      id: 0,
      facebook_ad_id: rows[0].facebook_ad_id,
      likes: 0,
      comment: 0,
      share: 0,
      engagement_rate: 0,
      date: postDate,
    };
    // Normalize all date fields to YYYY-MM-DD
    for (const r of rows) {
      if (r.date) {
        const d = new Date(r.date);
        r.date = isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
      }
    }
    const data = [initialRow, ...rows];

    // Overlay latest LCS from ES on the last row (mirrors PHP)
    if (db.elastic) {
      try {
        const esResult = await db.elastic.search({
          index: process.env.FB_ES_INDEX,
          body: {
            query: {
              bool: { filter: { terms: { 'facebook_ad.id': [parseInt(p.facebook_ad_id, 10)] } } },
            },
          },
        });
        const hits = esResult.hits || esResult.body?.hits;
        if (hits?.hits?.length > 0) {
          const src = hits.hits[0]._source;
          const last = data[data.length - 1];
          if (src['facebook_ad.likes'] !== undefined) last.likes = src['facebook_ad.likes'];
          if (src['facebook_ad.shares'] !== undefined) last.share = src['facebook_ad.shares'];
          if (src['facebook_ad.comments'] !== undefined) last.comment = src['facebook_ad.comments'];
          if (src['engagement_rate'] !== undefined) last.engagement_rate = src['engagement_rate'];
        }
      } catch (esErr) {
        logger.warn('ES overlay failed in LCS', { error: esErr.message });
      }
    }

    return { code: 200, message: 'Facebook analytics details.', data };
  } catch (err) {
    logger.error('Error in getLikeCommentShareDetails', { error: err.message });
    return { code: 500, message: 'Error fetching LCS details', error: err.message };
  }
}

// ─── 2. getFacebookAdCountry ─────────────────────────────

const COUNTRY_LOOKUP_SQL = `SELECT name AS country, iso FROM country_data WHERE nicename = ? LIMIT 1`;

async function getFacebookAdCountry(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.facebook_ad_id || !p.user_id) {
    return { code: 401, message: 'Missing parameters: facebook_ad_id and user_id are required' };
  }
  if (!db.elastic) return { code: 503, message: 'Elasticsearch connection not available' };

  try {
    // Step 1: Get country list from ES
    const esResult = await db.elastic.search({
      index: process.env.FB_ES_INDEX,
      body: {
        query: {
          bool: { filter: { terms: { 'facebook_ad.id': [parseInt(p.facebook_ad_id, 10)] } } },
        },
      },
    });

    const hits = esResult.hits || esResult.body?.hits;
    if (!hits?.hits?.length) {
      return { code: 401, message: 'Something Went Wrong' };
    }

    let countryData = hits.hits[0]._source['country_only.country'];
    if (!countryData) return { code: 401, message: 'Something Went Wrong' };
    if (!Array.isArray(countryData)) countryData = [countryData];
    if (countryData.length === 0) return { code: 401, message: 'Something Went Wrong' };

    // Step 2: Map country names to ISO codes via DB
    const resArray = [];

    if (db.sql) {
      for (const name of countryData) {
        try {
          const rows = await db.sql.query(COUNTRY_LOOKUP_SQL, [name]);
          if (rows?.length > 0) {
            resArray.push({ country: rows[0].country, iso: rows[0].iso });
          } else {
            resArray.push({ country: name, iso: null });
          }
        } catch {
          resArray.push({ country: name, iso: null });
        }
      }
    } else {
      // No SQL → just return raw names
      for (const name of countryData) {
        resArray.push({ country: name, iso: null });
      }
    }

    // Step 3: Fix known ISO quirks + capitalize
    for (const item of resArray) {
      item.iso = fixCountryIso(item.country, item.iso);
      if (item.country) {
        item.country = item.country.replace(/\b\w/g, c => c.toUpperCase());
      }
    }

    return { code: 200, message: 'facebook country data fetched.', data: resArray };
  } catch (err) {
    logger.error('Error in getFacebookAdCountry', { error: err.message });
    return { code: 500, message: 'Error fetching country data', error: err.message };
  }
}

// ─── 3. getFacebookUserData ──────────────────────────────

const AD_USERS_SQL = `
  SELECT facebook_ad_users.*
  FROM facebook_ad_users
  LEFT JOIN facebook_ad ON facebook_ad.id = facebook_ad_users.facebook_ad_id
  WHERE facebook_ad_id = ?
`;

const FB_USERS_SQL = (ids) => `
  SELECT age, name, facebook_id, current_country, others_places_lived,
         Gender, relationship_status, current_country_id
  FROM facebook_users
  WHERE facebook_users.id IN (${ids.map(() => '?').join(',')})
`;

const USER_ANALYTICS_SQL = `
  SELECT genderdata, relationshipdata, facebook_ad_id, agedata
  FROM facebook_ad_user_analytics
  WHERE facebook_ad_id = ?
`;

const INSERT_USER_ANALYTICS_SQL = `
  INSERT INTO facebook_ad_user_analytics (genderdata, relationshipdata, agedata, facebook_ad_id)
  VALUES (?, ?, ?, ?)
`;

/**
 * Compute graph analysis data from user demographics (mirrors PHP helper->graphAnalysisData).
 */
function graphAnalysisData(users) {
  if (!users || !Array.isArray(users) || users.length === 0) {
    return {
      genderData: { age_18_to_24: 0, age_25_to_34: 0, age_35_to_44: 0, age_45_to_54: 0, age_55_to_64: 0 },
      ageData: { male: 0, female: 0 },
      relationshipData: { married: 0, single: 0, others: 0 },
    };
  }

  let totalMale = 0, totalFemale = 0;
  let totalMarried = 0, totalSingle = 0, totalOthers = 0;
  const ageBuckets = { age_18_to_24: 0, age_25_to_34: 0, age_35_to_44: 0, age_45_to_54: 0, age_55_to_64: 0 };

  for (const u of users) {
    // Gender
    const g = (u.Gender || '').toLowerCase();
    if (g === 'm' || g === 'male') totalMale++;
    else if (g === 'f' || g === 'female') totalFemale++;

    // Relationship
    const r = (u.relationship_status || '').toLowerCase();
    if (r.includes('married')) totalMarried++;
    else if (r.includes('single')) totalSingle++;
    else totalOthers++;

    // Age
    const age = parseInt(u.age, 10);
    if (age >= 18 && age < 25) ageBuckets.age_18_to_24++;
    else if (age >= 25 && age < 35) ageBuckets.age_25_to_34++;
    else if (age >= 35 && age < 45) ageBuckets.age_35_to_44++;
    else if (age >= 45 && age < 55) ageBuckets.age_45_to_54++;
    else if (age >= 55 && age < 65) ageBuckets.age_55_to_64++;
  }

  // Age distribution → convert to percentage-like values (mirrors PHP random distribution)
  const ageKeys = Object.keys(ageBuckets);
  const sortedAge = ageKeys.sort((a, b) => ageBuckets[b] - ageBuckets[a]);
  const ageResult = {};

  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const totalAge = ageKeys.reduce((s, k) => s + ageBuckets[k], 0);

  if (totalAge === 0) {
    // No data → generate random distribution
    ageResult[sortedAge[0]] = rand(50, 55);
    ageResult[sortedAge[1]] = rand(15, 25);
    ageResult[sortedAge[2]] = rand(10, 15);
    ageResult[sortedAge[3]] = rand(5, 10);
    ageResult[sortedAge[4]] = 100 - (ageResult[sortedAge[0]] + ageResult[sortedAge[1]] + ageResult[sortedAge[2]] + ageResult[sortedAge[3]]);
  } else {
    ageResult[sortedAge[0]] = rand(50, 55);
    ageResult[sortedAge[1]] = rand(15, 70 - ageResult[sortedAge[0]]);
    ageResult[sortedAge[2]] = rand(10, 80 - ageResult[sortedAge[0]] - ageResult[sortedAge[1]]);
    ageResult[sortedAge[3]] = rand(5, 95 - ageResult[sortedAge[0]] - ageResult[sortedAge[1]] - ageResult[sortedAge[2]]);
    ageResult[sortedAge[4]] = 100 - (ageResult[sortedAge[0]] + ageResult[sortedAge[1]] + ageResult[sortedAge[2]] + ageResult[sortedAge[3]]);
    if (ageResult[sortedAge[4]] < 0) ageResult[sortedAge[4]] = rand(1, 3);
  }

  // Gender → percentage
  if (totalMale === 0 || totalFemale === 0) {
    if (totalMale === 0) { totalFemale = rand(60, 75); totalMale = 100 - totalFemale; }
    else { totalMale = rand(60, 75); totalFemale = 100 - totalMale; }
  } else {
    const total = totalMale + totalFemale;
    totalMale = Math.round((totalMale / total) * 100);
    totalFemale = Math.round((totalFemale / total) * 100);
  }

  // Relationship → percentage
  if (totalSingle === 0 || totalMarried === 0 || totalOthers === 0) {
    const vals = [totalSingle, totalMarried, totalOthers];
    const maxIdx = vals.indexOf(Math.max(...vals));
    const first = rand(50, 65);
    const second = rand(20, 30);
    const third = 100 - first - second;
    if (maxIdx === 0) { totalSingle = first; totalMarried = second; totalOthers = third; }
    else if (maxIdx === 1) { totalMarried = first; totalSingle = second; totalOthers = third; }
    else { totalOthers = first; totalSingle = second; totalMarried = third; }
  } else {
    const total = totalSingle + totalMarried + totalOthers;
    totalSingle = Math.round((totalSingle / total) * 100);
    totalMarried = Math.round((totalMarried / total) * 100);
    totalOthers = Math.round((totalOthers / total) * 100);
  }

  return {
    genderData: {
      age_18_to_24: ageResult.age_18_to_24 || 0,
      age_25_to_34: ageResult.age_25_to_34 || 0,
      age_35_to_44: ageResult.age_35_to_44 || 0,
      age_45_to_54: ageResult.age_45_to_54 || 0,
      age_55_to_64: ageResult.age_55_to_64 || 0,
    },
    ageData: { male: totalMale, female: totalFemale },
    relationshipData: { married: totalMarried, single: totalSingle, others: totalOthers },
  };
}

async function getFacebookUserData(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.facebook_ad_id || !p.user_id) {
    return { code: 401, message: 'Missing parameters' };
  }
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    // Step 1: Get user IDs linked to this ad
    const adUserRows = await db.sql.query(AD_USERS_SQL, [p.facebook_ad_id]);
    let userData = null;

    if (adUserRows && adUserRows.length > 0) {
      const userIds = adUserRows.map(r => r.user_id).filter(Boolean);
      if (userIds.length > 0) {
        userData = await db.sql.query(FB_USERS_SQL(userIds), userIds);
      }
    }

    // Step 2: Check cache in facebook_ad_user_analytics
    const analyticsRows = await db.sql.query(USER_ANALYTICS_SQL, [p.facebook_ad_id]);

    if (analyticsRows && analyticsRows.length > 0) {
      // Cached data exists
      const cached = analyticsRows[0];
      const graphData = {
        ageData: JSON.parse(cached.genderdata || '{}'),
        relationshipData: JSON.parse(cached.relationshipdata || '{}'),
        genderData: JSON.parse(cached.agedata || '{}'),
      };
      return {
        code: 200,
        message: 'Data Fetched Successfully',
        data: graphData,
        tragetData: { code: 200, message: 'FacebookAd details.', data: userData || [] },
      };
    }

    // Step 3: Compute fresh graph data and cache it
    const graphData = graphAnalysisData(userData || []);

    try {
      await db.sql.query(INSERT_USER_ANALYTICS_SQL, [
        JSON.stringify(graphData.ageData),
        JSON.stringify(graphData.relationshipData),
        JSON.stringify(graphData.genderData),
        p.facebook_ad_id,
      ]);
    } catch (insertErr) {
      logger.warn('Failed to cache user analytics', { error: insertErr.message });
    }

    return {
      code: 200,
      message: 'Data Fetched Successfully',
      data: JSON.stringify(graphData),
      tragetData: { code: 200, message: 'FacebookAd details.', data: userData || [] },
    };
  } catch (err) {
    logger.error('Error in getFacebookUserData', { error: err.message });
    return { code: 401, message: 'Error in getFacebookUserData', data: [] };
  }
}

// ─── 4. getFacebookOutgoings ─────────────────────────────

const OUTGOING_SQL = `
  SELECT source_url, redirect_url, final_url
  FROM facebook_ad_outgoing_links
  WHERE facebook_ad_id = ?
`;

async function getFacebookOutgoings(req, db, logger) {
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
    logger.error('Error in getFacebookOutgoings', { error: err.message });
    return { code: 401, data: [] };
  }
}

// ─── 5. getAdsPageDetails ────────────────────────────────

const PAGE_DETAILS_SQL = `
  SELECT * FROM facebook_lib_page_details WHERE facebook_ad_id = ? LIMIT 1
`;

async function getAdsPageDetails(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.facebook_ad_id || !p.user_id) {
    return { code: 401, message: 'Missing parameters' };
  }
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const rows = await db.sql.query(PAGE_DETAILS_SQL, [parseInt(p.facebook_ad_id, 10)]);

    if (!rows || rows.length === 0) {
      return { code: 400, message: 'No Data Found', data: null };
    }

    return { code: 200, message: 'Data Fetched Successfully', data: rows[0] };
  } catch (err) {
    logger.error('Error in getAdsPageDetails', { error: err.message });
    return { code: 401, message: 'Some Exception Occured', data: null };
  }
}

// ─── 6. getAdvertiserInsights (combined advertiser-level API) ─────
/**
 * Fetch advertiser-level monthly LCS data for the year of the ad's post_date.
 * Also returns a `years` array of all years for which the advertiser has data.
 */
async function getAdvertiserLCSData(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);
  if (!p.facebook_ad_id) return { code: 401, message: 'Missing facebook_ad_id', data: null };
  if (!db.elastic) return { code: 503, message: 'Search service not available', data: null };

  const metaRows = await db.sql.query(AD_META_SQL, [p.facebook_ad_id]);
  const meta = metaRows?.[0];
  const postOwnerName = meta?.post_owner_name || null;
  if (!postOwnerName) return { code: 400, message: 'Advertiser not found', data: null };

  const postOwnerId = meta?.post_owner_id || null;

  // Determine year from the ad's last_seen; fall back to current year
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
 * Fetch advertiser-level country data for the last 12 months.
 */
async function getAdvertiserCountryData(req, db) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);
  if (!p.facebook_ad_id) return { code: 401, message: 'Missing facebook_ad_id', data: null };

  const metaRows = await db.sql.query(AD_META_SQL, [p.facebook_ad_id]);
  const meta = metaRows?.[0];
  const postOwnerName = meta?.post_owner_name || null;
  if (!postOwnerName || !db.elastic) return { code: 400, message: 'Advertiser not found', data: null };
  const postOwnerId = meta?.post_owner_id || null;

  const adPostDate = meta?.last_seen ? new Date(meta.last_seen) : null;
  const adYear = adPostDate && !isNaN(adPostDate.getTime()) ? adPostDate.getFullYear() : new Date().getFullYear();

  const advertiserFilter = { match: { 'facebook_ad_post_owners.post_owner_name_exactly': postOwnerName } };
  const results = await Promise.allSettled([
    // docvalue_fields + _source:false + filter_path + track_total_hits:false
    // — same perf pattern as Google/Native. Doc values are columnar so
    // reading them is much cheaper than materialising the JSON _source.
    db.elastic.search({
      index: process.env.FB_ES_INDEX,
      filter_path: 'hits.hits.fields',
      body: {
        size: 10000,
        track_total_hits: false,
        _source: false,
        docvalue_fields: ['facebook_ad.id', 'country_only.country.keyword'],
        query: {
          bool: {
            filter: [
              advertiserFilter,
              { range: { 'facebook_ad.last_seen': getYearRange(adYear) } },
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

/**
 * Fetch advertiser-level user demographics (age, gender, relationship) for the last 12 months.
 */
async function getAdvertiserUserData(req, db) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);
  if (!p.facebook_ad_id) return { code: 401, message: 'Missing facebook_ad_id', data: null };

  const metaRows = await db.sql.query(AD_META_SQL, [p.facebook_ad_id]);
  const meta = metaRows?.[0];
  const postOwnerName = meta?.post_owner_name || null;
  if (!postOwnerName || !db.elastic) return { code: 400, message: 'Advertiser not found', data: null };
  const postOwnerId = meta?.post_owner_id || null;

  const adPostDate = meta?.last_seen ? new Date(meta.last_seen) : null;
  const adYear = adPostDate && !isNaN(adPostDate.getTime()) ? adPostDate.getFullYear() : new Date().getFullYear();

  const advertiserFilter = { match: { 'facebook_ad_post_owners.post_owner_name_exactly': postOwnerName } };
  const results = await Promise.allSettled([
    db.elastic.search({
      index: process.env.FB_ES_INDEX,
      filter_path: 'hits.hits.fields',
      body: {
        size: 10000,
        track_total_hits: false,
        _source: false,
        docvalue_fields: ['facebook_ad.id'],
        query: {
          bool: {
            filter: [
              advertiserFilter,
              { range: { 'facebook_ad.last_seen': getYearRange(adYear) } },
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

  // ids now come from docvalue `fields` instead of `_source`
  const adIds = [...new Set(hits.map(h => h.fields?.['facebook_ad.id']?.[0]).filter(Boolean))];
  if (adIds.length === 0) return { code: 400, message: 'No data found.', data: null };

  const data = await aggregateUserData(db, adIds);
  if (!data) return { code: 400, message: 'No data found.', data: null };
  return { code: 200, message: 'Advertiser user data fetched.', post_owner_id: postOwnerId, year: adYear, available_years: availableYears, data };
}

const POST_OWNER_NAME_SQL = `SELECT post_owner_name FROM facebook_ad_post_owners WHERE id = ? LIMIT 1`;

/**
 * Shared: country aggregation from ES hits.
 *
 * Accepts hits in either shape:
 *   - _source path (legacy): hit._source['facebook_ad.id'] etc.
 *   - docvalue_fields path: hit.fields['facebook_ad.id'][0] etc.
 * docvalue_fields always returns arrays even for single values, so we
 * unwrap on read. getAdvertiserCountryData and the country variant of
 * getAdvertiserInsightsByDateRange were switched to docvalue_fields for
 * perf; this shape-tolerant reader handles both call paths.
 */
async function aggregateCountryData(db, hits) {
  const countryMap = {};
  for (const hit of hits) {
    const src = hit._source;
    const f = hit.fields;
    const adId = src ? src['facebook_ad.id'] : f?.['facebook_ad.id']?.[0];
    if (!adId) continue;
    let countries = src
      ? src['country_only.country']
      : (f?.['country_only.country.keyword'] || f?.['country_only.country']);
    if (!countries) continue;
    if (!Array.isArray(countries)) countries = [countries];
    for (const country of countries) {
      if (!country) continue;
      const normalizedKey = normalizeCountryName(country);
      if (!countryMap[normalizedKey]) countryMap[normalizedKey] = new Set();
      countryMap[normalizedKey].add(adId);
    }
  }
  if (Object.keys(countryMap).length === 0) return null;

  const isoMap = await batchCountryLookup(db, Object.keys(countryMap));
  const result = [];
  for (const [name, idSet] of Object.entries(countryMap).sort((a, b) => b[1].size - a[1].size)) {
    const adIds = [...idSet];
    const lookup = isoMap.get(name);
    let country = lookup?.country || name;
    let iso = fixCountryIso(country, lookup?.iso || null);
    if (country) country = country.replace(/\b\w/g, c => c.toUpperCase());
    result.push({ country, iso, ad_ids: adIds, ad_count: adIds.length });
  }
  return result;
}

/**
 * Shared: user demographics aggregation from SQL for a set of ad IDs.
 */
async function aggregateUserData(db, adIds) {
  const placeholders = adIds.map(() => '?').join(',');
  const rows = await db.sql.query(
    `SELECT facebook_ad_id, genderdata, relationshipdata, agedata
     FROM facebook_ad_user_analytics
     WHERE facebook_ad_id IN (${placeholders})`,
    adIds
  );
  if (!rows || rows.length === 0) return null;

  const totalAge = { age_18_to_24: 0, age_25_to_34: 0, age_35_to_44: 0, age_45_to_54: 0, age_55_to_64: 0 };
  const totalGender = { male: 0, female: 0 };
  const totalRelationship = { married: 0, single: 0, others: 0 };

  for (const row of rows) {
    const ageData = JSON.parse(row.agedata || '{}');
    for (const key of Object.keys(totalAge)) totalAge[key] += Number(ageData[key]) || 0;
    const genderData = JSON.parse(row.genderdata || '{}');
    totalGender.male += Number(genderData.male) || 0;
    totalGender.female += Number(genderData.female) || 0;
    const relData = JSON.parse(row.relationshipdata || '{}');
    totalRelationship.married += Number(relData.married) || 0;
    totalRelationship.single += Number(relData.single) || 0;
    totalRelationship.others += Number(relData.others) || 0;
  }
  return { ageData: totalAge, genderData: totalGender, relationshipData: totalRelationship };
}

/**
 * Unified advertiser insights by date range.
 *
 * POST /ads/getAdvertiserInsightsByDateRange
 * Body: { post_owner_id, from_date, to_date, type }
 *   - type: "lcs" | "country" | "user"
 *   - user_id: injected from JWT by authMiddleware
 *   - post_owner_id: used to resolve post_owner_name (more efficient than ad_id)
 *   - from_date / to_date: YYYY-MM-DD
 */
async function getAdvertiserInsightsByDateRange(req, db) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  const userId = p.user_id || req.user?.id;
  if (!userId) return { code: 401, message: 'Missing user_id', data: null };

  if (!p.post_owner_id) return { code: 400, message: 'Missing post_owner_id', data: null };
  if (!p.from_date || !p.to_date) return { code: 400, message: 'Missing from_date or to_date', data: null };

  const type = (p.type || 'lcs').toLowerCase();
  if (!['lcs', 'country', 'user'].includes(type)) {
    return { code: 400, message: 'Invalid type. Must be one of: lcs, country, user', data: null };
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
  const base = { from_date: p.from_date, to_date: p.to_date };

  if (type === 'lcs') {
    const result = await fetchMonthlyLCSForAdvertiser(db, postOwnerName, dateRange);
    if (!result) return { code: 400, message: 'No data found.', data: null };
    return { code: 200, message: 'Advertiser LCS data fetched.', ...base, available_years: result.years, data: result.monthlyData };
  }

  // For country and user we need ad-level fields. docvalue_fields is cheaper
  // than _source materialisation; aggregateCountryData reads either shape.
  // The `user` variant only needs `facebook_ad.id`, so we ask for just that.
  const advertiserFilter = { match: { 'facebook_ad_post_owners.post_owner_name_exactly': postOwnerName } };
  const docFields = type === 'country'
    ? ['facebook_ad.id', 'country_only.country.keyword']
    : ['facebook_ad.id'];

  const esResult = await db.elastic.search({
    index: process.env.FB_ES_INDEX,
    filter_path: 'hits.hits.fields',
    body: {
      size: 10000,
      track_total_hits: false,
      _source: false,
      docvalue_fields: docFields,
      query: {
        bool: {
          filter: [
            advertiserFilter,
            { range: { 'facebook_ad.last_seen': dateRange } },
          ],
        },
      },
    },
  });

  const hits = (esResult.hits || esResult.body?.hits)?.hits;
  if (!hits || hits.length === 0) return { code: 400, message: 'No data found.', data: null };

  if (type === 'country') {
    const data = await aggregateCountryData(db, hits);
    if (!data) return { code: 400, message: 'No data found.', data: null };
    return { code: 200, message: 'Advertiser country data fetched.', ...base, data };
  }

  // type === 'user' — id list now comes from `fields` instead of `_source`
  const adIds = [...new Set(hits.map(h => h.fields?.['facebook_ad.id']?.[0]).filter(Boolean))];
  if (adIds.length === 0) return { code: 400, message: 'No data found.', data: null };
  const data = await aggregateUserData(db, adIds);
  if (!data) return { code: 400, message: 'No data found.', data: null };
  return { code: 200, message: 'Advertiser user data fetched.', ...base, data };
}

module.exports = {
  getLikeCommentShareDetails,
  getFacebookAdCountry,
  getFacebookUserData,
  getFacebookOutgoings,
  getAdsPageDetails,
  getAdvertiserLCSData,
  getAdvertiserCountryData,
  getAdvertiserUserData,
  getAdvertiserInsightsByDateRange,
};
