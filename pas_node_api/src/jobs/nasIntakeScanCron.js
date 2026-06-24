'use strict';

const cron = require('node-cron');
const logger = require('../logger');
const nasAdminClient = require('../insertion/helpers/nasAdminClient');

const log = logger.createChild('nas-intake-cron');

/**
 * Hourly, kick a BACKGROUND per-network/per-tree file-intake scan on the NAS so the NAS-storage
 * report can show how much each network ingested TODAY (files/bytes per media-tree) plus a short
 * baseline and a today-by-hour split. Unlike the per-network `du` (which changes once a day), "today"
 * grows through the day, so this refreshes hourly. The scan runs detached on the NAS (~60-90s) and
 * the endpoints only read its cached result (see nasAdminClient.getIntake). Worker-1 only.
 *
 * Also kicks ~90s after boot so the matrix populates shortly after a deploy, not only at the next hour.
 */
function initNasIntakeScanCron(schedule = '7 * * * *') {
  cron.schedule(schedule, async () => {
    try {
      if (!nasAdminClient.isConfigured()) return;
      const result = await nasAdminClient.kickIntakeScan();
      log.info('NAS intake scan kicked (hourly)', { result });
    } catch (err) {
      log.warn('NAS intake scan kick failed', { error: err.message });
    }
  });

  // Bootstrap so the matrix has data soon after a deploy, not only after the next top-of-hour run.
  setTimeout(async () => {
    try {
      if (!nasAdminClient.isConfigured()) return;
      const result = await nasAdminClient.kickIntakeScan();
      log.info('NAS intake scan kicked (bootstrap)', { result });
    } catch (err) {
      log.warn('NAS intake scan bootstrap failed', { error: err.message });
    }
  }, 90000);

  log.info('✓ NAS intake scan cron initialized', { schedule });
}

module.exports = { initNasIntakeScanCron };
