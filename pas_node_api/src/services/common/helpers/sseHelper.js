'use strict';

const INSIGHT_TIMEOUT_MS = 15000;

/**
 * SSE helper — write one event to the stream.
 */
function sendEvent(res, key, payload) {
  if (!res.writableEnded) {
    res.write(`event: ${key}\ndata: ${JSON.stringify(payload)}\n\n`);
  }
}

/**
 * Run a single fetcher with timeout. Returns the result (or timeout/error).
 * Only ONE outcome is possible — no double sends.
 */
function runFetcher(entry, fakeReq, db, logger) {
  return new Promise(resolve => {
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      logger.warn(`Insight [${entry.key}] timed out after ${INSIGHT_TIMEOUT_MS}ms`);
      resolve({ key: entry.key, code: 408, data: null, error: 'Timed out' });
    }, INSIGHT_TIMEOUT_MS);

    entry.fn(fakeReq, db, logger)
      .then(result => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ key: entry.key, ...result });
      })
      .catch(err => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        logger.warn(`Insight [${entry.key}] failed`, { error: err.message });
        resolve({ key: entry.key, code: 500, data: null, error: err.message });
      });
  });
}

/**
 * Generic SSE insight streamer.
 * Takes a registry of fetchers, params, service db/logger, and streams results.
 */
function streamInsights(req, res, registry, params, db, logger) {
  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Filter applicable fetchers
  const applicable = registry.filter(entry =>
    !entry.condition || entry.condition(params)
  );

  let completed = 0;
  const total = applicable.length;

  if (total === 0) {
    sendEvent(res, 'done', { code: 200, message: 'No insights applicable' });
    res.end();
    return;
  }

  // Safety timeout — close the stream if fetchers don't all finish
  const safetyTimer = setTimeout(() => {
    if (!res.writableEnded) {
      logger.warn(`SSE stream safety timeout reached (${INSIGHT_TIMEOUT_MS + 5000}ms), closing`);
      sendEvent(res, 'done', { code: 408, message: 'Stream timeout' });
      res.end();
    }
  }, INSIGHT_TIMEOUT_MS + 5000);

  // Fire all in parallel — each streams its event independently
  for (const entry of applicable) {
    const fakeReq = { body: entry.payload(params), query: {} };

    runFetcher(entry, fakeReq, db, logger).then(result => {
      const { key, ...payload } = result;
      sendEvent(res, key, payload);
      completed++;
      if (completed === total) {
        clearTimeout(safetyTimer);
        sendEvent(res, 'done', { code: 200, message: 'All insights complete' });
        res.end();
      }
    }).catch(err => {
      logger.warn(`SSE event send failed for [${entry.key}]`, { error: err.message });
      completed++;
      if (completed === total) {
        clearTimeout(safetyTimer);
        if (!res.writableEnded) {
          sendEvent(res, 'done', { code: 200, message: 'All insights complete' });
          res.end();
        }
      }
    });
  }

  // Cleanup on client disconnect
  req.on('close', () => {
    clearTimeout(safetyTimer);
    if (!res.writableEnded) res.end();
  });
}

module.exports = { sendEvent, runFetcher, streamInsights, INSIGHT_TIMEOUT_MS };
