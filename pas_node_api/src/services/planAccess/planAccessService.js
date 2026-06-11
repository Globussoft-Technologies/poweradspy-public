'use strict';

const fs = require('fs');
const path = require('path');
const logger = require('../../logger');

const log = logger.createChild('plan-access');
const CONFIG_PATH = path.join(__dirname, 'plan_config.json');
const COLLECTION = 'plan_access_config';

// In-memory cache for plan_access_config.
// planAccessMiddleware calls getConfig() on EVERY request to /api/v1/common/*
// — without this cache, every request triggers a MongoDB roundtrip + full
// collection scan. Plan config changes infrequently (admin dashboard edits),
// so a 5-minute TTL is safe. Writes via updateConfig invalidate the cache.
const CONFIG_CACHE_TTL_MS = 5 * 60 * 1000;
let _configCache = null;
let _configCacheAt = 0;
let _configFetchInflight = null;

/**
 * Load plan access config.
 * Primary: MongoDB `plan_access_config` collection.
 * Fallback: plan_config.json (used if MongoDB is unavailable or collection is empty).
 * Cached in memory for 5 minutes; invalidated on updateConfig().
 */
async function getConfig() {
  // Cache hit — fresh
  if (_configCache && (Date.now() - _configCacheAt) < CONFIG_CACHE_TTL_MS) {
    return _configCache;
  }
  // Coalesce concurrent fetches so a burst of requests after expiry doesn't
  // hammer MongoDB with N parallel scans of the same collection.
  if (_configFetchInflight) return _configFetchInflight;

  _configFetchInflight = (async () => {
    try {
      const { getDB } = require('../sdui/db');
      const db = await getDB();
      const docs = await db.collection(COLLECTION).find({}).toArray();
      if (docs.length > 0) {
        _configCache = docs;
        _configCacheAt = Date.now();
        return docs;
      }
      log.warn('plan_access_config collection is empty — falling back to plan_config.json');
    } catch (err) {
      log.warn('MongoDB unavailable for plan access — falling back to plan_config.json', { error: err.message });
    }

    // Fallback: read from JSON file
    try {
      if (!fs.existsSync(CONFIG_PATH)) return [];
      const data = fs.readFileSync(CONFIG_PATH, 'utf8');
      const parsed = JSON.parse(data);
      _configCache = parsed;
      _configCacheAt = Date.now();
      return parsed;
    } catch (err) {
      log.error('Failed to load plan_config.json fallback', { error: err.message });
      return [];
    }
  })();

  try {
    return await _configFetchInflight;
  } finally {
    _configFetchInflight = null;
  }
}

/**
 * Force-invalidate the plan config cache.
 * Called by updateConfig so admin edits take effect immediately.
 */
function invalidateConfigCache() {
  _configCache = null;
  _configCacheAt = 0;
}

/**
 * Upsert all documents into MongoDB `plan_access_config`.
 * Used by the Admin Dashboard to save changes.
 */
async function updateConfig(newConfigArray) {
  try {
    const { getDB } = require('../sdui/db');
    const db = await getDB();
    for (const doc of newConfigArray) {
      await db.collection(COLLECTION).replaceOne({ _id: doc._id }, doc, { upsert: true });
    }
    invalidateConfigCache();
    log.info('plan_access_config updated in MongoDB.');
    return true;
  } catch (err) {
    log.error('Failed to update plan_access_config in MongoDB', { error: err.message });
    throw err;
  }
}

/**
 * Returns true if the plan has been soft-deleted in the plan_groups document.
 * Soft-deleted plans have all access revoked but their mapping data is preserved.
 */
function isPlanDeleted(planId, config) {
  const pgDoc = config.find(d => d._id === 'plan_groups');
  if (!pgDoc || !Array.isArray(pgDoc.deleted_plan_ids)) return false;
  return pgDoc.deleted_plan_ids.some(d => d.plan_id === Number(planId));
}

/**
 * Get the platform_access document and return allowed platforms for a plan.
 */
