'use strict';

/**
 * GET /api/v1/profile/billing — Billing tab.
 *
 * Plan name/price/features come from the SAME display-only catalog
 * /api/v1/auth/plans-catalog already serves (planAccess/planCatalog.js),
 * matched to the user's actual plan via planAccessService.resolvePlanTier —
 * so this never invents a price the rest of the app doesn't already show.
 *
 * resolvePlanTier() returns whichever tier string matches the user's REAL
 * plan ID, searching both the 2026-restructure groups and the legacy
 * plan_access_config groups (see PLAN_ACCESS.md) — a subscriber can be on
 * either generation independent of which one is "active" for new signups
 * (config.pricing.activePlanGeneration). So the matching catalog entry must
 * be looked up across BOTH LEGACY_PLANS and RESTRUCTURE_2026_PLANS, never
 * just the single "active" generation's catalog — looking in only one
 * generation's list previously showed "No active plan" for any legacy
 * subscriber, which was wrong: they do have one, just in the other catalog.
 * Renewal date / billing cycle come from the JWT's aMember subscription data
 * (already resolved at login, same values plan-access.js and entitlements
 * already expose). Invoices are a live, read-only aMember API call
 * (fetchAmemberInvoices — never writes).
 *
 * "Change plan" / "Cancel plan" / "Update payment method" are NOT wired to
 * real mutations: billing changes must happen in aMember's own checkout/
 * billing flow (this app must never write to aMember, and must never collect
 * card numbers itself). The frontend instead opens aMember's member area in
 * a new tab — memberAreaUrl below is what it links to.
 */

const config = require('../../../config');
const { fetchAmemberInvoices } = require('../../../auth/amemberAuth');
const planAccessService = require('../../planAccess/planAccessService');
const { LEGACY_PLANS, RESTRUCTURE_2026_PLANS } = require('../../planAccess/planCatalog');
const { ok, rejected } = require('../helpers/responses');

// The real aMember member dashboard (confirmed: "Change Password/Edit Profile",
// "Add/Renew Subscription", plans/upgrade — everything lives on this one page)
// — same path amemberAuth.js's own no-valid-subscription redirect already uses.
function memberAreaUrl() {
  const apiUrl = config.amember.apiUrl || '';
  return apiUrl.replace(/\/api\/?$/, '/member/index') || 'https://app.poweradspy.com/amember/member/index';
}

function mapInvoice(inv) {
  // aMember invoice status codes: 0 Not paid, 1 Paid, 2 Refund — same codes
  // fetchCustomPlanPlatforms already reads from the same API (amemberAuth.js).
  const statusCode = Number(inv?.status);
  const status = statusCode === 1 ? 'paid' : statusCode === 2 ? 'refunded' : 'due';
  return {
    id: inv?.invoice_id ?? inv?.invoice_public_id ?? null,
    date: inv?.tm_added || inv?.paysys_date || null,
    amount: inv?.total_cost ?? inv?.first_total ?? null,
    currency: inv?.currency || 'USD',
    status,
  };
}

async function getBilling(req, res) {
  const uid = req.user?.user_id ?? req.user?.id;
  if (!uid) return res.status(401).json(rejected(401, 'Unauthorized.'));

  const planId = req.user?.userSubscriptionType ?? req.user?.plan_id;
  const config2 = await planAccessService.getConfig();
  const planTier = planId != null ? planAccessService.resolvePlanTier(planId, config2) : null;
  const allPlans = [...LEGACY_PLANS, ...RESTRUCTURE_2026_PLANS];
  const currentPlan = planTier ? allPlans.find((p) => p.tier === planTier) || null : null;

  const invoices = await fetchAmemberInvoices(uid);

  return res.json(ok('Billing.', {
    plan: currentPlan ? { name: currentPlan.label, price: currentPlan.price, features: currentPlan.features } : null,
    plan_tier: planTier,
    renews_at: req.user?.expiry_date || null,
    invoices: invoices.map(mapInvoice),
    member_area_url: memberAreaUrl(),
  }));
}

module.exports = { getBilling };
