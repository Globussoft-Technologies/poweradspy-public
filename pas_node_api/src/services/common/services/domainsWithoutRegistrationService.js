'use strict';

/**
 * Cross-network "domains missing a WHOIS registration date" lookup.
 *
 * Returns the domains in a network's domains table whose `domain_registered_date`
 * IS NULL, ordered by the network's "last updated" column DESC (newest first) so
 * the freshest un-enriched domains surface first — useful for backfill/ops.
 *
 * Schema note (verified against the PHP models + insertion repos):
 *   - Every network's domains table has `domain_registered_date`.
 *   - 8 of them ALSO have an `updated_date` column → sort by that.
 *   - facebook_ad_domains & linkedin_ad_domains have NO `updated_date`
 *     (they carry `created` + `last_seen`) → fall back to `last_seen`.
 *
 * `table` and `sortColumn` are constants from the whitelist below (NEVER user
 * input), so they are safe to interpolate into the SQL. `limit` is coerced to a
 * bounded integer before interpolation.
 */

const serviceRegistry = require('../../ServiceRegistry');
const { DOMAIN_TABLES } = require('../helpers/domainTables');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 50;

// network → { table, sortColumn }. sortColumn is the "most recently updated"
// signal for that table: `updated_date` where it exists, else `last_seen`
// (facebook & linkedin). Derived from the shared domainTables config.
const NETWORK_CONFIG = Object.fromEntries(
  Object.entries(DOMAIN_TABLES).map(([net, c]) => [net, { table: c.table, sortColumn: c.updatedDate || c.recency }])
);

const AVAILABLE_NETWORKS = Object.keys(NETWORK_CONFIG).join(', ');

/**
 * Coerce the raw `limit` param into an integer in [1, MAX_LIMIT].
 * Missing/empty → DEFAULT_LIMIT. Non-numeric/<1 → null (caller returns 400).
 * Values above MAX_LIMIT are clamped to MAX_LIMIT.
 */
function normalizeLimit(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === '') return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 1) return null;
  return Math.min(n, MAX_LIMIT);
}

/**
 * @param {object} params  { network, limit }
 * @param {object} [log]   logger
 * @returns {{ code, message, data?, meta? }}
 */
async function getDomainsWithoutRegistration(params, log) {
  const network = params && params.network != null ? String(params.network).toLowerCase().trim() : '';

  if (!network) {
    return { code: 400, message: `Please provide a network. Available: ${AVAILABLE_NETWORKS}` };
  }

  const cfg = NETWORK_CONFIG[network];
  if (!cfg) {
    return { code: 400, message: `Unsupported network: ${network}. Available: ${AVAILABLE_NETWORKS}` };
  }

  const limit = normalizeLimit(params.limit);
  if (limit === null) {
    return { code: 400, message: `Invalid limit. Provide a positive integer up to ${MAX_LIMIT}.` };
  }

  const service = serviceRegistry.getService(network);
  if (!service || !service.db || !service.db.sql) {
    return { code: 503, message: `SQL connection not available for network ${network}.` };
  }

  const { table, sortColumn } = cfg;

  try {
    const rows = await service.db.sql.query(
      `SELECT id, domain, domain_registered_date, ${sortColumn}
         FROM ${table}
        WHERE domain_registered_date IS NULL
        ORDER BY ${sortColumn} DESC
        LIMIT ${limit}`
    );
    const data = Array.isArray(rows) ? rows : [];
    return {
      code: 200,
      message: 'Domains fetched successfully',
      data,
      meta: { network, limit, sort_column: sortColumn, count: data.length },
    };
  } catch (err) {
    if (log && log.error) log.error('getDomainsWithoutRegistration db error', { network, table, error: err.message });
    return { code: 400, message: 'Some error ocurred during querying the db' };
  }
}

module.exports = { getDomainsWithoutRegistration, NETWORK_CONFIG, DEFAULT_LIMIT, MAX_LIMIT };
