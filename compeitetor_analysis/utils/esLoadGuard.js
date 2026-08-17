import { esClient } from "./Elasticsearch.js";

/**
 * Load protection for the ES calls in Competitors/monitorService.js.
 *
 * Root cause of the 2026-08-17 "ES pegged at 99% CPU" incident: activeCompetitorContacts()
 * fires 9 ES calls per competitor (3 platforms x [24h count, all-time count, ad-preview]),
 * 8 competitors concurrently (pLimit(8)) — up to 72 concurrent ES calls from ONE run of the
 * daily digest, against a single-node cluster shared with pas_node_api. Confirmed directly
 * against production hot-threads/task list (post_owner_name multi_match+prefix queries
 * matching this file's advertiserClause shape exactly).
 *
 * Two layers, same approach already proven in pas_node_api/src/services/common/helpers/esConcurrency.js:
 *   - withLimit(): a small in-process semaphore so THIS process never has more than
 *     `max` of these calls in flight at once.
 *   - isEsUnderStress(): reads the cluster's own live thread-pool state (shared ground
 *     truth, no coordination needed) so calls back off for a cycle once the pool is
 *     actually saturated, instead of blindly adding to it.
 */

// Tightened 2026-08-17: this process's own in-process cap (withLimit, below)
// can only ever bound ITS OWN concurrency — if compeitetor_analysis runs as
// more than one process/instance, each one independently thinks "I'm only
// sending 1-2", while the ACTUAL cluster sees the sum of all of them at once.
// isEsUnderStress() is the only signal here that's inherently correct
// regardless of process count, because it reads the cluster's real,
// already-shared thread-pool state — so it's tuned aggressively: check often
// (1s cache, still cheap — metadata-only call) and back off well BEFORE the
// pool is fully saturated (60%), not only once it's already maxed out and
// queuing, by which point a burst has already landed.
const STRESS_CHECK_CACHE_MS = 1000;
const STRESS_QUEUE_THRESHOLD = 5;
const POOL_SATURATION_RATIO = 0.6;
const stressCache = new Map(); // serverKey -> { stressed, expiresAt }
const poolSizeByServer = new Map(); // serverKey -> configured search thread_pool size (static)
const lastRejectedByServer = new Map(); // serverKey -> last-seen cumulative `rejected` count

async function getSearchPoolSize(serverKey, client) {
  if (poolSizeByServer.has(serverKey)) return poolSizeByServer.get(serverKey);
  try {
    const info = await client.nodes.info({ metric: ["thread_pool"] });
    let size = null;
    for (const node of Object.values(info.nodes || {})) {
      const search = node.thread_pool?.search;
      if (search?.size) { size = search.size; break; }
    }
    poolSizeByServer.set(serverKey, size);
    return size;
  } catch (e) {
    return null;
  }
}

/** Is this ES server's search thread pool already under real load right now? */
export async function isEsUnderStress(serverKey) {
  const cached = stressCache.get(serverKey);
  if (cached && Date.now() < cached.expiresAt) return cached.stressed;

  let stressed = false;
  try {
    const client = esClient[serverKey];
    if (client) {
      const poolSize = await getSearchPoolSize(serverKey, client);
      const stats = await client.nodes.stats({ metric: ["thread_pool"] });
      for (const node of Object.values(stats.nodes || {})) {
        const search = node.thread_pool?.search;
        if (!search) continue;
        const prevRejected = lastRejectedByServer.get(serverKey) ?? search.rejected;
        const newRejections = search.rejected - prevRejected;
        lastRejectedByServer.set(serverKey, search.rejected);
        const poolBusy = poolSize != null && search.active >= poolSize * POOL_SATURATION_RATIO;
        if (poolBusy || search.queue > STRESS_QUEUE_THRESHOLD || newRejections > 0) stressed = true;
      }
    }
  } catch (e) {
    stressed = false; // a health-check failure must never itself block real work
  }

  stressCache.set(serverKey, { stressed, expiresAt: Date.now() + STRESS_CHECK_CACHE_MS });
  return stressed;
}

// Tiny in-process semaphore — never more than `max` concurrent calls per key.
const states = new Map();
function getState(key) {
  let s = states.get(key);
  if (!s) { s = { active: 0, waiters: [] }; states.set(key, s); }
  return s;
}
function acquire(key, max) {
  const s = getState(key);
  if (s.active < max) { s.active++; return Promise.resolve(); }
  return new Promise((resolve) => s.waiters.push(resolve));
}
function release(key) {
  const s = getState(key);
  s.active = Math.max(0, s.active - 1);
  const next = s.waiters.shift();
  if (next) { s.active++; next(); }
}
export async function withLimit(key, fn, max = 1) {
  await acquire(key, max);
  try { return await fn(); } finally { release(key); }
}
