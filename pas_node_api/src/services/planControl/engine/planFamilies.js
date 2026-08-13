'use strict';

/**
 * Plan Families — defines all plan families and their billing variants.
 *
 * A plan family represents one entitlement product independent of billing cycle.
 * Monthly and yearly IDs are variants inside the same family and inherit the same
 * policy by default.
 *
 * See docs/PLAN_CONTROL_REVAMP_PLAN.md §6.1 — Plan family.
 *
 * The 2026 tier IDs are loaded from config.pricing.planIds (never hardcoded),
 * matching the existing pattern in restructure2026.js. Legacy IDs are hardcoded
 * because those plan IDs are permanently fixed (they're in aMember's historical DB).
 */

const config = require('../../../config');

// ─── Generations ────────────────────────────────────────────────────────────

/**
 * @typedef {Object} PlanGeneration
 * @property {string} generationId
 * @property {string} adminLabel
 * @property {string} customerLabel
 * @property {'active'|'legacy'|'draft'|'archived'} status
 * @property {string} newCapabilityDefault - 'needs_review' (temporarily allow + queue) or 'deny'
 */

/** @type {PlanGeneration[]} */
const GENERATIONS = [
  {
    generationId: 'legacy',
    adminLabel: 'Legacy Plans',
    customerLabel: 'Legacy Plans',
    status: 'legacy',
    newCapabilityDefault: 'needs_review',
  },
  {
    generationId: '2026-restructure',
    adminLabel: '2026 Current Plans',
    customerLabel: 'Current Plans',
    status: 'active',
    newCapabilityDefault: 'needs_review',
  },
];

// ─── Plan family definitions ────────────────────────────────────────────────

/**
 * @typedef {Object} BillingVariant
 * @property {number|null} planId       - Numeric billing/aMember plan ID
 * @property {'monthly'|'yearly'|'trial'|'legacy'|'platform'|'custom'} billingCycle
 * @property {string} billingProvider   - 'amember' or 'sql'
 */

/**
 * @typedef {Object} PlanFamily
 * @property {string} familyId          - Stable entitlement identity (e.g. 'basic-2026')
 * @property {string} label             - Customer-facing label
 * @property {string} adminLabel        - Admin-visible label (distinguishes generations)
 * @property {string} generation        - Which generation this family belongs to
 * @property {number} tierRank          - Numeric rank for ordering (higher = more access)
 * @property {'active'|'legacy'|'deleted'|'custom'} status
 * @property {boolean} openForNewSignups
 * @property {BillingVariant[]} variants
 */

/**
 * Build the 2026 restructure families dynamically from config.pricing.planIds.
 * This mirrors restructure2026.js's getPlanIds() — the IDs are ONLY from config.
 */
function get2026PlanIds() {
  const raw = config.pricing?.planIds || {};
  const list = (value) => {
    const values = Array.isArray(value) ? value : [value];
    return [...new Set(values.map(Number).filter((id) => Number.isInteger(id) && id > 0))];
  };
  return {
    basic: list(raw.basic),
    basicYearly: list(raw.basicYearly),
    standard: list(raw.standard),
    standardYearly: list(raw.standardYearly),
    platinum: list(raw.platinum),
    platinumYearly: list(raw.platinumYearly),
    palladium: list(raw.palladium),
    palladiumYearly: list(raw.palladiumYearly),
  };
}

/**
 * Build all plan family definitions.
 * Combines hardcoded legacy families with config-driven 2026 families.
 * @returns {PlanFamily[]}
 */
