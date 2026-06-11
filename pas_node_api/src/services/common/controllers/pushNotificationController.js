'use strict';

const dbManager = require('../../../database/DatabaseManager');
const firebaseService = require('../../FirebaseService');
const logger = require('../../../logger');
const config = require('../../../config');
const axios = require('axios');

const log = logger.createChild('push-notification');

// Which DB (network) + tables to use — all driven by config.notifications (no hardcoding).
// Table names are interpolated into SQL, so guard them to plain identifiers.
const ident = (s, def) => (/^[A-Za-z0-9_]+$/.test(String(s || '')) ? String(s) : def);
const PENDING_NET = config.notifications?.pendingNetwork || 'linkedin';
const TOKEN_NET   = config.notifications?.tokenNetwork || 'facebook';
const PENDING_TBL = ident(config.notifications?.pendingTable, 'daily_keyword_requests');
const TOKEN_TBL   = ident(config.notifications?.tokenTable, 'am_user_action');
const INAPP_TBL   = ident(config.notifications?.inAppTable, 'ad_notifications');

// Search type stored on each request row: 0 = keyword, 1 = advertiser, 2 = domain.
const TYPE_LABEL = { 0: 'keyword', 1: 'advertiser', 2: 'domain' };
const TYPE_PATH  = { 0: 'key', 1: 'advertiser', 2: 'domain' };

/**
 * Resolve each in-app notification's search type (0/1/2) WITHOUT a `type` column on
 * the in-app table: ad_notifications.ad_id holds the pending-request id, so we look the
 * type up from the pending table. Done as a separate query (not a JOIN) so it works even
 * when the two tables live in different network DBs. Falls back to 0 (keyword) on failure.
 */
async function attachTypes(notifications) {
  if (!Array.isArray(notifications) || notifications.length === 0) return;
  const ids = [...new Set(notifications.map(n => n.ad_id).filter(v => v != null))];
  const typeById = {};
  if (ids.length) {
    try {
      const pendingSql = dbManager.getSQL(PENDING_NET);
      if (pendingSql) {
        const placeholders = ids.map(() => '?').join(',');
        const r = await pendingSql.query(`SELECT id, type FROM ${PENDING_TBL} WHERE id IN (${placeholders})`, ids);
        const rows = Array.isArray(r[0]) ? r[0] : r;
        (rows || []).forEach(row => { typeById[row.id] = Number(row.type) || 0; });
      }
    } catch (e) {
      log.warn('attachTypes: could not resolve notification types', { error: e.message });
    }
  }
  notifications.forEach(n => { n.type = typeById[n.ad_id] ?? 0; });
}

/**
 * Register FCM token for push notifications
 * Stores token in am_user_action table
 */
exports.registerToken = async (req, res) => {
  try {
    const { userId, fcmToken, browserInfo } = req.body;

    if (!userId || !fcmToken) {
      return res.status(400).json({
        code: 400,
        message: 'userId and fcmToken are required'
      });
    }

    const sql = dbManager.getSQL(TOKEN_NET);

    if (!sql) {
      log.error('Token database connection not available', { network: TOKEN_NET });
      return res.status(503).json({ code: 503, message: 'Database unavailable' });
    }

    // Store FCM token in the configured token table (exactly like PHP)
    const userEmail = req.user?.email || '';
    const today = new Date().toISOString().split('T')[0];

    log.info('Attempting to register token', { userId, userEmail, today });

    try {
      const result = await sql.query(
        `INSERT INTO ${TOKEN_TBL} (am_id, am_email, fcm_token, am_subscription, ad_count, month_count, date, pinterest_launch_status)
         VALUES (?, ?, ?, 0, 0, 0, ?, 0)
         ON DUPLICATE KEY UPDATE fcm_token = VALUES(fcm_token)`,
        [userId, userEmail, fcmToken, today]
      );

      console.log('[DEBUG] Query result:', result);
      log.info('FCM token registered successfully', { userId, result });
    } catch (dbError) {
      console.error('[DEBUG] Query error:', dbError.message);
      log.error('Database query error', { error: dbError.message, stack: dbError.stack });
      throw dbError;
    }

    return res.json({
      code: 200,
      message: 'Token registered successfully',
      data: { userId, tokenPrefix: fcmToken.substring(0, 20) + '...' }
    });
  } catch (error) {
    log.error('Error registering token', { error: error.message });
    return res.status(500).json({
      code: 500,
      message: 'Error registering token',
      error: error.message
    });
  }
};

