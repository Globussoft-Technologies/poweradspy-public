'use strict';

const { normalizeParams } = require('../helpers/paramParser');

// ─── 1. getLikeCommentShareDetails ────────────────────────

const LCS_SQL = `
  SELECT
    reddit_ad_analytics.id,
    reddit_ad_analytics.reddit_ad_id,
    reddit_ad_analytics.likes,
    reddit_ad_analytics.comments AS comment,
    reddit_ad_analytics.shares AS share,
    UNIX_TIMESTAMP(reddit_ad_analytics.date) AS date
  FROM reddit_ad_analytics
  WHERE reddit_ad_analytics.reddit_ad_id = ?
  ORDER BY reddit_ad_analytics.date ASC
`;

async function getLikeCommentShareDetails(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.reddit_ad_id || !p.user_id) {
    return { code: 401, message: 'Missing parameters: reddit_ad_id and user_id are required' };
  }
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const rows = await db.sql.query(LCS_SQL, [parseInt(p.reddit_ad_id, 10)]);
    if (!rows || rows.length === 0) return { code: 400, message: 'No data found.', data: null };

    for (const r of rows) { if (r.date != null) r.date = Number(r.date); }

    return { code: 200, message: 'Reddit analytics details.', data: rows };
  } catch (err) {
    logger.error('Error in getLikeCommentShareDetails (reddit)', { error: err.message });
    return { code: 500, message: 'Error fetching LCS details', error: err.message };
  }
}

// ─── 2. getRedditAdCountry ──────────────────────────────


function fixCountryIso(country, iso) {
  const name = (country || '').toLowerCase();
  if (country === 'Czechia') return 'CZ';
  if (country === 'Russia') return 'RU';
  if (name.includes('congo') && (!iso || iso === 'null')) return 'CD';
  return iso;
}

async function getRedditAdCountry(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.reddit_ad_id || !p.user_id) {
    return { code: 401, message: 'Missing parameters: reddit_ad_id and user_id are required' };
  }
  if (!db.elastic) return { code: 503, message: 'Elasticsearch connection not available' };

  try {
    const esResult = await db.elastic.search({
      index: 'reddit_search_mix',
      body: {
        size: 1,
        _source: ['reddit_country_only.country'],
        query: {
          bool: { filter: { term: { 'reddit_ad.id': parseInt(p.reddit_ad_id, 10) } } },
        },
      },
    });

    const hits = (esResult.hits || esResult.body?.hits)?.hits;
    if (!hits || hits.length === 0) return { code: 400, message: 'No data found.' };

    let countries = hits[0]._source?.['reddit_country_only.country'];
  
    if (!countries) return { code: 400, message: 'No country data found.' };
    if (!Array.isArray(countries)) countries = [countries];

    // Batch lookup ISO codes from country_data by nicename
    const isoMap = await batchCountryLookup(db, countries);

    const resArray = countries.map(name => {
      const lookup = isoMap.get(name);
      const country = lookup?.country || name;
      const iso = fixCountryIso(country, lookup?.iso || null);
      return {
        country: country ? country.replace(/\b\w/g, c => c.toUpperCase()) : country,
        iso,
      };
    });

    return { code: 200, message: 'Reddit country data fetched.', data: resArray };
  } catch (err) {
    logger.error('Error in getRedditAdCountry', { error: err.message });
    return { code: 500, message: 'Error fetching country data', error: err.message };
  }
}

// ─── 3. getRedirectOutgoingUrls ─────────────────────────

const OUTGOING_SQL = `
  SELECT * FROM reddit_ad_url WHERE reddit_ad_id = ?
`;

async function getRedirectOutgoingUrls(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.reddit_ad_id || !p.user_id) {
    return { code: 401, message: 'Missing parameters: reddit_ad_id and user_id are required' };
  }
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const rows = await db.sql.query(OUTGOING_SQL, [parseInt(p.reddit_ad_id, 10)]);
    if (rows && rows.length > 0) {
      return { code: 200, message: 'Reddit_ad_url details.', data: rows };
    }
    return { code: 400, message: 'Reddit_ad_url no data found.', data: null };
  } catch (err) {
    logger.error('Error in getRedirectOutgoingUrls (reddit)', { error: err.message });
    return { code: 401, data: null };
  }
}

// ─── 4. Advertiser-level helpers ────────────────────────

// ─── 4. Advertiser-level helpers ────────────────────────

