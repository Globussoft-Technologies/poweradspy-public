'use strict';

const cacheStore = require('../cache/CacheStore');
const logger = require('../logger');
const ResponseFormatter = require('../utils/responseFormatter');

const log = logger.createChild('cache-middleware');

/**
 * Cache middleware to intercept requests and serve cached data.
 * @param {string} namespace - cache namespace (e.g., 'posts')
 * @param {number} ttl - time to live in seconds (optional)
 */
const cache = (namespace, ttl) => async (req, res, next) => {
  if (req.method !== 'GET') return next();

  // Simple key generator based on URL and query params
  const network = req.baseUrl.split('/')[2]; // e.g., /api/facebook -> facebook
  if (!network) return next();

  const queryKey = Object.keys(req.query).sort().map(k => `${k}=${req.query[k]}`).join('&');
  const id = `${req.path}${queryKey ? '?' + queryKey : ''}`;
  const key = cacheStore.buildKey(network, namespace, id);

  try {
    const cachedData = await cacheStore.get(key);
    if (cachedData) {
      log.debug('Cache hit', { key });
      return ResponseFormatter.success(res, {
        data: cachedData,
        meta: { cached: true, backend: cacheStore.backend }
      });
    }

    // Wrap res.json to catch the data and cache it
    const originalJson = res.json;
    res.json = function(body) {
      if (res.statusCode === 200 && body && body.success && body.data) {
        // Cache only successful responses
        cacheStore.set(key, body.data, ttl).catch(err => {
          log.error('Failed to set cache after response', { key, error: err.message });
        });
      }
      return originalJson.call(this, body);
    };

    next();
  } catch (err) {
    log.error('Cache middleware error', { key, error: err.message });
    next();
  }
};

module.exports = cache;
