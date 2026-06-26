'use strict';

/**
 * nasUploadQueue — durable, on-disk retry queue for NAS media uploads.
 *
 * WHY: an upload can fail transiently (NAS busy / SFTP timeout / Cloudflare 5xx), and VIDEO is
 * ALWAYS routed here (a 100s-of-MB upload must never run inside the insert request). We must NOT
 * (a) make the insertion API wait, or (b) lose media. The source CDN URL often EXPIRES, so
 * re-downloading later is not an option — instead we persist the already-downloaded BYTES to disk
 * and retry only the UPLOAD, to the SAME deterministic key the ad already references.
 *
 * Transport-aware: each sidecar records how to upload (sftp / http / httpOrigin), so the background
 * sweep re-uploads via the same transport nasClient chose. The upload URL for http transports is
 * rebuilt from CURRENT config at retry time (never a stale URL).
 *
 * Disk safety: a HARD cap (config.insertion.nas.pendingMaxGB, default 10GB) bounds this dir so it can
 * never fill the API box disk again (the 2026-06-21 outage). When over cap, new deferrals are dropped
 * (logged) — the media is lost, but the box stays up.
 */

const fs = require('fs');
const path = require('path');
const config = require('../../config');
const logger = require('../../logger');
const sftpPool = require('./nasSftpPool');
const { httpUpload, uploadUrlFor } = require('./nasHttpUpload');

const log = logger.createChild('nas-upload-queue');

const PENDING_DIR = path.join(process.cwd(), (config.localCache && config.localCache.dir) || 'data', 'nas-pending');
const FAILED_DIR = path.join(PENDING_DIR, 'failed');

const MAX_ATTEMPTS = 50;                  // ~ up to a day of retries before giving up
const BACKOFF_STEP_MS = 60 * 1000;        // attempt N waits N*1min ...
const BACKOFF_MAX_MS = 30 * 60 * 1000;    // ... capped at 30 min

let seq = 0;
function uniqueId() { seq = (seq + 1) % 1e6; return `${process.pid}_${Date.now()}_${seq}`; }
function ensureDir(d) { try { fs.mkdirSync(d, { recursive: true }); } catch { /* ignore */ } }

// ── Pending-dir size cap ──────────────────────────────────────────────────────
// Cheap, lazily-cached total-bytes of PENDING_DIR (recomputed at most every few seconds) so the
// hot enqueue path doesn't stat the whole dir every time.
let _sizeCache = { bytes: 0, at: 0 };
function pendingDirBytes() {
  const now = Date.now();
  if (now - _sizeCache.at < 5000) return _sizeCache.bytes;
  let total = 0;
  try {
    for (const f of fs.readdirSync(PENDING_DIR)) {
      try { const st = fs.statSync(path.join(PENDING_DIR, f)); if (st.isFile()) total += st.size; } catch { /* ignore */ }
    }
  } catch { /* dir may not exist yet */ }
  _sizeCache = { bytes: total, at: now };
  return total;
}

/**
 * Persist a just-downloaded file + enqueue its upload for background retry.
 * @param {{filePath:string, transports:Array<'sftp'|'http'|'httpOrigin'>, key:string, fileName:string, ext:string}} job
 *   transports = the ordered fallback chain to try on each retry (e.g. ['http','sftp']).
 * @returns {boolean} true if enqueued (caller can then return the predicted path).
 */
function enqueueFailedUpload({ filePath, transports, key, fileName, ext }) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return false;
    const incoming = (() => { try { return fs.statSync(filePath).size; } catch { return 0; } })();

    // HARD cap (config.insertion.nas.pendingMaxGB) — never let this queue fill the API box disk.
    const capGB = config.insertion.nas.pendingMaxGB;
    if (capGB && capGB > 0) {
      const capBytes = capGB * 1e9;
      if (pendingDirBytes() + incoming > capBytes) {
        log.error('nas-pending enqueue skipped — over pendingMaxGB cap', { capGB, key });
        return false;
      }
    }
    // Belt-and-suspenders: also bail if the filesystem itself is nearly full.
    try {
      const sf = fs.statfsSync(PENDING_DIR);
      const freeGB = (sf.bavail * sf.bsize) / 1e9;
      if (freeGB < 3) { log.error('nas-pending enqueue skipped — low disk', { freeGB: +freeGB.toFixed(1), key }); return false; }
    } catch (e) { /* statfs unavailable -> proceed */ }

    ensureDir(PENDING_DIR);
    const id = uniqueId();
    const blobExt = path.parse(fileName || filePath).ext || (ext ? `.${ext}` : '');
    const blobName = `${id}${blobExt}`;
    const dest = path.join(PENDING_DIR, blobName);
    // Move the bytes into the queue (the source URL may expire, so we must keep them). Prefer a rename
    // (one metadata op, no extra write) when temp + pending share a filesystem; fall back to a copy
    // across filesystems. Halves disk I/O per large video at 400k+ inserts/day.
    try { fs.renameSync(filePath, dest); }
    catch { fs.copyFileSync(filePath, dest); }
    const meta = {
      id, transports: (Array.isArray(transports) && transports.length) ? transports : ['http', 'sftp'],
      key, fileName, ext: ext || blobExt.replace(/^\./, ''),
      blob: blobName, attempts: 0, nextAttemptAt: Date.now(), createdAt: Date.now(),
    };
    fs.writeFileSync(path.join(PENDING_DIR, `${id}.json`), JSON.stringify(meta));
    _sizeCache.bytes += incoming; // keep the cached size roughly current between recomputes
    return true;
  } catch (err) {
    log.error('enqueueFailedUpload failed', { error: err.message, key });
    return false;
  }
}

