'use strict';

const cron = require('node-cron');
const axios = require('axios');
const logger = require('../logger');
const config = require('../config');
const { sendMailDailyUpdate } = require('../services/common/controllers/dailyMailUpdateController');
const { sendPushNotification, resetDailyKeywordStatus } = require('../services/common/controllers/pushNotificationController');

const log = logger.createChild('push-notification-cron');

// Every cron time is interpreted in this timezone (default IST). So "daily 12:30 AM"
// always means 12:30 AM India time, regardless of the server's local timezone.
const TZ = config.notifications?.timezone || 'Asia/Kolkata';
const cronOpts = { timezone: TZ };

/**
 * Convert a human-friendly schedule string into a cron expression.
 * Accepts:
 *   - intervals:  "1 min", "5 min", "30 min", "1 hour", "2 hour", "5m", "1h"
 *   - daily time: "daily 12:30 AM", "daily 2:30 PM", "00:30", "2:30 pm"
 *   - raw cron:   "*\/5 * * * *" (5 fields, passed through unchanged)
 * Falls back to `fallbackCron` if it can't understand the input.
 */
function parseSchedule(input, fallbackCron) {
  if (!input || typeof input !== 'string') return fallbackCron;
  const s = input.trim().toLowerCase();

  // Raw cron (5 space-separated fields) — pass through
  if (input.trim().split(/\s+/).length === 5) return input.trim();

  // "N min" / "N minute(s)" / "Nm"
  let m = s.match(/(\d+)\s*(m|min|mins|minute|minutes)\b/);
  if (m) { const n = Math.max(1, +m[1]); return n === 1 ? '* * * * *' : `*/${n} * * * *`; }

  // "N hour(s)" / "Nh"
  m = s.match(/(\d+)\s*(h|hr|hrs|hour|hours)\b/);
  if (m) { const n = Math.max(1, +m[1]); return n === 1 ? '0 * * * *' : `0 */${n} * * *`; }

  // daily time "HH:MM" with optional am/pm
  m = s.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/);
  if (m) {
    let hh = +m[1]; const mm = +m[2]; const ap = m[3];
    if (ap === 'pm' && hh < 12) hh += 12;
    if (ap === 'am' && hh === 12) hh = 0;
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) return `${mm} ${hh} * * *`;
  }

  return fallbackCron;
}

/**
 * Push + in-app notification cron.
 * Schedule comes from config.notifications.pushSchedule (e.g. "1 min").
 * Calls the controller directly (no HTTP self-call) so it never depends on
 * the API port being reachable — handles status 2 (found) and 3 (not found).
 */
function initPushNotificationCron() {
  if (config.notifications?.pushEnabled === false) {
    log.info('Push notification cron disabled via config (pushEnabled=false)');
    return;
  }
  try {
    const cronExpr = parseSchedule(config.notifications?.pushSchedule, '*/5 * * * *');
    if (!cron.validate(cronExpr)) {
      log.error('Invalid push schedule — cron not started', { schedule: config.notifications?.pushSchedule, cronExpr });
      return;
    }

    cron.schedule(cronExpr, async () => {
      try {
        log.debug('Push notification cron triggered');
        // Direct in-process call — action defaults to '0' inside the controller.
        await sendPushNotification(null, null);
        log.debug('Push notification cron job completed');
      } catch (error) {
        log.error('Push notification cron job error', { error: error.message, code: error.code });
      }
    }, cronOpts);

    log.info(`✓ Push notification cron initialized (${config.notifications?.pushSchedule} → "${cronExpr}", ${TZ})`);
  } catch (error) {
    log.error('Failed to initialize push notification cron', { error: error.message });
  }
}

/**
 * Email digest cron.
 * Schedule comes from config.notifications.emailSchedule (e.g. "daily 12:30 AM").
 * Sends email digest with new ads (status 2 only) to users.
 */
function initDailyMailUpdateCron() {
  if (config.notifications?.emailEnabled === false) {
    log.info('Email digest cron disabled via config (emailEnabled=false)');
    return;
  }
  try {
    const cronExpr = parseSchedule(config.notifications?.emailSchedule, '30 0 * * *');
    if (!cron.validate(cronExpr)) {
      log.error('Invalid email schedule — cron not started', { schedule: config.notifications?.emailSchedule, cronExpr });
      return;
    }

    cron.schedule(cronExpr, async () => {
      try {
        log.info('Daily mail update cron triggered');
        await sendMailDailyUpdate(null, null);
        log.info('Daily mail update cron job completed');
      } catch (error) {
        log.error('Daily mail update cron job error', { error: error.message, code: error.code });
      }
    }, cronOpts);

    log.info(`✓ Email digest cron initialized (${config.notifications?.emailSchedule} → "${cronExpr}", ${TZ})`);
  } catch (error) {
    log.error('Failed to initialize daily mail update cron', { error: error.message });
  }
}

/**
 * Daily reset cron.
 * Schedule from config.notifications.resetSchedule (default "daily 12:30 AM" IST).
 * Resets the pending table for a fresh next-day cycle (statuses → 9, notify/email → 0).
 */
function initDailyResetCron() {
  if (config.notifications?.resetEnabled === false) {
    log.info('Daily reset cron disabled via config (resetEnabled=false)');
    return;
  }
  try {
    const cronExpr = parseSchedule(config.notifications?.resetSchedule, '30 0 * * *');
    if (!cron.validate(cronExpr)) {
      log.error('Invalid reset schedule — cron not started', { schedule: config.notifications?.resetSchedule, cronExpr });
      return;
    }

    cron.schedule(cronExpr, async () => {
      try {
        log.info('Daily reset cron triggered');
        await resetDailyKeywordStatus(null, null);
        log.info('Daily reset cron job completed');
      } catch (error) {
        log.error('Daily reset cron job error', { error: error.message, code: error.code });
      }
    }, cronOpts);

    log.info(`✓ Daily reset cron initialized (${config.notifications?.resetSchedule} → "${cronExpr}", ${TZ})`);
  } catch (error) {
    log.error('Failed to initialize daily reset cron', { error: error.message });
  }
}

/**
 * Update request keyword status cron job
 * Runs every day at 00:30
 * Exactly like: 30 0 * * * curl --request GET 'https://linkedin.poweradspy.com/update-requested-keyword-status'
 */
function initUpdateKeywordStatusCron() {
  if (config.notifications?.keywordStatusEnabled === false) {
    log.info('Update keyword status cron disabled via config (keywordStatusEnabled=false)');
    return;
  }
  try {
    // Run at 00:30 every day (IST)
    cron.schedule('30 0 * * *', async () => {
      try {
        log.debug('Update keyword status cron triggered');

        const updateUrl = `${process.env.LINKEDIN_API_URL || 'http://localhost:4000'}/api/v1/update-requested-keyword-status`;

        await axios.get(updateUrl, {
          timeout: 60000,
          headers: {
            'Content-Type': 'application/json'
          }
        });

        log.debug('Update keyword status cron job completed');
      } catch (error) {
        log.error('Update keyword status cron job error', {
          error: error.message,
          code: error.code
        });
      }
    }, cronOpts);

    log.info(`✓ Update keyword status cron initialized (runs at 00:30 daily, ${TZ})`);
  } catch (error) {
    log.error('Failed to initialize update keyword status cron', { error: error.message });
  }
}

module.exports = {
  initPushNotificationCron,
  initDailyMailUpdateCron,
  initDailyResetCron,
  initUpdateKeywordStatusCron
};
