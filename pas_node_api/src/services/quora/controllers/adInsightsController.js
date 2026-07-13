'use strict';

const { normalizeParams } = require('../helpers/paramParser');

// ─── 0. getLikeCommentShareDetails ───────────────────────

/**
 * Return the latest like/comment/share snapshot for a single Quora ad, sourced
 * entirely from Elasticsearch. Quora does not maintain a per-day analytics
 * table — the ad doc stores the current totals under
 * `quora_ad.likes`/`quora_ad.comments`/`quora_ad.shares`, alongside
 * `quora_ad.post_date` and `quora_ad.last_seen`. We return two data points
 * (post_date=0, last_seen=current totals) so consumers can render a timeline.
 */
async function getLikeCommentShareDetails(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.quora_ad_id || !p.user_id) {
    return { code: 401, message: 'Missing parameters: quora_ad_id and user_id are required' };
  }
  if (!db.elastic) return { code: 503, message: 'Elasticsearch connection not available' };

  try {
    const adId = parseInt(p.quora_ad_id, 10);
    const esResult = await db.elastic.search({
      index: 'quora_search_mix',
      body: {
        size: 1,
        _source: [
          'quora_ad.id',
          'quora_ad.likes',
          'quora_ad.comments',
          'quora_ad.shares',
          'quora_ad.post_date',
          'quora_ad.last_seen',
        ],
        query: {
          bool: { filter: { terms: { 'quora_ad.id': [adId] } } },
        },
      },
    });

    const hits = (esResult.hits || esResult.body?.hits)?.hits;
    if (!hits || hits.length === 0) {
      return { code: 400, message: 'No data found.', data: null };
    }

    const src = hits[0]._source;
    const likes = Number(src['quora_ad.likes']) || 0;
    const comment = Number(src['quora_ad.comments']) || 0;
    const share = Number(src['quora_ad.shares']) || 0;

    const toYmd = (val) => {
      if (!val) return null;
      const d = new Date(val);
      return isNaN(d.getTime()) ? null : d.toISOString().split('T')[0];
    };

    let postDate = toYmd(src['quora_ad.post_date']);
    const lastSeenDate = toYmd(src['quora_ad.last_seen']);

    // If post_date is missing/invalid, anchor the zero row one day before last_seen
    if (!postDate && lastSeenDate) {
      const d = new Date(lastSeenDate);
      d.setDate(d.getDate() - 1);
      postDate = d.toISOString().split('T')[0];
    }

    const data = [
      { id: 1, quora_ad_id: adId, likes, comment, share, date: postDate }
    ];

    return { code: 200, message: 'Quora analytics details.', data };
  } catch (err) {
    logger.error('Error in getLikeCommentShareDetails (quora)', { error: err.message });
    return { code: 500, message: 'Error fetching LCS details', error: err.message };
  }
}

// ─── 1. getQuoraAdCountry ───────────────────────────────

const COUNTRY_ISO_SQL = `SELECT name AS country, iso FROM country_data WHERE nicename = ? LIMIT 1`;

function fixCountryIso(country, iso) {
  const name = (country || '').toLowerCase();
  if (country === 'Czechia') return 'CZ';
  if (country === 'Russia') return 'RU';
  if (name.includes('congo') && (!iso || iso === 'null')) return 'CD';
  return iso;
}

async function getQuoraAdCountry(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.quora_ad_id || !p.user_id) {
    return { code: 401, message: 'Missing parameters: quora_ad_id and user_id are required' };
  }
  if (!db.elastic) return { code: 503, message: 'Elasticsearch connection not available' };

  try {
    const esResult = await db.elastic.search({
      index: 'quora_search_mix',
      body: {
        query: {
          bool: { filter: { terms: { 'quora_ad.id': [parseInt(p.quora_ad_id, 10)] } } },
        },
      },
    });

    const hits = esResult.hits || esResult.body?.hits;
    if (!hits?.hits?.length) return { code: 400, message: 'No data found.' };

    const countries = hits.hits[0]._source['quora_country_only.country'];
    if (!countries || !Array.isArray(countries) || countries.length === 0) {
      return { code: 400, message: 'No data found.' };
    }

    const countryData = [];
    for (const name of countries) {
      let iso = null;
      let displayName = name;

      if (db.sql) {
        try {
          const isoRows = await db.sql.query(COUNTRY_ISO_SQL, [name]);
          if (isoRows?.length > 0) {
            displayName = isoRows[0].country;
            iso = isoRows[0].iso;
          }
        } catch { /* skip */ }
      }

      iso = fixCountryIso(displayName, iso);
      countryData.push({
        country: displayName ? displayName.replace(/\b\w/g, c => c.toUpperCase()) : displayName,
        iso,
      });
    }

    return { code: 200, message: 'Quora country data fetched.', data: countryData };
  } catch (err) {
    logger.error('Error in getQuoraAdCountry', { error: err.message });
    return { code: 500, message: 'Error fetching country data', error: err.message };
  }
}

