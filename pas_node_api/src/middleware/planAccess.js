'use strict';

const planAccessService = require('../services/planAccess/planAccessService');
const config = require('../config');
const logger = require('../logger');
const { getCapabilityDecision } = require('../services/planControl/registries/routeClassification');
const log = logger.createChild('plan-access');

// Filters the frontend always sends as UI defaults — strip silently instead of triggering upgrade modal.
// ad_position is auto-sent as ['FEED','SIDE','MARKETPLACE','VIDEOFEED'] on every Facebook search.
// language defaults to 'en' on every search where the platform supports it (new-ui-react's
// api.js: `ps(resolvedNetworks, 'language') ? (resolvedLang !== 'NA' ? resolvedLang : 'en') : 'NA'`)
// even when the user never opened the language filter — confirmed 2026-07-14: this alone made
// EVERY search 403 with showSubscriptionModal for any plan without the `language` filter unlocked
// (e.g. Basic 2026), regardless of what the user actually clicked.
const SILENT_STRIP_FILTERS = new Set(['ad_position', 'language']);

// ─── SDUI Query Param Map Cache ───────────────────────────────────────────────
// Builds a dynamic map of { query_param: plan_access_config._id } from sdui_config
// so new SDUI filters added via the admin dashboard are automatically enforced
// without requiring code changes. Cache TTL: 5 minutes.
let _sduiParamMapCache = null;
let _sduiParamMapExpiry = 0;

async function getSduiQueryParamMap() {
  if (_sduiParamMapCache && Date.now() < _sduiParamMapExpiry) {
    return _sduiParamMapCache;
  }
  try {
    const { getDB } = require('../services/sdui/db');
    const db = await getDB();
    const sduiDocs = await db.collection('sdui_config').find({}).toArray();
    const map = {};
    for (const doc of sduiDocs) {
      if (!Array.isArray(doc.filters)) continue;
      for (const filter of doc.filters) {
        if (filter.query_param && !map[filter.query_param]) {
          // Map the filter's query_param key → parent SDUI doc _id (= plan_access_config _id)
          map[filter.query_param] = doc._id;
        }
      }
    }
    _sduiParamMapCache = map;
    _sduiParamMapExpiry = Date.now() + 5 * 60 * 1000; // 5 min TTL
    return map;
  } catch (e) {
    log.warn('getSduiQueryParamMap: failed to build dynamic map', { error: e.message });
    return {};
  }
}

/**
 * Middleware: planAccessMiddleware
 *
 * Must run AFTER authMiddleware (needs req.user.plan_id).
 *
 * Loads plan_access_config from MongoDB (cached), then:
 *   1. Computes which platforms the user's plan can access
 *   2. Computes enabled/disabled status for every filter (two-layer check)
 *   3. Strips restricted filters from req.body before they reach ES
 *   4. Sets req.planAccess for downstream handlers
 */
