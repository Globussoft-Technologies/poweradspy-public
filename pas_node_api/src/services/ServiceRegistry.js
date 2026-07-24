'use strict';

/**
 * ServiceRegistry
 *
 * Discovers and manages network-specific microservices (e.g. Facebook, Instagram).
 * It automatically scans for routes and attaches required dependencies (db, cache, logger).
 */

const fs = require('fs');
const path = require('path');
const logger = require('../logger');
const databaseManager = require('../database/DatabaseManager');

const log = logger.createChild('service-registry');

class ServiceRegistry {
  constructor() {
    this.services = new Map();
  }

  /**
   * Scan the `src/services` directory for network folders.
   * If a folder contains a `routes` directory, it is registered as a service.
   */
  loadAll() {
    log.info('Scanning for network services...');
    const servicesDir = path.join(__dirname, '../services');

    if (!fs.existsSync(servicesDir)) {
      log.warn(`Services directory not found at ${servicesDir}`);
      return;
    }

    const folders = fs.readdirSync(servicesDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    for (const folder of folders) {
      if (['common', 'networks', 'cache', 'database', 'health', 'logger', 'middleware', 'utils'].includes(folder)) continue;

      const servicePath = path.join(servicesDir, folder);
      const routesPath = path.join(servicePath, 'routes');

      if (fs.existsSync(routesPath)) {
        const existing = this.services.get(folder) || {};
        this.services.set(folder, {
          ...existing,
          name: folder,
          path: servicePath,
          routesPath: routesPath,
          db: null,
          log: logger.createChild(`svc-${folder}`),
        });
        log.info(`Discovered dynamic service: ${folder}`);
      }
    }

    // --- Legacy/Class-based Service Discovery ---
    const networksDir = path.join(servicesDir, 'networks');
    if (fs.existsSync(networksDir)) {
      const files = fs.readdirSync(networksDir).filter(f => f.endsWith('.js'));
      const networksConfig = require('../config/networks');

      for (const file of files) {
        const slug = file.replace('Service.js', '').toLowerCase();
        const networkConfig = networksConfig[slug];

        if (!networkConfig || !networkConfig.enabled) continue;

        try {
          const ServiceClass = require(path.join(networksDir, file));
          const serviceInstance = new ServiceClass(networkConfig);
          
          const existing = this.services.get(slug) || {};
          this.services.set(slug, {
            ...existing,
            name: slug,
            instance: serviceInstance,
            log: serviceInstance.log || existing.log || logger.createChild(slug),
          });
          log.info(`Discovered class service: ${slug}`);
        } catch (err) {
          log.error(`Failed to load class service ${file}`, { error: err.message, stack: err.stack });
        }
      }
    }
  }

  /**
   * Inject verified database connections into each service from the DatabaseManager.
   */
  injectDatabases() {
    for (const [name, service] of this.services) {
      // 1. Inject into legacy class instance
      if (service.instance && typeof service.instance.injectDatabases === 'function') {
        service.instance.injectDatabases();
      }

      // 2. Inject into dynamic service container
      const sql = databaseManager.getSQL(name);
      const mongo = databaseManager.getMongo(name);
      const elastic = databaseManager.getElastic(name);

      service.db = { sql, mongo, elastic };
      log.debug(`Injected database connections into service: ${name}`, {
        sql: !!sql,
        mongo: !!mongo,
        elastic: !!elastic
      });
    }
  }

  /**
   * Register each service's routes into the main Express app.
   * Mounts them under `/api/{network_name}/*`.
   */
  registerRoutes(app) {
    for (const [name, service] of this.services) {
      // 1. Mount legacy class-based routes (e.g., /api/v1/facebook/status)
      if (service.instance && typeof service.instance.getRouter === 'function') {
        const router = service.instance.getRouter();
        app.use(`/api/v1/${name}`, router);
        log.info(`Mounted class routes for ${name}`);
      }

      // 2. Mount dynamic routes from files (e.g., /api/v1/facebook/ads/search)
      if (service.routesPath) {
        // Deterministic order matters when an additive route intentionally
        // intercepts a discriminator and falls through to a legacy router.
        const files = fs.readdirSync(service.routesPath).filter(f => f.endsWith('.js')).sort();

        for (const file of files) {
          try {
            const routeModule = require(path.join(service.routesPath, file));

            // If the route file exports a creator function, use it
            // creator function name pattern: create{Network}Routes
            const creatorName = `create${name.charAt(0).toUpperCase() + name.slice(1)}Routes`;
            let router;

            if (typeof routeModule[creatorName] === 'function') {
              // Pass the service object which contains db, log, and potentially the instance
              router = routeModule[creatorName](service);
            } else if (typeof routeModule === 'function') {
              router = routeModule(service);
            } else {
              router = routeModule; // assume it's a Router instance
            }

            if (router) {
              app.use(`/api/v1/${name}`, router);
              log.info(`Mounted dynamic routes for ${name} from ${file}`);
            }
          } catch (err) {
            log.error(`Failed to mount dynamic routes from ${file} for service ${name}`, { error: err.message });
          }
        }
      }
    }
  }

  getService(name) {
    return this.services.get(name) || null;
  }

  get size() {
    return this.services.size;
  }
}

// Singleton
module.exports = new ServiceRegistry();
