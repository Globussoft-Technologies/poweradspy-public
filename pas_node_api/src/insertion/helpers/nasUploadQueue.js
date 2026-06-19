'use strict';

/**
 * nasUploadQueue — durable, on-disk retry queue for NAS media uploads.
 *
 * WHY: media.globussoft.com (behind Cloudflare) intermittently returns transient
 * 5xx/timeouts. We must NOT (a) make the insertion API wait long, or (b) lose media.
 * The source CDN URL often EXPIRES, so re-downloading later is not an option — instead
 * we persist the already-downloaded BYTES to disk and retry only the UPLOAD.
 *
 * Flow:
 *   - On an in-request upload failure, nasClient copies the temp file here + writes a
 *     small sidecar JSON describing the upload (url, key, fileName). It then returns the
 *     DETERMINISTIC predicted NAS path (the key is fixed → the stored path is fixed), so
 *     the ad references the eventual path immediately — NO ES/SQL patch needed later.
 *   - A background cron (sweepPending) re-uploads each pending blob to the SAME key until
 *     it succeeds; the file then lands exactly where the ad already points. On success the
 *     blob + sidecar are deleted. After MAX_ATTEMPTS the blob is moved to `failed/` (kept
 *     for manual recovery, no longer retried).
 *
 * No secrets are persisted — the Bearer token is read from config at upload time.
 * The pending dir is local to each machine; each machine's worker-1 sweeps its own dir.
 */

const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const axios = require('axios');
const https = require('https');
const config = require('../../config');
const logger = require('../../logger');

const log = logger.createChild('nas-upload-queue');

const PENDING_DIR = path.join(process.cwd(), (config.localCache && config.localCache.dir) || 'data', 'nas-pending');
const FAILED_DIR = path.join(PENDING_DIR, 'failed');

const MAX_ATTEMPTS = 50;                  // ~ up to a day of retries before giving up
const BACKOFF_STEP_MS = 60 * 1000;        // attempt N waits N*1min ...
const BACKOFF_MAX_MS = 30 * 60 * 1000;    // ... capped at 30 min

let seq = 0;
function uniqueId() { seq = (seq + 1) % 1e6; return `${process.pid}_${Date.now()}_${seq}`; }
function ensureDir(d) { try { fs.mkdirSync(d, { recursive: true }); } catch { /* ignore */ } }
function nasAgent() {
  return config.insertion.nas.verifyTls ? undefined : new https.Agent({ keepAlive: true, rejectUnauthorized: false });
}

/**
 * Persist a just-downloaded file + enqueue its upload for background retry.
 * @returns {boolean} true if enqueued (caller can then return the predicted path).
 */
function enqueueFailedUpload({ filePath, url, key, fileName }) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return false;
    ensureDir(PENDING_DIR);
    const id = uniqueId();
    const ext = path.parse(fileName || filePath).ext || '';
    const blobName = `${id}${ext}`;
    fs.copyFileSync(filePath, path.join(PENDING_DIR, blobName)); // keep the bytes (source URL may expire)
    const meta = { id, url, key, fileName, blob: blobName, attempts: 0, nextAttemptAt: Date.now(), createdAt: Date.now() };
    fs.writeFileSync(path.join(PENDING_DIR, `${id}.json`), JSON.stringify(meta));
    return true;
  } catch (err) {
    log.error('enqueueFailedUpload failed', { error: err.message, key });
    return false;
  }
}

async function uploadBlob(meta) {
  const blobPath = path.join(PENDING_DIR, meta.blob);
  if (!fs.existsSync(blobPath)) return { done: true }; // bytes gone → nothing to retry
  const form = new FormData();
  form.append('key', meta.key);
  form.append('file', fs.createReadStream(blobPath), { filename: meta.fileName });
  const res = await axios.post(meta.url, form, {
    headers: { ...form.getHeaders(), Authorization: `Bearer ${config.insertion.nas.mediaToken}` },
    timeout: config.insertion.nas.timeoutMs,
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    httpsAgent: nasAgent(),
    validateStatus: () => true,
  });
  if (res.data && res.data.ok && res.data.path) return { done: true, path: res.data.path };
  return { done: false, status: res.status };
}

let sweeping = false;
/** Process all due pending uploads once. Safe to call repeatedly (self-guards against overlap). */
async function sweepPending() {
  if (sweeping) return;
  sweeping = true;
  try {
    if (!fs.existsSync(PENDING_DIR)) return;
    const metas = fs.readdirSync(PENDING_DIR).filter((f) => f.endsWith('.json'));
    const now = Date.now();
    let ok = 0, retry = 0, gaveUp = 0;
    for (const f of metas) {
      const metaPath = path.join(PENDING_DIR, f);
      let meta;
      try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { continue; }
      if ((meta.nextAttemptAt || 0) > now) continue;

      let r;
      try { r = await uploadBlob(meta); } catch (e) { r = { done: false, status: 0, error: e.message }; }

      if (r.done) {
        try { fs.unlinkSync(path.join(PENDING_DIR, meta.blob)); } catch { /* ignore */ }
        try { fs.unlinkSync(metaPath); } catch { /* ignore */ }
        ok++;
        continue;
      }

      meta.attempts = (meta.attempts || 0) + 1;
      if (meta.attempts >= MAX_ATTEMPTS) {
        // Give up retrying but keep the bytes for manual recovery.
        try {
          ensureDir(FAILED_DIR);
          fs.renameSync(path.join(PENDING_DIR, meta.blob), path.join(FAILED_DIR, meta.blob));
          fs.renameSync(metaPath, path.join(FAILED_DIR, f));
        } catch { /* ignore */ }
        gaveUp++;
        log.error('NAS pending upload gave up (moved to failed/)', { key: meta.key, attempts: meta.attempts });
      } else {
        meta.nextAttemptAt = now + Math.min(BACKOFF_MAX_MS, BACKOFF_STEP_MS * meta.attempts);
        try { fs.writeFileSync(metaPath, JSON.stringify(meta)); } catch { /* ignore */ }
        retry++;
      }
    }
    if (ok || gaveUp) log.info('NAS pending sweep done', { uploaded: ok, rescheduled: retry, gaveUp });
  } catch (err) {
    log.error('sweepPending error', { error: err.message });
  } finally {
    sweeping = false;
  }
}

module.exports = { enqueueFailedUpload, sweepPending, PENDING_DIR };
