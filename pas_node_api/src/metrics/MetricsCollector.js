'use strict';

const os = require('os');
const config = require('../config');
const metricsDB = require('./MetricsDB');
const { isSingletonOwner } = require('../clusterWorkerIdentity');

/**
 * MetricsCollector - Proxy wrapper around MetricsDB.
 * Tracks active connections in memory and pipes requests/errors/snapshots to SQLite.
 */
class MetricsCollector {
  constructor() {
    this.startTime = Date.now();
    this.activeConnections = 0;
    
    // Total requests across lifetime just for legacy compat if needed, 
    // though the DB holds the true count for the retention period.
    this.totalRequestsReceivedSinceStartup = 0;
    this.totalErrorsSinceStartup = 0;

    this._startSnapshotCollection();
  }

  /**
   * Record an incoming request.
   */
  recordRequest(req, res, responseTime) {
    this.totalRequestsReceivedSinceStartup++;
    metricsDB.recordRequest(req, responseTime);

    if (res.statusCode >= 500) {
      this.totalErrorsSinceStartup++;
      metricsDB.recordError(req, res);
    }
  }

  /**
   * Proxies to MetricsDB to get full metrics snapshot for the dashboard.
   */
  async getMetrics(startDate, endDate) {
    const mem = process.memoryUsage();
    const uptime = process.uptime();

    const [dbAggregates, throughput, throughputDaily, activeClients5m] = await Promise.all([
      metricsDB.getDashboardAggregates(startDate, endDate),
      metricsDB.getThroughputSeries(5, 10),
      // Hourly buckets, last 24h — deliberately a DIFFERENT time horizon
      // from `throughput` above (last 5 min), so the "Total Requests" card's
      // click-to-expand shows today's traffic pattern instead of re-drawing
      // the same 5-minute chart that's already always visible on the page.
      metricsDB.getThroughputSeries(24 * 60, 3600),
      metricsDB.getActiveClientCount(5),
    ]);

    // Merge DB aggregates with live server stats
    return {
      server: {
        uptime: Math.floor(uptime),
        uptimeHuman: this._formatUptime(uptime),
        startedAt: new Date(this.startTime).toISOString(),
        nodeVersion: process.version,
        platform: process.platform,
        pid: process.pid,
        cpuCount: os.cpus().length,
        loadAvg: os.loadavg().map(v => v.toFixed(2)),
        hostname: os.hostname(),
      },
      memory: {
        rss: this._formatBytes(mem.rss),
        heapTotal: this._formatBytes(mem.heapTotal),
        heapUsed: this._formatBytes(mem.heapUsed),
        external: this._formatBytes(mem.external),
        rssRaw: mem.rss,
        heapUsedRaw: mem.heapUsed,
        heapTotalRaw: mem.heapTotal,
      },
      requests: {
        // We inject the live active connections here
        ...dbAggregates.requests,
        // In-flight HTTP requests on THIS worker at this exact instant — real,
        // but on a fast API (25ms responses) an instantaneous sample rarely
        // catches more than 0-1, so it's not a useful "how busy is my backend"
        // signal. activeClients5m (below) is: distinct client IPs seen across
        // ALL workers in the last 5 minutes — the "unique users right now" number.
        activeConnections: this.activeConnections,
        activeClients5m,
        rps: parseFloat(((dbAggregates.requests?.total || 0) / (uptime || 1)).toFixed(2)),
      },
      responseTimes: dbAggregates.responseTimes || { avg: 0, p50: 0, p95: 0, p99: 0, sampleSize: 0 },
      errors: dbAggregates.errors || { total: 0, recent: [] },
      topEndpoints: dbAggregates.topEndpoints || [],
      snapshots: dbAggregates.snapshots || [],
      // True cluster-wide throughput (COUNT(*) over `requests`, bucketed) —
      // see MetricsDB.getThroughputSeries' doc comment for why this replaced
      // diffing the per-worker `snapshots.total_requests` counter.
      throughput,
      throughputDaily,
    };
  }

  /**
   * Proxies to MetricsDB for per-IP stats
   */
  async getIpStats(startDate, endDate) {
    return await metricsDB.getIpStats(startDate, endDate);
  }

  /**
   * Format bytes to human-readable string.
   */
  _formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  }

  /**
   * Format uptime in seconds to human-readable string.
   */
  _formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
  }

  /**
   * Periodic snapshot for dashboard charts sent to SQLite.
   *
   * Singleton-owner only (2026-08-18) — every worker used to run this
   * independently, and since metrics.sqlite is ONE shared file (not
   * per-WORKER_ID), every worker's own since-startup counters/memory
   * landed in the SAME `snapshots` table. Two consecutive rows could
   * belong to two different processes with unrelated values — a "Memory"
   * trend chart built on that data jumps around incoherently (looks like
   * noise/fake data) because it's actually alternating between different
   * processes' memory footprints, not tracking one process over time.
   * Restricting collection to the singleton owner (same isSingletonOwner()
   * used for cron/collector gating elsewhere) makes every row in this
   * table belong to the same process — a real, coherent trend line.
   */
  _startSnapshotCollection() {
    if (!isSingletonOwner()) return;
    const interval = config.metricsConfig?.snapshotIntervalMs || 10000;
    setInterval(() => {
      const mem = process.memoryUsage();
      metricsDB.recordSnapshot({
        requests: this.totalRequestsReceivedSinceStartup,
        errors: this.totalErrorsSinceStartup,
        rss: mem.rss,
        heapUsed: mem.heapUsed,
        loadAvg: os.loadavg()[0],
        activeConnections: this.activeConnections,
      });
    }, interval).unref();
  }
}

// Singleton
module.exports = new MetricsCollector();
