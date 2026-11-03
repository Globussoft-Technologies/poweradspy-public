'use strict';

/**
 * Client for the image-hashing service (SSCD Hash API).
 *
 *   POST /v1/hash-url   { image_url }            the service downloads the image
 *   POST /v1/hash       multipart field `image`  the image is uploaded
 *   GET  /health        { status, hash_version, hash_bits }
 *   Header X-API-Key is required on the two POST calls. One image per call.
 *
 * Every method resolves to an outcome object and never throws, so a hashing problem
 * can never break the caller:
 *   { ok: true,  outcome: 'ok', sscdHash, words, sha256 }
 *   { ok: false, outcome, status?, reason }
 * outcome:
 *   skip          this image cannot be hashed (too small / too large / unreadable): do not retry
 *   unauthorized  the API key is missing or wrong (401/403): retrying is pointless, fix the key
 *   rejected      the service refused the request (other 4xx): do not retry
 *   unavailable   network error, timeout, 429 or 5xx, still failing after the retries
 *   bad_response  a 200 whose body is not the expected hashes
 *   not_configured  no base URL or API key is set
 *
 * The API key is never logged. Settings: config.compliance.imageMatch (src/config/index.js).
 */

const fs = require('fs');
const FormData = require('form-data');
const { cleanHex, parseHash } = require('./matcher');

const OUTCOME = Object.freeze({
  OK: 'ok',
  SKIP: 'skip',
  UNAUTHORIZED: 'unauthorized',
  REJECTED: 'rejected',
  UNAVAILABLE: 'unavailable',
  BAD_RESPONSE: 'bad_response',
  NOT_CONFIGURED: 'not_configured',
});

const MAX_URL_LENGTH = 2083; // the service's own limit for image_url
const REASON_MAX = 200;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fail(outcome, reason, status) {
  const out = { ok: false, outcome, reason: String(reason).slice(0, REASON_MAX) };
  if (status !== undefined) out.status = status;
  return out;
}

/** A short, safe reason from a FastAPI 422 body ({ detail: string | [{ msg }] }). */
function detailOf(data) {
  const d = data && data.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d) && d.length && typeof d[0]?.msg === 'string') return d[0].msg;
  return '';
}

class ImageHashClient {
  /**
   * @param {Object} deps
   * @param {Object} deps.config  compliance.imageMatch: baseUrl, apiKey, timeoutMs, concurrency, retries,
   *                              retryDelayMs, maxFileBytes
   * @param {{request: Function}} [deps.http]  axios-like; defaults to axios
   * @param {Object} [deps.log]
   * @param {(ms:number)=>Promise} [deps.sleep]  injectable so tests do not wait
   */
  constructor({ config, http, log, sleep } = {}) {
    this.config = config || {};
    this.http = http || require('axios');
    this.log = log || { info() {}, warn() {}, error() {} };
    this.sleep = sleep || defaultSleep;
    this.base = typeof this.config.baseUrl === 'string' ? this.config.baseUrl.trim().replace(/\/+$/, '') : '';
    this.active = 0;
    this.waiting = [];
    this.limit = null; // the adaptive number of calls at once (only used when config.maxConcurrency > config.concurrency)
    this.okStreak = 0;
  }

  isConfigured() {
    return Boolean(this.base && this.config.apiKey);
  }

  /** Hash an image the service downloads itself. The URL must be public http(s). */
  async hashUrl(imageUrl) {
    if (!this.isConfigured()) return fail(OUTCOME.NOT_CONFIGURED, 'image hashing service is not configured');
    if (typeof imageUrl !== 'string' || !imageUrl.trim() || imageUrl.length > MAX_URL_LENGTH) {
      return fail(OUTCOME.SKIP, 'image_url is empty or longer than 2083 characters');
    }
    const url = imageUrl.trim();
    return this.send(() => ({
      method: 'POST',
      url: `${this.base}/v1/hash-url`,
      headers: { 'X-API-Key': this.config.apiKey, 'Content-Type': 'application/json' },
      data: { image_url: url },
    }));
  }

  /** Hash a local image file (for example the temp file an insertion has already downloaded). */
  async hashFile(filePath) {
    if (!this.isConfigured()) return fail(OUTCOME.NOT_CONFIGURED, 'image hashing service is not configured');
    if (typeof filePath !== 'string' || !filePath) return fail(OUTCOME.SKIP, 'no file path');
    let size;
    try {
      size = (await fs.promises.stat(filePath)).size;
    } catch {
      return fail(OUTCOME.SKIP, 'image file not found');
    }
    const max = Number.isInteger(this.config.maxFileBytes) ? this.config.maxFileBytes : 50 * 1024 * 1024;
    if (size > max) return fail(OUTCOME.SKIP, 'image file is larger than the service limit');
    if (size === 0) return fail(OUTCOME.SKIP, 'image file is empty');

    return this.send(() => {
      // A stream can be read once, so each attempt builds its own form.
      const form = new FormData();
      form.append('image', fs.createReadStream(filePath));
      return {
        method: 'POST',
        url: `${this.base}/v1/hash`,
        headers: { 'X-API-Key': this.config.apiKey, ...form.getHeaders() },
        data: form,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      };
    });
  }