/**
 * Send push notification for keyword request
 * POST /send-push-notification/0
 * Same logic as PHP version: Userv2Controller@sendPushNotification
 */
exports.sendPushNotification = async (req, res) => {
  try {
    // When invoked directly from the cron there is no req/res — default action to '0'.
    const action = req?.params?.action ?? '0';

    if (action !== '0' && action !== '1') {
      return res?.status(400).json({
        code: 400,
        message: 'Invalid action'
      }) || null;
    }

    const sql = dbManager.getSQL(TOKEN_NET);
    if (!sql) {
      log.error('Token database connection not available', { network: TOKEN_NET });
      return res?.status(503).json({ code: 503, message: 'Database unavailable' }) || null;
    }

    if (action === '0') {
      // Get pending notifications from the configured pending table
      const pendingSql = dbManager.getSQL(PENDING_NET);
      if (!pendingSql) {
        return res?.status(503).json({ code: 503, message: 'Pending-requests database unavailable' }) || null;
      }

      // status 2 = ads found, status 3 = searched but no ads found. Both trigger a
      // browser-push + in-app notification (with different wording). 9 = not searched.
      const queryResult = await pendingSql.query(
        `SELECT id, user_id, keyword, type, email,
                google_status, facebook_status, instagram_status, native_status
         FROM ${PENDING_TBL}
         WHERE notify_status = 0 AND (
           google_status IN (2,3) OR facebook_status IN (2,3) OR
           instagram_status IN (2,3) OR native_status IN (2,3)
         )
         ORDER BY created_at DESC LIMIT 100`
      );

      log.info('Query result structure', { resultIsArray: Array.isArray(queryResult), resultLength: queryResult?.length, elem0Type: typeof queryResult?.[0] });

      const [rows, fields] = queryResult;
      const pendingNotifications = Array.isArray(rows) ? rows : queryResult;

      if (!Array.isArray(pendingNotifications) || pendingNotifications.length === 0) {
        log.info('No pending notifications', { isArray: Array.isArray(pendingNotifications), length: pendingNotifications?.length });
        return res?.json({ code: 200, message: 'No pending notifications' }) || { processed: 0 };
      }

      log.info('Found pending notifications', { count: pendingNotifications.length });

      // Batch-fetch FCM tokens for every user in this run — ONE query instead of N
      // (avoids the N+1 pattern when many users have pending notifications).
      const userIds = [...new Set(pendingNotifications.map(n => n.user_id).filter(v => v != null))];
      const tokenByUser = {};
      if (userIds.length) {
        const tph = userIds.map(() => '?').join(',');
        const tokenRes = await sql.query(
          `SELECT am_id, fcm_token FROM ${TOKEN_TBL} WHERE am_id IN (${tph}) AND fcm_token IS NOT NULL`,
          userIds
        );
        const tokenRows = Array.isArray(tokenRes[0]) ? tokenRes[0] : tokenRes;
        (tokenRows || []).forEach(row => { if (row.fcm_token) tokenByUser[row.am_id] = row.fcm_token; });
      }

      // Process each pending notification
      for (const notifData of pendingNotifications) {
        try {
          const { user_id, keyword, id: requestId } = notifData;

          // FCM token resolved from the batch map (no per-row query)
          const fcmToken = tokenByUser[user_id];
          if (!fcmToken) {
            log.warn('No FCM token found for user', { userId: user_id });
            continue;
          }

          // Search type: 0=keyword, 1=advertiser, 2=domain — drives both the URL and the wording.
          const typeNum = Number(notifData.type) || 0;
          const typeLabel = TYPE_LABEL[typeNum] || 'keyword';
          const APP_URL = process.env.APP_URL || 'http://localhost:3000';
          const notifyUrl = `${APP_URL}/facebook/landing/${TYPE_PATH[typeNum] || 'key'}/${keyword}`;

          // "found" if any network returned ads (status 2); otherwise it's a "not found" result (status 3).
          const adsFound = [notifData.google_status, notifData.facebook_status,
                            notifData.instagram_status, notifData.native_status].some(s => Number(s) === 2);

          // Prepare notification message based on result + search type
          const header = adsFound
            ? `Ads found for ${typeLabel} '${keyword}'`
            : `No new ads for ${typeLabel} '${keyword}'`;
          const text = adsFound
            ? `New ads are available for your searched ${typeLabel} "${keyword}", visit Dashboard`
            : `We could not find new ads for your searched ${typeLabel} "${keyword}" right now`;
          const inAppContent = adsFound
            ? `New ads found for ${typeLabel} "${keyword}"`
            : `No new ads found for ${typeLabel} "${keyword}"`;

          // Store in the in-app notifications table FIRST (before Firebase, so it persists even if Firebase fails)
          await sql.query(
            `INSERT INTO ${INAPP_TBL} (user_id, ad_id, post_owner, image_video_url, notification_content)
             VALUES (?, ?, ?, ?, ?)`,
            [
              user_id,
              requestId,
              keyword,
              notifyUrl,
              inAppContent
            ]
          );

          // Send push notification via Firebase
          await firebaseService.sendNotification(
            fcmToken,
            header,
            text,
            '',
            notifyUrl
          );

          // Update notification status to "notified" in the pending table
          await pendingSql.query(
            `UPDATE ${PENDING_TBL} SET notify_status = 1 WHERE id = ?`,
            [requestId]
          );

          log.info('Notification sent and status updated', {
            userId: user_id,
            keyword,
            requestId
          });
        } catch (error) {
          const msg = error.message || '';
          // A dead token (invalid format or unregistered) will never succeed, so clear it
          // instead of retrying every cron run forever. The user re-registers a fresh token
          // on their next visit (frontend auto-register), then pending rows get delivered.
          const isDeadToken = /not a valid FCM registration token|registration-token-not-registered|not registered|Requested entity was not found/i.test(msg);
          if (isDeadToken && notifData.user_id) {
            try {
              await sql.query(`UPDATE ${TOKEN_TBL} SET fcm_token = NULL WHERE am_id = ?`, [notifData.user_id]);
              delete tokenByUser[notifData.user_id]; // don't reuse the dead token for this user's other rows this run
              log.warn('Cleared invalid FCM token — will re-register on next login', { userId: notifData.user_id });
            } catch (clearErr) {
              log.error('Failed to clear invalid FCM token', { userId: notifData.user_id, error: clearErr.message });
            }
          } else {
            log.error('Error processing notification', {
              userId: notifData.user_id,
              requestId: notifData.id,
              error: msg
            });
          }
        }
      }

      return res?.json({
        code: 200,
        message: 'Notifications processed',
        processed: pendingNotifications.length
      }) || { processed: pendingNotifications.length };
    }

    return res?.json({ code: 200, message: 'OK' }) || null;
  } catch (error) {
    log.error('Error in sendPushNotification', { error: error.message });
    return res?.status(500).json({
      code: 500,
      message: 'Error sending notifications',
      error: error.message
    }) || null;
  }
};

