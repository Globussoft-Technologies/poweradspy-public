'use strict';

/**
 * nasClient — shared NAS media-upload helper.
 *
 * COMMON helper used by ALL networks (Facebook, Instagram, …). Faithful port of
 * PHP helper::StoreInNAS2, with an ordered transport FALLBACK CHAIN
 * (config.insertion.nas.uploadTransport, default ['http','sftp']): each upload tries the transports
 * in order until one succeeds — HTTP first (fast: a 183MB mp4 uploaded in ~50s in testing), falling
 * back to SFTP (direct NAS write) if HTTP fails. Same chain for image AND video.
 *
 * Timing (independent of transport):
 *   - SMALL media (image / thumbnail / postowner / carousel-image) → uploaded IN-REQUEST (sub-second).
 *   - VIDEO (ad video / carousel-video) → ALWAYS deferred to the durable retry queue and uploaded by
 *     the background sweep. Even fast HTTP is ~50s for a large file (≈3.5min for 800MB), and the insert
 *     must answer in ms — so video bytes are persisted and the response returns the predicted path now.
 *
 * Either way the ad references a DETERMINISTIC predicted path immediately (the key is fixed → the
 * stored path is fixed), so no ES/SQL patch is needed once the upload lands.
 *
 * Returns the stored path, or '/DefaultImage.jpg' ('/DefaultImage.mp4' handled by the video caller)
 * on failure. Never throws (mirrors PHP).
 */

const fs = require('fs');
const path = require('path');
const config = require('../../config');
const logger = require('../../logger');
const { enqueueFailedUpload } = require('./nasUploadQueue');
const sftpPool = require('./nasSftpPool');
const { httpUpload, uploadUrlFor } = require('./nasHttpUpload');

const log = logger.createChild('nas-client');

