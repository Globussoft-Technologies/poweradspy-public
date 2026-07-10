'use strict';

const TiktokSearchQueryBuilder = require('../builders/TiktokSearchQueryBuilder');
const { normalizeParams, ensureArray, parsePagination, parseSort, cleanAdsData } = require('../helpers/paramParser');
const { COUNTRY_LABEL_TO_ISO } = require('../helpers/countries');
const { LANG_ISO_TO_ES } = require('../helpers/languages');

// Resolve language values sent by frontend (ISO codes or full names) to ES field values.
function resolveLanguageValues(values) {
  const esNames = new Set(Object.values(LANG_ISO_TO_ES));
  return values.map(v => {
    if (!v) return null;
    const lower = v.toLowerCase();
    if (esNames.has(lower)) return lower;          // already a full name
    return LANG_ISO_TO_ES[lower] || null;          // ISO → full name
  }).filter(Boolean);
}

/**
 * Resolve country display labels to ISO codes.
 * 1. Values already in ISO format (2 uppercase letters) pass through unchanged.
 * 2. For labels, query tiktok_ad_country_info by nicename/name (case-insensitive).
 * 3. Any label not found in DB falls back to the static COUNTRY_LABEL_TO_ISO map.
 */
async function resolveCountryCodes(values, db) {
  const result = [];
  const labelsToLookup = [];

  for (const v of values) {
    if (!v || typeof v !== 'string') continue;
    if (/^[A-Z]{2}$/.test(v)) {
      result.push({ original: v, iso: v });
    } else {
      labelsToLookup.push(v);
    }
  }

  if (labelsToLookup.length > 0 && db?.sql) {
    try {
      const placeholders = labelsToLookup.map(() => '?').join(',');
      const rows = await db.sql.query(
        `SELECT iso, nicename, name FROM tiktok_ad_country_info WHERE LOWER(nicename) IN (${placeholders}) OR LOWER(name) IN (${placeholders})`,
        [...labelsToLookup.map(l => l.toLowerCase()), ...labelsToLookup.map(l => l.toLowerCase())]
      );
      const dbMap = {};
      if (rows) {
        for (const row of rows) {
          if (row.nicename) dbMap[row.nicename.toLowerCase()] = row.iso;
          if (row.name)     dbMap[row.name.toLowerCase()]     = row.iso;
        }
      }
      for (const label of labelsToLookup) {
        const iso = dbMap[label.toLowerCase()] || COUNTRY_LABEL_TO_ISO[label];
        if (iso) result.push({ original: label, iso });
      }
    } catch {
      // DB failed — fall back to static map for all labels
      for (const label of labelsToLookup) {
        const iso = COUNTRY_LABEL_TO_ISO[label];
        if (iso) result.push({ original: label, iso });
      }
    }
  } else {
    for (const label of labelsToLookup) {
      const iso = COUNTRY_LABEL_TO_ISO[label];
      if (iso) result.push({ original: label, iso });
    }
  }

  return result.map(r => r.iso).filter(Boolean);
}

// ES _source fields returned for every TikTok ad
const TIKTOK_AD_SOURCE_FIELDS = [
  'sql_id', 'likes', 'comments', 'shares', 'ctr', 'popularity',
  'impression', 'ad_title', 'video_url', 'video_cover',
  'post_owner_id', 'library_url', 'industry',
  'post_owner', 'last_seen', 'budget', 'days_running', 'language',
];

/**
 * Fetch TikTok ads from ES by their sql_id values.
 */
async function fetchAdsByIds(sqlIds, db) {
  const result = await db.elastic.search({
    index: db.elastic.indexName || process.env.TT_ELASTIC_INDEX || 'tiktok_ads',
    body: {
      query: { terms: { sql_id: sqlIds } },
      size: sqlIds.length,
      _source: TIKTOK_AD_SOURCE_FIELDS,
      collapse: { field: 'sql_id' },
    },
  });
  const hits = result.hits || result.body?.hits;
  return (hits?.hits || []).map(h => h._source);
}

