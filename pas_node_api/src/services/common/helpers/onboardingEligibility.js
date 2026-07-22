'use strict';

const dbManager = require('../../../database/DatabaseManager');
const config = require('../../../config');
const logger = require('../../../logger');

const log = logger.createChild('onboarding-eligibility');

const ident = (s, def) => (/^[A-Za-z0-9_]+$/.test(String(s || '')) ? String(s) : def);
const NET = () => config.notifications?.tokenNetwork || 'facebook';
const TBL = () => ident(config.notifications?.tokenTable, 'am_user_action');

function normalizeMode(raw) {
  const mode = String(raw || '').trim().toLowerCase();
  if (mode === 'all' || mode === 'new_users' || mode === 'disabled') return mode;
  return 'new_users';
}

function normalizeDateOnly(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function isEligibleByMode(userCreatedAt) {
  const mode = normalizeMode(config.onboarding?.mode);
  if (mode === 'disabled') return false;
  if (mode === 'all') return true;

  const cutoff = normalizeDateOnly(config.onboarding?.newUsersAfterDate);
  const created = normalizeDateOnly(userCreatedAt);

  if (!cutoff || !created) return false;
  return created >= cutoff;
}

async function hasCompletedOnboarding(userId) {
  const sql = dbManager.getSQL(NET());
  if (!sql) return false;
  const rows = await sql.query(`SELECT onboarding_completed FROM ${TBL()} WHERE am_id = ? LIMIT 1`, [userId]);
  const row = Array.isArray(rows?.[0]) ? rows[0][0] : rows?.[0];
  return row?.onboarding_completed === 1 || row?.onboarding_completed === true;
}

async function resolveNeedsOnboarding(userId, userCreatedAt = null) {
  try {
    if (!userId) return false;
    if (!isEligibleByMode(userCreatedAt)) return false;
    const completed = await hasCompletedOnboarding(userId);
    return !completed;
  } catch (err) {
    log.warn('resolveNeedsOnboarding failed, defaulting to false (fail-open)', {
      userId,
      userCreatedAt,
      error: err.message,
    });
    return false;
  }
}

module.exports = {
  resolveNeedsOnboarding,
  normalizeOnboardingMode: normalizeMode,
};
