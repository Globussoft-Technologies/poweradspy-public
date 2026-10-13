'use strict';

/**
 * Browser push for a Recreate job reaching a terminal status (succeeded/failed).
 *
 * Reuses the EXISTING, already-configured push stack — does not add a new one:
 *   - firebaseService.sendNotification() (src/services/FirebaseService.js) is the
 *     same generic FCM sender services/common/controllers/pushNotificationController.js
 *     already uses for keyword-search alerts.
 *   - The FCM token lookup uses the SAME config keys that controller already reads
 *     (config.notifications.tokenNetwork/tokenTable, default 'facebook'/'am_user_action')
 *     — one token per user, shared across every feature that pushes to them, so this
 *     intentionally does not introduce a second token store.
 *
 * Best-effort: every call site in jobsController.js fires this without awaiting it
 * (a slow/failed FCM call must never delay the poll response the frontend is
 * waiting on), so every failure here is caught and logged, never thrown.
 */

const dbManager = require('../../../database/DatabaseManager');
const firebaseService = require('../../FirebaseService');
const config = require('../../../config');
const logger = require('../../../logger');

const log = logger.createChild('imagegen-push');

const identOr = (value, fallback) => (/^[A-Za-z0-9_]+$/.test(String(value || '')) ? String(value) : fallback);
const TOKEN_NET = config.notifications?.tokenNetwork || 'facebook';
const TOKEN_TBL = identOr(config.notifications?.tokenTable, 'am_user_action');

async function getFcmToken(userId) {
  const sql = dbManager.getSQL(TOKEN_NET);
  if (!sql) return null;
  const result = await sql.query(`SELECT fcm_token FROM ${TOKEN_TBL} WHERE am_id = ? LIMIT 1`, [userId]);
  const rows = Array.isArray(result?.[0]) ? result[0] : result;
  return rows?.[0]?.fcm_token || null;
}

/** @param {{user_id:string|number, status:'succeeded'|'failed'|'cancelled'}} job */
async function notifyRecreateJobTerminal(job) {
  try {
    const fcmToken = await getFcmToken(job.user_id);
    if (!fcmToken) return; // no registered device for this user — nothing to push

    const appUrl = (process.env.APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
    const actionUrl = `${appUrl}/my-space`;

    const [title, body] = job.status === 'succeeded'
      ? ['Your recreated ad is ready', 'Your AI Recreate image has finished generating. Tap to view it in MySpace.']
      : ['Generation failed — credit refunded', 'We could not generate your image this time. Your credit has been refunded automatically.'];

    await firebaseService.sendNotification(fcmToken, title, body, '', actionUrl);
  } catch (err) {
    log.warn('Recreate push notification failed', { jobUserId: job.user_id, status: job.status, error: err.message });
  }
}

module.exports = { notifyRecreateJobTerminal };
