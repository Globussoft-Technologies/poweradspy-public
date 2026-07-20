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
 * bump `updated_date = NOW()` (except facebook & linkedin). Networks where the domain is absent
 * are `not_found` and untouched (update-only — no rows are inserted).
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
const { DOMAIN_TABLES } = require('../helpers/domainTables');

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

const ES_TERMS_CHUNK = 1000; // cap match-ids per updateByQuery to bound the terms query
// Above this many ads for a network, run the ES update as a background task
// (wait_for_completion:false) so a big domain never blocks/times out the request. Tunable via
// DOMAIN_ES_SYNC_MAX_ADS (0 = always async). Default 2000.
const _envSyncMax = Number(process.env.DOMAIN_ES_SYNC_MAX_ADS);
const ES_SYNC_MAX_ADS = Number.isFinite(_envSyncMax) && _envSyncMax >= 0 ? _envSyncMax : 2000;

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

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function esUpdatedCount(resp) {
  const body = resp && resp.body ? resp.body : resp;
  return (body && typeof body.updated === 'number') ? body.updated : 0;
}
function esTaskId(resp) {
  const body = resp && resp.body ? resp.body : resp;
  return body && body.task != null ? body.task : null;
}

/**
 * Propagate the resolved registration date onto every associated ad's ES doc for one network.
 *
 * Prod-safety: the number of ads per domain can be large. When it exceeds ES_SYNC_MAX_ADS the
 * updateByQuery runs as a background task (wait_for_completion:false) so the request returns
 * immediately instead of blocking/timing out — SQL is already committed (source of truth) and ES
 * converges shortly after. Small domains run synchronously so the response carries an exact count.
 * `refresh:false` everywhere (a forced per-chunk refresh is the costliest part at scale; the date
 * is not latency-critical). `conflicts:proceed` tolerates concurrent crawler writes.
 *
 * @returns {{ es_index, es_matched_ads, es_mode, es_updated?, es_tasks? } | { es_error }}
 */
async function propagateDateToEs(service, cfg, domainRowIds, date, log) {
  const es = service.db && service.db.elastic;
  if (!es || !es.client) return { es_error: 'ES client not available' };
  const index = es.indexName;
  if (!index) return { es_error: 'ES index not configured' };
  if (!domainRowIds.length) return { es_index: index, es_matched_ads: 0, es_mode: 'sync', es_updated: 0 };

  // Resolve the ads for this domain from SQL (ES docs don't store the domain string; they are
  // located by an ad-id field that differs per index — see cfg.esMatchField/esMatchId).
  const placeholders = domainRowIds.map(() => '?').join(', ');
  const adRows = await service.db.sql.query(
    `SELECT id, ad_id FROM ${cfg.adTable} WHERE domain_id IN (${placeholders})`,
    domainRowIds
  );
  const matchIds = (Array.isArray(adRows) ? adRows : [])
    .map((r) => (cfg.esMatchId === 'public' ? r.ad_id : r.id))
    .filter((v) => v !== null && v !== undefined && v !== '');
  if (!matchIds.length) return { es_index: index, es_matched_ads: 0, es_mode: 'sync', es_updated: 0 };

  const value = cfg.esDateFormat === 'epoch' ? ymdToEpochSeconds(date) : date;
  const async = matchIds.length > ES_SYNC_MAX_ADS;

  const script = {
    lang: 'painless',
    source: 'ctx._source[params.f] = params.v',
    params: { f: cfg.esDateField, v: value },
  };

  let updated = 0;
  const tasks = [];
  for (const ids of chunk(matchIds, ES_TERMS_CHUNK)) {
    const resp = await es.client.updateByQuery({
      index,
      conflicts: 'proceed',
      refresh: false,
      waitForCompletion: !async, // wait_for_completion — false → background task, returns a task id
      body: { query: { terms: { [cfg.esMatchField]: ids } }, script },
    });
    if (async) { const t = esTaskId(resp); if (t) tasks.push(t); }
    else updated += esUpdatedCount(resp);
  }

  if (log && log.info) {
    log.info('domain date ES propagated', { index, matched_ads: matchIds.length, mode: async ? 'async' : 'sync', updated, tasks: tasks.length });
  }
  return async
    ? { es_index: index, es_matched_ads: matchIds.length, es_mode: 'async', es_tasks: tasks }
    : { es_index: index, es_matched_ads: matchIds.length, es_mode: 'sync', es_updated: updated };
}

/**
 * Update one network's domains table (+ ES on the date path). Returns a per-network result.
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
    // These domains tables have NO unique index on `domain`, so the same domain can appear in
    // MULTIPLE rows (some dated, some NULL). We update EVERY matching row — updating only one
    // left duplicate rows behind, so a follow-up "domains without registration date" fetch kept
    // returning the domain the caller had just updated.
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
      try {
        Object.assign(result, await propagateDateToEs(service, cfg, result.ids, date, log));
      } catch (esErr) {
        if (log && log.error) log.error('updateDomainDate ES error', { network, error: esErr.message });
        result.es_error = esErr.message;
      }
    }

    return result;
  } catch (err) {
    if (log && log.error) log.error('updateDomainDate network error', { network, table, error: err.message });
    return { status: 'error', message: err.message };
  }
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
  const domainName = body && body.domain_name != null ? String(body.domain_name).trim() : '';
  if (!domainName) {
    return { code: 400, error: 'The domain_name field is required.' };
  }

  const action = resolveAction(body);
  if (action.error) return { code: 400, error: action.error };

  const results = {};
  const summary = { updated: 0, not_found: 0, errors: 0, es_matched_ads: 0, es_updated: 0, es_async_networks: 0, es_errors: 0 };

  for (const [network, cfg] of Object.entries(NETWORK_CONFIG)) {
    const r = await updateOneNetwork(network, cfg, domainName, action, log);
    results[network] = r;
    if (r.status === 'updated') summary.updated += 1;
    else if (r.status === 'not_found') summary.not_found += 1;
    else summary.errors += 1;
    if (typeof r.es_matched_ads === 'number') summary.es_matched_ads += r.es_matched_ads;
    if (typeof r.es_updated === 'number') summary.es_updated += r.es_updated; // sync-confirmed only
    if (r.es_mode === 'async') summary.es_async_networks += 1;
    if (r.es_error) summary.es_errors += 1;
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

module.exports = { updateDomainDate, resolveAction, propagateDateToEs, ymdToEpochSeconds, NETWORK_CONFIG, STATUS, isValidYmd };
