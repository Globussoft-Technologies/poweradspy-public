'use strict';

/**
 * Cross-network domain registration-date update.
 *
 * Node port of the PHP SupportScrapper@putDomainDate (PUT insert-update-domain-date),
 * generalised to fan out across ALL networks' domains tables instead of just facebook —
 * AND to propagate the date into every associated ad's Elasticsearch doc so ES doesn't go stale.
 *
 * Body: { domain_name, domain_date?, status? } — provide a date OR a status:
 *   - `domain_date` (YYYY-MM-DD)  → set domain_registered_date = date, status = 1 (RESOLVED),
 *                                    AND write the date onto every matching ad's ES doc.
 *   - `status: 2`                 → mark UNRESOLVABLE (no date obtainable — dead/redacted
 *                                    domain). PERMANENT: the domain drops out of
 *                                    get-domains-without-registration-date. (No ES write — no date.)
 *   - `status: 0`                 → reset to PENDING (re-queue for another lookup attempt)
 * A `status: 1` without a date is rejected (can't be "resolved" with no date).
 *
 * For each network: if the domain row(s) exist, apply the change to EVERY matching row and
 * bump `updated_date = NOW()`. Networks where the domain is absent are `not_found` and untouched
 * (update-only — no rows are inserted).
 *
 * ES propagation (date path only): the ad docs don't store the domain string, so the ads are
 * resolved from SQL (`<adTable>.domain_id` → the domain row ids) and their `ad_id`s drive an
 * updateByQuery that sets the network's registered-date ES field. Field name + value format
 * differ per index family (see domainTables.esDateField/esDateFormat). ES failures are reported
 * per network but never fail the SQL update (SQL is the source of truth).
 *
 * Table / column / field identifiers are constants from the whitelist (never user input); all
 * values are parameterised (SQL) or passed as script params (ES).
 */

const serviceRegistry = require('../../ServiceRegistry');
// Node resolves this directory import to src/config/index.js, the centralized
// config.json loader. This service must never require the raw config.json file.
const appConfig = require('../../../config');
const { DOMAIN_TABLES } = require('../helpers/domainTables');
const { buildErrorResponse, classifySqlError, classifyEsError } = require('../helpers/errorResponse');
const {
  enqueueDomainDateEsUpdate,
  assertEsUpdateComplete,
  ES_TERMS_CHUNK,
  ES_REQUESTS_PER_SECOND,
} = require('../helpers/domainDateEsQueue');

// Derived from the shared domainTables config (single source of truth).
const NETWORK_CONFIG = Object.fromEntries(
  Object.entries(DOMAIN_TABLES).map(([net, c]) => [net, {
    table: c.table,
    adTable: c.adTable,
    hasUpdatedDate: !!c.updatedDate,
    esDateField: c.esDateField,
    esDateFormat: c.esDateFormat,
    esMatchField: c.esMatchField,
    esMatchId: c.esMatchId,
  }])
);

// Status codes stored in the `status` column (see the migration + module header).
const STATUS = { PENDING: 0, RESOLVED: 1, UNRESOLVABLE: 2 };

// Keep the request comfortably below the upstream 120-second gateway budget.
// Small ES updates may remain synchronous for exact counts; larger updates are
// persisted for the load-shedding worker. The resolved config object supplies
// defaults when an older config file or an isolated test stub omits this section.
const domainDateConfig = appConfig.domainDateUpdate || {};
const ES_SYNC_MAX_ADS = domainDateConfig.esSyncMaxAds ?? 100;
const SQL_QUERY_TIMEOUT_MS = domainDateConfig.sqlQueryTimeoutMs ?? 10000;
const ES_REQUEST_TIMEOUT_MS = domainDateConfig.esRequestTimeoutMs ?? 10000;

function elapsedMs(startedAt) {
  return Date.now() - startedAt;
}

function classifyDomainSqlError(err) {
  const classified = classifySqlError(err);
  const code = String(err?.code || '');
  const isTimeout = code === 'PROTOCOL_SEQUENCE_TIMEOUT' || /query.*timed?\s*out/i.test(err?.message || '');
  return isTimeout
    ? { ...classified, httpCode: 504, type: 'sql_timeout_error', message: 'SQL query timed out' }
    : classified;
}

