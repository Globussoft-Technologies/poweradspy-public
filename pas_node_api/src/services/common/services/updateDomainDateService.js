'use strict';

/**
 * Cross-network domain registration-date update.
 *
 * Node port of the PHP SupportScrapper@putDomainDate (PUT insert-update-domain-date),
 * generalised to fan out across ALL networks' domains tables instead of just facebook.
 *
 * Body: { domain_name, domain_date?, status? } — provide a date OR a status:
 *   - `domain_date` (YYYY-MM-DD)  → set domain_registered_date = date, status = 1 (RESOLVED)
 *   - `status: 2`                 → mark UNRESOLVABLE (no date obtainable — dead/redacted
 *                                    domain). PERMANENT: the domain drops out of
 *                                    get-domains-without-registration-date so the backfill
 *                                    loop never serves it again.
 *   - `status: 0`                 → reset to PENDING (re-queue for another lookup attempt)
 * A `status: 1` without a date is rejected (can't be "resolved" with no date).
 *
 * For each network: if the domain row(s) exist, apply the change to EVERY matching row and
 * bump `updated_date = NOW()` (except facebook & linkedin, whose tables have no
 * `updated_date` column). Networks where the domain is absent are `not_found` and untouched
 * (update-only — no rows are inserted).
 *
 * `table` / `hasUpdatedDate` are constants from the whitelist below (never user input),
 * so the interpolated identifiers are safe; all values are parameterised.
 */

const serviceRegistry = require('../../ServiceRegistry');
const { DOMAIN_TABLES } = require('../helpers/domainTables');

// network → { table, hasUpdatedDate }. facebook_ad_domains & linkedin_ad_domains
// have NO `updated_date` column, so we only touch domain_registered_date there.
// Derived from the shared domainTables config.
const NETWORK_CONFIG = Object.fromEntries(
  Object.entries(DOMAIN_TABLES).map(([net, c]) => [net, { table: c.table, hasUpdatedDate: !!c.updatedDate }])
);

// Matches the PHP `date_format:Y-m-d` rule — a real calendar date in YYYY-MM-DD.
function isValidYmd(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/**
 * Update one network's domains table. Returns a per-network result object.
 * @param {{ date: string|null, statusValue: number }} action  resolved change to apply
 */
async function updateOneNetwork(network, cfg, domainName, action, log) {
  const service = serviceRegistry.getService(network);
  if (!service || !service.db || !service.db.sql) {
    return { status: 'error', message: 'SQL connection not available' };
  }
  const sql = service.db.sql;
  const { table, hasUpdatedDate } = cfg;
  const { date, statusValue } = action;

  try {
    // These domains tables have NO unique index on `domain`, so the same domain can
    // appear in MULTIPLE rows (some with a date, some NULL). We must update EVERY
    // matching row — updating only one (the old `LIMIT 1` + `WHERE id = ?`) left the
    // duplicate rows behind, so a follow-up "domains without registration date" fetch
    // kept returning the domain the caller had just updated.
    const rows = await sql.query(
      `SELECT id, domain_registered_date, status FROM ${table} WHERE domain = ?`,
      [domainName]
    );
    if (!Array.isArray(rows) || rows.length === 0) return { status: 'not_found' };

    const setParts = [];
    const params = [];
    if (date !== null) { setParts.push('domain_registered_date = ?'); params.push(date); }
    setParts.push('status = ?'); params.push(statusValue);
    if (hasUpdatedDate) setParts.push('updated_date = NOW()');
    params.push(domainName);

    await sql.query(`UPDATE ${table} SET ${setParts.join(', ')} WHERE domain = ?`, params);

    return {
      status: 'updated',
      matched_rows: rows.length,
      ids: rows.map((r) => r.id),
      previous_registered_dates: rows.map((r) => r.domain_registered_date ?? null),
      previous_statuses: rows.map((r) => r.status),
      new_status: statusValue,
      updated_date_touched: hasUpdatedDate,
    };
  } catch (err) {
    if (log && log.error) log.error('updateDomainDate network error', { network, table, error: err.message });
    return { status: 'error', message: err.message };
  }
}

// Status codes stored in the `status` column (see the migration + module header).
const STATUS = { PENDING: 0, RESOLVED: 1, UNRESOLVABLE: 2 };

/**
 * Resolve the (date, status) change to apply from the request body.
 * @returns {{ error: string } | { date: string|null, statusValue: number }}
 */
function resolveAction(body) {
  const hasDate = body && body.domain_date != null && String(body.domain_date).trim() !== '';
  const hasStatus = body && body.status != null && String(body.status).trim() !== '';

  if (hasDate) {
    const date = String(body.domain_date).trim();
    if (!isValidYmd(date)) return { error: 'The domain_date does not match the format Y-m-d.' };
    // A date means the domain resolved. Reject a contradictory explicit status.
    if (hasStatus && Number(body.status) !== STATUS.RESOLVED) {
      return { error: 'domain_date implies status 1 (resolved); do not also send a different status.' };
    }
    return { date, statusValue: STATUS.RESOLVED };
  }

  if (hasStatus) {
    const n = Number(body.status);
    if (!Number.isInteger(n) || ![STATUS.PENDING, STATUS.RESOLVED, STATUS.UNRESOLVABLE].includes(n)) {
      return { error: 'status must be 0 (pending), 1 (resolved) or 2 (unresolvable).' };
    }
    if (n === STATUS.RESOLVED) {
      return { error: 'status 1 (resolved) requires a domain_date.' };
    }
    // status 0 (re-queue) or 2 (unresolvable): change status only, leave the date as-is.
    return { date: null, statusValue: n };
  }

  return { error: 'Provide domain_date (to set a date) or status (0=pending, 2=unresolvable).' };
}

/**
 * @param {object} body  { domain_name, domain_date?, status? }
 * @param {object} [log] logger
 * @returns {{ code, message, error?, data? }}
 */
async function updateDomainDate(body, log) {
  const domainName = body && body.domain_name != null ? String(body.domain_name).trim() : '';
  if (!domainName) {
    return { code: 400, error: 'The domain_name field is required.' };
  }

  const action = resolveAction(body);
  if (action.error) return { code: 400, error: action.error };

  const results = {};
  const summary = { updated: 0, not_found: 0, errors: 0 };

  for (const [network, cfg] of Object.entries(NETWORK_CONFIG)) {
    const r = await updateOneNetwork(network, cfg, domainName, action, log);
    results[network] = r;
    if (r.status === 'updated') summary.updated += 1;
    else if (r.status === 'not_found') summary.not_found += 1;
    else summary.errors += 1;
  }

  const payload = {
    domain: domainName,
    domain_date: action.date,
    status: action.statusValue,
    results,
    summary,
  };

  // Every network failed to even run a query (e.g. all SQL connections down) → server problem.
  if (summary.errors === Object.keys(NETWORK_CONFIG).length) {
    return { code: 503, message: 'No network SQL connection was available.', data: payload };
  }

  if (log && log.info) {
    log.info('domain date update processed', { domain: domainName, domain_date: action.date, status: action.statusValue, summary });
  }

  return { code: 200, message: 'Domain date update processed', data: payload };
}

module.exports = { updateDomainDate, resolveAction, NETWORK_CONFIG, STATUS, isValidYmd };
