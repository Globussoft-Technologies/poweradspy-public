'use strict';

/**
 * nasClient — shared NAS media-upload helper.
 *
 * COMMON helper used by ALL networks (Facebook, Instagram, …). Faithful port of
 * PHP helper::StoreInNAS2. The only intentional change: the `network` is a
 * PARAMETER (PHP hard-coded 'facebook') so every network reuses this one helper.
 *
 * Behaviour:
 *   - ALL types (image AND video) → POST to {mediaUrl}/{bucket}/upload (Bearer token;
 *     multipart: key, file). The key is sent WITHOUT an extension and the file WITH its
 *     real extension (from the downloaded file's Content-Type); the NAS validates and
 *     appends the extension — we never hard-code mp4/jpg. VIDEO subfolder = "adVideo/"
 *     (the old dedicated nas-video-api endpoint is no longer used).
 *   - Returns the stored path the NAS returns, or '/DefaultImage.jpg' on any failure
 *     (never throws — mirrors PHP).
 *
 * Settings come from config.insertion.nas (config.json → env). Nothing here is
 * network-specific except the `network` argument.
 */

const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');
const https = require('https');
const config = require('../../config');
const logger = require('../../logger');
const { enqueueFailedUpload } = require('./nasUploadQueue');
const sftpPool = require('./nasSftpPool');

const log = logger.createChild('nas-client');

// The NAS media host (media.globussoft.com) is behind Cloudflare and intermittently
// returns transient 5xx/429 (origin overloaded). We try a couple of QUICK in-request
// attempts (short timeout so the API never waits long); if they all fail we DON'T block
// — we hand the bytes to the durable retry queue and return the deterministic predicted
// path, so the ad references the eventual file and a background cron finishes the upload.
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const UPLOAD_MAX_ATTEMPTS = 2;     // in-request attempts before deferring to the queue
const UPLOAD_RETRY_BASE_MS = 300;  // backoff between in-request attempts
// Short per-attempt timeout so a slow/down NAS can't stall the insertion response.
// (Downloads still use the full nas.timeoutMs.) Override via config.insertion.nas.uploadTimeoutMs.
const UPLOAD_TIMEOUT_MS = config.insertion.nas.uploadTimeoutMs || 10000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_IMAGE = '/DefaultImage.jpg';

// Per-network NAS key prefix — from the Media Upload API doc (Network → NAS Folder).
// Falls back to the network slug if not listed. The multipart `network` field still
// carries the full slug (e.g. 'facebook') — only the storage key prefix differs.
const NAS_KEY_PREFIX = {
  facebook: 'fb',
  instagram: 'insta',
  pinterest: 'pint',
  reddit: 'reddit',
  google: 'gt',
  gdn: 'gdn',
  native: 'native',
  tiktok: 'tiktok',
  youtube: 'yt',
  linkedin: 'linkedin',
  quora: 'quora',
  bing: 'bing',
};

// PHP $typeMap: upload type → NAS subfolder.
const TYPE_SUBFOLDER = {
  IMAGE: 'adImage/',
  VIDEO: 'adVideo/',
  THUMBNAIL: 'thumbnail/',
  POSTOWNER: 'postowner/',
  OTHERMULTIMEDIA: 'otherMultiMedia/',
  LANDERS: 'landers/',
  WHITEHAT: 'whiteHatAd/',
  BLACKHAT: 'blackHatAd/',
};

function nasAgent() {
  // PHP uses verify:false. Honour config.insertion.nas.verifyTls.
  return config.insertion.nas.verifyTls
    ? undefined
    : new https.Agent({ keepAlive: true, rejectUnauthorized: false });
}

