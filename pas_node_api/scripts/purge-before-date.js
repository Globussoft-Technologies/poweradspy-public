'use strict';

/**
 * Purge every ad older than a date, on every network: SQL (ad + all its child
 * rows) → Elasticsearch → NAS media. Dry-run by default.
 *
 *   node scripts/purge-before-date.js --before 2023-01-01                 # dry-run: counts, tables, plan, estimate
 *   node scripts/purge-before-date.js --before 2023-01-01 --apply --confirm "PURGE_BEFORE:2023-01-01"
 *
 * "Older" = <main table>.<date column> < --before (default column: last_seen,
 * i.e. ads not seen running since before that date).
 *
 * Safety / load
 *   - Networks on DIFFERENT SQL hosts run in parallel; networks sharing a host run
 *     one after another (so one SQL server never gets two purges at once).
 *   - Each batch is one short SQL transaction (children first, then the ad row);
 *     any error rolls that batch back and stops only that network.
 *   - Adaptive load control per network: batch size grows while batches are fast
 *     and the host is idle, shrinks/pauses when batches get slow or the host's
 *     Threads_running goes above --max-threads-running.
 *   - Only one batch of ids is held in memory at a time (no heap growth).
 *   - Resumable: the cursor (last deleted id) is saved after every batch in
 *     data/purge-state/<date>/<network>.json; re-running continues from it.
 *     Ctrl+C finishes the current batch, saves, and exits.
 *
 * Child tables (per network, found on the target DB itself):
 *   the network's own delete cascade (insertion repository) + every table with a
 *   "<main_table>_id" column + every foreign key that references the main table.
 *   Activity/log/user-list tables are skipped (listed in the dry-run with reason).
 */

const fs = require('fs');
const path = require('path');
const config = require('../src/config');
const networksConfig = require('../src/config/networks');
const dbManager = require('../src/database/DatabaseManager');
// Shared helpers from the delete script. A server may run an OLDER copy of that
// script, so everything added recently has a built-in fallback here.
const shared = require('./delete-post-owner-ads');

const { NETWORKS, DEFAULT_NETWORKS, collectNasRefs, deleteNasForNetwork } = shared;
const cascadeDeleteStatements = typeof shared.cascadeDeleteStatements === 'function'
  ? shared.cascadeDeleteStatements
  : async () => null; // child tables are still found from the DB schema (see discoverChildTables)
const scopedNetworkConfig = typeof shared.scopedNetworkConfig === 'function'
  ? shared.scopedNetworkConfig
  : (names) => Object.fromEntries(names.map((name) => {
    const original = networksConfig[name] || {};
    return [name, {
      ...original,
      enabled: true,
      database: {
        sql: original.database?.sql,
        elastic: original.database?.elastic,
        elastic_tiktok: original.database?.elastic_tiktok,
      },
    }];
  }));
const closeNas = typeof shared.closeNas === 'function' ? shared.closeNas : async () => {};
const nasBucket = typeof shared.nasBucket === 'function' ? shared.nasBucket : () => '(unknown — update delete-post-owner-ads.js)';
const nasDeleteTransports = typeof shared.nasDeleteTransports === 'function' ? shared.nasDeleteTransports : () => [];

// ES field holding each network's last_seen (same map the keyword-notification scan uses).
const ES_DATE_FIELD = {
  facebook: 'facebook_ad.last_seen',
  instagram: 'instagram_ad.last_seen',
  google: 'last_seen',
  gdn: 'gdn_ad.last_seen',
  youtube: 'last_seen',
  linkedin: 'last_seen',
  reddit: 'reddit_ad.last_seen',
  pinterest: 'pinterest_ad.last_seen',
  quora: 'quora_ad.last_seen',
  native: 'native_ad.last_seen',
  tiktok: 'last_seen',
};

// Discovered (non-cascade) tables matching this are NOT purged: crawler activity
// logs, user hidden/favourite lists, queues and history tables.
const SKIP_TABLE = /(activit|_logs?$|^logs?_|hidden|hide_|favou?rite|_queue|history|_audit)/i;

const SAFE_IDENT = /^[A-Za-z0-9_]+$/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rowsOf = (r) => (Array.isArray(r?.[0]) ? r[0] : (Array.isArray(r) ? r : []));

