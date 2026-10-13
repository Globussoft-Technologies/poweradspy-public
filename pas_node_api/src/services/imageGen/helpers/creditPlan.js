'use strict';

/**
 * AI Recreate credit cycles, driven by the user's real aMember subscription.
 *
 * Source of truth is aMember (read-only): access records say which plan the
 * user has right now and until when (admin-granted access has no invoice at
 * all); the invoice behind that access, when there is one, says whether it's
 * recurring, whether it's still in a trial period, and what the user pays.
 *
 * Allowance (config.json → imageGen.credits):
 *   credits = price × formula.budgetPercent% ÷ formula.costPerCreditUsd, rounded
 *   to formula.roundTo. Price = what the user actually pays per month (aMember
 *   invoice); yearly plans use the UNDISCOUNTED yearly list price and get the
 *   whole year upfront; trials use the trial amount, floored at trial.minCredits.
 *   byPlanId / byFamily (and trial.byPlanId / trial.byFamily) override with a
 *   fixed number.
 *
 * A refresh resets ONLY the plan bucket (cycle_balance) to the allowance —
 * top-up credits live in their own bucket and are never touched by it.
 *
 * Rules (per `refreshEvery` period, anchored to when the current paid term began):
 *   - Trial, recurring invoice  → trial allowance; refreshes to the paid plan's
 *                                 allowance on the rebill date (trial end).
 *   - Trial, not recurring      → trial allowance; no refresh, ends on trial end.
 *   - Recurring (monthly/yearly)→ refreshes every cycle.
 *   - Not recurring, term longer than one cycle (yearly, lifetime/admin grant)
 *                               → refreshes every cycle until the term ends.
 *   - Not recurring, term ends before the next cycle (one-off monthly)
 *                               → no refresh, ends on the term's last day.
 *   - No active plan            → noPlanCredits (top-ups still usable).
 */

const { fetchAmemberSubscription } = require('../../../auth/amemberAuth');
const { resolvePlanIdentity } = require('../../planControl/engine/planIdentityResolver');
const imageGenConfig = require('../config');
const rootConfig = require('../../../config');
const repo = require('../repository');
const { syncTopups, topupProductIds } = require('./topups');
const logger = require('../../../logger');

const log = logger.createChild('imagegen-credit-plan');
const DAY_MS = 86400000;
// aMember invoice status 2 = Recurring Active (same constant amemberAuth.js relies on).
const AMEMBER_RECURRING_ACTIVE = 2;

const subCache = new Map(); // userId → { at, data }

function creditsConfig() {
  return imageGenConfig.credits || {};
}

/** config refreshEvery → { unit: 'day'|'week'|'month'|'year', count } (default 1 month). */
function refreshInterval() {
  const raw = creditsConfig().refreshEvery || {};
  const unit = ['day', 'week', 'month', 'year'].includes(raw.unit) ? raw.unit : 'month';
  const n = Number(raw.count);
  return { unit, count: Number.isInteger(n) && n > 0 ? n : 1 };
}

/** Rough length of an interval in months (to scale a monthly allowance). */
function intervalMonths({ unit, count }) {
  if (unit === 'year') return 12 * count;
  if (unit === 'month') return count;
  return (count * (unit === 'week' ? 7 : 1)) / 30.4375;
}

/** The refresh period containing `today`, anchored at `anchor`:
 * { start, next } where start <= today < next. */
