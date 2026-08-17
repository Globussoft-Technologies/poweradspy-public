'use strict';

/**
 * ES & SQL Live Watcher — per-network real-time view of what's currently
 * running on Elasticsearch and MySQL, with the ability to cancel/kill a
 * specific request, plus an auto-recycled (24h) history of load spikes.
 *
 * Two very different access patterns live in this one file:
 *
 * 1. On-demand "live now" (GET .../now) — called only while an admin has the
 *    watcher tab open (polled client-side every few seconds). Uses the same
 *    metadata-only calls already proven safe/cheap in
 *    scripts/diagnose-network-es.js and scripts/diagnose-google-load.js
 *    (nodes.stats, tasks.list, SHOW FULL PROCESSLIST) — none of these touch
 *    index/table data, so cost is independent of how loaded the cluster/DB
 *    already is.
 *
 * 2. A background collector (setInterval, POLL_INTERVAL_MS) that runs
 *    regardless of whether anyone has the tab open. It only ever does the
 *    cheapest possible check per tick (nodes.stats os.cpu / Threads_running)
 *    and only pays for the heavier detail capture (tasks.list / processlist)
 *    once, at the moment a configurable threshold is first crossed — not on
 *    every tick. This is the piece the user was explicit must never become a
 *    new source of load on ES/SQL, so it deliberately stays minimal.
 *
 * Spike events (start/end/peak/what-was-running) are persisted to a small
 * JSON file pruned to the last 24h — modeled directly on
 * src/insertion/helpers/nasStorageHistory.js's atomic write pattern — so a
 * human (or an AI agent) can later see "what was running when it spiked"
 * without wading through continuous raw metrics.
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('../config');
const databaseManager = require('../database/DatabaseManager');
const { requireEditorRole } = require('./adminAuth');
const { sendTelegramAlert } = require('../utils/telegram');
const logger = require('../logger');

const log = logger.createChild('admin-live-watcher');

const DIR = path.join(process.cwd(), (config.localCache && config.localCache.dir) || 'data');
const CONFIG_FILE = path.join(DIR, 'live-watcher-config.json');
const HISTORY_FILE = path.join(DIR, 'live-watcher-spikes.json');

const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000; // "recycle" — only last 1 day is ever kept
const MAX_HISTORY_EVENTS = 500; // defensive cap in case of flapping
// Lowered 8000 -> 3000 (2026-08-17): real dashboard searches complete in
// 0.1-0.3s, so an 8s poll was missing almost everything between ticks. Still
// metadata-only calls (tasks.list / SHOW FULL PROCESSLIST) — same cost class
// already proven safe, just sampled more often so "recent queries" actually
// has something to show.
const POLL_INTERVAL_MS = 3000;
const ES_TIMEOUT_MS = 4000;
const GUARD_COOLDOWN_MS = 30000; // don't re-attempt cancel/kill on the same id every tick

const DEFAULT_CONFIG = {
  esCpuThresholdPct: 80,
  sqlLoadThresholdPct: 80,
  telegramAlertsEnabled: false,
  queryGuardEnabled: false,
  queryGuardMaxRunningSec: 20,
};

function escapeTg(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ─── tiny atomic JSON read/write (same pattern as nasStorageHistory.js) ───

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJson(file, obj) {
  try {
    if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, file);
  } catch (e) {
    log.warn('live-watcher JSON write failed', { file, error: e.message });
  }
}

// ─── admin-configurable threshold ──────────────────────────────────────

function getConfig() {
  const stored = readJson(CONFIG_FILE, null);
  return { ...DEFAULT_CONFIG, ...(stored || {}) };
}

function setConfig(partial) {
  const next = { ...getConfig() };
  if (Number.isFinite(partial.esCpuThresholdPct)) {
    next.esCpuThresholdPct = Math.min(100, Math.max(1, partial.esCpuThresholdPct));
  }
  if (Number.isFinite(partial.sqlLoadThresholdPct)) {
    next.sqlLoadThresholdPct = Math.min(100, Math.max(1, partial.sqlLoadThresholdPct));
  }
  if (typeof partial.telegramAlertsEnabled === 'boolean') {
    next.telegramAlertsEnabled = partial.telegramAlertsEnabled;
  }
  if (typeof partial.queryGuardEnabled === 'boolean') {
    next.queryGuardEnabled = partial.queryGuardEnabled;
  }
  if (Number.isFinite(partial.queryGuardMaxRunningSec)) {
    next.queryGuardMaxRunningSec = Math.max(5, Math.min(300, partial.queryGuardMaxRunningSec));
  }
  writeJson(CONFIG_FILE, next);
  return next;
}

// ─── spike history (24h auto-recycled) ─────────────────────────────────

function recordSpikeEvent(event) {
  const all = readJson(HISTORY_FILE, []);
  const now = Date.now();
  const pruned = (Array.isArray(all) ? all : [])
    .filter((e) => now - e.startedAt < HISTORY_WINDOW_MS);
  pruned.push(event);
  // Keep newest MAX_HISTORY_EVENTS if something is flapping badly.
  const trimmed = pruned.length > MAX_HISTORY_EVENTS
    ? pruned.slice(pruned.length - MAX_HISTORY_EVENTS)
    : pruned;
  writeJson(HISTORY_FILE, trimmed);
}

function getSpikeHistory({ network, type, hours } = {}) {
  const all = readJson(HISTORY_FILE, []);
  const now = Date.now();
  const windowMs = Math.min(HISTORY_WINDOW_MS, Math.max(1, hours || 24) * 60 * 60 * 1000);
  return (Array.isArray(all) ? all : [])
    .filter((e) => now - e.startedAt < windowMs)
    .filter((e) => !network || e.network === network)
    .filter((e) => !type || e.type === type)
    .sort((a, b) => b.startedAt - a.startedAt);
}

// ─── ES helpers ─────────────────────────────────────────────────────────

async function esCall(client, fnPath, params, opts) {
  const fn = fnPath.split('.').reduce((o, k) => o[k], client);
  const resp = await fn.call(client, params, opts);
  return resp.body || resp;
}

async function getEsLoad(client) {
  // os + jvm in one call (not two) — jvm.mem.heap_used_percent is the closest
  // thing ES exposes to "RAM used" per node; there's no per-node resident-set
  // metric here worth a second round trip for.
  const stats = await esCall(client, 'nodes.stats', { metric: ['os', 'jvm'] }, { requestTimeout: ES_TIMEOUT_MS });
  let maxCpu = 0;
  let maxLoad = 0;
  let maxHeapPct = 0;
  for (const node of Object.values(stats.nodes || {})) {
    const cpu = node.os?.cpu?.percent;
    const load = node.os?.cpu?.load_average?.['1m'];
    const heapPct = node.jvm?.mem?.heap_used_percent;
    if (Number.isFinite(cpu)) maxCpu = Math.max(maxCpu, cpu);
    if (Number.isFinite(load)) maxLoad = Math.max(maxLoad, load);
    if (Number.isFinite(heapPct)) maxHeapPct = Math.max(maxHeapPct, heapPct);
  }
  return { cpuPct: maxCpu, load1m: maxLoad, heapUsedPct: maxHeapPct };
}

// Description cap is generous (not the old 300 chars) so "view full query"
// in the UI actually shows the real query — ES itself already caps a task's
// own description internally, this just avoids ALSO truncating it further.
const DESCRIPTION_CAP = 8000;

async function getEsLiveTasks(client) {
  const tasksResp = await esCall(
    client,
    'tasks.list',
    { detailed: true, actions: 'indices:data/read/search' },
    { requestTimeout: ES_TIMEOUT_MS },
  );
  const running = [];
  for (const [nodeId, node] of Object.entries(tasksResp.nodes || {})) {
    for (const [taskId, task] of Object.entries(node.tasks || {})) {
      if (task.action !== 'indices:data/read/search') continue;
      running.push({
        taskId,
        nodeId,
        runningSec: Math.round((task.running_time_in_nanos || 0) / 1e8) / 10,
        description: String(task.description || '').slice(0, DESCRIPTION_CAP),
      });
    }
  }
  running.sort((a, b) => b.runningSec - a.runningSec);
  return running;
}

async function getEsThreadPool(client) {
  const stats = await esCall(client, 'nodes.stats', { metric: ['thread_pool'] }, { requestTimeout: ES_TIMEOUT_MS });
  const pools = [];
  for (const node of Object.values(stats.nodes || {})) {
    for (const pool of ['search', 'write', 'bulk', 'get']) {
      const tp = node.thread_pool?.[pool];
      if (tp) pools.push({ node: node.name, pool, active: tp.active, queue: tp.queue, rejected: tp.rejected });
    }
  }
  return pools;
}

// ─── SQL helpers ────────────────────────────────────────────────────────

async function getSqlLoad(sql) {
  const [threadsRows, maxConnRows] = await Promise.all([
    sql.query("SHOW GLOBAL STATUS LIKE 'Threads_running'"),
    sql.query("SHOW VARIABLES LIKE 'max_connections'"),
  ]);
  const threadsRunning = Number(threadsRows?.[0]?.Value || 0);
  const maxConnections = Number(maxConnRows?.[0]?.Value || 151);
  const loadPct = Math.min(100, (threadsRunning / maxConnections) * 100);
  return { threadsRunning, maxConnections, loadPct };
}

async function getSqlLiveQueries(sql) {
  const rows = await sql.query('SHOW FULL PROCESSLIST');
  return rows
    .filter((r) => r.Command && r.Command !== 'Sleep' && r.Info)
    .map((r) => ({
      id: r.Id,
      user: r.User,
      host: r.Host,
      db: r.db,
      command: r.Command,
      timeSec: r.Time,
      state: r.State,
      info: String(r.Info || '').slice(0, DESCRIPTION_CAP),
    }))
    .sort((a, b) => b.timeSec - a.timeSec);
}

// ─── recent-queries history (2026-08-17) ───────────────────────────────────
// "Running Now" only ever shows what's active at the exact instant someone
// looks — queries routinely finish between one 8s tick and the next, so the
// panel reads "nothing running" almost all the time even on a busy cluster.
// This keeps the last RECENT_MAX queries the collector has actually SEEN
// (captured every tick, not just on a threshold-cross), per network, so the
// admin always has real recent activity to look at — not just empty-handed
// "no tasks right now" between polls. Same tasks.list/processlist calls
// already proven safe/cheap; just recorded every tick instead of discarded.
const RECENT_MAX = 15;
const recentEsQueries = new Map(); // slug -> array (most recent first)
const recentSqlQueries = new Map(); // slug -> array (most recent first)

function pushRecent(map, slug, items, idKey) {
  if (!items.length) return;
  const existing = map.get(slug) || [];
  const byId = new Map(existing.map((e) => [e[idKey], e]));
  for (const item of items) byId.set(item[idKey], item); // refresh if still running, add if new
  const merged = [...byId.values()].sort((a, b) => b.capturedAt - a.capturedAt);
  map.set(slug, merged.slice(0, RECENT_MAX));
}

// ─── CPU/RAM metrics history (last 1h, 2026-08-17) ─────────────────────────
// One point per collector tick per network — enough for a simple "last hour"
// sparkline without storing anything long-term or hitting disk.
const METRICS_HISTORY_MAX = Math.ceil((60 * 60 * 1000) / POLL_INTERVAL_MS); // ~450 @ 8s
const metricsHistory = new Map(); // slug -> { es: [{ts,cpuPct,heapUsedPct,load1m}], sql: [{ts,loadPct,threadsRunning}] }

function pushMetricPoint(slug, type, point) {
  const entry = metricsHistory.get(slug) || { es: [], sql: [] };
  entry[type].push(point);
  if (entry[type].length > METRICS_HISTORY_MAX) entry[type].splice(0, entry[type].length - METRICS_HISTORY_MAX);
  metricsHistory.set(slug, entry);
}

function getMetricsHistory(slug, minutes) {
  const entry = metricsHistory.get(slug) || { es: [], sql: [] };
  const cutoff = Date.now() - Math.min(60, Math.max(1, minutes || 60)) * 60 * 1000;
  return {
    es: entry.es.filter((p) => p.ts >= cutoff),
    sql: entry.sql.filter((p) => p.ts >= cutoff),
  };
}

// ─── background collector — cheap checks every tick, heavy capture only on threshold-cross ───

const spikeState = new Map(); // key `${slug}:${type}` -> { startedAt, peak, detail }

async function updateSpikeState(slug, type, value, threshold, captureDetailFn, cfg) {
  const key = `${slug}:${type}`;
  const existing = spikeState.get(key);
  const now = Date.now();

  if (value >= threshold) {
    if (!existing) {
      let detail = null;
      try {
        detail = await captureDetailFn();
      } catch (e) {
        detail = { error: e.message };
      }
      spikeState.set(key, { startedAt: now, peak: value, detail });
      log.warn(`[live-watcher] spike start: ${key} value=${value.toFixed(1)} threshold=${threshold}`);
      if (cfg && cfg.telegramAlertsEnabled) {
        sendTelegramAlert(
          `⚠️ <b>Live Watcher Spike</b>\n\nNetwork: <b>${escapeTg(slug)}</b>\nType: ${escapeTg(type.toUpperCase())}\nValue: ${value.toFixed(1)}% (threshold ${threshold}%)\nStarted: ${new Date(now).toISOString()}`,
        );
      }
    } else if (value > existing.peak) {
      existing.peak = value;
    }
  } else if (existing) {
    const durationMs = now - existing.startedAt;
    recordSpikeEvent({
      network: slug,
      type,
      startedAt: existing.startedAt,
      endedAt: now,
      durationMs,
      peak: existing.peak,
      threshold,
      detail: existing.detail,
    });
    spikeState.delete(key);
    log.info(`[live-watcher] spike end: ${key} peak=${existing.peak.toFixed(1)} durationMs=${durationMs}`);
    if (cfg && cfg.telegramAlertsEnabled) {
      sendTelegramAlert(
        `✅ <b>Live Watcher Spike Resolved</b>\n\nNetwork: <b>${escapeTg(slug)}</b>\nType: ${escapeTg(type.toUpperCase())}\nPeak: ${existing.peak.toFixed(1)}%\nDuration: ${Math.round(durationMs / 1000)}s`,
      );
    }
  }
}

// ─── Query Guard (opt-in, 2026-08-17) ──────────────────────────────────────
// Auto-cancels/kills anything still running past queryGuardMaxRunningSec.
// Off by default — an admin must explicitly turn it on. Normal queries on
// this cluster complete in 0.1-0.3s (confirmed via profile:true this
// session), so anything past even 20s is already far outside normal
// behavior, not a false-positive risk for real traffic. A per-id cooldown
// stops it from re-issuing cancel/kill on the same id every tick while ES/
// MySQL are still acting on the previous request.
const guardCooldown = new Map(); // `${slug}:${type}:${id}` -> last attempt ts

function guardShouldAttempt(slug, type, id) {
  const key = `${slug}:${type}:${id}`;
  const last = guardCooldown.get(key) || 0;
  if (Date.now() - last < GUARD_COOLDOWN_MS) return false;
  guardCooldown.set(key, Date.now());
  return true;
}

async function runQueryGuardEs(slug, elastic, tasks, cfg) {
  if (!cfg.queryGuardEnabled) return;
  const maxSec = cfg.queryGuardMaxRunningSec;
  for (const t of tasks) {
    if (t.runningSec < maxSec) continue;
    if (!guardShouldAttempt(slug, 'es', t.taskId)) continue;
    try {
      await esCall(elastic.client, 'tasks.cancel', { taskId: t.taskId }, { requestTimeout: ES_TIMEOUT_MS });
      log.warn('[live-watcher] Query Guard auto-cancelled ES task', { network: slug, taskId: t.taskId, runningSec: t.runningSec });
      if (cfg.telegramAlertsEnabled) {
        sendTelegramAlert(
          `🛡️ <b>Query Guard — auto-cancelled</b>\n\nNetwork: <b>${escapeTg(slug)}</b> (Elasticsearch)\nRunning: ${t.runningSec}s (limit ${maxSec}s)\nTask: <code>${escapeTg(t.taskId)}</code>\nQuery: <code>${escapeTg(t.description.slice(0, 300))}</code>`,
        );
      }
    } catch (e) {
      log.debug(`[live-watcher] Query Guard ES cancel failed: ${e.message}`);
    }
  }
}

async function runQueryGuardSql(slug, sql, queries, cfg) {
  if (!cfg.queryGuardEnabled) return;
  const maxSec = cfg.queryGuardMaxRunningSec;
  for (const q of queries) {
    if (q.timeSec < maxSec) continue;
    const processId = Number(q.id);
    if (!Number.isInteger(processId) || processId <= 0) continue;
    if (!guardShouldAttempt(slug, 'sql', processId)) continue;
    try {
      // Literal, not bound — see the manual /sql/kill route's comment; safe
      // here because processId is validated as a strictly positive integer.
      await sql.query(`KILL QUERY ${processId}`);
      log.warn('[live-watcher] Query Guard auto-killed SQL query', { network: slug, id: processId, timeSec: q.timeSec });
      if (cfg.telegramAlertsEnabled) {
        sendTelegramAlert(
          `🛡️ <b>Query Guard — auto-killed</b>\n\nNetwork: <b>${escapeTg(slug)}</b> (MySQL)\nRunning: ${q.timeSec}s (limit ${maxSec}s)\nId: ${processId}\nQuery: <code>${escapeTg(q.info.slice(0, 300))}</code>`,
        );
      }
    } catch (e) {
      log.debug(`[live-watcher] Query Guard SQL kill failed: ${e.message}`);
    }
  }
}

async function checkNetworkEs(slug, elastic, cfg) {
  try {
    const now = Date.now();
    const [{ cpuPct, load1m, heapUsedPct }, tasks] = await Promise.all([
      getEsLoad(elastic.client),
      getEsLiveTasks(elastic.client).catch(() => []),
    ]);
    // cpuAtCapture: not a per-query metric (ES doesn't expose one) — it's the
    // cluster-wide CPU reading at the same instant this query was seen, so
    // the "recent queries" view can at least show what the cluster looked
    // like when each entry was captured.
    pushRecent(recentEsQueries, slug, tasks.map((t) => ({ ...t, capturedAt: now, cpuAtCapture: cpuPct })), 'taskId');
    pushMetricPoint(slug, 'es', { ts: now, cpuPct, load1m, heapUsedPct });
    await runQueryGuardEs(slug, elastic, tasks, cfg);
    // Reuses the SAME tasks.list result for spike detail instead of a second
    // call — a spike-start only needs to add the (cheap) thread-pool stats.
    await updateSpikeState(slug, 'es', cpuPct, cfg.esCpuThresholdPct, async () => {
      const threadPool = await getEsThreadPool(elastic.client).catch((e) => ({ error: e.message }));
      return { topTasks: tasks.slice(0, 10), threadPool };
    }, cfg);
  } catch (e) {
    // Never let a monitoring failure surface as an app error — this is best-effort observability.
    log.debug(`[live-watcher] es check failed for ${slug}: ${e.message}`);
  }
}

async function checkNetworkSql(slug, sql, cfg) {
  try {
    const now = Date.now();
    const [{ loadPct, threadsRunning, maxConnections }, queries] = await Promise.all([
      getSqlLoad(sql),
      getSqlLiveQueries(sql).catch(() => []),
    ]);
    pushRecent(recentSqlQueries, slug, queries.map((q) => ({ ...q, capturedAt: now, loadAtCapture: loadPct })), 'id');
    pushMetricPoint(slug, 'sql', { ts: now, loadPct, threadsRunning, maxConnections });
    await runQueryGuardSql(slug, sql, queries, cfg);
    await updateSpikeState(slug, 'sql', loadPct, cfg.sqlLoadThresholdPct, async () => ({ topQueries: queries.slice(0, 10) }), cfg);
  } catch (e) {
    log.debug(`[live-watcher] sql check failed for ${slug}: ${e.message}`);
  }
}

let collectorTimer = null;
let ticking = false;

async function tick() {
  if (ticking) return; // never overlap two ticks if a network is slow to respond
  ticking = true;
  try {
    if (!databaseManager.initialized) return;
    const cfg = getConfig();
    const health = databaseManager.getHealth();
    for (const slug of Object.keys(health)) {
      const conns = databaseManager.getConnections(slug);
      if (!conns) continue;
      // eslint-disable-next-line no-await-in-loop
      if (conns.elastic) await checkNetworkEs(slug, conns.elastic, cfg);
      // eslint-disable-next-line no-await-in-loop
      if (conns.sql) await checkNetworkSql(slug, conns.sql, cfg);
    }
  } catch (e) {
    log.warn('[live-watcher] collector tick failed', { error: e.message });
  } finally {
    ticking = false;
  }
}

function startCollector() {
  if (collectorTimer) return;
  collectorTimer = setInterval(tick, POLL_INTERVAL_MS);
  if (collectorTimer.unref) collectorTimer.unref(); // never keep the process alive on its own
  log.info(`[live-watcher] background collector started (every ${POLL_INTERVAL_MS}ms)`);
}

// ─── routes ─────────────────────────────────────────────────────────────

const router = express.Router();

router.get('/networks', (req, res) => {
  const health = databaseManager.getHealth();
  const networks = Object.keys(health).map((slug) => ({
    slug,
    hasSql: health[slug].sql?.status === 'connected',
    hasElastic: health[slug].elastic?.status === 'connected',
  }));
  res.json({ code: 200, data: networks });
});

router.get('/config', (req, res) => {
  res.json({ code: 200, data: getConfig() });
});

router.put('/config', requireEditorRole, express.json(), (req, res) => {
  const next = setConfig(req.body || {});
  res.json({ code: 200, data: next });
});

router.get('/history', (req, res) => {
  const { network, type } = req.query;
  const hours = parseInt(req.query.hours, 10) || 24;
  const events = getSpikeHistory({ network, type, hours });
  res.json({ code: 200, data: events });
});

// Last RECENT_MAX queries the collector has actually observed for this
// network (ES + SQL), refreshed every collector tick — not just whatever
// happens to be running at the exact moment this endpoint is called.
router.get('/:network/recent', (req, res) => {
  const { network } = req.params;
  res.json({
    code: 200,
    data: {
      es: recentEsQueries.get(network) || [],
      sql: recentSqlQueries.get(network) || [],
    },
  });
});

// Last-hour CPU/heap(RAM)/SQL-load time series for the sparkline charts.
router.get('/:network/metrics-history', (req, res) => {
  const { network } = req.params;
  const minutes = parseInt(req.query.minutes, 10) || 60;
  res.json({ code: 200, data: getMetricsHistory(network, minutes) });
});

router.get('/:network/now', async (req, res) => {
  const { network } = req.params;
  const conns = databaseManager.getConnections(network);
  if (!conns) return res.status(404).json({ code: 404, message: `Unknown network: ${network}` });

  const [es, sql] = await Promise.all([
    conns.elastic
      ? Promise.all([getEsLoad(conns.elastic.client), getEsLiveTasks(conns.elastic.client), getEsThreadPool(conns.elastic.client)])
        .then(([load, tasks, threadPool]) => ({ ...load, liveTasks: tasks.slice(0, 25), threadPool }))
        .catch((e) => ({ error: e.message }))
      : null,
    conns.sql
      ? Promise.all([getSqlLoad(conns.sql), getSqlLiveQueries(conns.sql)])
        .then(([load, queries]) => ({ ...load, liveQueries: queries.slice(0, 25) }))
        .catch((e) => ({ error: e.message }))
      : null,
  ]);

  const cfg = getConfig();
  res.json({
    code: 200,
    data: {
      network,
      threshold: cfg,
      es,
      sql,
      inSpike: {
        es: spikeState.has(`${network}:es`),
        sql: spikeState.has(`${network}:sql`),
      },
    },
  });
});

router.post('/:network/es/cancel', requireEditorRole, express.json(), async (req, res) => {
  const { network } = req.params;
  const { taskId } = req.body || {};
  if (!taskId || typeof taskId !== 'string') {
    return res.status(400).json({ code: 400, message: 'taskId is required' });
  }
  const elastic = databaseManager.getElastic(network);
  if (!elastic) return res.status(404).json({ code: 404, message: `No Elasticsearch connection for ${network}` });

  try {
    await esCall(elastic.client, 'tasks.cancel', { taskId }, { requestTimeout: ES_TIMEOUT_MS });
    log.warn(`[live-watcher] ES task cancelled by admin`, { network, taskId, admin: req.adminSession?.username });
    res.json({ code: 200, data: { cancelled: taskId } });
  } catch (e) {
    res.status(500).json({ code: 500, message: e.message });
  }
});

router.post('/:network/sql/kill', requireEditorRole, express.json(), async (req, res) => {
  const { network } = req.params;
  const { id } = req.body || {};
  const processId = Number(id);
  if (!Number.isInteger(processId) || processId <= 0) {
    return res.status(400).json({ code: 400, message: 'id must be a positive integer process id' });
  }
  const sql = databaseManager.getSQL(network);
  if (!sql) return res.status(404).json({ code: 404, message: `No SQL connection for ${network}` });

  try {
    // MySQL's KILL statement does not accept a bound/prepared parameter for the
    // process id — it must be a literal. Safe here because processId is
    // validated above as a strictly positive integer, not raw user text.
    await sql.query(`KILL QUERY ${processId}`);
    log.warn(`[live-watcher] SQL query killed by admin`, { network, processId, admin: req.adminSession?.username });
    res.json({ code: 200, data: { killed: processId } });
  } catch (e) {
    res.status(500).json({ code: 500, message: e.message });
  }
});

startCollector();

module.exports = { router, startCollector, getConfig, setConfig, getSpikeHistory };