// ── args ────────────────────────────────────────────────────────────────────
function usage() {
  return `
Dry-run (default, read-only):
  node scripts/purge-before-date.js --before 2023-01-01

Apply:
  node scripts/purge-before-date.js --before 2023-01-01 --apply --confirm "PURGE_BEFORE:2023-01-01"

Options:
  --before <YYYY-MM-DD>       Required. Ads with <date column> before this are purged.
  --networks <csv|all>        Default: all (${DEFAULT_NETWORKS.join(', ')}).
  --date-column <name>        Main-table column compared. Default: last_seen.
  --apply                     Delete. Without it nothing is written.
  --confirm <phrase>          Must equal PURGE_BEFORE:<date> with --apply.
  --skip-nas                  Keep NAS media files.
  --skip-es-sweep             Skip the final ES-only cleanup (ES docs with no SQL row).
  --skip-es                   SQL only: Elasticsearch is never read or written (also skips NAS and TikTok).
  --max-threads-running <n>   Pause a host while its MySQL Threads_running is above n. Default: 16.
  --batch <n>                 Starting batch size. Default: 500 (adapts between 100 and --max-batch).
  --max-batch <n>             Default: 3000.
  --exclude-tables <csv>      Extra tables never to purge.
  --restart                   Ignore saved progress and start from the beginning.
`.trim();
}