function classifyDomainEsError(err) {
  const classified = classifyEsError(err);
  if (err?.code === 'ES_UPDATE_INCOMPLETE') {
    return {
      ...classified,
      type: 'elasticsearch_incomplete_error',
      message: 'Elasticsearch update completed partially',
      details: err.details,
    };
  }
  const isTimeout = err?.name === 'TimeoutError' ||
    ['ETIMEDOUT', 'ESOCKETTIMEDOUT'].includes(String(err?.code || '')) ||
    /timed?\s*out|timeout/i.test(err?.message || '');
  return isTimeout
    ? { ...classified, type: 'elasticsearch_timeout_error', message: 'Elasticsearch update timed out' }
    : classified;
}

async function querySqlWithTimeout(sql, statement, params) {
  // Production SQL adapters expose the underlying mysql2 promise pool. Scope
  // the timeout to this endpoint rather than changing the shared query wrapper.
  if (sql?.pool && typeof sql.pool.execute === 'function') {
    const [rows] = await sql.pool.execute(
      { sql: statement, timeout: SQL_QUERY_TIMEOUT_MS },
      params
    );
    return rows;
  }
  return sql.query(statement, params);
}

// Matches the PHP `date_format:Y-m-d` rule — a real calendar date in YYYY-MM-DD.
function isValidYmd(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// 'YYYY-MM-DD' → UNIX epoch SECONDS at UTC midnight (for the epoch_second ES fields).
function ymdToEpochSeconds(date) {
  return Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);
}

function esUpdatedCount(resp) {
  const body = resp && resp.body ? resp.body : resp;
  return (body && typeof body.updated === 'number') ? body.updated : 0;
}

/**
 * Propagate the resolved registration date onto every associated ad's ES doc for one network.
 *
 * Prod-safety: the number of ads per domain can be large. When it exceeds ES_SYNC_MAX_ADS the
 * update is persisted for a background worker, so the request returns after the SQL source of
 * truth is committed. The worker throttles writes and waits for each task before starting the next
 * chunk or domain. Small domains remain synchronous so the response has an exact count.
 * `refresh:false` everywhere (a forced per-chunk refresh is the costliest part at scale; the date
 * is not latency-critical). `conflicts:proceed` tolerates concurrent crawler writes.
 *
 * @returns {{ es_index, es_matched_ads, es_mode, es_updated?, es_queued?, es_queue_id? } | { es_error }}
 */