async function planAccessMiddleware(req, res, next) {
  try {
    // Get subscription type from JWT (aMember or SQL user)
    // Check userSubscriptionType first (aMember users), fallback to plan_id (SQL users)
    const planId = req.user?.userSubscriptionType || req.user?.plan_id;

    if (planId === undefined || planId === null) {
      log.warn('planAccessMiddleware: No subscription type found on req.user', { userId: req.user?.id });
      return res.status(403).json({
        code: 403,
        message: 'Subscription plan not found. Please log in again.',
      });
    }

    // For aMember users, use their platformAccess directly
    if (req.user?.platformAccess && !req.user?.plan_id) {
      // Look up config for competitor limits, filter status, AND platform_plans
      const aMemberConfig = await planAccessService.getConfig();
      const competitorLimits = aMemberConfig && aMemberConfig.length > 0
        ? planAccessService.getCompetitorLimits(planId, aMemberConfig)
        : { brandLimit: 0, competitorLimit: 0 };

      // Determine target network(s) from request
      const aMemberNetwork = req.body?.network || req.query?.network || 'all';
      const filterStatus = aMemberConfig && aMemberConfig.length > 0
        ? planAccessService.getFilterStatus(planId, aMemberNetwork, aMemberConfig)
        : {};

      // JWT-allowed: absent key = allowed (backward-compat for old JWTs issued before new platforms
      // were added to defaults); explicit 0 = denied (custom plan that didn't purchase this platform).
      const pa = req.user.platformAccess;
      const paLower = Object.fromEntries(Object.entries(pa).map(([k, v]) => [k.toLowerCase(), v]));
      const ALL_PLATFORMS = ['facebook', 'instagram', 'youtube', 'google', 'linkedin', 'gdn', 'native', 'reddit', 'quora', 'pinterest', 'tiktok'];
      const jwtAllowed = new Set(ALL_PLATFORMS.filter(p => !(p in paLower) || paLower[p] === 1));

      // True when the JWT has at least one platform explicitly set to 0 (custom plan with restricted platforms).
      // Used by the frontend to hide platform tabs entirely (vs tier restrictions which just block clicks).
      const customPlatformRestriction = ALL_PLATFORMS.some(p => (p in paLower) && paLower[p] === 0);

      // Custom plan users (plan 33/46/70 in amember = user picks platforms per invoice).
      // Their plan ID in plan_config maps to GDN/Native tier — intersecting config would give
      // completely wrong platforms. For these users, JWT platformAccess IS the source of truth.
      // Regular amember users (plan 69 Palladium etc.): intersect JWT with config so admin
      // dashboard changes (e.g. removing TikTok from a plan) apply without needing a new JWT.
      const customCodes = new Set(config.amember?.plans?.custom || [33, 46, 70]);
      const isCustomPlanUser = customCodes.has(Number(planId));

      let allowedPlatforms;
      if (isCustomPlanUser) {
        // Custom plan: use only what the amember invoice says — never intersect with config
        allowedPlatforms = ALL_PLATFORMS.filter(p => jwtAllowed.has(p));
      } else {
        const configAllowed = new Set(
          aMemberConfig && aMemberConfig.length > 0
            ? planAccessService.getAllowedPlatforms(planId, aMemberConfig)
            : ALL_PLATFORMS
        );
        allowedPlatforms = ALL_PLATFORMS.filter(p => jwtAllowed.has(p) && configAllowed.has(p));
      }

      // Build dynamic SDUI query param map (same as SQL user path)
      const aMemberSduiMap = await getSduiQueryParamMap();

      // Strip restricted filters from request body — enforces plan-level filter access for aMember users
      const { planRestricted: aMemberPlanRestricted, platformRestricted: aMemberPlatformRestricted } =
        planAccessService.stripRestrictedFilters(req.body, filterStatus, aMemberSduiMap);

      // ad_position and other defaults are silently stripped (see module-level SILENT_STRIP_FILTERS).

      const aMemberHardRestricted = aMemberPlanRestricted.filter(f => !SILENT_STRIP_FILTERS.has(f));

      if (aMemberHardRestricted.length > 0) {
        log.info('Blocked aMember request — plan-restricted filters used', {
          userId: req.user?.id,
          planId,
          network: aMemberNetwork,
          restrictedFilters: aMemberHardRestricted,
        });
        return res.status(403).json({
          code: 403,
          message: 'Your current plan does not support the selected filters. Please upgrade your plan.',
          showSubscriptionModal: true,
          restrictedFilters: aMemberHardRestricted,
          allowedPlatforms,
          filters: filterStatus,
        });
      }

      const aMemberHardPlatformRestricted = aMemberPlatformRestricted.filter(f => !SILENT_STRIP_FILTERS.has(f));

      if (aMemberHardPlatformRestricted.length > 0) {
        log.info('Blocked aMember request — platform-restricted filters used', {
          userId: req.user?.id,
          planId,
          network: aMemberNetwork,
          platformRestrictedFilters: aMemberHardPlatformRestricted,
        });
        return res.status(403).json({
          code: 403,
          message: 'Your current plan does not support the selected filters. Please upgrade your plan.',
          showSubscriptionModal: true,
          restrictedFilters: aMemberHardPlatformRestricted,
          allowedPlatforms,
          filters: filterStatus,
        });
      }

      req.planAccess = {
        planId: Number(planId),
        planTier: planAccessService.resolvePlanTier(planId, aMemberConfig),
        allowedPlatforms,
        filters: filterStatus,
        competitorLimits,
        strippedFilters: [],
        customPlatformRestriction,
      };
      return next();
    }

  
    const planConfig = await planAccessService.getConfig();

    if (!planConfig || planConfig.length === 0) {
      log.error('planAccessMiddleware: No plan access config found — failing closed');
      return res.status(503).json({
        code: 503,
        message: 'Service temporarily unavailable. Please try again shortly.',
      });
    }

    // Determine target network(s) from request
    const network = req.body?.network || req.query?.network || 'all';

    // Compute allowed platforms
    const allowedPlatforms = planAccessService.getAllowedPlatforms(planId, planConfig);

    // Compute filter status for the requested platform(s)
    const filterStatus = planAccessService.getFilterStatus(planId, network, planConfig);

    // Build dynamic query param map from SDUI config (cached, 5 min TTL).
    // Covers new SDUI filters added via admin dashboard without code changes.
    const sduiQueryParamMap = await getSduiQueryParamMap();

    // Check for restricted filters — block request if user is trying to use them
    const { planRestricted, platformRestricted } =
      planAccessService.stripRestrictedFilters(req.body, filterStatus, sduiQueryParamMap);

    // // Filters that the frontend always sends as defaults (not user-selected).
    // // These are silently stripped for restricted plans instead of triggering the upgrade modal.
    // // ad_position is auto-sent as ['FEED','SIDE','MARKETPLACE','VIDEOFEED'] on every search.
    // const SILENT_STRIP_FILTERS = new Set(['ad_position']);

    const hardRestricted = planRestricted.filter(f => !SILENT_STRIP_FILTERS.has(f));

    if (hardRestricted.length > 0) {
      log.info('Blocked request — plan-restricted filters used', {
        userId: req.user?.id,
        planId,
        network,
        restrictedFilters: hardRestricted,
      });
      return res.status(403).json({
        code: 403,
        message: 'Your current plan does not support the selected filters. Please upgrade your plan.',
        showSubscriptionModal: true,
        restrictedFilters: hardRestricted,
        allowedPlatforms,
        filters: filterStatus,
      });
    }

    const hardPlatformRestricted = platformRestricted.filter(f => !SILENT_STRIP_FILTERS.has(f));

    if (hardPlatformRestricted.length > 0) {
      log.info('Blocked request — platform-restricted filters used', {
        userId: req.user?.id,
        planId,
        network,
        platformRestrictedFilters: hardPlatformRestricted,
      });
      return res.status(403).json({
        code: 403,
        message: 'Your current plan does not support the selected filters. Please upgrade your plan.',
        showSubscriptionModal: true,
        restrictedFilters: hardPlatformRestricted,
        allowedPlatforms,
        filters: filterStatus,
      });
    }

    // Competitor limits
    const competitorLimits = planAccessService.getCompetitorLimits(planId, planConfig);

    req.planAccess = {
      planId: Number(planId),
      planTier: planAccessService.resolvePlanTier(planId, planConfig),
      allowedPlatforms,
      filters: filterStatus,
      competitorLimits,
      strippedFilters: [],
      customPlatformRestriction: false,
    };

    next();
  } catch (err) {
    log.error('planAccessMiddleware error', { error: err.message, stack: err.stack });
    return res.status(500).json({
      code: 500,
      message: 'Error checking subscription access.',
    });
  }
}