function getAllowedPlatforms(planId, config) {
  if (isPlanDeleted(planId, config)) return [];

  const platformDoc = config.find(d => d._id === 'platform_access');
  if (!platformDoc || !platformDoc.platform_plans) return [];

  const pid = Number(planId);
  if (isNaN(pid)) {
    log.warn('getAllowedPlatforms: invalid planId', { planId });
    return [];
  }
  const allowed = [];
  for (const [platform, planIds] of Object.entries(platformDoc.platform_plans)) {
    if (Array.isArray(planIds) && planIds.includes(pid)) {
      allowed.push(platform);
    }
  }
  return allowed;
}

/**
 * Get competitor limits for a plan.
 */
function getCompetitorLimits(planId, config) {
  const limitsDoc = config.find(d => d._id === 'competitor_limits');
  if (!limitsDoc || !limitsDoc.plan_limits) return { brandLimit: 0, competitorLimit: 0 };

  const pid = String(planId);
  return limitsDoc.plan_limits[pid] || { brandLimit: 0, competitorLimit: 0 };
}

/**
 * For a given plan and network, compute the enabled/disabled status of every filter.
 */
function getFilterStatus(planId, network, config) {
  const pid = Number(planId);
  if (isNaN(pid)) {
    log.warn('getFilterStatus: invalid planId', { planId });
    return {};
  }

  // Soft-deleted plan — deny all filters, preserve data for potential restore
  if (isPlanDeleted(pid, config)) {
    const result = {};
    for (const doc of config) {
      if (doc.category === 'platform' || doc.category === 'limits') continue;
      result[doc._id] = { enabled: false, planAllowed: false };
    }
    return result;
  }
  const result = {};

  // Normalise network to an array of lowercase strings for platform_support checks.
  // network may be a string ('all', 'facebook'), an array (['facebook','instagram']), or undefined.
  const networkList = (() => {
    if (!network || network === 'all') return null; // null = skip platform check
    if (Array.isArray(network)) return network.map(n => n.toLowerCase());
    return [String(network).toLowerCase()];
  })();

  for (const doc of config) {
    if (doc.category === 'platform' || doc.category === 'limits') continue;
    const filterId = doc._id;

    // Check if the plan is in the allowed list for this filter
    // null/undefined = legacy "all allowed"; empty array [] = restricted for all; populated = check list
    let planAllowed = false;
    if (!doc.allowed_plan_ids) {
      planAllowed = true;
    } else if (doc.allowed_plan_ids.length > 0 && doc.allowed_plan_ids.includes(pid)) {
      planAllowed = true;
    }

    // Secondary check: platform_support — only when a specific platform is requested (not 'all').
    // platform_support is an object { facebook: true, instagram: false, ... }.
    // A platform NOT present as a key is treated as unrestricted (undefined = no rule set).
    // A filter is blocked only when every active network is explicitly set to false.
    let enabled = planAllowed;
    if (planAllowed && networkList && doc.platform_support) {
      const ps = doc.platform_support;
      if (Array.isArray(ps)) {
        // Array form: only listed platforms are supported; missing = not supported.
        enabled = networkList.some(n => ps.includes(n));
      } else if (typeof ps === 'object') {
        // Object form: missing key = no restriction for that platform (treat as true).
        // Only block if ALL active networks are explicitly false.
        enabled = networkList.some(n => !(n in ps) || ps[n] === true);
      }
    }

    // planAllowed = plan-based restriction (triggers 403 + upgrade modal)
    // enabled     = planAllowed AND platform supports it (platform-only failures → silent drop)
    result[filterId] = { enabled, planAllowed };
  }
  return result;
}

/**
 * Maps actual req.body keys (from frontend api.js) to plan_access_config _id.
 * Keys must match exactly what buildSearchPayload() in api.js puts in the request body.
 *
 * Many body keys differ from the SDUI query_param, so the dynamic SDUI map misses them.
 * This static map is the authoritative override for all such mismatches.
 */