function parseArgs(argv) {
  const opts = {
    networks: [...DEFAULT_NETWORKS], dateColumn: 'last_seen', apply: false, skipNas: false, skipEs: false, esSweep: true,
    maxThreadsRunning: 16, batch: 500, maxBatch: 3000, exclude: [], restart: false, help: false,
  };
  const val = (i, flag) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} requires a value.`);
    return v;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--before') opts.before = val(i++, a);
    else if (a === '--networks') {
      const v = val(i++, a);
      opts.networks = v.toLowerCase() === 'all' ? [...DEFAULT_NETWORKS] : v.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    } else if (a === '--date-column') opts.dateColumn = val(i++, a);
    else if (a === '--apply') opts.apply = true;
    else if (a === '--confirm') opts.confirm = val(i++, a);
    else if (a === '--skip-nas') opts.skipNas = true;
    else if (a === '--skip-es-sweep') opts.esSweep = false;
    else if (a === '--skip-es') opts.skipEs = true;
    else if (a === '--max-threads-running') opts.maxThreadsRunning = Number(val(i++, a));
    else if (a === '--batch') opts.batch = Number(val(i++, a));
    else if (a === '--max-batch') opts.maxBatch = Number(val(i++, a));
    else if (a === '--exclude-tables') opts.exclude = val(i++, a).split(',').map((x) => x.trim()).filter(Boolean);
    else if (a === '--restart') opts.restart = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (opts.help) return opts;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.before || '') || Number.isNaN(Date.parse(`${opts.before}T00:00:00Z`))) {
    throw new Error('--before must be a date like 2023-01-01.');
  }
  if (!SAFE_IDENT.test(opts.dateColumn)) throw new Error('--date-column must be a plain column name.');
  for (const n of opts.networks) if (!NETWORKS[n]) throw new Error(`Unsupported network: ${n}`);
  opts.networks = [...new Set(opts.networks)];
  for (const [k, min] of [['maxThreadsRunning', 1], ['batch', 50], ['maxBatch', 100]]) {
    if (!Number.isInteger(opts[k]) || opts[k] < min) throw new Error(`--${k} must be an integer >= ${min}.`);
  }
  opts.batch = Math.min(opts.batch, opts.maxBatch);
  // SQL only: never read or write Elasticsearch, and NAS needs ES to find files.
  if (opts.skipEs) {
    opts.esSweep = false;
    opts.skipNas = true;
    opts.networks = opts.networks.filter((n) => !NETWORKS[n].esOnly);
  }
  return opts;
}

// ── adaptive batch control ──────────────────────────────────────────────────
/** Grows the batch while batches are fast and the host is idle; shrinks + pauses otherwise. */
class Throttle {
  constructor({ initial = 500, min = 100, max = 3000, targetMs = 1500 } = {}) {
    Object.assign(this, { size: initial, min, max, targetMs, pauseMs: 100 });
  }

  next(durationMs, hostBusy) {
    if (hostBusy) {
      this.size = Math.max(this.min, Math.floor(this.size / 2));
      this.pauseMs = 3000;
    } else if (durationMs > this.targetMs * 1.5) {
      this.size = Math.max(this.min, Math.floor(this.size * 0.6));
      this.pauseMs = 500;
    } else if (durationMs < this.targetMs * 0.6) {
      this.size = Math.min(this.max, Math.ceil(this.size * 1.4));
      this.pauseMs = 100;
    } else {
      this.pauseMs = 150;
    }
    return this;
  }
}

/** One per SQL host: samples Threads_running every few seconds. */
class HostMonitor {
  constructor(sql, limit) { Object.assign(this, { sql, limit, threadsRunning: null, at: 0 }); }

  async busy() {
    if (Date.now() - this.at > 3000) {
      this.at = Date.now();
      try {
        const r = rowsOf(await this.sql.query("SHOW GLOBAL STATUS LIKE 'Threads_running'"));
        this.threadsRunning = Number(r[0]?.Value ?? r[0]?.value ?? 0);
      } catch { /* keep last value */ }
    }
    return this.threadsRunning !== null && this.threadsRunning > this.limit;
  }
}

// ── discovery ───────────────────────────────────────────────────────────────
function sqlHostKey(network) {
  const s = networksConfig[network]?.database?.sql || {};
  return `${s.host || '?'}:${s.port || 3306}`;
}

/** Child tables to purge with the main row (see header). */
async function discoverChildTables(sql, network, spec, extraExclude = []) {
  const main = spec.mainTable;
  const tables = new Set(rowsOf(await sql.query(
    'SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()'
  )).map((r) => r.t || r.TABLE_NAME));
  const exclude = new Set(extraExclude.map((t) => t.toLowerCase()));
  const children = new Map();
  const skipped = [];
  const add = (table, col, source) => {
    if (!table || table === main || !tables.has(table) || !SAFE_IDENT.test(table) || !SAFE_IDENT.test(col)) return;
    const key = `${table}.${col}`;
    if (exclude.has(table.toLowerCase())) { skipped.push({ table, col, reason: '--exclude-tables' }); return; }
    if (source === 'name' && SKIP_TABLE.test(table)) { skipped.push({ table, col, reason: 'log/activity/user-list table' }); return; }
    if (!children.has(key)) children.set(key, { table, col, source });
  };

  const cascade = await cascadeDeleteStatements(spec);
  for (const s of cascade || []) add(s.table.replace(/`/g, ''), s.col.replace(/`/g, ''), 'cascade');
  for (const r of rowsOf(await sql.query(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME = ?`, [main]
  ))) add(r.t || r.TABLE_NAME, r.c || r.COLUMN_NAME, 'foreign-key');
  for (const r of rowsOf(await sql.query(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = ? AND TABLE_NAME <> ?`, [`${main}_id`, main]
  ))) add(r.t || r.TABLE_NAME, r.c || r.COLUMN_NAME, 'name');
  // Bug-report tables key the ad by "ad_id" (not "<main>_id"), so the name rule above
  // misses them; found here too so an older delete script (no cascade) still covers them.
  for (const r of rowsOf(await sql.query(
    `SELECT TABLE_NAME AS t FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'ad_id' AND TABLE_NAME IN (?, ?)`,
    [`${main}_bug_report`, `${network}_ad_bug_report`]
  ))) add(r.t || r.TABLE_NAME, 'ad_id', 'cascade');
  return { children: [...children.values()], skipped };
}

async function dateColumnInfo(sql, table, column) {
  const r = rowsOf(await sql.query(
    `SELECT DATA_TYPE AS type FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [table, column]
  ));
  if (!r.length) return null;
  const idx = rowsOf(await sql.query(
    `SELECT 1 FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`, [table, column]
  ));
  return { type: String(r[0].type || r[0].DATA_TYPE).toLowerCase(), indexed: idx.length > 0 };
}

/** Cutoff value in the column's own type (epoch seconds for integer columns). */
function cutoffValue(before, columnType) {
  return /int/.test(columnType) ? Math.floor(Date.parse(`${before}T00:00:00Z`) / 1000) : `${before} 00:00:00`;
}

