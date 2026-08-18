'use strict';

/**
 * aMember Authentication — handles redirect from aMember after login.
 *
 * Flow (mirrors PHP FacebookController@loginpage):
 *   1. User logs in at aMember (/amember/member)
 *   2. aMember's main.phtml → base64(username) → redirect here
 *   3. We call aMember API: check-access/by-login → get user + subscriptions
 *   4. Resolve subscription type, custom plan platforms, expiry
 *   5. Generate JWT with full user data
 *   6. Redirect to React frontend with token
 *
 * Route: GET /loginpage/:encodedUsername
 */

const { Router } = require('express');
const { generateToken } = require('../middleware/auth');
const config = require('../config');
const logger = require('../logger');
const { resolveNeedsOnboarding, normalizeOnboardingMode } = require('../services/common/helpers/onboardingEligibility');

const log = logger.createChild('amember-auth');
const router = Router();

// Plan codes from config
const PLANS = () => config.amember.plans;
const FREE_CODE = () => config.amember.freePlanCode || 20;

// Custom plan codes (monthly, 6-month, yearly)
const CUSTOM_CODES = () => [
  ...(PLANS().custom || []),
];

// Reward + Beta codes (these get skipped when computing userSubscriptionType)
const SKIP_CODES = () => [
  ...(PLANS().reward || []),
  ...(PLANS().beta || []),
];

/**
 * Collect every configured, numeric aMember product ID.
 *
 * Plans contain nested groups (for example plans.yearly), while the current
 * pricing generation keeps its IDs under pricing.planIds. Keeping this lookup
 * config-driven prevents a newly configured regular plan from being mistaken
 * for an unknown/custom plan and receiving an all-zero platformAccess claim.
 */
function collectPlanCodes(value, codes = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectPlanCodes(item, codes);
    return codes;
  }

  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectPlanCodes(item, codes);
    return codes;
  }

  const code = Number(value);
  if (Number.isInteger(code) && code > 0) codes.add(code);
  return codes;
}

const KNOWN_PLAN_CODES = () => collectPlanCodes([
  PLANS(),
  config.pricing?.planIds || {},
]);

/**
 * Call aMember REST API to verify user and get subscriptions.
 * Returns the raw aMember response: { ok, user_id, name, email, subscriptions: { productId: expireDate, ... } }
 */
async function checkAmemberAccess(username) {
  const apiUrl = config.amember.apiUrl;
  const apiKey = config.amember.apiKey;

  if (!apiUrl || !apiKey) {
    throw new Error('aMember API URL or Key not configured');
  }

  const url = `${apiUrl}check-access/by-login?_key=${apiKey}&login=${encodeURIComponent(username)}`;
  log.info('Calling aMember API', { username });

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`aMember API returned ${response.status}`);
  }

  return response.json();
}

function extractAmemberUserRecord(data) {
  if (!data) return null;
  if (Array.isArray(data)) return data[0] || null;
  if (data?.user && typeof data.user === 'object') return data.user;
  if (data && typeof data === 'object') {
    if (data['0'] && typeof data['0'] === 'object') return data['0'];
    const firstNumericKey = Object.keys(data).find(key => /^\d+$/.test(key) && data[key] && typeof data[key] === 'object');
    if (firstNumericKey) return data[firstNumericKey];
  }
  if (data && typeof data === 'object' && (data.user_id || data.login || data.email)) return data;
  return null;
}

function buildAmemberUsersUrl(criteria, apiUrl, apiKey) {
  const params = new URLSearchParams({ _key: apiKey });
  if (criteria?.userId) {
    params.set('_filter[user_id]', String(criteria.userId));
  } else if (criteria?.username) {
    params.set('_filter[login]', String(criteria.username));
  } else {
    throw new Error('aMember user lookup requires userId or username');
  }
  return `${apiUrl}users?${params.toString()}`;
}

async function fetchAmemberUser(criteria, apiUrl, apiKey, { timeoutMs = 1200 } = {}) {
  try {
    const url = buildAmemberUsersUrl(criteria, apiUrl, apiKey);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`aMember users API returned ${response.status}`);
      }
      const data = await response.json();
      return extractAmemberUserRecord(data);
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    const lookup = criteria?.userId ? { userId: criteria.userId } : { username: criteria?.username };
    const error = err?.name === 'AbortError' ? `timeout after ${timeoutMs}ms` : err.message;
    log.warn('Failed to fetch aMember user details', { ...lookup, error });
    return null;
  }
}

