'use strict';

const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');

/**
 * Middleware to protect admin routes using JWT
 */
function adminAuthMiddleware(req, res, next) {
  try {
    const cookieHeader = req.headers.cookie || '';
    const cookies = Object.fromEntries(
      cookieHeader.split(';').map(c => c.trim().split('=').map(s => s.trim()))
    );

    const token = cookies['admin_session'] || req.headers['x-admin-token'];

    if (!token) {
      return res.status(401).json({ code: 401, message: 'No token provided' });
    }

    const decoded = jwt.verify(token, config.admin.sessionSecret);

    req.adminSession = decoded; // attach session
    next();
  } catch (err) {
    return res.status(401).json({ code: 401, message: 'Invalid or expired token' });
  }
}

/**
 * Middleware to require 'editor' role
 */
function requireEditorRole(req, res, next) {
  if (req.adminSession && req.adminSession.role === 'editor') {
    return next();
  }
  return res.status(403).json({
    code: 403,
    message: 'Edit access required. Please verify your system key.'
  });
}

/**
 * Login handler (JWT)
 */
function login(req, res) {
  const { username, password } = req.body;
  const { sendTelegramAlert } = require('../utils/telegram');

  if (username === config.admin.username && password === config.admin.password) {

    const token = jwt.sign(
      {
        username,
        role: 'viewer'
      },
      config.admin.sessionSecret,
      { expiresIn: '1d' }
    );

    res.cookie('admin_session', token, {
      httpOnly: true,
      maxAge: config.admin.sessionMaxAgeMs || 86400000,
      sameSite: 'none',
      secure: true, // 🔥 important
      path: '/',
    });

    const ip = req.headers['cf-connecting-ip'] || req.ip || 'unknown';

    const env = process.env.NODE_ENV;
    if (env === 'development' || env === 'production') {
      sendTelegramAlert(
        `🚨 <b>Admin Login Alert</b>\n\nUser <code>${username}</code> logged in as Editor.\nIP: <code>${ip}</code>\nTime: ${new Date().toISOString()}`
      );
    }

    return res.json({
      code: 200,
      message: 'Login successful',
      data: { token, role: 'viewer' }
    });
  }

  return res.status(401).json({ code: 401, message: 'Invalid credentials' });
}

/**
 * Logout handler
 */
function logout(req, res) {
  res.clearCookie('admin_session', {
    httpOnly: true,
    sameSite: 'none',
    secure: true,
    path: '/',
  });

  return res.json({ code: 200, message: 'Logged out' });
}

/**
 * Verify edit key → upgrade role to editor (new JWT)
 */
function verifyEditKey(req, res) {
  const { key } = req.body;

  const cookieHeader = req.headers.cookie || '';
  const cookies = Object.fromEntries(
    cookieHeader.split(';').map(c => c.trim().split('=').map(s => s.trim()))
  );

  const token = cookies['admin_session'] || req.headers['x-admin-token'];

  if (!token) {
    return res.status(401).json({ code: 401, message: 'Not logged in' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, config.admin.sessionSecret);
  } catch (err) {
    return res.status(401).json({ code: 401, message: 'Invalid token' });
  }

  const cleanKey = key?.trim();
  if (!cleanKey || !cleanKey.includes('.')) {
    return res.status(400).json({ code: 400, message: 'Invalid key format' });
  }

  try {
    const [base64Payload, providedHash] = cleanKey.split('.');

    const payloadStr = Buffer.from(base64Payload, 'base64').toString('utf-8');

    const expectedHash = crypto
      .createHmac('sha256', config.admin.sessionSecret)
      .update(payloadStr)
      .digest('hex');

    if (expectedHash !== providedHash) {
      return res.status(403).json({
        code: 403,
        message: 'Key signature verification failed'
      });
    }

    const sysInfo = JSON.parse(payloadStr);

    // 🔥 NEW TOKEN with editor role
    const newToken = jwt.sign(
      {
        username: decoded.username,
        role: 'editor',
        systemAuth: sysInfo
      },
      config.admin.sessionSecret,
      { expiresIn: '1d' }
    );

    res.cookie('admin_session', newToken, {
      httpOnly: true,
      sameSite: 'none',
      secure: true,
      path: '/',
    });

    const { sendTelegramAlert } = require('../utils/telegram');
    const ip = req.headers['cf-connecting-ip'] || req.ip || 'unknown';

    const env = process.env.NODE_ENV;
    if (env === 'development' || env === 'production') {
      sendTelegramAlert(
        `🔑 <b>Edit Access Granted</b>\n\nUser upgraded to Editor\nSystem: <code>${sysInfo.hostname}</code>\nUser: <code>${sysInfo.username}</code>\nIP: <code>${ip}</code>`
      );
    }

    return res.json({
      code: 200,
      message: 'Edit access verified successfully',
      data: { role: 'editor', system: sysInfo }
    });

  } catch (err) {
    return res.status(400).json({
      code: 400,
      message: 'Invalid edit key',
      error: err.message
    });
  }
}

module.exports = {
  adminAuthMiddleware,
  requireEditorRole,
  login,
  logout,
  verifyEditKey,
};