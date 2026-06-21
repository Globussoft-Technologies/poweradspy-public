'use strict';

const cron = require('node-cron');
const logger = require('../logger');
const nasAdminClient = require('../insertion/helpers/nasAdminClient');
const nasStorageHistory = require('../insertion/helpers/nasStorageHistory');

const log = logger.createChild('nas-storage-cron');

/**
 * Periodically snapshot NAS `df` (total/used/free) into the on-disk history so the admin
 * NAS-storage report has day-over-day data points even when nobody opens the page.
 * Default: every 6 hours at minute 17. Registered on worker-1 only (see app.js).
 */
function initNasStorageSnapshotCron(schedule = '17 */6 * * *') {
  cron.schedule(schedule, async () => {
    try {
      if (!nasAdminClient.isConfigured()) return;
      const df = await nasAdminClient.getStorage(true);
      nasStorageHistory.recordSnapshot(df);
      log.info('NAS storage snapshot recorded', { usedBytes: df.usedBytes, freeBytes: df.freeBytes, pctUsed: df.pctUsed });
    } catch (err) {
      log.warn('NAS storage snapshot failed', { error: err.message });
    }
  });
  log.info('✓ NAS storage snapshot cron initialized', { schedule });
}

module.exports = { initNasStorageSnapshotCron };
