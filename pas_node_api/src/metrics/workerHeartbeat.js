'use strict';

/**
 * Per-worker heartbeat — makes every process (not just the one that happens
 * to answer an admin request) visible on the admin Dashboard: which worker
 * IDs/PIDs are alive right now, each one's own CPU/RAM/active-connections/
 * request-count, independent of which deployment layer(s) are in play
 * (this app's own internal cluster.fork(), PM2's own `-i N`, both, or
 * neither — see clusterWorkerIdentity.js's isSingletonOwner() for the full
 * reasoning on why those two layers can't be assumed away).
 *
 * Unlike Live Watcher's collector (which only ONE singleton-owner process
 * should run, see liveWatcher.js), heartbeat must run on EVERY process —
 * each one reports only itself, keyed by its own OS pid (always unique,
 * regardless of which clustering layer(s) assigned it a WORKER_ID/
 * NODE_APP_INSTANCE or neither). Same atomic read-merge-write file pattern
 * already proven this session for liveWatcher.js's RECENT_FILE.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const config = require('../config');
const metrics = require('./MetricsCollector');

const DIR = path.join(process.cwd(), (config.localCache && config.localCache.dir) || 'data');
const WORKERS_FILE = path.join(DIR, 'worker-heartbeats.json');

const HEARTBEAT_INTERVAL_MS = 5000;
const STALE_AFTER_MS = 20000; // ~4 missed ticks before a worker is shown as stale
const PRUNE_AFTER_MS = 10 * 60 * 1000; // drop long-dead (crashed/replaced) workers from the file entirely

let lastCpuUsage = null;
let lastCpuAt = 0;

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
    // best-effort — never let heartbeat writes surface as an app error
  }
}

// Cheap self CPU% — diffs process.cpuUsage() (user+system microseconds)
// against the wall-clock time elapsed since the last tick. Expressed as a
// percentage of ONE core (100% = fully saturating one core), matching how
// `top`/`htop` report a single process.
function selfCpuPercent() {
  const now = Date.now();
  const usage = process.cpuUsage();
  let pct = 0;
  if (lastCpuUsage && lastCpuAt) {
    const elapsedMs = now - lastCpuAt;
    const usedMicros = (usage.user - lastCpuUsage.user) + (usage.system - lastCpuUsage.system);
    if (elapsedMs > 0) pct = Math.round((usedMicros / 1000 / elapsedMs) * 1000) / 10;
  }
  lastCpuUsage = usage;
  lastCpuAt = now;
  return pct;
}

function beat() {
  const stored = readJson(WORKERS_FILE, {});
  const now = Date.now();
  for (const [pid, w] of Object.entries(stored)) {
    if (now - (w.lastHeartbeatAt || 0) > PRUNE_AFTER_MS) delete stored[pid];
  }
  const mem = process.memoryUsage();
  stored[String(process.pid)] = {
    pid: process.pid,
    workerId: process.env.WORKER_ID || null,
    nodeAppInstance: process.env.NODE_APP_INSTANCE ?? null,
    startedAt: new Date(now - process.uptime() * 1000).toISOString(),
    uptimeSec: Math.floor(process.uptime()),
    cpuPercent: selfCpuPercent(),
    memory: { rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal },
    activeConnections: metrics.activeConnections,
    requestsSinceStart: metrics.totalRequestsReceivedSinceStartup,
    lastHeartbeatAt: now,
  };
  writeJson(WORKERS_FILE, stored);
}

function startWorkerHeartbeat() {
  beat(); // report immediately instead of waiting a full interval
  const timer = setInterval(beat, HEARTBEAT_INTERVAL_MS);
  if (timer.unref) timer.unref();
}

function getWorkerHeartbeats() {
  const stored = readJson(WORKERS_FILE, {});
  const now = Date.now();
  const workers = Object.values(stored)
    .map((w) => ({
      ...w,
      alive: now - (w.lastHeartbeatAt || 0) < STALE_AFTER_MS,
      lastHeartbeatAgoMs: now - (w.lastHeartbeatAt || 0),
    }))
    .sort((a, b) => a.pid - b.pid);
  return {
    workers,
    aliveCount: workers.filter((w) => w.alive).length,
    totalReporting: workers.length,
    // What THIS app's own internal cluster.fork() is configured to spawn —
    // NOT necessarily the real worker count if PM2's own `-i N` is what's
    // actually managing process count (that number isn't knowable from
    // inside the app without shelling out to `pm2 jlist`, so it's not
    // claimed here). `aliveCount` above is the one number that's always
    // honest regardless of which layer(s) are actually in play.
    configuredInternalWorkers: config.cluster?.workers || os.cpus().length,
    internalClusterEnabled: !!config.cluster?.enabled,
  };
}

module.exports = { startWorkerHeartbeat, getWorkerHeartbeats };
