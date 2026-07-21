'use strict';

/**
 * 2026 pricing restructure — entitlement rules, resolved to real plan IDs ONLY
 * from config.pricing.planIds (never hardcoded here or anywhere else). See
 * config.json's `pricing.planIds._description` and docs/PLAN_ACCESS.md § 2026
 * Pricing Restructure for why: dev and prod can have (and did — see the 2026-07-14
 * incident where ID 111 turned out to already be a real legacy Basic plan in this
 * environment) different sets of actually-free plan IDs.
 *
 * Everything below is SYMBOLIC (tier names, cumulative platform/filter rules) —
 * the only numbers involved come from config.pricing.planIds at call time, so a
 * config.json edit + re-running planAccessMigrate.js is the entire migration
 * for a new environment. No code change, ever, for a plan-ID renumbering.
 */

const config = require('../../config');

const TIERS = ['basic', 'standard', 'platinum', 'palladium'];

// Cumulative platform access per tier (each tier includes everything from the one below).
const TIER_PLATFORMS = {
  basic: ['facebook', 'instagram'],
  standard: ['facebook', 'instagram', 'gdn', 'pinterest'],
  platinum: ['facebook', 'instagram', 'gdn', 'pinterest', 'youtube', 'google', 'native'],
  palladium: ['facebook', 'instagram', 'gdn', 'pinterest', 'youtube', 'google', 'native', 'linkedin', 'tiktok', 'quora', 'reddit'],
};

const TIER_COMPETITOR_LIMITS = {
  basic: { brandLimit: 1, competitorLimit: 7 },
  standard: { brandLimit: 5, competitorLimit: 35 },
  platinum: { brandLimit: 10, competitorLimit: 70 },
  palladium: { brandLimit: 30, competitorLimit: 210 },
};

const TIER_LABEL = { basic: 'Basic', standard: 'Standard', platinum: 'Platinum', palladium: 'Palladium' };

// Filter docs gated to Standard+ (all tiers except basic).
const STANDARD_PLUS_FILTERS = ['gender', 'age', 'ad_type', 'ad_position', 'ad_sub_position', 'ad_tracker'];
// Filter docs gated to Platinum+ (platinum, palladium only).
const PLATINUM_PLUS_FILTERS = ['affiliate_network', 'marketing_platform', 'traffic_source', 'ecommerce_platform', 'funnel', 'ad_budget_sort'];
// Filter docs open to all 4 tiers (core search/sort filters).
// project_access is here too — every 2026 tier has a real, nonzero brandLimit/
// competitorLimit (TIER_COMPETITOR_LIMITS above), so every tier should be able to
// open the "All Projects" section, matching the legacy rule (any plan with real
// competitor limits gets project access — see seedProjectAccess.js's
// PROJECT_ACCESS_PLAN_IDS comment). Missing this made canAccessProjects false for
// every 2026-tier plan including Palladium — confirmed 2026-07-14.
const ALL_TIER_FILTERS = [
  'keyword_search', 'domain_search', 'advertiser_search', 'country',
  'call_to_action', 'category', 'likes_sort', 'comments_sort', 'shares_sort',
  'impression_sort', 'popularity_sort', 'views_sort', 'project_access',
];

/**
 * Reads config.pricing.planIds and returns { basic, basicYearly, standard, ... }.
 * Returns null for any slot that isn't configured (caller must handle gracefully —
 * an unconfigured slot means that tier/period simply isn't live in this environment).
 */
function getPlanIds() {
  const raw = config.pricing?.planIds || {};
  const ids = {};
  for (const tier of TIERS) {
    ids[tier] = Number.isFinite(raw[tier]) ? raw[tier] : null;
    const yearlyKey = `${tier}Yearly`;
    ids[yearlyKey] = Number.isFinite(raw[yearlyKey]) ? raw[yearlyKey] : null;
  }
  return ids;
}

function billingEntry(tier, isYearly) {
  return {
    tier: TIER_LABEL[tier],
    billingType: isYearly ? 'yearly' : 'trial',
    cycle: isYearly ? 'annual' : 'monthly',
    duration: isYearly ? '365 days' : '3 days',
    yearPlan: isYearly,
    legacy: false,
    pricingGeneration: '2026-restructure',
  };
}

/**
 * Builds "contribution docs" — partial documents containing ONLY the 2026-tier
 * additions, in the exact same shape as plan_config.json entries, keyed the same
 * way (_id). Callers merge these onto the base legacy config (see mergeContributions).
 * IDs that aren't configured (null) are skipped entirely — nothing is written for
 * a tier/period this environment hasn't assigned a plan ID to yet.
 */
