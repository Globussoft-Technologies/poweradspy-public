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
    const payload = { id: 281, email: 'test@pas.dev', name: 'Test User', plan_id: 69, role: 'admin' };
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

  // Build JWT payload (no sensitive data)
  const payload = {
    id: user.id,
    email: user.email,
    name: user.name || '',
    plan_id: user.plan_id || 0,
    role: user.role || 'user',
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
router.get('/me', authMiddleware, (req, res) => {
  return res.json({ code: 200, data: req.user });
});

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
  return res.json({
    code: 200,
    data: { planId: Number(planId), allowedPlatforms, filters, competitorLimits, customPlatformRestriction },
  });
}));

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
