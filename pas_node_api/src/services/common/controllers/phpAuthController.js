'use strict';

/**
 * Authenticate a PHP-issued JWT — Node port of adsDataController@authunticatePhpApi
 * (PHP route: GET /authunticate-php-api).
 *
 * GET /api/v1/common/authunticate-php-api
 *
 * Verifies the Bearer token in the Authorization header against the shared HS512
 * JWT secret. PHP uses config('services.jwt.key') (default "eyJhbGciOiJ%pas%IUzUxMiJ9"),
 * which is the exact same value as the Node config.jwt.secret in config.json — so
 * tokens minted by either stack validate here. Used by other services to check a
 * token without a full auth context (the route itself is unauthenticated).
 *
 * Faithful to PHP:
 *   - Missing / non-Bearer header -> body { code: 403, message: 'Bearer token required' }
 *   - Valid (exp in the future)   -> body { code: 200, message: 'valid token' }
 *   - exp not in the future       -> body { code: 400, message: 'expired token' }
 *   - Expired (verify throws)     -> body { code: 400, message: 'Token expired' }
 *   - Bad signature               -> body { code: 400, message: 'Invalid token signature' }
 *   - Malformed / other JWT error -> body { code: 400, message: 'Malformed token' }
 *   - Anything else               -> body { code: 400, message: 'Invalid token' }
 *   - Always responds HTTP 200 (Laravel response()->json() default).
 */

const jwt = require('jsonwebtoken');
const config = require('../../../config');
const logger = require('../../../logger');

const log = logger.createChild('authunticate-php-api');

async function authunticatePhpApi(req, res) {
  try {
    const authHeader = req.headers.authorization;
    const matches = authHeader ? authHeader.match(/Bearer\s(\S+)/) : null;

    if (!authHeader || !matches) {
      return res.json({ code: 403, message: 'Bearer token required' });
    }

    const token = matches[1];
    const secKey = config.jwt.secret;

    const decoded = jwt.verify(token, secKey, { algorithms: [config.jwt.algorithm || 'HS512'] });

    // PHP keeps this explicit exp check even though JWT::decode already throws on
    // expiry. Mirror it: future exp -> valid, otherwise -> "expired token".
    const now = Math.floor(Date.now() / 1000);
    if (decoded.exp > now) {
      return res.json({ code: 200, message: 'valid token' });
    }
    return res.json({ code: 400, message: 'expired token' });
  } catch (e) {
    // Map jsonwebtoken errors to the same bodies PHP returns per exception type:
    //   ExpiredException         -> 'Token expired'
    //   SignatureInvalidException -> 'Invalid token signature'
    //   UnexpectedValueException -> 'Malformed token'
    //   (general)                -> 'Invalid token'
    if (e.name === 'TokenExpiredError') {
      return res.json({ code: 400, message: 'Token expired' });
    }
    if (e.name === 'JsonWebTokenError') {
      if (e.message === 'invalid signature') {
        return res.json({ code: 400, message: 'Invalid token signature' });
      }
      return res.json({ code: 400, message: 'Malformed token' });
    }
    log.error('Error in authunticatePhpApi', { error: e.message });
    return res.json({ code: 400, message: 'Invalid token' });
  }
}

module.exports = { authunticatePhpApi };
