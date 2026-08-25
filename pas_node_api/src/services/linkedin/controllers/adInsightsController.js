'use strict';

const { normalizeParams } = require('../helpers/paramParser');
const { fixCountryIso, titleCase, isLatinCountryName } = require('../helpers/countryIso');

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

async function getLinkedinAdCountry(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);

  if (!p.linkedin_ad_id || !p.user_id) {
    return { code: 401, message: 'Missing parameters: linkedin_ad_id and user_id are required' };
  }
  if (!db.sql || !db.elastic) return { code: 503, message: 'SQL or Elastic connection not available' };

  try {
    const adId = parseInt(p.linkedin_ad_id, 10);
    if (!Number.isFinite(adId)) {
      return { code: 400, message: 'Invalid linkedin_ad_id' };
    }

    const esResult = await db.elastic.search({
      index: 'linkedin_ads_data',
      size: 1,
      body: {
        query: {
          bool: {
            filter: [
              { term: { ad_id: adId } }
            ]
          }
        },
        _source: ['countries']
      }
    });

    const hits = esResult.hits || esResult.body?.hits;
    const src = hits?.hits?.[0]?._source;
    const countryNames = src?.countries;

    if (!Array.isArray(countryNames) || countryNames.length === 0) {
      return { code: 400, message: 'No data found.', data: null };
    }

    // The scraped `countries` array sometimes carries the SAME country twice —
    // once from an English-locale scrape, once from a non-English LinkedIn UI
    // locale (e.g. "Armenia" AND "Армения") — plus outright exact repeats.
    // isLatinCountryName (countryIso.js) drops non-Latin names before they ever
    // reach the DB — see that helper for the full explanation (collation crash +
    // curly-quote handling).
    const latinNames = [...new Set(countryNames.filter(isLatinCountryName))];

    if (latinNames.length === 0) {
      return { code: 400, message: 'No data found.', data: null };
    }

    const placeholders = latinNames.map(() => '?').join(',');
    const rows = await db.sql.query(
      `SELECT nicename, iso FROM country_data WHERE nicename IN (${placeholders})`,
      latinNames
    );

    // Keyed lower-cased: `nicename` is a case-INSENSITIVE (_ci) column, so MySQL's
    // IN(...) can return a row under different casing than what was searched (e.g.
    // input "North Macedonia" matched the DB's "North macedonia") — a plain JS object
    // lookup below would otherwise miss that match since object keys ARE case-sensitive.
    const isoMap = {};
    (rows || []).forEach(row => {
      isoMap[String(row.nicename).toLowerCase()] = row.iso;
    });

    const resArray = latinNames.map(country => ({
      country: titleCase(country),
      iso: fixCountryIso(country, isoMap[country.toLowerCase()] || null),
    }));

    // Dedupe by resolved ISO — the aliasing above can now resolve two different
    // LinkedIn spellings (e.g. "Hong Kong SAR" and "Hong Kong SAR China", or
    // "Turkey" and "Türkiye") to the same country; without this they'd render as
    // two separate pills for one place. Keep the more complete/longer spelling
    // for display, not just whichever happened to come first in the raw ES
    // array — same tie-break aggregateCountryData uses. Entries that still have
    // no ISO (regions like "Africa"/"Middle East", or names country_data
    // genuinely has no match for) are kept as-is and not deduped against each other.
    const byIso = new Map();
    const data = [];
    for (const entry of resArray) {
      if (!entry.iso) { data.push(entry); continue; }
      const existing = byIso.get(entry.iso);
      if (!existing) {
        byIso.set(entry.iso, entry);
        data.push(entry);
      } else if (entry.country.length > existing.country.length) {
        existing.country = entry.country;
      }
    }

    return { code: 200, message: 'Linkedin country data fetched.', data };
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
      if (!country || !isLatinCountryName(country)) continue;
      if (!countryMap[country]) countryMap[country] = new Set();
      countryMap[country].add(adId);
    }
  }

  if (Object.keys(countryMap).length === 0) return null;

  const allCountryNames = Object.keys(countryMap);
  const isoMap = await batchCountryLookup(db, allCountryNames);

  // Pass 1 — resolve each raw name's ISO independently (same alias table as
  // getLinkedinAdCountry, so "Hong Kong SAR"/"Hong Kong SAR China" both → HK).
  const resolved = Object.entries(countryMap).map(([name, idSet]) => {
    // Display name always comes from the scraped ES name, never country_data.name —
    // that column turns out to be inconsistently cased per row (e.g. "TURKEY" in
    // ALL CAPS for a row whose own nicename is "Turkey"), which titleCase() can't
    // safely correct (it deliberately trusts any string that already has an
    // uppercase letter — see its own comment — so an all-caps DB value passed
    // through unfixed). getLinkedinAdCountry never had this bug because it never
    // reads country_data.name either.
    const lookup = isoMap.get(name.toLowerCase());
    const country = titleCase(name);
    const iso = fixCountryIso(name, lookup?.iso || null);
    return { name, country, iso, idSet };
  });

  // Pass 2 — merge entries that resolved to the SAME iso into one row (union
  // their ad ids) instead of showing separate, fragmented-count rows for what
  // is really one country under two different raw spellings. Prefer the more
  // complete spelling for display (e.g. "Hong Kong SAR China" over "Hong Kong
  // SAR") so this matches the single-ad country view's naming.
  const byIso = new Map();
  const result = [];
  for (const entry of resolved) {
    if (entry.iso) {
      const existing = byIso.get(entry.iso);
      if (existing) {
        for (const id of entry.idSet) existing.idSet.add(id);
        if (entry.name.length > existing.name.length) {
          existing.country = entry.country;
          existing.name = entry.name;
        }
        continue;
      }
      byIso.set(entry.iso, entry);
    }
    result.push(entry);
  }

  return result
    .map(({ country, iso, idSet }) => ({ country, iso, ad_ids: [...idSet], ad_count: idSet.size }))
    .sort((a, b) => b.ad_count - a.ad_count);
}

async function batchCountryLookup(db, names) {
  if (!db.sql || !names || names.length === 0) return new Map();
  const uniqueNames = [...new Set(names)];
  const placeholders = uniqueNames.map(() => '?').join(',');
  try {
    // Only nicename+iso — country_data.name is inconsistently cased per row (see
    // aggregateCountryData's comment) and is never used for display anyway.
    const rows = await db.sql.query(
      `SELECT nicename, iso FROM country_data WHERE nicename IN (${placeholders})`,
      uniqueNames
    );
    const map = new Map();
    if (rows) {
      // Keyed lower-cased — see getLinkedinAdCountry's isoMap for why (nicename
      // is case-insensitive, `_ci`, so a plain-cased JS key can miss a match
      // MySQL actually found under different casing).
      for (const row of rows) map.set(String(row.nicename).toLowerCase(), { iso: row.iso });
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
