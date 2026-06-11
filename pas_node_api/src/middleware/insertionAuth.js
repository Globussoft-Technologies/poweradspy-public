'use strict';

/**
 * Insertion authentication middleware.
 *
 * Faithful port of PHP App\Http\Middleware\InsertionAuthentication.
 *
 * Auth rules (in order):
 *   1. If the signature header (default `x-signature`) is present:
 *        compute HMAC-SHA256 over the RAW request body using the shared secret
 *        and compare case-insensitively with the header value.
 *        match → allow, mismatch → 401.
 *   2. Else if body.platform === allowPlatformBypass (PHP: platform == '12'):
 *        allow without a signature.
 *   3. Else → 401 unauthorized.
 *
 * Secret + header + bypass value all come from config.insertion (config.json,
 * env fallback). Nothing here is network-specific — it guards ALL insertion routes.
 */

const crypto = require('crypto');
const config = require('../config');
const logger = require('../logger');

const log = logger.createChild('insertion-auth');

const UNAUTHORIZED = {
  code: 401,
  status: 'rejected',
  message: 'Unauthorized — no valid x-signature header and platform bypass not allowed.',
  hint: 'Send an x-signature header = HMAC-SHA256(rawBody, INSERTION_SECRET_KEY) in hex, or set body.platform to the configured bypass value.',
};

/**
 * Constant-time-ish compare of two hex signatures, case-insensitive.
 * Mirrors PHP strcasecmp(...) == 0 but uses timingSafeEqual when lengths match.
 */
function signaturesMatch(expectedHex, providedHex) {
  if (typeof providedHex !== 'string' || providedHex.length === 0) return false;
  const a = Buffer.from(expectedHex.toLowerCase());
  const b = Buffer.from(providedHex.toLowerCase());
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function insertionAuth(req, res, next) {
  try {
    const { signatureHeader, secretKey, allowPlatformBypass } = config.insertion;
    const signature = req.headers[signatureHeader];

    if (signature) {
      if (!secretKey) {
        log.error('Insertion secret key not configured (config.insertion.secretKey / INSERTION_SECRET_KEY)');
        return res.status(401).json({
          code: 401, status: 'server_error',
          message: 'Insertion secret key is not configured on the server, so the signature cannot be verified.',
          hint: 'This is a server-side configuration issue, not your request. Contact the API owner.',
        });
      }

      // HMAC the exact raw bytes; fall back to a UTF-8 re-encode of the parsed
      // body only if the raw buffer was not captured (e.g. body parsed elsewhere).
      const rawPayload = req.rawBody || Buffer.from(JSON.stringify(req.body || {}), 'utf8');
      const expected = crypto.createHmac('sha256', secretKey).update(rawPayload).digest('hex');

      if (signaturesMatch(expected, signature)) return next();

      log.warn('Invalid insertion signature', { requestId: req.id });
      return res.status(401).json({
        code: 401, status: 'rejected',
        message: 'Invalid x-signature — it does not match an HMAC of the request body.',
        hint: 'Compute the signature as HMAC-SHA256 of the EXACT raw JSON body (same bytes you send) using the shared secret, hex-encoded. A changed body or wrong secret will fail.',
      });
    }

    // No signature → allow only the configured platform bypass.
    const platform = req.body?.platform;
    if (allowPlatformBypass !== null && platform !== undefined &&
        String(platform) === String(allowPlatformBypass)) {
      return next();
    }

    log.warn('Insertion request without valid signature or platform bypass', { requestId: req.id });
    return res.status(401).json(UNAUTHORIZED);
  } catch (err) {
    log.error('Error in insertion auth middleware', { error: err.message });
    return res.status(401).json({ code: 401, error: 'Invalid token' });
  }
}

module.exports = { insertionAuth };
