'use strict';

const path = require('path');
const http = require('http');
const https = require('https');
const config = require('../config');
const logger = require('../logger');

const log = logger.createChild('database-manager');

/**
 * DatabaseManager - Manages per-network database connections.
 *
 * Each network gets its own isolated:
 *   - SQL connection (MySQL/PostgreSQL via connection params)
 *   - MongoDB connection
 *   - Elasticsearch client (shared when pointing to the same node+auth)
 *
 * Connections are established on server startup and shared
 * across requests for that network.
 *
 * If a database is not configured for a network, it is skipped gracefully.
 */
class DatabaseManager {
  constructor() {
    this.connections = new Map(); // networkSlug → { sql, mongo, elastic }
    this._esClientCache = new Map(); // cacheKey → { client, refCount }
    this.initialized = false;
  }

  /**
   * Initialize all database connections for all networks.
   * Called once during server startup.
   *
   * @param {Object} networksConfig - from config/networks.js
   */
  async connectAll(networksConfig) {
    log.info('═══ Initializing Database Connections ═══');

    for (const [slug, networkCfg] of Object.entries(networksConfig)) {
      if (!networkCfg.enabled) {
        log.info(`[${slug}] Network disabled, skipping DB connections`);
        continue;
      }

      const dbConfig = networkCfg.database || {};
      const networkConns = {
        sql: null,
        mongo: null,
        elastic: null,
      };

      // ─── SQL Connection ─────────────────────────────
      if (dbConfig.sql && dbConfig.sql.enabled) {
        try {
          const sqlConn = await this._connectSQL(slug, dbConfig.sql);
          if (sqlConn) {
            networkConns.sql = sqlConn;
            log.info(`[${slug}] ✓ SQL connected → ${dbConfig.sql.host}:${dbConfig.sql.port}/${dbConfig.sql.database}`);
          }
        } catch (err) {
          log.error(`[${slug}] ✗ SQL connection failed`, { error: err.message });
        }
      }

      // ─── MongoDB Connection ─────────────────────────
      if (dbConfig.mongo && dbConfig.mongo.enabled) {
        try {
          const mongoConn = await this._connectMongo(slug, dbConfig.mongo);
          if (mongoConn) {
            networkConns.mongo = mongoConn;
            log.info(`[${slug}] ✓ MongoDB connected → ${dbConfig.mongo.uri}`);
          }
        } catch (err) {
          log.error(`[${slug}] ✗ MongoDB connection failed`, { error: err.message });
        }
      }

      // ─── Elasticsearch Connection ───────────────────
      if (dbConfig.elastic && dbConfig.elastic.enabled) {
        try {
          const elasticConn = await this._connectElastic(slug, dbConfig.elastic);
          if (elasticConn) {
            networkConns.elastic = elasticConn;
            log.info(`[${slug}] ✓ Elasticsearch connected → ${dbConfig.elastic.node}`);
          }
        } catch (err) {
          log.error(`[${slug}] ✗ Elasticsearch connection failed`, { error: err.message });
        }
      }

      if (dbConfig.elastic_tiktok && dbConfig.elastic_tiktok.enabled) {
        try {
          const elasticConn = await this._connectTiktokElastic(slug, dbConfig.elastic_tiktok);
          if (elasticConn) {
            networkConns.elastic = elasticConn;
            log.info(`[${slug}] ✓ Elasticsearch connected → ${dbConfig.elastic_tiktok.node}`);
          }
        } catch (err) {
          log.error(`[${slug}] ✗ Elasticsearch connection failed`, { error: err.message });
        }
      }

      this.connections.set(slug, networkConns);
    }

    this.initialized = true;
    const totalNetworks = this.connections.size;
    const sqlCount = [...this.connections.values()].filter(c => c.sql).length;
    const mongoCount = [...this.connections.values()].filter(c => c.mongo).length;
    const elasticCount = [...this.connections.values()].filter(c => c.elastic).length;
    const sharedEsClients = this._esClientCache.size;

    log.info(`═══ Database Connections Summary ═══`);
    log.info(`Networks: ${totalNetworks} | SQL: ${sqlCount} | MongoDB: ${mongoCount} | Elasticsearch: ${elasticCount} (${sharedEsClients} shared ES client(s))`);
  }

  // ─── SQL (MySQL2 connection pool) ──────────────────────

