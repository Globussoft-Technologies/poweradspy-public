'use strict';

const { Router } = require('express');
const CircuitBreaker = require('../utils/circuitBreaker');
const { asyncHandler, AppError } = require('../middleware/errorHandler');
const ResponseFormatter = require('../utils/responseFormatter');
// const cacheStore = require('../cache/CacheStore');
const databaseManager = require('../database/DatabaseManager');
const logger = require('../logger');
const { HTTP, ERROR_CODES, CACHE_NS } = require('../utils/constants');

/**
 * BaseNetworkService - Abstract base class for all network microservices.
 *
 * Every network (Facebook, Instagram, etc.) extends this class and
 * inherits standard CRUD routes, error handling, caching, logging,
 * and database connections (SQL, MongoDB, Elasticsearch).
 *
 * Subclasses MUST implement the abstract methods or override them.
 */
class BaseNetworkService {
  /**
   * @param {Object} networkConfig - from config/networks.js
   */
  constructor(networkConfig) {
    if (new.target === BaseNetworkService) {
      throw new Error('BaseNetworkService is abstract and cannot be instantiated directly.');
    }

    this.name = networkConfig.name || 'Unknown';
    this.slug = networkConfig.slug || this.name.toLowerCase();
    this.enabled = networkConfig.enabled;
    this.cacheTTL = networkConfig.cacheTTL || 300;
    this.rateLimitConfig = networkConfig.rateLimit;
    this.description = networkConfig.description;

    // Each service gets its own logger and circuit breaker
    this.log = logger.createChild(this.slug);
    this.circuitBreaker = new CircuitBreaker(this.slug, {
      failureThreshold: 5,
      resetTimeoutMs: 30000,
    });

    // Database connections (injected after DatabaseManager initializes)
    this.db = {
      sql: null,
      mongo: null,
      elastic: null,
    };

    this.router = Router();
    this._registerRoutes();

    this.log.info(`${this.name} service initialized`);
  }

  /**
   * Inject database connections from DatabaseManager.
   * Called by ServiceRegistry after DatabaseManager connects.
   */
  injectDatabases() {
    const conns = databaseManager.getConnections(this.slug);
    if (conns) {
      this.db.sql = conns.sql;
      this.db.mongo = conns.mongo;
      this.db.elastic = conns.elastic;

      const connected = [];
      if (this.db.sql) connected.push('SQL');
      if (this.db.mongo) connected.push('MongoDB');
      if (this.db.elastic) connected.push('Elasticsearch');

      if (connected.length > 0) {
        this.log.info(`Database connections injected: [${connected.join(', ')}]`);
      }
    }
  }

  /**
   * Register all standard CRUD routes.
   * Subclasses can override _registerCustomRoutes() for extra routes.
   * @private
   */
  _registerRoutes() {
    // Network-specific status (includes DB connection info)
    this.router.get('/status', asyncHandler((req, res) => this._handleGetStatus(req, res)));

    // Database health for this network
    this.router.get('/db/health', asyncHandler((req, res) => this._handleGetDbHealth(req, res)));

    // Let subclasses register custom routes
    this._registerCustomRoutes();
  }

  /**
   * Override in subclasses to add network-specific routes.
   * @protected
   */
  _registerCustomRoutes() {
    // Override in subclass
  }

  // ═══════════════════════════════════════════════════════
  // Route handlers with circuit breaker + caching
  // ═══════════════════════════════════════════════════════

  async _handleGetStatus(req, res) {
    return ResponseFormatter.success(res, {
      data: {
        network: this.name,
        slug: this.slug,
        enabled: this.enabled,
        circuitBreaker: this.circuitBreaker.getStatus(),
        databases: {
          sql: this.db.sql ? 'connected' : 'not configured',
          mongo: this.db.mongo ? 'connected' : 'not configured',
          elastic: this.db.elastic ? 'connected' : 'not configured',
        },
      },
    });
  }

  async _handleGetDbHealth(req, res) {
    return ResponseFormatter.success(res, {
      data: {
        network: this.slug,
        sql: this.db.sql ? { status: 'connected', type: this.db.sql.type } : { status: 'not configured' },
        mongo: this.db.mongo ? { status: 'connected', type: this.db.mongo.type } : { status: 'not configured' },
        elastic: this.db.elastic ? { status: 'connected', type: this.db.elastic.type } : { status: 'not configured' },
      },
    });
  }

  // ═══════════════════════════════════════════════════════
  // Abstract methods — subclasses MUST override these
  // ═════════════════════════════════════════════════════
  /**
   * Get the Express router for this service.
   */
  getRouter() {
    return this.router;
  }

  /**
   * Health check for this service.
   */
  getHealth() {
    return {
      name: this.name,
      slug: this.slug,
      enabled: this.enabled,
      circuitBreaker: this.circuitBreaker.getStatus(),
      databases: {
        sql: this.db.sql ? 'connected' : 'not configured',
        mongo: this.db.mongo ? 'connected' : 'not configured',
        elastic: this.db.elastic ? 'connected' : 'not configured',
      },
    };
  }
}

module.exports = BaseNetworkService;
