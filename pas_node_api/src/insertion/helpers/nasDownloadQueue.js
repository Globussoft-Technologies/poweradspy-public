'use strict';

/**
 * nasDownloadQueue — durable, on-disk queue for BACKGROUND ad-video downloads.
 *
 * WHY: downloading a large ad video (up to ~800MB) must NOT block the insertion response, and we must
 * never write a "fake" nas_video_url (a predicted path for bytes we don't yet have). So on a VIDEO
 * insert the pipeline commits the ad + its thumbnail, responds in ms, and enqueues a tiny download-JOB
 * here (just the source URL + where to write the path). A background worker then:
 *   1. downloads the video (streamed, retried) WHILE the source URL is still fresh,
 *   2. hands the bytes to the durable UPLOAD queue (nasUploadQueue) via storeInNas — which returns the
 *      DETERMINISTIC path and guarantees the file eventually lands at that key,
 *   3. and ONLY THEN writes nas_video_url onto the ad's ES doc.
 *
 * Guarantees: fast (no in-request video I/O), never-fake (path written only after bytes are secured),
 * and durable (the job is on disk, so a crash/restart resumes the download — the bytes-secured marker
 * `job.path` ensures we never re-download or double-upload). The only unrecoverable case is a source
 * URL that EXPIRES before the worker runs — true of any design.
 *
 * Two-stage pipeline:  nasDownloadQueue (this) → nasUploadQueue → NAS.
 */

const fs = require('fs');
const path = require('path');
const config = require('../../config');
const logger = require('../../logger');

const log = logger.createChild('nas-download-queue');

const PENDING_DIR = path.join(process.cwd(), (config.localCache && config.localCache.dir) || 'data', 'nas-video-pending');
const FAILED_DIR = path.join(PENDING_DIR, 'failed');

const MAX_ATTEMPTS = 50;                  // download/ES-write attempts before giving up (~a day with backoff)
const BACKOFF_STEP_MS = 60 * 1000;        // attempt N waits N*1min ...
const BACKOFF_MAX_MS = 30 * 60 * 1000;    // ... capped at 30 min

let seq = 0;
function uniqueId() { seq = (seq + 1) % 1e6; return `${process.pid}_${Date.now()}_${seq}`; }
function ensureDir(d) { try { fs.mkdirSync(d, { recursive: true }); } catch { /* ignore */ } }

// Where to publish nas_video_url per network (ES index + the term field to locate the doc by internal
// id). Only fb/insta carry ad video, and their indexes are fixed. A caller may override via esIndex/idField.
const VIDEO_SINK = {
  facebook: { esIndex: 'search_mix', idField: 'facebook_ad.id' },
  instagram: { esIndex: 'instagram_search_mix', idField: 'instagram_ad.id' },
};

/** Extract _id from an ES search response (guarded; handles ES7 `.body` and ES8 flat shapes). */
function firstHitId(esResponse) {
  const hits = esResponse?.hits?.hits || esResponse?.body?.hits?.hits;
  return hits && hits[0] ? hits[0]._id : null;
}

/**
 * Enqueue a background video download. Records ONLY the intent (no bytes yet) — tiny JSON.
 * @param {{network:string, esIndex:string, idField:string, idValue:(string|number),
 *          videoUrl:string, fieldName?:string}} job
 *   network  → which ES client (DatabaseManager.getElastic) + NAS key prefix.
 *   esIndex  → the ad's ES index (e.g. 'search_mix' / 'instagram_search_mix').
 *   idField  → the term field to locate the doc (e.g. 'facebook_ad.id' / 'instagram_ad.id').
 *   idValue  → the ad's internal id (used BOTH to locate the ES doc AND as the NAS key id).
 *   videoUrl → the source video URL to download.
 *   fieldName→ ES field to set (default 'nas_video_url').
 * @returns {boolean} true if enqueued.
 */