/** Count old rows in primary-key chunks (never one long scan). */
async function countOld(sql, main, col, cutoff, monitor) {
  const r = rowsOf(await sql.query(`SELECT MIN(id) AS lo, MAX(id) AS hi FROM \`${main}\``))[0] || {};
  const lo = Number(r.lo || 0);
  const hi = Number(r.hi || 0);
  if (!hi) return 0;
  const step = 200000;
  let total = 0;
  for (let a = lo; a <= hi; a += step) {
    while (await monitor.busy()) await sleep(2000);
    const c = rowsOf(await sql.query(
      `SELECT COUNT(*) AS n FROM \`${main}\` WHERE id BETWEEN ? AND ? AND \`${col}\` < ?`, [a, a + step - 1, cutoff]
    ))[0];
    total += Number(c?.n || 0);
    await sleep(20);
  }
  return total;
}

// ── Elasticsearch ───────────────────────────────────────────────────────────
const unwrap = (res) => (res && res.body !== undefined ? res.body : res);
// How the cutoff is written in the ES range query. Variant 0 parses OUR value with an
// explicit format, so it works whatever the field stores (date strings, epoch_second,
// epoch_millis). Variants 1–2 are for string (keyword) date fields.
const ES_RANGE_VARIANTS = ['format', 'datetime', 'date'];
function esRange(field, before, variant = 'format') {
  if (variant === 'format') return { range: { [field]: { lt: before, format: 'yyyy-MM-dd' } } };
  return { range: { [field]: { lt: variant === 'datetime' ? `${before} 00:00:00` : before } } };
}

/** ES count of docs older than the cutoff, using the first range variant ES accepts. */
async function esCountOld(elastic, field, before) {
  let lastError;
  for (const variant of ES_RANGE_VARIANTS) {
    try {
      const res = unwrap(await elastic.search({
        index: elastic.indexName,
        body: { size: 0, track_total_hits: true, query: esRange(field, before, variant) },
      }));
      const t = res?.hits?.total;
      return { count: typeof t === 'object' ? Number(t.value || 0) : Number(t || 0), variant };
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

async function esDeleteByIds(elastic, idField, ids) {
  if (!ids.length) return 0;
  const res = unwrap(await elastic.client.deleteByQuery({
    index: elastic.indexName,
    conflicts: 'proceed',
    refresh: false,
    body: { query: { terms: { [idField]: ids } } },
  }));
  return Number(res?.deleted || 0);
}

/** ES docs of these ids, full _source, a page at a time → NAS refs only (docs are dropped). */
async function nasRefsForIds(elastic, idField, ids) {
  const refs = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const res = unwrap(await elastic.search({
      index: elastic.indexName,
      body: { size: 400, query: { terms: { [idField]: ids.slice(i, i + 200) } } },
    }));
    for (const [p, skip] of collectNasRefs(res?.hits?.hits || [])) if (!refs.has(p)) refs.set(p, skip);
  }
  return refs;
}

/** Final ES-only sweep (docs older than the cutoff with no SQL row), throttled, as an async task. */
async function esSweep(elastic, field, before, variant, onProgress) {
  const res = unwrap(await elastic.client.deleteByQuery({
    index: elastic.indexName,
    conflicts: 'proceed',
    refresh: true,
    wait_for_completion: false,
    requests_per_second: 2000,
    slices: 'auto',
    body: { query: esRange(field, before, variant) },
  }));
  const taskId = res?.task;
  if (!taskId) return Number(res?.deleted || 0);
  for (;;) {
    await sleep(5000);
    const t = unwrap(await elastic.client.tasks.get({ task_id: taskId }));
    const status = t?.task?.status || {};
    onProgress(Number(status.deleted || 0), Number(status.total || 0));
    if (t?.completed) return Number(t?.response?.deleted ?? status.deleted ?? 0);
  }
}

// ── state (resumable) ───────────────────────────────────────────────────────
function stateDir(before) {
  const d = path.resolve(process.cwd(), 'data', 'purge-state', before);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function reportDir(before) {
  const d = path.resolve(process.cwd(), 'data', 'purge-reports', before);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function loadState(before, network, restart) {
  const f = path.join(stateDir(before), `${network}.json`);
  if (restart || !fs.existsSync(f)) return { cursor: 0, sqlDeleted: 0, esDeleted: 0, nasDeleted: 0, nasNotDeleted: 0, done: false };
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return { cursor: 0, sqlDeleted: 0, esDeleted: 0, nasDeleted: 0, nasNotDeleted: 0, done: false }; }
}
function saveState(before, network, state) {
  const f = path.join(stateDir(before), `${network}.json`);
  const tmp = `${f}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }, null, 2));
  fs.renameSync(tmp, f); // atomic: a crash never leaves a half-written state file
}

// ── one SQL batch ───────────────────────────────────────────────────────────
async function deleteSqlBatch(sql, main, children, ids) {
  const conn = await sql.getConnection();
  const marks = ids.map(() => '?').join(',');
  try {
    await conn.beginTransaction();
    for (const { table, col } of children) {
      try {
        await conn.execute(`DELETE FROM \`${table}\` WHERE \`${col}\` IN (${marks})`, ids);
      } catch (e) {
        if (!(e && (e.errno === 1146 || e.code === 'ER_NO_SUCH_TABLE'))) throw e;
      }
    }
    const [res] = await conn.execute(`DELETE FROM \`${main}\` WHERE id IN (${marks})`, ids);
    await conn.commit();
    return Number(res?.affectedRows || 0);
  } catch (e) {
    try { await conn.rollback(); } catch { /* keep original error */ }
    throw e;
  } finally {
    conn.release();
  }
}