/**
 * Fetch custom plan options from aMember invoice API.
 * Checks which platforms (Facebook, Instagram, etc.) are enabled for custom plans.
 * Mirrors PHP's custom plan invoice checking logic.
 */
const CUSTOM_PLATFORM_KEYS = {
  facebook: ['facebook'],
  instagram: ['instagram'],
  youtube: ['youtube'],
  google: ['google'],
  linkedin: ['linkedin'],
  gdn: ['gdn'],
  native: ['native'],
  reddit: ['reddit'],
  quora: ['quora'],
  pinterest: ['pinterest'],
  tiktok: ['tiktok'],
};

function isSelectedCustomOption(option) {
  const value = option && typeof option === 'object' && !Array.isArray(option)
    && Object.prototype.hasOwnProperty.call(option, 'value')
    ? option.value
    : option;

  if (Array.isArray(value)) return value.length > 0;
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value === null || value === undefined) return false;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized !== '' && !['0', 'false', 'no', 'off', 'none'].includes(normalized);
  }
  if (typeof value === 'object') return Object.values(value).some(isSelectedCustomOption);
  return Boolean(value);
}

function extractCustomPlanPlatforms(customOptions) {
  const platforms = Object.fromEntries(Object.keys(CUSTOM_PLATFORM_KEYS).map(key => [key, 0]));
  if (!customOptions || typeof customOptions !== 'object' || Array.isArray(customOptions)) {
    return { platforms, hasPlatformOptions: false };
  }

  const normalizedOptions = Object.fromEntries(
    Object.entries(customOptions).map(([key, value]) => [String(key).trim().toLowerCase(), value])
  );
  let hasPlatformOptions = false;

  for (const [platform, aliases] of Object.entries(CUSTOM_PLATFORM_KEYS)) {
    const matchingKey = aliases.find(alias => Object.prototype.hasOwnProperty.call(normalizedOptions, alias));
    if (!matchingKey) continue;
    hasPlatformOptions = true;
    platforms[platform] = isSelectedCustomOption(normalizedOptions[matchingKey]) ? 1 : 0;
  }

  return { platforms, hasPlatformOptions };
}

async function fetchCustomPlanPlatforms(userId, apiUrl, apiKey, activeCustomPlanIds = []) {
  const platforms = {
    facebook: 0, instagram: 0, youtube: 0, google: 0, linkedin: 0,
    gdn: 0, native: 0, reddit: 0, quora: 0, pinterest: 0, tiktok: 0,
  };

  try {
    const url = `${apiUrl}users?_key=${apiKey}&_filter[user_id]=${userId}&_nested[]=invoices`;
    const res = await fetch(url);
    const data = await res.json();

    if (!data || !data[0]?.nested?.invoices) return { platforms, isCustom: false };

    // Reverse invoices to check latest first (mirrors PHP array_reverse)
    const invoices = [...data[0].nested.invoices].reverse();

    for (const inv of invoices) {
      const invoiceId = inv.invoice_id;
      const invoiceStatus = parseInt(inv.status, 10);

      // Fetch invoice items for custom options
      const invUrl = `${apiUrl}invoices/${invoiceId}?_key=${apiKey}`;
      const invRes = await fetch(invUrl);
      const invData = await invRes.json();

      const invoiceItems = invData?.[0]?.nested?.['invoice-items'] || [];
      for (const invoiceItem of invoiceItems) {
        const itemPlanId = Number(invoiceItem?.product_id ?? invoiceItem?.item_id);
        if (activeCustomPlanIds.length > 0 && Number.isFinite(itemPlanId)
          && !activeCustomPlanIds.includes(itemPlanId)) continue;
        if (invoiceItem?.options === undefined || invoiceItem?.options === null) continue;

        let customOptions;
        try {
          const rawOptions = invoiceItem.options;
          customOptions = typeof rawOptions === 'string' ? JSON.parse(rawOptions) : rawOptions;
        } catch (e) {
          continue;
        }

        const extracted = extractCustomPlanPlatforms(customOptions);
        if (!extracted.hasPlatformOptions) continue;

        // checkAmemberAccess() already established that this custom product is
        // currently active for the user. aMember status 2 is Recurring Active,
        // so invoice status must not be interpreted here using unrelated legacy
        // status constants. The active subscription and matching item are the
        // authority; the item's Product Options define its network boundary.
        return {
          platforms: extracted.platforms,
          isCustom: true,
          customOptions,
          invoiceId,
          invoiceStatus,
        };
      }
    }
  } catch (err) {
    log.warn('Failed to fetch custom plan platforms', { error: err.message });
  }

  return { platforms, isCustom: false };
}

