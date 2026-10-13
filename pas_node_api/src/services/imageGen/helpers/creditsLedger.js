'use strict';

/**
 * Credit reserve/finalize/refund, each paired with an append-only ledger entry so
 * Profile › Credits has a real transaction history, not just a number.
 *
 * Reservation is atomic at the Mongo level (repository.reserveCredit's
 * findOneAndUpdate with a `{bucket}: {$gte: cost}` filter) — no race condition on
 * a double-click or two concurrent tabs. Plan credits are spent before top-ups.
 */

const repo = require('../repository');
const { refreshUserCredits } = require('./creditPlan');

/** Brings the user's cycle/top-ups up to date with aMember, then atomically
 * reserves `cost` credits.
 * @returns {Promise<{ok:true, balance:number, bucket:'cycle'|'topup'} | {ok:false, balance:number}>}
 *   ok:false = insufficient credits (3f).
 */
async function reserve(db, userId, cost) {
  await refreshUserCredits(db, userId);
  const reserved = await repo.reserveCredit(db, userId, cost);
  if (!reserved) {
    const current = await repo.getBalance(db, userId);
    return { ok: false, balance: current ?? 0 };
  }
  return { ok: true, balance: reserved.balance, bucket: reserved.bucket };
}

async function logReserve(db, { userId, jobId, cost, balanceAfter }) {
  await repo.appendLedger(db, { userId, delta: -cost, reason: 'reserve', refJobId: jobId, balanceAfter });
}

/** Job failed/cancelled — give the reserved credit back to the bucket it came from. */
async function refund(db, { userId, jobId, cost, bucket = 'cycle' }) {
  const after = await repo.refundCredit(db, userId, cost, bucket);
  await repo.appendLedger(db, { userId, delta: cost, reason: 'refund', refJobId: jobId, balanceAfter: after });
  return after;
}

module.exports = { reserve, logReserve, refund };
