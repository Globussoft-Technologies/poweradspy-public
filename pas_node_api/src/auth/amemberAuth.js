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
const dbManager = require('../database/DatabaseManager');

const log = logger.createChild('amember-auth');
const router = Router();

// Same table/key onboardingController.js reads (am_user_action, keyed by am_id).
// Kept local + fail-open: a failure here must never block the aMember login redirect.
async function resolveNeedsOnboarding(userId) {
  try {
    const ident = (s, def) => (/^[A-Za-z0-9_]+$/.test(String(s || '')) ? String(s) : def);
    const net = config.notifications?.tokenNetwork || 'facebook';
    const tbl = ident(config.notifications?.tokenTable, 'am_user_action');
    const sql = dbManager.getSQL(net);
    if (!sql) return false;
    const rows = await sql.query(`SELECT onboarding_completed FROM ${tbl} WHERE am_id = ? LIMIT 1`, [userId]);
    const row = Array.isArray(rows[0]) ? rows[0][0] : rows[0];
    const completed = row?.onboarding_completed === 1 || row?.onboarding_completed === true;
    return !completed;
  } catch (err) {
    log.warn('resolveNeedsOnboarding failed, defaulting to false (fail-open)', { userId, error: err.message });
    return false;
  }
}

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

/**
 * Fetch custom plan options from aMember invoice API.
 * Checks which platforms (Facebook, Instagram, etc.) are enabled for custom plans.
 * Mirrors PHP's custom plan invoice checking logic.
 */
async function fetchCustomPlanPlatforms(userId, apiUrl, apiKey) {
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

      if (!invData?.[0]?.nested?.['invoice-items']?.[0]?.options) continue;

      let customOptions;
      try {
        const rawOptions = invData[0].nested['invoice-items'][0].options;
        customOptions = typeof rawOptions === 'string' ? JSON.parse(rawOptions) : rawOptions;
      } catch (e) {
        continue;
      }

      // Check if any platform key exists (mirrors PHP array_key_exists checks)
      const platformKeys = ['facebook', 'Facebook', 'Instagram', 'Google', 'Youtube', 'YouTube', 'Native', 'GDN', 'Reddit', 'Quora', 'Pinterest', 'tiktok','linkedin'];
      const hasPlatform = platformKeys.some(k => k in customOptions);

      // Trust checkAmemberAccess() for active access validation — same as Laravel.
      // Only skip invoices that are explicitly invalid: void (2), refunded (3), failed (4).
      // All other statuses (0=active, 1=paid, 5=recurring finished, etc.) are valid.
      const invalidStatuses = new Set([2, 3, 4]);
      if (hasPlatform && !invalidStatuses.has(invoiceStatus)) {
        // Extract enabled platforms — all keys lowercase for consistency with planAccess middleware
        if (customOptions.Facebook?.value || customOptions.facebook?.value) platforms.facebook = 1;
        if (customOptions.Instagram?.value) platforms.instagram = 1;
        if (customOptions.YouTube?.value || customOptions.Youtube?.value) platforms.youtube = 1;
        if (customOptions.Google?.value) platforms.google = 1;
        if (customOptions.GDN?.value) platforms.gdn = 1;
        if (customOptions.Native?.value) platforms.native = 1;
        if (customOptions.Reddit?.value) platforms.reddit = 1;
        if (customOptions.Quora?.value) platforms.quora = 1;
        if (customOptions.Pinterest?.value) platforms.pinterest = 1;
        if (customOptions.tiktok?.value) platforms.tiktok = 1;
        if (customOptions.linkedin?.value) platforms.linkedin = 1;

        return { platforms, isCustom: true, customOptions };
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

    if (!userId) {
      return res.status(401).json({ code: 401, message: 'User not found in aMember' });
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
      const { platforms, isCustom } = await fetchCustomPlanPlatforms(
        userId, config.amember.apiUrl, config.amember.apiKey
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
    const needsOnboarding = await resolveNeedsOnboarding(parseInt(userId, 10));

    log.info('User authenticated', { userId, username, userSubscriptionType, expiryDate, platformAccess, needsOnboarding });

    // Step 7: Build JWT payload with all user data
    const payload = {
      id: parseInt(userId, 10),
      email,
      name,
      login: username,
      user_id: parseInt(userId, 10),
      userSubscriptionType,
      subscriptions,
      expiry_date: expiryDate,
      platformAccess,
      referrer: referrer || null,
      role: 'user',
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
