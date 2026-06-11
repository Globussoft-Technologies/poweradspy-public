'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Middleware to verify JWT token.
 * Accepts token from:
 *   1. Authorization: Bearer <token>  header  (mobile / non-browser clients)
 *   2. authToken httpOnly cookie              (React browser clients)
 */
function authMiddleware(req, res, next) {
  // 1. Try Authorization header first
  let token = null;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  }

  // 2. Fall back to httpOnly cookie
  if (!token && req.cookies && req.cookies.authToken) {
    token = req.cookies.authToken;
  }

  if (!token) {
    return res.status(401).json({
      code: 401,
      message: 'Unauthorized: No token provided',
    });
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret, { algorithms: [config.jwt.algorithm || 'HS512'] });

    // Attach user info to request
    req.user = decoded;

    // Auto-inject user_id into body for convenience (used by freePlanCheck etc.)
    if (req.body && !req.body.user_id) {
      req.body.user_id = decoded.id;
    }

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ code: 401, message: 'Unauthorized: Token expired' });
    }
    return res.status(401).json({ code: 401, message: 'Unauthorized: Invalid token' });
  }
}

/**
 * Utility to generate a token (used by login endpoint or dev tools)
 */
function generateToken(payload) {
  return jwt.sign(payload, config.jwt.secret, {
    algorithm: config.jwt.algorithm || 'HS512',
    expiresIn: config.jwt.expiresIn
  });
}

module.exports = {
  authMiddleware,
  generateToken
};
