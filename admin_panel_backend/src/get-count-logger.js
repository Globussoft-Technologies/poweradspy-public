'use strict';

/**
 * Audit log for the /get-count API.
 *
 * Writes one JSON line per request to:
 *   <admin_panel_backend>/logs/get-count/YYYY-MM-DD.jsonl   (one file per day)
 *
 * Each line records WHEN the API was hit, WHO hit it (best-effort: IP + headers,
 * plus an optional self-identifying `x-source` header), the PAYLOAD (request body)
 * and the generated RESPONSE. Purpose: when the admin panel and the DS daily
 * report disagree, the log shows exactly what was asked and what was returned.
 *
 * Retention: only the most recent 7 days of files are kept — older day-files are
 * deleted (once per day, lazily, on the first write of a new day).
 *
 * Env overrides:
 *   GET_COUNT_LOG_DIR              absolute dir for the .jsonl files (tests)
 *   GET_COUNT_LOG_RETENTION_DAYS   default 7
 *   GET_COUNT_LOG_DISABLED=1       turn logging off (tests)
 *
 * Logging must NEVER break the API — every fs op is wrapped and swallowed.
 */

const fs = require('fs');
const path = require('path');

const RETENTION_DAYS = Number(process.env.GET_COUNT_LOG_RETENTION_DAYS) || 7;

function logDir() {
  return process.env.GET_COUNT_LOG_DIR
    ? path.resolve(process.env.GET_COUNT_LOG_DIR)
    : path.resolve(__dirname, '..', process.env.LOG_DIR || 'logs', 'get-count');
}

const dayStr = (d) => d.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)

// Best-effort caller identity from the request.
function extractSource(req = {}) {
  const headers = req.headers || {};
  const xff = headers['x-forwarded-for'];
  const ip = (typeof xff === 'string' && xff.split(',')[0].trim())
    || req.ip
    || (req.socket && req.socket.remoteAddress)
    || null;
  return {
    ip,
    // A caller (e.g. the DS cron) can self-identify by sending this header.
    source: headers['x-source'] || headers['x-client'] || null,
    userAgent: headers['user-agent'] || null,
    origin: headers['origin'] || null,
    referer: headers['referer'] || headers['referrer'] || null,
  };
}

// Delete day-files older than the retention window. Lexical compare works on
// YYYY-MM-DD. Only touches files matching the day-file pattern.
function pruneOldLogs(dir, now = new Date()) {
  let files;
  try { files = fs.readdirSync(dir); } catch (_) { return; }
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - (RETENTION_DAYS - 1)); // keep today + (N-1) prior days
  const cutoffStr = dayStr(cutoff);
  for (const f of files) {
    const m = /^(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(f);
    if (m && m[1] < cutoffStr) {
      try { fs.unlinkSync(path.join(dir, f)); } catch (_) { /* ignore */ }
    }
  }
}

let lastPruneDay = null;

function logGetCount({ req, status, response, durationMs } = {}) {
  if (process.env.GET_COUNT_LOG_DISABLED === '1') return;
  try {
    const dir = logDir();
    fs.mkdirSync(dir, { recursive: true });

    const now = new Date();
    const today = dayStr(now);
    if (lastPruneDay !== today) { lastPruneDay = today; pruneOldLogs(dir, now); }

    const entry = {
      ts: now.toISOString(),
      ...extractSource(req),
      status: status ?? null,
      durationMs: durationMs ?? null,
      request: (req && req.body) || {},
      response: response ?? null,
    };
    fs.appendFileSync(path.join(dir, `${today}.jsonl`), JSON.stringify(entry) + '\n');
  } catch (_) {
    // never let logging break the request
  }
}

module.exports = { logGetCount, pruneOldLogs, extractSource, logDir };
