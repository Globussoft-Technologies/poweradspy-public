'use strict';

/**
 * GET /api/v1/imageGen/credits/history[.csv] — Profile › Credits' "Credit
 * history" table (paginated, type-filterable) and its CSV export.
 *
 * 'allocated' covers plan-cycle allocations and aMember top-up purchases
 * (ledger reasons 'allocation' / 'topup' / 'topup_reversed', written by helpers/creditPlan.js and
 * helpers/topups.js).
 *
 * "Recreated {advertiser} ad" vs "Regenerated {advertiser} ad": the ledger
 * alone can't reliably distinguish a first Recreate from a later Regenerate
 * of the same ad, so every 'reserve' entry is labelled "Recreated" — accurate
 * (it IS a Recreate job), just not split into the spec's two sub-wordings.
 */

const repo = require('../repository');
const { ok, rejected } = require('../helpers/responses');

const VALID_TYPES = new Set(['all', 'used', 'refunded', 'allocated']);

function parsePaging(query) {
  const type = VALID_TYPES.has(query.type) ? query.type : 'all';
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || 8, 1), 100);
  return { type, page, limit };
}

async function enrichedEntries(db, userId, { type, page, limit }) {
  const { items, total } = await repo.listLedgerPage(db, userId, { type, page, limit });
  const jobIds = [...new Set(items.map((i) => i.ref_job_id).filter(Boolean))];
  const jobs = jobIds.length ? await repo.getJobsByIds(db, jobIds, userId) : [];
  const jobById = new Map(jobs.map((j) => [String(j._id), j]));

  const mapped = items.map((entry) => {
    const job = entry.ref_job_id ? jobById.get(String(entry.ref_job_id)) : null;
    const advertiser = job?.source?.advertiser || 'this ad';
    const TYPE = { reserve: 'used', refund: 'refunded', allocation: 'allocated', topup: 'allocated', topup_reversed: 'allocated' };
    const mapType = TYPE[entry.reason] || entry.reason;
    let detail;
    if (entry.reason === 'reserve') detail = `Recreated ${advertiser} ad`;
    else if (entry.reason === 'refund') detail = `Generation failed · ${advertiser} ad`;
    else if (entry.reason === 'allocation') {
      detail = `${entry.meta?.kind === 'trial' ? 'Trial' : 'Plan'} allocation · ${entry.delta} credits`;
    } else if (entry.reason === 'topup') detail = `Top-up pack · ${entry.delta} credits`;
    else if (entry.reason === 'topup_reversed') {
      detail = `Top-up refunded · ${Math.abs(entry.delta)} credits removed`;
      if (entry.meta?.unrecovered > 0) detail += ` (${entry.meta.unrecovered} already used)`;
    }
    else detail = entry.reason;
    return {
      id: String(entry._id),
      date: entry.created_at,
      type: mapType,
      detail,
      delta: entry.delta,
      balance: entry.balance_after,
      image_id: job?.status === 'succeeded' ? String(job._id) : null,
    };
  });

  return { items: mapped, total };
}

async function getCreditHistory(req, res) {
  const db = req.imageGenDb;
  const userId = req.user?.user_id ?? req.user?.id;
  if (!userId) return res.status(401).json(rejected(401, 'Unauthorized.'));

  const paging = parsePaging(req.query);
  const { items, total } = await enrichedEntries(db, userId, paging);
  return res.json(ok('Credit history.', { items, total, page: paging.page, limit: paging.limit }));
}

function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function exportCreditHistoryCsv(req, res) {
  const db = req.imageGenDb;
  const userId = req.user?.user_id ?? req.user?.id;
  if (!userId) return res.status(401).json(rejected(401, 'Unauthorized.'));

  const type = VALID_TYPES.has(req.query.type) ? req.query.type : 'all';
  // Full filtered set for export, not just one page — capped so a huge account
  // can't tie up the request indefinitely.
  const { items } = await enrichedEntries(db, userId, { type, page: 1, limit: 1000 });

  const header = ['Date', 'Activity', 'Credits', 'Balance'];
  const rows = items.map((i) => [
    new Date(i.date).toISOString(),
    i.detail,
    i.delta > 0 ? `+${i.delta}` : String(i.delta),
    i.balance,
  ]);
  const csv = [header, ...rows].map((row) => row.map(csvEscape).join(',')).join('\r\n');

  const dateStr = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="credit-history-${dateStr}.csv"`);
  return res.send(csv);
}

module.exports = { getCreditHistory, exportCreditHistoryCsv };