// ── per-network purge ───────────────────────────────────────────────────────
let stopping = false;

async function purgeNetwork(job, opts, monitor) {
  const { network, spec, db, plan, status } = job;
  const state = loadState(opts.before, network, opts.restart);
  Object.assign(status, { state: 'running', ...state, startedAt: Date.now(), startDeleted: state.sqlDeleted });
  const nasLog = path.join(reportDir(opts.before), `${network}-nas-not-deleted.jsonl`);
  const idField = (spec.internalIdFields || [])[0];

  if (!spec.esOnly && !state.done) {
    const throttle = new Throttle({ initial: opts.batch, max: opts.maxBatch });
    status.batch = throttle.size;
    while (!stopping) {
      if (await monitor.busy()) {
        status.state = `paused (host busy: ${monitor.threadsRunning} running)`;
        throttle.next(0, true);
        status.batch = throttle.size;
        await sleep(throttle.pauseMs);
        continue;
      }
      status.state = 'running';
      const ids = rowsOf(await db.sql.query(
        `SELECT id FROM \`${spec.mainTable}\` WHERE id > ? AND \`${opts.dateColumn}\` < ? ORDER BY id LIMIT ${throttle.size}`,
        [state.cursor, plan.cutoff]
      )).map((r) => Number(r.id));
      if (!ids.length) break;

      const t0 = Date.now();
      const refs = opts.skipNas || opts.skipEs || !idField ? new Map() : await nasRefsForIds(db.elastic, idField, ids);
      state.sqlDeleted += await deleteSqlBatch(db.sql, spec.mainTable, plan.children, ids);
      if (idField && !opts.skipEs) state.esDeleted += await esDeleteByIds(db.elastic, idField, ids);
      if (refs.size) {
        const nas = await deleteNasForNetwork(network, db.elastic, refs, 8, { quiet: true });
        state.nasDeleted += nas.deleted;
        state.nasNotDeleted += nas.notDeleted.length;
        if (nas.notDeleted.length) fs.appendFileSync(nasLog, `${nas.notDeleted.map((x) => JSON.stringify(x)).join('\n')}\n`);
      }
      state.cursor = ids[ids.length - 1];
      saveState(opts.before, network, state);
      throttle.next(Date.now() - t0, false);
      Object.assign(status, state, { batch: throttle.size, lastBatchMs: Date.now() - t0 });
      await sleep(throttle.pauseMs);
    }
  }
  if (stopping) { status.state = 'stopped (resumable)'; return; }

  // ES docs older than the cutoff that had no SQL row (or TikTok, which is ES-only).
  if (!opts.skipEs && (opts.esSweep || spec.esOnly) && plan.esField) {
    status.state = 'es sweep';
    const swept = await esSweep(db.elastic, plan.esField, opts.before, plan.esVariant, (d, t) => {
      status.sweep = `${d}/${t}`;
    });
    state.esDeleted += swept;
  }
  state.done = true;
  saveState(opts.before, network, state);
  Object.assign(status, state, { state: 'done' });
}