function getContributionDocs() {
  const ids = getPlanIds();
  const allConfiguredIds = TIERS.flatMap((t) => [ids[t], ids[`${t}Yearly`]]).filter((id) => id !== null);
  if (allConfiguredIds.length === 0) return [];

  const docs = [];

  // ── platform_access ──────────────────────────────────────────────────────
  const platformPlans = {};
  for (const tier of TIERS) {
    for (const platform of TIER_PLATFORMS[tier]) {
      platformPlans[platform] = platformPlans[platform] || [];
      if (ids[tier] !== null) platformPlans[platform].push(ids[tier]);
      if (ids[`${tier}Yearly`] !== null) platformPlans[platform].push(ids[`${tier}Yearly`]);
    }
  }
  docs.push({ _id: 'platform_access', platform_plans: platformPlans });

  // ── competitor_limits ─────────────────────────────────────────────────────
  const planLimits = {};
  for (const tier of TIERS) {
    if (ids[tier] !== null) planLimits[ids[tier]] = TIER_COMPETITOR_LIMITS[tier];
    if (ids[`${tier}Yearly`] !== null) planLimits[ids[`${tier}Yearly`]] = TIER_COMPETITOR_LIMITS[tier];
  }
  docs.push({ _id: 'competitor_limits', plan_limits: planLimits });

  // ── plan_billing_metadata ────────────────────────────────────────────────
  const planInfo = {};
  for (const tier of TIERS) {
    if (ids[tier] !== null) planInfo[ids[tier]] = billingEntry(tier, false);
    if (ids[`${tier}Yearly`] !== null) planInfo[ids[`${tier}Yearly`]] = billingEntry(tier, true);
  }
  docs.push({ _id: 'plan_billing_metadata', plan_info: planInfo });

  // ── filter docs (allowed_plan_ids additions) ────────────────────────────
  function idsForTiers(tiers) {
    const out = [];
    for (const tier of tiers) {
      if (ids[tier] !== null) out.push(ids[tier]);
      if (ids[`${tier}Yearly`] !== null) out.push(ids[`${tier}Yearly`]);
    }
    return out;
  }
  for (const filterId of ALL_TIER_FILTERS) {
    docs.push({ _id: filterId, allowed_plan_ids: idsForTiers(TIERS) });
  }
  for (const filterId of STANDARD_PLUS_FILTERS) {
    docs.push({ _id: filterId, allowed_plan_ids: idsForTiers(['standard', 'platinum', 'palladium']) });
  }
  for (const filterId of PLATINUM_PLUS_FILTERS) {
    docs.push({ _id: filterId, allowed_plan_ids: idsForTiers(['platinum', 'palladium']) });
  }

  return docs;
}

/**
 * Builds the 4 "(2026)" plan_groups entries (Basic (2026), Standard (2026), ...),
 * each holding whichever of its monthly/yearly IDs are actually configured. Skips
 * a group entirely if neither its monthly nor yearly ID is configured.
 *
 * The map KEY keeps the "(2026)" suffix — required so it never collides with the
 * legacy same-named group in the same `groups` map (resolvePlanTier() returns this
 * key verbatim, and the legacy "Basic" key already has real subscribers on it).
 * `label` is the plain tier name ("Basic", not "Basic (2026)") — every consumer
 * EXCEPT the admin panel (which reads/displays the group key directly, precisely
 * so an admin can tell the two generations apart) should show `label`, not the key.
 */
function getPlanGroups() {
  const ids = getPlanIds();
  const colors = { basic: '#4f46e5', standard: '#2563eb', platinum: '#dc2626', palladium: '#059669' };
  const groups = {};
  for (const tier of TIERS) {
    const plans = [ids[tier], ids[`${tier}Yearly`]].filter((id) => id !== null);
    if (plans.length === 0) continue;
    groups[`${TIER_LABEL[tier]} (2026)`] = {
      color: colors[tier],
      openForNewSignups: true,
      plans,
      label: TIER_LABEL[tier],
      ...(tier === 'palladium' ? { topTier: true } : {}),
    };
  }
  return groups;
}

/**
 * Merges contribution docs onto a base doc array (e.g. plan_config.json's parsed
 * content). Same-shaped merge as planAccessMigrate.js's live-DB logic: arrays
 * concat+dedupe, plan-id-keyed maps merge key-by-key (base doc's existing keys win
 * on conflict — contributions only fill in the 2026-tier keys, which never
 * pre-exist in the base legacy data).
 */
/**
 * Deep-merges `source` onto `target`: array leaves concat+dedupe (e.g.
 * platform_plans.facebook), nested objects recurse (e.g. plan_limits.101),
 * primitives are set. Critically, this must recurse into nested objects rather
 * than shallow-spread them — a shallow `{...target, ...source}` on
 * platform_plans would silently REPLACE target.platform_plans.facebook's entire
 * legacy array with source's much shorter array instead of adding to it.
 */
function deepMergeConcat(target, source) {
  const result = { ...(target || {}) };
  for (const [k, v] of Object.entries(source || {})) {
    if (Array.isArray(v)) {
      const existing = Array.isArray(result[k]) ? result[k] : [];
      result[k] = [...new Set([...existing, ...v])];
    } else if (v && typeof v === 'object') {
      result[k] = deepMergeConcat(result[k], v);
    } else {
      result[k] = v;
    }
  }
  return result;
}

function mergeContributions(baseDocs) {
  const contributions = getContributionDocs();
  if (contributions.length === 0) return baseDocs;

  const merged = baseDocs.map((d) => ({ ...d }));
  for (const contrib of contributions) {
    const target = merged.find((d) => d._id === contrib._id);
    if (!target) {
      merged.push(contrib);
      continue;
    }
    const idx = merged.indexOf(target);
    merged[idx] = deepMergeConcat(target, contrib);
  }
  return merged;
}

module.exports = {
  getPlanIds,
  getContributionDocs,
  getPlanGroups,
  mergeContributions,
};
