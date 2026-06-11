'use strict';

/**
 * Plan access config — used as in-memory static config (no DB reads).
 * Edit this file to update plan restrictions, then redeploy.
 *
 * Previously this was a seed script for plan_access_config collection.
 * Now the data is used directly from memory by planAccessService.js.
 */

// [DEPRECATED] DB no longer needed — plan access is read from this file directly
// const { getDB, closeDB } = require('../sdui/db');

// ─── Load plan config from JSON file ──────────────────────────────────────────

let _planConfig = null;
try {
  _planConfig = require('./plan_config.json');
} catch (err) {
  console.warn('Failed to load plan_config.json:', err.message);
  _planConfig = [];
}

// ─── Plan ID groups (for readability) ─────────────────────────────────────────

const ALL_PLANS = [20,2,5,9,14,15,25,40,59,64,52,58,65,53,60,66,54,61,67,55,62,68,56,63,69,57,
  3,6,10,13,16,26,41,4,7,11,12,17,27,42,
  31,35,29,38,44,32,36,30,39,45,22,34,23,24,28,37,43,33,70,46,71];

const STANDARD_PLUS = [20,58,65,53,60,66,54,61,67,55,62,68,56,63,69,57,
  3,6,10,13,16,26,4,41,7,11,12,17,27,42,
  31,35,29,38,44,32,36,30,39,45,22,34,23,24,28,37,43,33,70,46];

const STANDARD_PLUS_WITH_BASIC = [20,52,58,65,53,60,66,54,61,67,55,62,68,56,63,69,57,
  25,3,6,10,13,16,26,4,41,7,11,12,17,27,42,
  31,35,29,38,44,32,36,30,39,45,22,34,23,24,28,37,43,33,70,46];

const PREMIUM_PLUS = [20,60,66,54,61,67,55,62,68,56,63,69,57,
  4,7,11,12,17,27,42,31,35,29,38,44,32,36,30,39,45,
  22,34,23,24,28,37,43,33,70,46];

const PREMIUM_PLUS_WITH_STD = [20,60,66,54,61,67,55,62,68,56,63,69,57,
  4,7,11,12,17,27,42,31,35,29,38,44,32,36,30,39,45,
  22,34,23,24,28,37,43,58,53,65,3,6,10,13,16,26,41,33,70,46];

const PLATINUM_PLUS_BUDGET = [20,22,23,24,28,30,32,34,36,43,45,55,57,61,63,67,69,29,35,44,56,62,68,31];

// ─── Helper to build platform_support objects ─────────────────────────────────

const ALL_PLATFORMS = ['facebook','instagram','youtube','google','gdn','linkedin','reddit','quora','pinterest','tiktok','native'];

function platformSupport(supported) {
  const obj = {};
  for (const p of ALL_PLATFORMS) {
    obj[p] = supported.includes(p);
  }
  return obj;
}

const ALL_SUPPORTED = platformSupport(ALL_PLATFORMS);
const FB_IG_ONLY = platformSupport(['facebook', 'instagram']);
const FB_IG_GDN = platformSupport(['facebook', 'instagram', 'gdn']);
const FB_IG_GDN_PINTEREST = platformSupport(['facebook', 'instagram', 'gdn', 'pinterest']);
const YT_ONLY = platformSupport(['youtube']);
const GDN_ONLY = platformSupport(['gdn']);
const FB_IG_GDN_LI_PIN = platformSupport(['facebook', 'instagram', 'gdn', 'linkedin', 'pinterest']);

// ─── Seed Documents ──────────────────────────────────────────────────────────

// [UPDATED] Load from plan_config.json instead of hardcoding
const filterDocs = _planConfig.filter(d =>
  !['platform_access', 'competitor_limits', 'plan_billing_metadata'].includes(d._id)
);
const platformAccessDoc = _planConfig.find(d => d._id === 'platform_access') || null;
const competitorLimitsDoc = _planConfig.find(d => d._id === 'competitor_limits') || null;


// ─── Plan Billing Type Metadata ──────────────────────────────────────────────
// Maps each plan ID to its billing type, cycle, and classification
// Ensures no data loss from Laravel migration

const now = new Date().toISOString();

