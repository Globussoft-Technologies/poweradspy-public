'use strict';

const cron = require('node-cron');
const logger = require('../logger');
const nasAdminClient = require('../insertion/helpers/nasAdminClient');

const log = logger.createChild('nas-pernet-cron');

/**
 * Once a day at server-time midnight, kick a BACKGROUND per-network `du` on the NAS so the
 * NAS-storage report can show how much each network (fb/insta/gdn/native/yt/...) occupies. The
 * scan sums millions of files per network and takes many minutes, so it runs detached on the NAS
 * and the endpoints only read its cached result (see nasAdminClient.getPerNetworkSizes).
 *
 * Also kicks once ~2min after boot so the breakdown is populated without waiting for the first
 * midnight run. Registered on worker-1 only (see app.js) to avoid duplicate scans in cluster mode.
 */
function initNasPerNetworkDuCron(schedule = '0 0 * * *') {
  cron.schedule(schedule, async () => {
    try {
      if (!nasAdminClient.isConfigured()) return;
      const result = await nasAdminClient.kickPerNetworkDu();
      log.info('NAS per-network du kicked (daily)', { result });
    } catch (err) {
      log.warn('NAS per-network du kick failed', { error: err.message });
    }
  });

  // Bootstrap so the page has data soon after a deploy, not only after the next midnight.
  setTimeout(async () => {
    try {
      if (!nasAdminClient.isConfigured()) return;
      const result = await nasAdminClient.kickPerNetworkDu();
      log.info('NAS per-network du kicked (bootstrap)', { result });
    } catch (err) {
      log.warn('NAS per-network du bootstrap failed', { error: err.message });
    }
  }, 120000);

  log.info('✓ NAS per-network du cron initialized', { schedule });
}

module.exports = { initNasPerNetworkDuCron };
