'use strict';

/**
 * Tiny in-process semaphore that caps how many "heavy" Elasticsearch calls can be in
 * flight AT ONCE per network — no matter how many separate HTTP requests (users)
 * triggered them.
 *
 * Root cause of the 2026-08-14 "Google unusable" incident: the keyword ad-notification
 * poll (runs on EVERY active user's ~60s auto-poll — keywordAdNotificationController.js)
 * and the keyword explorer's ads-count batch fetch (fetchAdsCountForKeywordsByPlatform)
 * each fired their own ES queries with no GLOBAL cap. Each individual call site looked
 * throttled in isolation, but nothing bounded the SUM across concurrently active users —
 * so as more people had the dashboard open, more simultaneous queries piled onto a
 * single-node cluster with zero backpressure. Queries that normally finish in <1s ended
 * up queued for 30-70s, which piled on more queries on top, compounding the slowdown.
 *
 * withLimit() makes every caller queue for a turn under a shared per-key budget instead
 * of firing unboundedly. Deliberately Node-only in-memory (no Redis), matching this
 * project's existing in-process caching approach (see marketTrends.js).
 *
 * IMPORTANT — this cap is PER NODE PROCESS. Production runs this API under PM2 cluster
 * mode with multiple worker processes, each with its own independent memory, so this
 * semaphore alone bounds concurrency to (max × number of workers), not `max` overall
 * (confirmed 2026-08-17: 6-per-process cap still let 60-70+ concurrent queries through
 * across ~10-12 workers). Without Redis (explicitly ruled out for this project) there is
 * no cheap way to share a real counter across separate processes — so isEsUnderStress()
 * below is the ACTUAL cross-process safety net: it reads the ES cluster's own live
 * thread-pool stats, which already reflect every worker's combined load, and makes every
 * worker back off independently once the shared cluster (not just "my own count") is
 * genuinely saturated. Keep this per-process cap LOW (few workers' worth of headroom,
 * not a real global budget) and treat the stress check as the primary guard.
 */

const DEFAULT_MAX_CONCURRENT = 2;
const states = new Map(); // key -> { active, waiters: [] }

function getState(key) {
  let s = states.get(key);
  if (!s) { s = { active: 0, waiters: [] }; states.set(key, s); }
  return s;
}

function acquire(key, max) {
  const s = getState(key);
  if (s.active < max) {
    s.active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => s.waiters.push(resolve));
}

function release(key) {
  const s = getState(key);
  s.active = Math.max(0, s.active - 1);
  const next = s.waiters.shift();
  if (next) {
    s.active++;
    next();
  }
}

/**
 * Run `fn` gated behind the named semaphore — never more than `max` concurrent
 * invocations for the same `key` at once. Extra callers simply queue their turn.
 * `fn`'s own failure/success is passed through untouched; the slot is always released.
 */
async function withLimit(key, fn, max = DEFAULT_MAX_CONCURRENT) {
  await acquire(key, max);
  try {
    return await fn();
  } finally {
    release(key);
  }
}

// ─── circuit breaker: is this network's ES already under real stress right now? ───
//
// This is the ACTUAL cross-process guard (see the big comment above) — nodes.stats
// reflects the whole cluster's real thread-pool state, which already accounts for every
// PM2 worker's combined traffic, not just this one process's. Every worker checks the
// same shared ground truth and backs off independently once it's genuinely saturated,
// which is what makes this safe without Redis or any other coordination.
//
// Cached briefly per network so the health check itself can never become a new load
// source (it's a metadata-only nodes.stats call — same cost class already proven safe
// in scripts/diagnose-network-es.js — but still shouldn't run on every single query).
const STRESS_CHECK_CACHE_MS = 3000;
const STRESS_QUEUE_THRESHOLD = 5; // search thread_pool queue depth that signals real backlog
const stressCache = new Map(); // network -> { stressed, expiresAt }
const lastRejectedByNetwork = new Map(); // network -> last-seen cumulative `rejected` count
const poolSizeByNetwork = new Map(); // network -> configured search thread_pool size (static — fetched once)

// The search thread_pool's configured max size never changes at runtime, so this is
// fetched once per network and cached forever (not on the 3s TTL like the stress
// verdict itself) — a second cheap metadata-only call, same cost class as nodes.stats.
async function getSearchPoolSize(network, elastic) {
  if (poolSizeByNetwork.has(network)) return poolSizeByNetwork.get(network);
  try {
    const resp = await elastic.client.nodes.info({ metric: ['thread_pool'] }, { requestTimeout: 2000 });
    const info = resp.body || resp;
    let size = null;
    for (const node of Object.values(info.nodes || {})) {
      const search = node.thread_pool?.search;
      if (search?.size) { size = search.size; break; }
    }
    poolSizeByNetwork.set(network, size); // null is a valid cached "couldn't determine" result
    return size;
  } catch (e) {
    return null;
  }
}

async function isEsUnderStress(network, queueThreshold = STRESS_QUEUE_THRESHOLD) {
  const cached = stressCache.get(network);
  if (cached && Date.now() < cached.expiresAt) return cached.stressed;

  let stressed = false;
  try {
    const databaseManager = require('../../../database/DatabaseManager');
    const elastic = databaseManager.getElastic(network);
    if (elastic) {
      const poolSize = await getSearchPoolSize(network, elastic);
      const resp = await elastic.client.nodes.stats({ metric: ['thread_pool'] }, { requestTimeout: 2000 });
      const stats = resp.body || resp;
      for (const node of Object.values(stats.nodes || {})) {
        const search = node.thread_pool?.search;
        if (!search) continue;
        // `rejected` is cumulative since node start, not a rate — compare against the
        // last check to see if NEW rejections happened in this window.
        const prevRejected = lastRejectedByNetwork.get(network) ?? search.rejected;
        const newRejections = search.rejected - prevRejected;
        lastRejectedByNetwork.set(network, search.rejected);
        // Fully-saturated thread pool (every worker thread busy) is the real signal on a
        // single-node cluster — by the time the queue itself is deep, it's already very
        // late. Fall back to the queue-depth check if the pool size couldn't be read.
        const poolSaturated = poolSize != null && search.active >= poolSize;
        if (poolSaturated || search.queue > queueThreshold || newRejections > 0) stressed = true;
      }
    }
  } catch (e) {
    stressed = false; // a health-check failure must never itself block real work
  }

  stressCache.set(network, { stressed, expiresAt: Date.now() + STRESS_CHECK_CACHE_MS });
  return stressed;
}

module.exports = { withLimit, isEsUnderStress };
