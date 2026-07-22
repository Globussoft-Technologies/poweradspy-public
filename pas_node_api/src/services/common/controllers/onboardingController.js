'use strict';

/**
 * First-login onboarding — category / competitors / countries.
 *
 * Storage: reuses `am_user_action` (same table + `am_id` key as
 * pushNotificationController's fcm_token / pinterest_launch_status — see
 * ONBOARDING_FEATURE_IMPLEMENTATION_PLAN.md §3, §5). Only new, nullable
 * columns are added (migration: src/database/migrations/2026_add_onboarding_columns.js) —
 * no existing column/query on this table is touched.
 *
 * Endpoints (mounted in commonRoutes.js):
 *   GET  /api/v1/common/onboarding/status           — has this user completed onboarding?
 *   POST /api/v1/common/onboarding                  — save selections, mark complete
 *   POST /api/v1/common/onboarding/preview-results   — instant trending/top-advertiser/longest-running preview
 *
 * Category search itself reuses the EXISTING /api/v1/common/catsearch proxy
 * (see commonRoutes.js) — no new category-search endpoint needed.
 */

const dbManager = require('../../../database/DatabaseManager');
const serviceRegistry = require('../../ServiceRegistry');
const logger = require('../../../logger');
const config = require('../../../config');
const { resolveNeedsOnboarding } = require('../helpers/onboardingEligibility');

const log = logger.createChild('onboarding');

// Same token network / table as pushNotificationController.js — keep in sync
// if that config ever changes (both read/write the same per-user row).
const ident = (s, def) => (/^[A-Za-z0-9_]+$/.test(String(s || '')) ? String(s) : def);
const NET = config.notifications?.tokenNetwork || 'facebook';
const TBL = ident(config.notifications?.tokenTable, 'am_user_action');

const MAX_COMPETITORS = 3;
const MAX_COUNTRIES = 3;
const PREVIEW_TIMEOUT_MS = 5000;
const PREVIEW_CACHE_TTL_SEC = 300;
const PREVIEW_SIZE = 10;

function rowsOf(result) {
  return Array.isArray(result?.[0]) ? result[0] : (result || []);
}

// ─── GET /api/v1/common/onboarding/status ─────────────────────────────────
exports.getOnboardingStatus = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.user_id;
    if (!userId) return res.status(401).json({ code: 401, message: 'Unauthorized' });
    const userCreatedAt = req.user?.added || req.user?.created_at || req.user?.createdAt || null;
    const needsOnboarding = await resolveNeedsOnboarding(userId, userCreatedAt);
    return res.json({ code: 200, data: { needsOnboarding } });
  } catch (error) {
    log.error('Error in getOnboardingStatus', { error: error.message });
    // Fail open here too — a broken status check must not block login/UI.
    return res.json({ code: 200, data: { needsOnboarding: false } });
  }
};

