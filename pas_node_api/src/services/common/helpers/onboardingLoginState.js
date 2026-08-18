'use strict';

const dbManager = require('../../../database/DatabaseManager');
const config = require('../../../config');
const logger = require('../../../logger');

const log = logger.createChild('onboarding-login-state');

const ident = (s, def) => (/^[A-Za-z0-9_]+$/.test(String(s || '')) ? String(s) : def);
const NET = () => config.notifications?.tokenNetwork || 'facebook';
const TBL = () => ident(config.notifications?.tokenTable, 'am_user_action');

function toMysqlDateTime(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function todayDateOnly(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().slice(0, 10);
}

function rowsOf(result) {
  return Array.isArray(result?.[0]) ? result[0] : (result || []);
}

async function getOnboardingLoginState(userId) {
  if (!userId) return null;
  const sql = dbManager.getSQL(NET());
  if (!sql) return null;

  const rows = rowsOf(await sql.query(
    `SELECT am_id, onboarding_completed, onboarding_first_login_at, onboarding_last_login_at, onboarding_user_created_at
       FROM ${TBL()}
      WHERE am_id = ?
      LIMIT 1`,
    [userId]
  ));

  return rows[0] || null;
}

async function ensureOnboardingLoginState(userId, userEmail = '', userCreatedAt = null) {
  try {
    if (!userId) return false;

    const sql = dbManager.getSQL(NET());
    if (!sql) return false;

    const now = new Date();
    const nowSql = toMysqlDateTime(now);
    const today = todayDateOnly(now);
    const createdAtSql = toMysqlDateTime(userCreatedAt);

    await sql.query(
      `INSERT INTO ${TBL()}
         (am_id, am_email, am_subscription, ad_count, month_count, date, pinterest_launch_status,
          onboarding_first_login_at, onboarding_last_login_at, onboarding_user_created_at)
       VALUES (?, ?, 0, 0, 0, ?, 0, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         am_email                    = COALESCE(NULLIF(VALUES(am_email), ''), am_email),
         onboarding_first_login_at   = COALESCE(onboarding_first_login_at, VALUES(onboarding_first_login_at)),
         onboarding_last_login_at    = VALUES(onboarding_last_login_at),
         onboarding_user_created_at  = COALESCE(onboarding_user_created_at, VALUES(onboarding_user_created_at))`,
      [userId, userEmail || '', today, nowSql, nowSql, createdAtSql]
    );

    return true;
  } catch (err) {
    log.warn('Failed to persist onboarding login state; continuing without blocking login', {
      userId,
      error: err.message,
    });
    return false;
  }
}

module.exports = {
  ensureOnboardingLoginState,
  getOnboardingLoginState,
  toMysqlDateTime,
};