/**
 * Get pending notifications to display in UI
 * Similar to Laravel's getUnviewedNotification
 */
exports.getPendingNotifications = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ code: 401, message: 'Unauthorized' });
    }

    const sql = dbManager.getSQL(TOKEN_NET);
    if (!sql) {
      return res.status(503).json({ code: 503, message: 'Database unavailable' });
    }

    // Get unread notifications from the in-app notifications table
    const result = await sql.query(
      `SELECT id, user_id, ad_id, post_owner as keyword, notification_content, created_at, is_view
       FROM ${INAPP_TBL}
       WHERE user_id = ? AND is_view = 0
       ORDER BY id DESC`,
      [userId]
    );

    const notifications = Array.isArray(result[0]) ? result[0] : result;
    // Resolve real search type (keyword/advertiser/domain) so NotificationPopup shows the right icon/label
    await attachTypes(notifications);

    return res.json({
      code: 200,
      message: 'ok',
      data: notifications || [],
      meta: { unreadCount: notifications?.length || 0 }
    });
  } catch (error) {
    log.error('Error getting pending notifications', { error: error.message });
    return res.status(500).json({
      code: 500,
      message: 'Error fetching notifications',
      error: error.message
    });
  }
};

/**
 * Get all notifications (paginated)
 * Similar to Laravel's getAllNotification
 */
