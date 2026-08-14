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

module.exports = { forkLogicalWorker, getLogicalWorkerId };
