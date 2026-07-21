'use strict';

/**
 * Auth Routes
 * POST /api/auth/login  — verify credentials, issue JWT cookie + body
 * POST /api/auth/logout — clear JWT cookie
 * GET  /api/auth/me     — return current user from token
 */

const { Router } = require('express');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { generateToken, authMiddleware } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const validator = require('../middleware/validator');
const dbManager = require('../database/DatabaseManager');
const config = require('../config');
const logger = require('../logger');
const planAccessService = require('../services/planAccess/planAccessService');
const config2Notifications = config.notifications || {};

// Same table/key onboardingController.js reads (am_user_action, keyed by am_id).
// Kept local + fail-open: a failure here must never block login.
async function resolveNeedsOnboarding(userId) {
  try {
    const ident = (s, def) => (/^[A-Za-z0-9_]+$/.test(String(s || '')) ? String(s) : def);
    const net = config2Notifications.tokenNetwork || 'facebook';
    const tbl = ident(config2Notifications.tokenTable, 'am_user_action');
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

const log = logger.createChild('auth');
const router = Router();

// ─── Cookie options ────────────────────────────────────────
function cookieOptions() {
  const isProd = config.env === 'production';
  return {
    httpOnly: true,           // not accessible from JS — XSS protection
    secure: isProd,           // HTTPS only in production
    sameSite: isProd ? 'None' : 'Lax', // cross-origin in prod (React on separate domain)
    maxAge: config.jwt.cookieMaxAgeMs || 86400000, // default 24h in ms
    path: '/',
  };
}

// ─── POST /api/auth/login ──────────────────────────────────
router.post('/login',
  validator({ body: { email: { required: true }, password: { required: true } } }),
  asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // ─── Dev test user (development only — bypasses DB) ──
  if (config.isDev && email === 'test@pas.dev' && password === 'Test@123') {
    const needsOnboarding = await resolveNeedsOnboarding(281);
    const payload = { id: 281, email: 'test@pas.dev', name: 'Test User', plan_id: 69, role: 'admin', needsOnboarding };
    const token = generateToken(payload);
    res.cookie('authToken', token, cookieOptions());
    return res.json({ code: 200, message: 'Login successful', data: { token, expiresIn: config.jwt.expiresIn, user: payload } });
  }

  // Fetch user from the shared SQL DB
  // Table: user | Fields used: id, email, password, name, plan_id, role
  const sql = dbManager.getSQL('facebook') || dbManager.getSQL('instagram');
  if (!sql) {
    log.error('No SQL connection available for auth');
    return res.status(503).json({ code: 503, message: 'Database unavailable' });
  }

  const [user] = await sql.query(
    'SELECT id, email, password, name, plan_id, role FROM user WHERE email = ? LIMIT 1',
    [email]
  );

  if (!user) {
    return res.status(401).json({ code: 401, message: 'Invalid email or password' });
  }

  // Compare password — supports bcrypt (PHP password_hash) and plain MD5 fallback
  let passwordValid = false;
  const storedHash = user.password || '';

  if (storedHash.startsWith('$2')) {
    // bcrypt hash (PHP password_hash / password_verify compatible)
    passwordValid = await bcrypt.compare(password, storedHash);
  } else {
    // MD5 fallback for older PHP apps
    passwordValid = crypto.createHash('md5').update(password).digest('hex') === storedHash;
  }

  if (!passwordValid) {
    return res.status(401).json({ code: 401, message: 'Invalid email or password' });
  }

  const needsOnboarding = await resolveNeedsOnboarding(user.id);

  // Build JWT payload (no sensitive data)
  const payload = {
    id: user.id,
    email: user.email,
    name: user.name || '',
    plan_id: user.plan_id || 0,
    role: user.role || 'user',
    needsOnboarding,
  };

  const token = generateToken(payload);

  // Set httpOnly cookie — browser sends it automatically on every request
  res.cookie('authToken', token, cookieOptions());

  log.info('User logged in', { userId: user.id, email: user.email });

  return res.json({
    code: 200,
    message: 'Login successful',
    data: {
      token,                     // also return in body for clients that prefer header-based auth
      expiresIn: config.jwt.expiresIn,
      user: payload,
    },
  });
}));

// ─── POST /api/auth/logout ─────────────────────────────────
router.post('/logout', (_req, res) => {
  res.clearCookie('authToken', { path: '/' });
  return res.json({ code: 200, message: 'Logged out successfully' });
});

// ─── GET /api/auth/me ──────────────────────────────────────
router.get('/me', authMiddleware, asyncHandler(async (req, res) => {
  // Live lookup (not the JWT's baked-in value) — so completing onboarding
  // is reflected immediately on next /me call, without waiting for a fresh login/token.
  const userId = req.user?.id || req.user?.user_id;
  const needsOnboarding = await resolveNeedsOnboarding(userId);
  return res.json({ code: 200, data: { ...req.user, needsOnboarding } });
}));