/** One JSON line to the dedicated NAS-media diagnostics log (keyed by adId). Never throws. */
function nasMediaFail({ adId, network, type, stage, reason, key }) {
  try { logger.nasMedia.warn('media not stored', { adId: adId == null ? undefined : String(adId), network, type, stage, reason, key }); } catch { /* ignore */ }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const UPLOAD_MAX_ATTEMPTS = 2;     // in-request HTTP attempts before deferring to the queue
const UPLOAD_RETRY_BASE_MS = 300;  // backoff between in-request attempts
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const DEFAULT_IMAGE = '/DefaultImage.jpg';

// File extensions treated as VIDEO (so a video inside other_multimedia routes like a video, not an image).
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm', 'm4v', 'avi', 'mkv', 'mpeg', 'mpg', '3gp', 'ogv']);

// Per-network NAS key prefix — from the Media Upload API doc (Network → NAS Folder).
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

/** Is a file extension a video? */
function isVideoExt(ext) {
  return VIDEO_EXTS.has(String(ext || '').toLowerCase());
}

/** Master ON/OFF per media category (config.insertion.nas.store). Default true. */
function storeEnabled(category) {
  const s = config.insertion.nas.store || {};
  return category === 'video' ? s.video !== false : s.image !== false;
}

/** Normalise a configured transport token to a canonical name, or null if unknown. */
function normTransport(t) {
  const x = String(t || '').toLowerCase();
  if (x === 'sftp') return 'sftp';
  if (x === 'http') return 'http';
  if (x === 'httporigin' || x === 'http-origin' || x === 'origin') return 'httpOrigin';
  return null;
}

/** Is a transport actually configured/usable right now? */
function transportUsable(t) {
  const nas = config.insertion.nas;
  if (t === 'sftp') return sftpPool.isConfigured();
  if (t === 'httpOrigin') return !!nas.originUrl;
  return !!nas.mediaUrl; // http
}

/**
 * The ordered, de-duplicated, USABLE transport chain (config.insertion.nas.uploadTransport, default
 * ['http','sftp']). Each upload tries these in order until one succeeds. Never empty: if nothing the
 * config lists is usable, falls back to whatever IS configured so media is never silently dropped.
 */
function transportChain() {
  const raw = config.insertion.nas.uploadTransport;
  const list = (Array.isArray(raw) ? raw : ['http', 'sftp']).map(normTransport).filter(Boolean);
  const seen = new Set();
  const chain = list.filter((t) => transportUsable(t) && !seen.has(t) && seen.add(t));
  if (chain.length) return chain;
  // Nothing configured matched — use any usable transport as a last resort.
  return ['http', 'httpOrigin', 'sftp'].filter(transportUsable);
}

/**
 * Upload a local file to NAS.
 *
 * @param {string} type        - IMAGE | VIDEO | THUMBNAIL | POSTOWNER | OTHERMULTIMEDIA | LANDERS | WHITEHAT | BLACKHAT
 * @param {string} filePath    - absolute path to the local file to upload
 * @param {string|number} adId - the ad id (NAS groups by adId)
 * @param {string} network     - network slug, e.g. 'facebook'
 * @param {string} [keyBaseName] - desired stored filename WITHOUT extension (id-based). Defaults to the
 *                                 temp file's name.
 * @returns {Promise<string>}   - stored path, or '/DefaultImage.jpg' (null for VIDEO) on failure
 */
async function storeInNas(type, filePath, adId, network, keyBaseName, opts = {}) {
  const folder = String(type || '').toUpperCase();

  try {
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).size === 0) {
      log.error('NAS upload: file missing or empty', { filePath });
      nasMediaFail({ adId, network, type: folder, stage: 'upload', reason: 'temp file missing/empty (download failed upstream)' });
      return DEFAULT_IMAGE;
    }

    // NAS key segments allow only A-Z a-z 0-9 '.' '_' '-'. Strip anything else.
    const baseName = String(keyBaseName || path.parse(filePath).name).replace(/[^A-Za-z0-9._-]/g, '');

    const subfolder = TYPE_SUBFOLDER[folder] || 'adImage/';
    const keyPrefix = NAS_KEY_PREFIX[network] || network;
    const fileExt = path.parse(filePath).ext.replace(/^\./, '').toLowerCase();
    const fileName = fileExt ? `${baseName}.${fileExt}` : baseName;
    const key = `${keyPrefix}/${subfolder}${yearMonth()}/${baseName}`;
    // Deterministic predicted path — the CDN serves /<bucket>/stream/<key>.<ext>, which is exactly
    // where every transport lands the file. Returned on defer so the ad references it immediately.
    const storedPath = `/${resolveBucket()}/stream/${key}.${fileExt}`;
    // VIDEO falls back to null (the video caller substitutes its own default); everything else → image default.
    const failVal = folder === 'VIDEO' ? null : DEFAULT_IMAGE;

    // Category drives in-request-vs-deferred (NOT transport — the chain is the same for both). VIDEO is
    // always video; a video file inside other_multimedia is treated as video too (large + slow upload).
    const category = (folder === 'VIDEO' || (folder === 'OTHERMULTIMEDIA' && isVideoExt(fileExt))) ? 'video' : 'image';

    // Master kill-switch: when this media category is disabled (config.insertion.nas.store), do NOT upload,
    // do NOT queue, write NO file. Just return the fallback so the ad saves without this media.
    if (!storeEnabled(category)) {
      return failVal;
    }
    const chain = transportChain();

    // ── VIDEO in-request: never upload here (even fast HTTP is ~50s for a large file) — defer to the
    // durable queue. The BACKGROUND download worker passes opts.background=true and uploads INLINE below
    // instead, so video bytes don't all pile up in nas-pending (only genuine upload failures buffer). ──
    if (category === 'video' && !opts.background) {
      if (fileExt && enqueueFailedUpload({ filePath, transports: chain, key, fileName, ext: fileExt })) return storedPath;
      log.error('NAS video defer failed (no ext or queue full)', { key });
      nasMediaFail({ adId, network, type: folder, stage: 'upload', reason: 'video could not be queued (no ext / queue full)', key });
      return failVal;
    }

    // ── Upload INLINE, walking the transport chain (HTTP first, SFTP fallback). Small media in-request;
    // video only here when called by the background worker (uses the long background timeout). ──
    const upTimeout = (category === 'video' || opts.background) ? (config.insertion.nas.queueUploadTimeoutMs || 30 * 60 * 1000) : undefined;
    let lastErr;
    for (const transport of chain) {
      try {
        if (transport === 'sftp') {
          await sftpPool.putFile(filePath, `${key}.${fileExt}`);
          return storedPath;
        }
        // 'http' / 'httpOrigin' — a couple of quick attempts before falling through to the next transport.
        const url = uploadUrlFor(transport);
        if (!url) { lastErr = `transport '${transport}' not configured`; continue; }
        for (let attempt = 1; attempt <= UPLOAD_MAX_ATTEMPTS; attempt++) {
          const r = await httpUpload(filePath, url, key, fileName, upTimeout);
          if (r.ok) return r.path;        // NAS-returned path (same format as storedPath)
          lastErr = `http status=${r.status}`;
          if (RETRYABLE_STATUS.has(r.status) && attempt < UPLOAD_MAX_ATTEMPTS) { await sleep(UPLOAD_RETRY_BASE_MS * attempt); continue; }
          break; // non-retryable status → try the next transport in the chain
        }
      } catch (err) {
        lastErr = err.message; // network/timeout/SFTP error → try the next transport
      }
    }
    // Whole chain failed in-request — persist the bytes + return the predicted path so the ad references
    // the eventual file and the cron finishes the upload (no re-download → expiry-proof).
    if (fileExt && enqueueFailedUpload({ filePath, transports: chain, key, fileName, ext: fileExt })) {
      log.warn('NAS upload deferred to retry queue (chain exhausted)', { lastErr, key, storedPath });
      return storedPath;
    }
    log.error('NAS upload failed (chain exhausted)', { lastErr, key });
    nasMediaFail({ adId, network, type: folder, stage: 'upload', reason: `upload failed (all transports): ${lastErr}`, key });
    return failVal;
  } catch (err) {
    log.error('Error in NAS upload', { error: err.message });
    return folder === 'VIDEO' ? null : DEFAULT_IMAGE;
  }
}