/**
 * Middleware factory: requirePlatform
 *
 * Returns middleware that blocks the request if the user's plan
 * does not include access to the specified platform.
 *
 * Usage: router.post('/ads/search', authMiddleware, planAccessMiddleware, requirePlatform('facebook'), handler)
 */
function requirePlatform(platform) {
  return (req, res, next) => {
    if (!req.planAccess) {
      return res.status(500).json({
        code: 500,
        message: 'planAccessMiddleware must run before requirePlatform',
      });
    }

    if (!req.planAccess.allowedPlatforms.includes(platform)) {
      log.warn('Platform access denied', {
        userId: req.user?.id,
        planId: req.planAccess.planId,
        platform,
      });
      return res.status(403).json({
        code: 403,
        message: `Your current plan does not include access to ${platform}. Please upgrade your plan.`,
        requiredPlatform: platform,
        currentPlan: req.planAccess.planId,
        allowedPlatforms: req.planAccess.allowedPlatforms,
      });
    }

    next();
  };
}

/**
 * Middleware: requireIntelAccess
 *
 * Must run AFTER authMiddleware + planAccessMiddleware (needs req.planAccess).
 * Server-side mirror of the frontend's `canAccessIntel()` gate (new-ui-react
 * `App.jsx`) — until now the Google competitive-intelligence endpoints
 * (`/keywords/insight`, `/advertiser/profile`, `/ads/trends`, and the newer
 * Keywords Explorer routes) were reachable by any authenticated user because
 * the entitlement check only existed in the UI. Same condition as the FE:
 * the `ad_analytics` filter is enabled for the plan, OR the plan has a
 * competitor/brand tracking limit above zero.
 */