function buildPlanFamilies() {
  const ids2026 = get2026PlanIds();

  /** @type {PlanFamily[]} */
  const families = [];

  // ─── Legacy families (plan IDs are historically fixed) ───────────────────

  families.push({
    familyId: 'free',
    label: 'Free',
    adminLabel: 'Free',
    generation: 'legacy',
    tierRank: 0,
    status: 'active',
    openForNewSignups: true,
    variants: [
      { planId: 20, billingCycle: 'monthly', billingProvider: 'amember' },
    ],
  });

  families.push({
    familyId: 'basic-legacy',
    label: 'Basic',
    adminLabel: 'Basic (Legacy)',
    generation: 'legacy',
    tierRank: 10,
    status: 'legacy',
    openForNewSignups: false,
    variants: [
      // Trial monthly
      { planId: 52, billingCycle: 'trial', billingProvider: 'amember' },
      // Non-trial monthly
      { planId: 59, billingCycle: 'monthly', billingProvider: 'amember' },
      // Yearly
      { planId: 64, billingCycle: 'yearly', billingProvider: 'amember' },
      // 1-year legacy
      { planId: 25, billingCycle: 'yearly', billingProvider: 'amember' },
      // Old legacy monthly IDs
      ...[2, 5, 9, 14, 15, 40].map((id) => ({
        planId: id, billingCycle: 'legacy', billingProvider: 'amember',
      })),
    ],
  });

  families.push({
    familyId: 'standard-legacy',
    label: 'Standard',
    adminLabel: 'Standard (Legacy)',
    generation: 'legacy',
    tierRank: 20,
    status: 'legacy',
    openForNewSignups: false,
    variants: [
      { planId: 53, billingCycle: 'trial', billingProvider: 'amember' },
      { planId: 58, billingCycle: 'monthly', billingProvider: 'amember' },
      { planId: 65, billingCycle: 'yearly', billingProvider: 'amember' },
      { planId: 26, billingCycle: 'yearly', billingProvider: 'amember' },
      ...[3, 6, 10, 13, 16, 41].map((id) => ({
        planId: id, billingCycle: 'legacy', billingProvider: 'amember',
      })),
    ],
  });

  families.push({
    familyId: 'premium-legacy',
    label: 'Premium',
    adminLabel: 'Premium (Legacy)',
    generation: 'legacy',
    tierRank: 30,
    status: 'legacy',
    openForNewSignups: false,
    variants: [
      { planId: 54, billingCycle: 'trial', billingProvider: 'amember' },
      { planId: 60, billingCycle: 'monthly', billingProvider: 'amember' },
      { planId: 66, billingCycle: 'yearly', billingProvider: 'amember' },
      { planId: 27, billingCycle: 'yearly', billingProvider: 'amember' },
      ...[4, 7, 11, 12, 17, 19, 42].map((id) => ({
        planId: id, billingCycle: 'legacy', billingProvider: 'amember',
      })),
    ],
  });

  families.push({
    familyId: 'platinum-legacy',
    label: 'Platinum',
    adminLabel: 'Platinum (Legacy)',
    generation: 'legacy',
    tierRank: 40,
    status: 'legacy',
    openForNewSignups: false,
    variants: [
      { planId: 55, billingCycle: 'trial', billingProvider: 'amember' },
      { planId: 61, billingCycle: 'monthly', billingProvider: 'amember' },
      { planId: 67, billingCycle: 'yearly', billingProvider: 'amember' },
      { planId: 28, billingCycle: 'yearly', billingProvider: 'amember' },
      ...[22, 34, 23, 24, 37, 43].map((id) => ({
        planId: id, billingCycle: 'legacy', billingProvider: 'amember',
      })),
    ],
  });

  families.push({
    familyId: 'titanium-legacy',
    label: 'Titanium',
    adminLabel: 'Titanium (Legacy)',
    generation: 'legacy',
    tierRank: 50,
    status: 'legacy',
    openForNewSignups: false,
    variants: [
      { planId: 56, billingCycle: 'trial', billingProvider: 'amember' },
      { planId: 62, billingCycle: 'monthly', billingProvider: 'amember' },
      { planId: 68, billingCycle: 'yearly', billingProvider: 'amember' },
      ...[29, 35, 44, 31].map((id) => ({
        planId: id, billingCycle: 'legacy', billingProvider: 'amember',
      })),
    ],
  });

  families.push({
    familyId: 'palladium-legacy',
    label: 'Palladium',
    adminLabel: 'Palladium (Legacy)',
    generation: 'legacy',
    tierRank: 60,
    status: 'legacy',
    openForNewSignups: false,
    variants: [
      { planId: 57, billingCycle: 'trial', billingProvider: 'amember' },
      { planId: 63, billingCycle: 'monthly', billingProvider: 'amember' },
      { planId: 69, billingCycle: 'yearly', billingProvider: 'amember' },
      ...[32, 36, 30, 39, 45].map((id) => ({
        planId: id, billingCycle: 'legacy', billingProvider: 'amember',
      })),
    ],
  });

  families.push({
    familyId: 'custom',
    label: 'Custom',
    adminLabel: 'Custom (Sales-negotiated)',
    generation: 'legacy',
    tierRank: 55, // Between Titanium and Palladium — custom plans vary
    status: 'custom',
    openForNewSignups: true,
    variants: [
      { planId: 33, billingCycle: 'custom', billingProvider: 'amember' },
      { planId: 46, billingCycle: 'custom', billingProvider: 'amember' },
      { planId: 70, billingCycle: 'custom', billingProvider: 'amember' },
    ],
  });

  families.push({
    familyId: 'enterprise',
    label: 'Enterprise',
    adminLabel: 'Enterprise',
    generation: 'legacy',
    tierRank: 65, // Top legacy
    status: 'active',
    openForNewSignups: false,
    variants: [
      { planId: 71, billingCycle: 'custom', billingProvider: 'amember' },
    ],
  });

  // ─── 2026 restructure families (IDs from config) ────────────────────────

  function add2026Family(key, label, tierRank) {
    const monthly = ids2026[key];
    const yearly = ids2026[`${key}Yearly`];
    if (monthly.length === 0 && yearly.length === 0) return; // Not configured in this env
    const variants = [
      ...monthly.map((planId) => ({ planId, billingCycle: 'monthly', billingProvider: 'amember' })),
      ...yearly.map((planId) => ({ planId, billingCycle: 'yearly', billingProvider: 'amember' })),
    ];
    families.push({
      familyId: `${key}-2026`,
      label,
      adminLabel: `${label} (2026)`,
      generation: '2026-restructure',
      tierRank,
      status: 'active',
      openForNewSignups: true,
      variants,
    });
  }

  add2026Family('basic', 'Basic', 10);
  add2026Family('standard', 'Standard', 20);
  add2026Family('platinum', 'Platinum', 40);
  add2026Family('palladium', 'Palladium', 60);

  return families;
}

