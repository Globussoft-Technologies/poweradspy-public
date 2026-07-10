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

/**
 * Global rate limiter - reads values from config (100 req per 1 min per IP by default).
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
    // crawler subsystems (insertion / landers / ocr+ocb) ko rate-limit se exempt karo
  skip: (req) => /\/(insertion|landers|ocr|newCatInsertion)\//.test(req.path),
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
