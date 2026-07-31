'use strict';

/**
 * Cross-network "domains missing a WHOIS registration date" lookup.
 *
 * Returns the DISTINCT domains in a network's domains table whose `domain_registered_date`
 * IS NULL **and `status = 0` (PENDING)**, ordered by the network's "last updated" column
 * DESC (newest first) so the freshest un-enriched domains surface first — useful for
 * backfill/ops.
 *
 * The `status = 0` filter is what stops the backfill loop from re-serving domains that were
 * already tried and marked UNRESOLVABLE (`status = 2`) by the update API — see
 * updateDomainDateService. DISTINCT (GROUP BY domain) means a domain that spans several rows
 * (no unique index on `domain`) is returned once, not once per row.
 *
 * Schema note (verified against the PHP models + insertion repos):
 *   - Every network's domains table has `domain_registered_date`.
 *   - Every network's domains table now also has an `updated_date` column → sort by that.
 *
 * `table` and `sortColumn` are constants from the whitelist below (NEVER user
 * input), so they are safe to interpolate into the SQL. `limit` is coerced to a
 * bounded integer before interpolation.
 */

const serviceRegistry = require('../../ServiceRegistry');
const { DOMAIN_TABLES } = require('../helpers/domainTables');
const { buildErrorResponse, classifySqlError } = require('../helpers/errorResponse');

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 50;

// network → { table, sortColumn }. sortColumn is the "most recently updated"
// signal for that table. Derived from the shared domainTables config.
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
    return buildErrorResponse({
      code: 400,
      message: `Please provide a network. Available: ${AVAILABLE_NETWORKS}`,
      type: 'validation_error',
      source: 'request',
      operation: 'get-domains-without-registration-date',
      field: 'network',
      details: { expected: AVAILABLE_NETWORKS },
    });
  }

  const cfg = NETWORK_CONFIG[network];
  if (!cfg) {
    return buildErrorResponse({
      code: 400,
      message: `Unsupported network: ${network}. Available: ${AVAILABLE_NETWORKS}`,
      type: 'validation_error',
      source: 'request',
      operation: 'get-domains-without-registration-date',
      field: 'network',
      value: network,
      details: { expected: AVAILABLE_NETWORKS },
    });
  }

  const limit = normalizeLimit(params.limit);
  if (limit === null) {
    return buildErrorResponse({
      code: 400,
      message: `Invalid limit. Provide a positive integer up to ${MAX_LIMIT}.`,
      type: 'validation_error',
      source: 'request',
      operation: 'get-domains-without-registration-date',
      field: 'limit',
      value: params.limit,
      details: { min: 1, max: MAX_LIMIT },
    });
  }

  const service = serviceRegistry.getService(network);
  if (!service || !service.db || !service.db.sql) {
    return buildErrorResponse({
      code: 503,
      message: `SQL connection not available for network ${network}.`,
      type: 'sql_connection_error',
      source: 'sql',
      operation: 'get-domains-without-registration-date',
      network,
      table: cfg.table,
      details: { dependency: 'sql' },
    });
  }

  const { table, sortColumn } = cfg;

  try {
    const rows = await service.db.sql.query(
      `SELECT domain, MAX(${sortColumn}) AS ${sortColumn}
         FROM ${table}
        WHERE domain_registered_date IS NULL AND status = 0
        GROUP BY domain
        ORDER BY MAX(${sortColumn}) DESC
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
    const sqlError = classifySqlError(err);
    return buildErrorResponse({
      code: sqlError.httpCode,
      message: sqlError.message,
      type: sqlError.type,
      source: sqlError.source,
      operation: 'get-domains-without-registration-date',
      network,
      table,
      details: sqlError.sql,
    });
  }
}

module.exports = { getDomainsWithoutRegistration, NETWORK_CONFIG, DEFAULT_LIMIT, MAX_LIMIT };