/**
 * Search favourite ads for a user.
 * Queries  hide_favourite_ads WHERE type=3 → fetches full ad details from ES.
 */
async function searchFavoriteAds(p, db, logger) {
  try {
    if (!db.sql) return { code: 503, message: 'SQL connection not available' };

    const favRows = await db.sql.query(
      'SELECT ad_id FROM  hide_favourite_ads WHERE user_id = ? AND type = 3',
      [p.user_id]
    );
    const adIds = favRows.map(r => r.ad_id).filter(Boolean);
    if (adIds.length === 0) {
      return { code: 200, data: [], total: 0, message: 'No favorite ads found' };
    }

    const take = parseInt(p.take, 10) || 20;
    const skip = (parseInt(p.skip, 10) || 0) * take;
    const pagedIds = adIds.slice(skip, skip + take);
    if (pagedIds.length === 0) {
      return { code: 200, data: [], total: adIds.length, message: 'No ads on this page' };
    }

    if (!db.elastic) return { code: 503, message: 'Elasticsearch connection not available' };
    const ads = await fetchAdsByIds(pagedIds, db);

    return {
      code: 200,
      data: cleanAdsData(ads),
      total: adIds.length,
      message: 'Favorite ads fetched successfully',
    };
  } catch (err) {
    logger.error('Error in searchFavoriteAds (tiktok)', { error: err.message });
    return { code: 500, message: 'Error fetching favorite ads', error: err.message };
  }
}

/**
 * Search hidden ads for a user.
 * Queries  hide_favourite_ads WHERE type=1 OR type=2 → fetches full ad details from ES.
 */
async function searchHiddenAds(p, db, logger) {
  try {
    if (!db.sql) return { code: 503, message: 'SQL connection not available' };

    const hiddenRows = await db.sql.query(
      'SELECT ad_id, post_owner_id, type FROM  hide_favourite_ads WHERE user_id = ? AND (type = 1 OR type = 2)',
      [p.user_id]
    );
    const hiddenMeta = {};
    for (const r of hiddenRows) {
      if (r.ad_id) hiddenMeta[String(r.ad_id)] = { hideType: r.type, postOwnerId: r.post_owner_id };
    }
    const adIds = hiddenRows.map(r => r.ad_id).filter(Boolean);
    if (adIds.length === 0) {
      return { code: 200, data: [], total: 0, message: 'No hidden ads found' };
    }

    const take = parseInt(p.take, 10) || 20;
    const skip = (parseInt(p.skip, 10) || 0) * take;
    const pagedIds = adIds.slice(skip, skip + take);
    if (pagedIds.length === 0) {
      return { code: 200, data: [], total: adIds.length, message: 'No ads on this page' };
    }

    if (!db.elastic) return { code: 503, message: 'Elasticsearch connection not available' };
    const ads = await fetchAdsByIds(pagedIds, db);

    const cleanedData = cleanAdsData(ads).map(ad => {
      const meta = hiddenMeta[String(ad.sql_id || ad.ad_id || ad.id)] || {};
      const hideType = meta.hideType ?? 2;
      return { ...ad, hideType, ad_type: hideType, hiddenPostOwnerId: meta.postOwnerId ?? null };
    });

    return {
      code: 200,
      data: cleanedData,
      total: adIds.length,
      message: 'Hidden ads fetched successfully',
    };
  } catch (err) {
    logger.error('Error in searchHiddenAds (tiktok)', { error: err.message });
    return { code: 500, message: 'Error fetching hidden ads', error: err.message };
  }
}

// Fields in the unified payload that TikTok has no equivalent for.
// These are simply ignored (not blocked) — TikTok returns its own results
// based on the filters it does understand (budget, likes, language, country, etc.).
// Only keep fields here that would cause incorrect/misleading results if acted on.
const TIKTOK_UNSUPPORTED_FILTERS = new Set([
  // intentionally empty — all cross-platform fields are now ignored gracefully
]);