const planBillingMetadata = {
  _id: 'plan_billing_metadata',
  label: 'Plan Billing Metadata',
  category: 'metadata',
  description: 'Billing type, cycle, and classification for each plan',
  plan_info: {
    // ── TRIAL PLANS (Monthly with trial period) ──
    '52': { tier: 'Basic',    billingType: 'trial', cycle: 'monthly', duration: '30 days', yearPlan: false },
    '53': { tier: 'Standard',  billingType: 'trial', cycle: 'monthly', duration: '30 days', yearPlan: false },
    '54': { tier: 'Premium',   billingType: 'trial', cycle: 'monthly', duration: '30 days', yearPlan: false },
    '55': { tier: 'Platinum',  billingType: 'trial', cycle: 'monthly', duration: '30 days', yearPlan: false },
    '56': { tier: 'Titanium',  billingType: 'trial', cycle: 'monthly', duration: '30 days', yearPlan: false },
    '57': { tier: 'Palladium', billingType: 'trial', cycle: 'monthly', duration: '30 days', yearPlan: false },

    // ── NON-TRIAL PLANS (Monthly without trial) ──
    '59': { tier: 'Basic',     billingType: 'non-trial', cycle: 'monthly', duration: 'perpetual', yearPlan: false },
    '58': { tier: 'Standard',  billingType: 'non-trial', cycle: 'monthly', duration: 'perpetual', yearPlan: false },
    '60': { tier: 'Premium',   billingType: 'non-trial', cycle: 'monthly', duration: 'perpetual', yearPlan: false },
    '61': { tier: 'Platinum',  billingType: 'non-trial', cycle: 'monthly', duration: 'perpetual', yearPlan: false },
    '62': { tier: 'Titanium',  billingType: 'non-trial', cycle: 'monthly', duration: 'perpetual', yearPlan: false },
    '63': { tier: 'Palladium', billingType: 'non-trial', cycle: 'monthly', duration: 'perpetual', yearPlan: false },

    // ── YEARLY PLANS ──
    '64': { tier: 'Basic',     billingType: 'yearly', cycle: 'annual', duration: '365 days', yearPlan: true },
    '65': { tier: 'Standard',  billingType: 'yearly', cycle: 'annual', duration: '365 days', yearPlan: true },
    '66': { tier: 'Premium',   billingType: 'yearly', cycle: 'annual', duration: '365 days', yearPlan: true },
    '67': { tier: 'Platinum',  billingType: 'yearly', cycle: 'annual', duration: '365 days', yearPlan: true },
    '68': { tier: 'Titanium',  billingType: 'yearly', cycle: 'annual', duration: '365 days', yearPlan: true },
    '69': { tier: 'Palladium', billingType: 'yearly', cycle: 'annual', duration: '365 days', yearPlan: true },

    // ── 1-YEAR PLANS (Legacy) ──
    '25': { tier: 'Basic',    billingType: 'one_year', cycle: 'annual', duration: '365 days', yearPlan: true, legacy: true },
    '26': { tier: 'Standard', billingType: 'one_year', cycle: 'annual', duration: '365 days', yearPlan: true, legacy: true },
    '27': { tier: 'Premium',  billingType: 'one_year', cycle: 'annual', duration: '365 days', yearPlan: true, legacy: true },
    '28': { tier: 'Platinum', billingType: 'one_year', cycle: 'annual', duration: '365 days', yearPlan: true, legacy: true },
    '29': { tier: 'Native',   billingType: 'one_year', cycle: 'annual', duration: '365 days', yearPlan: true, legacy: true },
    '30': { tier: 'GDN',      billingType: 'one_year', cycle: 'annual', duration: '365 days', yearPlan: true, legacy: true },

    // ── 2-YEAR PLANS (Legacy) — plan IDs 52-57 were reused for trial plans above;
    // these legacy two-year variants were retired. Kept commented for historical reference.
    // '52': { tier: 'Basic',    billingType: 'two_year', cycle: 'biennial', duration: '730 days', yearPlan: true, legacy: true },
    // '53': { tier: 'Standard', billingType: 'two_year', cycle: 'biennial', duration: '730 days', yearPlan: true, legacy: true },
    // '54': { tier: 'Premium',  billingType: 'two_year', cycle: 'biennial', duration: '730 days', yearPlan: true, legacy: true },
    // '55': { tier: 'Platinum', billingType: 'two_year', cycle: 'biennial', duration: '730 days', yearPlan: true, legacy: true },
    // '56': { tier: 'Titanium', billingType: 'two_year', cycle: 'biennial', duration: '730 days', yearPlan: true, legacy: true },
    // '57': { tier: 'Palladium',billingType: 'two_year', cycle: 'biennial', duration: '730 days', yearPlan: true, legacy: true },

    // ── LEGACY BASIC PLANS ──
    '2':  { tier: 'Basic',    billingType: 'legacy', cycle: 'monthly', duration: 'unknown', legacy: true },
    '5':  { tier: 'Basic',    billingType: 'legacy', cycle: 'monthly', duration: 'unknown', legacy: true },
    '9':  { tier: 'Basic',    billingType: 'legacy', cycle: 'monthly', duration: 'unknown', legacy: true },
    '14': { tier: 'Basic',    billingType: 'legacy', cycle: 'monthly', duration: 'unknown', legacy: true },
    '15': { tier: 'Basic',    billingType: 'legacy', cycle: 'monthly', duration: 'unknown', legacy: true },
    '40': { tier: 'Basic',    billingType: 'legacy', cycle: 'monthly', duration: 'unknown', legacy: true },

    // ── LEGACY STANDARD PLANS ──
    '3':  { tier: 'Standard', billingType: 'legacy', cycle: 'monthly', duration: 'unknown', legacy: true },
    '6':  { tier: 'Standard', billingType: 'legacy', cycle: 'monthly', duration: 'unknown', legacy: true },
    '10': { tier: 'Standard', billingType: 'legacy', cycle: 'monthly', duration: 'unknown', legacy: true },
    '13': { tier: 'Standard', billingType: 'legacy', cycle: 'monthly', duration: 'unknown', legacy: true },
    '16': { tier: 'Standard', billingType: 'legacy', cycle: 'monthly', duration: 'unknown', legacy: true },
    '41': { tier: 'Standard', billingType: 'legacy', cycle: 'monthly', duration: 'unknown', legacy: true },

    // ── LEGACY PREMIUM PLANS ──
    '4':  { tier: 'Premium',  billingType: 'legacy', cycle: 'monthly', duration: 'unknown', legacy: true },
    '7':  { tier: 'Premium',  billingType: 'legacy', cycle: 'monthly', duration: 'unknown', legacy: true },
    '11': { tier: 'Premium',  billingType: 'legacy', cycle: 'monthly', duration: 'unknown', legacy: true },
    '12': { tier: 'Premium',  billingType: 'legacy', cycle: 'monthly', duration: 'unknown', legacy: true },
    '17': { tier: 'Premium',  billingType: 'legacy', cycle: 'monthly', duration: 'unknown', legacy: true },
    '19': { tier: 'Premium',  billingType: 'legacy', cycle: 'monthly', duration: 'unknown', legacy: true },
    '42': { tier: 'Premium',  billingType: 'legacy', cycle: 'monthly', duration: 'unknown', legacy: true },

    // ── LEGACY PLATINUM PLANS ──
    '22': { tier: 'Platinum', billingType: 'legacy', cycle: 'monthly', duration: 'unknown', legacy: true },
    '23': { tier: 'Platinum', billingType: 'legacy', cycle: 'monthly', duration: 'unknown', legacy: true },
    '24': { tier: 'Platinum', billingType: 'legacy', cycle: 'monthly', duration: 'unknown', legacy: true },
    '28': { tier: 'Platinum', billingType: 'legacy', cycle: 'monthly', duration: 'unknown', legacy: true },
    '34': { tier: 'Platinum', billingType: 'legacy', cycle: 'monthly', duration: 'unknown', legacy: true },
    '37': { tier: 'Platinum', billingType: 'legacy', cycle: 'monthly', duration: 'unknown', legacy: true },
    '43': { tier: 'Platinum', billingType: 'legacy', cycle: 'monthly', duration: 'unknown', legacy: true },

    // ── PLATFORM-SPECIFIC PLANS ──
    '31': { tier: 'Native',   billingType: 'platform', cycle: 'monthly', duration: 'unknown', legacy: false },
    '32': { tier: 'Native',   billingType: 'platform', cycle: 'monthly', duration: 'unknown', legacy: false },
    '35': { tier: 'Native',   billingType: 'platform', cycle: 'monthly', duration: 'unknown', legacy: false },
    '36': { tier: 'Native',   billingType: 'platform', cycle: 'monthly', duration: 'unknown', legacy: false },
    '38': { tier: 'Native',   billingType: 'platform', cycle: 'monthly', duration: 'unknown', legacy: false },
    '39': { tier: 'Native',   billingType: 'platform', cycle: 'monthly', duration: 'unknown', legacy: false },
    '44': { tier: 'Native',   billingType: 'platform', cycle: 'monthly', duration: 'unknown', legacy: false },
    '45': { tier: 'Native',   billingType: 'platform', cycle: 'monthly', duration: 'unknown', legacy: false },

    '33': { tier: 'GDN',      billingType: 'platform', cycle: 'monthly', duration: 'unknown', legacy: false },
    '46': { tier: 'GDN',      billingType: 'platform', cycle: 'monthly', duration: 'unknown', legacy: false },
    '70': { tier: 'Custom',   billingType: 'custom', cycle: 'custom', duration: 'varies', legacy: false },

    // ── FREE & OTHER PLANS ──
    '20': { tier: 'Free',     billingType: 'free', cycle: 'perpetual', duration: 'unlimited', yearPlan: false },
    '8':  { tier: 'Reward',   billingType: 'reward', cycle: 'perpetual', duration: 'varies', yearPlan: false },
    '71': { tier: 'Enterprise', billingType: 'enterprise', cycle: 'custom', duration: 'varies', legacy: false },
  },
  visible: true, created_at: now, updated_at: now,
};

