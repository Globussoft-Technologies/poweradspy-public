'use strict';

// This file holds the pieces of image matching that run inside a request: the 256-bit hash arithmetic (first part), the
// decision about one image against the banned images (second part, decide()), and the exact-copy check of a file that
// ingestion has just downloaded (third part, guardFile()).

// ═══ The hash: parse, print and compare ═══
/**
 * The perceptual hash from the image-hashing service (sscd-simhash-v1): 256 bits,
 * returned as 64 lowercase hex characters. Kept in memory as 8 unsigned 32-bit
 * words so two hashes are compared with a few XOR and bit-count operations. BigInt
 * would be slower and allocate on every comparison, which matters because a new
 * image is compared against every banned image.
 *
 * Also used for the exact-copy hash: sha256 is 64 hex characters too.
 */

const HEX_256 = /^[0-9a-f]{64}$/;
const WORDS = 8;
const BITS = WORDS * 32;

/** Lowercase, trimmed 64-hex string, or '' when the value is not one. */
function cleanHex(value) {
  if (typeof value !== 'string') return '';
  const s = value.trim().toLowerCase();
  return HEX_256.test(s) ? s : '';
}

/** 64 hex characters -> Uint32Array(8), or null when the value is not a valid hash. */
function parseHash(value) {
  const s = cleanHex(value);
  if (!s) return null;
  const words = new Uint32Array(WORDS);
  for (let i = 0; i < WORDS; i += 1) words[i] = parseInt(s.slice(i * 8, i * 8 + 8), 16);
  return words;
}

/** Uint32Array(8) -> 64 lowercase hex characters, or '' when it is not 8 words. */
function toHex(words) {
  if (!words || words.length !== WORDS) return '';
  let out = '';
  for (let i = 0; i < WORDS; i += 1) out += (words[i] >>> 0).toString(16).padStart(8, '0');
  return out;
}

function popcount32(v) {
  let x = v >>> 0;
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  x = (x + (x >>> 4)) & 0x0f0f0f0f;
  return Math.imul(x, 0x01010101) >>> 24;
}

/** Number of bits that differ between two parsed hashes (0..256); Infinity if either is not 8 words. */
function hammingDistance(a, b) {
  if (!a || !b || a.length !== WORDS || b.length !== WORDS) return Infinity;
  let d = 0;
  for (let i = 0; i < WORDS; i += 1) d += popcount32((a[i] ^ b[i]) >>> 0);
  return d;
}

// ═══ The decision: reject, review or allow one image ═══
/**
 * Decides what to do with one image, given its hashes and the banned images of a network
 * (the list B1 keeps in memory: blocklist.getImageHashes(network)). Pure: no I/O, no
 * database, no network call.
 *
 *   decide(banned, image, options) ->
 *     { action: 'reject', kind: 'sha256', distance: null, entry }   an exact copy of a banned image
 *     { action: 'reject', kind: 'phash',  distance, entry }         a near copy, within rejectDistance
 *     { action: 'review', kind: 'phash',  distance, entry }         close, but not enough to reject: a person decides
 *     { action: 'allow',  kind: null,     distance, entry: null }   no banned image is close
 *     { action: 'unavailable' }                                     the list cannot be trusted: the caller applies its fail mode
 *
 *   banned   { available, hashes: [{ id, sha256, phash: ?Uint32Array, algo }] }
 *   image    { sha256, words: ?Uint32Array }   words is null when only the exact hash is known
 *   options  { hashVersion, perceptual: { enabled, rejectDistance, reviewDistance } }
 *
 * The perceptual comparison is off unless options.perceptual.enabled is true: only the exact
 * copy (sha256) is checked. Distances are counted in bits (0..256). A banned image made with
 * another hash version than options.hashVersion is never compared perceptually, because
 * hashes of different versions are not comparable; its sha256 still counts.
 *
 * The lookup structures are built once per list (the list is replaced as a whole at each
 * refresh, so the array identity changes exactly when its content does) and reused.
 */

const indexes = new WeakMap(); // hashes array -> { bySha: Map, near: Map(version -> entries) }

function indexOf(hashes) {
  let index = indexes.get(hashes);
  if (index) return index;
  const bySha = new Map();
  const near = new Map();
  for (const h of hashes) {
    if (!bySha.has(h.sha256)) bySha.set(h.sha256, h);
    if (h.phash && h.algo) {
      let list = near.get(h.algo);
      if (!list) {
        list = [];
        near.set(h.algo, list);
      }
      list.push(h);
    }
  }
  index = { bySha, near };
  indexes.set(hashes, index);
  return index;
}

