'use strict';

/**
 * scrapeRequestQueue — durable, on-disk retry queue for the Google scrape-request
 * trigger fired from storeKeywordSearch (config.keywordSearch.scrapeRequestUrl).
 *
 * WHY: that POST is best-effort and already timeboxed (5s) so it never blocks the store
 * response — but on failure (the endpoint down/unreachable) the term used to just get
 * logged and silently dropped. Persisting the failed payload to disk instead means
 * nothing is lost: initScrapeRequestRetryCron (src/jobs/scrapeRequestRetryCron.js)
 * sweeps whatever's queued on a fixed interval and sends it once the endpoint is back.
 * Because the queue lives on disk (not in memory), it survives an API restart/crash —
 * same pattern as the NAS upload queue (see src/insertion/helpers/nasUploadQueue.js).
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('../../../config');
const logger = require('../../../logger');

const log = logger.createChild('scrape-request-queue');

const PENDING_DIR = path.join(process.cwd(), (config.localCache && config.localCache.dir) || 'data', 'scrape-request-pending');

const BACKOFF_STEP_MS = 60 * 1000;      // attempt N waits N*1min ...
const BACKOFF_MAX_MS = 30 * 60 * 1000;  // ... capped at 30 min
const BATCH_SIZE = 50;                  // items sent per retry POST (endpoint accepts an array)

let seq = 0;
function uniqueId() { seq = (seq + 1) % 1e6; return `${process.pid}_${Date.now()}_${seq}`; }
function ensureDir() { try { fs.mkdirSync(PENDING_DIR, { recursive: true }); } catch { /* ignore */ } }

/**
 * Persist a scrape-request item that just failed to send, for background retry.
 * @param {{name:string, max_ads:*, priority:boolean, type:number}} item — same shape
 *   already posted to scrapeRequestUrl from storeKeywordSearch.
 * @returns {boolean} true if it was durably queued.
 */
function enqueueFailedScrapeRequest(item) {
  try {
    ensureDir();
    const id = uniqueId();
    const meta = { id, item, attempts: 0, nextAttemptAt: Date.now(), createdAt: Date.now() };
    fs.writeFileSync(path.join(PENDING_DIR, `${id}.json`), JSON.stringify(meta));
    return true;
  } catch (err) {
    log.error('enqueueFailedScrapeRequest failed', { error: err.message, item });
    return false;
  }
}

let sweeping = false;
/**
 * Retry every due pending scrape-request, in batches. Self-guards against overlapping
 * sweeps (a slow/hung previous sweep just gets skipped, not stacked).
 */
async function sweepPending() {
  if (sweeping) return;
  sweeping = true;
  try {
    // Read fresh each sweep (not cached at module-load) so a config reload / URL fix
    // takes effect on the very next tick without a restart.
    const scrapeRequestUrl = config.keywordSearch.scrapeRequestUrl;
    if (!scrapeRequestUrl) return; // nowhere to send them yet — leave everything queued

    if (!fs.existsSync(PENDING_DIR)) return;
    const files = fs.readdirSync(PENDING_DIR).filter((f) => f.endsWith('.json'));
    if (!files.length) return;

    const now = Date.now();
    const due = [];
    for (const f of files) {
      const p = path.join(PENDING_DIR, f);
      let meta;
      try { meta = JSON.parse(fs.readFileSync(p, 'utf8')); }
      catch { try { fs.unlinkSync(p); } catch { /* ignore */ } continue; } // corrupt sidecar — drop it
      if ((meta.nextAttemptAt || 0) <= now) due.push({ path: p, meta });
    }
    if (!due.length) return;

    let sent = 0, failed = 0;
    for (let i = 0; i < due.length; i += BATCH_SIZE) {
      const batch = due.slice(i, i + BATCH_SIZE);
      try {
        await axios.post(scrapeRequestUrl, batch.map((b) => b.meta.item), {
          timeout: 5000,
          headers: { 'Content-Type': 'application/json' },
        });
        for (const b of batch) { try { fs.unlinkSync(b.path); } catch { /* ignore */ } }
        sent += batch.length;
      } catch (err) {
        // Whole batch failed together (endpoint still down) — back off every item in it
        // rather than splitting hairs on which one caused it.
        for (const b of batch) {
          b.meta.attempts = (b.meta.attempts || 0) + 1;
          b.meta.nextAttemptAt = now + Math.min(BACKOFF_MAX_MS, BACKOFF_STEP_MS * b.meta.attempts);
          try { fs.writeFileSync(b.path, JSON.stringify(b.meta)); } catch { /* ignore */ }
        }
        failed += batch.length;
        log.warn('scrape-request retry batch failed — left queued for next sweep', { error: err.message, batchSize: batch.length });
      }
    }
    if (sent || failed) log.info('scrape-request queue sweep done', { sent, failed, stillPending: files.length - sent });
  } catch (err) {
    log.error('sweepPending error', { error: err.message });
  } finally {
    sweeping = false;
  }
}

module.exports = { enqueueFailedScrapeRequest, sweepPending, PENDING_DIR };
