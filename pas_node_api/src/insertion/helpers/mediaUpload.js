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
const { enqueueVideoDownload } = require('./nasDownloadQueue');
const config = require('../../config');
const logger = require('../../logger');

const log = logger.createChild('media-upload');
const DEFAULT_VIDEO = '/DefaultImage.mp4';

const dlAgent = new https.Agent({ keepAlive: true, rejectUnauthorized: false });
const RETRYABLE_DL = new Set([408, 425, 429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let _tmpSeq = 0;

// Master ON/OFF per media type (config.insertion.nas.store). When off, the media is not downloaded,
// not uploaded, and nothing is written to the queues. Default true.
const storeImage = () => config.insertion.nas.store?.image !== false;
const storeVideo = () => config.insertion.nas.store?.video !== false;

// Network-appropriate Referer for protected CDNs (some 403 on a wrong/missing Referer).
const REFERER_BY_NETWORK = {
  facebook: 'https://www.facebook.com/',
  instagram: 'https://www.instagram.com/',
  quora: 'https://www.quora.com/',
  pinterest: 'https://www.pinterest.com/',
  reddit: 'https://www.reddit.com/',
  youtube: 'https://www.youtube.com/',
  linkedin: 'https://www.linkedin.com/',
  tiktok: 'https://www.tiktok.com/',
};
/** Fallback Referer = the URL's own origin (safe default; many CDNs accept their own origin). */
function refererFromUrl(url) {
  try { const u = new URL(url); return `${u.protocol}//${u.host}/`; } catch { return undefined; }
}

/** Pipe a readable stream to a file, resolving when fully written. Cleans up the partial file on error. */
function streamToFile(stream, filePath) {
  return new Promise((resolve, reject) => {
    const ws = fs.createWriteStream(filePath);
    const onErr = (err) => { try { ws.destroy(); } catch { /* ignore */ } reject(err); };
    stream.on('error', onErr);
    ws.on('error', onErr);
    ws.on('finish', resolve);
    stream.pipe(ws);
  });
}

/**
 * Download a URL to a temp file. Returns the temp path, or null on empty/failure.
 *
 * STREAMS the body straight to disk (never buffers the whole file in RAM) — essential for large
 * video at scale: an 800MB arraybuffer per concurrent insert would exhaust memory and take the box
 * down. Retries transient failures with backoff (config.insertion.nas.downloadRetries) — the one-shot
 * download was the root cause of ~20% of video ads getting a /DefaultImage placeholder.
 */
async function downloadToTemp(url, ext, network = '') {
  if (!url || typeof url !== 'string') return null;
  const retries = Math.max(1, config.insertion.nas.downloadRetries || 1);

  // Many ad CDNs are PROTECTED: signed/expiring URLs (fbcdn `oe=`/`oh=`, pinimg, etc.) that 403 without
  // a browser-like UA, and some that check the Referer. Send a real UA + a NETWORK-APPROPRIATE Referer
  // (the old code hard-coded a quora Referer for EVERY network, which could get fb/insta/etc. rejected).
  const isQuoraCdn = url.includes('qph.cf2.quoracdn.net') || url.includes('quoracdn.net');
  const referer = isQuoraCdn ? 'https://www.quora.com/' : (REFERER_BY_NETWORK[String(network).toLowerCase()] || refererFromUrl(url));
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,video/*,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
  };
  if (referer) headers.Referer = referer;
  if (isQuoraCdn) {
    headers['Sec-Fetch-Dest'] = 'image';
    headers['Sec-Fetch-Mode'] = 'no-cors';
    headers['Sec-Fetch-Site'] = 'cross-site';
  }

  for (let attempt = 1; attempt <= retries; attempt++) {
    let tmp = null;
    try {
      const res = await axios.get(url, {
        responseType: 'stream',
        timeout: config.insertion.nas.timeoutMs,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        httpsAgent: dlAgent,
        headers,
        validateStatus: () => true,
        maxRedirects: 5,
      });
      if (res.status !== 200) {
        try { res.data.destroy(); } catch { /* ignore */ }
        if (RETRYABLE_DL.has(res.status) && attempt < retries) { await sleep(300 * attempt); continue; }
        // 401/403/410 → the URL is protected or already EXPIRED (signed-token CDNs). Retrying the same
        // URL won't help — log it (with host) so we can see protection/expiry patterns, then give up.
        let host = ''; try { host = new URL(url).host; } catch { /* ignore */ }
        log.warn('media download failed (non-200)', { status: res.status, host, network: network || undefined });
        return null;
      }
      // Extension from the server's own Content-Type (so a video URL in other_multimedia becomes
      // .mp4, an image .jpg, etc.). `ext` is only a fallback when the server sends no recognizable
      // type. The NAS still validates the final extension.
      const realExt = mime.extension(res.headers['content-type']) || ext;
      _tmpSeq = (_tmpSeq + 1) % 1e6;
      tmp = path.join(os.tmpdir(), `ins_${process.pid}_${Date.now()}_${_tmpSeq}.${realExt}`);
      await streamToFile(res.data, tmp);
      // Reject an empty download (some CDNs 200 with a zero-length body).
      if (!fs.existsSync(tmp) || fs.statSync(tmp).size === 0) {
        cleanup(tmp);
        if (attempt < retries) { await sleep(300 * attempt); continue; }
        return null;
      }
      return tmp;
    } catch (err) {
      if (tmp) cleanup(tmp);
      if (attempt < retries) { await sleep(300 * attempt); continue; }
      return null;
    }
  }
  return null;
}

