'use strict';

/**
 * Cross-network domain registration-date update.
 *
 * Node port of the PHP SupportScrapper@putDomainDate (PUT insert-update-domain-date),
 * generalised to fan out across ALL networks' domains tables instead of just facebook.
 *
 * For each network: if the domain row exists, set `domain_registered_date = <domain_date>`
 * and bump `updated_date = NOW()` (except facebook & linkedin, whose tables have no
 * `updated_date` column). Networks where the domain is absent are reported as `not_found`
 * and left untouched (update-only — no rows are inserted).
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
 */
async function updateOneNetwork(network, cfg, domainName, domainDate, log) {
  const service = serviceRegistry.getService(network);
  if (!service || !service.db || !service.db.sql) {
    return { status: 'error', message: 'SQL connection not available' };
  }
  const sql = service.db.sql;
  const { table, hasUpdatedDate } = cfg;

  try {
    const rows = await sql.query(
      `SELECT id, domain, domain_registered_date FROM ${table} WHERE domain = ? LIMIT 1`,
      [domainName]
    );
    const row = Array.isArray(rows) && rows.length ? rows[0] : null;
    if (!row) return { status: 'not_found' };

    const setClause = hasUpdatedDate
      ? 'domain_registered_date = ?, updated_date = NOW()'
      : 'domain_registered_date = ?';
    await sql.query(
      `UPDATE ${table} SET ${setClause} WHERE id = ?`,
      [domainDate, row.id]
    );

    return {
      status: 'updated',
      id: row.id,
      previous_registered_date: row.domain_registered_date ?? null,
      updated_date_touched: hasUpdatedDate,
    };
  } catch (err) {
    if (log && log.error) log.error('updateDomainDate network error', { network, table, error: err.message });
    return { status: 'error', message: err.message };
  }
}

/**
 * @param {object} body  { domain_name, domain_date }
 * @param {object} [log] logger
 * @returns {{ code, message, error?, data? }}
 */
async function updateDomainDate(body, log) {
  const domainName = body && body.domain_name != null ? String(body.domain_name).trim() : '';
  const domainDate = body && body.domain_date != null ? String(body.domain_date).trim() : '';

  // Mirrors the PHP validator (returns the first error message).
  if (!domainName) {
    return { code: 400, error: 'The domain_name field is required.' };
  }
  if (!domainDate) {
    return { code: 400, error: 'The domain_date field is required.' };
  }
  if (!isValidYmd(domainDate)) {
    return { code: 400, error: 'The domain_date does not match the format Y-m-d.' };
  }

  const results = {};
  const summary = { updated: 0, not_found: 0, errors: 0 };

  for (const [network, cfg] of Object.entries(NETWORK_CONFIG)) {
    const r = await updateOneNetwork(network, cfg, domainName, domainDate, log);
    results[network] = r;
    if (r.status === 'updated') summary.updated += 1;
    else if (r.status === 'not_found') summary.not_found += 1;
    else summary.errors += 1;
  }

  // Every network failed to even run a query (e.g. all SQL connections down) → server problem.
  if (summary.errors === Object.keys(NETWORK_CONFIG).length) {
    return {
      code: 503,
      message: 'No network SQL connection was available.',
      data: { domain: domainName, domain_date: domainDate, results, summary },
    };
  }

  if (log && log.info) {
    log.info('domain date update processed', { domain: domainName, domain_date: domainDate, summary });
  }

  return {
    code: 200,
    message: 'Domain date update processed',
    data: { domain: domainName, domain_date: domainDate, results, summary },
  };
}

module.exports = { updateDomainDate, NETWORK_CONFIG, isValidYmd };
