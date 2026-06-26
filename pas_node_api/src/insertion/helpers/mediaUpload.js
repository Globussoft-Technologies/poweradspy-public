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
 * Download an ad's PRIMARY media to temp file(s) BEFORE insertion, so a pipeline can
 * REJECT the ad when the gating media can't be fetched — instead of storing a
 * /DefaultImage.jpg placeholder. The bytes are reused by storePrimaryFromTemp() after
 * commit, so there is NO second download.
 *
 * Gating rule (product decision): IMAGE ads gate on the image; VIDEO ads gate on the
 * THUMBNAIL (that's what shows in search results) — the video file itself is allowed to
 * fail / defer to the retry queue. Any other type (TEXT, …) is never gated.
 *
 * @param {{type?:string, imageUrl?:string, videoUrl?:string, thumbnailUrl?:string}} m
 * @param {string} [network]
 * @returns {Promise<{ok:boolean, type:string, image?:string|null, video?:string|null,
 *                     thumb?:string|null, reason?:string}>}
 *   ok=false → the caller should reject (reason: 'image' | 'thumbnail'). On success the
 *   temp paths MUST be handed to storePrimaryFromTemp (which uploads + cleans up) or freed
 *   with cleanupFetched.
 */
async function fetchPrimaryMedia(m = {}, network = '') {
  const type = String(m.type || '').toUpperCase();
  if (type === 'VIDEO') {
    const [video, thumb] = await Promise.all([
      downloadToTemp(m.videoUrl, 'mp4'),
      downloadToTemp(m.thumbnailUrl, 'webp', network),
    ]);
    if (!thumb) { cleanup(video); return { ok: false, type, reason: 'thumbnail' }; }
    return { ok: true, type, video, thumb };
  }
  if (type === 'IMAGE') {
    const image = await downloadToTemp(m.imageUrl, 'webp', network);
    if (!image) return { ok: false, type, reason: 'image' };
    return { ok: true, type, image };
  }
  // No gated media for other types — nothing pre-downloaded.
  return { ok: true, type };
}

/**
 * Upload the media pre-downloaded by fetchPrimaryMedia() to NAS using the now-known ad id,
 * returning the SAME keyed shape the pipelines build for the primary media, and cleaning up
 * the temp files. Safe to call with a non IMAGE/VIDEO `fetched` (returns {}).
 */
async function storePrimaryFromTemp(fetched, id, network) {
  const out = {};
  if (!fetched) return out;
  try {
    if (fetched.type === 'VIDEO') {
      const [vid, thumb] = await Promise.all([
        fetched.video ? storeInNas('VIDEO', fetched.video, id, network, `${id}`).catch(() => null) : Promise.resolve(null),
        fetched.thumb ? storeInNas('THUMBNAIL', fetched.thumb, id, network, `${id}`).catch(() => null) : Promise.resolve(null),
      ]);
      if (vid) out.nas_video_url = vid;
      if (thumb) out.image_url = thumb;
    } else if (fetched.type === 'IMAGE' && fetched.image) {
      const nasPath = await storeInNas('IMAGE', fetched.image, id, network, `${id}`).catch(() => null);
      if (nasPath) { out.image_url = nasPath; out.new_nas_image_url = nasPath; }
    }
  } finally {
    cleanupFetched(fetched);
  }
  return out;
}

/** Unlink any temp files held by a fetchPrimaryMedia() result (reject / error paths). Idempotent. */
function cleanupFetched(fetched) {
  if (!fetched) return;
  cleanup(fetched.image); cleanup(fetched.video); cleanup(fetched.thumb);
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
  fetchPrimaryMedia, storePrimaryFromTemp, cleanupFetched,
};
