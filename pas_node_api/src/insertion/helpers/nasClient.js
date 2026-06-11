'use strict';

/**
 * nasClient — shared NAS media-upload helper.
 *
 * COMMON helper used by ALL networks (Facebook, Instagram, …). Faithful port of
 * PHP helper::StoreInNAS2. The only intentional change: the `network` is a
 * PARAMETER (PHP hard-coded 'facebook') so every network reuses this one helper.
 *
 * Behaviour:
 *   - VIDEO  → POST to config.insertion.nas.videoUrl  (multipart: network, adid, file)
 *   - others → POST to {mediaUrl}/{bucket}/upload      (Bearer token; multipart: key, file)
 *              key = "{network}/{typeSubfolder}{YYYYMM}/{filename}.jpg"
 *   - Returns the stored path string, or '/DefaultImage.jpg' on any failure
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

const log = logger.createChild('nas-client');

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
  VIDEO: 'video/',
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

    // ── VIDEO → dedicated NAS video endpoint (PHP: env('NAS_VIDEO_URL')."upload"). ──
    // Multipart: network, file, adid. Returns the stored `path` (→ nas_video_url).
    if (folder === 'VIDEO') {
      if (!nas.videoUrl) {
        log.error('NAS videoUrl not configured (config.insertion.nas.videoUrl / NAS_VIDEO_URL)');
        return DEFAULT_IMAGE;
      }
      const videoEndpoint = joinUrl(nas.videoUrl, nas.videoUploadPath || '/upload');
      const form = new FormData();
      form.append('network', network);
      form.append('file', fs.createReadStream(filePath), { filename: `${baseName}.mp4` });
      form.append('adid', String(adId));
      const res = await axios.post(videoEndpoint, form, {
        headers: form.getHeaders(),
        timeout: nas.timeoutMs,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        httpsAgent: nasAgent(),
        validateStatus: () => true,
      });
      if (res.data?.path) return res.data.path;
      log.error('NAS video upload failed', { status: res.status, body: res.data });
      return null;
    }

    // ── Unified NAS media endpoint (images AND video, per the Media Upload API doc) ──
    if (!nas.mediaUrl) {
      log.error('NAS mediaUrl not configured (config.insertion.nas.mediaUrl / NAS_MEDIA_URL)');
      return DEFAULT_IMAGE;
    }
    const subfolder = TYPE_SUBFOLDER[folder] || 'adImage/';
    const ext = folder === 'VIDEO' ? 'mp4' : 'jpg';
    const fileName = `${baseName}.${ext}`;
    const keyPrefix = NAS_KEY_PREFIX[network] || network;
    const key = `${keyPrefix}/${subfolder}${yearMonth()}/${fileName}`;
    const mediaPath = (nas.mediaUploadPath || '/{bucket}/upload').replace('{bucket}', resolveBucket());
    const url = joinUrl(nas.mediaUrl, mediaPath);

    const form = new FormData();
    form.append('key', key);
    form.append('file', fs.createReadStream(filePath), { filename: fileName });

    const res = await axios.post(url, form, {
      headers: { ...form.getHeaders(), Authorization: `Bearer ${nas.mediaToken}` },
      timeout: nas.timeoutMs,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      httpsAgent: nasAgent(),
      validateStatus: () => true,
    });

   
    if (res.data?.ok && res.data?.path) return res.data.path;

    log.error('NAS upload failed', { status: res.status, body: res.data });
    return DEFAULT_IMAGE;
  } catch (err) {
    log.error('Error in NAS upload', { error: err.message });
    return DEFAULT_IMAGE;
  }
}

module.exports = { storeInNas, DEFAULT_IMAGE, TYPE_SUBFOLDER };