exports.getAllNotifications = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ code: 401, message: 'Unauthorized' });
    }

    const { skip = 0, limit = 20 } = req.body;

    const sql = dbManager.getSQL(TOKEN_NET);
    if (!sql) {
      return res.status(503).json({ code: 503, message: 'Database unavailable' });
    }

    // Get paginated notifications
    const rawRows = await sql.query(
      `SELECT * FROM ${INAPP_TBL}
       WHERE user_id = ?
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [userId, parseInt(limit), parseInt(skip)]
    );
    const notifications = Array.isArray(rawRows[0]) ? rawRows[0] : rawRows;

    // Resolve real search type (keyword/advertiser/domain) for the icon/label
    await attachTypes(notifications);

    // Get total count
    const countResult = await sql.query(
      `SELECT COUNT(*) as count FROM ${INAPP_TBL} WHERE user_id = ?`,
      [userId]
    );

    const totalCount = countResult?.[0]?.count || 0;

    return res.json({
      code: 200,
      message: 'ok',
      data: notifications || [],
      count: totalCount
    });
  } catch (error) {
    log.error('Error getting all notifications', { error: error.message });
    return res.status(500).json({
      code: 500,
      message: 'Error fetching notifications',
      error: error.message
    });
  }
};

/**
 * Mark notification as read
 * Similar to Laravel's updateNotification
 */
exports.markNotificationAsRead = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ code: 401, message: 'Unauthorized' });
    }

    const { notificationId, adId } = req.body;

    const sql = dbManager.getSQL(TOKEN_NET);
    if (!sql) {
      return res.status(503).json({ code: 503, message: 'Database unavailable' });
    }

    // Check if notification exists
    const exists = await sql.query(
      `SELECT * FROM ${INAPP_TBL} WHERE user_id = ? AND (id = ? OR ad_id = ?) LIMIT 1`,
      [userId, notificationId, adId]
    );

    if (exists && exists.length > 0) {
      // Mark as read
      const whereClause = notificationId
        ? `id = ? AND user_id = ?`
        : `ad_id = ? AND user_id = ?`;
      const params = notificationId
        ? [notificationId, userId]
        : [adId, userId];

      await sql.query(
        `UPDATE ${INAPP_TBL} SET is_view = 1 WHERE ${whereClause}`,
        params
      );

      return res.json({ code: 200, message: 'Notification marked as read' });
    }

    return res.status(404).json({ code: 404, message: 'Notification not found' });
  } catch (error) {
    log.error('Error marking notification as read', { error: error.message });
    return res.status(500).json({
      code: 500,
      message: 'Error updating notification',
      error: error.message
    });
  }
};

/**
 * Daily reset — runs once a day (IST 12:30 AM via cron).
 * Resets the pending table so the next day starts fresh:
 *   - all network statuses → 9 (not searched)
 *   - notify_status → 0 (not notified)
 *   - email_status → 0 (not emailed)
 * Single UPDATE statement (no per-row loop). req/res optional — callable from cron.
 */
exports.resetDailyKeywordStatus = async (req, res) => {
  try {
    const pendingSql = dbManager.getSQL(PENDING_NET);
    if (!pendingSql) {
      log.error('Pending DB unavailable for daily reset', { network: PENDING_NET });
      return res?.status(503).json({ code: 503, message: 'Database unavailable' }) || null;
    }

    // Only touch rows that aren't already in the reset state — keeps the write light.
    const result = await pendingSql.query(
      `UPDATE ${PENDING_TBL}
       SET google_status = 9, facebook_status = 9, instagram_status = 9, native_status = 9,
           notify_status = 0, email_status = 0
       WHERE notify_status <> 0 OR email_status <> 0
          OR google_status <> 9 OR facebook_status <> 9
          OR instagram_status <> 9 OR native_status <> 9`
    );
    const affected = result?.affectedRows ?? result?.[0]?.affectedRows ?? 0;

    log.info('Daily keyword status reset complete', { affectedRows: affected });
    return res?.json({ code: 200, message: 'Daily keyword status reset', affectedRows: affected })
      || { affectedRows: affected };
  } catch (error) {
    log.error('Error in resetDailyKeywordStatus', { error: error.message });
    return res?.status(500).json({ code: 500, message: 'Error resetting status', error: error.message }) || null;
  }
};