function periodAround(anchor, today, interval = refreshInterval()) {
  const { unit, count } = interval;
  if (unit === 'day' || unit === 'week') {
    const stepDays = count * (unit === 'week' ? 7 : 1);
    const k = Math.max(0, Math.floor((today - anchor) / (stepDays * DAY_MS)));
    const start = addDays(anchor, k * stepDays);
    return { start, next: addDays(start, stepDays) };
  }
  const stepMonths = count * (unit === 'year' ? 12 : 1);
  let months = (today.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (today.getUTCMonth() - anchor.getUTCMonth());
  if (addMonths(anchor, months) > today) months -= 1;
  const k = Math.max(0, Math.floor(months / stepMonths));
  return { start: addMonths(anchor, k * stepMonths), next: addMonths(anchor, (k + 1) * stepMonths) };
}

async function getSubscription(userId, force) {
  const ttlMs = Math.max(0, Number(creditsConfig().amemberCacheSeconds ?? 300)) * 1000;
  const cached = subCache.get(String(userId));
  if (!force && cached && Date.now() - cached.at < ttlMs) return cached.data;
  const data = await fetchAmemberSubscription(userId);
  if (data) subCache.set(String(userId), { at: Date.now(), data });
  return data || cached?.data || null;
}

// ── date helpers (UTC, day precision — aMember dates are plain YYYY-MM-DD) ──
function parseDay(value) {
  if (!value) return null;
  const d = new Date(String(value).slice(0, 10) + 'T00:00:00Z');
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseDateTime(value) {
  if (!value) return null;
  const d = new Date(String(value).replace(' ', 'T') + (String(value).includes('T') || /Z$/.test(value) ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(date, n) {
  return new Date(date.getTime() + n * DAY_MS);
}

function addMonths(date, n) {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + n;
  const day = date.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(day, lastDay)));
}

function isoDay(date) {
  return date ? date.toISOString().slice(0, 10) : null;
}

/** "3d" → 3; anything that isn't a whole-days period → null. */
function periodDays(period) {
  const m = /^(\d+)\s*d$/i.exec(String(period || '').trim());
  return m ? Number(m[1]) : null;
}

// ── allowance: credits = price × budgetPercent ÷ costPerCreditUsd ────────────
/** Unrounded credits a USD amount buys under config credits.formula. */
function formulaCredits(amountUsd) {
  const f = creditsConfig().formula || {};
  const cost = Number(f.costPerCreditUsd);
  const pct = f.budgetPercent === undefined ? 10 : Number(f.budgetPercent);
  if (!(cost > 0) || !(pct > 0) || !(amountUsd > 0)) return 0;
  return (amountUsd * pct) / 100 / cost;
}

function roundCredits(raw) {
  const step = Number(creditsConfig().formula?.roundTo) || 1;
  return Math.max(0, Math.round(raw / step) * step);
}

/** Fixed-number override from a { byPlanId, byFamily } map, or null. */
function fixedOverride(planId, identity, scope) {
  const byPlan = scope?.byPlanId || {};
  if (byPlan[String(planId)] !== undefined && byPlan[String(planId)] !== null) return Math.max(0, Number(byPlan[String(planId)]) || 0);
  const byFamily = scope?.byFamily || {};
  if (identity && byFamily[identity.familyId] !== undefined && byFamily[identity.familyId] !== null) {
    return Math.max(0, Number(byFamily[identity.familyId]) || 0);
  }
  return null;
}

/** Undiscounted list prices { monthly, yearly } for a plan family. 2026 plans
 * read config pricing.planPrices (same numbers the pricing modal shows, before
 * discount); credits.listPrices overrides / covers legacy families. A missing
 * yearly price = monthly × 12. */
function listPrices(identity) {
  if (!identity) return { monthly: null, yearly: null };
  const explicit = (creditsConfig().listPrices || {})[identity.familyId] || {};
  let monthly = explicit.monthly ?? null;
  let yearly = explicit.yearly ?? null;
  if (identity.generation === '2026-restructure') {
    const tier = String(identity.familyId).replace(/-2026$/, '');
    const pp = rootConfig.pricing?.planPrices?.['2026-restructure']?.[tier];
    if (monthly === null && pp?.monthly?.amount) monthly = Number(pp.monthly.amount);
    if (yearly === null && pp?.yearly?.amount) yearly = Number(pp.yearly.amount);
  }
  if (monthly !== null && yearly === null) yearly = Number(monthly) * 12;
  return { monthly: monthly !== null ? Number(monthly) : null, yearly: yearly !== null ? Number(yearly) : null };
}

/** aMember period string → months: "1m"→1, "3m"→3, "1y"→12, "30d"→1, "365d"→12. */
function periodMonths(period) {
  const m = /^(\d+)\s*([dmy])$/i.exec(String(period || '').trim());
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  if (unit === 'y') return n * 12;
  if (unit === 'm') return n;
  return n >= 28 ? Math.max(1, Math.round(n / 30.4375)) : null;
}

/** What the user actually pays per billing period on this invoice (USD only):
 * { amount, months }, or null (no invoice / free / admin grant / other currency). */
function invoicePeriod(invoice) {
  if (!invoice || String(invoice.currency || 'USD').toUpperCase() !== 'USD') return null;
  const recurringPart = !!invoice.second_period && Number(invoice.second_total) > 0;
  const amount = Number(recurringPart ? invoice.second_total : invoice.first_total);
  const months = periodMonths(recurringPart ? invoice.second_period : invoice.first_period);
  return amount > 0 && months ? { amount, months } : null;
}

/**
 * Paid-plan allowance + refresh interval.
 *   - Override (credits.byPlanId / byFamily) wins: that many credits per refresh.
 *   - Yearly billing: credits from the UNDISCOUNTED yearly list price (fair to
 *     yearly buyers), given upfront once a year (credits.yearly.upfront) or
 *     ÷12 per refresh when upfront is false.
 *   - Otherwise: credits from what the user actually pays per month (aMember
 *     invoice); admin grants / free invoices fall back to the monthly list price.
 */
function paidAllowance(planId, identity, invoice) {
  const cfg = creditsConfig();
  const inv = invoicePeriod(invoice);
  const yearly = inv ? inv.months >= 12 : identity?.billingCycle === 'yearly';
  const upfront = cfg.yearly?.upfront !== false;
  const interval = yearly && upfront ? { unit: 'month', count: 12 } : refreshInterval();
  const months = intervalMonths(interval);

  const fixed = fixedOverride(planId, identity, cfg);
  if (fixed !== null) return { allowance: fixed, interval, basis: 'override', yearly };

  const list = listPrices(identity);
  if (yearly) {
    const yearlyPrice = list.yearly ?? (inv ? (inv.amount * 12) / inv.months : null);
    if (yearlyPrice) {
      const perYear = formulaCredits(yearlyPrice);
      const allowance = upfront ? roundCredits(perYear) : Math.round((perYear / 12) * months);
      return { allowance, interval, basis: list.yearly ? 'list_yearly' : 'invoice', yearly };
    }
  } else {
    const monthlyPrice = inv ? inv.amount / inv.months : list.monthly;
    if (monthlyPrice) {
      const perMonth = formulaCredits(monthlyPrice);
      const allowance = months === 1 ? roundCredits(perMonth) : Math.round(perMonth * months);
      return { allowance, interval, basis: inv ? 'invoice' : 'list_monthly', yearly };
    }
  }
  return { allowance: Math.max(0, Number(cfg.unknownPlanCredits) || 0), interval, basis: 'unknown', yearly };
}

/** Trial allowance: override → else formula on the trial amount actually
 * charged (invoice first_total, e.g. $1 or $7), never below trial.minCredits. */
function trialAllowance(planId, identity, invoice) {
  const trial = creditsConfig().trial || {};
  const fixed = fixedOverride(planId, identity, trial);
  if (fixed !== null) return fixed;
  const min = Math.max(0, Number(trial.minCredits ?? trial.credits) || 0);
  const usd = invoice && String(invoice.currency || 'USD').toUpperCase() === 'USD' ? Number(invoice.first_total) : 0;
  return Math.max(min, roundCredits(formulaCredits(usd)));
}

// ── plan selection ───────────────────────────────────────────────────────────

/** Active plan access rows (today inside [begin, expire]), excluding top-up
 * products and products that are neither a known plan nor configured by ID. */
function activePlanRows(access, now) {
  const topupIds = topupProductIds();
  const byPlanId = creditsConfig().byPlanId || {};
  return access.filter((row) => {
    const productId = Number(row.product_id);
    if (!productId || topupIds.has(productId)) return false;
    if (!resolvePlanIdentity(productId) && byPlanId[String(productId)] === undefined) return false;
    const begin = parseDay(row.begin_date);
    const expire = parseDay(row.expire_date);
    return begin && expire && begin <= now && now < addDays(expire, 1);
  });
}

/** The full contiguous term this access row belongs to (recurring rebills
 * usually add a new access row per period for the same product). */
function termBounds(rows, chosen) {
  const productId = Number(chosen.product_id);
  const same = rows.filter((r) => Number(r.product_id) === productId)
    .map((r) => ({ begin: parseDay(r.begin_date), end: addDays(parseDay(r.expire_date), 1) }))
    .filter((r) => r.begin && r.end);
  let start = parseDay(chosen.begin_date);
  let end = addDays(parseDay(chosen.expire_date), 1);
  let changed = true;
  while (changed) {
    changed = false;
    for (const r of same) {
      if (r.end >= start && r.begin < start) { start = r.begin; changed = true; }
      if (r.begin <= end && r.end > end) { end = r.end; changed = true; }
    }
  }
  return { start, end }; // end is exclusive
}

function computePlan(sub, now = new Date()) {
  const today = parseDay(now.toISOString());
  const cfg = creditsConfig();
  const active = activePlanRows(sub.access, today);

  if (!active.length) {
    return {
      kind: 'none', planId: null, label: null, familyId: null, generation: null,
      allowance: Math.max(0, Number(cfg.noPlanCredits) || 0), isTrial: false, recurring: false,
      cycleKey: 'none', cycleStart: null, nextRefreshAt: null, endsOn: null,
    };
  }

  // Highest tier wins; ties go to the access that lasts longest.
  const chosen = active.slice().sort((a, b) => {
    const ra = resolvePlanIdentity(a.product_id)?.tierRank ?? 0;
    const rb = resolvePlanIdentity(b.product_id)?.tierRank ?? 0;
    if (rb !== ra) return rb - ra;
    return String(b.expire_date).localeCompare(String(a.expire_date));
  })[0];

  const planId = Number(chosen.product_id);
  const identity = resolvePlanIdentity(planId);
  const { start: termStart, end: termEnd } = termBounds(sub.access, chosen);
  const invoice = chosen.invoice_id
    ? sub.invoices.find((inv) => String(inv.invoice_id) === String(chosen.invoice_id))
    : null;
  const recurring = !!invoice && Number(invoice.status) === AMEMBER_RECURRING_ACTIVE;

  // Trial window from the invoice's first period (e.g. "3d" before "1m").
  const trialCfg = cfg.trial || {};
  const maxTrialDays = Number(trialCfg.maxTrialDays) || 14;
  const firstDays = invoice ? periodDays(invoice.first_period) : null;
  const invoiceStart = invoice ? (parseDateTime(invoice.tm_started) || termStart) : null;
  const invoiceHasTrial = !!invoice && firstDays !== null && firstDays <= maxTrialDays && !!invoice.second_period;
  const trialEnd = invoiceHasTrial ? addDays(parseDay(invoiceStart.toISOString()), firstDays) : null;

  const trialProduct = identity?.billingCycle === 'trial'
    || (Array.isArray(trialCfg.planIds) && trialCfg.planIds.map(Number).includes(planId));
  const isTrial = invoiceHasTrial ? today < trialEnd : trialProduct;

  const base = {
    planId,
    familyId: identity?.familyId || null,
    label: identity?.label || null,
    generation: identity?.generation || null,
    recurring,
    isTrial,
  };

  if (isTrial) {
    const end = trialEnd || termEnd;
    const rebill = invoice?.rebill_date ? parseDay(invoice.rebill_date) : null;
    return {
      ...base,
      kind: recurring ? 'trial' : 'trial_ending',
      allowance: trialAllowance(planId, identity, invoice),
      basis: 'trial',
      period: null,
      cycleKey: `trial:${planId}:${isoDay(termStart)}`,
      cycleStart: termStart,
      nextRefreshAt: recurring ? (rebill || end) : null,
      endsOn: recurring ? null : addDays(end, -1),
    };
  }

  // Paid term — cycles anchor to when the paid part began (after any trial).
  const anchor = trialEnd && trialEnd > termStart ? trialEnd : termStart;
  const paid = paidAllowance(planId, identity, invoice);
  const { start: cycleStart, next: nextBoundary } = periodAround(anchor, today, paid.interval);

  let kind; let nextRefreshAt; let endsOn;
  if (recurring) {
    kind = 'recurring'; nextRefreshAt = nextBoundary; endsOn = null;
  } else if (nextBoundary < termEnd) {
    kind = 'fixed'; nextRefreshAt = nextBoundary; endsOn = addDays(termEnd, -1);
  } else {
    kind = 'ending'; nextRefreshAt = null; endsOn = addDays(termEnd, -1);
  }

  return {
    ...base,
    kind,
    allowance: paid.allowance,
    basis: paid.basis,
    period: paid.interval,
    cycleKey: `plan:${planId}:${isoDay(cycleStart)}`,
    cycleStart,
    nextRefreshAt,
    endsOn,
  };
}

function planMeta(plan) {
  return {
    kind: plan.kind,
    plan_id: plan.planId,
    family_id: plan.familyId,
    label: plan.label,
    generation: plan.generation,
    is_trial: plan.isTrial,
    recurring: plan.recurring,
    allowance: plan.allowance,
    cycle_start: isoDay(plan.cycleStart),
    next_refresh_at: isoDay(plan.nextRefreshAt),
    ends_on: isoDay(plan.endsOn),
    basis: plan.basis || null,            // override | invoice | list_monthly | list_yearly | trial | unknown
    period: plan.period || null,          // refresh interval { unit, count }; 12 months = yearly upfront
  };
}

/**
 * Bring one user's credits up to date with aMember: credit any newly bought
 * top-ups, start a new plan cycle if one is due, and remember the plan details
 * for display. Safe to call on every credits read / reserve — cached aMember
 * lookups, idempotent writes. If aMember can't be reached, nothing is reset;
 * the last known state is returned.
 */
async function refreshUserCredits(db, userId, { force = false } = {}) {
  const sub = await getSubscription(userId, force);
  if (!sub) {
    const doc = await repo.ensureCreditsDoc(db, userId);
    return { doc, meta: doc?.cycle_meta || null, stale: true };
  }

  await syncTopups(db, userId, sub, { force });

  const plan = computePlan(sub);
  const meta = planMeta(plan);
  const { started, doc } = await repo.applyCycle(db, userId, { cycleKey: plan.cycleKey, allowance: plan.allowance, cycleMeta: meta });
  if (started && plan.allowance > 0) {
    await repo.appendLedger(db, {
      userId, delta: plan.allowance, reason: 'allocation', balanceAfter: doc?.balance ?? null,
      meta: { kind: plan.isTrial ? 'trial' : 'plan', label: plan.label, allowance: plan.allowance },
    }).catch((err) => log.warn('allocation ledger write failed', { userId, error: err.message }));
  }
  if (!started) await repo.setCycleMeta(db, userId, meta).catch(() => {});
  return { doc: started ? doc : await repo.getCreditsDoc(db, userId), meta, stale: false };
}

module.exports = { refreshUserCredits, computePlan };
