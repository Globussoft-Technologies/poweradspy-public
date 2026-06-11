'use strict';

const dbManager = require('../../../database/DatabaseManager');
const logger = require('../../../logger');
const config = require('../../../config');

const log = logger.createChild('daily-keyword-request');

async function dailyKeywordRequest(req, res) {
  try {
    const { keyword, advertiser, domain, country, email, ads_count } = req.body;
    const user_id = req.user?.id || req.body.user_id;
    const userSubscriptionType = String(req.user?.userSubscriptionType || '');

    // REAL_TIME_STORE gate — read from config (config.json takes priority over .env)
    const realTimeStore = (config.dailyKeyword.realTimeStore || 'on').trim().toLowerCase();
    if (realTimeStore === 'off') {
      return res.json({ code: 200, message: 'store disabled', data: { status: 'skip' } });
    }
    const threshold = Number(realTimeStore);
    if (!isNaN(threshold) && realTimeStore !== 'on') {
      const count = Number(ads_count ?? 0);
      if (count >= threshold) {
        return res.json({ code: 200, message: 'ads count sufficient', data: { status: 'skip' } });
      }
    }

    if (!config.dailyKeyword.newPlanUser.includes(userSubscriptionType)) {
      return res.json({ code: 200, message: 'plan not eligible', data: { status: 'skip' } });
    }

    let searchTerm, type;
    if (keyword && keyword !== 'NA' && keyword !== '') {
      searchTerm = keyword.trim();
      type = 0;
    } else if (advertiser && advertiser !== 'NA' && advertiser !== '') {
      searchTerm = advertiser.trim();
      type = 1;
    } else if (domain && domain !== 'NA' && domain !== '') {
      searchTerm = domain.trim();
      type = 2;
    } else {
      return res.json({ code: 200, message: 'no search term', data: { status: 'skip' } });
    }

    const sql = dbManager.getSQL('linkedin');
    if (!sql) {
      return res.status(503).json({ code: 503, message: 'LinkedIn database unavailable' });
    }

    const reqCountry = country && country !== 'NA' ? JSON.stringify(country) : null;

    const existing = await sql.query(
      `SELECT id FROM daily_keyword_requests WHERE email = ? AND user_id = ? AND keyword = ? AND type = ? LIMIT 1`,
      [email, user_id, searchTerm, type]
    );

    if (existing && existing.length > 0) {
      return res.json({ code: 200, message: 'keyword already exists', data: { status: 'existing' } });
    }

    const user_name = req.user?.name || req.body.user_name || '';
    await sql.query(
      `INSERT INTO daily_keyword_requests
        (user_id, user_name, email, keyword, type, facebook_status, instagram_status, google_status, native_status, notify_status, email_status, reqCountry, created_at)
       VALUES (?, ?, ?, ?, ?, 9, 9, 9, 9, 0, 0, ?, NOW())`,
      [user_id, user_name, email, searchTerm, type, reqCountry]
    );

    return res.json({ code: 200, message: 'keyword request saved', data: { status: 'new' } });
  } catch (err) {
    log.error('Error in dailyKeywordRequest', { error: err.message });
    return res.status(500).json({ code: 500, message: err.message, data: null });
  }
}

// GET /get-priority-requests/:platform/:limit
// Fetches priority records (status=9) for the given platform, marks them status=1 + notify_status=1
async function getPriorityRequests(req, res) {
  try {
    const { platform, limit } = req.params;
    const take = parseInt(limit, 10) || 10;

    const sql = dbManager.getSQL('linkedin');
    if (!sql) {
      return res.status(503).json({ code: 503, message: 'LinkedIn database unavailable' });
    }

    const col = `${platform}_status`;

    const rows = await sql.query(
      `SELECT * FROM daily_keyword_requests WHERE ${col} = 9 ORDER BY id DESC LIMIT ${take}`
    );

    if (!rows.length) {
      return res.json({ code: 404, message: 'No Data found in Ad Request' });
    }

    const ids = rows.map(r => r.id);
    const placeholders = ids.map(() => '?').join(',');
    const updated = await sql.query(
      `UPDATE daily_keyword_requests SET ${col} = 1, notify_status = 1 WHERE id IN (${placeholders})`,
      ids
    );

    if (!updated.affectedRows) {
      return res.json({ code: 400, message: 'Something Went wrong during Status Update' });
    }

    return res.json({ code: 200, message: 'Status Updated Successfully', data: rows });
  } catch (err) {
    log.error('Error in getPriorityRequests', { error: err.message });
    return res.status(500).json({ code: 500, message: err.message, data: null });
  }
}

module.exports = { dailyKeywordRequest, getPriorityRequests };