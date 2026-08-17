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
const logger = require('../logger');

const log = logger.createChild('admin-live-watcher');

const DIR = path.join(process.cwd(), (config.localCache && config.localCache.dir) || 'data');
const CONFIG_FILE = path.join(DIR, 'live-watcher-config.json');
const HISTORY_FILE = path.join(DIR, 'live-watcher-spikes.json');

const HISTORY_WINDOW_MS = 24 * 60 * 60 * 1000; // "recycle" — only last 1 day is ever kept
const MAX_HISTORY_EVENTS = 500; // defensive cap in case of flapping
const POLL_INTERVAL_MS = 8000; // background collector cadence — cheap checks only
const ES_TIMEOUT_MS = 4000;

const DEFAULT_CONFIG = {
  esCpuThresholdPct: 80,
  sqlLoadThresholdPct: 80,
};

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
  const stats = await esCall(client, 'nodes.stats', { metric: ['os'] }, { requestTimeout: ES_TIMEOUT_MS });
  let maxCpu = 0;
  let maxLoad = 0;
  for (const node of Object.values(stats.nodes || {})) {
    const cpu = node.os?.cpu?.percent;
    const load = node.os?.cpu?.load_average?.['1m'];
    if (Number.isFinite(cpu)) maxCpu = Math.max(maxCpu, cpu);
    if (Number.isFinite(load)) maxLoad = Math.max(maxLoad, load);
  }
  return { cpuPct: maxCpu, load1m: maxLoad };
}

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
        description: String(task.description || '').slice(0, 300),
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

async function captureEsDetail(client) {
  const [tasks, threadPool] = await Promise.all([
    getEsLiveTasks(client).catch((e) => ({ error: e.message })),
    getEsThreadPool(client).catch((e) => ({ error: e.message })),
  ]);
  const topTasks = Array.isArray(tasks) ? tasks.slice(0, 10) : tasks;
  return { topTasks, threadPool };
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
      info: String(r.Info || '').slice(0, 300),
    }))
    .sort((a, b) => b.timeSec - a.timeSec);
}

async function captureSqlDetail(sql) {
  const rows = await getSqlLiveQueries(sql).catch((e) => ({ error: e.message }));
  return { topQueries: Array.isArray(rows) ? rows.slice(0, 10) : rows };
}

// ─── background collector — cheap checks every tick, heavy capture only on threshold-cross ───

const spikeState = new Map(); // key `${slug}:${type}` -> { startedAt, peak, detail }

async function updateSpikeState(slug, type, value, threshold, captureDetailFn) {
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
    } else if (value > existing.peak) {
      existing.peak = value;
    }
  } else if (existing) {
    recordSpikeEvent({
      network: slug,
      type,
      startedAt: existing.startedAt,
      endedAt: now,
      durationMs: now - existing.startedAt,
      peak: existing.peak,
      threshold,
      detail: existing.detail,
    });
    spikeState.delete(key);
    log.info(`[live-watcher] spike end: ${key} peak=${existing.peak.toFixed(1)} durationMs=${now - existing.startedAt}`);
  }
}

async function checkNetworkEs(slug, elastic, cfg) {
  try {
    const { cpuPct } = await getEsLoad(elastic.client);
    await updateSpikeState(slug, 'es', cpuPct, cfg.esCpuThresholdPct, () => captureEsDetail(elastic.client));
  } catch (e) {
    // Never let a monitoring failure surface as an app error — this is best-effort observability.
    log.debug(`[live-watcher] es check failed for ${slug}: ${e.message}`);
  }
}

async function checkNetworkSql(slug, sql, cfg) {
  try {
    const { loadPct } = await getSqlLoad(sql);
    await updateSpikeState(slug, 'sql', loadPct, cfg.sqlLoadThresholdPct, () => captureSqlDetail(sql));
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
