'use strict';

/**
 * Payload crypto for the user-chk / ads-data endpoints (Instagram + Facebook).
 *
 * Faithful port of the PHP xorEncryptDecrypt helper + the decode block shared by
 * UserController::instagram_user_data and Userv2Controller::fb_user_data /
 * checkFbUser: a symmetric XOR cipher (key repeated cyclically) applied to the
 * base64-decoded bytes, the result being a UTF-8 JSON string.
 *
 *   PHP:  json_decode( xorEncryptDecrypt( base64_decode($data), $key ), true )
 */

/**
 * XOR each byte of `bytes` with the cyclically-repeated `key`.
 * @param {Buffer} bytes - raw bytes (already base64-decoded)
 * @param {string} key   - shared secret
 * @returns {Buffer}
 */
function xorEncryptDecrypt(bytes, key) {
  const keyBuf = Buffer.from(key, 'binary');
  const out = Buffer.allocUnsafe(bytes.length);
  if (keyBuf.length === 0) { bytes.copy(out); return out; }
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i] ^ keyBuf[i % keyBuf.length];
  }
  return out;
}

/**
 * Decrypt a base64-encoded, XOR-encrypted JSON payload into an object.
 * Returns null when the result is not valid JSON (mirrors PHP json_decode
 * returning null — the caller then treats it as a missing id).
 *
 * @param {string} base64 - the base64 string from body.data
 * @param {string} key    - config.insertion.decryptionKey
 * @returns {object|null}
 */
function decryptPayload(base64, key) {
  const decoded = Buffer.from(String(base64 || ''), 'base64');
  const json = xorEncryptDecrypt(decoded, key).toString('utf8');
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/**
 * Shared decode step used by all three endpoints:
 *   platform set && platform != 3 && no `data`  → use the body verbatim
 *   otherwise                                   → XOR-decrypt body.data
 *
 * @param {object} postData - req.body
 * @param {string} key      - config.insertion.decryptionKey
 * @returns {object} decoded payload (never null — {} on undecodable data)
 */
function decodeUserPayload(postData, key) {
  // PHP isset() is false for null too, hence `!= null` (matches null AND undefined).
  if (postData.platform != null && Number(postData.platform) !== 3 && postData.data == null) {
    return { ...postData };
  }
  return decryptPayload(postData.data, key) || {};
}

module.exports = { xorEncryptDecrypt, decryptPayload, decodeUserPayload };