const BODY_KEY_TO_FILTER_ID = {
  // ── Search types ──────────────────────────────────────────────────────────
  // body key 'keyword' vs query_param 'q'
  keyword: 'keyword_search',
  // body key 'advertiser' vs query_param 'post_owner_name'
  advertiser: 'advertiser_search',
  domain: 'domain_search',

  // ── Demographics ──────────────────────────────────────────────────────────
  gender: 'gender',
  // body sends 'lower_age' / 'upper_age' but filter _id is 'age'
  lower_age: 'age',
  upper_age: 'age',

  // ── Geo filters ───────────────────────────────────────────────────────────
  // body sends 'country' but SDUI query_param may be 'countries' (plural) → SDUI map misses it
  country: 'country',

  // ── Ad properties ─────────────────────────────────────────────────────────
  // body key 'type' vs query_param 'ad_type'
  type: 'ad_type',
  // body key 'call_to_action' → plan_access_config _id 'call_to_action' (admin panel saves here)
  // call_to_action: 'cta',
  call_to_action: 'call_to_action',
  // body key 'adcategory' → SDUI/MongoDB _id is 'category' (admin dashboard saves under this ID).
  // Previously mapped to 'ad_category' (plan_config.json seed ID) — that mismatch caused
  // platform restrictions saved in MongoDB to be silently ignored during enforcement.
  adcategory: 'category',
  // body key 'subCategory' (child category) shares the same plan_access restriction as 'adcategory'.
  // When category is restricted for a platform, subcategory must also be stripped.
  subCategory: 'category',

  // ── Ad properties (continued) ────────────────────────────────────────────
  // body key 'ad_position' vs SDUI query_param 'adPosition'
  ad_position: 'ad_position',

  // ── Sidebar filters ───────────────────────────────────────────────────────
  // body key 'lang' vs filter _id / query_param 'language'
  lang: 'language',
  // body key 'verified' vs SDUI query_param 'verifiedOnly'
  verified: 'verified',
  // body key 'size' vs SDUI _id 'image_size' and query_param 'imageSize'
  size: 'image_size',

  // ── Lander / merchant ────────────────────────────────────────────────────
  // body key 'ecommerce' vs SDUI doc _id 'ecommerce_platform' (seed _id was 'ecommerce')
  ecommerce: 'ecommerce_platform',
  funnel: 'funnel',
  // body key 'affiliate' vs query_param 'affiliate_network'
  affiliate: 'affiliate_network',
  // body key 'source' → plan_access_config _id 'traffic_source' (admin panel saves here)
  // source: 'source',
  source: 'traffic_source',
  // body key 'market_platform' vs query_param 'marketing_platform'
  market_platform: 'marketing_platform',

  // ── Sort filters ─────────────────────────────────────────────────────────
  likes_sort: 'likes_sort',
  comments_sort: 'comments_sort',
  shares_sort: 'shares_sort',
  impression_sort: 'impression_sort',
  popularity_sort: 'popularity_sort',
  hits_sort: 'hits_sort',
  // body key sent by buildSearchPayload when user sorts by "Ad Running Days"
  running_longest_sort: 'ad_running_days_sort',
  // All budget body keys → single 'ad_budget_sort' plan_access_config doc (controls all platforms)
  adBudget: 'ad_budget_sort',
  avgBudget: 'ad_budget_sort',
  adBudget_sort: 'ad_budget_sort',
  budget: 'ad_budget_sort',

  // ── Date filters ──────────────────────────────────────────────────────────
  post_date_btn_sort: 'post_date',
  seen_btn_sort: 'last_seen',
  domain_date_btn_sort: 'domain_registration',
};

/**
 * Some filters have two plan_access_config entries: one from the SDUI admin dashboard
 * (the primary, e.g. 'category') and one from the plan_config.json seed (e.g. 'ad_category').
 * The SDUI-based doc may have a short allowed_plan_ids list (only plans explicitly configured
 * via the admin UI) while the seed doc has the full list. This alias map lets
 * stripRestrictedFilters fall back to the seed doc for the planAllowed check so that plans
 * not yet in the SDUI doc's list are not incorrectly blocked.
 */
const FILTER_ID_ALIASES = {
  // SDUI doc _id → seed doc _id fallback for planAllowed check.
  // When the SDUI doc's allowed_plan_ids is incomplete (only plans saved via admin UI),
  // fall back to the seed doc to avoid incorrectly blocking plans not yet in the SDUI list.

  cta: 'call_to_action',
  source: 'traffic_source',
};

/**
 * Strip restricted filters from request body based on filter status.
 *
 * @param {object} body         - req.body
 * @param {object} filterStatus - { filterId: { enabled: boolean } } from getFilterStatus()
 * @param {object} sduiQueryParamMap - dynamic map of { query_param: plan_access_config._id }
 *                                     built from sdui_config collection for new SDUI elements.
 *                                     BODY_KEY_TO_FILTER_ID takes priority for existing filters.
 */
