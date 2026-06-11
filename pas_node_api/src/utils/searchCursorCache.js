'use strict';

/**
 * Search-after cursor cache for deep Elasticsearch pagination.
 *
 * ES has a default max_result_window of 10000 (from + size <= 10000).
 * For pages beyond that, we use search_after instead of from/size.
 *
 * How it works:
 *  1. Normal pages (from < SAFE_FROM): use standard from/size ES query.
 *     After each response, cache the sort values of the last hit so the
 *     next deep page can use search_after.
 *
 *  2. Deep pages (from >= SAFE_FROM): look up the cached cursor for this
 *     exact `from` offset. If found, replace `from` with `search_after`.
 *     If not found (user jumped to a deep page cold), cap at SAFE_FROM.
 *
 * Cache key: `${queryHash}:${from}`
 * Cache is in-memory LRU (max MAX_SIZE entries), scoped per process.
 */

const config = require('../config');
const SAFE_FROM = (config.elasticsearch && config.elasticsearch.safeFrom) || 9000;
const MAX_SIZE   = 2000;  // max cursor entries in memory

// Simple LRU via insertion-order Map
const _cache = new Map();

function _set(key, value) {
  if (_cache.has(key)) _cache.delete(key); // re-insert to update order
  _cache.set(key, value);
  if (_cache.size > MAX_SIZE) {
    _cache.delete(_cache.keys().next().value); // evict oldest
  }
}

function _get(key) {
  return _cache.get(key);
}

/**
 * Build a stable hash string from all filter params (excluding pagination keys).
 * Used to scope cursors per unique query.
 */
function buildQueryHash(p) {
  const { take, skip, page, page_size, ...filters } = p; // eslint-disable-line no-unused-vars
  // Stable key: sort entries so object key order doesn't matter
  const sorted = Object.keys(filters).sort().reduce((acc, k) => {
    acc[k] = filters[k];
    return acc;
  }, {});
  return JSON.stringify(sorted);
}

/**
 * Save the sort values of the last hit so page (from + size) can use search_after.
 * @param {string} queryHash
 * @param {number} from        - the `from` value of the page just fetched
 * @param {number} size        - the page size used
 * @param {Array}  esHits      - raw ES hit objects (must have .sort array)
 */
function saveCursor(queryHash, from, size, esHits) {
  if (!esHits || esHits.length === 0) return;
  const lastHit = esHits[esHits.length - 1];
  if (!lastHit.sort) return; // sort values not present (no sort clause)
  const nextFrom = from + size;
  _set(`${queryHash}:${nextFrom}`, lastHit.sort);
}

/**
 * Retrieve a cached cursor for the given from offset.
 * @returns {Array|null} sort values for search_after, or null if not cached
 */
function getCursor(queryHash, from) {
  return _get(`${queryHash}:${from}`) || null;
}

module.exports = { SAFE_FROM, buildQueryHash, saveCursor, getCursor };