function requireIntelAccess(req, res, next) {
  if (!req.planAccess) {
    return res.status(500).json({
      code: 500,
      message: 'planAccessMiddleware must run before requireIntelAccess',
    });
  }

  const allowed = req.planAccess.filters?.ad_analytics?.enabled === true ||
    (req.planAccess.competitorLimits?.brandLimit ?? 0) > 0;

  if (!allowed) {
    log.warn('Intel access denied', { userId: req.user?.id, planId: req.planAccess.planId });
    return res.status(403).json({
      code: 403,
      message: 'Your current plan does not include competitive intelligence access. Please upgrade your plan.',
      showSubscriptionModal: true,
      currentPlan: req.planAccess.planId,
    });
  }

  next();
}

/**
 * Per-user allow-list for Keywords Explorer (same pattern as marketTrends.js's
 * isAllowedUser). This is a targeted OVERRIDE for specific user IDs, not a
 * toggle for whether plan-tier gating applies — an empty list contributes
 * NOTHING (final access rests on the plan-tier check below). Previously an
 * empty list meant "everyone", which made the keyword_explorer doc's
 * allowed_plan_ids configured via the admin Plan Access tab silently have zero
 * effect on real access (mirrors the identical Market Trends fix, 2026-07-14).
 */
function isKeywordExplorerUserAllowed(userId) {
  const allow = config.keywordExplorer?.allowedUserIds || [];
  if (!allow.length) return false;
  if (userId === undefined || userId === null || userId === '') return false;
  return allow.map(String).includes(String(userId));
}

function getAuthenticatedUserId(req) {
  return req.user?.user_id ?? req.user?.id ?? null;
}

/**
 * Plan-tier gate for Keywords Explorer — mirrors marketTrends.js's isAllowedByPlan
 * exactly. Self-contained (doesn't run planAccessMiddleware), fails to false on
 * any error so a lookup failure only means "this mechanism didn't grant access
 * this time," never a 500 for the whole request.
 */
async function isKeywordExplorerAllowedByPlan(req) {
  try {
    const planId = req.user?.userSubscriptionType ?? req.user?.plan_id;
    if (planId === undefined || planId === null) return false;
    const planConfig = await planAccessService.getConfig();
    if (!planConfig || planConfig.length === 0) return false;
    // null/undefined is the documented unrestricted setting. Resolve it here
    // explicitly so this feature cannot be falsely locked by a stale/older
    // shared filter-status implementation. Explicit [] remains deny-all.
    const featureDoc = planConfig.find((doc) => doc._id === 'keyword_explorer');
    if (featureDoc && featureDoc.allowed_plan_ids == null) return true;
    const filterStatus = planAccessService.getFilterStatus(planId, 'all', planConfig);
    return filterStatus?.keyword_explorer?.enabled === true;
  } catch (_e) {
    return false;
  }
}

/**
 * Combined access check — OR of the allow-list override and the plan-tier gate.
 * Neither can break the other: the allow-list still works even if the plan
 * lookup fails, and the plan-tier grant still works for a user not on the list.
 */
async function hasKeywordExplorerAccess(req) {
  const uid = getAuthenticatedUserId(req);
  if (isKeywordExplorerUserAllowed(uid)) return true;
  try {
    const decision = await getCapabilityDecision(req, 'intelligence.keyword_explorer');
    if (decision) return decision.allowed;
  } catch (_error) {
    // An installation without a readable active policy keeps its legacy gate.
  }
  return isKeywordExplorerAllowedByPlan(req);
}

/**
 * Middleware: requireKeywordExplorerEnabled
 *
 * Feature gate for the Keywords Explorer routes (/keywords/explorer,
 * /keywords/ideas, /keywords/import, /keywords/insight, /keywords/lists*).
 * Two layers, mirroring Market Trends:
 *   1. Feature flag (KEYWORD_EXPLORER_ENABLED / VITE_ENABLE_KEYWORD_EXPLORER) —
 *      when off the APIs are treated as non-existent (404).
 *   2. hasKeywordExplorerAccess (allow-list OR plan-tier) — when on but neither
 *      mechanism grants access, 403.
 */
async function requireKeywordExplorerEnabled(req, res, next) {
  if (config.keywordExplorer?.enabled !== true) {
    return res.status(404).json({ code: 404, message: 'Not found' });
  }
  if (!(await hasKeywordExplorerAccess(req))) {
    return res.status(403).json({
      code: 403,
      message: 'Keywords Explorer is not enabled for this account',
      data: [],
      ...(req.planControlDecision || {}),
    });
  }
  next();
}

module.exports = {
  planAccessMiddleware,
  requirePlatform,
  requireIntelAccess,
  requireKeywordExplorerEnabled,
  isKeywordExplorerUserAllowed,
  getAuthenticatedUserId,
  hasKeywordExplorerAccess,
};
