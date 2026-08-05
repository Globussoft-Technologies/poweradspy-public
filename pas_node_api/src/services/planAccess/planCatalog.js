'use strict';

/**
 * Display-only plan catalog for the frontend upgrade/pricing modal (PricingModal.jsx).
 *
 * This is DELIBERATELY separate from plan_access_config (the entitlement engine) —
 * plan_access_config has no price/marketing-copy fields, and its filter-doc granularity
 * doesn't map 1:1 onto this feature checklist (some rows here, like "Project" or
 * "Data interval search", aren't plan_access filter docs at all). Hand-authored here,
 * same as the legacy data already was — this only makes it config-driven and served
 * from one place instead of hardcoded in React.
 *
 * `tier` on each entry matches exactly what planAccessService.resolvePlanTier() returns
 * for that plan's group, so the frontend can match a logged-in user's current tier by
 * simple string equality regardless of which generation is active.
 *
 * See docs/PLAN_ACCESS.md § 2026 Pricing Restructure.
 */

const FEATURES = [
  'Networks',
  'Keyword search',
  'Advertiser search',
  'Domain search',
  'Estimated Ad Budget',
  'Project',
  'Ad Category',
  'Call to action',
  'Country',
  'Ad Type',
  'Gender Wise',
  'Engagement',
  'Audience Age',
  'Advanced Ad Analytics',
  'Ad Position',
  'Ad Running Days',
  'Traffic Source',
  'Popularity and Impressions Sort',
  'Affiliate Network',
  'E-commerce platform',
  'Marketing Platform',
  'Funnel',
  'Data interval search',
  'Favourite and Hidden',
  // Both currently in BETA — free for every plan on every generation while in beta
  // (Market Trends: docs/PLAN_ACCESS.md § "Market Trends beta→GA", plan_access_config's
  // `market_trends` filter doc, stage: "beta". Keyword Explorer: config.keywordExplorer,
  // still allowedUserIds-gated, not plan-tier — see the "Explicitly not covered" note).
  // When either goes GA, update its `true` below per-tier to match the real gate.
  'Market Trends',
  'Keyword Explorer',
];

// ─── Legacy generation (pre-2026, still serving existing subscribers) ────────────
// `label` === `tier` here (no generation suffix to strip on the legacy names).
const LEGACY_PLANS = [
  {
    tier: 'Basic', label: 'Basic', generation: 'legacy', price: '$69/Month',
    platforms: ['Facebook', 'Instagram', 'Google', 'YouTube'],
    features: [true, true, true, false, false, true, true, true, false, false, true, false, false, false, false, false, true, false, false, false, false, true, true, true, true],
  },
  {
    tier: 'Standard', label: 'Standard', generation: 'legacy', price: '$129/Month',
    platforms: ['Facebook', 'Instagram', 'Pinterest', 'LinkedIn'],
    features: [true, true, true, false, false, true, true, true, true, true, true, true, true, true, true, false, true, false, false, false, false, true, true, true, true],
  },
  {
    tier: 'Premium', label: 'Premium', generation: 'legacy', price: '$179/Month',
    platforms: ['Facebook', 'Instagram', 'YouTube', 'Pinterest', 'LinkedIn', 'TikTok'],
    features: [true, true, true, false, false, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true, true],
  },
  {
    tier: 'Platinum', label: 'Platinum', generation: 'legacy', price: '$279/Month',
    platforms: ['Facebook', 'Instagram', 'Google', 'YouTube', 'Pinterest', 'LinkedIn', 'TikTok'],
    features: Array(25).fill(true),
  },
  {
    tier: 'Titanium', label: 'Titanium', generation: 'legacy', price: '$349/Month',
    platforms: ['Facebook', 'Instagram', 'Google', 'YouTube', 'Native', 'Pinterest', 'LinkedIn', 'TikTok'],
    features: Array(25).fill(true),
  },
  {
    tier: 'Palladium', label: 'Palladium', generation: 'legacy', price: '$399/Month',
    platforms: ['Facebook', 'Instagram', 'Google', 'YouTube', 'Reddit', 'Native', 'GDN', 'Pinterest', 'LinkedIn', 'Quora', 'TikTok'],
    features: Array(25).fill(true),
  },
];

