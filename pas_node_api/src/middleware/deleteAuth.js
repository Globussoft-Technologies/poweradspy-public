'use strict';

/**
 * deleteAuth — guards the secure delete endpoint with a shared token.
 *
 * Port of the PHP API_DELETE_TOKEN check, hardened: the token is read from the
 * `x-delete-token` header (preferred) or body.token (PHP-compatible) and compared
 * with config.insertion.deleteToken using a constant-time comparison.
 */

const crypto = require('crypto');
const config = require('../config');
const logger = require('../logger');

const log = logger.createChild('delete-auth');

function tokensMatch(expected, provided) {
  if (typeof provided !== 'string' || provided.length === 0) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(a, b); } catch { return false; }
}

function deleteAuth(req, res, next) {
  const expected = config.insertion.deleteToken;
  if (!expected) {
    log.error('Delete token not configured (config.insertion.deleteToken / API_DELETE_TOKEN)');
    return res.status(401).json({
      code: 401, status: 'server_error',
      message: 'Delete token is not configured on the server.',
      hint: 'This is a server-side configuration issue. Contact the API owner.',
    });
  }

  const provided = req.headers['x-delete-token'] || req.body?.token;
  if (tokensMatch(expected, provided)) return next();

  log.warn('Delete request with invalid/missing token', { requestId: req.id });
  return res.status(401).json({
    code: 401, status: 'rejected',
    message: 'Invalid or missing delete token.',
    hint: 'Send the correct token via the `x-delete-token` header (or body.token).',
  });
}

module.exports = { deleteAuth };
