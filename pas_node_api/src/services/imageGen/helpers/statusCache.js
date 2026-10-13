'use strict';

/**
 * Short-TTL in-memory throttle in front of the upstream Ad Studio job-status poll.
 *
 * Explicit product instruction: no Redis for this — a per-process node-cache is
 * enough. Its job is NOT to be a source of truth (Mongo is); it only stops a
 * browser tab polling our GET /jobs/:id every second from also hammering Ad
 * Studio's GET /jobs/{id} every second — a cache hit just means "we already
 * checked upstream a couple of seconds ago, nothing's changed since."
 */

const NodeCache = require('node-cache');
const imageGenConfig = require('../config');

// stdTTL in seconds; node-cache takes seconds, config stores ms.
const cache = new NodeCache({
  stdTTL: Math.max(1, Math.round(imageGenConfig.adStudio.pollCacheTtlMs / 1000)),
  checkperiod: 30,
  useClones: false,
});

function get(upstreamJobId) {
  return cache.get(upstreamJobId);
}
function set(upstreamJobId, value) {
  cache.set(upstreamJobId, value);
}
function del(upstreamJobId) {
  cache.del(upstreamJobId);
}

module.exports = { get, set, del };