/** YYYYMM for the upload key, in UTC (matches PHP date('Ym') intent for grouping). */
function yearMonth() {
  const d = new Date();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${d.getUTCFullYear()}${m}`;
}

/** Join a base URL and a path, avoiding double/missing slashes. */
function joinUrl(base, pathPart) {
  return `${String(base).replace(/\/+$/, '')}/${String(pathPart).replace(/^\/+/, '')}`;
}

/** Bucket: explicit config override, else env-derived (production → pas-prod, else pas-dev). */
function resolveBucket() {
  if (config.insertion.nas.bucket) return config.insertion.nas.bucket;
  return config.env === 'production' ? 'pas-prod' : 'pas-dev';
}

/**
 * Upload a local file to NAS.
 *
 * @param {string} type        - IMAGE | VIDEO | THUMBNAIL | POSTOWNER | OTHERMULTIMEDIA | LANDERS | WHITEHAT | BLACKHAT
 * @param {string} filePath    - absolute path to the local file to upload
 * @param {string|number} adId - the ad id (NAS groups by adId)
 * @param {string} network     - network slug, e.g. 'facebook' (replaces PHP hard-coded value)
 * @param {string} [keyBaseName] - desired stored filename WITHOUT extension (id-based, e.g. the
 *                                 facebook_ad id or `postowner_<id>_0_<ts>`). Defaults to the temp
 *                                 file's name. The NAS key uses `<keyBaseName>.jpg`.
 * @returns {Promise<string>}   - stored path, or '/DefaultImage.jpg' on failure
 */
async function storeInNas(type, filePath, adId, network, keyBaseName) {
  const folder = String(type || '').toUpperCase();
  const { nas } = config.insertion;

  try {
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
      log.error('NAS upload: file missing or empty', { filePath });
      return DEFAULT_IMAGE;
    }

    // NAS key segments allow only A-Z a-z 0-9 '.' '_' '-'. Strip anything else
    // (e.g. a ':' in a GDN ad_id like "d:be3e..."). Mirrors PHP StoreInNAS
    // str_replace(':','') + the NAS key validator. Numeric ids are unaffected.
    const baseName = String(keyBaseName || path.parse(filePath).name).replace(/[^A-Za-z0-9._-]/g, '');

    // ── Unified NAS media endpoint (images AND video — same place we store thumbnails) ──
    // VIDEO now goes here too (subfolder adVideo/) instead of the old dedicated
    // nas-video-api endpoint. We send the key WITHOUT an extension and the file WITH
    // its real extension (set by the downloader from the file's Content-Type); the NAS
    // validates that extension and appends it — so we never hard-code mp4/jpg, and a
    // video in other_multimedia stays a video. On failure VIDEO returns null (so
    // uploadVideo falls back to its video default); other types fall back to the image.
    const failVal = folder === 'VIDEO' ? null : DEFAULT_IMAGE;
    if (!sftpPool.isConfigured()) {
      log.error('NAS SFTP not configured (config.insertion.nas.sftpHost / sftpUser / sftpPass)');
      return failVal;
    }
    const subfolder = TYPE_SUBFOLDER[folder] || 'adImage/';
    const keyPrefix = NAS_KEY_PREFIX[network] || network;
    const fileExt = path.parse(filePath).ext.replace(/^\./, '').toLowerCase();
    const fileName = fileExt ? `${baseName}.${fileExt}` : baseName;
    const key = `${keyPrefix}/${subfolder}${yearMonth()}/${baseName}`;
    // ── Direct-to-NAS SFTP write — no Cloudflare, no ~100MB body cap. ──
    // The Cloudflare-fronted media endpoint 413s any body >~100MB, so large fb/insta videos could
    // never upload and piled up on this box's disk (took prod down 2026-06-21). The SFTP user is
    // chrooted to the bucket stream root, so writing `<key>.<ext>` lands exactly where the CDN
    // serves /<bucket>/stream/<key>.<ext> — the deterministic path the ad references.
    const remoteKey = `${key}.${fileExt}`;
    const storedPath = `/${resolveBucket()}/stream/${key}.${fileExt}`;
    // Video can be 100s of MB — NEVER upload it inside the insert request (it would hold an SFTP
    // pool slot for minutes and stall inserts under fb/insta load). Defer video straight to the
    // durable queue and return the deterministic path; the parallel background sweep uploads it.
    // Images are small, so upload them in-request.
    if ((folder === 'VIDEO' || folder === 'OTHERMULTIMEDIA') && fileExt) {
      if (enqueueFailedUpload({ filePath, url: remoteKey, key, fileName })) return storedPath;
      return failVal;
    }
    try {
      await sftpPool.putFile(filePath, remoteKey);
      return storedPath;
    } catch (err) {
      // Transient SFTP failure — persist the bytes and let the background cron retry over SFTP,
      // returning the deterministic path now so the ad references the eventual file. Needs a real
      // extension; else fall back to the default.
      if (fileExt && enqueueFailedUpload({ filePath, url: remoteKey, key, fileName })) {
        log.warn('NAS SFTP write deferred to retry queue', { error: err.message, key, storedPath });
        return storedPath;
      }
      log.error('NAS SFTP write failed', { error: err.message, key });
      return failVal;
    }
  } catch (err) {
    log.error('Error in NAS upload', { error: err.message });
    return folder === 'VIDEO' ? null : DEFAULT_IMAGE;
  }
}

/**
 * Resolve a stored (relative) NAS media path into an absolute servable URL, using the
 * SAME base (config.insertion.nas.mediaUrl) these files were uploaded to. Additive helper
 * consumed by the OCR/OCB lease endpoints. Already-absolute URLs (http/https) are returned
 * unchanged. Empty/falsy → returned as-is.
 *
 * @param {string} storedPath - relative path stored in the DB (e.g. '/pas-dev/.../x.jpg')
 * @returns {string} absolute URL, or the input unchanged when it can't/needn't be resolved
 */
function resolveMediaUrl(storedPath) {
  if (!storedPath) return storedPath;
  if (/^https?:\/\//i.test(storedPath)) return storedPath;
  const base = config.insertion.nas.mediaUrl;
  if (!base) return storedPath;
  return joinUrl(base, storedPath);
}

module.exports = { storeInNas, resolveMediaUrl, DEFAULT_IMAGE, TYPE_SUBFOLDER };
