'use strict';

/**
 * httpClient — shared HTTP wrapper for insertion-side external API calls.
 *
 * COMMON helper: used by every network (Facebook, Instagram, …). Faithful port
 * of PHP helper::postApiCall — returns a normalized { statusCode, data } shape
 * for POST JSON, and the parsed body for GET, without throwing on HTTP errors
 * (errors come back as a structured object, mirroring the PHP behaviour).
 *
 * Keep this dependency-light and side-effect free so it is trivial to unit test.
 */

const axios = require('axios');
const https = require('https');

// Reused agent so insertion traffic keeps connections warm (TLS verify off mirrors PHP `verify:false`).
const insecureAgent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });

/**
 * POST JSON to an external API.
 * Mirrors PHP postApiCall('post', url, data): on 200 returns
 * { statusCode:200, data }, otherwise a failure object — never throws.
 *
 * @param {string} url
 * @param {Object} data            - JSON body
 * @param {Object} [opts]
 * @param {number} [opts.timeoutMs] - request timeout (default 30000)
 * @param {Object} [opts.headers]   - extra headers
 * @param {boolean}[opts.verifyTls] - default true; false disables TLS verification
 * @returns {Promise<{statusCode:number, data:any} | {status:'failed', code:number, message:string}>}
 */
async function postJson(url, data, opts = {}) {
  try {
    const res = await axios.post(url, data, {
      timeout: opts.timeoutMs || 30000,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(opts.headers || {}) },
      httpsAgent: opts.verifyTls === false ? insecureAgent : undefined,
      validateStatus: () => true, // we inspect the status ourselves (like PHP)
    });

    if (res.status === 200) {
      return { statusCode: 200, data: res.data };
    }
    return {
      status: 'failed',
      code: 500,
      message: 'The Server is temporarily unable to service your request due to maintenance downtime. Please try later',
    };
  } catch (err) {
    return { code: 400, message: err.message };
  }
}

/**
 * GET JSON from an external API. Mirrors PHP postApiCall('get', ...).
 * Returns the parsed body, or { code:400, message } on error.
 */
async function getJson(url, opts = {}) {
  try {
    const res = await axios.get(url, {
      timeout: opts.timeoutMs || 30000,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      httpsAgent: opts.verifyTls === false ? insecureAgent : undefined,
    });
    return res.data;
  } catch (err) {
    return { code: 400, message: err.message };
  }
}

/**
 * Fire-and-forget POST (mirrors PHP Guzzle postAsync with a tiny timeout used
 * for the ADGPT call). Resolves immediately; failures are swallowed/logged by
 * the caller. Returns the in-flight promise so callers may optionally await.
 */
function postFireAndForget(url, data, opts = {}) {
  return axios
    .post(url, data, {
      timeout: opts.timeoutMs || 100,
      headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
      httpsAgent: opts.verifyTls === false ? insecureAgent : undefined,
      validateStatus: () => true,
    })
    .catch(() => null);
}

module.exports = { postJson, getJson, postFireAndForget };
