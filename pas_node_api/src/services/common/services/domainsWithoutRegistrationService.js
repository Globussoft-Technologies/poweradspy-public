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
 * updateDomainDateService. Google uses an indexed newest-first keyset scan and Node-side
 * deduplication; the other networks retain the legacy aggregate lookup.
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
const GOOGLE_NETWORK = 'google';
const GOOGLE_LOCK_NAME = 'pas:pending-domains:google';
const GOOGLE_LOCK_WAIT_SECONDS = 1;
const GOOGLE_MIN_BATCH_SIZE = 100;
const GOOGLE_BATCH_MULTIPLIER = 5;

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
 * Read Google pending domains through the recency index instead of grouping the
 * complete pending set. Rows are scanned newest-first, therefore the first row
 * seen for a domain is exactly the MAX(updated_date) row the legacy query
 * returned. Keyset pagination keeps the work bounded when duplicate domains
 * occur near the front of the index.
 *
 * NULL updated_date rows sort after dated rows and are handled in a second
 * phase so they are not lost at the keyset boundary.
 */
async function fetchGooglePendingDomains(exec, cfg, limit) {
  const { table, sortColumn } = cfg;
  const batchSize = Math.max(GOOGLE_MIN_BATCH_SIZE, limit * GOOGLE_BATCH_MULTIPLIER);
  const unique = new Map();
  let scannedRows = 0;
  let phase = 'dated';
  let cursorDate = null;
  let cursorId = null;

  while (unique.size < limit) {
    const clauses = ['domain_registered_date IS NULL', 'status = 0'];
    const params = [];

    if (phase === 'dated') {
      clauses.push(`${sortColumn} IS NOT NULL`);
      if (cursorDate !== null && cursorId !== null) {
        clauses.push(`(${sortColumn} < ? OR (${sortColumn} = ? AND id < ?))`);
        params.push(cursorDate, cursorDate, cursorId);
      }
    } else {
      clauses.push(`${sortColumn} IS NULL`);
      if (cursorId !== null) {
        clauses.push('id < ?');
        params.push(cursorId);
      }
    }

    const orderBy = phase === 'dated'
      ? `${sortColumn} DESC, id DESC`
      : 'id DESC';
    const rows = await exec.query(
      `SELECT id, domain, ${sortColumn}
         FROM ${table}
        WHERE ${clauses.join(' AND ')}
        ORDER BY ${orderBy}
        LIMIT ${batchSize}`,
      params
    );
    const batch = Array.isArray(rows) ? rows : [];
    scannedRows += batch.length;

    for (const row of batch) {
      const domain = row && row.domain != null ? String(row.domain).trim() : '';
      const domainKey = domain.toLowerCase();
      if (!domain || unique.has(domainKey)) continue;
      unique.set(domainKey, { domain, [sortColumn]: row[sortColumn] ?? null });
      if (unique.size >= limit) break;
    }

    if (batch.length < batchSize) {
      if (phase === 'dated') {
        phase = 'undated';
        cursorDate = null;
        cursorId = null;
        continue;
      }
      break;
    }

    const last = batch[batch.length - 1];
    cursorId = last.id;
    if (phase === 'dated') cursorDate = last[sortColumn];
  }

  return { data: [...unique.values()].slice(0, limit), scannedRows };
}

/**
 * GET_LOCK is server-wide and connection-scoped. It prevents separate PM2
 * workers/backend instances from running the same Google lookup concurrently.
 * Tests and lightweight adapters without getConnection retain a safe fallback.
 */
async function withGoogleLookupLock(sql, work, log) {
  if (typeof sql.getConnection !== 'function') {
    return { acquired: true, value: await work(sql) };
  }

  const connection = await sql.getConnection();
  let acquired = false;
  try {
    const [lockRows] = await connection.query(
      'SELECT GET_LOCK(?, ?) AS acquired',
      [GOOGLE_LOCK_NAME, GOOGLE_LOCK_WAIT_SECONDS]
    );
    acquired = Number(lockRows?.[0]?.acquired) === 1;
    if (!acquired) return { acquired: false, value: null };

    const exec = {
      query: async (statement, params = []) => {
        const [rows] = await connection.execute(statement, params);
        return rows;
      },
    };
    return { acquired: true, value: await work(exec) };
  } finally {
    if (acquired) {
      try {
        await connection.query('SELECT RELEASE_LOCK(?)', [GOOGLE_LOCK_NAME]);
      } catch (error) {
        if (log?.warn) log.warn('Unable to release Google pending-domain advisory lock', { error: error.message });
      }
    }
    connection.release();
  }
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
    if (network === GOOGLE_NETWORK) {
      const lookup = await withGoogleLookupLock(
        service.db.sql,
        (exec) => fetchGooglePendingDomains(exec, cfg, limit),
        log
      );
      if (!lookup.acquired) {
        return buildErrorResponse({
          code: 429,
          message: 'A Google pending-domain lookup is already running. Please retry shortly.',
          type: 'request_in_progress',
          source: 'sql',
          operation: 'get-domains-without-registration-date',
          network,
          table,
          details: { retry_after_seconds: 2 },
        });
      }

      const { data, scannedRows } = lookup.value;
      return {
        code: 200,
        message: 'Domains fetched successfully',
        data,
        meta: {
          network,
          limit,
          sort_column: sortColumn,
          count: data.length,
          query_mode: 'indexed_keyset',
          scanned_rows: scannedRows,
        },
      };
    }

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

module.exports = {
  getDomainsWithoutRegistration,
  NETWORK_CONFIG,
  DEFAULT_LIMIT,
  MAX_LIMIT,
};