  async _connectSQL(slug, sqlConfig) {
    try {
      const mysql = require('mysql2/promise');

      const pool = mysql.createPool({
        host: sqlConfig.host,
        port: sqlConfig.port,
        user: sqlConfig.user,
        password: sqlConfig.password,
        database: sqlConfig.database,
        waitForConnections: true,
        connectionLimit: sqlConfig.poolSize,
        queueLimit: config.databases.sql.queueLimit || 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: config.databases.sql.keepAliveInitialDelay || 10000,
        idleTimeout: config.databases.sql.idleTimeout || 60000,
      });

      // Test the connection
      const conn = await pool.getConnection();
      await conn.ping();
      conn.release();

      return {
        type: 'mysql',
        pool,
        query: async (sql, params) => {
          const [rows] = await pool.execute(sql, params);
          return rows;
        },
        getConnection: () => pool.getConnection(),
        close: () => pool.end(),
      };
    } catch (err) {
      // If mysql2 is not installed, provide helpful message
      if (err.code === 'MODULE_NOT_FOUND') {
        log.warn(`[${slug}] mysql2 not installed. Run: npm install mysql2`);
        return null;
      }
      throw err;
    }
  }

  // ─── MongoDB (Mongoose or native driver) ────────────────

  async _connectMongo(slug, mongoConfig) {
    try {
      const { MongoClient } = require('mongodb');

      const uri = mongoConfig.uri;
      const client = new MongoClient(uri, {
        maxPoolSize: mongoConfig.poolSize,
        minPoolSize: config.databases.mongo.minPoolSize || 2,
        serverSelectionTimeoutMS: config.databases.mongo.serverSelectionTimeoutMs || 5000,
        heartbeatFrequencyMS: config.databases.mongo.heartbeatFrequencyMs || 10000,
      });

      await client.connect();
      const db = client.db(mongoConfig.database || slug);

      // Test with a ping
      await db.command({ ping: 1 });

      return {
        type: 'mongodb',
        client,
        db,
        collection: (name) => db.collection(name),
        close: () => client.close(),
      };
    } catch (err) {
      if (err.code === 'MODULE_NOT_FOUND') {
        log.warn(`[${slug}] mongodb driver not installed. Run: npm install mongodb`);
        return null;
      }
      throw err;
    }
  }

  // ─── Shared ES Client Cache ─────────────────────────────
  // Multiple networks pointing to the same ES node+auth share one
  // underlying Client instance to avoid file-descriptor exhaustion.

  /**
   * Build a cache key from the node URL and auth credentials.
   * Networks with identical keys share the same Client.
   */
  _esClientCacheKey(elasticConfig) {
    const node = this._normalizeEsNodes(elasticConfig.node).join(',');
    const user = elasticConfig.auth?.username || '';
    return `${node}|${user}`;
  }

  /**
   * Normalize the configured ES node into an array of clean URLs.
   * Accepts a single string, a comma/space-separated string, or an array —
   * so config can list multiple nodes (coordination is round-robined across
   * them, spreading the coordinating-node CPU off a single overloaded host).
   */
  _normalizeEsNodes(node) {
    const arr = Array.isArray(node) ? node : String(node || '').split(/[,\s]+/);
    return arr.map((u) => String(u).trim().replace(/\/+$/, '')).filter(Boolean);
  }

  /**
   * Create an HTTP/HTTPS agent with bounded connection-pool settings
   * to prevent socket/file-descriptor leaks.
   */
  _createBoundedAgent(nodeUrl) {
    const isHttps = (nodeUrl || '').startsWith('https');
    const AgentClass = isHttps ? https.Agent : http.Agent;
    return new AgentClass({
      keepAlive: true,
      keepAliveMsecs: 30000,   // send TCP keep-alive probes every 30s
      maxSockets: 15,          // max concurrent sockets to the ES node
      maxFreeSockets: 5,       // max idle sockets kept in pool
      timeout: 60000,          // socket inactivity timeout 60s
    });
  }