/**
 * Re-upload one pending blob, walking its recorded transport chain (e.g. ['httpOrigin','sftp']) until
 * one succeeds. Throws if the WHOLE chain fails (caller reschedules with backoff). Background uploads
 * get a long timeout (config.insertion.nas.queueUploadTimeoutMs, default 30 min) — a large video can
 * legitimately take minutes — unlike the short in-request image timeout.
 */
async function uploadBlob(meta) {
  const blobPath = path.join(PENDING_DIR, meta.blob);
  if (!fs.existsSync(blobPath)) return { done: true }; // bytes gone → nothing to retry
  const ext = meta.ext || (path.extname(meta.fileName || meta.blob).replace(/^\./, '')) || '';
  const remote = ext ? `${meta.key}.${ext}` : meta.key;
  // Backward-compat: old sidecars carried a single `transport`; default chain otherwise.
  const chain = (Array.isArray(meta.transports) && meta.transports.length)
    ? meta.transports : (meta.transport ? [meta.transport] : ['http', 'sftp']);
  const longTimeout = config.insertion.nas.queueUploadTimeoutMs || 30 * 60 * 1000;

  let lastErr;
  for (const transport of chain) {
    try {
      if (transport === 'http' || transport === 'httpOrigin') {
        const url = uploadUrlFor(transport);
        if (!url) { lastErr = `transport '${transport}' not configured`; continue; }
        const r = await httpUpload(blobPath, url, meta.key, meta.fileName || path.basename(remote), longTimeout);
        if (r.ok) return { done: true, path: r.path };
        lastErr = `http status=${r.status}`;
      } else { // sftp — direct NAS write, no body cap. putFile throws on failure.
        await sftpPool.putFile(blobPath, remote);
        return { done: true, path: '/' + remote };
      }
    } catch (e) { lastErr = e.message; }
  }
  throw new Error(lastErr || 'all transports failed');
}

// Sweep concurrency = the SFTP pool size (each worker borrows one pooled connection for sftp jobs).
const SWEEP_CONCURRENCY = config.insertion.nas.sftpPoolSize || 5;

/** Process one pending sidecar: upload, then unlink on success / reschedule or give up on failure. */
async function processPending(f, now, counters) {
  const metaPath = path.join(PENDING_DIR, f);
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { return; }
  if ((meta.nextAttemptAt || 0) > now) return;

  let r;
  try { r = await uploadBlob(meta); } catch (e) { r = { done: false, error: e.message }; }

  if (r.done) {
    try { fs.unlinkSync(path.join(PENDING_DIR, meta.blob)); } catch { /* ignore */ }
    try { fs.unlinkSync(metaPath); } catch { /* ignore */ }
    counters.ok++;
    return;
  }

  meta.attempts = (meta.attempts || 0) + 1;
  if (meta.attempts >= MAX_ATTEMPTS) {
    // Give up retrying but keep the bytes for manual recovery.
    try {
      ensureDir(FAILED_DIR);
      fs.renameSync(path.join(PENDING_DIR, meta.blob), path.join(FAILED_DIR, meta.blob));
      fs.renameSync(metaPath, path.join(FAILED_DIR, f));
    } catch { /* ignore */ }
    counters.gaveUp++;
    log.error('NAS pending upload gave up (moved to failed/)', { key: meta.key, transport: meta.transport, attempts: meta.attempts });
  } else {
    meta.nextAttemptAt = now + Math.min(BACKOFF_MAX_MS, BACKOFF_STEP_MS * meta.attempts);
    try { fs.writeFileSync(metaPath, JSON.stringify(meta)); } catch { /* ignore */ }
    counters.retry++;
  }
}

let sweeping = false;
/** Process all due pending uploads once, with bounded concurrency. Self-guards against overlap. */
async function sweepPending() {
  if (sweeping) return;
  sweeping = true;
  try {
    if (!fs.existsSync(PENDING_DIR)) return;
    const metas = fs.readdirSync(PENDING_DIR).filter((f) => f.endsWith('.json'));
    if (!metas.length) return;
    const now = Date.now();
    const counters = { ok: 0, retry: 0, gaveUp: 0 };
    let i = 0;
    const worker = async () => { while (i < metas.length) { await processPending(metas[i++], now, counters); } };
    await Promise.all(Array.from({ length: Math.min(SWEEP_CONCURRENCY, metas.length) }, worker));
    _sizeCache.at = 0; // force a fresh size read after the sweep removed/moved files
    if (counters.ok || counters.gaveUp) log.info('NAS pending sweep done', { uploaded: counters.ok, rescheduled: counters.retry, gaveUp: counters.gaveUp });
  } catch (err) {
    log.error('sweepPending error', { error: err.message });
  } finally {
    sweeping = false;
  }
}

module.exports = { enqueueFailedUpload, sweepPending, PENDING_DIR };
