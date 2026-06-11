'use strict';

const dbManager = require('../../../database/DatabaseManager');
const logger = require('../../../logger');

const log = logger.createChild('notifications');

/**
 * GET /api/v1/common/notifications
 *
 * Returns keyword-scraping notifications for the authenticated user.
 * A notification is "ready" when the scraper has finished processing the
 * keyword request (notify_status = 1).
 *
 * Response: { code: 200, data: [ { id, keyword, type, ... } ], meta: { unreadCount } }
 */
async function getNotifications(req, res) {
  try {
    const userId = req.user?.id || req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ code: 401, message: 'Unauthorized' });
    }

    const sql = dbManager.getSQL('linkedin');
    if (!sql) {
      return res.status(503).json({ code: 503, message: 'Database unavailable' });
    }

    // Fetch the latest 20 notifications where scraper has completed (notify_status = 1)
    const rows = await sql.query(
      `SELECT id, keyword, type, facebook_status, instagram_status, google_status, native_status,
              notify_status, created_at
       FROM daily_keyword_requests
       WHERE user_id = ? AND notify_status = 1
       ORDER BY id DESC
       LIMIT 20`,
      [userId]
    );

    return res.json({
      code: 200,
      message: 'ok',
      data: rows || [],
      meta: { unreadCount: (rows || []).length },
    });
  } catch (err) {
    log.error('Error in getNotifications', { error: err.message });
    return res.status(500).json({ code: 500, message: err.message, data: null });
  }
}

/**
 * POST /api/v1/common/notifications/read
 *
 * Marks notifications as read (notify_status = 2) for the authenticated user.
 * Body: { ids: [1, 2, 3] }   — if empty/missing, marks ALL unread.
 */
async function markNotificationsRead(req, res) {
  try {
    const userId = req.user?.id || req.user?.user_id;
    if (!userId) {
      return res.status(401).json({ code: 401, message: 'Unauthorized' });
    }

    const sql = dbManager.getSQL('linkedin');
    if (!sql) {
      return res.status(503).json({ code: 503, message: 'Database unavailable' });
    }

    const { ids } = req.body || {};

    if (Array.isArray(ids) && ids.length > 0) {
      // Mark specific IDs as read (only if they belong to this user)
      const placeholders = ids.map(() => '?').join(',');
      await sql.query(
        `UPDATE daily_keyword_requests SET notify_status = 2
         WHERE user_id = ? AND id IN (${placeholders}) AND notify_status = 1`,
        [userId, ...ids]
      );
    } else {
      // Mark all unread as read
      await sql.query(
        `UPDATE daily_keyword_requests SET notify_status = 2
         WHERE user_id = ? AND notify_status = 1`,
        [userId]
      );
    }

    return res.json({ code: 200, message: 'Notifications marked as read' });
  } catch (err) {
    log.error('Error in markNotificationsRead', { error: err.message });
    return res.status(500).json({ code: 500, message: err.message, data: null });
  }
}

module.exports = { getNotifications, markNotificationsRead };