/**
 * Compute userSubscriptionType from subscriptions object.
 * Mirrors PHP logic: max key, skip reward(8) and beta(18) if other plans exist.
 */
function computeSubscriptionType(subscriptions) {
  const productIds = Object.keys(subscriptions).map(Number).sort((a, b) => a - b);
  if (productIds.length === 0) return FREE_CODE();

  let subType = Math.max(...productIds);
  const skipCodes = SKIP_CODES();

  // If max is reward/beta and there are other plans, use the next highest
  if (skipCodes.includes(subType) && productIds.length > 1) {
    const filtered = productIds.filter(id => !skipCodes.includes(id));
    subType = filtered.length > 0 ? Math.max(...filtered) : subType;
  }

  return subType;
}

/**
 * Compute expiry date from subscriptions.
 * Uses the expire date of the highest (max) product key.
 */
function computeExpiryDate(subscriptions) {
  const keys = Object.keys(subscriptions).map(Number);
  if (keys.length === 0) return null;
  const maxKey = Math.max(...keys);
  return subscriptions[maxKey] || null;
}

// ─── GET /loginpage/:encodedUsername ──────────────────────
router.get('/loginpage/:encodedUsername', async (req, res) => {
  try {
    const { encodedUsername } = req.params;
    const ip = req.query.ip || req.ip;
    const referrer = req.query.referrer || null;

    // Step 1: Decode base64 username
    const username = Buffer.from(encodedUsername, 'base64').toString('utf-8');
    if (!username) {
      return res.status(400).json({ code: 400, message: 'Invalid encoded username' });
    }

    log.info('aMember login redirect received', { username, ip, referrer });

    const shouldLookupUserCreatedAt = normalizeOnboardingMode(config.onboarding?.mode) === 'new_users';
    const amUserPromise = shouldLookupUserCreatedAt
      ? fetchAmemberUser({ username }, config.amember.apiUrl, config.amember.apiKey)
      : null;

    // Step 2: Call aMember API to verify user + get subscriptions
    const amData = await checkAmemberAccess(username);

    if (!amData || !amData.ok || amData.error) {
      log.warn('aMember access check failed', { username, error: amData?.error });
      return res.status(401).json({ code: 401, message: 'aMember authentication failed', error: amData?.error });
    }

    const userId = amData.user_id;
    const name = amData.name || '';
    const email = amData.email || '';
    const subscriptions = amData.subscriptions || {};
    let added = amData.added || amData.created_at || amData.createdAt || null;

    if (!userId) {
      return res.status(401).json({ code: 401, message: 'User not found in aMember' });
    }

    if (!added) {
      const amUser = amUserPromise
        ? await amUserPromise
        : await fetchAmemberUser({ userId }, config.amember.apiUrl, config.amember.apiKey);
      if (!amUser?.user_id || Number(amUser.user_id) === Number(userId)) {
        added = amUser?.added || amUser?.created_at || amUser?.createdAt || null;
      }
    }

    // Step 3: Handle free plan — if has plan 20 + other plans, remove 20 (mirrors PHP)
    const freeCode = FREE_CODE();
    if (freeCode in subscriptions && Object.keys(subscriptions).length > 1) {
      delete subscriptions[freeCode];
    }

    const currentDate = new Date().toISOString().split('T')[0];

    // Step 4: Check if subscriptions are valid (not expired)
    const expiryDate = computeExpiryDate(subscriptions);
    const hasValidSubscription = amData.ok && Object.keys(subscriptions).length > 0 &&
      expiryDate && expiryDate >= currentDate;

     if (!hasValidSubscription) {
      log.warn('No valid subscription', { userId, subscriptions });
      return res.redirect('https://app-dev.poweradspy.com/amember/member/index');
    }

    // Step 5: Resolve platform access.
    // Check invoices only when the user has a known custom plan ID OR an unrecognised plan ID
    // (future-proof for new custom plans added in aMember without a config change).
    // Regular plan users (Basic/Standard/Palladium etc.) skip this entirely — no extra API calls.
    const customCodes = CUSTOM_CODES();
    const allKnownPlanIds = KNOWN_PLAN_CODES();
    const subscriptionIds = Object.keys(subscriptions).map(Number);
    const hasCustomPlan = customCodes.some(code => subscriptionIds.includes(code));
    const hasUnknownPlan = subscriptionIds.some(id => !allKnownPlanIds.has(id));

    let platformAccess = {
      facebook: 1, instagram: 1, youtube: 1, google: 1, linkedin: 1,
      gdn: 1, native: 1, reddit: 1, quora: 1, pinterest: 1, tiktok: 1,
    };

    if (hasCustomPlan || hasUnknownPlan) {
      const activeCustomPlanIds = subscriptionIds.filter(id => customCodes.includes(id) || !allKnownPlanIds.has(id));
      const { platforms, isCustom } = await fetchCustomPlanPlatforms(
        userId, config.amember.apiUrl, config.amember.apiKey, activeCustomPlanIds
      );
      if (isCustom) {
        platformAccess = platforms;
      } else {
        // Could not read invoice platform options — restrict all platforms as safe fallback.
        // This prevents a custom plan user from getting full access due to an API/invoice issue.
        console.warn('[amemberAuth] Custom plan user: invoice platform fetch failed or returned no options — restricting all platforms', {
          userId, username, subscriptionIds,
        });
        platformAccess = {
          facebook: 0, instagram: 0, youtube: 0, google: 0, linkedin: 0,
          gdn: 0, native: 0, reddit: 0, quora: 0, pinterest: 0, tiktok: 0,
        };
      }
    }

    // Step 6: Compute subscription type (mirrors PHP max key logic)
    const userSubscriptionType = computeSubscriptionType(subscriptions);

    // Step 6b: Onboarding status — additive, fail-open (see resolveNeedsOnboarding above).
    const userIdNum = parseInt(userId, 10);
    const needsOnboarding = await resolveNeedsOnboarding(userIdNum, added);

    log.info('User authenticated', { userId, username, userSubscriptionType, expiryDate, platformAccess, needsOnboarding });

    // Step 7: Build JWT payload with all user data
    const payload = {
      id: userIdNum,
      email,
      name,
      login: username,
      user_id: userIdNum,
      userSubscriptionType,
      subscriptions,
      expiry_date: expiryDate,
      platformAccess,
      referrer: referrer || null,
      role: 'user',
      added,
      needsOnboarding,
    };

    const token = generateToken(payload);

    // Step 8: Set httpOnly cookie
    const isProd = config.env === 'production';
    res.cookie('authToken', token, {
      httpOnly: true,
      secure: isProd,
      sameSite: isProd ? 'None' : 'Lax',
      maxAge: config.jwt.cookieMaxAgeMs || 86400000,
      path: '/',
    });

    // Step 9: Redirect to React frontend with token
    const frontendUrl = config.amember.frontendUrl;
    const redirectUrl = `${frontendUrl}?token=${token}`;

    log.info('aMember login successful, redirecting', { userId, userSubscriptionType, frontendUrl });

    return res.redirect(redirectUrl);
  } catch (err) {
    log.error('aMember login error', { error: err.message, stack: err.stack });
    return res.status(500).json({ code: 500, message: 'aMember login failed', error: err.message });
  }
});

// ─── GET /logout ──────────────────────────────────────────
// aMember redirects here after its own logout.
// Clears auth cookie and redirects to aMember login page.
router.get('/logout', (req, res) => {
  // Clear cookie with all possible domain combinations
  res.clearCookie('authToken', { path: '/' });
  res.clearCookie('authToken', { path: '/', domain: '.poweradspy.com' });
  log.info('User logged out');
  // Redirect to aMember's /logout endpoint — this kills the aMember session too
  const amemberLogout = config.amember.amemberLogoutUrl || 'https://app-dev.poweradspy.com/amember/logout';
  return res.redirect(amemberLogout);
});

module.exports = router;