  /** The service's state: { ok, ready, hashVersion, hashBits }. Needs no key. */
  async health() {
    if (!this.base) return { ok: false, ready: false, hashVersion: null, hashBits: null };
    try {
      const res = await this.http.request({
        method: 'GET',
        url: `${this.base}/health`,
        timeout: this.timeout(),
        validateStatus: () => true,
      });
      const d = res.data || {};
      if (res.status !== 200) return { ok: false, ready: false, hashVersion: null, hashBits: null };
      return {
        ok: true,
        ready: d.status === 'ready',
        hashVersion: typeof d.hash_version === 'string' ? d.hash_version : null,
        hashBits: Number.isInteger(d.hash_bits) ? d.hash_bits : null,
      };
    } catch {
      return { ok: false, ready: false, hashVersion: null, hashBits: null };
    }
  }

  timeout() {
    return Number.isInteger(this.config.timeoutMs) && this.config.timeoutMs > 0 ? this.config.timeoutMs : 30000;
  }

  // ── internals ────────────────────────────────────────────────────────

  /** One request with the concurrency cap and the retries; never throws. */
  async send(build) {
    const retries = Number.isInteger(this.config.retries) && this.config.retries >= 0 ? this.config.retries : 2;
    const baseDelay = Number.isInteger(this.config.retryDelayMs) && this.config.retryDelayMs >= 0 ? this.config.retryDelayMs : 500;

    await this.acquire();
    try {
      let last = fail(OUTCOME.UNAVAILABLE, 'no attempt was made');
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        last = await this.attempt(build);
        if (last.outcome !== OUTCOME.UNAVAILABLE) { this.adapt(last); return last; }
        if (attempt < retries) await this.sleep(baseDelay * 2 ** attempt);
      }
      this.adapt(last);
      this.log.warn('image hashing service unavailable', { status: last.status ?? null, reason: last.reason });
      return last;
    } catch (err) {
      return fail(OUTCOME.UNAVAILABLE, err?.message || 'unexpected error');
    } finally {
      this.release();
    }
  }

  async attempt(build) {
    let res;
    try {
      res = await this.http.request({
        params: { embedding: false },
        timeout: this.timeout(),
        validateStatus: () => true,
        ...build(),
      });
    } catch (err) {
      return fail(OUTCOME.UNAVAILABLE, err?.code || err?.message || 'request failed');
    }
    return this.classify(res);
  }

  classify(res) {
    const status = res?.status;
    if (status === 200) {
      const sscdHash = cleanHex(res.data?.sscd_hash);
      const sha256 = cleanHex(res.data?.sha256);
      const words = parseHash(sscdHash);
      if (!sscdHash || !sha256 || !words) return fail(OUTCOME.BAD_RESPONSE, 'response has no valid sscd_hash and sha256', status);
      return { ok: true, outcome: OUTCOME.OK, sscdHash, words, sha256 };
    }
    if (status === 401 || status === 403) return fail(OUTCOME.UNAUTHORIZED, 'the API key was refused', status);
    if (status === 413) return fail(OUTCOME.SKIP, 'image is larger than the service limit', status);
    if (status === 422) return fail(OUTCOME.SKIP, detailOf(res.data) || 'image cannot be processed', status);
    if (status === 429 || (Number.isInteger(status) && status >= 500)) return fail(OUTCOME.UNAVAILABLE, `service returned ${status}`, status);
    return fail(OUTCOME.REJECTED, `service returned ${status}`, status);
  }

  /** The configured number of calls at once. */
  baseCap() {
    return Number.isInteger(this.config.concurrency) && this.config.concurrency > 0 ? this.config.concurrency : 4;
  }

  /** The most calls at once when adapting; equal to baseCap() when adapting is off. */
  maxCap() {
    const max = this.config.maxConcurrency;
    return Number.isInteger(max) && max > this.baseCap() ? max : this.baseCap();
  }

  /** The number of calls allowed at once right now. */
  cap() {
    if (this.maxCap() === this.baseCap()) return this.baseCap();
    return Math.min(Math.max(this.limit ?? this.baseCap(), 1), this.maxCap());
  }

  /**
   * Adapt to what the service can take, without knowing its limit: one more call at once after 20 answers in a row, half as many
   * after it was overloaded (429, 5xx, a timeout). Only when maxConcurrency is set above concurrency.
   */
  adapt(result) {
    if (this.maxCap() === this.baseCap()) return;
    const before = this.cap();
    if (result.ok) {
      this.okStreak += 1;
      if (this.okStreak >= 20) {
        this.okStreak = 0;
        this.limit = Math.min(before + 1, this.maxCap());
      }
    } else if (result.outcome === OUTCOME.UNAVAILABLE) {
      this.okStreak = 0;
      this.limit = Math.max(Math.floor(before / 2), 1);
    } else {
      return;
    }
    if (this.cap() !== before) {
      this.log.info('image hashing: calls at once changed', { from: before, to: this.cap() });
      while (this.waiting.length && this.active < this.cap()) { this.active += 1; this.waiting.shift()(); }
    }
  }

  acquire() {
    const cap = this.cap();
    if (this.active < cap) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiting.push(resolve));
  }

  release() {
    if (this.active > this.cap()) { this.active -= 1; return; } // the number was lowered: this slot is not passed on
    const next = this.waiting.shift();
    if (next) next(); // the slot passes straight to the next caller
    else this.active -= 1;
  }
}

module.exports = { ImageHashClient, OUTCOME };