// ─── POST /api/v1/common/onboarding ────────────────────────────────────────
exports.saveOnboarding = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.user_id;
    if (!userId) return res.status(401).json({ code: 401, message: 'Unauthorized' });

    const userEmail = req.user?.email || '';
    const {
      major_category_id, major_category_name,
      sub_category_id, sub_category_name,
      competitors, countries,
    } = req.body || {};

    if (!major_category_id) {
      return res.status(400).json({ code: 400, message: 'major_category_id is required' });
    }

    // The AI category-search API doesn't always return a numeric id (it can
    // come back as a slug/name), but onboarding_major_category_id is an INT
    // column — store the id only when it actually parses as one, otherwise
    // null. The name is always kept in onboarding_major_category_name, which
    // is what the ES queries actually filter on (see getLongestRunning).
    const majorCategoryIdNum = Number.isInteger(Number(major_category_id)) && String(major_category_id).trim() !== ''
      ? Number(major_category_id)
      : null;
    const subCategoryIdNum = Number.isInteger(Number(sub_category_id)) && String(sub_category_id ?? '').trim() !== ''
      ? Number(sub_category_id)
      : null;

    const competitorList = Array.isArray(competitors) ? competitors.filter(Boolean) : [];
    const countryList = Array.isArray(countries) ? countries.filter(Boolean) : [];

    if (competitorList.length > MAX_COMPETITORS) {
      return res.status(400).json({ code: 400, message: `competitors: max ${MAX_COMPETITORS} allowed` });
    }
    if (countryList.length > MAX_COUNTRIES) {
      return res.status(400).json({ code: 400, message: `countries: max ${MAX_COUNTRIES} allowed` });
    }
    if (countryList.length === 0) {
      return res.status(400).json({ code: 400, message: 'At least one country is required' });
    }

    const sql = dbManager.getSQL(NET);
    if (!sql) {
      log.error('Onboarding save: DB unavailable', { userId });
      return res.status(503).json({ code: 503, message: 'Database unavailable' });
    }

    // Upsert — same pattern as registerToken() in pushNotificationController.js.
    // A row may already exist for this user (created by fcm_token registration).
    const today = new Date().toISOString().split('T')[0];
    await sql.query(
      `INSERT INTO ${TBL}
         (am_id, am_email, am_subscription, ad_count, month_count, date, pinterest_launch_status,
          onboarding_major_category_id, onboarding_major_category_name,
          onboarding_sub_category_id, onboarding_sub_category_name,
          onboarding_competitors, onboarding_countries, onboarding_completed)
       VALUES (?, ?, 0, 0, 0, ?, 0, ?, ?, ?, ?, ?, ?, 1)
       ON DUPLICATE KEY UPDATE
         onboarding_major_category_id   = VALUES(onboarding_major_category_id),
         onboarding_major_category_name = VALUES(onboarding_major_category_name),
         onboarding_sub_category_id     = VALUES(onboarding_sub_category_id),
         onboarding_sub_category_name   = VALUES(onboarding_sub_category_name),
         onboarding_competitors         = VALUES(onboarding_competitors),
         onboarding_countries           = VALUES(onboarding_countries),
         onboarding_completed           = 1`,
      [
        userId, userEmail, today,
        majorCategoryIdNum, major_category_name || null,
        subCategoryIdNum, sub_category_name || null,
        JSON.stringify(competitorList), JSON.stringify(countryList),
      ]
    );

    log.info('Onboarding saved', { userId, major_category_id: majorCategoryIdNum, competitors: competitorList.length, countries: countryList.length });

    return res.json({ code: 200, message: 'Onboarding saved', data: { needsOnboarding: false } });
  } catch (error) {
    log.error('Error in saveOnboarding', { error: error.message, stack: error.stack });
    return res.status(500).json({ code: 500, message: 'Error saving onboarding preferences', error: error.message });
  }
};

// ─── Preview-results helpers (facebook network — see Build Order step 6/7 in the plan) ───

function buildPreviewCacheKey(majorCategoryName, subCategoryId, countries, competitors) {
  const c = [...countries].map(String).sort().join(',');
  const comp = [...(competitors || [])].map(String).sort().join(',');
  return `onboarding:preview:${majorCategoryName}:${subCategoryId || ''}:${c}:${comp}`;
}

// NOTE: `facebook.category.keyword` (the ES field SearchMixQueryBuilder.setAdCategory
// filters on) stores the category DISPLAY NAME (e.g. "Clothing and Accessories"),
// not the numeric major_category_id the AI category-search API returns — confirmed
// against a live query (id filter matched 0 ads, name filter matched real ads). All
// category-filtered lookups below take the NAME, not the id.
// Runs `searchAds` once per selected competitor (the builder's advertiser
// filter only takes one name at a time — see SearchMixQueryBuilder.setPostOwnerName),
// merging and de-duping the results across all of them. With no competitors
// selected this degrades to a single category+country query, same as before.
async function searchAdsForCompetitors(service, req, baseBody, competitors, limit) {
  const { searchAds } = require('../../facebook/controllers/adSearchController');
  const names = Array.isArray(competitors) ? competitors.filter(Boolean) : [];

  const runOne = async (advertiser) => {
    const netReq = {
      ...req,
      query: {},
      body: { ...baseBody, ...(advertiser ? { advertiser } : {}) },
    };
    const r = await searchAds(netReq, service.db, service.log);
    return r.code === 200 ? (r.data || []) : [];
  };

  if (names.length === 0) return runOne(null);

  const perCompetitor = await Promise.all(names.map(runOne));
  const seen = new Set();
  const merged = [];
  for (const list of perCompetitor) {
    for (const ad of list) {
      const key = ad.ad_id || ad.id;
      if (key != null && seen.has(key)) continue;
      if (key != null) seen.add(key);
      merged.push(ad);
    }
  }
  return merged.slice(0, limit);
}

