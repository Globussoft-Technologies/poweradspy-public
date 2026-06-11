'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('../logger');
const config = require('../config');

const log = logger.createChild('local-cache');

/**
 * LocalCache - SQLite-based fallback cache.
 * Used when Redis is unavailable or not allowed.
 */
class LocalCache {
  constructor() {
    this.db = null;
    this.cacheDir = path.resolve(process.cwd(), config.localCache?.dir || 'data');
  }

  initialize() {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }

      const workerId = process.env.WORKER_ID || '1';
      const dbPath = path.join(this.cacheDir, `cache_w${workerId}.db`);

      this.db = new Database(dbPath);
      
      // Optimization settings
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = NORMAL');

      // Create table
      this.db.prepare(`
        CREATE TABLE IF NOT EXISTS cache (
          key TEXT PRIMARY KEY,
          value TEXT,
          expires_at INTEGER
        )
      `).run();

      // Create index on expiration
      this.db.prepare('CREATE INDEX IF NOT EXISTS idx_expires ON cache(expires_at)').run();

      log.info(`SQLite local cache initialized at ${dbPath}`);

      // Start cleanup interval
      this._startCleanup();
    } catch (err) {
      log.error('Failed to initialize local cache', { error: err.message });
    }
  }

  get(key) {
    if (!this.db) return null;
    try {
      const now = Math.floor(Date.now() / 1000);
      const row = this.db.prepare('SELECT value FROM cache WHERE key = ? AND (expires_at IS NULL OR expires_at > ?)').get(key, now);
      return row ? JSON.parse(row.value) : null;
    } catch (err) {
      log.error('LocalCache GET error', { key, error: err.message });
      return null;
    }
  }

  set(key, value, ttlSeconds) {
    if (!this.db) return false;
    try {
      const expiresAt = ttlSeconds ? Math.floor(Date.now() / 1000) + ttlSeconds : null;
      const data = JSON.stringify(value);
      this.db.prepare('INSERT OR REPLACE INTO cache (key, value, expires_at) VALUES (?, ?, ?)').run(key, data, expiresAt);
      return true;
    } catch (err) {
      log.error('LocalCache SET error', { key, error: err.message });
      return false;
    }
  }

  del(key) {
    if (!this.db) return false;
    try {
      this.db.prepare('DELETE FROM cache WHERE key = ?').run(key);
      return true;
    } catch (err) {
      log.error('LocalCache DEL error', { key, error: err.message });
      return false;
    }
  }

  flush(pattern) {
    if (!this.db) return false;
    try {
      // SQLite doesn't support glob natively for keys easily without extension, 
      // but we can use LIKE for simple patterns if needed.
      if (pattern.includes('*')) {
        const likePattern = pattern.replace(/\*/g, '%');
        this.db.prepare('DELETE FROM cache WHERE key LIKE ?').run(likePattern);
      } else {
        this.db.prepare('DELETE FROM cache').run();
      }
      return true;
    } catch (err) {
      log.error('LocalCache FLUSH error', { pattern, error: err.message });
      return false;
    }
  }

  _startCleanup() {
    const interval = config.localCache?.cleanupIntervalMs || 60000;
    setInterval(() => {
      try {
        const now = Math.floor(Date.now() / 1000);
        this.db.prepare('DELETE FROM cache WHERE expires_at IS NOT NULL AND expires_at < ?').run(now);
      } catch (err) {
        log.error('LocalCache cleanup error', { error: err.message });
      }
    }, interval).unref();
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = new LocalCache();
