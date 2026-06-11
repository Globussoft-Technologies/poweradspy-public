'use strict';

const redisCache = require('./RedisCache');
const localCache = require('./LocalCache');
const logger = require('../logger');

const log = logger.createChild('cache-store');

/**
 * CacheStore - Unified interface for Redis and SQLite cache.
 * Provides transparent fallback if Redis is down.
 */
class CacheStore {
  constructor() {
    this.backend = 'none'; // 'redis' or 'sqlite'
  }

  async initialize() {
    log.info('Initializing unified cache store...');

    // Attempt Redis connection
    await redisCache.connect();

    if (redisCache.connected) {
      this.backend = 'redis';
      log.info('Cache Store: Using Redis as primary backend');
    } else {
      this.backend = 'sqlite';
      localCache.initialize();
      log.warn('Cache Store: Falling back to SQLite local cache');
    }
  }

  async get(key) {
    if (this.backend === 'redis') {
      const data = await redisCache.get(key);
      if (data) return data;
      
      // If Redis was working but now failed (rare), check SQLite just in case
      if (!redisCache.connected) {
        log.warn('Redis disconnected during GET, trying SQLite');
        return localCache.get(key);
      }
    } else if (this.backend === 'sqlite') {
      return localCache.get(key);
    }
    return null;
  }

  async set(key, value, ttlSeconds) {
    if (this.backend === 'redis' && redisCache.connected) {
      return redisCache.set(key, value, ttlSeconds);
    }
    return localCache.set(key, value, ttlSeconds);
  }

  async del(key) {
    if (this.backend === 'redis' && redisCache.connected) {
      return redisCache.del(key);
    }
    return localCache.del(key);
  }

  async flush(pattern) {
    if (this.backend === 'redis' && redisCache.connected) {
      return redisCache.flush(pattern);
    }
    return localCache.flush(pattern);
  }

  buildKey(network, namespace, id) {
    return `${network}:${namespace}:${id}`;
  }

  async getHealth() {
    return {
      backend: this.backend,
      redis: { connected: redisCache.connected },
      sqlite: { initialized: !!localCache.db }
    };
  }

  async disconnect() {
    await redisCache.disconnect();
    localCache.close();
  }
}

module.exports = new CacheStore();
