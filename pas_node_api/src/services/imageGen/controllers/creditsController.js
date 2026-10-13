'use strict';

/**
 * GET  /api/v1/imageGen/credits       — balance, plan allowance, next refresh / end
 *                                        date, top-up packs (header dropdown + Profile › Credits).
 * POST /api/v1/imageGen/credits/sync  — same, but re-reads aMember right now (used
 *                                        when the user comes back from a top-up checkout).
 *
 * Plan, trial and recurring state come from aMember via helpers/creditPlan.js;
 * allowances and packs from config.json → imageGen.credits / imageGen.topup.
 */

const repo = require('../repository');
const imageGenConfig = require('../config');
const { refreshUserCredits } = require('../helpers/creditPlan');
const { listPacks } = require('../helpers/topups');
const { ok, rejected } = require('../helpers/responses');

function planLabel(meta) {
  if (!meta?.label) return null;
  const generation = meta.generation === 'legacy' ? ' (Legacy)' : '';
  return `${meta.label}${generation}${meta.is_trial ? ' · Trial' : ''}`;
}

async function respond(req, res, { force }) {
  const db = req.imageGenDb;
  const userId = req.user?.user_id ?? req.user?.id;
  if (!userId) return res.status(401).json(rejected(401, 'Unauthorized.'));

  const { doc, meta, stale } = await refreshUserCredits(db, userId, { force });
  const ledger = await repo.listLedger(db, userId, req.query.limit);
  const allowance = meta?.allowance ?? 0;
  const cycleBalance = doc?.cycle_balance ?? 0;
  const topupCfg = imageGenConfig.topup || {};

  return res.json(ok('Credits.', {
    balance: doc?.balance ?? 0,
    cycle_balance: cycleBalance,
    topup_balance: doc?.topup_balance ?? 0,
    cost_per_generation: imageGenConfig.creditCostPerGeneration,
    plan_label: planLabel(meta),
    cycle_kind: meta?.kind || null,            // trial | trial_ending | recurring | fixed | ending | none
    is_trial: !!meta?.is_trial,
    recurring: !!meta?.recurring,
    monthly_quota: allowance,                  // this plan's credits per refresh period
    refresh_period: meta?.period || null,      // { unit, count } — { month, 12 } = yearly upfront
    used_this_cycle: Math.max(0, allowance - cycleBalance),
    cycle_resets_at: meta?.next_refresh_at || null,
    ends_on: meta?.ends_on || null,
    stale,                                     // true = aMember unreachable, showing last known state
    topup: {
      enabled: topupCfg.enabled !== false,
      currency: topupCfg.currency || 'USD',
      currency_symbol: topupCfg.currencySymbol || '',
      packs: listPacks(),
    },
    ledger: ledger.map((l) => ({
      delta: l.delta, reason: l.reason, ref_job_id: l.ref_job_id ? String(l.ref_job_id) : null,
      balance_after: l.balance_after, created_at: l.created_at,
    })),
  }));
}

async function getCredits(req, res) {
  return respond(req, res, { force: false });
}

async function syncCredits(req, res) {
  return respond(req, res, { force: true });
}

module.exports = { getCredits, syncCredits };
