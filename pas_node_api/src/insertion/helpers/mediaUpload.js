'use strict';

/**
 * mediaUpload — shared media download + NAS upload helper.
 *
 * COMMON helper (all networks). Faithful port of PHP helper::fileUpload: download
 * a remote media URL to a temp file, push it to NAS via nasClient (PHP only used
 * StoreInNAS2 — the S3 calls were commented out), unlink the temp file, and return
 * the same keyed shapes the PHP returned so the pipelines can consume them 1:1.
 *
 * Return shapes (per PHP branch):
 *   postOwner  → { post_owner_image }
 *   image      → { nas_path, image_video_url }   (both = the NAS path)
 *   thumbnail  → { image_video_url }
 *   video      → { drive_video_url }              ('/DefaultImage.mp4' on failure)
 *   multimedia → { facebook_ad_id, ad_type, ad_image_video }  (ad_image_video = JSON array)
 *
 * webp conversion (PHP Intervention Image) is intentionally NOT done here — NAS
 * forces a `.jpg` key and stores the bytes; if conversion is ever needed, add it
 * in convertIfNeeded() without touching callers.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const https = require('https');
const mime = require('mime-types');
const { storeInNas, DEFAULT_IMAGE } = require('./nasClient');
const config = require('../../config');
const logger = require('../../logger');

const log = logger.createChild('media-upload');
const DEFAULT_VIDEO = '/DefaultImage.mp4';

const dlAgent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });

/** Download a URL to a temp file. Returns the temp path, or null on empty/failure. */
async function downloadToTemp(url, ext, network = '') {
  if (!url || typeof url !== 'string') return null;
  try {
    // Quora CDN URLs require specific headers and behavior
    const isQuoraCdn = url.includes('qph.cf2.quoracdn.net') || url.includes('quoracdn.net');

    const headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'image/webp,image/apng,image/svg+xml,image/*,video/*,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept-Encoding': 'gzip, deflate, br',
      'Referer': 'https://www.quora.com/',
    };

    // Add extra headers for Quora CDN to prevent 403
    if (isQuoraCdn) {
      headers['Sec-Fetch-Dest'] = 'image';
      headers['Sec-Fetch-Mode'] = 'no-cors';
      headers['Sec-Fetch-Site'] = 'cross-site';
    }

    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: config.insertion.nas.timeoutMs,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      httpsAgent: dlAgent,
      headers: headers,
      validateStatus: () => true,
      maxRedirects: 5,
    });
    if (res.status !== 200 || !res.data || res.data.byteLength === 0) {
      return null;
    }

    // Extension from the server's own Content-Type (so a video URL in other_multimedia
    // becomes .mp4, an image .jpg, etc.). `ext` is only a fallback when the server
    // sends no recognizable type. The NAS still validates the final extension.
    const realExt = mime.extension(res.headers['content-type']) || ext;
    const tmp = path.join(os.tmpdir(), `ins_${Date.now()}_${Math.round(process.hrtime()[1])}.${realExt}`);
    fs.writeFileSync(tmp, Buffer.from(res.data));
    return tmp;
  } catch (err) {
    return null;
  }
}

function cleanup(tmp) {
  if (tmp) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
}

// ── Branches (mirror PHP fileUpload $folder cases) ───────────────────────────

// Per the Media Upload API doc, the stored filename is the entity id itself
// (e.g. fb/adImage/202605/<id>.jpg). The type→subfolder keeps types separated, so
// the same id never collides across image/thumbnail/postowner.
async function uploadPostOwner(link, id, network) {
  const tmp = await downloadToTemp(link, 'jpg', network);
  if (!tmp) return { post_owner_image: DEFAULT_IMAGE };
  try {
    const nasPath = await storeInNas('POSTOWNER', tmp, id, network, `${id}`);
    return { post_owner_image: nasPath };
  } finally { cleanup(tmp); }
}

async function uploadImage(link, id, network) {
  const tmp = await downloadToTemp(link, 'webp', network);
  if (!tmp) return { image_video_url: DEFAULT_IMAGE, nas_path: DEFAULT_IMAGE };
  try {
    const nasPath = await storeInNas('IMAGE', tmp, id, network, `${id}`);
    return { nas_path: nasPath, image_video_url: nasPath };
  } finally { cleanup(tmp); }
}

async function uploadThumbnail(thumbnailUrl, id, network) {
  const tmp = await downloadToTemp(thumbnailUrl, 'webp', network);
  if (!tmp) return { image_video_url: DEFAULT_IMAGE };
  try {
    const nasPath = await storeInNas('THUMBNAIL', tmp, id, network, `${id}`);
    return { image_video_url: nasPath };
  } finally { cleanup(tmp); }
}

async function uploadVideo(link, id, network) {
  const tmp = await downloadToTemp(link, 'mp4');
  if (!tmp) return { drive_video_url: DEFAULT_VIDEO };
  try {
    const nasPath = await storeInNas('VIDEO', tmp, id, network, `${id}`);
    return { drive_video_url: nasPath || DEFAULT_VIDEO };
  } finally { cleanup(tmp); }
}

/**
 * Upload an array of "other multimedia" URLs. Returns the assembled record the
 * caller persists to facebook_ad_image_video. Multiple files for one ad are
 * suffixed with their index to stay unique within the otherMultiMedia folder.
 * @param {string[]} urls
 */
async function uploadMultimedia(urls, type, id, network) {
  const list = Array.isArray(urls) ? urls : [urls];
  // download + upload all items in PARALLEL, preserving input order
  const paths = await Promise.all(list.map(async (url, i) => {
    const tmp = await downloadToTemp(url, 'webp', network);
    if (!tmp) return DEFAULT_IMAGE;
    try {
      return await storeInNas('OTHERMULTIMEDIA', tmp, id, network, `${id}_${i}`);
    } finally { cleanup(tmp); }
  }));
  return { facebook_ad_id: id, ad_type: type, ad_image_video: JSON.stringify(paths) };
}

/**
 * Inspect the media paths produced for an ad and return a simple, caller-facing
 * warning string when the media could NOT be stored (NAS not configured / upload
 * failed / default placeholder). Returns null when media is fine.
 * @param {Object} paths - { image_url, nas_video_url, new_nas_image_url }
 * @param {string} type  - 'IMAGE' | 'VIDEO'
 */
function mediaIssueWarning(paths = {}, type) {
  const bad = (p) => !p || String(p).includes('DefaultImage');
  if (String(type).toUpperCase() === 'VIDEO') {
    if (bad(paths.nas_video_url) || bad(paths.image_url)) {
      return 'Media storage issue: the ad was saved, but its video/thumbnail could not be stored (check NAS config).';
    }
  } else if (bad(paths.image_url)) {
    return 'Image storage issue: the ad was saved, but its image could not be stored (check NAS config).';
  }
  return null;
}

module.exports = {
  uploadPostOwner, uploadImage, uploadThumbnail, uploadVideo, uploadMultimedia,
  downloadToTemp, mediaIssueWarning, DEFAULT_IMAGE, DEFAULT_VIDEO,
};