// ─── 2. getQuoraOutgoings ───────────────────────────────

const OUTGOING_SQL = `
  SELECT source_url, redirect_url, final_url
  FROM quora_ad_outgoing_links
  WHERE quora_ad_id = ?
`;

async function getQuoraOutgoings(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.ad_id) return { code: 401, message: 'Missing parameters: ad_id is required' };
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const rows = await db.sql.query(OUTGOING_SQL, [p.ad_id]);
    if (rows && rows.length > 0) return { code: 200, data: rows };
    return { code: 400, data: [] };
  } catch (err) {
    logger.error('Error in getQuoraOutgoings', { error: err.message });
    return { code: 401, data: [] };
  }
}

// ─── 3. getQuoraUserData ────────────────────────────────

const USER_DATA_SQL = `
  SELECT
    quora_user.age,
    quora_user.name,
    quora_user.quora_id,
    quora_user.current_country,
    quora_user.Gender,
    quora_user.relationship_status
  FROM quora_ad_users
  LEFT JOIN quora_user ON quora_user.id = quora_ad_users.user_id
  WHERE quora_ad_users.quora_ad_id = ?
`;

async function getQuoraUserData(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.quora_ad_id || !p.user_id) {
    return { code: 401, message: 'Missing parameters' };
  }
  if (!db.sql) return { code: 503, message: 'SQL connection not available' };

  try {
    const rows = await db.sql.query(USER_DATA_SQL, [parseInt(p.quora_ad_id, 10)]);

    if (!rows || rows.length === 0) {
      return { code: 400, message: 'No data found.', data: null };
    }

    return { code: 200, message: 'Data fetched Successfully', data: rows };
  } catch (err) {
    logger.error('Error in getQuoraUserData', { error: err.message });
    return { code: 500, message: 'Error fetching user data', error: err.message };
  }
}

// ─── 4. Advertiser-level helpers ────────────────────────

const AD_META_SQL = `
  SELECT qa.last_seen, qapo.post_owner_name, qa.post_owner_id
  FROM quora_ad qa
  JOIN quora_ad_post_owners qapo ON qa.post_owner_id = qapo.id
  WHERE qa.id = ?
  LIMIT 1
`;

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Robustly parse dates from ES hits.
 * Handles ISO strings, Unix seconds, and millis.
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

/**
 * Bucket hits by month of `quora_ad.last_seen` and sum ES-side LCS values.
 * ES-only — no SQL analytics table lookup. Each hit's `_source` carries
 * `quora_ad.id/likes/comments/shares/last_seen`.
 */
