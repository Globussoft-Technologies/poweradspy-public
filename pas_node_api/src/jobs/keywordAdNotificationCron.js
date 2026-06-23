'use strict';

/**
 * Keyword ad-notification cron — NEW, additive.
 *
 * Runs the keyword-search → ad-count notification scan on a schedule
 * (config.keywordSearch.notify.schedule, default "15 min"). Calls the controller
 * directly in-process (no HTTP self-call), mirroring the push/email crons. Disabled via
 * config.keywordSearch.notify.enabled=false (or keywordSearch.enabled=false).
 */

const cron = require('node-cron');
const logger = require('../logger');
const config = require('../config');
const { parseSchedule } = require('./pushNotificationCron');
const { runKeywordAdNotificationScan } = require('../services/common/controllers/keywordAdNotificationController');

const log = logger.createChild('keyword-ad-notify-cron');

const TZ = config.notifications?.timezone || 'Asia/Kolkata';
const cronOpts = { timezone: TZ };

function initKeywordAdNotificationCron() {
  const notify = config.keywordSearch?.notify;
  if (!config.keywordSearch?.enabled || notify?.enabled === false) {
    log.info('Keyword ad-notification cron disabled via config');
    return;
  }
  try {
    const cronExpr = parseSchedule(notify?.schedule, '*/15 * * * *');
    if (!cron.validate(cronExpr)) {
      log.error('Invalid keyword ad-notification schedule — cron not started', { schedule: notify?.schedule, cronExpr });
      return;
    }

    cron.schedule(cronExpr, async () => {
      try {
        log.debug('Keyword ad-notification cron triggered');
        const summary = await runKeywordAdNotificationScan();
        log.debug('Keyword ad-notification cron job completed', summary);
      } catch (error) {
        log.error('Keyword ad-notification cron job error', { error: error.message, code: error.code });
      }
    }, cronOpts);

    log.info(`✓ Keyword ad-notification cron initialized (${notify?.schedule} → "${cronExpr}", ${TZ})`);
  } catch (error) {
    log.error('Failed to initialize keyword ad-notification cron', { error: error.message });
  }
}

module.exports = { initKeywordAdNotificationCron };