function enqueueVideoDownload({ network, esIndex, idField, idValue, videoUrl, fieldName }) {
  try {
    if (!videoUrl || !network || idValue == null) return false;
    if (config.insertion.nas.store?.video === false) return false; // video storage disabled — write no job
    // Resolve where to publish the path. Fall back to the per-network map (fb/insta).
    const base = VIDEO_SINK[network] || {};
    const sink = { esIndex: esIndex || base.esIndex, idField: idField || base.idField };
    if (!sink.esIndex || !sink.idField) {
      log.error('enqueueVideoDownload: no ES sink for network (cannot locate doc to set nas_video_url)', { network, idValue });
      return false;
    }
    ensureDir(PENDING_DIR);
    // Disk safety (backstop): never let this dir grow when the box is low on space. Jobs are tiny JSON
    // (no media bytes — the bytes only ever touch disk transiently during the worker's download), so
    // this normally never trips; it just guarantees this dir can't be what fills the disk.
    try {
      const sf = fs.statfsSync(PENDING_DIR);
      const freeGB = (sf.bavail * sf.bsize) / 1e9;
      if (freeGB < 2) { log.error('video download enqueue skipped — low disk', { freeGB: +freeGB.toFixed(1), idValue }); return false; }
    } catch (e) { /* statfs unavailable → proceed */ }
    const id = uniqueId();
    const meta = {
      id, network, esIndex: sink.esIndex, idField: sink.idField, idValue: String(idValue),
      fieldName: fieldName || 'nas_video_url', videoUrl,
      path: null,                 // set once the bytes are secured in the upload queue (bytes-secured marker)
      attempts: 0, nextAttemptAt: Date.now(), createdAt: Date.now(),
    };
    fs.writeFileSync(path.join(PENDING_DIR, `${id}.json`), JSON.stringify(meta));
    // Kick the sweeper NOW (non-blocking) so the video downloads within ms — signed/expiring CDN URLs
    // (fbcdn etc.) are freshest right after insert. sweepVideoDownloads self-guards against overlap, and
    // the 1-min cron is the safety net for anything this wake misses.
    setImmediate(() => { sweepVideoDownloads().catch(() => {}); });
    return true;
  } catch (err) {
    log.error('enqueueVideoDownload failed', { error: err.message, network, idValue });
    return false;
  }
}

/**
 * Publish the secured video path onto the ad's ES doc (nas_video_url is ES-only — no SQL schema change).
 * Throws if the client/doc isn't available so the worker retries. The doc is located by a term query on
 * the indexed id field (fast). Crash-safety comes from THIS job being on disk (resumes on restart), not
 * from ES.
 */
async function setEsVideoUrl(meta, storedPath) {
  const databaseManager = require('../../database/DatabaseManager');
  const field = meta.fieldName || 'nas_video_url';
  const elastic = databaseManager.getElastic(meta.network);
  if (!elastic) throw new Error(`no ES client for network '${meta.network}'`);
  const found = await elastic.search({
    index: meta.esIndex,
    type: 'doc',
    body: { size: 1, query: { term: { [meta.idField]: meta.idValue } } },
  });
  const _id = firstHitId(found);
  if (!_id) throw new Error('ES doc not found yet'); // indexing may lag the insert response — retry later
  await elastic.update({
    index: meta.esIndex, type: 'doc', id: _id,
    body: { doc: { [field]: storedPath } },
  });
}

/**
 * Process one download job. Two-phase, idempotent across retries:
 *   phase A (job.path not set): download the video → storeInNas('VIDEO') (which secures the bytes in the
 *                               upload queue and returns the deterministic path) → persist job.path.
 *   phase B (job.path set):     write nas_video_url onto the ES doc.
 * Returns { done } | { retry } | throws-caught-by-caller.
 */