// ─── Cached instance ────────────────────────────────────────────────────────

let _families = null;
let _planIdsSignature = null;

/**
 * Get all plan families (cached after first call).
 * @returns {PlanFamily[]}
 */
function getPlanFamilies() {
  const signature = JSON.stringify(config.pricing?.planIds || {});
  if (!_families || _planIdsSignature !== signature) {
    _families = buildPlanFamilies();
    _planIdsSignature = signature;
  }
  return _families;
}

/**
 * Force rebuild (e.g. after config reload).
 */
function invalidatePlanFamilies() {
  _families = null;
  _planIdsSignature = null;
}

/**
 * Overlay config-defined 2026 billing variants onto a stored policy snapshot's
 * families without changing any policy, network, feature, or limit setting.
 * This lets a newly configured aMember product ID immediately resolve to the
 * existing family policy and appear in Admin UI; publishing remains explicit.
 */
function withConfiguredPlanVariants(planFamilies) {
  const source = Array.isArray(planFamilies) ? planFamilies : [];
  const configured = getPlanFamilies().filter((family) => family.generation === '2026-restructure');
  const configuredIds = new Set(configured.flatMap((family) => (
    family.variants || []
  )).map((variant) => Number(variant.planId)));

  const result = source.map((family) => ({
    ...family,
    variants: (family.variants || []).filter(
      (variant) => !configuredIds.has(Number(variant.planId))
    ).map((variant) => ({ ...variant })),
  }));

  for (const expected of configured) {
    const index = result.findIndex((family) => family.familyId === expected.familyId);
    if (index < 0) {
      result.push({
        ...expected,
        variants: expected.variants.map((variant) => ({ ...variant, verified: true })),
      });
      continue;
    }
    result[index] = {
      ...result[index],
      variants: [
        ...result[index].variants,
        ...expected.variants.map((variant) => ({ ...variant, verified: true })),
      ],
    };
  }
  return result;
}

/**
 * Get a single family by familyId.
 * @param {string} familyId
 * @returns {PlanFamily|null}
 */
function getFamilyById(familyId) {
  return getPlanFamilies().find((f) => f.familyId === familyId) || null;
}

/**
 * Get all families for a specific generation.
 * @param {string} generationId
 * @returns {PlanFamily[]}
 */
function getFamiliesByGeneration(generationId) {
  return getPlanFamilies().filter((f) => f.generation === generationId);
}

module.exports = {
  GENERATIONS,
  get2026PlanIds,
  buildPlanFamilies,
  getPlanFamilies,
  invalidatePlanFamilies,
  withConfiguredPlanVariants,
  getFamilyById,
  getFamiliesByGeneration,
};
