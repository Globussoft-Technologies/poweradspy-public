'use strict';

const rateLimit = require('express-rate-limit');
const config = require('../config');
const fs = require('fs');
const path = require('path');
const { getClientIp } = require('../utils/geoip');

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

// Cross-worker sync (2026-08-18) — `blockedIps` is a per-process in-memory
// Set. Under PM2/cluster mode, blockIp() run by whichever worker answered
// the admin's POST only updated THAT worker's own Set (plus the shared
// file) — every other worker kept serving its stale, already-loaded Set:
// ipBlocklistMiddleware on those workers never saw the new block (so the
// IP wasn't actually blocked for most traffic), and an admin GET that
// landed on a different worker than the POST didn't show the new entry in
// the list either. Re-reading the file periodically converges every
// worker's enforcement within RELOAD_INTERVAL_MS; getBlockedIps() (below)
// additionally force-reloads on every call since it's only hit by the
// low-frequency admin list view, not the hot request path.
const RELOAD_INTERVAL_MS = 5000;
const _reloadTimer = setInterval(loadBlockedIps, RELOAD_INTERVAL_MS);
if (_reloadTimer.unref) _reloadTimer.unref();

/**
 * Middleware to reject requests from blocked IPs.
 */
function ipBlocklistMiddleware(req, res, next) {
  // getClientIp() (utils/geoip.js) checks cf-connecting-ip/x-forwarded-for/
  // x-real-ip before falling back to req.ip — behind Cloudflare/a reverse
  // proxy, plain req.ip can resolve to the proxy's own address, so a block
  // entered for the real client IP would never match incoming requests
  // (which all "arrive" as the proxy's IP under the old req.ip-only check).
  const clientIp = getClientIp(req) || req.ip || req.connection.remoteAddress;
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
  keyGenerator: (req) => getClientIp(req) || req.ip || req.connection.remoteAddress,
  // Skip (exempt) everything EXCEPT the search/analytics endpoints above.
  skip: (req) => !RATE_LIMITED_PATHS.some((p) => req.path.includes(p)),
});

// ─── Blocklist management API (used by admin routes) ──────
// Reload-then-mutate-then-save (not mutate-then-save) — closes the
// lost-update race where this worker's own in-memory Set is stale relative
// to the file (another worker blocked/unblocked something since this one
// last reloaded); saving straight from a stale Set would silently drop
// that other change when this write overwrites the whole file.
function blockIp(ip) {
  loadBlockedIps();
  blockedIps.add(ip);
  saveBlockedIps();
}

function unblockIp(ip) {
  loadBlockedIps();
  blockedIps.delete(ip);
  saveBlockedIps();
}

function getBlockedIps() {
  // Force-fresh — admin-only, low-frequency call (unlike ipBlocklistMiddleware,
  // which relies on the periodic reload above to stay fast on every request).
  loadBlockedIps();
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
