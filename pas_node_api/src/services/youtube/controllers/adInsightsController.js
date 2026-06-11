'use strict';

const { normalizeParams } = require('../helpers/paramParser');

// ─── 1. getLikeCommentShareDetails ────────────────────────

const LCS_SQL = `
  SELECT
    youtube_ad_analytics.id,
    youtube_ad_analytics.youtube_ad_id,
    youtube_ad_analytics.likes,
    youtube_ad_analytics.dislike,
    youtube_ad_analytics.comments AS comment,
    youtube_ad_analytics.views AS view,
    UNIX_TIMESTAMP(youtube_ad_analytics.date) AS date
  FROM youtube_ad_analytics
  WHERE youtube_ad_analytics.youtube_ad_id = ?
  ORDER BY youtube_ad_analytics.date ASC
`;

async function getLikeCommentShareDetails(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.youtube_ad_id || !p.user_id) {
    return { code: 401, message: 'Missing parameters: youtube_ad_id and user_id are required' };
  }
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const adId = parseInt(p.youtube_ad_id, 10);
    const rows = await db.sql.query(LCS_SQL, [adId]);

    if (!rows || rows.length === 0) {
      return { code: 400, message: 'No data found.', data: null };
    }

    // Convert date from BigInt to Number (UNIX_TIMESTAMP returns BigInt in mysql2)
    for (const r of rows) {
      if (r.date != null) r.date = Number(r.date);
    }

    return { code: 200, message: 'Youtube analytics details.', data: rows };
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

    const countryData = [];
    for (const name of countries) {
      const lookup = isoMap.get(name);
      let displayName = lookup?.country || name;
      let iso = lookup?.iso || null;

      iso = fixCountryIso(displayName, iso);
      countryData.push({
        country: displayName ? displayName.replace(/\b\w/g, c => c.toUpperCase()) : displayName,
        iso,
      });
    }

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

async function aggregateLCSData(db, hits) {
  if (!hits || hits.length === 0) return null;

  const monthlyIds = {};
  for (const hit of hits) {
    const src = hit._source;
    const adId = src['ad_id'];
    const rawPostDate = src['last_seen'];
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
    `SELECT a.youtube_ad_id, SUM(a.likes) AS total_likes, SUM(a.dislike) AS total_dislikes, SUM(a.comments) AS total_comments, SUM(a.views) AS total_views
     FROM youtube_ad_analytics a
     INNER JOIN (
       SELECT youtube_ad_id, MAX(date) AS max_date
       FROM youtube_ad_analytics
       WHERE youtube_ad_id IN (${placeholders})
       GROUP BY youtube_ad_id
     ) latest ON a.youtube_ad_id = latest.youtube_ad_id AND a.date = latest.max_date
     WHERE a.youtube_ad_id IN (${placeholders})
     GROUP BY a.youtube_ad_id`,
    [...uniqueIds, ...uniqueIds]
  );

  const analyticsMap = {};
  if (analyticsRows) {
    for (const row of analyticsRows) {
      analyticsMap[row.youtube_ad_id] = {
        likes: Number(row.total_likes) || 0,
        dislikes: Number(row.total_dislikes) || 0,
        comments: Number(row.total_comments) || 0,
        views: Number(row.total_views) || 0,
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
    let totalLikes = 0, totalDislikes = 0, totalComments = 0, totalViews = 0;
    for (const id of ids) {
      const stats = analyticsMap[id];
      if (stats) {
        totalLikes += stats.likes;
        totalDislikes += stats.dislikes;
        totalComments += stats.comments;
        totalViews += stats.views;
      }
    }
    result[key] = {
      ad_ids: ids,
      total_ads: ids.length,
      likes: totalLikes,
      dislikes: totalDislikes,
      comments: totalComments,
      views: totalViews,
    };
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
  if (!p.youtube_ad_id) return { code: 401, message: 'Missing youtube_ad_id', data: null };

  const metaRows = await db.sql.query(AD_META_SQL, [p.youtube_ad_id]);
  const postOwnerName = metaRows?.[0]?.post_owner_name || null;
  const postOwnerId = metaRows?.[0]?.post_owner_id || null;
  const adLastSeen = metaRows?.[0]?.last_seen || null;

  if (!postOwnerName || !db.elastic) return { code: 400, message: 'Advertiser not found', data: null };

  const adYear = p.year || (adLastSeen ? parseESDate(adLastSeen).getFullYear() : new Date().getFullYear());
  const dateRange = getYearRange(adYear);
  const index = db.elastic.indexName;

  const lcsQuery = {
    index,
    body: {
      size: 10000,
      _source: ['ad_id', 'last_seen'],
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
          _source: ['ad_id', 'last_seen'],
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

      const data = await aggregateLCSData(db, hits);
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