  /**
   * Get or create a shared ES Client for the given config.
   * Returns the raw Client instance (shared — do NOT close per-network).
   */
  async _getOrCreateEsClient(slug, elasticConfig, dbConfigKey) {
    const { Client } = require('@elastic/elasticsearch');
    const cacheKey = this._esClientCacheKey(elasticConfig);

    // Re-use existing client for the same node+auth
    if (this._esClientCache.has(cacheKey)) {
      const cached = this._esClientCache.get(cacheKey);
      cached.refCount++;
      log.info(`[${slug}] Reusing shared ES client for ${elasticConfig.node} (refCount=${cached.refCount})`);
      return { client: cached.client, esMajor: cached.esMajor };
    }

    // Resolve config section for timeouts
    const cfgSection = config.databases[dbConfigKey] || config.databases.elastic;

    // Support one OR many nodes. With >1, the client round-robins every
    // request's coordinating node across them, so coordination/reduce load is
    // shared instead of pinning a single host (e.g. the master/app-facing node).
    const nodes = this._normalizeEsNodes(elasticConfig.node);
    const clientOptions = {
      ...(nodes.length > 1 ? { nodes } : { node: nodes[0] }),
      maxRetries: cfgSection.maxRetries || 3,
      requestTimeout: cfgSection.requestTimeoutMs || 30000,
      sniffOnStart: false,
      // Bounded HTTP agent to limit open sockets / file descriptors
      agent: this._createBoundedAgent(nodes[0]),
    };
    if (nodes.length > 1) {
      log.info(`[${slug}] Elasticsearch using ${nodes.length} nodes (round-robin): ${nodes.join(', ')}`);
    }

    // Only add auth if username is provided
    if (elasticConfig.auth && elasticConfig.auth.username) {
      clientOptions.auth = {
        username: elasticConfig.auth.username,
        password: elasticConfig.auth.password || ''
      };
    }

    const client = new Client(clientOptions);

    // Simple ping to test connection instead of cluster health
    // which throws kibana read privileges error on v6/v7
    await client.ping();

    const info = await client.info();
    const versionNumber = info.body ? info.body.version.number : info.version ? info.version.number : null;
    // Major version drives write-path behaviour: ES 6.x requires an explicit
    // mapping type in index/update URLs, ES 7+/8 are typeless.
    const esMajor = versionNumber ? parseInt(versionNumber.split('.')[0], 10) : null;
    log.info(`[${slug}] Elasticsearch connection healthy. Version: ${versionNumber || 'Unknown'}`);

    this._esClientCache.set(cacheKey, { client, refCount: 1, esMajor });
    return { client, esMajor };
  }

  // ─── Elasticsearch ──────────────────────────────────────

  async _connectElastic(slug, elasticConfig) {
    try {
      const { client, esMajor } = await this._getOrCreateEsClient(slug, elasticConfig, 'elastic');

      return {
        type: 'elasticsearch',
        client,
        esMajor,
        indexName: elasticConfig.index,
        search: (params) => client.search(params),
        analyze:(params) => client.indices.analyze(params),
        count:  (params) => client.count(params),
        index:  (params) => client.index(params),
        update: (params) => client.update(params),
        delete: (params) => client.delete(params),
        bulk:   (params) => client.bulk(params),
        close:  () => this._releaseEsClient(elasticConfig),
      };
    } catch (err) {
      if (err.code === 'MODULE_NOT_FOUND') {
        log.warn(`[${slug}] @elastic/elasticsearch not installed. Run: npm install @elastic/elasticsearch`);
        return null;
      }
      throw err;
    }
  }

   // ─── TikTok Elasticsearch ──────────────────────────────────────

  async _connectTiktokElastic(slug, elasticConfig) {
    try {
      const { client, esMajor } = await this._getOrCreateEsClient(slug, elasticConfig, 'elastic_tiktok');

      return {
        type: 'elasticsearch',
        client,
        esMajor,
        indexName: elasticConfig.index,
        search: (params) => client.search(params),
        analyze:(params) => client.indices.analyze(params),
        count:  (params) => client.count(params),
        index:  (params) => client.index(params),
        update: (params) => client.update(params),
        delete: (params) => client.delete(params),
        bulk:   (params) => client.bulk(params),
        close:  () => this._releaseEsClient(elasticConfig),
      };
    } catch (err) {
      if (err.code === 'MODULE_NOT_FOUND') {
        log.warn(`[${slug}] @elastic/elasticsearch not installed. Run: npm install @elastic/elasticsearch`);
        return null;
      }
      throw err;
    }
  }