function cleanup(tmp) {
  if (tmp) { try { fs.unlinkSync(tmp); } catch { /* ignore */ } }
}

/** Extract just the host from a URL (so we log the CDN, not the full signed-token URL). */
function hostOf(url) { try { return new URL(url).host; } catch { return undefined; } }

/**
 * One JSON line to the dedicated NAS-media diagnostics log (logs/nas-media-<date>.log), keyed by adId,
 * so we can answer "why didn't THIS ad's image/video store?" — grep the file by the ad id.
 * stage = 'download' | 'upload' | 'video-download'. Never throws (a log failure must not break an upload).
 */
function nasMediaFail(stage, { adId, network, type, url, reason }) {
  try {
    logger.nasMedia.warn('media not stored', { adId: adId == null ? undefined : String(adId), network, type, stage, reason, host: hostOf(url) });
  } catch { /* ignore */ }
}

// ── Branches (mirror PHP fileUpload $folder cases) ───────────────────────────

// Per the Media Upload API doc, the stored filename is the entity id itself
// (e.g. fb/adImage/202605/<id>.jpg). The type→subfolder keeps types separated, so
// the same id never collides across image/thumbnail/postowner.
async function uploadPostOwner(link, id, network) {
  if (!storeImage()) return { post_owner_image: DEFAULT_IMAGE };
  const tmp = await downloadToTemp(link, 'jpg', network);
  if (!tmp) { nasMediaFail('download', { adId: id, network, type: 'POSTOWNER', url: link, reason: 'source download failed (expired/blocked URL?)' }); return { post_owner_image: DEFAULT_IMAGE }; }
  try {
    const nasPath = await storeInNas('POSTOWNER', tmp, id, network, `${id}`);
    if (String(nasPath).includes('DefaultImage')) return null;
    return { post_owner_image: nasPath };
  } finally { cleanup(tmp); }
}

async function uploadImage(link, id, network) {
  if (!storeImage()) return { image_video_url: DEFAULT_IMAGE, nas_path: DEFAULT_IMAGE };
  const tmp = await downloadToTemp(link, 'webp', network);
  if (!tmp) { nasMediaFail('download', { adId: id, network, type: 'IMAGE', url: link, reason: 'source download failed (expired/blocked URL?)' }); return { image_video_url: DEFAULT_IMAGE, nas_path: DEFAULT_IMAGE }; }
  try {
    const nasPath = await storeInNas('IMAGE', tmp, id, network, `${id}`);
    if (String(nasPath).includes('DefaultImage')) return null;
    return { nas_path: nasPath, image_video_url: nasPath };
  } finally { cleanup(tmp); }
}

async function uploadThumbnail(thumbnailUrl, id, network) {
  if (!storeImage()) return { image_video_url: DEFAULT_IMAGE };
  const tmp = await downloadToTemp(thumbnailUrl, 'webp', network);
  if (!tmp) { nasMediaFail('download', { adId: id, network, type: 'THUMBNAIL', url: thumbnailUrl, reason: 'source download failed (expired/blocked URL?)' }); return { image_video_url: DEFAULT_IMAGE }; }
  try {
    const nasPath = await storeInNas('THUMBNAIL', tmp, id, network, `${id}`);
    if (String(nasPath).includes('DefaultImage')) return null;
    return { image_video_url: nasPath };
  } finally { cleanup(tmp); }
}

