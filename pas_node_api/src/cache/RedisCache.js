'use strict';

const Redis = require('ioredis');
const logger = require('../logger');
const config = require('../config');

const log = logger.createChild('redis-cache');

/**
 * RedisCache - Primary distributed cache implementation.
 */
class RedisCache {
  constructor() {
    this.client = null;
    this.connected = false;
  }

  async connect() {
    if (this.client) return;

    try {
      this.client = new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        db: config.redis.db,
        retryStrategy: (times) => {
          const delay = Math.min(times * config.redis.retryDelayBase, config.redis.retryDelayMax);
          return delay;
        },
        maxRetriesPerRequest: config.redis.maxRetriesPerRequest,
      });

      this.client.on('connect', () => {
        this.connected = true;
        log.info('Redis connected');
      });

      this.client.on('error', (err) => {
        this.connected = false;
        log.error('Redis error', { error: err.message });
      });

      // Wait for initial connection attempt
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          log.warn('Redis connection timeout');
          resolve();
        }, config.redis.connectTimeoutMs);

        this.client.once('ready', () => {
          clearTimeout(timeout);
          resolve();
        });

        this.client.once('error', () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    } catch (err) {
      log.error('Failed to initialize Redis client', { error: err.message });
      this.connected = false;
    }
  }

  async get(key) {
    if (!this.connected) return null;
    try {
      const data = await this.client.get(key);
      return data ? JSON.parse(data) : null;
    } catch (err) {
      log.error('Redis GET error', { key, error: err.message });
      return null;
    }
  }

  async set(key, value, ttlSeconds) {
    if (!this.connected) return false;
    try {
      const data = JSON.stringify(value);
      if (ttlSeconds) {
        await this.client.set(key, data, 'EX', ttlSeconds);
      } else {
        await this.client.set(key, data);
      }
      return true;
    } catch (err) {
      log.error('Redis SET error', { key, error: err.message });
      return false;
    }
  }

  async del(key) {
    if (!this.connected) return false;
    try {
      await this.client.del(key);
      return true;
    } catch (err) {
      log.error('Redis DEL error', { key, error: err.message });
      return false;
    }
  }

  async flush(pattern) {
    if (!this.connected) return false;
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
      return true;
    } catch (err) {
      log.error('Redis FLUSH error', { pattern, error: err.message });
      return false;
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.quit();
      this.client = null;
      this.connected = false;
    }
  }
}

module.exports = new RedisCache();
