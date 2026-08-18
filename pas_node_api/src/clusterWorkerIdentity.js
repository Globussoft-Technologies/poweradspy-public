'use strict';

/**
 * Fork a worker while retaining its stable logical slot. Node's `worker.id`
 * increases for every replacement and therefore cannot identify worker 1 after
 * repeated crashes.
 */
function forkLogicalWorker(cluster, logicalWorkerId) {
  const workerId = String(logicalWorkerId);
  const worker = cluster.fork({ WORKER_ID: workerId });
  worker.logicalWorkerId = workerId;
  return worker;
}

function getLogicalWorkerId(worker) {
  return String(worker?.logicalWorkerId ?? worker?.id);
}

/**
 * True if THIS process should own singleton background work (cron jobs,
 * queue workers, the live-watcher collector, ...) — the one exception to
 * "every worker is equivalent" needed because such jobs must run exactly
 * ONCE per deployment, not once per process.
 *
 * Two independent, stackable clustering layers can exist in how this app is
 * actually deployed, and this must return true for exactly one process no
 * matter which (if any) are active:
 *   - This app's OWN internal `cluster.fork()` (server.js, gated by
 *     config.cluster.enabled) — sets WORKER_ID via forkLogicalWorker above.
 *   - PM2's own `-i N` cluster mode — sets NODE_APP_INSTANCE (0-indexed),
 *     entirely independent of and unaware of the layer above.
 * A real deployment may run either layer, neither, or — if config.cluster.
 * enabled is left true while ALSO using `pm2 -i N` — both simultaneously,
 * which forks this app's own internal workers again inside every PM2
 * instance. Each check below is satisfied when its env var is ABSENT (that
 * layer isn't in play here) OR equals that layer's "first" id, so the
 * combined AND lands on exactly one process across any combination —
 * including double-clustering, where it's the (PM2 instance 0)'s (internal
 * worker 1). Without this, e.g. `pm2 -i N` alone (config.cluster.enabled:
 * false, so WORKER_ID is never set by anything) leaves the WORKER_ID-only
 * check permanently satisfied on all N processes — every "worker-1-only"
 * background job then runs N times in parallel instead of once.
 */
function isSingletonOwner() {
  const workerOk = !process.env.WORKER_ID || process.env.WORKER_ID === '1';
  const pmOk = process.env.NODE_APP_INSTANCE === undefined || process.env.NODE_APP_INSTANCE === '0';
  return workerOk && pmOk;
}

module.exports = { forkLogicalWorker, getLogicalWorkerId, isSingletonOwner };