/**
 * Strip restricted filters from request body based on filter status.
 *
 * Returns { planRestricted, platformRestricted }:
 *   planRestricted     — body keys where the plan has no access at all
 *                        (triggers 403 + upgrade/subscription modal)
 *   platformRestricted — body keys where the plan is allowed but the specific
 *                        platform is restricted (triggers 403 + platform message,
 *                        NOT the upgrade modal)
 *
 * @param {object} body         - req.body
 * @param {object} filterStatus - { filterId: { enabled, planAllowed } } from getFilterStatus()
 * @param {object} sduiQueryParamMap - dynamic map built from sdui_config collection
 */
function stripRestrictedFilters(body, filterStatus, sduiQueryParamMap = {}) {
  const planRestricted = [];
  const platformRestricted = [];
  if (!body || !filterStatus) return { planRestricted, platformRestricted };

  // Merge: sduiQueryParamMap covers new SDUI elements added via admin dashboard;
  // BODY_KEY_TO_FILTER_ID takes priority for existing hardcoded filters (spread order matters).
  const combinedMap = { ...sduiQueryParamMap, ...BODY_KEY_TO_FILTER_ID };

  for (const [bodyKey, filterId] of Object.entries(combinedMap)) {
    const val = body[bodyKey];
    // 'NA' is the frontend's "not selected" sentinel — skip it
    if (val === undefined || val === null || val === '' || val === 'NA') continue;
    if (Array.isArray(val) && val.length === 0) continue;
    // Skip empty range objects like {min:"",max:""} — treat same as 'NA' (no filter selected)
    if (typeof val === 'object' && !Array.isArray(val)) {
      const hasMin = val.min !== undefined && val.min !== null && val.min !== '';
      const hasMax = val.max !== undefined && val.max !== null && val.max !== '';
      if (!hasMin && !hasMax) continue;
    }

    let fs = filterStatus[filterId];

    // If the SDUI-based doc says planAllowed:false (its allowed_plan_ids list is incomplete —
    // only plans explicitly saved via the admin UI are in it), fall back to the seed alias doc.
    // Use the alias's planAllowed but keep the primary doc's enabled flag (platform restriction).
    if (fs && !fs.planAllowed) {
      const aliasId = FILTER_ID_ALIASES[filterId];
      if (aliasId && filterStatus[aliasId] && filterStatus[aliasId].planAllowed) {
        fs = { planAllowed: true, enabled: fs.enabled };
      }
    }

    if (fs && fs.enabled === false) {
      log.info('[STRIP-DEBUG]', { bodyKey, filterId, val, enabled: fs.enabled, planAllowed: fs.planAllowed });
      delete body[bodyKey];
      if (!fs.planAllowed) {
        // Plan has no access to this filter at all → upgrade modal
        planRestricted.push(bodyKey);
      } else {
        // Plan is allowed but the selected platform is restricted → platform message
        platformRestricted.push(bodyKey);
      }
    }
  }
  if (planRestricted.length > 0 || platformRestricted.length > 0) {
    log.info('[STRIP-DEBUG] restricted filters:', { planRestricted, platformRestricted });
  }
  return { planRestricted, platformRestricted };
}

/**
 * Resolve a numeric planId to its human-readable tier name (e.g. 'Basic', 'Palladium').
 * Looks up the plan_groups document already present in the fetched config array.
 * Returns null when planId is invalid, config is unavailable, or planId is not found.
 * Pure function — safe to call with any input without throwing.
 */
function resolvePlanTier(planId, config) {
  const pid = Number(planId);
  if (!Number.isFinite(pid) || pid <= 0) return null;
  if (!Array.isArray(config)) return null;
  const pgDoc = config.find(d => d?._id === 'plan_groups');
  if (!pgDoc?.groups || typeof pgDoc.groups !== 'object') return null;
  for (const [tier, data] of Object.entries(pgDoc.groups)) {
    if (Array.isArray(data?.plans) && data.plans.includes(pid)) return tier;
  }
  return null;
}

module.exports = {
  getConfig,
  updateConfig,
  getAllowedPlatforms,
  getCompetitorLimits,
  getFilterStatus,
  stripRestrictedFilters,
  invalidateConfigCache,
  resolvePlanTier,
};