/**
 * Resolve a stored (relative) NAS media path into an absolute servable URL, using the
 * SAME base (config.insertion.nas.mediaUrl) these files were uploaded to.
 * @param {string} storedPath
 * @returns {string}
 */
function resolveMediaUrl(storedPath) {
  if (!storedPath) return storedPath;
  if (/^https?:\/\//i.test(storedPath)) return storedPath;
  const base = config.insertion.nas.mediaUrl;
  if (!base) return storedPath;
  // Legacy rows store the old `/PowerAdspy(/n2|-Dev)?/…` prefix, but those files now
  // live under `/<bucket>/stream/…` on the NAS. Rewrite the legacy prefix so old
  // OCR/OCB-queued ads (every network shares this resolver) resolve to the real file
  // instead of an unreachable `…/PowerAdspy/n2/…` URL. Modern `/<bucket>/stream/…`
  // paths don't match and pass through unchanged. `/n2` variant is listed first so it
  // is stripped whole (not left as a stray `n2/`).
  const bucket = config.insertion.nas.bucket;
  const resolved = bucket
    ? storedPath.replace(/^\/?(PowerAdspy\/n2|PowerAdspy-Dev|PowerAdspy)\//i, `/${bucket}/stream/`)
    : storedPath;
  return joinUrl(base, resolved);
}

module.exports = { storeInNas, resolveMediaUrl, DEFAULT_IMAGE, TYPE_SUBFOLDER };
