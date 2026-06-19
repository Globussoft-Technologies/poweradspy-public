'use strict';

/**
 * nasUploadRetryCron — periodically retries NAS media uploads that failed in-request
 * (media.globussoft.com transient outages). The bytes were persisted to disk by
 * nasClient/nasUploadQueue, so this re-uploads from disk (no re-download → expiry-proof)
 * to the SAME deterministic key the ad already references. Self-healing, no data loss.
 *
 * Runs on one worker per machine (the pending dir is machine-local). Default: every minute.
 */

const cron = require('node-cron');
const logger = require('../logger');
const { sweepPending } = require('../insertion/helpers/nasUploadQueue');

const log = logger.createChild('nas-upload-retry-cron');

function initNasUploadRetryCron(schedule = '* * * * *') {
  cron.schedule(schedule, async () => {
    try { await sweepPending(); } catch (err) { log.error('NAS retry sweep failed', { error: err.message }); }
  });
  log.info('✓ NAS upload retry cron initialized', { schedule });
}

module.exports = { initNasUploadRetryCron };