async function propagateDateToEs(service, cfg, domainRowIds, date, log, network) {
  const startedAt = Date.now();
  const timings = { resolve_ad_ids: 0, submit_es: 0, total: 0 };
  const es = service.db && service.db.elastic;
  if (!es || !es.client) {
    return {
      es_timings_ms: { ...timings, total: elapsedMs(startedAt) },
      es_error: buildErrorResponse({
        code: 503,
        message: 'Elasticsearch client not available',
        type: 'elasticsearch_connection_error',
        source: 'elasticsearch',
        operation: 'update-domain-date',
        stage: 'propagate_date',
        network,
        table: cfg.table,
      }).error,
    };
  }
  const index = es.indexName;
  if (!index) {
    return {
      es_timings_ms: { ...timings, total: elapsedMs(startedAt) },
      es_error: buildErrorResponse({
        code: 500,
        message: 'Elasticsearch index not configured',
        type: 'elasticsearch_configuration_error',
        source: 'elasticsearch',
        operation: 'update-domain-date',
        stage: 'propagate_date',
        network,
        table: cfg.table,
      }).error,
    };
  }
  if (!domainRowIds.length) {
    return {
      es_index: index,
      es_matched_ads: 0,
      es_mode: 'sync',
      es_updated: 0,
      es_timings_ms: { ...timings, total: elapsedMs(startedAt) },
    };
  }

  // Resolve the ads for this domain from SQL (ES docs don't store the domain string; they are
  // located by an ad-id field that differs per index — see cfg.esMatchField/esMatchId).
  const placeholders = domainRowIds.map(() => '?').join(', ');
  const adLookupStartedAt = Date.now();
  let adRows;
  try {
    adRows = await querySqlWithTimeout(
      service.db.sql,
      `SELECT id, ad_id FROM ${cfg.adTable} WHERE domain_id IN (${placeholders})`,
      domainRowIds
    );
    timings.resolve_ad_ids = elapsedMs(adLookupStartedAt);
  } catch (err) {
    timings.resolve_ad_ids = elapsedMs(adLookupStartedAt);
    timings.total = elapsedMs(startedAt);
    const sqlError = classifyDomainSqlError(err);
    if (log && log.error) {
      log.error('domain date ad-id lookup failed', {
        network,
        table: cfg.adTable,
        stage: 'resolve_ad_ids',
        duration_ms: timings.resolve_ad_ids,
        timeout_ms: SQL_QUERY_TIMEOUT_MS,
        error: err.message,
        error_code: err.code,
      });
    }
    return {
      es_index: index,
      es_timings_ms: timings,
      es_error: buildErrorResponse({
        code: sqlError.httpCode,
        message: sqlError.message,
        type: sqlError.type,
        source: sqlError.source,
        operation: 'update-domain-date',
        stage: 'resolve_ad_ids',
        network,
        table: cfg.adTable,
        details: { timeout_ms: SQL_QUERY_TIMEOUT_MS, ...sqlError.sql },
      }).error,
    };
  }

  const matchIds = [...new Set((Array.isArray(adRows) ? adRows : [])
    .map((r) => (cfg.esMatchId === 'public' ? r.ad_id : r.id))
    .filter((v) => v !== null && v !== undefined && v !== ''))];
  if (!matchIds.length) {
    return {
      es_index: index,
      es_matched_ads: 0,
      es_mode: 'sync',
      es_updated: 0,
      es_timings_ms: { ...timings, total: elapsedMs(startedAt) },
    };
  }

  const async = ES_SYNC_MAX_ADS === 0 || matchIds.length > ES_SYNC_MAX_ADS;
  const value = cfg.esDateFormat === 'epoch' ? ymdToEpochSeconds(date) : date;
  const script = {
    lang: 'painless',
    source: "if (ctx._source[params.f] == params.v) { ctx.op = 'noop' } else { ctx._source[params.f] = params.v }",
    params: { f: cfg.esDateField, v: value },
  };

  if (log && log.info) {
    log.info('domain date ES propagation started', {
      network,
      index,
      matched_ads: matchIds.length,
      chunks: async ? Math.ceil(matchIds.length / ES_TERMS_CHUNK) : 1,
      mode: async ? 'async' : 'sync',
      request_timeout_ms: ES_REQUEST_TIMEOUT_MS,
      requests_per_second: ES_REQUESTS_PER_SECOND,
    });
  }

  const submitStartedAt = Date.now();
  if (async) {
    const queued = enqueueDomainDateEsUpdate({ network, date, matchIds, domainRowIds });
    timings.submit_es = elapsedMs(submitStartedAt);
    timings.total = elapsedMs(startedAt);
    if (!queued) {
      return {
        es_index: index,
        es_matched_ads: matchIds.length,
        es_mode: 'async',
        es_tasks: [],
        es_timings_ms: timings,
        es_error: buildErrorResponse({
          code: 503,
          message: 'Elasticsearch update could not be queued',
          type: 'elasticsearch_queue_error',
          source: 'api',
          operation: 'update-domain-date',
          stage: 'queue_es_update',
          network,
          table: cfg.table,
          details: { index, matched_ads: matchIds.length },
        }).error,
      };
    }

    const queuedResult = {
      es_index: index,
      es_matched_ads: matchIds.length,
      es_mode: 'async',
      es_tasks: [],
      es_queued: true,
      es_queue_id: queued.id,
      es_chunks: Math.ceil(matchIds.length / ES_TERMS_CHUNK),
      es_requests_per_second: ES_REQUESTS_PER_SECOND,
      es_timings_ms: timings,
    };
    if (log && log.info) {
      log.info('domain date ES update queued', {
        network,
        index,
        queue_id: queued.id,
        matched_ads: matchIds.length,
        chunks: queuedResult.es_chunks,
        requests_per_second: ES_REQUESTS_PER_SECOND,
        timings_ms: timings,
      });
    }
    return queuedResult;
  }

  try {
    const response = await es.client.updateByQuery({
      index,
      conflicts: 'proceed',
      refresh: false,
      waitForCompletion: true,
      requestsPerSecond: ES_REQUESTS_PER_SECOND,
      body: { query: { terms: { [cfg.esMatchField]: matchIds } }, script },
    }, {
      requestTimeout: ES_REQUEST_TIMEOUT_MS,
      maxRetries: 0,
    });
    timings.submit_es = elapsedMs(submitStartedAt);
    timings.total = elapsedMs(startedAt);
    const completedResponse = assertEsUpdateComplete(response?.body || response || {});
    const updated = esUpdatedCount(completedResponse);
    if (log && log.info) {
      log.info('domain date ES propagated', {
        network,
        index,
        matched_ads: matchIds.length,
        mode: 'sync',
        updated,
        timings_ms: timings,
      });
    }
    return {
      es_index: index,
      es_matched_ads: matchIds.length,
      es_mode: 'sync',
      es_updated: updated,
      es_timings_ms: timings,
    };
  } catch (error) {
    timings.submit_es = elapsedMs(submitStartedAt);
    timings.total = elapsedMs(startedAt);
    const classified = classifyDomainEsError(error);
    if (log && log.error) {
      log.error('domain date ES propagation failed', {
        network,
        index,
        mode: 'sync',
        matched_ads: matchIds.length,
        timings_ms: timings,
        request_timeout_ms: ES_REQUEST_TIMEOUT_MS,
        error: error.message,
        error_code: error.code,
      });
    }
    // SQL is already committed. Persist a retry instead of allowing a transient
    // synchronous ES failure or partial result to leave the index stale forever.
    const queued = enqueueDomainDateEsUpdate({ network, date, matchIds, domainRowIds });
    timings.total = elapsedMs(startedAt);
    if (queued) {
      if (log && log.warn) {
        log.warn('domain date ES sync update deferred to queue', {
          network,
          index,
          queue_id: queued.id,
          matched_ads: matchIds.length,
          reason: classified.type,
        });
      }
      return {
        es_index: index,
        es_matched_ads: matchIds.length,
        es_mode: 'async',
        es_tasks: [],
        es_queued: true,
        es_queue_id: queued.id,
        es_chunks: Math.ceil(matchIds.length / ES_TERMS_CHUNK),
        es_requests_per_second: ES_REQUESTS_PER_SECOND,
        es_deferred_after_sync_failure: true,
        es_retry_reason: classified.type,
        es_timings_ms: timings,
      };
    }

    return {
      es_index: index,
      es_matched_ads: matchIds.length,
      es_mode: 'async',
      es_updated: 0,
      es_timings_ms: timings,
      es_error: buildErrorResponse({
        code: 503,
        message: 'Elasticsearch update failed and could not be queued for retry',
        type: 'elasticsearch_queue_error',
        source: 'api',
        operation: 'update-domain-date',
        stage: 'queue_es_update',
        network,
        table: cfg.table,
        details: {
          index,
          matched_ads: matchIds.length,
          request_timeout_ms: ES_REQUEST_TIMEOUT_MS,
          initial_error_type: classified.type,
          initial_error: classified.details,
        },
      }).error,
    };
  }
}

