'use strict';

const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const { getClientIp } = require('../utils/geoip');

/**
 * MetricsDB - Lightweight, persistent SQLite database for application metrics.
 * Retains 3 days of metrics and enforces minimal RAM usage.
 */
class MetricsDB {
  constructor() {
    this.dbPath = path.join(__dirname, '../../data/metrics.sqlite');
    this.db = null;
    
    // In-memory buffers to batch writes and avoid blocking the Event Loop
    this.requestBuffer = [];
    this.errorBuffer = [];
    this.bufferSize = 100; // Flush every 100 requests or interval
    this.flushIntervalMs = 5000; // Flush every 5s if not full

    this._flushTimer = null;

    // See getDashboardAggregates()'s doc comment — short-TTL cache so the
    // Dashboard's 10s auto-refresh doesn't re-run 8 aggregation queries on
    // every single overlapping request at production's row counts.
    this._aggCache = new Map();
    this.AGG_CACHE_TTL_MS = 9000;
  }

  /**
   * Initialize the SQLite connection and schema.
   */
  async init() {
    // Ensure data dir exists
    const dataDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.db = await open({
      filename: this.dbPath,
      driver: sqlite3.Database
    });

    // Use Write-Ahead Logging for better concurrency and performance
    await this.db.exec('PRAGMA journal_mode = WAL;');
    await this.db.exec('PRAGMA synchronous = NORMAL;');
    await this.db.exec('PRAGMA temp_store = MEMORY;');

    // Create Tables
    await this.db.exec(`
      CREATE TABLE IF NOT EXISTS requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        method TEXT,
        endpoint TEXT,
        status INTEGER,
        response_time INTEGER,
        ip TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS errors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        method TEXT,
        url TEXT,
        status INTEGER,
        ip TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      
      CREATE TABLE IF NOT EXISTS snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        total_requests INTEGER,
        errors INTEGER,
        rss INTEGER,
        heap_used INTEGER,
        load_avg REAL,
        active_connections INTEGER,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      -- Indexes to speed up range/group queries
      CREATE INDEX IF NOT EXISTS idx_requests_ts ON requests(timestamp);
      CREATE INDEX IF NOT EXISTS idx_requests_ep ON requests(endpoint);
      CREATE INDEX IF NOT EXISTS idx_requests_ip ON requests(ip);
      -- Dashboard's "Requests by Method"/"Requests by Status" GROUP BY these
      -- two columns on every load — with no index here, that's a full table
      -- scan. Invisible at dev's row counts, real at production's (this
      -- table holds up to 3 days of every request through every worker).
      CREATE INDEX IF NOT EXISTS idx_requests_method ON requests(method);
      CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status);
      CREATE INDEX IF NOT EXISTS idx_errors_ts ON errors(timestamp);
      CREATE INDEX IF NOT EXISTS idx_snapshots_ts ON snapshots(timestamp);
    `);

    // Start buffer flush timer and cleanup job
    this._startFlushTimer();
    this._startCleanupJob();
    return this;
  }

  /**
   * Queue a request to be inserted.
   */
  recordRequest(req, responseTime) {
    this.requestBuffer.push({
      method: req.method,
      endpoint: this._simplifyPath(req.originalUrl || req.url),
      status: req.res ? req.res.statusCode : 200, // Assuming available here if modified in middleware
      response_time: responseTime,
      // getClientIp() checks cf-connecting-ip / x-forwarded-for / x-real-ip
      // before falling back to req.ip — behind Cloudflare/a reverse proxy,
      // plain req.ip can resolve to the proxy's own address instead of the
      // real client, which is why a real public IP could show up nowhere
      // in the IP Manager table (every row was being recorded under the
      // proxy's IP instead).
      ip: getClientIp(req) || 'unknown',
      timestamp: new Date().toISOString()
    });

    if (this.requestBuffer.length >= this.bufferSize) {
      this.flush();
    }
  }

  /**
   * Queue an error to be inserted.
   */
  recordError(req, res) {
    this.errorBuffer.push({
      method: req.method,
      url: req.originalUrl || req.url,
      status: res.statusCode,
      ip: getClientIp(req) || 'unknown',
      timestamp: new Date().toISOString()
    });
    
    if (this.errorBuffer.length >= this.bufferSize) {
      this.flush();
    }
  }

