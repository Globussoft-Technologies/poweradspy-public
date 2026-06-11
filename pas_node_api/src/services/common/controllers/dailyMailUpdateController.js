'use strict';

const dbManager = require('../../../database/DatabaseManager');
const EmailService = require('../../EmailService');
const logger = require('../../../logger');
const config = require('../../../config');
const axios = require('axios');

const log = logger.createChild('daily-mail-update');

// Which DB (network) + table to read pending requests from — config-driven, no hardcoding.
const PENDING_NET = config.notifications?.pendingNetwork || 'linkedin';
const PENDING_TBL = /^[A-Za-z0-9_]+$/.test(String(config.notifications?.pendingTable || ''))
  ? config.notifications.pendingTable : 'daily_keyword_requests';

// Search type stored on each request row: 0 = keyword, 1 = advertiser, 2 = domain.
const TYPE_LABEL = { 0: 'keyword', 1: 'advertiser', 2: 'domain' };

/**
 * Send daily mail update with new ads found
 * Runs via cron at 00:30 daily
 * Exact logic from PHP Userv2Controller@sendMailDailyUpdate
 */
exports.sendMailDailyUpdate = async (req, res) => {
  try {
    const sql = dbManager.getSQL(PENDING_NET);
    if (!sql) {
      log.error('Pending-requests database connection not available', { network: PENDING_NET });
      return res?.status(503).json({ code: 503, message: 'Database unavailable' }) || null;
    }

    // Get all daily keyword requests where email_status = 0 (not sent)
    // Status: If ANY network has status = 2 (ads found), send email
    const query = `
      SELECT id, email, keyword, type, updated_at, user_id, user_name, created_at,
             google_status, facebook_status, instagram_status, native_status
      FROM ${PENDING_TBL}
      WHERE (google_status = 2 OR facebook_status = 2 OR
             native_status = 2 OR instagram_status = 2)
      AND email_status = 0
      AND LENGTH(TRIM(keyword)) > 1
      ORDER BY created_at DESC
      LIMIT 500
    `;

    const queryResult = await sql.query(query);
    console.log('[DAILY_MAIL_DEBUG] Query result:', JSON.stringify(queryResult).substring(0, 200));
    console.log('[DAILY_MAIL_DEBUG] Result[0] type:', typeof queryResult[0], 'is array:', Array.isArray(queryResult[0]));

    const results = Array.isArray(queryResult[0]) ? queryResult[0] : queryResult;
    console.log('[DAILY_MAIL_DEBUG] Results:', results.length, 'items');

    // Safety check - ensure results is an array
    if (!Array.isArray(results) || results.length === 0) {
      console.log('[DAILY_MAIL_DEBUG] NO PENDING - results empty or not array');
      log.info('No pending emails to send', { resultsType: typeof results, isArray: Array.isArray(results), length: results?.length });
      return res?.json({ code: 200, message: 'No pending emails' }) || null;
    }

    console.log('[DAILY_MAIL_DEBUG] FOUND', results.length, 'pending emails');
    log.info('Found pending emails', { count: results.length });

    // Group by user_id and take top 5 keywords per user
    const groupedByUser = {};

    results.forEach(row => {
      if (!groupedByUser[row.user_id]) {
        groupedByUser[row.user_id] = [];
      }
      groupedByUser[row.user_id].push(row);
    });

    const userKeywords = {};
    Object.entries(groupedByUser).forEach(([userId, keywords]) => {
      userKeywords[userId] = keywords.slice(0, 5);
    });

    const emailsSent = [];

    // Process each user
    for (const [userId, keywordsArray] of Object.entries(userKeywords)) {
      let platforms = [];
      let keywords = {};

      // Process each keyword for this user
      for (const row of keywordsArray) {
        // Label each item with its search type so the email shows
        // "myntra (keyword)" / "example.com (domain)" / "Nike (advertiser)".
        const typeLabel = TYPE_LABEL[Number(row.type)] || 'keyword';
        const keyword = `${row.keyword} (${typeLabel})`;

        // Determine which networks found ads (status = 2)
        if (row.google_status === 2) {
          if (!platforms.includes('google')) platforms.push('google');
          if (!keywords['google']) keywords['google'] = [];
          keywords['google'].push(keyword);
        }
        if (row.facebook_status === 2) {
          if (!platforms.includes('facebook')) platforms.push('facebook');
          if (!keywords['facebook']) keywords['facebook'] = [];
          keywords['facebook'].push(keyword);
        }
        if (row.instagram_status === 2) {
          if (!platforms.includes('instagram')) platforms.push('instagram');
          if (!keywords['instagram']) keywords['instagram'] = [];
          keywords['instagram'].push(keyword);
        }
        if (row.native_status === 2) {
          if (!platforms.includes('native')) platforms.push('native');
          if (!keywords['native']) keywords['native'] = [];
          keywords['native'].push(keyword);
        }
      }

      // Send email to user
      if (Object.keys(keywords).length > 0) {
        const emailResult = await EmailService.sendDailyMailUpdate(
          keywordsArray[0].email,
          keywordsArray[0].user_name,
          platforms,
          keywords,
          null
        );

        emailsSent.push(emailResult);

        // Update email_status = 1 ONLY for the rows actually included in this email
        // (not every row of the user) — so any keyword left out still gets emailed later.
        if (emailResult.status) {
          const emailedIds = keywordsArray.map(r => r.id);
          const placeholders = emailedIds.map(() => '?').join(',');
          await sql.query(
            `UPDATE ${PENDING_TBL} SET email_status=1 WHERE id IN (${placeholders})`,
            emailedIds
          );
          log.info('Email sent and status updated', { userId, email: keywordsArray[0].email, rows: emailedIds.length });
        }
      }
    }

    log.info('Daily mail update completed', { emailsSent: emailsSent.length });
    return res?.json({ code: 200, message: 'Daily mail update completed', emailsSent: emailsSent }) || emailsSent;

  } catch (error) {
    log.error('Error in sendMailDailyUpdate', { error: error.message });
    return res?.status(500).json({ code: 500, message: 'Error sending daily updates', error: error.message }) || null;
  }
};