/**
 * Ad video → durable BACKGROUND download-queue (never downloaded/uploaded in-request).
 *
 * Returns null so the caller does NOT write a path now: the worker downloads off-request (while the
 * source URL is fresh), secures the bytes into the upload queue, then publishes the REAL nas_video_url
 * onto the ES doc — so we never store a fake/placeholder path, and the insert never waits on the video.
 */
async function uploadVideo(link, id, network) {
  if (!storeVideo()) return null;            // video storage disabled — no download, no queue, no file
  if (link) enqueueVideoDownload({ network, idValue: id, videoUrl: link });
  return null;
}

/**
 * Upload an array of "other multimedia" URLs. Returns the assembled record the
 * caller persists to facebook_ad_image_video. Multiple files for one ad are
 * suffixed with their index to stay unique within the otherMultiMedia folder.
 * @param {string[]} urls
 */
async function uploadMultimedia(urls, type, id, network) {
  const list = Array.isArray(urls) ? urls : [urls];
  // Both media types off → skip carousel entirely. (When only one is off, per-item storeInNas still gates.)
  if (!storeImage() && !storeVideo()) {
    return { facebook_ad_id: id, ad_type: type, ad_image_video: JSON.stringify(list.map(() => DEFAULT_IMAGE)) };
  }
  // download + upload all items in PARALLEL, preserving input order
  const paths = await Promise.all(list.map(async (url, i) => {
    const tmp = await downloadToTemp(url, 'webp', network);
    if (!tmp) { nasMediaFail('download', { adId: `${id}_${i}`, network, type: 'OTHERMULTIMEDIA', url, reason: 'source download failed (expired/blocked URL?)' }); return DEFAULT_IMAGE; }
    try {
      const p = await storeInNas('OTHERMULTIMEDIA', tmp, id, network, `${id}_${i}`);
      return String(p).includes('DefaultImage') ? null : p;
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
    // Gate on the THUMBNAIL only (that's what shows in search results). The video file is NOT
    // downloaded here — it would block the insert for ~40s on a large file. We carry videoUrl forward;
    // storePrimaryFromTemp hands it to the durable background download-queue after commit.
    if (!storeImage()) return { ok: true, type, videoUrl: m.videoUrl }; // image (thumbnail) storage off → no gate
    const thumb = await downloadToTemp(m.thumbnailUrl, 'webp', network);
    if (!thumb) return { ok: false, type, reason: 'thumbnail' };
    return { ok: true, type, thumb, videoUrl: m.videoUrl };
  }
  if (type === 'IMAGE') {
    if (!storeImage()) return { ok: true, type };  // image storage off → don't gate/reject
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
      // Thumbnail is uploaded in-request (small, sub-second). The VIDEO goes to the durable background
      // download-queue: nas_video_url is left UNSET here and written by the worker only after the bytes
      // are secured — so the ad never carries a fake/placeholder video path, and the insert stays fast.
      const thumb = fetched.thumb ? await storeInNas('THUMBNAIL', fetched.thumb, id, network, `${id}`).catch(() => null) : null;
      if (thumb && !String(thumb).includes('DefaultImage')) out.image_url = thumb;
      if (fetched.videoUrl) enqueueVideoDownload({ network, idValue: id, videoUrl: fetched.videoUrl });
    } else if (fetched.type === 'IMAGE' && fetched.image) {
      const nasPath = await storeInNas('IMAGE', fetched.image, id, network, `${id}`).catch(() => null);
      if (nasPath && !String(nasPath).includes('DefaultImage')) { out.image_url = nasPath; out.new_nas_image_url = nasPath; }
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
    // The video file is downloaded+stored ASYNCHRONOUSLY (background download-queue), so an unset
    // nas_video_url at response time is EXPECTED, not a failure — only the in-request thumbnail matters.
    if (bad(paths.image_url)) {
      return 'Media storage issue: the ad was saved, but its thumbnail could not be stored (check NAS config). The video is queued and will attach shortly.';
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
