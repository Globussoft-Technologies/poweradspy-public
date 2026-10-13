'use strict';

/**
 * Queues uploaded Recreate reference images (product image + extra images) for
 * NAS deletion once nothing references them anymore — called from two places:
 *   1. jobsController.js's deleteMySpaceJob — a deleted job's own reference images.
 *   2. uploadController.js's deleteUpload — an image uploaded in the Recreate
 *      modal, then removed before ever being submitted in a job.
 * Enqueuing is a fast local Mongo insert; the actual NAS delete happens later on
 * imageGenNasCleanupSweep.js's own schedule (durable — survives a mid-delete
 * server restart; see repository.js's imagegen_nas_deletions collection).
 */

const repo = require('../repository');
const logger = require('../../../logger');

const log = logger.createChild('imagegen-nas-cleanup');

/** Queue every url in `urls` (falsy entries ignored) for later NAS deletion. */
async function queueImageDeletion(db, urls, userId = null) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean);
  for (const url of list) {
    try {
      await repo.enqueueNasDeletion(db, url, userId);
    } catch (err) {
      log.warn('Could not queue NAS deletion', { url, error: err.message });
    }
  }
}

module.exports = { queueImageDeletion };
