'use strict';

const config = require('../../../config');
const logger = require('../../../logger');
const { getOnboardingLoginState } = require('./onboardingLoginState');

const log = logger.createChild('onboarding-eligibility');

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

function hasCompletedOnboarding(row) {
  return row?.onboarding_completed === 1 || row?.onboarding_completed === true;
}

async function resolveNeedsOnboarding(userId, userCreatedAt = null) {
  try {
    if (!userId) return false;
    const state = await getOnboardingLoginState(userId);
    const effectiveCreatedAt = state?.onboarding_user_created_at || userCreatedAt || state?.onboarding_first_login_at || null;
    if (!isEligibleByMode(effectiveCreatedAt)) return false;
    const completed = hasCompletedOnboarding(state);
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
