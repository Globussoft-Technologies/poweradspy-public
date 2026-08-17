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
const databaseManager = require('../database/DatabaseManager');
const { parseSchedule } = require('./pushNotificationCron');
const { runKeywordAdNotificationScan } = require('../services/common/controllers/keywordAdNotificationController');

const log = logger.createChild('keyword-ad-notify-cron');

const TZ = config.notifications?.timezone || 'Asia/Kolkata';
const cronOpts = { timezone: TZ };

// node-cron registers its own in-process timer — under PM2 cluster mode EVERY
// worker runs this file, so without a cross-process guard, N workers all fire
// the SAME 15-min scan simultaneously, each independently walking up to
// scanBatch (500) keyword_searches docs. That's the exact shape confirmed in
// production hot-threads/slowlog on 2026-08-17: dozens of advertiser-name
// ES queries (one per doc/network) in flight at once, all from this one cron.
// A MySQL named lock (same pattern as domainDateEsQueue.js's per-network
// GET_LOCK) makes only ONE worker actually run each tick; the rest see the
// lock held and skip immediately — cheap, no new infra, no config needed.
const CRON_LOCK_NAME = 'pas:keyword-ad-notify-cron';

async function withSingleWorkerLock(sqlSlug, lockName, fn) {
  const sql = databaseManager.getSQL(sqlSlug);
  const getConnection = sql?.getConnection || (sql?.pool?.getConnection ? () => sql.pool.getConnection() : null);
  if (!getConnection) {
    // No SQL to coordinate through — safer to skip this tick than let every
    // worker run the scan unguarded.
    log.warn('keyword ad-notify cron: no SQL connection available for lock, skipping this tick', { sqlSlug });
    return;
  }

  let connection;
  try {
    connection = await getConnection();
    const [rows] = await connection.execute('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
    const acquired = Number(rows?.[0]?.acquired) === 1;
    if (!acquired) {
      log.debug('keyword ad-notify cron: another worker already holds the lock, skipping this tick');
      return;
    }
    await fn();
  } catch (error) {
    log.error('keyword ad-notify cron lock error', { error: error.message });
  } finally {
    if (connection) {
      try { await connection.execute('SELECT RELEASE_LOCK(?) AS released', [lockName]); }
      catch (error) { log.warn('keyword ad-notify cron lock release failed', { error: error.message }); }
      connection.release();
    }
  }
}

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

    const sqlSlug = config.keywordSearch?.mongoSlug || 'facebook';
    cron.schedule(cronExpr, async () => {
      try {
        log.debug('Keyword ad-notification cron triggered');
        await withSingleWorkerLock(sqlSlug, CRON_LOCK_NAME, async () => {
          const summary = await runKeywordAdNotificationScan();
          log.debug('Keyword ad-notification cron job completed', summary);
        });
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
