'use strict';

/**
 * Plan Identity Resolver — maps a numeric plan ID to its family, generation,
 * billing variant, and tier rank.
 *
 * Replaces the scattered plan-ID lookups in planAccessService.resolvePlanTier(),
 * restructure2026.getPlanGroups(), and planAccessSeed.DEFAULT_PLAN_GROUPS.
 *
 * See docs/PLAN_CONTROL_REVAMP_PLAN.md §5 — Plan identity resolver.
 */

const { getPlanFamilies } = require('./planFamilies');

// ─── Lookup cache (rebuilt when plan families change) ───────────────────────

let _planIdMap = null;
let _familiesSnapshot = null;

/**
 * @typedef {Object} PlanIdentity
 * @property {string} familyId
 * @property {string} label         - Customer-facing family label
 * @property {string} adminLabel    - Admin-visible family label
 * @property {string} generation
 * @property {string} billingCycle  - 'monthly', 'yearly', 'trial', 'legacy', 'custom', 'platform'
 * @property {string} billingProvider
 * @property {number} tierRank
 * @property {string} status        - Family status: 'active', 'legacy', 'deleted', 'custom'
 * @property {boolean} openForNewSignups
 */

/**
 * Build or refresh the plan-ID → identity lookup map.
 * Uses the plan families as the single source.
 */
function normalizeSnapshot(policy) {
  return policy?.snapshot || policy || {};
}

function getFamilies(policy) {
  const snapshot = normalizeSnapshot(policy);
  return Array.isArray(snapshot.planFamilies) && snapshot.planFamilies.length
    ? snapshot.planFamilies
    : getPlanFamilies();
}

function buildMap(families) {
  const map = new Map();
  // A billing ID collision is invalid. Keeping the first definition here makes
  // runtime resolution deterministic; policy validation blocks publishing it.
  for (const family of families) {
    for (const variant of family.variants || []) {
      const planId = Number(variant.planId);
      if (!Number.isInteger(planId) || planId <= 0 || map.has(planId)) continue;
      map.set(planId, {
        planId,
        familyId: family.familyId,
        label: family.label,
        customerLabel: family.label,
        adminLabel: family.adminLabel,
        generation: family.generation,
        billingCycle: variant.billingCycle,
        billingProvider: variant.billingProvider,
        tierRank: family.tierRank,
        status: variant.status || family.status,
        openForNewSignups: family.openForNewSignups,
      });
    }
  }
  return map;
}

function ensureMap() {
  const families = getPlanFamilies();
  // Only rebuild if the families array reference changed
  if (_planIdMap && _familiesSnapshot === families) return _planIdMap;

  const map = buildMap(families);

  _planIdMap = map;
  _familiesSnapshot = families;
  return map;
}

// ─── Public API ─────────────────────────────────────────────────────────────

/**
 * Resolve a numeric plan ID to a full plan identity.
 *
 * @param {number|string} planId - The billing/aMember plan ID
 * @returns {PlanIdentity|null} Resolved identity or null if unknown
 */
function resolvePlanIdentity(planId, policySnapshot) {
  const pid = Number(planId);
  if (!Number.isFinite(pid) || pid <= 0) return null;

  const map = policySnapshot ? buildMap(getFamilies(policySnapshot)) : ensureMap();
  return map.get(pid) || null;
}

function resolveBillingVariant(planId, policySnapshot) {
  const identity = resolvePlanIdentity(planId, policySnapshot);
  if (!identity) return null;
  return {
    planId: identity.planId,
    billingCycle: identity.billingCycle,
    billingProvider: identity.billingProvider,
    familyId: identity.familyId,
  };
}

/**
 * Get the family ID for a plan ID (shorthand).
 * @param {number|string} planId
 * @returns {string|null}
 */
function getFamilyIdForPlan(planId) {
  const identity = resolvePlanIdentity(planId);
  return identity ? identity.familyId : null;
}

/**
 * Get the tier rank for a plan ID (shorthand).
 * @param {number|string} planId
 * @returns {number|null}
 */
function getTierRank(planId) {
  const identity = resolvePlanIdentity(planId);
  return identity ? identity.tierRank : null;
}

/**
 * Get the generation for a plan ID (shorthand).
 * @param {number|string} planId
 * @returns {string|null}
 */
function getGeneration(planId) {
  const identity = resolvePlanIdentity(planId);
  return identity ? identity.generation : null;
}

/**
 * Check if a plan ID is known (exists in any family).
 * @param {number|string} planId
 * @returns {boolean}
 */
function isKnownPlanId(planId) {
  return resolvePlanIdentity(planId) !== null;
}

/**
 * Get all known plan IDs across all families.
 * @returns {number[]}
 */
function getAllKnownPlanIds() {
  const map = ensureMap();
  return [...map.keys()];
}

/**
 * Find all plan IDs belonging to a given family.
 * @param {string} familyId
 * @returns {number[]}
 */
function getPlanIdsForFamily(familyId) {
  const families = getPlanFamilies();
  const family = families.find((f) => f.familyId === familyId);
  if (!family) return [];
  return family.variants
    .filter((v) => v.planId !== null && v.planId !== undefined)
    .map((v) => v.planId);
}

/**
 * Check if a plan is a custom plan (custom invoice/JWT boundaries apply).
 * @param {number|string} planId
 * @returns {boolean}
 */
function isCustomPlan(planId) {
  const identity = resolvePlanIdentity(planId);
  return identity ? identity.status === 'custom' : false;
}

/**
 * Check if a plan is soft-deleted.
 * Currently delegates to checking the family status and can be extended
 * to also check a runtime deleted-plans list from MongoDB.
 * @param {number|string} planId
 * @param {Object} [runtimeConfig] - Optional runtime config with deleted_plan_ids
 * @returns {boolean}
 */
function isPlanDeleted(planId, runtimeConfig) {
  const identity = resolvePlanIdentity(planId);
  if (identity && identity.status === 'deleted') return true;

  // Also check runtime MongoDB-sourced deleted_plan_ids if provided
  if (runtimeConfig && Array.isArray(runtimeConfig.deleted_plan_ids)) {
    return runtimeConfig.deleted_plan_ids.some((d) => d.plan_id === Number(planId));
  }

  return false;
}

/**
 * Force the resolver to rebuild its lookup map (e.g. after config reload).
 */
function invalidateResolver() {
  _planIdMap = null;
  _familiesSnapshot = null;
}

module.exports = {
  resolvePlanIdentity,
  resolveBillingVariant,
  getFamilyIdForPlan,
  getTierRank,
  getGeneration,
  isKnownPlanId,
  getAllKnownPlanIds,
  getPlanIdsForFamily,
  isCustomPlan,
  isPlanDeleted,
  invalidateResolver,
};