  /**
   * Record a periodic snapshot directly (low volume, unbuffered).
   */
  async recordSnapshot(data) {
    if (!this.db) return;
    try {
      await this.db.run(
        `INSERT INTO snapshots (total_requests, errors, rss, heap_used, load_avg, active_connections, timestamp) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [data.requests, data.errors, data.rss, data.heapUsed, data.loadAvg, data.activeConnections, new Date().toISOString()]
      );
    } catch (err) {
      console.error('[MetricsDB] Failed to insert snapshot:', err.message);
    }
  }

  /**
   * Flush all buffered entries to SQLite using a transaction.
   */
  async flush() {
    if (!this.db) return;
    const reqs = [...this.requestBuffer];
    const errs = [...this.errorBuffer];
    this.requestBuffer = [];
    this.errorBuffer = [];

    if (reqs.length === 0 && errs.length === 0) return;

    try {
      await this.db.run('BEGIN TRANSACTION');
      
      if (reqs.length > 0) {
        const stmt = await this.db.prepare('INSERT INTO requests (method, endpoint, status, response_time, ip, timestamp) VALUES (?, ?, ?, ?, ?, ?)');
        for (const r of reqs) {
          await stmt.run(r.method, r.endpoint, r.status, r.response_time, r.ip, r.timestamp);
        }
        await stmt.finalize();
      }
      
      if (errs.length > 0) {
        const stmt = await this.db.prepare('INSERT INTO errors (method, url, status, ip, timestamp) VALUES (?, ?, ?, ?, ?)');
        for (const e of errs) {
          await stmt.run(e.method, e.url, e.status, e.ip, e.timestamp);
        }
        await stmt.finalize();
      }

      await this.db.run('COMMIT');
    } catch (err) {
      console.error('[MetricsDB] Failed to flush metrics buffer:', err.message);
      await this.db.run('ROLLBACK').catch(() => {});
    }
  }

  /**
   * Fetch aggregate data for the Dashboard.
   * If startDate/endDate are empty, defaults to all available data (last 3 days).
   *
   * Cached per-worker for AGG_CACHE_TTL_MS — the admin Dashboard tab
   * auto-refreshes every 10s while open (see admin/public/app.js's
   * showDashboard()), and at production's row counts (up to 3 days of every
   * request across every worker, vs dev's near-empty table) these 8
   * aggregation queries are real work, not free. A ~9s TTL means a normal
   * 10s refresh cycle always sees fresh data, but anything that lands inside
   * the SAME cycle (a second admin with the tab open, a quick tab-switch
   * back to Dashboard) reuses the just-computed result instead of re-running
   * every query. Same in-process Map+TTL pattern already used in
   * keywordsExplorerController.js's statsCache for the identical reason.
   */
  async getDashboardAggregates(startDate, endDate) {
    if (!this.db) return {};

    const cacheKey = `${startDate || ''}::${endDate || ''}`;
    const cached = this._aggCache?.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    let dateWhere = '';
    let params = [];

    if (startDate && endDate) {
      dateWhere = 'WHERE timestamp BETWEEN ? AND ?';
      params = [startDate, endDate + 'T23:59:59.999Z'];
    }

    // Requests
    const reqCounts = await this.db.get(`SELECT COUNT(*) as total FROM requests ${dateWhere}`, params);
    
    // By Method
    const byMethodRows = await this.db.all(`SELECT method, COUNT(*) as count FROM requests ${dateWhere} GROUP BY method`, params);
    const byMethod = {};
    byMethodRows.forEach(r => byMethod[r.method] = r.count);

    // By Status
    const byStatusRows = await this.db.all(`SELECT status, COUNT(*) as count FROM requests ${dateWhere} GROUP BY status`, params);
    const byStatus = {};
    byStatusRows.forEach(r => byStatus[r.status] = r.count);

    // Top Endpoints (exclude /admin/*). Prefix-only wildcard (no leading %) —
    // every admin route is mounted at app.use('/admin', ...), so `endpoint`
    // (originalUrl) always has /admin as a PREFIX, never buried mid-string.
    // A leading-% LIKE can't use idx_requests_ep at all (forces a full table
    // scan to pattern-match every row); a prefix-only LIKE is sargable —
    // same exact rows excluded, materially cheaper at production's row counts.
    const topEndpoints = await this.db.all(`
      SELECT endpoint, COUNT(*) as count, ROUND(AVG(response_time)) as avgTime
      FROM requests
      ${dateWhere ? dateWhere + " AND " : "WHERE "} endpoint NOT LIKE '/admin/%'
      GROUP BY endpoint
      ORDER BY count DESC
      LIMIT 10
    `, params);

    // Response Time Avg
    const avgResponse = await this.db.get(`SELECT ROUND(AVG(response_time)) as avg FROM requests ${dateWhere}`, params);

    // Percentiles (Approximated with sorting, since SQLite lacks PERCENTILE_CONT)
    // For large datasets, fetching all times is heavy. We fetch a limited sample.
    const times = await this.db.all(`SELECT response_time FROM requests ${dateWhere} ORDER BY timestamp DESC LIMIT 500`, params);
    const sorted = times.map(t => t.response_time).sort((a,b) => a - b);
    const p50 = this._percentile(sorted, 50);
    const p95 = this._percentile(sorted, 95);
    const p99 = this._percentile(sorted, 99);

    // Errors
    const errCount = await this.db.get(`SELECT COUNT(*) as total FROM errors ${dateWhere}`, params);
    const recentErrors = await this.db.all(`SELECT * FROM errors ${dateWhere} ORDER BY timestamp DESC LIMIT 10`, params);

    // Snapshots
    const snapshots = await this.db.all(`SELECT * FROM snapshots ${dateWhere} ORDER BY timestamp DESC LIMIT 30`, params);

    const result = {
      requests: {
        total: reqCounts.total,
        byMethod,
        byStatus
      },
      responseTimes: {
        avg: avgResponse.avg || 0,
        p50,
        p95,
        p99,
        sampleSize: sorted.length
      },
      topEndpoints,
      errors: {
        total: errCount.total,
        recent: recentErrors
      },
      snapshots: snapshots.reverse()
    };

    if (!this._aggCache) this._aggCache = new Map();
    this._aggCache.set(cacheKey, { value: result, expiresAt: Date.now() + this.AGG_CACHE_TTL_MS });
    return result;
  }

  /**
   * True cluster-wide request throughput, bucketed into `bucketSeconds`
   * windows over the last `minutes` — a direct COUNT(*) over the `requests`
   * table, which every worker writes real per-request rows into (no
   * per-worker counter involved, so there's nothing to interleave).
   *
   * Replaces an earlier approach that diffed consecutive `snapshots.
   * total_requests` values: that column is `MetricsCollector.
   * totalRequestsReceivedSinceStartup`, a PER-WORKER in-memory counter that
   * resets on every worker restart. Every worker's own snapshot-collection
   * interval writes into the SAME shared snapshots table (see MetricsDB.
   * dbPath — one fixed path, not per-WORKER_ID), so two consecutive rows in
   * that table can belong to two DIFFERENT workers with unrelated counter
   * values — diffing them produced meaningless, sometimes-negative deltas
   * (clamped to 0), which is why the "Request Throughput" chart looked like
   * a random sawtooth instead of a real trend.
   */
  async getThroughputSeries(minutes = 5, bucketSeconds = 10) {
    if (!this.db) return [];
    const sinceIso = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    const rows = await this.db.all(
      `SELECT (CAST(strftime('%s', timestamp) AS INTEGER) / ?) * ? as bucket, COUNT(*) as count
       FROM requests
       WHERE timestamp >= ?
       GROUP BY bucket
       ORDER BY bucket ASC`,
      [bucketSeconds, bucketSeconds, sinceIso]
    );
    return rows.map((r) => ({ ts: r.bucket * 1000, value: r.count }));
  }

  /**
   * Distinct client IPs seen in the last `minutes` — "how many unique
   * clients are actively hitting my backend right now", not to be confused
   * with `activeConnections` (an instantaneous in-flight-request gauge,
   * which is correct but usually reads as 0-1 on a fast API since a request
   * completes in milliseconds and rarely overlaps a sample instant).
   */
  async getActiveClientCount(minutes = 5) {
    if (!this.db) return 0;
    const sinceIso = new Date(Date.now() - minutes * 60 * 1000).toISOString();
    const row = await this.db.get(
      `SELECT COUNT(DISTINCT ip) as count FROM requests WHERE timestamp >= ?`,
      [sinceIso]
    );
    return row?.count || 0;
  }

  /**
   * Fetch per-IP analytics.
   */
  async getIpStats(startDate, endDate) {
    if (!this.db) return [];

    let dateWhere = '';
    let params = [];
    if (startDate && endDate) {
      dateWhere = 'WHERE timestamp BETWEEN ? AND ?';
      params = [startDate, endDate + 'T23:59:59.999Z'];
    }

    // Get primary aggregates. errorCount/rateLimitHits come straight out of
    // the `status` column already recorded on every request (now indexed —
    // see MetricsDB.init()) — no separate tracking needed. These are the two
    // signals an admin actually needs to spot abuse: raw request volume
    // alone doesn't distinguish a busy legitimate integration from a bot
    // hammering a bad endpoint or getting rate-limited over and over.
    const ips = await this.db.all(`
      SELECT ip,
        COUNT(*) as requests,
        SUM(CASE WHEN status >= 400 THEN 1 ELSE 0 END) as errorCount,
        SUM(CASE WHEN status = 429 THEN 1 ELSE 0 END) as rateLimitHits,
        MIN(timestamp) as firstSeen, MAX(timestamp) as lastSeen
      FROM requests
      ${dateWhere}
      GROUP BY ip
      ORDER BY requests DESC
      LIMIT 100
    `, params);

    // For the top IPs, fetch their top 10 endpoints hit
    // Doing N queries here is okay since we limited to 100, but using a single IN query is better
    if (ips.length > 0) {
      const topIpList = ips.map(i => i.ip);
      const placeholders = topIpList.map(() => '?').join(',');
      
      const ipParams = [...params, ...topIpList];
      const epDateWhere = dateWhere ? dateWhere + ' AND ' : 'WHERE ';
      
      // We will pull the endpoint counts for these IPs.
      const epRows = await this.db.all(`
        SELECT ip, endpoint, COUNT(*) as count
        FROM requests
        ${epDateWhere} ip IN (${placeholders})
        GROUP BY ip, endpoint
      `, ipParams);

      // Map back to IP records
      const epMap = {}; // { '127.0.0.1': { '/api/foo': 10, ...} }
      for (const r of epRows) {
        if (!epMap[r.ip]) epMap[r.ip] = [];
        epMap[r.ip].push({ endpoint: r.endpoint, count: r.count });
      }

      for (const ip of ips) {
        const theirEps = epMap[ip.ip] || [];
        theirEps.sort((a,b) => b.count - a.count);
        // Take top 10
        ip.endpoints = {};
        for (const ep of theirEps.slice(0, 10)) {
          ip.endpoints[ep.endpoint] = ep.count;
        }
      }
    }

    return ips;
  }

  // Calculate generic percentile
  _percentile(sorted, p) {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  _simplifyPath(url) {
    return url.split('?')[0].replace(/\/\d+/g, '/:id');
  }

  _startFlushTimer() {
    this._flushTimer = setInterval(() => {
      this.flush();
    }, this.flushIntervalMs);
  }

  /**
   * Cleans data older than 3 days automatically every hour.
   */
  _startCleanupJob() {
    const cleanOldData = async () => {
      if (!this.db) return;
      try {
        const threshold = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
        await this.db.run(`DELETE FROM requests WHERE timestamp < ?`, [threshold]);
        await this.db.run(`DELETE FROM errors WHERE timestamp < ?`, [threshold]);
        await this.db.run(`DELETE FROM snapshots WHERE timestamp < ?`, [threshold]);
        await this.db.exec('PRAGMA vacuum;'); // Reclaim space
      } catch (err) {
        console.error('[MetricsDB] Cleanup job error:', err.message);
      }
    };

    // Run once on startup, then every 1 hour
    cleanOldData();
    setInterval(cleanOldData, 60 * 60 * 1000);
  }

  async close() {
    if (this._flushTimer) clearInterval(this._flushTimer);
    await this.flush();
    if (this.db) await this.db.close();
  }
}

// Singleton
module.exports = new MetricsDB();