// [DEPRECATED] Seed function no longer needed — data is used in-memory directly.
// async function seed() {
//   const db = await getDB();
//   const col = db.collection('plan_access_config');
//   const allDocs = [platformAccessDoc, competitorLimitsDoc, planBillingMetadata, ...filterDocs];
//   let inserted = 0, skipped = 0;
//   for (const doc of allDocs) {
//     const existing = await col.findOne({ _id: doc._id });
//     if (existing) { skipped++; console.log(`  SKIP  ${doc._id}`); }
//     else { await col.insertOne(doc); inserted++; console.log(`  INSERT  ${doc._id}`); }
//   }
//   console.log(`\nDone. Inserted: ${inserted}, Skipped: ${skipped}, Total: ${allDocs.length}`);
// }

// if (require.main === module) {
//   seed().then(() => closeDB()).then(() => process.exit(0))
//     .catch(err => { console.error('Seed failed:', err); process.exit(1); });
// }

// ─── Default Plan Groups ─────────────────────────────────────────────────────
// Used only to seed MongoDB on first run via adminRoutes GET /plan-access/config.
// After seeding, all group data is read from / written to MongoDB plan_access_config.
const DEFAULT_PLAN_GROUPS = {
  _id: 'plan_groups',
  groups: {
    Free:      { color: '#94a3b8', plans: [20] },
    Basic:     { color: '#6366f1', plans: [2,5,9,14,15,25,40,49,52,59,64,71] },
    Standard:  { color: '#3b82f6', plans: [58,53,65,3,6,10,13,16,26,41] },
    Premium:   { color: '#f59e0b', plans: [60,54,66,4,7,11,12,17,27,42] },
    Platinum:  { color: '#ef4444', plans: [61,55,67,22,34,23,24,28,37,43] },
    Titanium:  { color: '#8b5cf6', plans: [29,35,44,56,62,68,31] },
    Palladium: { color: '#10b981', plans: [63,57,32,36,30,39,45,69] },
    Custom:    { color: '#f97316', plans: [33,70,46] },
  },
};

module.exports = { filterDocs, platformAccessDoc, competitorLimitsDoc, planBillingMetadata, DEFAULT_PLAN_GROUPS };