// ─── 2026 pricing restructure — tier labels match plan_groups keys exactly ───────
// Feature flags derived from the PRD §2 entitlement table:
//   index: 1 KeywordSearch 2 AdvertiserSearch 3 DomainSearch 4 EstimatedAdBudget
//   5 Project 6 AdCategory 7 CTA 8 Country 9 AdType 10 GenderWise 11 Engagement
//   12 AudienceAge 13 AdvancedAdAnalytics 14 AdPosition 15 AdRunningDays
//   16 TrafficSource 17 PopularityImpressions 18 AffiliateNetwork 19 Ecommerce
//   20 MarketingPlatform 21 Funnel 22 DataIntervalSearch 23 FavouriteHidden
// Core filters (1,2,3,6,7,8,15,17,22,23) + Advanced Ad Analytics (13, flat per FR-4)
// + Project/Engagement (5,11, not tier-gated in the PRD) are ✓ on all 4 tiers.
// Targeting filters (9,10,12,14) are Standard+. Estimated Ad Budget (4) and the
// device/affiliate/ecomm/marketing/funnel group (16,18,19,20,21) are Platinum+.
// `tier` here MUST match the plan_groups map key exactly ("X (2026)") — that key
// is what resolvePlanTier() returns (see restructure2026.js's getPlanGroups), and
// PricingModal.jsx matches a logged-in user's current plan by comparing against
// this exact string. `label` is the plain PRD name actually shown in the UI (the
// "(2026)" suffix exists purely so this generation's plan_groups key never
// collides with the identically-named legacy group — it is not user-facing).
const RESTRUCTURE_2026_PLANS = [
  {
    tier: 'Basic (2026)', label: 'Basic', generation: '2026-restructure', price: '$69/Month',
    platforms: ['Facebook', 'Instagram'],
    features: [true, true, true, false, true, true, true, true, false, false, true, false, true, false, true, false, true, false, false, false, false, true, true, true, true],
  },
  {
    tier: 'Standard (2026)', label: 'Standard', generation: '2026-restructure', price: '$129/Month',
    platforms: ['Facebook', 'Instagram', 'Pinterest', 'GDN'],
    features: [true, true, true, false, true, true, true, true, true, true, true, true, true, true, true, false, true, false, false, false, false, true, true, true, true],
  },
  {
    tier: 'Platinum (2026)', label: 'Platinum', generation: '2026-restructure', price: '$279/Month',
    platforms: ['Facebook', 'Instagram', 'Pinterest', 'GDN', 'YouTube', 'Native', 'Google'],
    features: Array(25).fill(true),
  },
  {
    tier: 'Palladium (2026)', label: 'Palladium', generation: '2026-restructure', price: '$399/Month',
    platforms: ['Facebook', 'Instagram', 'Pinterest', 'GDN', 'YouTube', 'Native', 'Google', 'LinkedIn', 'TikTok', 'Quora', 'Reddit'],
    features: Array(25).fill(true),
  },
];

const CATALOGS = {
  legacy: LEGACY_PLANS,
  '2026-restructure': RESTRUCTURE_2026_PLANS,
  both: [...LEGACY_PLANS, ...RESTRUCTURE_2026_PLANS],
};

/**
 * @param {string} generation - one of 'legacy' | '2026-restructure' | 'both'
 * @returns {{ features: string[], plans: object[] }}
 */
function getCatalog(generation) {
  const plans = CATALOGS[generation] || CATALOGS['2026-restructure'];
  return { features: FEATURES, plans };
}

module.exports = { FEATURES, LEGACY_PLANS, RESTRUCTURE_2026_PLANS, getCatalog };