async function processVideoJob(f, now, counters) {
  const metaPath = path.join(PENDING_DIR, f);
  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { return; }
  if ((meta.nextAttemptAt || 0) > now) return;

  // Lazy requires avoid a load-time cycle (mediaUpload → nasClient → nasUploadQueue).
  const { downloadToTemp } = require('./mediaUpload');
  const { storeInNas } = require('./nasClient');

  try {
    // Phase A — secure the bytes (only once).
    if (!meta.path) {
      const tmp = await downloadToTemp(meta.videoUrl, 'mp4', meta.network);
      if (!tmp) throw new Error('video download failed'); // source URL dead/slow → retry while it may be valid
      // We're ALREADY in the background here, so upload INLINE (opts.background) rather than buffering every
      // video in nas-pending — that buffering is what filled the 10GB cap. On success storeInNas returns the
      // path and leaves the temp (we unlink it); only an upload FAILURE defers the bytes to nas-pending (it
      // moves the temp, so the unlink becomes a harmless no-op). Either way the returned path is real.
      let stored = null;
      try {
        stored = await storeInNas('VIDEO', tmp, meta.idValue, meta.network, `${meta.idValue}`, { background: true });
      } finally {
        try { fs.unlinkSync(tmp); } catch { /* already moved to nas-pending, or gone */ }
      }
      if (!stored) throw new Error('storeInNas returned no path'); // upload failed AND couldn't buffer → retry
      meta.path = stored;
      try { fs.writeFileSync(metaPath, JSON.stringify(meta)); } catch { /* persisted on next write */ }
    }
    // Phase B — publish the (now-secured) path onto the ES doc.
    await setEsVideoUrl(meta, meta.path);

    // Done — bytes secured and the path written to ES.
    try { fs.unlinkSync(metaPath); } catch { /* ignore */ }
    counters.ok++;
    return;
  } catch (e) {
    meta.attempts = (meta.attempts || 0) + 1;
    if (meta.attempts >= MAX_ATTEMPTS) {
      try { ensureDir(FAILED_DIR); fs.renameSync(metaPath, path.join(FAILED_DIR, f)); } catch { /* ignore */ }
      counters.gaveUp++;
      log.error('video download job gave up (moved to failed/)', { idValue: meta.idValue, network: meta.network, hasBytes: !!meta.path, attempts: meta.attempts, error: e.message });
      // Per-adId diagnostic line (grep nas-media-<date>.log): why this ad's video never stored.
      try { logger.nasMedia.warn('media not stored', { adId: String(meta.idValue), network: meta.network, type: 'VIDEO', stage: meta.path ? 'video-publish' : 'video-download', reason: e.message, attempts: meta.attempts }); } catch { /* ignore */ }
      return;
    }
    meta.nextAttemptAt = now + Math.min(BACKOFF_MAX_MS, BACKOFF_STEP_MS * meta.attempts);
    try { fs.writeFileSync(metaPath, JSON.stringify(meta)); } catch { /* ignore */ }
    counters.retry++;
    return;
  }
}

let sweeping = false;
/** Process all due video-download jobs once, bounded concurrency. Self-guards against overlap. */
async function sweepVideoDownloads() {
  if (config.insertion.nas.store?.video === false) return; // video disabled — don't process the backlog (stops the storm)
  if (sweeping) return;
  sweeping = true;
  try {
    if (!fs.existsSync(PENDING_DIR)) return;
    const metas = fs.readdirSync(PENDING_DIR).filter((f) => f.endsWith('.json'));
    if (!metas.length) return;
    const now = Date.now();
    const counters = { ok: 0, retry: 0, gaveUp: 0 };
    // Bounded concurrency — downloads are network/disk heavy; reuse the SFTP pool size as the knob.
    const CONCURRENCY = config.insertion.nas.sftpPoolSize || 5;
    let i = 0;
    const worker = async () => { while (i < metas.length) { await processVideoJob(metas[i++], now, counters); } };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, metas.length) }, worker));
    if (counters.ok || counters.gaveUp) log.info('video download sweep done', { secured: counters.ok, rescheduled: counters.retry, gaveUp: counters.gaveUp });
  } catch (err) {
    log.error('sweepVideoDownloads error', { error: err.message });
  } finally {
    sweeping = false;
  }
}

module.exports = { enqueueVideoDownload, sweepVideoDownloads, PENDING_DIR };
