'use strict';

/**
 * Safety-net cron — NOT the primary status-resolution mechanism (that's the
 * client's own GET /jobs/:id poll, see jobsController.js). This only catches a
 * job whose browser tab closed mid-generation and therefore never polled it to a
 * terminal state, leaving a credit reserved indefinitely and the job stuck
 * 'queued'/'running' forever. Mirrors this session's chatgptadsEsOutboxJob.js
 * shape (same REGISTRY/config.json crons.jobs.<key> wiring).
 */

const databaseManager = require('../../../database/DatabaseManager');
const logger = require('../../../logger');
const repo = require('../repository');
const imageGenConfig = require('../config');
const { refreshFromUpstream } = require('../controllers/jobsController');

const log = logger.createChild('imagegen-stuck-job-sweep');
let running = false;

function boundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function runImageGenStuckJobSweep(jobConfig = {}) {
  if (running) {
    log.warn('Sweep skipped — previous sweep still running');
    return { skipped: true, processed: 0 };
  }
  running = true;
  const batchSize = boundedInt(jobConfig.batchSize, 25, 1, 100);
  const timeoutMinutes = boundedInt(jobConfig.timeoutMinutes, imageGenConfig.stuckJobTimeoutMinutes, 1, 1440);

  try {
    const mongo = databaseManager.getMongo('imageGen');
    if (!mongo || !mongo.db) {
      log.warn('Sweep skipped — Mongo unavailable');
      return { skipped: true, processed: 0 };
    }
    const db = mongo.db;
    const olderThan = new Date(Date.now() - timeoutMinutes * 60000);
    const stuck = await repo.findStuckJobs(db, olderThan, batchSize);

    let refreshed = 0;
    for (const job of stuck) {
      try {
        await refreshFromUpstream(db, job);
        refreshed++;
      } catch (err) {
        log.error('Stuck-job refresh failed', { job_id: String(job._id), error: err.message });
      }
    }

    const result = { skipped: false, processed: stuck.length, refreshed };
    if (stuck.length) log.info('Stuck-job sweep completed', result);
    return result;
  } finally {
    running = false;
  }
}

module.exports = { runImageGenStuckJobSweep };