/**
 * Update one network's domains table (+ ES on the date path). Returns a per-network result.
 * @param {{ date: string|null, statusValue: number }} action  resolved change to apply
 */
async function updateOneNetwork(network, cfg, domainName, action, log) {
  const startedAt = Date.now();
  const timings = { select_rows: 0, update_rows: 0, propagate_date: 0, total: 0 };
  const finish = (result) => {
    timings.total = elapsedMs(startedAt);
    const completed = { ...result, timings_ms: timings };
    if (log && log.info) {
      log.info('domain date network completed', {
        network,
        table: cfg.table,
        status: completed.status,
        code: completed.code || 200,
        matched_rows: completed.matched_rows || 0,
        es_matched_ads: completed.es_matched_ads || 0,
        es_mode: completed.es_mode,
        has_es_error: !!completed.es_error,
        timings_ms: timings,
      });
    }
    return completed;
  };

  if (log && log.info) {
    log.info('domain date network started', { network, table: cfg.table });
  }

  const service = serviceRegistry.getService(network);
  if (!service || !service.db || !service.db.sql) {
    return finish({
      status: 'error',
      code: 503,
      message: 'SQL connection not available',
      error: buildErrorResponse({
        code: 503,
        message: 'SQL connection not available',
        type: 'sql_connection_error',
        source: 'sql',
        operation: 'update-domain-date',
        stage: 'network_connection',
        network,
        table: cfg.table,
        details: { dependency: 'sql' },
      }).error,
    });
  }
  const sql = service.db.sql;
  const { table, hasUpdatedDate } = cfg;
  const { date, statusValue } = action;

  let rows;
  const selectStartedAt = Date.now();
  try {
    // These domains tables have NO unique index on `domain`, so the same domain can appear in
    // MULTIPLE rows (some dated, some NULL). We update EVERY matching row — updating only one
    // left duplicate rows behind, so a follow-up "domains without registration date" fetch kept
    // returning the domain the caller had just updated.
    rows = await querySqlWithTimeout(
      sql,
      `SELECT id, domain_registered_date, status FROM ${table} WHERE domain = ?`,
      [domainName]
    );
    timings.select_rows = elapsedMs(selectStartedAt);
  } catch (err) {
    timings.select_rows = elapsedMs(selectStartedAt);
    if (log && log.error) log.error('updateDomainDate network error', {
      network,
      table,
      stage: 'select_rows',
      duration_ms: timings.select_rows,
      timeout_ms: SQL_QUERY_TIMEOUT_MS,
      error: err.message,
      error_code: err.code,
    });
    const sqlError = classifyDomainSqlError(err);
    return finish({
      status: 'error',
      code: sqlError.httpCode,
      message: sqlError.message,
      error: buildErrorResponse({
        code: sqlError.httpCode,
        message: sqlError.message,
        type: sqlError.type,
        source: sqlError.source,
        operation: 'update-domain-date',
        stage: 'select_rows',
        network,
        table,
        details: { timeout_ms: SQL_QUERY_TIMEOUT_MS, ...sqlError.sql },
      }).error,
    });
  }

  if (!Array.isArray(rows) || rows.length === 0) return finish({ status: 'not_found' });

  const setParts = [];
  const params = [];
  if (date !== null) { setParts.push('domain_registered_date = ?'); params.push(date); }
  setParts.push('status = ?'); params.push(statusValue);
  if (hasUpdatedDate) setParts.push('updated_date = NOW()');
  params.push(domainName);

  const updateStartedAt = Date.now();
  try {
    // Keep writes on the established adapter path. A mysql2 client timeout does
    // not cancel a mutation on the server and could otherwise report a false
    // failure while MySQL is still completing the UPDATE.
    await sql.query(`UPDATE ${table} SET ${setParts.join(', ')} WHERE domain = ?`, params);
    timings.update_rows = elapsedMs(updateStartedAt);
  } catch (err) {
    timings.update_rows = elapsedMs(updateStartedAt);
    if (log && log.error) log.error('updateDomainDate network error', {
      network,
      table,
      stage: 'update_rows',
      duration_ms: timings.update_rows,
      error: err.message,
      error_code: err.code,
    });
    const sqlError = classifySqlError(err);
    return finish({
      status: 'error',
      code: sqlError.httpCode,
      message: sqlError.message,
      error: buildErrorResponse({
        code: sqlError.httpCode,
        message: sqlError.message,
        type: sqlError.type,
        source: sqlError.source,
        operation: 'update-domain-date',
        stage: 'update_rows',
        network,
        table,
        details: sqlError.sql,
      }).error,
    });
  }

  const result = {
    status: 'updated',
    matched_rows: rows.length,
    ids: rows.map((r) => r.id),
    previous_registered_dates: rows.map((r) => r.domain_registered_date ?? null),
    previous_statuses: rows.map((r) => r.status),
    new_status: statusValue,
    updated_date_touched: hasUpdatedDate,
  };

  // Propagate to ES only when a real date was written (status path leaves the date untouched).
  if (date !== null) {
    const propagationStartedAt = Date.now();
    try {
      Object.assign(result, await propagateDateToEs(service, cfg, result.ids, date, log, network));
      timings.propagate_date = elapsedMs(propagationStartedAt);
    } catch (esErr) {
      timings.propagate_date = elapsedMs(propagationStartedAt);
      if (log && log.error) log.error('updateDomainDate ES error', {
        network,
        table,
        stage: 'propagate_date',
        duration_ms: timings.propagate_date,
        error: esErr.message,
        error_code: esErr.code,
      });
      const classified = classifyDomainEsError(esErr);
      result.es_error = buildErrorResponse({
        code: classified.type === 'elasticsearch_timeout_error' ? 504 : 500,
        message: classified.message,
        type: classified.type,
        source: classified.source,
        operation: 'update-domain-date',
        stage: 'propagate_date',
        network,
        table,
        details: classified.details,
      }).error;
    }
  }

  return finish(result);
}

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
  const startedAt = Date.now();
  const domainName = body && body.domain_name != null ? String(body.domain_name).trim() : '';
  if (!domainName) {
    return { code: 400, error: 'The domain_name field is required.' };
  }

  const action = resolveAction(body);
  if (action.error) return { code: 400, error: action.error };

  const results = {};
  const summary = { updated: 0, not_found: 0, errors: 0, timeouts: 0, es_matched_ads: 0, es_updated: 0, es_async_networks: 0, es_queued_networks: 0, es_errors: 0 };

  if (log && log.info) {
    log.info('domain date update started', {
      domain: domainName,
      domain_date: action.date,
      status: action.statusValue,
      networks: Object.keys(NETWORK_CONFIG),
      sql_timeout_ms: SQL_QUERY_TIMEOUT_MS,
      es_request_timeout_ms: ES_REQUEST_TIMEOUT_MS,
      es_sync_max_ads: ES_SYNC_MAX_ADS,
      es_terms_chunk_size: ES_TERMS_CHUNK,
      es_requests_per_second: ES_REQUESTS_PER_SECOND,
    });
  }

  // Each network owns independent SQL/ES connections, so serial fan-out only
  // adds their latencies together. Run all networks concurrently and preserve
  // deterministic response ordering when aggregating the completed results.
  const entries = Object.entries(NETWORK_CONFIG);
  const networkResults = await Promise.all(entries.map(async ([network, cfg]) => {
    try {
      return await updateOneNetwork(network, cfg, domainName, action, log);
    } catch (err) {
      if (log && log.error) {
        log.error('domain date network failed unexpectedly', {
          network,
          table: cfg.table,
          stage: 'network_fanout',
          duration_ms: elapsedMs(startedAt),
          error: err.message,
          error_code: err.code,
          stack: err.stack,
        });
      }
      return {
        status: 'error',
        code: 500,
        message: 'Unexpected network update failure',
        timings_ms: { total: elapsedMs(startedAt) },
        error: buildErrorResponse({
          code: 500,
          message: 'Unexpected network update failure',
          type: 'internal_error',
          source: 'api',
          operation: 'update-domain-date',
          stage: 'network_fanout',
          network,
          table: cfg.table,
          details: { message: err.message, code: err.code },
        }).error,
      };
    }
  }));

  entries.forEach(([network], index) => {
    const r = networkResults[index];
    results[network] = r;
    if (r.status === 'updated') summary.updated += 1;
    else if (r.status === 'not_found') summary.not_found += 1;
    else summary.errors += 1;
    if (r.error?.type?.includes('timeout') || r.es_error?.type?.includes('timeout')) summary.timeouts += 1;
    if (typeof r.es_matched_ads === 'number') summary.es_matched_ads += r.es_matched_ads;
    if (typeof r.es_updated === 'number') summary.es_updated += r.es_updated; // sync-confirmed only
    if (r.es_mode === 'async') summary.es_async_networks += 1;
    if (r.es_queued) summary.es_queued_networks += 1;
    if (r.es_error) summary.es_errors += 1;
  });

  const totalDurationMs = elapsedMs(startedAt);
  summary.duration_ms = totalDurationMs;

  const payload = {
    domain: domainName,
    domain_date: action.date,
    status: action.statusValue,
    results,
    summary,
    timings_ms: {
      total: totalDurationMs,
      networks: Object.fromEntries(
        Object.entries(results).map(([network, result]) => [network, result.timings_ms || {}])
      ),
    },
  };

  // If no network completed, distinguish unavailable connections, bounded
  // timeouts, and query failures so operations can act on the real cause.
  if (summary.errors === Object.keys(NETWORK_CONFIG).length) {
    const errorTypes = Object.values(results).map((result) => result.error?.type).filter(Boolean);
    const allConnectionsUnavailable = errorTypes.length === entries.length &&
      errorTypes.every((type) => type === 'sql_connection_error');
    const timeoutCount = errorTypes.filter((type) => type === 'sql_timeout_error').length;
    const hasTimeout = timeoutCount > 0;
    const allTimedOut = timeoutCount === entries.length;
    const code = hasTimeout ? 504 : (allConnectionsUnavailable ? 503 : 500);
    const message = allTimedOut
      ? 'All network SQL lookups timed out.'
      : (hasTimeout
        ? 'All network domain-date updates failed; one or more SQL lookups timed out.'
      : (allConnectionsUnavailable
        ? 'No network SQL connection was available.'
        : 'All network domain-date updates failed.'));
    const type = hasTimeout
      ? 'sql_timeout_error'
      : (allConnectionsUnavailable ? 'sql_connection_error' : 'sql_query_error');
    if (log && log.error) {
      log.error('domain date update fanout failed', {
        domain: domainName,
        status_code: code,
        error_type: type,
        duration_ms: totalDurationMs,
        failed_networks: Object.keys(results),
        network_errors: Object.fromEntries(
          Object.entries(results).map(([network, result]) => [network, result.error])
        ),
      });
    }
    return {
      code,
      message,
      error: buildErrorResponse({
        code,
        message,
        type,
        source: 'sql',
        operation: 'update-domain-date',
        stage: 'fanout',
        details: {
          failed_networks: Object.keys(results),
          network_errors: Object.fromEntries(
            Object.entries(results).map(([net, r]) => [net, r.error || { message: r.message || 'unknown error' }])
          ),
        },
      }).error,
      data: payload,
    };
  }

  if (log && log.info) {
    const logDetails = {
      domain: domainName,
      domain_date: action.date,
      status: action.statusValue,
      summary,
      network_durations_ms: Object.fromEntries(
        Object.entries(results).map(([network, result]) => [network, result.timings_ms?.total || 0])
      ),
    };
    if ((summary.errors > 0 || summary.es_errors > 0 || totalDurationMs > 30000) && log.warn) {
      log.warn('domain date update processed with warnings', logDetails);
    } else {
      log.info('domain date update processed', logDetails);
    }
  }

  const queueFailureNetworks = Object.entries(results)
    .filter(([, result]) => result.es_error?.type === 'elasticsearch_queue_error')
    .map(([network]) => network);
  if (queueFailureNetworks.length > 0) {
    const code = 503;
    const message = 'SQL was updated, but one or more Elasticsearch updates could not be queued. Retry this request.';
    return {
      code,
      message,
      error: buildErrorResponse({
        code,
        message,
        type: 'elasticsearch_queue_error',
        source: 'api',
        operation: 'update-domain-date',
        stage: 'queue_es_update',
        details: {
          retryable: true,
          retry_after_seconds: 5,
          failed_networks: queueFailureNetworks,
        },
      }).error,
      data: payload,
    };
  }

  return { code: 200, message: 'Domain date update processed', data: payload };
}

module.exports = {
  updateDomainDate,
  resolveAction,
  propagateDateToEs,
  ymdToEpochSeconds,
  NETWORK_CONFIG,
  STATUS,
  isValidYmd,
  ES_SYNC_MAX_ADS,
  SQL_QUERY_TIMEOUT_MS,
  ES_REQUEST_TIMEOUT_MS,
  ES_TERMS_CHUNK,
  ES_REQUESTS_PER_SECOND,
  querySqlWithTimeout,
};
