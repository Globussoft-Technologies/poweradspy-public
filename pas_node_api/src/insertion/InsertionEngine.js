'use strict';

/**
 * InsertionEngine — shared, network-agnostic runner for ad insertion.
 *
 * Every platform (Facebook, Instagram, … all 10) reuses this ONE engine.
 * A platform only supplies a `processOne(ad, ctx)` function (its own pipeline);
 * the engine handles:
 *   - single ad vs array-of-ads in a request (always synchronous — the caller
 *     gets the real per-ad result, NO background buffering),
 *   - bounded parallelism within a single multi-ad request (config.insertion.concurrency),
 *   - optional offloading of CPU-heavy work to a worker_threads pool
 *     (config.insertion.useWorkerThreads) — wired by the platform, not here.
 *
 * Design intent (see docs/insertion/MANIFEST.md):
 *   - Response in milliseconds for a single ad.
 *   - One ad failing must NOT abort the others in a batch — each ad gets its
 *     own {code, ...} result.
 */

const config = require('../config');
const logger = require('../logger');

/**
 * Run a platform pipeline over one ad or an array of ads.
 *
 * @param {Object|Object[]} payload   - a single ad object, or an array of ads.
 * @param {(ad:Object, index:number) => Promise<Object>} processOne
 *        - the platform's per-ad pipeline; returns a result object like
 *          { code, message, data? }. MUST resolve (catch its own errors) OR
 *          throw — the engine converts a throw into a 500 result for that ad.
 * @param {Object} [opts]
 * @param {number} [opts.concurrency] - override config.insertion.concurrency.
 * @returns {Promise<{ batch:boolean, result?:Object, results?:Object[], summary?:Object }>}
 *          - single ad  → { batch:false, result }
 *          - array      → { batch:true, results:[...], summary:{ total, ok, failed } }
 */
async function run(payload, processOne, opts = {}) {
  const isBatch = Array.isArray(payload);

  if (!isBatch) {
    const result = await safeProcess(processOne, payload, 0, opts);
    return { batch: false, result };
  }

  const concurrency = clampConcurrency(opts.concurrency ?? config.insertion.concurrency);
  const results = await mapWithConcurrency(payload, concurrency, (ad, index) =>
    safeProcess(processOne, ad, index, opts)
  );

  const ok = results.filter((r) => r && r.code >= 200 && r.code < 300).length;
  return {
    batch: true,
    results,
    summary: { total: results.length, ok, failed: results.length - ok },
  };
}

/**
 * Invoke the pipeline for one ad, never throwing — a thrown error becomes a
 * 500 result so a single bad ad cannot crash the request.
 *
 * When `opts.log` is supplied, every rejection/server_error is logged with the
 * ad_id and reason so ops can trace why a particular ad was not inserted.
 */
async function safeProcess(processOne, ad, index, opts = {}) {
  const network = opts.network || null;
  // Use the request-scoped child logger if provided, otherwise the shared insertion-rejection logger.
  const log = opts.log || logger.insertionRejections;
  try {
    const r = await processOne(ad, index);
    if (r.code >= 400 || r.status === 'rejected' || r.status === 'server_error') {
      const logPayload = {
        ad_id: ad?.ad_id ?? null,
        network,
        code: r.code,
        status: r.status,
        reason: r.message,
        field: r.field || null,
        errors: r.errors || null,
        hint: r.hint || null,
        error: r.error || null,
      };
      if (opts.log) log.warn('insertion ad rejected', logPayload);
      else logger.insertionRejections.info('insertion ad rejected', logPayload);
    }
    // tag each result with its position so batch callers can map failures back to input
    return { ...r, index };
  } catch (err) {
    const logPayload = {
      ad_id: ad?.ad_id ?? null,
      network,
      code: 500,
      status: 'server_error',
      reason: err.message,
      error: err.stack || null,
    };
    if (opts.log) log.warn('insertion ad server error', logPayload);
    else logger.insertionRejections.info('insertion ad server error', logPayload);
    return {
      code: 500,
      status: 'server_error',
      message: 'The ad could not be processed due to an unexpected server error.',
      hint: 'This is on our side, not your data. Retry this ad; if it keeps failing, contact support with the index/ad_id.',
      error: err.message,
      index,
    };
  }
}

/**
 * Process `items` through `worker` with at most `limit` running at once,
 * preserving input order in the output array.
 */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  async function lane() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i], i);
    }
  }

  const lanes = Array.from({ length: Math.min(limit, items.length) }, lane);
  await Promise.all(lanes);
  return results;
}

function clampConcurrency(n) {
  const v = parseInt(n, 10);
  if (!Number.isFinite(v) || v < 1) return 1;
  return Math.min(v, 64);
}

module.exports = { run, mapWithConcurrency };