// ─── GET /api/v1/auth/plan-access ─────────────────────────
router.get('/plan-access', authMiddleware, asyncHandler(async (req, res) => {
  // Get subscription type from JWT (aMember or SQL user)
  // Check userSubscriptionType first (aMember users), fallback to plan_id (SQL users)
  const planId = req.user?.userSubscriptionType || req.user?.plan_id;

  if (planId === undefined || planId === null) {
    return res.status(403).json({
      code: 403,
      message: 'Subscription plan not found. Please log in again.',
    });
  }

  const config2 = await planAccessService.getConfig();
  const network = req.query.network || 'all';

  // For aMember users, derive allowedPlatforms from their JWT platformAccess (mirrors planAccess middleware).
  // SQL users fall through to getAllowedPlatforms() from plan_config.
  let allowedPlatforms;
  let customPlatformRestriction = false;

  if (req.user?.platformAccess && !req.user?.plan_id) {
    const pa = req.user.platformAccess;
    const paLower = Object.fromEntries(Object.entries(pa).map(([k, v]) => [k.toLowerCase(), v]));
    const ALL_PLATFORMS = ['facebook', 'instagram', 'youtube', 'google', 'linkedin', 'gdn', 'native', 'reddit', 'quora', 'pinterest', 'tiktok'];
    const jwtAllowed = new Set(ALL_PLATFORMS.filter(p => !(p in paLower) || paLower[p] === 1));

    // True when JWT has explicit 0s — custom plan with restricted platform selection.
    // Returned to frontend so it can hide platform tabs (vs tier restrictions which just block clicks).
    customPlatformRestriction = ALL_PLATFORMS.some(p => (p in paLower) && paLower[p] === 0);

    // Custom plan users (33/46/70): their planId maps to GDN/Native tier in plan_config —
    // intersecting would give wrong platforms. JWT platformAccess is the source of truth.
    const customCodes = new Set(config.amember?.plans?.custom || [33, 46, 70]);
    const isCustomPlanUser = customCodes.has(Number(planId));

    if (isCustomPlanUser) {
      allowedPlatforms = ALL_PLATFORMS.filter(p => jwtAllowed.has(p));
    } else {
      const configAllowed = new Set(
        config2 && config2.length > 0
          ? planAccessService.getAllowedPlatforms(planId, config2)
          : ALL_PLATFORMS
      );
      allowedPlatforms = ALL_PLATFORMS.filter(p => jwtAllowed.has(p) && configAllowed.has(p));
    }
  } else {
    allowedPlatforms = planAccessService.getAllowedPlatforms(planId, config2);
  }

  const filters = planAccessService.getFilterStatus(planId, network, config2);
  const competitorLimits = planAccessService.getCompetitorLimits(planId, config2);
  // planTier drives PricingModal.jsx's "show only upgrade tiers" filter (currentPlanTier
  // prop) — this route is a separate implementation from planAccessMiddleware and was
  // missing it entirely, so the modal always fell back to showing every plan (including
  // the user's current one) instead of just the ones above it. Confirmed 2026-07-14.
  const planTier = planAccessService.resolvePlanTier(planId, config2);
  return res.json({
    code: 200,
    data: { planId: Number(planId), planTier, allowedPlatforms, filters, competitorLimits, customPlatformRestriction },
  });
}));

// ─── GET /api/v1/auth/plans-catalog ────────────────────────
// Public (no auth) — display-only plan/pricing data for the upgrade modal (and,
// eventually, a public pricing page). Which generation it returns is controlled by
// config.pricing.activePlanGeneration (docs/PLAN_ACCESS.md § 2026 Pricing Restructure).
// Never affects any existing subscriber's actual entitlements — those still come
// exclusively from plan_access_config via /plan-access above.
router.get('/plans-catalog', (req, res) => {
  const { getCatalog } = require('../services/planAccess/planCatalog');
  const generation = config.pricing?.activePlanGeneration || '2026-restructure';
  const multiplier = config.pricing?.annualPriceMultiplier || 10;
  const catalog = getCatalog(generation);
  // priceAnnual is computed here (not stored in planCatalog.js) so the discount
  // multiplier stays a single config value (PRD FR-18 §8) rather than baked into
  // hand-authored data for every plan.
  const plans = catalog.plans.map((p) => {
    const monthlyAmount = parseInt(String(p.price).replace(/[^0-9]/g, ''), 10) || 0;
    return { ...p, priceAnnual: `$${monthlyAmount * multiplier}/Year` };
  });
  return res.json({ code: 200, data: { generation, annualPriceMultiplier: multiplier, features: catalog.features, plans } });
});

// ─── POST /api/auth/refresh ────────────────────────────────
// Re-issues a fresh token if the current one is still valid (extends session)
router.post('/refresh', authMiddleware, (req, res) => {
  const { iat, exp, ...payload } = req.user; // strip old timing claims
  const token = generateToken(payload);
  res.cookie('authToken', token, cookieOptions());
  return res.json({
    code: 200,
    message: 'Token refreshed',
    data: { token, expiresIn: config.jwt.expiresIn },
  });
});

module.exports = router;