async function getLongestRunning(service, req, majorCategoryName, countries, limit, competitors) {
  return searchAdsForCompetitors(service, req, {
    user_id: req.user?.id || req.user?.user_id,
    adcategory: [majorCategoryName],
    country: countries,
    running_longest_sort: 'desc',
    take: limit,
    skip: 0,
  }, competitors, limit);
}

async function getTrendingAds(service, req, majorCategoryName, countries, limit, competitors) {
  return searchAdsForCompetitors(service, req, {
    user_id: req.user?.id || req.user?.user_id,
    adcategory: [majorCategoryName],
    country: countries,
    popularity_sort: 'desc',
    take: limit,
    skip: 0,
  }, competitors, limit);
}

// Top advertisers for a category+country — ranked by how many matching ads
// each advertiser has. Runs the SAME category/country filter
// SearchMixQueryBuilder builds for the main search (identical semantics), but
// counts advertisers in application code from the actual matching documents
// rather than an ES terms aggregation: this index has no aggregatable
// advertiser-name field (`post_owner_name.keyword` exists in the mapping but
// has no indexed values pre-dating that sub-field, and there's no numeric
// owner-id field in the documents either — confirmed against the live
// mapping/docs), so a terms agg silently returns zero buckets no matter what
// field is targeted. Pulling a bounded sample of matching docs and counting
// `post_owner_name` in JS sidesteps that gap entirely.
const TOP_ADVERTISERS_SAMPLE_SIZE = 300;

async function getTopAdvertisers(service, majorCategoryName, countries, limit) {
  if (!service.db.elastic) return [];
  const SearchMixQueryBuilder = require('../../facebook/builders/SearchMixQueryBuilder');
  const builder = new SearchMixQueryBuilder(service.db.elastic?.indexName);
  builder.setAdCategory([majorCategoryName]).setCountry(countries).setSize(0);
  const { index, body } = builder.build();

  try {
    const result = await service.db.elastic.search({
      index,
      body: {
        size: TOP_ADVERTISERS_SAMPLE_SIZE,
        track_total_hits: false,
        query: body.query,
        _source: ['facebook_ad_post_owners.post_owner_name'],
      },
    });
    const hits = (result?.hits || result?.body?.hits)?.hits || [];

    const countByName = new Map();
    for (const hit of hits) {
      const name = hit._source?.['facebook_ad_post_owners.post_owner_name'];
      if (!name) continue;
      countByName.set(name, (countByName.get(name) || 0) + 1);
    }

    return [...countByName.entries()]
      .map(([advertiser, ads]) => ({ advertiser, ads }))
      .sort((a, b) => b.ads - a.ads)
      .slice(0, limit);
  } catch (err) {
    service.log?.warn?.('getTopAdvertisers: query failed', { error: err.message });
    return [];
  }
}

function withTimeout(promise, ms, label) {
  let handle;
  const timer = new Promise(resolve => {
    handle = setTimeout(() => resolve([]), ms);
  });
  return Promise.race([
    promise.then(v => { clearTimeout(handle); return v; }).catch(() => { clearTimeout(handle); return []; }),
    timer,
  ]);
}