function int(value, fallback) {
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

function decide(banned, image, options = {}) {
  if (!banned || banned.available !== true || !Array.isArray(banned.hashes)) return { action: 'unavailable' };
  const hashes = banned.hashes;
  if (hashes.length === 0) return { action: 'allow', kind: null, distance: null, entry: null };

  const index = indexOf(hashes);

  const exact = image && typeof image.sha256 === 'string' ? index.bySha.get(image.sha256) : undefined;
  if (exact) return { action: 'reject', kind: 'sha256', distance: null, entry: exact };

  const perceptual = options.perceptual || {};
  const version = typeof options.hashVersion === 'string' ? options.hashVersion.toLowerCase() : '';
  const words = image && image.words;
  if (perceptual.enabled !== true || !words || !version) return { action: 'allow', kind: null, distance: null, entry: null };

  const candidates = index.near.get(version);
  if (!candidates) return { action: 'allow', kind: null, distance: null, entry: null };

  const rejectDistance = int(perceptual.rejectDistance, 0);
  const reviewDistance = Math.max(int(perceptual.reviewDistance, 0), rejectDistance);

  let best = null;
  let bestDistance = Infinity;
  for (const entry of candidates) {
    const d = hammingDistance(words, entry.phash);
    if (d < bestDistance) {
      best = entry;
      bestDistance = d;
      if (d <= rejectDistance) break; // already a reject; a closer one would not change the action
    }
  }

  if (best && bestDistance <= rejectDistance) return { action: 'reject', kind: 'phash', distance: bestDistance, entry: best };
  if (best && bestDistance <= reviewDistance) return { action: 'review', kind: 'phash', distance: bestDistance, entry: best };
  return { action: 'allow', kind: null, distance: Number.isFinite(bestDistance) ? bestDistance : null, entry: null };
}

// ═══ The check at ingestion: is this downloaded file a banned image? ═══
/**
 * Called by media.fetchPrimaryMedia() (src/insertion/helpers/mediaUpload.js, shared by the Facebook, Instagram, ChatGPT Ads and
 * AdMob pipelines) right after the primary image (or a video's thumbnail) was downloaded to a temp file and before anything is saved.
 * It is the exact-copy part of B2: the SHA-256 of the file is computed here (a local read, no call to the hashing service) and looked
 * up in the banned images already in memory. Near copies need the service (about 0.5 to 1.3 s per image, and about 6 images per second
 * in total), so they are not decided here: the sweep (worker.js) checks them in the background.
 *
 *   guardFile(network, filePath, { imageUrl?, source? }) -> null (go on)  or  { entry, rejection }
 *
 * - Switched on by compliance.imageMatch.enabled (off by default: then it does no work at all, not even reading the file).
 * - Nothing banned for the network yet: the file is not read.
 * - The banned images could not be loaded (they load separately from the name list): the ad is NOT refused for that reason
 *   (fail open, logged now and then); the name check of B1 and its fail mode are unaffected.
 * - It never throws: any error means "go on" and is logged.
 * - A refusal is logged in copyright_blocked_attempts (match type sha256) through the same batched writer as B1.
 */
const crypto = require('crypto');
const fs = require('fs');

/** SHA-256 of a file as 64 lowercase hex characters, read as a stream (a large file is never held in memory). */
function sha256OfFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    fs.createReadStream(filePath)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')));
  });
}

const WARN_EVERY_MS = 60 * 1000;

/** @param {Object} [deps] injectable for tests: config, blocklist, responses, log, now */
function createFileGuard(deps = {}) {
  const get = (name, load) => (deps[name] !== undefined ? deps[name] : load());
  const warnedAt = new Map();
  const warn = (key, message, extra) => {
    const now = (deps.now ? deps.now() : Date.now());
    if (now - (warnedAt.get(key) || 0) < WARN_EVERY_MS) return;
    warnedAt.set(key, now);
    try { get('log', () => require('../../logger').createChild('image-guard')).warn(message, extra); } catch { /* logging must not throw */ }
  };

  return async function guardFile(network, filePath, { imageUrl = null, source = null } = {}) {
    try {
      const config = get('config', () => require('../../config'));
      const settings = config.compliance && config.compliance.imageMatch;
      if (!settings || settings.enabled !== true) return null;
      if (typeof filePath !== 'string' || !filePath) return null;

      const blocklist = get('blocklist', () => require('../blocklist/service'));
      const banned = blocklist.getImageHashes(network);
      if (!banned.available) {
        warn(`unavailable:${network}`, 'the banned images are not loaded; the image check is skipped (the name check is not affected)', { network, status: banned.status });
        return null;
      }
      if (banned.hashes.length === 0) return null;

      const sha256 = await sha256OfFile(filePath);
      const verdict = decide(banned, { sha256 }, {}); // no perceptual options: an exact copy only
      if (verdict.action !== 'reject') return null;

      blocklist.recordAttempt({ network, imageUrl, blocklistId: verdict.entry.id, matchType: 'sha256', source: source || `ingestion:${network}` });
      const { rejected } = get('responses', () => require('../../insertion/helpers/responses'));
      const response = config.compliance.blocklist.response;
      return {
        entry: verdict.entry,
        rejection: rejected(response.code, response.message, { hint: 'This content cannot be accepted. Do not resend it.' }),
      };
    } catch (err) {
      warn('error', 'the image check failed; the ad is not refused for that reason', { network, error: err.message });
      return null;
    }
  };
}

const guardFile = createFileGuard();

module.exports = {
  // the hash
  HEX_256, WORDS, BITS, cleanHex, parseHash, toHex, popcount32, hammingDistance,
  // the decision
  decide,
  // the check at ingestion
  sha256OfFile, createFileGuard, guardFile,
};
