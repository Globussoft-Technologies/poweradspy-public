'use strict';

/**
 * Unsubscribe / resubscribe HTTP handlers for the email service.
 * Email is read from the body (`{ email }`) or query (`?email=`) — the latter so
 * the existing email "Unsubscribe" link (which carries `?email=`) can hit it
 * directly if the frontend forwards the query.
 */

const svc = require('../services/unsubscribeService');
const logger = require('../../../logger');

const log = logger.createChild('email-unsubscribe-ctrl');

const pickEmail = (req) => (req.body && req.body.email) || (req.query && req.query.email) || null;
const pickToken = (req) => (req.body && req.body.token) || (req.query && req.query.token) || null;
const pickMailType = (req) => (req.body && req.body.mail_type) || (req.query && req.query.mail_type) || null;

// Reject unless the signed token matches — so the page only works from a real
// mail link, never a guessed/direct URL. (No-op when no secret is configured.)
function rejectIfBadToken(req, res) {
  const v = svc.verifyEmailToken(pickEmail(req), pickToken(req));
  if (v.enforced && !v.ok) {
    res.status(403).json({ success: false, message: 'Invalid or expired unsubscribe link' });
    return true;
  }
  return false;
}

async function unsubscribe(req, res) {
  const email = pickEmail(req);
  if (!email) return res.status(400).json({ success: false, message: 'email is required' });
  if (rejectIfBadToken(req, res)) return;
  try {
    const result = await svc.unsubscribe(email, pickMailType(req));
    if (!result.success) {
      return res.status(502).json({ success: false, message: result.error || 'Unsubscribe failed', ...result });
    }
    return res.status(200).json({ success: true, message: 'You have been unsubscribed', ...result });
  } catch (e) {
    log.error('unsubscribe error', { error: e.message });
    return res.status(500).json({ success: false, message: 'Internal error' });
  }
}

async function resubscribe(req, res) {
  const email = pickEmail(req);
  if (!email) return res.status(400).json({ success: false, message: 'email is required' });
  if (rejectIfBadToken(req, res)) return;
  try {
    const result = await svc.resubscribe(email);
    if (!result.success) {
      return res.status(502).json({ success: false, message: result.error || 'Resubscribe failed', ...result });
    }
    return res.status(200).json({ success: true, message: 'You have been resubscribed', ...result });
  } catch (e) {
    log.error('resubscribe error', { error: e.message });
    return res.status(500).json({ success: false, message: 'Internal error' });
  }
}

module.exports = { unsubscribe, resubscribe };