// Keys that are "covered" by a TikTok-native equivalent — if the TikTok
// equivalent is also present and active, the unsupported key is ignored.
const TIKTOK_COVERED_BY = {
  adcategory:   'industry',
  subCategory:  'industry',
};

function isActiveValue(v) {
  if (v == null || v === '' || v === 'NA') return false;
  if (Array.isArray(v)) return v.length > 0 && !v.every(x => x === 'NA' || x === '' || x == null);
  return true;
}

function hasUnsupportedFilters(raw) {
  for (const key of TIKTOK_UNSUPPORTED_FILTERS) {
    const v = raw[key];
    if (!isActiveValue(v)) continue;
    // ad_position belongs to other platforms — TikTok never uses it, so always ignore it
    if (key === 'ad_position') continue;
    // If a TikTok-native equivalent is active, this key is already handled
    const coveredBy = TIKTOK_COVERED_BY[key];
    if (coveredBy && isActiveValue(raw[coveredBy])) continue;
    return true;
  }
  return false;
}

/**
 * Main TikTok ad search handler.
 * Mirrors api_tiktok_nodejs/core/dashboard/dashboard.service.js searchFilter.
 */
async function searchAds(req, db, logger) {
  const raw = { ...req.body, ...req.query };
  const p = normalizeParams(raw);
  if (!p.user_id) return { code: 400, message: 'Missing params: user_id is required' };

  // If the payload contains filters that TikTok doesn't support, return 0
  // instead of running a match_all and reporting a misleading full-index count.
  if (hasUnsupportedFilters(raw)) {
    return { code: 200, data: [], total: 0, message: 'No ads found' };
  }

  // ─── Early-return for special search modes ────────────
  if (p.favorite === 'true') return searchFavoriteAds(p, db, logger);
  if (p.hidden === 'true')   return searchHiddenAds(p, db, logger);

  if (!db.elastic) return { code: 503, message: 'Elasticsearch connection not available' };

  // console.log(db.elastic);
  const { size, from } = parsePagination(raw);
  const sort = parseSort(raw);

  const builder = new TiktokSearchQueryBuilder(db.elastic?.indexName);
  
  builder.setFrom(from).setSize(size).setSortField(sort.field).setSortMethod(sort.order);


  // Search text fields
  if (p.keyword)    builder.setKeyword(p.keyword);
  if (p.advertiser) builder.setAdvertiser(p.advertiser);
  if (p.domain)     builder.setDomain(p.domain);

  // Helper: normalise a value to array, filtering out NA/empty. Accepts string or array.
  const toArr = (v) => {
    if (!v || v === 'NA') return [];
    if (Array.isArray(v)) return v.filter(x => x && x !== 'NA');
    return [v];
  };

  // Filters — read unified payload fields, fall back to TikTok-specific aliases
  const industryVal = toArr(raw.industry).length > 0 ? toArr(raw.industry)
    : toArr(raw.adcategory).length > 0 ? toArr(raw.adcategory) : [];
  if (industryVal.length > 0) builder.setIndustry(industryVal);

  const genderVal = toArr(raw.gender);
  if (genderVal.length > 0) builder.setGender(genderVal);

  const ageVal = toArr(raw.age);
  if (ageVal.length > 0) builder.setAge(ageVal);

  const budgetVal = toArr(raw.budget);
  if (budgetVal.length > 0) builder.setBudget(budgetVal);

  // Frontend sends TWO language fields with different semantics:
  //   - `lang`     = user's selection ("NA" if none, array like ["en"] if picked)
  //   - `language` = defaults to "en" as a UI hint even when nothing is picked,
  //                  so it can't be trusted to detect explicit selection.
  // Only `lang` disambiguates "user picked English" from "user picked nothing",
  // so treat `lang` as the authoritative source and ignore the `language` alias.
  const langRaw = toArr(raw.lang);
  const langVal = resolveLanguageValues(langRaw);
  if (langVal.length > 0) builder.setLanguage(langVal);

  // country: unified payload sends array or string
  const countryVal = toArr(raw.country);
  if (countryVal.length > 0) {
    const isoCodes = await resolveCountryCodes(countryVal, db);
    if (isoCodes.length > 0) builder.setCountry(isoCodes);
  }

  // Normalise range filter: accepts both { min, max } and [min, max] array formats
  const toRange = (v) => {
    if (!v || v === 'NA' || v === false) return null;
    if (Array.isArray(v) && v.length === 2) return { min: Number(v[0]), max: Number(v[1]) };
    if (typeof v === 'object' && !Array.isArray(v) && (v.min !== undefined || v.max !== undefined)) {
      if ((v.min === '' || v.min === null || v.min === undefined) &&
          (v.max === '' || v.max === null || v.max === undefined)) return null;
      return v;
    }
    return null;
  };

  const likesRange      = toRange(raw.likes);
  const commentsRange   = toRange(raw.comments);
  const sharesRange     = toRange(raw.shares);
  const popularityRange = toRange(raw.popularity);
  // unified payload uses both "impression" and "impressions" — check both
  const impressionRange = toRange(raw.impression) || toRange(raw.impressions);
  const ctrRange        = toRange(raw.ctr);

  if (likesRange)      builder.setLikes(likesRange);
  if (commentsRange)   builder.setComments(commentsRange);
  if (sharesRange)     builder.setShares(sharesRange);
  if (popularityRange) builder.setPopularity(popularityRange);
  if (impressionRange) builder.setImpression(impressionRange);
  if (ctrRange)        builder.setCtr(ctrRange);

  // Date ranges
  if (Array.isArray(raw.seen_btn_sort) && raw.seen_btn_sort.length === 2) {
    const tsToIso = (ts, time) => new Date(Number(ts) * 1000).toISOString().slice(0, 10) + `T${time}Z`;
    builder.setAdSeen({
      startDate: tsToIso(raw.seen_btn_sort[1], '00:00:00'),
      endDate:   tsToIso(raw.seen_btn_sort[0], '23:59:59'),
    });
  } else if (raw.adSeen !== 'ALL' && raw.adSeenStartDate && raw.adSeenEndDate) {
    const [sd, sm, sy] = raw.adSeenStartDate.split('/');
    const [ed, em, ey] = raw.adSeenEndDate.split('/');
    builder.setAdSeen({
      startDate: new Date(`${sy}-${sm}-${sd}T00:00:00Z`).toISOString(),
      endDate: new Date(`${ey}-${em}-${ed}T23:59:59Z`).toISOString(),
    });
  }
  if (raw.postDate && raw.postDate !== 'ALL' && raw.postStartDate && raw.postEndDate) {
    const [sd, sm, sy] = raw.postStartDate.split('/');
    const [ed, em, ey] = raw.postEndDate.split('/');
    builder.setPostDate({
      startDate: new Date(sy, sm - 1, sd).toISOString(),
      endDate: new Date(ey, em - 1, ed, 23, 59, 59).toISOString(),
    });
  }
  const esParams = builder.build();


  logger.info('Executing TikTok ad search', { from: esParams.body.from, size: esParams.body.size, sortField: sort.field });

  try {
    const result = await db.elastic.search(esParams);
    const hits = result.hits || result.body?.hits;
    const total = typeof hits.total === 'object' ? hits.total.value : hits.total;
    const esHits = (hits.hits || []);

    if (esHits.length === 0) return { code: 200, data: [], total: 0, message: 'No ads found' };

    const ads = esHits.map(hit => hit._source);
    const searchFilterTotal = result.aggregations?.total_ads?.value || total;

    return {
      code: 200,
      data: cleanAdsData(ads),
      total: searchFilterTotal,
      message: 'Ads fetched successfully',
    };
  } catch (err) {
    console.error('Error executing TikTok ad search:', err);
    logger.error('Error in searchAds (tiktok)', { error: err.message, stack: err.stack });
    return { code: 500, message: 'Error occurred in ad search', error: err.message };
  }
}

module.exports = { searchAds };