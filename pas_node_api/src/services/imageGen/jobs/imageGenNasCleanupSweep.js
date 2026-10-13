'use strict';

/**
 * Durable NAS-deletion sweep for AI Recreate's uploaded reference images.
 *
 * Nothing calls deleteFromNas() directly from a request — enqueueing is a fast
 * local Mongo insert so the user never waits on the actual NAS round-trip, and
 * the queue survives a server restart mid-delete (picked back up next sweep).
 * Mirrors imageGenStuckJobSweep.js's shape (same REGISTRY/config.json
 * crons.jobs.<key> wiring) and nasUploadQueue.js's backoff/give-up posture.
 *
 * Each due row is re-checked against live job docs right before deleting —
 * "Recreate again" can prefill a NEW job with an OLDER job's already-uploaded
 * image URL (see repository.js's isImageUrlStillReferenced), so a row queued
 * when one job was deleted must not delete a file a different, still-live job
 * now depends on.
 */

const databaseManager = require('../../../database/DatabaseManager');
const logger = require('../../../logger');
const repo = require('../repository');
const { deleteFromNas, storedPathFromUrl } = require('../../../insertion/helpers/nasClient');

const log = logger.createChild('imagegen-nas-cleanup-sweep');
let running = false;

const BACKOFF_STEP_MS = 60 * 1000;      // attempt N waits N*1min...
const BACKOFF_MAX_MS = 30 * 60 * 1000;  // ...capped at 30 min

function boundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function processOne(db, row, counters) {
  try {
    const stillReferenced = await repo.isImageUrlStillReferenced(db, row.url);
    if (stillReferenced) {
      // Something else (a "Recreate again" job) now depends on this file — drop
      // the queued deletion, not the file.
      await repo.deleteNasDeletionRecord(db, row._id);
      counters.skippedReferenced++;
      return;
    }

    const storedPath = storedPathFromUrl(row.url);
    if (!storedPath) {
      // Not a URL this module resolved (unexpected shape) — nothing we can delete.
      await repo.deleteNasDeletionRecord(db, row._id);
      counters.skippedUnresolvable++;
      return;
    }

    const deleted = await deleteFromNas(storedPath);
    if (deleted) {
      await repo.deleteNasDeletionRecord(db, row._id);
      counters.deleted++;
      return;
    }
    throw new Error('deleteFromNas returned false');
  } catch (err) {
    const attempts = (row.attempts || 0) + 1;
    if (attempts >= 20) {
      await repo.markNasDeletionFailed(db, row._id);
      counters.gaveUp++;
      log.error('NAS cleanup gave up on a row', { url: row.url, attempts, error: err.message });
    } else {
      const nextAttemptAt = new Date(Date.now() + Math.min(BACKOFF_MAX_MS, BACKOFF_STEP_MS * attempts));
      await repo.rescheduleNasDeletion(db, row._id, { attempts, nextAttemptAt });
      counters.retry++;
    }
  }
}

async function runImageGenNasCleanupSweep(jobConfig = {}) {
  if (running) {
    log.warn('Sweep skipped — previous sweep still running');
    return { skipped: true, processed: 0 };
  }
  running = true;
  const batchSize = boundedInt(jobConfig.batchSize, 50, 1, 200);

  try {
    const mongo = databaseManager.getMongo('imageGen');
    if (!mongo || !mongo.db) {
      log.warn('Sweep skipped — Mongo unavailable');
      return { skipped: true, processed: 0 };
    }
    const db = mongo.db;
    const due = await repo.listDueNasDeletions(db, batchSize);
    const counters = { deleted: 0, retry: 0, gaveUp: 0, skippedReferenced: 0, skippedUnresolvable: 0 };

    for (const row of due) {
      await processOne(db, row, counters);
    }

    const result = { skipped: false, processed: due.length, ...counters };
    if (due.length) log.info('NAS cleanup sweep completed', result);
    return result;
  } finally {
    running = false;
  }
}

module.exports = { runImageGenNasCleanupSweep };