// ── progress ────────────────────────────────────────────────────────────────
function fmtEta(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '-';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m ${Math.floor(sec % 60)}s`;
}
function printProgress(jobs, monitors) {
  const rows = jobs.map(({ network, plan, status }) => {
    const elapsed = (Date.now() - (status.startedAt || Date.now())) / 1000;
    const doneNow = (status.sqlDeleted || 0) - (status.startDeleted || 0);
    const rate = elapsed > 0 ? doneNow / elapsed : 0;
    const left = Math.max(0, (plan.sqlOld || 0) - (status.sqlDeleted || 0));
    return {
      network,
      host: plan.host,
      state: status.state || 'waiting',
      sql: `${status.sqlDeleted || 0}/${plan.sqlOld ?? '?'}`,
      es: status.esDeleted || 0,
      nas: `${status.nasDeleted || 0} (+${status.nasNotDeleted || 0} kept)`,
      'ads/s': rate ? rate.toFixed(1) : '-',
      batch: status.batch || '-',
      eta: status.state === 'done' ? '0' : (rate ? fmtEta(left / rate) : '-'),
      hostThreads: monitors.get(plan.host)?.threadsRunning ?? '-',
    };
  });
  console.log(`\n── ${new Date().toISOString()} ──`);
  console.table(rows);
}

// ── main ────────────────────────────────────────────────────────────────────
async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) { console.log(usage()); return { code: 0 }; }

  console.log(`Mode: ${opts.apply ? 'APPLY' : 'DRY-RUN (read-only)'}`);
  console.log(`Purge: ads with ${opts.dateColumn} < ${opts.before} (SQL <main table>.${opts.dateColumn}, ES <network>.${opts.dateColumn})`);
  console.log(`Elasticsearch: ${opts.skipEs ? 'NOT touched (--skip-es)' : 'deleted too'}`);
  console.log(`NAS: ${opts.skipNas ? 'kept (--skip-nas)' : `deleted (bucket ${nasBucket()}, via ${nasDeleteTransports().join('+') || 'NONE CONFIGURED'})`}`);

  if (opts.apply) {
    if (config.env !== 'production') throw new Error(`Refusing --apply: config.server.nodeEnv is "${config.env || 'unset'}", not "production".`);
    if (opts.confirm !== `PURGE_BEFORE:${opts.before}`) throw new Error(`Refusing --apply: --confirm must equal "PURGE_BEFORE:${opts.before}".`);
    if (!opts.skipNas && !nasDeleteTransports().length) throw new Error('Refusing --apply: no NAS delete transport configured (or use --skip-nas).');
  }

  const scoped = scopedNetworkConfig(opts.networks);
  if (opts.skipEs) {
    // SQL only: no Elasticsearch connection is even opened.
    for (const cfg of Object.values(scoped)) {
      cfg.database = { sql: cfg.database?.sql };
    }
  }
  await dbManager.connectAll(scoped);
  const monitors = new Map();
  try {
    // 1) plan every network (read-only)
    const jobs = [];
    for (const network of opts.networks) {
      const spec = NETWORKS[network];
      const db = dbManager.getConnections(network);
      const host = sqlHostKey(network);
      // ES compares the SAME column as SQL (e.g. facebook_ad.last_seen → facebook_ad.first_seen).
      const esField = ES_DATE_FIELD[network] ? ES_DATE_FIELD[network].replace(/last_seen$/, opts.dateColumn) : null;
      const plan = { host, children: [], skipped: [], esField, errors: [] };
      if (!monitors.has(host) && db?.sql) monitors.set(host, new HostMonitor(db.sql, opts.maxThreadsRunning));
      jobs.push({ network, spec, db, plan, status: {} });
    }
    // planning reads run per host group in parallel too (counts are chunked + throttled)
    const groups = new Map();
    for (const j of jobs) {
      if (!groups.has(j.plan.host)) groups.set(j.plan.host, []);
      groups.get(j.plan.host).push(j);
    }
    console.log(`\nSQL hosts (run in parallel; networks on one host run one after another):`);
    for (const [host, list] of groups) console.log(`  ${host}: ${list.map((j) => j.network).join(' → ')}`);
    console.log('\nPlanning (counts are read in small chunks)…');

    await Promise.all([...groups.values()].map(async (list) => {
      for (const j of list) {
        const { network, spec, db, plan } = j;
        try {
          if (!opts.skipEs && db?.elastic && plan.esField) {
            const es = await esCountOld(db.elastic, plan.esField, opts.before);
            plan.esOld = es.count;
            plan.esVariant = es.variant;
          }
          if (spec.esOnly) { plan.sqlOld = 0; continue; }
          if (!db?.sql) throw new Error('SQL connection unavailable');
          const info = await dateColumnInfo(db.sql, spec.mainTable, opts.dateColumn);
          if (!info) throw new Error(`${spec.mainTable}.${opts.dateColumn} does not exist`);
          plan.dateType = info.type;
          plan.dateIndexed = info.indexed;
          plan.cutoff = cutoffValue(opts.before, info.type);
          Object.assign(plan, await discoverChildTables(db.sql, network, spec, opts.exclude));
          plan.sqlOld = await countOld(db.sql, spec.mainTable, opts.dateColumn, plan.cutoff, monitors.get(plan.host));
        } catch (e) {
          plan.errors.push(e.message);
        }
      }
    }));

    // 2) show the plan
    console.table(jobs.map(({ network, spec, plan }) => ({
      network,
      host: plan.host,
      mainTable: spec.mainTable || '(ES only)',
      sqlOld: plan.sqlOld ?? '-',
      esOld: plan.esOld ?? '-',
      childTables: plan.children.length,
      dateIndexed: plan.dateIndexed === undefined ? '-' : (plan.dateIndexed ? 'yes' : 'no'),
      // rough: ~150 ads/s per network on a quiet host; the live run shows the real ETA
      estimate: plan.sqlOld ? `~${fmtEta(plan.sqlOld / 150)}` : '-',
      error: plan.errors.join('; ').slice(0, 70) || '',
    })));
    for (const { network, plan } of jobs) {
      if (plan.children.length) console.log(`  ${network} child tables: ${plan.children.map((c) => `${c.table}.${c.col}`).join(', ')}`);
      if (plan.skipped.length) console.log(`  ${network} NOT purged: ${plan.skipped.map((s) => `${s.table} (${s.reason})`).join(', ')}`);
    }
    // per host the networks run one after another → the host's estimate is the sum
    for (const [host, list] of groups) {
      const total = list.reduce((n, j) => n + (j.plan.sqlOld || 0), 0);
      console.log(`  host ${host}: ~${fmtEta(total / 150)} for ${total} ads (approximate)`);
    }

    const failed = jobs.filter((j) => j.plan.errors.length);
    if (!opts.apply) {
      console.log('\nDry-run: nothing was deleted.');
      if (failed.length) console.log(`Fix or leave out with --networks: ${failed.map((j) => j.network).join(', ')}`);
      console.log(`Apply with: --apply --confirm "PURGE_BEFORE:${opts.before}"`);
      return { code: 0, dryRun: true, jobs };
    }
    if (failed.length) throw new Error(`Refusing --apply: planning failed for ${failed.map((j) => `${j.network} (${j.plan.errors.join('; ')})`).join(', ')}. Fix it or leave it out with --networks.`);

    // 3) apply: host groups in parallel, networks within a group sequential
    process.on('SIGINT', () => {
      if (stopping) process.exit(130);
      stopping = true;
      console.log('\nStopping after the current batch (progress is saved; re-run to resume)… Ctrl+C again to force.');
    });
    const timer = setInterval(() => printProgress(jobs, monitors), 5000);
    const results = await Promise.all([...groups.values()].map(async (list) => {
      for (const j of list) {
        if (stopping) break;
        try {
          await purgeNetwork(j, opts, monitors.get(j.plan.host));
        } catch (e) {
          j.status.state = `FAILED: ${e.message}`.slice(0, 120);
        }
      }
    }));
    clearInterval(timer);
    printProgress(jobs, monitors);
    console.log(`\n${stopping ? 'Stopped — re-run the same command to resume.' : 'Done.'} Progress: data/purge-state/${opts.before}/  NAS kept/failed lists: data/purge-reports/${opts.before}/`);
    return { code: jobs.some((j) => String(j.status.state).startsWith('FAILED')) ? 1 : 0, results };
  } finally {
    await closeNas();
    await dbManager.disconnectAll();
  }
}

if (require.main === module) {
  main().then(
    (r) => { process.exitCode = r.code; },
    (e) => { console.error(`FAILED: ${e.message}`); process.exitCode = 1; }
  );
}

module.exports = { parseArgs, Throttle, sqlHostKey, cutoffValue, discoverChildTables, deleteSqlBatch, esDeleteByIds, esRange, SKIP_TABLE, ES_DATE_FIELD, main };