  /**
   * Decrement ref-count for a shared ES client and close it when no
   * networks reference it any more.
   */
  async _releaseEsClient(elasticConfig) {
    const cacheKey = this._esClientCacheKey(elasticConfig);
    const cached = this._esClientCache.get(cacheKey);
    if (!cached) return;

    cached.refCount--;
    if (cached.refCount <= 0) {
      this._esClientCache.delete(cacheKey);
      try {
        await cached.client.close();
      } catch (e) {
        log.error('Error closing shared ES client', { error: e.message });
      }
    }
  }

  // ─── Public API ─────────────────────────────────────────

  /**
   * Get all database connections for a specific network.
   * @param {string} slug - e.g., 'facebook'
   * @returns {{ sql, mongo, elastic } | null}
   */
  getConnections(slug) {
    return this.connections.get(slug) || null;
  }

  /**
   * Get SQL connection for a network.
   * @param {string} slug
   * @returns {Object|null}
   */
  getSQL(slug) {
    const conns = this.connections.get(slug);
    return conns?.sql || null;
  }

  /**
   * Get MongoDB connection for a network.
   * @param {string} slug
   * @returns {Object|null}
   */
  getMongo(slug) {
    const conns = this.connections.get(slug);
    return conns?.mongo || null;
  }

  /**
   * Get Elasticsearch client for a network.
   * @param {string} slug
   * @returns {Object|null}
   */
  getElastic(slug) {
    const conns = this.connections.get(slug);
    return conns?.elastic || null;
  }

  /**
   * Get health status of all database connections.
   * @returns {Object}
   */
  getHealth() {
    const health = {};

    for (const [slug, conns] of this.connections) {
      health[slug] = {
        sql: conns.sql ? { status: 'connected', type: conns.sql.type } : { status: 'not configured' },
        mongo: conns.mongo ? { status: 'connected', type: conns.mongo.type } : { status: 'not configured' },
        elastic: conns.elastic ? { status: 'connected', type: conns.elastic.type } : { status: 'not configured' },
      };
    }

    return health;
  }

  /**
   * Gracefully close all database connections.
   */
  async disconnectAll() {
    log.info('Closing all database connections...');

    for (const [slug, conns] of this.connections) {
      try {
        if (conns.sql) {
          await conns.sql.close();
          log.info(`[${slug}] SQL disconnected`);
        }
        if (conns.mongo) {
          await conns.mongo.close();
          log.info(`[${slug}] MongoDB disconnected`);
        }
        if (conns.elastic) {
          await conns.elastic.close();
          log.info(`[${slug}] Elasticsearch disconnected`);
        }
      } catch (err) {
        log.error(`[${slug}] Error closing connections`, { error: err.message });
      }
    }

    // Force-close any remaining shared ES clients
    for (const [key, cached] of this._esClientCache) {
      try {
        await cached.client.close();
      } catch (e) {
        log.error('Error closing remaining shared ES client', { error: e.message });
      }
    }
    this._esClientCache.clear();

    this.connections.clear();
    this.initialized = false;
    log.info('All database connections closed');
  }

  /**
   * Get pool statistics for all database connections (used by metrics/admin).
   * @returns {Object}
   */
  getPoolStats() {
    const stats = {};

    for (const [slug, conns] of this.connections) {
      stats[slug] = {};

      if (conns.sql && conns.sql.pool) {
        const pool = conns.sql.pool.pool;
        stats[slug].sql = {
          status: 'connected',
          type: conns.sql.type,
          // mysql2 pool exposes _allConnections, _freeConnections, _connectionQueue
          totalConnections: pool?._allConnections?.length || 0,
          freeConnections: pool?._freeConnections?.length || 0,
          pendingRequests: pool?._connectionQueue?.length || 0,
        };
      } else {
        stats[slug].sql = { status: 'not configured' };
      }

      if (conns.mongo && conns.mongo.client) {
        stats[slug].mongo = {
          status: 'connected',
          type: conns.mongo.type,
        };
      } else {
        stats[slug].mongo = { status: 'not configured' };
      }

      if (conns.elastic && conns.elastic.client) {
        stats[slug].elastic = {
          status: 'connected',
          type: conns.elastic.type,
        };
      } else {
        stats[slug].elastic = { status: 'not configured' };
      }
    }

    return stats;
  }
}

// Singleton
const databaseManager = new DatabaseManager();

module.exports = databaseManager;