function aggregateLCSData(hits) {
  if (!hits || hits.length === 0) return null;

  const monthly = {};
  for (const hit of hits) {
    const src = hit._source || {};
    const adId = src['quora_ad.id'];
    const rawDate = src['quora_ad.last_seen'];
    if (!adId || !rawDate) continue;

    const dt = parseESDate(rawDate);
    const key = `${MONTH_NAMES[dt.getMonth()]}_${dt.getFullYear()}`;
    if (!monthly[key]) monthly[key] = { ad_ids: [], likes: 0, comments: 0, shares: 0 };
    monthly[key].ad_ids.push(adId);
    monthly[key].likes += Number(src['quora_ad.likes']) || 0;
    monthly[key].comments += Number(src['quora_ad.comments']) || 0;
    monthly[key].shares += Number(src['quora_ad.shares']) || 0;
  }

  if (Object.keys(monthly).length === 0) return null;

  const sortedKeys = Object.keys(monthly).sort((a, b) => {
    const [mA, yA] = a.split('_');
    const [mB, yB] = b.split('_');
    return (Number(yA) - Number(yB)) || (MONTH_NAMES.indexOf(mA) - MONTH_NAMES.indexOf(mB));
  });

  const result = {};
  for (const key of sortedKeys) {
    const b = monthly[key];
    result[key] = {
      ad_ids: b.ad_ids,
      total_ads: b.ad_ids.length,
      likes: b.likes,
      comments: b.comments,
      shares: b.shares,
    };
  }
  return result;
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
              field: 'quora_ad.last_seen',
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
    const adId = src ? src['quora_ad.id'] : f?.['quora_ad.id']?.[0];
    if (!adId) continue;

    let countries = src
      ? src['quora_country_only.country']
      : (f?.['quora_country_only.country.keyword'] || f?.['quora_country_only.country']);
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
  if (!p.quora_ad_id) return { code: 401, message: 'Missing quora_ad_id', data: null };

  const metaRows = await db.sql.query(AD_META_SQL, [p.quora_ad_id]);
  const postOwnerName = metaRows?.[0]?.post_owner_name || null;
  const postOwnerId = metaRows?.[0]?.post_owner_id || null;
  const adLastSeen = metaRows?.[0]?.last_seen || null;

  if (!postOwnerName || !db.elastic) return { code: 400, message: 'Advertiser not found', data: null };

  let adYear;
  if (p.year) {
    adYear = p.year;
  } else {
    const d = adLastSeen ? parseESDate(adLastSeen) : null;
    adYear = (d && d.getFullYear() > 1970) ? d.getFullYear() : new Date().getFullYear();
  }
  const dateRange = getYearRange(adYear);
  const index = 'quora_search_mix';
  const advertiserFilter = { match_phrase: { 'quora_ad_post_owners.post_owner_name': postOwnerName } };

  const [availableYears, esResult] = await Promise.allSettled([
    fetchAvailableYears(db.elastic, index, advertiserFilter),
    db.elastic.search({
      index,
      body: {
        size: 10000,
        _source: [
          'quora_ad.id',
          'quora_ad.last_seen',
          'quora_ad.likes',
          'quora_ad.comments',
          'quora_ad.shares',
        ],
        query: {
          bool: {
            filter: [
              advertiserFilter,
              { range: { 'quora_ad.last_seen': dateRange } },
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
  if (!p.quora_ad_id) return { code: 401, message: 'Missing quora_ad_id', data: null };

  const metaRows = await db.sql.query(AD_META_SQL, [p.quora_ad_id]);
  const postOwnerName = metaRows?.[0]?.post_owner_name || null;
  const postOwnerId = metaRows?.[0]?.post_owner_id || null;
  const adLastSeen = metaRows?.[0]?.last_seen || null;

  if (!postOwnerName || !db.elastic) return { code: 400, message: 'Advertiser not found', data: null };

  let adYear;
  if (p.year) {
    adYear = p.year;
  } else {
    const d = adLastSeen ? new Date(adLastSeen) : null;
    adYear = (d && !isNaN(d.getTime()) && d.getFullYear() > 1970) ? d.getFullYear() : new Date().getFullYear();
  }
  const dateRange = getYearRange(adYear);
  const index = 'quora_search_mix';

  const advertiserFilter = { match_phrase: { 'quora_ad_post_owners.post_owner_name': postOwnerName } };
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
        docvalue_fields: ['quora_ad.id', 'quora_country_only.country.keyword'],
        query: {
          bool: {
            filter: [
              advertiserFilter,
              { range: { 'quora_ad.last_seen': dateRange } },
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

// ─── 6. getAdvertiserInsightsByDateRange ────────────────

async function getAdvertiserInsightsByDateRange(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  const { post_owner_id, from_date, to_date, type } = p;
  if (!post_owner_id || !from_date || !to_date) {
    return { code: 401, message: 'Missing parameters: post_owner_id, from_date, to_date are required' };
  }

  const advertiserRows = await db.sql.query(
    `SELECT post_owner_name FROM quora_ad_post_owners WHERE id = ? LIMIT 1`,
    [post_owner_id]
  );
  const postOwnerName = advertiserRows?.[0]?.post_owner_name;
  if (!postOwnerName || !db.elastic) return { code: 400, message: 'Advertiser not found' };

  const dateRange = getCustomDateRange(from_date, to_date);
  const base = { from_date, to_date, post_owner_id };
  const index = 'quora_search_mix';

  const targetType = (type || 'country').toLowerCase();

  if (targetType === 'country') {
    const esResult = await db.elastic.search({
      index,
      body: {
        size: 10000,
        _source: ['quora_ad.id', 'quora_country_only.country'],
        query: {
          bool: {
            filter: [
              { match_phrase: { 'quora_ad_post_owners.post_owner_name': postOwnerName } },
              { range: { 'quora_ad.last_seen': dateRange } },
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
        _source: [
          'quora_ad.id',
          'quora_ad.last_seen',
          'quora_ad.likes',
          'quora_ad.comments',
          'quora_ad.shares',
        ],
        query: {
          bool: {
            filter: [
              { match_phrase: { 'quora_ad_post_owners.post_owner_name': postOwnerName } },
              { range: { 'quora_ad.last_seen': dateRange } },
            ],
          },
        },
      },
    });

    const hits = (esResult.hits || esResult.body?.hits)?.hits;
    if (!hits || hits.length === 0) return { code: 400, message: 'No data found.', ...base, data: {} };

    const data = aggregateLCSData(hits);
    return { code: 200, message: 'Advertiser LCS data fetched.', ...base, data: data || {} };
  }

  return { code: 400, message: `Insight type '${targetType}' not supported for this platform.` };
}

module.exports = {
  getLikeCommentShareDetails,
  getQuoraAdCountry,
  getQuoraOutgoings,
  getQuoraUserData,
  getAdvertiserLCSData,
  getAdvertiserCountryData,
  getAdvertiserInsightsByDateRange,
};