// ─── POST /api/v1/common/onboarding/preview-results ────────────────────────
// Body: { major_category_id, major_category_name, sub_category_id?, countries: [...] }
// major_category_name is required for the actual ES filtering (see the NOTE
// above getLongestRunning) — major_category_id is accepted too but only used
// for cache-key namespacing, since the AI category-search API's numeric id
// doesn't match the ES `facebook.category.keyword` field's stored values.
exports.getOnboardingPreview = async (req, res) => {
  try {
    const { major_category_id, major_category_name, sub_category_id, countries, competitors } = req.body || {};
    if (!major_category_name) {
      return res.status(400).json({ code: 400, message: 'major_category_name is required' });
    }
    const countryList = Array.isArray(countries) ? countries.filter(Boolean).slice(0, MAX_COUNTRIES) : [];
    if (countryList.length === 0) {
      return res.status(400).json({ code: 400, message: 'countries is required (at least 1)' });
    }
    const competitorList = Array.isArray(competitors) ? competitors.filter(Boolean).slice(0, MAX_COMPETITORS) : [];

    const service = serviceRegistry.getService('facebook');
    if (!service || !service.db) {
      return res.status(503).json({ code: 503, message: 'Facebook service unavailable' });
    }

    const cache = require('../../../cache/CacheStore');
    const cacheKey = buildPreviewCacheKey(major_category_name, sub_category_id, countryList, competitorList);

    try {
      const cached = cache?.get ? await cache.get(cacheKey) : null;
      if (cached) {
        return res.json({ code: 200, message: 'Preview results (cached)', data: JSON.parse(cached) });
      }
    } catch (_) { /* cache miss/unavailable — fall through to live compute */ }

    // Trending / longest-running are scoped to the picked competitors when any
    // are selected (that's the whole point of picking them) — top advertisers
    // stays category-wide so the user also sees the broader landscape.
    const [trending, topAdvertisers, longestRunning] = await Promise.all([
      withTimeout(getTrendingAds(service, req, major_category_name, countryList, PREVIEW_SIZE, competitorList), PREVIEW_TIMEOUT_MS, 'trending'),
      withTimeout(getTopAdvertisers(service, major_category_name, countryList, PREVIEW_SIZE), PREVIEW_TIMEOUT_MS, 'topAdvertisers'),
      withTimeout(getLongestRunning(service, req, major_category_name, countryList, PREVIEW_SIZE, competitorList), PREVIEW_TIMEOUT_MS, 'longestRunning'),
    ]);

    const data = { trending, topAdvertisers, longestRunning };

    try {
      if (cache?.set) await cache.set(cacheKey, JSON.stringify(data), PREVIEW_CACHE_TTL_SEC);
    } catch (_) { /* caching is best-effort */ }

    return res.json({ code: 200, message: 'Preview results fetched', data });
  } catch (error) {
    log.error('Error in getOnboardingPreview', { error: error.message, stack: error.stack });
    return res.status(500).json({ code: 500, message: 'Error fetching preview results', error: error.message });
  }
};

// ─── GET /api/v1/common/onboarding/advertiser-suggest?query=&major_category_id=&countries= ───
// Suggests advertisers for the Competitors picker. From the user's point of
// view, a random "top advertiser site-wide" list is meaningless noise (they
// have no way to know which of thousands of names is relevant to THEM) — so
// once a category is picked, this returns the TOP ADVERTISERS IN THAT
// CATEGORY (reusing the exact same getTopAdvertisers aggregation the results
// preview uses), which are names the user will actually recognize as
// competitors in their own space. Falls back to the site-wide recent-
// advertisers list (SQL) only when no category has been picked yet.
// A `query` always narrows by name (works in both modes).
const ADVERTISER_LIST_SIZE = 25;
const COMPETITOR_LIST_SIZE = 25;