const AD_META_SQL = `
  SELECT ra.last_seen, rapo.post_owner_name, ra.post_owner_id
  FROM reddit_ad ra
  JOIN reddit_ad_post_owners rapo ON ra.post_owner_id = rapo.id
  WHERE ra.id = ?
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
    dt = new Date(val < 10000000000 ? val * 1000 : val);
  } else {
    dt = new Date(val);
  }
  if (isNaN(dt.getTime())) return new Date();
  return dt;
}

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
              field: 'reddit_ad.last_seen',
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

async function aggregateLCSData(db, hits) {
  if (!hits || hits.length === 0) return null;

  const monthlyIds = {};
  for (const hit of hits) {
    const src = hit._source;
    const adId = src['reddit_ad.id'];
    const rawPostDate = src['reddit_ad.last_seen'];
    if (!adId || !rawPostDate) continue;

    const dt = parseESDate(rawPostDate);
    const key = `${MONTH_NAMES[dt.getMonth()]}_${dt.getFullYear()}`;
    if (!monthlyIds[key]) monthlyIds[key] = [];
    monthlyIds[key].push(adId);
  }

  if (Object.keys(monthlyIds).length === 0) return null;

  const uniqueIds = [...new Set(Object.values(monthlyIds).flat())];
  const placeholders = uniqueIds.map(() => '?').join(',');
  const analyticsRows = await db.sql.query(
    `SELECT a.reddit_ad_id, SUM(a.likes) AS total_likes, SUM(a.comments) AS total_comments, SUM(a.shares) AS total_shares
     FROM reddit_ad_analytics a
     INNER JOIN (
       SELECT reddit_ad_id, MAX(date) AS max_date
       FROM reddit_ad_analytics
       WHERE reddit_ad_id IN (${placeholders})
       GROUP BY reddit_ad_id
     ) latest ON a.reddit_ad_id = latest.reddit_ad_id AND a.date = latest.max_date
     WHERE a.reddit_ad_id IN (${placeholders})
     GROUP BY a.reddit_ad_id`,
    [...uniqueIds, ...uniqueIds]
  );

  const analyticsMap = {};
  if (analyticsRows) {
    for (const row of analyticsRows) {
      analyticsMap[row.reddit_ad_id] = {
        likes: Number(row.total_likes) || 0,
        comments: Number(row.total_comments) || 0,
        shares: Number(row.total_shares) || 0,
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
    let totalLikes = 0, totalComments = 0, totalShares = 0;
    for (const id of ids) {
      const stats = analyticsMap[id];
      if (stats) {
        totalLikes += stats.likes;
        totalComments += stats.comments;
        totalShares += stats.shares;
      }
    }
    result[key] = {
      ad_ids: ids,
      total_ads: ids.length,
      likes: totalLikes,
      comments: totalComments,
      shares: totalShares,
    };
  }
  return result;
}

async function aggregateCountryData(db, hits) {
  if (!hits || hits.length === 0) return null;

  const countryMap = {};
  for (const hit of hits) {
    // Support both shapes:
    //   - _source (legacy / `getAdvertiserInsightsByDateRange`): reads from
    //     hit._source['reddit_ad.id'] etc.
    //   - docvalue_fields (perf-optimised `getAdvertiserCountryData`): reads
    //     from hit.fields['reddit_ad.id'][0]. Doc-value fields always come
    //     back as arrays even for single values, so we unwrap on read.
    const src = hit._source;
    const f = hit.fields;
    const adId = src ? src['reddit_ad.id'] : f?.['reddit_ad.id']?.[0];
    if (!adId) continue;

    let countries = src
      ? src['reddit_country_only.country']
      : (f?.['reddit_country_only.country.keyword'] || f?.['reddit_country_only.country']);
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
 * Fetch advertiser-level monthly LCS data. Default to ad's year.
 */
async function getAdvertiserLCSData(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);
  if (!p.reddit_ad_id) return { code: 401, message: 'Missing reddit_ad_id', data: null };

  const metaRows = await db.sql.query(AD_META_SQL, [p.reddit_ad_id]);
  const postOwnerName = metaRows?.[0]?.post_owner_name || null;
  const postOwnerId = metaRows?.[0]?.post_owner_id || null;
  const adLastSeen = metaRows?.[0]?.last_seen || null;

  if (!postOwnerName || !db.elastic) return { code: 400, message: 'Advertiser not found', data: null };

  const adYear = p.year || (adLastSeen ? parseESDate(adLastSeen).getFullYear() : new Date().getFullYear());
  const dateRange = getYearRange(adYear);
  const index = 'reddit_search_mix';

  const [availableYears, esResult] = await Promise.allSettled([
    fetchAvailableYears(db.elastic, index, { match_phrase: { 'reddit_ad_post_owners.post_owner_name': postOwnerName } }),
    db.elastic.search({
      index,
      body: {
        size: 10000,
        _source: ['reddit_ad.id', 'reddit_ad.last_seen'],
        query: {
          bool: {
            filter: [
              { match_phrase: { 'reddit_ad_post_owners.post_owner_name': postOwnerName } },
              { range: { 'reddit_ad.last_seen': dateRange } },
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
      data: {}
    };
  }

  const data = await aggregateLCSData(db, hits);

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
  if (!p.reddit_ad_id) return { code: 401, message: 'Missing reddit_ad_id', data: null };

  const metaRows = await db.sql.query(AD_META_SQL, [p.reddit_ad_id]);
  const postOwnerName = metaRows?.[0]?.post_owner_name || null;
  const postOwnerId = metaRows?.[0]?.post_owner_id || null;
  const adLastSeen = metaRows?.[0]?.last_seen || null;

  if (!postOwnerName || !db.elastic) return { code: 400, message: 'Advertiser not found', data: null };

  const adYear = p.year || (adLastSeen ? parseESDate(adLastSeen).getFullYear() : new Date().getFullYear());
  const dateRange = getYearRange(adYear);
  const index = 'reddit_search_mix';

  const advertiserFilter = { match_phrase: { 'reddit_ad_post_owners.post_owner_name': postOwnerName } };
  const [availableYears, esResult] = await Promise.allSettled([
    fetchAvailableYears(db.elastic, index, advertiserFilter),
    // docvalue_fields + _source:false reads from columnar doc values
    // (faster than _source materialisation). track_total_hits:false skips
    // total counting. filter_path trims the response to just what we read.
    db.elastic.search({
      index,
      filter_path: 'hits.hits.fields',
      body: {
        size: 10000,
        track_total_hits: false,
        _source: false,
        docvalue_fields: ['reddit_ad.id', 'reddit_country_only.country.keyword'],
        query: {
          bool: {
            filter: [
              advertiserFilter,
              { range: { 'reddit_ad.last_seen': dateRange } },
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
    `SELECT post_owner_name FROM reddit_ad_post_owners WHERE id = ? LIMIT 1`,
    [post_owner_id]
  );
  const postOwnerName = advertiserRows?.[0]?.post_owner_name;
  if (!postOwnerName || !db.elastic) return { code: 400, message: 'Advertiser not found' };

  const dateRange = getCustomDateRange(from_date, to_date);
  const base = { from_date, to_date, post_owner_id };
  const index = 'reddit_search_mix';

  const targetType = (type || 'country').toLowerCase();

  if (targetType === 'country') {
    const esResult = await db.elastic.search({
      index,
      body: {
        size: 10000,
        _source: ['reddit_ad.id', 'reddit_country_only.country'],
        query: {
          bool: {
            filter: [
              { match_phrase: { 'reddit_ad_post_owners.post_owner_name': postOwnerName } },
              { range: { 'reddit_ad.last_seen': dateRange } },
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

  if (targetType === 'lcs') {
    const esResult = await db.elastic.search({
      index,
      body: {
        size: 10000,
        _source: ['reddit_ad.id', 'reddit_ad.last_seen'],
        query: {
          bool: {
            filter: [
              { match_phrase: { 'reddit_ad_post_owners.post_owner_name': postOwnerName } },
              { range: { 'reddit_ad.last_seen': dateRange } },
            ],
          },
        },
      },
    });

    const hits = (esResult.hits || esResult.body?.hits)?.hits;
    if (!hits || hits.length === 0) return { code: 400, message: 'No data found.', ...base, data: {} };

    const data = await aggregateLCSData(db, hits);
    return { code: 200, message: 'Advertiser LCS data fetched.', ...base, data: data || {} };
  }

  return { code: 400, message: `Insight type '${targetType}' not supported for this platform.` };
}

module.exports = {
  getLikeCommentShareDetails,
  getRedditAdCountry,
  getRedirectOutgoingUrls,
  getAdvertiserLCSData,
  getAdvertiserCountryData,
  getAdvertiserInsightsByDateRange,
};
