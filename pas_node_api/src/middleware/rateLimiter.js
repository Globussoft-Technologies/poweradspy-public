'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../config');
const fs = require('fs');
const path = require('path');

// ─── IP Blocklist ─────────────────────────────────────────
let blockedIps = new Set();

function loadBlockedIps() {
  try {
    const filePath = path.resolve(process.cwd(), config.blockedIps.filePath);
    if (fs.existsSync(filePath)) {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      blockedIps = new Set(Array.isArray(data) ? data : []);
    }
  } catch (err) {
    // Silently ignore if file doesn't exist yet
  }
}

function saveBlockedIps() {
  try {
    const filePath = path.resolve(process.cwd(), config.blockedIps.filePath);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify([...blockedIps], null, 2), 'utf-8');
  } catch (err) {
    console.error('[rateLimiter] Failed to save blocked IPs:', err.message);
  }
}

// Load on startup
loadBlockedIps();

/**
 * Middleware to reject requests from blocked IPs.
 */
function ipBlocklistMiddleware(req, res, next) {
  const clientIp = req.ip || req.connection.remoteAddress;
  if (blockedIps.has(clientIp)) {
    return res.status(403).json({
      code: 403,
      message: 'Access denied. Your IP has been blocked.',
    });
  }
  next();
}

// Rate-limit ONLY the heavy, human-facing search + analytics endpoints (the ones
// worth protecting from abuse / accidental hammering). EVERYTHING ELSE is exempt —
// internal machine loops (crawler insertion, AI classifier, creative scorer, keyword
// scraper worker) and all other lighter/CRUD/internal APIs ran in tight server-side
// loops from a few fixed IPs and were tripping the per-IP limit (429). Matched on
// req.path (the app-level limiter sees the FULL path, e.g. /api/v1/facebook/ads/search).
const RATE_LIMITED_PATHS = [
  '/ads/search',            // main ad search (per-network + common)
  '/catsearch',             // AI category search
  '/ads/getAdsByAdvertiser', // advertiser search
  '/ads/analytics',         // ad analytics
  '/ads/getAdInsights',     // analytics insights
];

/**
 * Global rate limiter - reads values from config (100 req per 1 min per IP by default).
 * Applies ONLY to search + analytics (see RATE_LIMITED_PATHS); all other routes skip it.
 */
const globalLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.maxRequests,
  message: {
    code: 429,
    message: 'Too many requests from this IP, please try again later.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.ip || req.connection.remoteAddress,
  // Skip (exempt) everything EXCEPT the search/analytics endpoints above.
  skip: (req) => !RATE_LIMITED_PATHS.some((p) => req.path.includes(p)),
});

// ─── Blocklist management API (used by admin routes) ──────
function blockIp(ip) {
  blockedIps.add(ip);
  saveBlockedIps();
}

function unblockIp(ip) {
  blockedIps.delete(ip);
  saveBlockedIps();
}

function getBlockedIps() {
  return [...blockedIps];
}

function isBlocked(ip) {
  return blockedIps.has(ip);
}

module.exports = {
  globalLimiter,
  ipBlocklistMiddleware,
  blockIp,
  unblockIp,
  getBlockedIps,
  isBlocked,
  reloadBlockedIps: loadBlockedIps,
};