exports.getAdvertiserSuggestions = async (req, res) => {
  try {
    const query = String(req.query?.query || '').trim();
    const majorCategoryName = req.query?.major_category_name;
    const countries = typeof req.query?.countries === 'string' && req.query.countries
      ? req.query.countries.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    // Category-relevant path — real competitors in the user's own niche.
    if (majorCategoryName) {
      const service = serviceRegistry.getService('facebook');
      if (service?.db) {
        const topAdvertisers = await getTopAdvertisers(service, majorCategoryName, countries, ADVERTISER_LIST_SIZE);
        let names = topAdvertisers.map(a => a.advertiser).filter(Boolean);
        if (query) {
          const q = query.toLowerCase();
          names = names.filter(n => n.toLowerCase().includes(q));
        }
        if (names.length) return res.json({ code: 200, data: { advertisers: names } });
        // No advertisers found for this category (e.g. very new/niche category) —
        // fall through to the generic list rather than showing nothing.
      }
    }

    // Generic fallback (no category picked yet, or category had no matches).
    const sql = dbManager.getSQL(NET);
    if (!sql) {
      return res.json({ code: 200, data: { advertisers: [] } }); // fail open — never block the picker
    }

    // GROUP BY (not DISTINCT) so ORDER BY MAX(id) is allowed; LIMIT is our own
    // constant, inlined as a validated integer — mysql2 rejects `LIMIT ?` as a
    // bound param in some driver/statement-cache configurations.
    const limit = Number.isInteger(ADVERTISER_LIST_SIZE) ? ADVERTISER_LIST_SIZE : 25;
    const rows = query
      ? rowsOf(await sql.query(
          `SELECT post_owner_name FROM facebook_ad_post_owners
           WHERE post_owner_name LIKE ?
           GROUP BY post_owner_name ORDER BY MAX(id) DESC LIMIT ${limit}`,
          [`${query}%`]
        ))
      : rowsOf(await sql.query(
          `SELECT post_owner_name FROM facebook_ad_post_owners
           WHERE post_owner_name IS NOT NULL AND post_owner_name <> ''
           GROUP BY post_owner_name ORDER BY MAX(id) DESC LIMIT ${limit}`
        ));

    const advertisers = rows.map(r => r.post_owner_name).filter(Boolean);
    return res.json({ code: 200, data: { advertisers } });
  } catch (error) {
    log.error('Error in getAdvertiserSuggestions', { error: error.message });
    return res.json({ code: 200, data: { advertisers: [] } }); // fail open
  }
};

exports.getCompetitorSuggestions = async (req, res) => {
  try {
    const query = String(req.query?.query || '').trim();
    const majorCategoryName = String(req.query?.major_category_name || '').trim();
    const countries = typeof req.query?.countries === 'string' && req.query.countries
      ? req.query.countries.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    const mongo = dbManager.getMongo(NET);
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = query ? new RegExp(escaped, 'i') : null;

    if (mongo) {
      const docs = await mongo.collection('existing_competitors')
        .find(query ? { advertiser: regex } : {}, { projection: { advertiser: 1, competitors: 1 } })
        .sort({ updatedAt: -1, createdAt: -1 })
        .limit(10)
        .toArray();

      const fromDb = [];
      const seen = new Set();
      for (const doc of docs) {
        for (const item of doc?.competitors || []) {
          const name = String(item?.competitor_name || '').trim();
          if (!name) continue;
          if (regex && !regex.test(name) && !regex.test(String(doc?.advertiser || ''))) continue;
          const key = name.toLowerCase();
          if (seen.has(key)) continue;
          seen.add(key);
          fromDb.push(name);
          if (fromDb.length >= COMPETITOR_LIST_SIZE) break;
        }
        if (fromDb.length >= COMPETITOR_LIST_SIZE) break;
      }

      if (fromDb.length) {
        return res.json({ code: 200, data: { competitors: fromDb, source: 'existing_competitors' } });
      }
    }

    if (majorCategoryName) {
      const service = serviceRegistry.getService('facebook');
      if (service?.db) {
        const topAdvertisers = await getTopAdvertisers(service, majorCategoryName, countries, COMPETITOR_LIST_SIZE);
        let names = topAdvertisers.map(a => a.advertiser).filter(Boolean);
        if (query) {
          const q = query.toLowerCase();
          names = names.filter(n => n.toLowerCase().includes(q));
        }
        if (names.length) {
          return res.json({ code: 200, data: { competitors: names, source: 'category_advertisers_fallback' } });
        }
      }
    }

    return res.json({ code: 200, data: { competitors: [], source: 'none' } });
  } catch (error) {
    log.error('Error in getCompetitorSuggestions', { error: error.message });
    return res.json({ code: 200, data: { competitors: [], source: 'error' } });
  }
};
