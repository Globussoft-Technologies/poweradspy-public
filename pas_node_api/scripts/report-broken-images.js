'use strict';

/**
 * Broken-image report (and gated delete) for native + linkedin ads.
 *
 * Why id-range instead of a WHERE on first_seen/last_seen: these tables run into
 * billions of rows and the date columns are NOT reliably indexed on every network
 * (confirmed missing for native/linkedin first_seen; see docs/INDEX_PROPOSAL_crawler_insights.md).
 * A raw date WHERE would force a full table scan on production. `id` is the InnoDB
 * clustered primary key — always indexed — and roughly tracks insertion order, so we
 * binary-search it for the date boundaries once, then only ever page through that
 * narrow id slice in small keyset batches. No COUNT(*), no OFFSET, no full scan.
 *
 * This only stays cheap if the JOIN back to <net>_ad_variants is index-backed —
 * that was never confirmed against live DDL, only inferred from an ERD doc. So a
 * preflight check queries information_schema live (metadata only, not a scan) and
 * REFUSES to run against an unindexed join unless you pass --force-no-index-check.
 * There is no read replica for native/linkedin — every query here lands on the
 * same primary DB serving live traffic — so this script also opens its own small
 * (3-connection) pool, retries transient errors, and adaptively shrinks its batch
 * size / backs off when queries run slow, instead of assuming the DB has headroom.
 *
 * Two-tier classification:
 *   Tier 1 (DB-only, free): image_url NULL/empty -> missing; matches the known
 *     system fallback (DefaultImage.jpg / bydefault) -> default_fallback. Neither
 *     needs a network call.
 *   Tier 2 (HTTP, only for rows with a real url): ranged GET (first 64 bytes) to
 *     check the real file signature, not just the HTTP status/content-type — a
 *     404-free 200 response can still be junk (verified live: a native .jpg URL
 *     returned 200/image/jpeg/17683B but the body was MRAID ad script, not an image).
 *
 * 100% read-only in report mode. Delete mode never re-classifies live — it only
 * ever deletes ids that came out of a report CSV you already reviewed, and only
 * after an exact --confirm phrase, via the same cascade-delete pipelines the app
 * itself uses (native/linkedin insertion/deletePipeline.js — SQL cascade + ES sync).
 *
 * Usage:
 *
 *   Step 1 — just get counts, no HTTP checks, fast:
 *     node scripts/report-broken-images.js --dry-count
 *
 *   Step 2 — full report (checks each image, writes
 *   out/broken-images-full-<from>_<to>.csv — same filename every run of the
 *   same date window, so an interrupted-then-resumed run keeps writing into
 *   ONE complete file instead of fragmenting across several):
 *     node scripts/report-broken-images.js
 *
 *   Step 3 — after reviewing that CSV, delete what you've decided on:
 *     node scripts/report-broken-images.js --delete --from-report=out/broken-images-full-2026-06-01_2026-09-01.csv --confirm="DELETE BROKEN IMAGES"
 *
 *   A run that stopped partway (Ctrl+C, crash, DB hiccup) auto-resumes on the
 *   next run — no flag needed. Use --fresh to deliberately ignore a checkpoint
 *   and rescan from the start instead.
 *
 *   Optional flags, only when you need them:
 *     --fresh                         ignore any checkpoint, rescan from the start
 *     --categories=default_fallback   delete only one/some categories (default: all broken ones)
 *     --from=2026-06-01 --to=2026-09-01   change the date window (default: Jun–Sep 2026)
 */

const fs = require('fs');
const path = require('path');
// undici — a faster HTTP client than the legacy http/https modules at this
// batch's concurrency (its connection pool is more efficient). NOT a true Node
// core built-in despite powering global fetch() internally — require('node:undici')
// throws even on Node 22. It resolves here only because it's present in
// node_modules; on a box where that's missing (e.g. an --omit=optional install),
// run `npm install undici --no-save` before using this script.
const { Agent, request } = require('undici');

const networks = require('../src/config/networks');
const databaseManager = require('../src/database/DatabaseManager');
const { resolveMediaUrl } = require('../src/insertion/helpers/nasClient');

// ─── Per-network table/column map ──────────────────────────────────────────

const NETWORK_MAP = {
  native: {
    adTable: 'native_ad',
    variantsTable: 'native_ad_variants',
    joinCol: 'native_ad_id',
    dateCol: 'first_seen',       // used only for binary-search id lookups (point queries on PK, safe)
    hasType: true,
    imageEligibleTypes: ['IMAGE', 'VIDEO'],  // TEXT-type native ads have no image by design — excluded
    deletePipeline: require('../src/services/native/insertion/deletePipeline'),
  },
  linkedin: {
    adTable: 'linkedin_ad',
    variantsTable: 'linkedin_ad_variants',
    joinCol: 'linkedin_ad_id',
    // first_seen, NOT last_seen — even though last_seen has the DB index, this
    // column is only used for the id-range binary search, which needs no index
    // at all (that's the whole point). last_seen updates every time an ad is
    // re-scraped, so it does NOT correlate with insertion order/id — an ad
    // inserted months ago (low id) can still have a recent last_seen, and the
    // id-range scan would silently miss it. first_seen is set once at insert,
    // so it tracks id the same way native's first_seen does, and it also
    // matches what "latest uploaded ads" actually means.
    dateCol: 'first_seen',
    hasType: false,
    imageEligibleTypes: null,
    deletePipeline: require('../src/services/linkedin/insertion/deletePipeline'),
  },
};

// This script is a separate OS process from the running app — connectAll() here
// opens its OWN mysql2 pool, additive on top of whatever the live app already
// holds on that DB server. Native's connection budget is already under pressure
// from real traffic, so cap this script's pool small: we only ever run ONE query
// at a time per network anyway (sequential batches), so 3 connections is plenty
// slack for retries without meaningfully adding to server-side connection load.
const SCRIPT_POOL_SIZE = 3;

function scopedNetworksConfig(networkNames) {
  const out = {};
  for (const name of networkNames) {
    const cloned = JSON.parse(JSON.stringify(networks[name]));
    if (cloned?.database?.sql) cloned.database.sql.poolSize = SCRIPT_POOL_SIZE;
    out[name] = cloned;
  }
  return out;
}

// Categories the classifier is CONFIDENT are actually broken — eligible for
// delete by default. Every row lands in exactly one of these, UNCERTAIN_CATEGORIES,
// or 'ok'.
const BROKEN_CATEGORIES = [
  'missing', 'default_fallback', 'corrupted',
  'bad_status', 'fake_200_html', 'invalid_url',
];

// Categories where we genuinely don't know — a CDN 429/503 could be a real
// throttle, a network_error could be a transient timeout/DNS blip/CDN outage
// unrelated to the image itself, and empty_or_tiny is a <600-byte HEURISTIC
// (a real, valid image could theoretically be that small) rather than proof.
// None of these default into a delete. Still selectable explicitly via
// --categories=network_error (etc) if you've reviewed those rows yourself.
const UNCERTAIN_CATEGORIES = ['rate_limited', 'network_error', 'empty_or_tiny'];

// Every category a delete run may target: the confident ones (default selection)
// plus the uncertain ones (selectable only if named explicitly).
const ALL_SELECTABLE_CATEGORIES = [...BROKEN_CATEGORIES, ...UNCERTAIN_CATEGORIES];

const PLACEHOLDER_PATTERNS = [/DefaultImage/i, /bydefault/i, /pasimage/i];
const IMAGE_SIGNATURES = [
  { name: 'JPEG', match: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { name: 'PNG', match: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { name: 'GIF', match: (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 },
  { name: 'WEBP', match: (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 },
  // Less common but real, valid raster formats — without these, a genuinely
  // fine image in one of these would fail the signature check and get
  // misclassified 'corrupted'. Only JPEG/PNG/GIF/WEBP were confirmed against
  // actual production uploads; these are added defensively, not confirmed in use.
  { name: 'BMP', match: (b) => b[0] === 0x42 && b[1] === 0x4d },
  { name: 'TIFF-LE', match: (b) => b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a && b[3] === 0x00 },
  { name: 'TIFF-BE', match: (b) => b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a },
  // AVIF/HEIC/HEIF: ISO-BMFF container — bytes 4-7 spell "ftyp", the brand at
  // 8-11 identifies the specific format (avif/avis/heic/heix/mif1/msf1/...).
  {
    name: 'ISO-BMFF',
    match: (b) => b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70
      && ['avif', 'avis', 'heic', 'heix', 'mif1', 'msf1'].includes(
        String.fromCharCode(b[8], b[9], b[10], b[11]),
      ),
  },
];
const MIN_VALID_BYTES = 600; // below this, treat as placeholder/corrupt even with a 200

// ─── CLI args ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {
    networks: ['native', 'linkedin'],
    from: '2026-06-01',
    to: '2026-09-01',        // exclusive upper bound
    batchSize: 2000,
    concurrency: 25,
    sleepMs: 150,
    maxExecMs: 5000,
    outDir: path.join(__dirname, 'out'),
    fresh: false, // true = ignore any existing checkpoint and rescan from the start
    dryCount: false,
    delete: false,
    fromReport: null,
    confirm: null,
    categories: null, // null = all broken categories (set below from CLI or default)
    forceNoIndexCheck: false,
  };
  for (const token of argv) {
    const [rawKey, rawVal] = token.replace(/^--/, '').split(/=(.*)/s);
    const key = rawKey;
    const val = rawVal;
    switch (key) {
      case 'networks': args.networks = val.split(',').map((s) => s.trim()).filter(Boolean); break;
      case 'from': args.from = val; break;
      case 'to': args.to = val; break;
      case 'batch-size': args.batchSize = Number(val); break;
      case 'concurrency': args.concurrency = Number(val); break;
      case 'sleep-ms': args.sleepMs = Number(val); break;
      case 'out-dir': args.outDir = val; break;
      case 'fresh': args.fresh = true; break;
      case 'dry-count': args.dryCount = true; break;
      case 'delete': args.delete = true; break;
      case 'from-report': args.fromReport = val; break;
      case 'confirm': args.confirm = val; break;
      case 'categories': args.categories = val.split(',').map((s) => s.trim()).filter(Boolean); break;
      case 'force-no-index-check': args.forceNoIndexCheck = true; break;
      default: break;
    }
  }
  return args;
}

// ─── small helpers ──────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function monthKey(dateVal) {
  const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
  if (Number.isNaN(d.getTime())) return 'unknown';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function isPlaceholder(url) {
  return PLACEHOLDER_PATTERNS.some((re) => re.test(url));
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const i = cursor++;
      results[i] = await worker(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

// ─── retry wrapper for transient MySQL errors ──────────────────────────────
// Native's DB is under heavy live insert/scrape traffic — lock waits, connection
// drops and our own MAX_EXECUTION_TIME guard firing are all expected, not fatal.
// Retry those with backoff; anything else (syntax error, bad column, auth) is a
// real bug and should surface immediately, not be retried into a longer hang.

const RETRYABLE_CODES = new Set([
  'ER_LOCK_WAIT_TIMEOUT', 'ER_LOCK_DEADLOCK', 'ER_QUERY_TIMEOUT', // 3024, session guard trip
  'PROTOCOL_CONNECTION_LOST', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED',
  'PROTOCOL_SEQUENCE_TIMEOUT', 'ER_CON_COUNT_ERROR', 'POOL_CLOSED',
]);

function isRetryable(err) {
  return RETRYABLE_CODES.has(err?.code) || /max_execution_time exceeded/i.test(err?.message || '');
}

async function withRetry(fn, { retries = 3, baseDelayMs = 500, label = 'query' } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === retries) throw err;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      console.warn(`[retry] ${label} failed (${err.code || err.message}), attempt ${attempt}/${retries}, backing off ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastErr;
}

// ─── adaptive throttle (per network) ───────────────────────────────────────
// Shrinks batch size / grows the inter-batch sleep automatically when queries
// are slow or erroring (native's traffic spikes unpredictably), and eases back
// toward the configured defaults after a run of clean, fast batches. Nobody
// has to babysit the script or hand-tune flags mid-run.

function makeAdaptiveState(args) {
  return {
    batchSize: args.batchSize,
    sleepMs: args.sleepMs,
    minBatchSize: Math.max(100, Math.floor(args.batchSize / 10)),
    maxBatchSize: args.batchSize,
    maxSleepMs: Math.max(args.sleepMs * 10, 5000),
    consecutiveOk: 0,
    consecutiveBad: 0,
  };
}

const SLOW_BATCH_MS = 4000; // a batch query taking this long signals contention on a busy native DB

function adaptiveOnResult(state, { errored, durationMs }) {
  const stressed = errored || durationMs > SLOW_BATCH_MS;
  if (stressed) {
    state.consecutiveBad++;
    state.consecutiveOk = 0;
    state.batchSize = Math.max(state.minBatchSize, Math.floor(state.batchSize / 2));
    state.sleepMs = Math.min(state.maxSleepMs, Math.max(state.sleepMs * 2, 500));
  } else {
    state.consecutiveOk++;
    state.consecutiveBad = 0;
    // ease back toward defaults only after a sustained calm period, not one lucky batch
    if (state.consecutiveOk >= 5) {
      state.batchSize = Math.min(state.maxBatchSize, Math.ceil(state.batchSize * 1.5));
      state.sleepMs = Math.max(Math.floor(state.sleepMs / 1.5), Math.min(150, state.maxSleepMs));
      state.consecutiveOk = 0;
    }
  }
}

// ─── HTTP adaptive concurrency (per network) ───────────────────────────────
// Independent of the SQL adaptive state above — this reacts to the CDN, not
// the DB. If any URL in a batch got rate-limited (429/503), the CDN is telling
// us to slow down: halve concurrency for the next batch. Ease back up after a
// run of clean batches, same shape as the SQL throttle.

function makeHttpState(args) {
  return {
    concurrency: args.concurrency,
    minConcurrency: Math.max(5, Math.floor(args.concurrency / 5)),
    maxConcurrency: args.concurrency,
    consecutiveClean: 0,
  };
}

function httpAdaptiveOnBatch(state, hadRateLimit) {
  if (hadRateLimit) {
    state.concurrency = Math.max(state.minConcurrency, Math.floor(state.concurrency / 2));
    state.consecutiveClean = 0;
  } else {
    state.consecutiveClean++;
    if (state.consecutiveClean >= 5) {
      state.concurrency = Math.min(state.maxConcurrency, state.concurrency + 5);
      state.consecutiveClean = 0;
    }
  }
}

// ─── preflight index check ──────────────────────────────────────────────────
// The whole id-range/keyset design only stays cheap if the JOIN back to the
// variants table is index-backed. Unlike the id-range binary search (PK only,
// always safe), this JOIN key was never confirmed against live DDL — only
// inferred as "likely FK-indexed" from an ERD doc, which is not good enough to
// bet a crores-of-rows production scan on. Verify live, cheaply (information_
// schema is metadata, not a table scan), and refuse to proceed on an unindexed
// join unless the operator explicitly overrides it.
async function checkJoinKeyIndex(sql, table, column) {
  // SEQ_IN_INDEX = 1 matters: a column that's only the 2nd+ part of some other
  // composite index still shows up in STATISTICS for that column, but MySQL
  // can't seek on it alone — the "index exists" check would give false
  // confidence while the actual JOIN still falls back to a scan.
  const rows = await sql.query(
    `SELECT INDEX_NAME FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? AND SEQ_IN_INDEX = 1 LIMIT 1`,
    [table, column],
  );
  return rows.length > 0;
}

async function preflightCheck(network, cfg, sql, args) {
  const checks = [
    { table: cfg.adTable, column: 'id' },              // PK — should always be indexed; confirms nothing is oddly broken
    { table: cfg.variantsTable, column: cfg.joinCol },  // the join key our whole batch-query cost model depends on
  ];
  const missing = [];
  for (const c of checks) {
    const indexed = await checkJoinKeyIndex(sql, c.table, c.column);
    if (!indexed) missing.push(`${c.table}.${c.column}`);
  }
  if (missing.length && !args.forceNoIndexCheck) {
    throw new Error(
      `[${network}] preflight FAILED — not indexed: ${missing.join(', ')}. ` +
      `Running the batch JOIN against this on a production table with lakhs/crores of rows ` +
      `risks a slow scan per batch, not a cheap keyset lookup. Get the index added, or if you have ` +
      `already verified this is fine, re-run with --force-no-index-check.`,
    );
  }
  if (missing.length) {
    console.warn(`[${network}] WARNING: proceeding without confirmed index on ${missing.join(', ')} (--force-no-index-check set)`);
  } else {
    console.log(`[${network}] preflight OK — join key and PK are indexed`);
  }
}

// ─── batch query with a connection-pinned timeout guard ────────────────────
// sql.query() goes through pool.execute(), which borrows ANY free connection
// per call and returns it immediately — so a `SET SESSION MAX_EXECUTION_TIME`
// on one call and the real query on the next call can land on two DIFFERENT
// physical connections. That would make the timeout guard silently a no-op.
// Pin both to the SAME connection explicitly so the guard actually protects
// the query it's meant to protect.
async function batchQueryWithGuard(sql, sqlText, params, maxExecMs, onGuardFail) {
  const conn = await sql.getConnection();
  try {
    try {
      await conn.query(`SET SESSION MAX_EXECUTION_TIME=${maxExecMs}`);
    } catch (err) {
      onGuardFail?.(err);
    }
    const [rows] = await conn.execute(sqlText, params);
    return rows;
  } finally {
    conn.release();
  }
}

// ─── checkpoint (resume support) ───────────────────────────────────────────

function checkpointPath(outDir, network) {
  return path.join(outDir, `checkpoint-${network}.json`);
}

function loadCheckpoint(outDir, network) {
  try {
    return JSON.parse(fs.readFileSync(checkpointPath(outDir, network), 'utf8'));
  } catch {
    return null;
  }
}

function saveCheckpoint(outDir, network, data) {
  fs.writeFileSync(checkpointPath(outDir, network), JSON.stringify(data));
}

// ─── id-range binary search (PK-only, never touches unindexed date columns) ─

async function pkPointAtOrAfter(sql, table, dateCol, id) {
  const rows = await withRetry(() => sql.query(
    `SELECT id, ${dateCol} AS d FROM ${table} WHERE id >= ? ORDER BY id ASC LIMIT 1`,
    [id],
  ), { label: `${table} pk-point-lookup` });
  return rows[0] || null;
}

async function findMinMaxId(sql, table) {
  const rows = await withRetry(
    () => sql.query(`SELECT MIN(id) AS minId, MAX(id) AS maxId FROM ${table}`, []),
    { label: `${table} min/max` },
  );
  return { minId: rows[0]?.minId || 0, maxId: rows[0]?.maxId || 0 };
}

// Binary search for the first id whose dateCol >= targetDate. PK range scan only.
async function findIdBoundary(sql, table, dateCol, targetDate, minId, maxId) {
  let lo = minId;
  let hi = maxId;
  const target = new Date(targetDate).getTime();
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    const row = await pkPointAtOrAfter(sql, table, dateCol, mid);
    if (!row) { hi = mid; continue; } // no row at/after mid within range — shrink
    const rowTime = new Date(row.d).getTime();
    if (rowTime < target) lo = row.id + 1;
    else hi = row.id;
  }
  return lo;
}

// ─── HTTP verification (Tier 2) ────────────────────────────────────────────

// Ceiling on parallel connections to the CDN host — kept comfortably above the
// highest --concurrency we'd realistically use, so the pool itself is never
// the bottleneck; the actual parallelism used is controlled by
// httpState.concurrency (see makeHttpState), not by this number. One shared
// Agent handles both http:// and https:// origins — undici doesn't need the
// http/https module split the old code had.
const dispatcher = new Agent({ connections: 100, keepAliveTimeout: 10_000 });

function classifyBytes(status, contentType, headBytes, contentLength) {
  if (status >= 300) return { ok: false, reason: 'bad_status', detail: `HTTP ${status}` };
  if (contentType && !/^image\//i.test(contentType)) {
    return { ok: false, reason: 'fake_200_html', detail: contentType };
  }
  const len = Number(contentLength);
  if (!Number.isNaN(len) && len > 0 && len < MIN_VALID_BYTES) {
    return { ok: false, reason: 'empty_or_tiny', detail: `${len}B` };
  }
  if (headBytes && headBytes.length >= 12) {
    const matches = IMAGE_SIGNATURES.some((sig) => sig.match(headBytes));
    if (!matches) return { ok: false, reason: 'corrupted', detail: 'signature mismatch' };
  }
  return { ok: true, reason: 'ok', detail: '' };
}

const RATE_LIMIT_STATUSES = new Set([429, 503]);
const MAX_RATE_LIMIT_RETRIES = 3;

// A single GET attempt. Resolves with either a classification result or a
// {rateLimited: true, retryAfterMs} marker so the caller can back off and
// retry — 429/503 must never fall straight into classifyBytes() as "bad_status",
// that would count a CDN throttle as a broken image.
async function attemptVerify(fullUrl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await request(fullUrl, {
      method: 'GET',
      dispatcher,
      headers: { Range: 'bytes=0-63' },
      signal: controller.signal,
    });
    const status = res.statusCode;

    if (RATE_LIMIT_STATUSES.has(status)) {
      res.body.destroy();
      const retryAfterHeader = res.headers['retry-after'];
      const retryAfterMs = retryAfterHeader && !Number.isNaN(Number(retryAfterHeader))
        ? Number(retryAfterHeader) * 1000
        : null;
      return { rateLimited: true, status, retryAfterMs };
    }

    const chunks = [];
    let total = 0;
    for await (const chunk of res.body) {
      chunks.push(chunk);
      total += chunk.length;
      if (total >= 64) { res.body.destroy(); break; }
    }
    const bytes = Buffer.concat(chunks);
    const contentType = res.headers['content-type'];
    // Range requests return 206 with the true size in content-range; a server
    // that ignores Range sends 200 with content-length = the whole file.
    const contentLength = res.headers['content-range']
      ? res.headers['content-range'].split('/')[1]
      : res.headers['content-length'];
    return classifyBytes(status === 206 ? 200 : status, contentType, bytes, contentLength);
  } catch {
    return { networkError: true };
  } finally {
    clearTimeout(timer);
  }
}

async function verifyUrl(fullUrl, timeoutMs) {
  try {
    // eslint-disable-next-line no-new -- validity check only, URL is global in Node
    new URL(fullUrl);
  } catch {
    return { ok: false, reason: 'invalid_url', detail: fullUrl };
  }

  let networkErrorRetried = false;
  let rateLimitAttempt = 0;
  let sawRateLimit = false;

  for (;;) {
    const result = await attemptVerify(fullUrl, timeoutMs);

    if (result.networkError) {
      if (!networkErrorRetried) { networkErrorRetried = true; continue; }
      return { ok: false, reason: 'network_error', detail: 'timeout/connection error after retry', sawRateLimit };
    }

    if (result.rateLimited) {
      sawRateLimit = true;
      rateLimitAttempt++;
      if (rateLimitAttempt > MAX_RATE_LIMIT_RETRIES) {
        // Genuinely inconclusive, not broken — the CDN never let us actually check.
        return { ok: false, reason: 'rate_limited', detail: `HTTP ${result.status} after ${MAX_RATE_LIMIT_RETRIES} retries`, sawRateLimit };
      }
      const backoffMs = result.retryAfterMs ?? 500 * 2 ** (rateLimitAttempt - 1);
      await sleep(backoffMs);
      continue;
    }

    return { ...result, sawRateLimit };
  }
}

// ─── CSV writer (streaming) ─────────────────────────────────────────────────

function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function openCsv(filePath, header) {
  const isNew = !fs.existsSync(filePath);
  const stream = fs.createWriteStream(filePath, { flags: 'a' });
  if (isNew) stream.write(header.join(',') + '\n');
  return stream;
}

// fs.createWriteStream().write() is async — nothing guarantees the bytes are
// actually on disk yet just because write() returned. Reading the same file
// back (readFileSync in summarizeFromCsv / runDelete) or exiting the process
// right after the last write() risks losing/missing whatever was still
// buffered. end() + waiting for 'finish' is the only way to know it's flushed.
// Idempotent — with networks now scanning in parallel and each registering its
// own SIGINT handler on the SAME shared reportCsv, a Ctrl+C can trigger this
// from two networks at once. Calling stream.end() twice is not safe (the
// second call races an already-ending stream); caching the promise makes every
// caller after the first just await the one real close.
function closeCsv(stream) {
  if (!stream.__closePromise) {
    stream.__closePromise = new Promise((resolve, reject) => {
      stream.end((err) => (err ? reject(err) : resolve()));
    });
  }
  return stream.__closePromise;
}

// write() returns false when the stream's internal buffer is over its
// highWaterMark — the OS write to disk can't keep up with how fast we're
// producing rows. Ignoring that (plain fire-and-forget write() calls) lets
// the buffer grow unbounded in memory if verification ever outpaces disk I/O.
// Awaiting 'drain' before the next write is the standard backpressure handshake.
function writeCsvRow(stream, line) {
  const ok = stream.write(line);
  if (ok) return Promise.resolve();
  return new Promise((resolve) => stream.once('drain', resolve));
}

// Proper CSV field split for one line — csvEscape() quotes any field containing
// a comma/quote/newline on write, so a naive line.split(',') on read would
// misalign columns the moment a URL, Content-Type, or error detail happens to
// contain a comma. Delete mode reads network/id straight out of this, so a
// misaligned column there means deleting the wrong ad — this has to be exact,
// not "usually fine".
function parseCsvLine(line) {
  const out = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      out.push(field);
      field = '';
    } else {
      field += c;
    }
  }
  out.push(field);
  return out;
}

// ─── main scan for one network ─────────────────────────────────────────────

async function scanNetwork(network, args, reportCsv) {
  const cfg = NETWORK_MAP[network];
  const db = databaseManager.getConnections(network);
  if (!db?.sql) {
    console.error(`[${network}] no SQL connection available — skipping`);
    return;
  }
  const sql = db.sql;
  let guardWarned = false;
  const onGuardFail = (err) => {
    // Swallowed on purpose (a missing per-query timeout shouldn't crash the run) —
    // but silent-forever would mean the one safety net for a runaway query is
    // dead and nobody knows. Warn once per network, not once per batch.
    if (!guardWarned) {
      guardWarned = true;
      console.warn(`[${network}] WARNING: could not set MAX_EXECUTION_TIME (${err.message}) — per-query timeout guard is NOT active for this run.`);
    }
  };

  await preflightCheck(network, cfg, sql, args);

  console.log(`[${network}] finding id range for ${args.from} .. ${args.to} ...`);
  const { minId, maxId } = await findMinMaxId(sql, cfg.adTable);
  if (!maxId) { console.log(`[${network}] table empty, skipping`); return; }

  const startId = await findIdBoundary(sql, cfg.adTable, cfg.dateCol, args.from, minId, maxId);
  const endId = await findIdBoundary(sql, cfg.adTable, cfg.dateCol, args.to, minId, maxId);
  console.log(`[${network}] id range approx [${startId}, ${endId}] (of ${minId}-${maxId})`);

  // % through the id-range covered so far — an approximation (ids aren't
  // perfectly uniform density because of historical deletions/gaps) but close
  // enough to drive an ETA without an expensive COUNT(*).
  const idSpan = endId - startId;
  const pctDone = (cur) => (idSpan <= 0 ? 100 : Math.min(100, Math.max(0, ((cur - startId) / idSpan) * 100)));
  function formatDuration(ms) {
    if (!Number.isFinite(ms) || ms < 0) return '?';
    const totalSec = Math.round(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  // Auto-resume: if a checkpoint from an earlier interrupted run is sitting there,
  // pick it up without being asked — losing hours of progress because someone
  // forgot to type --resume is a worse default than just continuing automatically.
  // --fresh opts out when you deliberately want to rescan from the start.
  const ckpt = args.fresh ? null : loadCheckpoint(args.outDir, network);
  if (ckpt?.lastId) {
    console.log(`[${network}] found checkpoint from ${ckpt.updatedAt} — auto-resuming at id=${ckpt.lastId} (~${pctDone(ckpt.lastId).toFixed(1)}% already done)`);
  }
  let cursor = ckpt?.lastId && ckpt.lastId >= startId ? ckpt.lastId : startId - 1;
  // cursor advances the instant a DB batch is fetched (needed so the NEXT batch
  // query starts from the right place), but that batch's HTTP verification
  // hasn't run yet at that point. lastConfirmedId only moves once a batch's
  // verification (or dry-count tally) is fully written out — an interrupt
  // (SIGINT/SIGTERM) checkpoints THIS, never the in-flight cursor, so a resume
  // can never skip rows that were fetched but not yet actually checked.
  let lastConfirmedId = cursor;
  const runStartedAt = Date.now();
  const startPct = pctDone(cursor); // this run's own starting point, so ETA isn't skewed by work done in a PRIOR run

  const fromMs = new Date(args.from).getTime();
  const toMs = new Date(args.to).getTime();
  const typeFilter = cfg.hasType ? `AND a.type IN (${cfg.imageEligibleTypes.map(() => '?').join(',')})` : '';

  let scanned = 0;
  let queuedForHttp = 0;
  const state = makeAdaptiveState(args);
  const httpState = makeHttpState(args);

  // Ctrl+C / kill on a long production run must not lose progress — flush the
  // checkpoint at lastConfirmedId (NOT cursor — see comment above), so a resume
  // never skips rows whose HTTP verification was still in flight.
  let interrupted = false;
  const onSignal = async (sig) => {
    interrupted = true;
    saveCheckpoint(args.outDir, network, { lastId: lastConfirmedId, updatedAt: new Date().toISOString(), interruptedBy: sig });
    console.log(`\n[${network}] ${sig} received — checkpoint saved at id=${lastConfirmedId}. Progress will auto-resume next run.`);
    // Flush whatever CSV rows are still buffered before the process dies —
    // otherwise the last few writes from this batch could be lost, and the
    // checkpoint already says they're done.
    try { await closeCsv(reportCsv); } catch { /* best effort on the way out */ }
    process.exit(130);
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  try {
    while (cursor < endId && !interrupted) {
      // GROUP BY a.id + ANY_VALUE(v.image_url): guarantees exactly one row per
      // ad no matter how many rows the variants table actually has for it — if
      // that table ever turns out to be 1:many (unconfirmed for native; LinkedIn
      // is confirmed 1:1 via its own PRIMARY KEY), a plain JOIN would silently
      // duplicate the ad in the report/scanned counts and in delete's input.
      // ANY_VALUE() also sidesteps ONLY_FULL_GROUP_BY regardless of session sql_mode.
      const sqlText = `
        SELECT a.id, a.${cfg.dateCol} AS dateVal, ${cfg.hasType ? 'a.type,' : ''} ANY_VALUE(v.image_url) AS image_url
        FROM ${cfg.adTable} a
        LEFT JOIN ${cfg.variantsTable} v ON v.${cfg.joinCol} = a.id
        WHERE a.id > ? AND a.id <= ?
        ${typeFilter}
        GROUP BY a.id
        ORDER BY a.id ASC
        LIMIT ?`;
      const queryParams = cfg.hasType
        ? [cursor, endId, ...cfg.imageEligibleTypes, state.batchSize]
        : [cursor, endId, state.batchSize];

      const startedAt = Date.now();
      let rows;
      let errored = false;
      try {
        rows = await withRetry(
          () => batchQueryWithGuard(sql, sqlText, queryParams, args.maxExecMs, onGuardFail),
          { label: `${network} batch @${cursor}` },
        );
      } catch (err) {
        errored = true;
        console.error(`[${network}] batch at id=${cursor} failed after retries: ${err.message}. Checkpoint is safe at last completed batch; skipping ahead is not attempted.`);
        throw err; // non-retryable or exhausted retries — surface to caller, checkpoint already reflects last good batch
      } finally {
        adaptiveOnResult(state, { errored, durationMs: Date.now() - startedAt });
      }

      if (!rows.length) break;
      cursor = rows[rows.length - 1].id;

      const toVerify = [];
      for (const row of rows) {
        const t = new Date(row.dateVal).getTime();
        if (Number.isNaN(t) || t < fromMs || t >= toMs) continue; // outside exact window (id-range was approximate)
        scanned++;
        const month = monthKey(row.dateVal);

        const url = row.image_url;
        if (!url) {
          await writeCsvRow(reportCsv, [network, row.id, '', month, 'missing', ''].map(csvEscape).join(',') + '\n');
          continue;
        }
        if (isPlaceholder(url)) {
          await writeCsvRow(reportCsv, [network, row.id, url, month, 'default_fallback', ''].map(csvEscape).join(',') + '\n');
          continue;
        }
        toVerify.push({ id: row.id, month, url: resolveMediaUrl(url) });
      }

      if (!args.dryCount && toVerify.length) {
        queuedForHttp += toVerify.length;
        let batchHadRateLimit = false;
        await mapLimit(toVerify, httpState.concurrency, async (item) => {
          const result = await verifyUrl(item.url, 6000);
          if (result.sawRateLimit) batchHadRateLimit = true;
          const status = result.ok ? 'ok' : result.reason;
          await writeCsvRow(reportCsv, [network, item.id, item.url, item.month, status, result.detail || ''].map(csvEscape).join(',') + '\n');
        });
        httpAdaptiveOnBatch(httpState, batchHadRateLimit);
      } else if (args.dryCount) {
        queuedForHttp += toVerify.length;
        // Written to CSV (not just tallied in memory) so the end-of-run summary —
        // always recomputed straight from the file, see summarizeFromCsv — has a
        // real row to count instead of losing this number across a resume.
        for (const item of toVerify) {
          await writeCsvRow(reportCsv, [network, item.id, item.url, item.month, 'would_verify', ''].map(csvEscape).join(',') + '\n');
        }
      }

      // This batch's rows are now fully accounted for (classified, verified, and
      // written to the CSV) — only now is it safe to say "resume can start after
      // this id". See the lastConfirmedId comment above for why this must NOT
      // just be `cursor`.
      lastConfirmedId = cursor;
      saveCheckpoint(args.outDir, network, { lastId: lastConfirmedId, updatedAt: new Date().toISOString() });
      if (scanned % (args.batchSize * 5) === 0) {
        const pct = pctDone(cursor);
        const elapsedMs = Date.now() - runStartedAt;
        const workedPct = pct - startPct; // progress made during THIS run only, so a resumed run's ETA isn't thrown off by the prior run's head start
        const remainingMs = workedPct > 0 ? (elapsedMs / workedPct) * (100 - pct) : NaN;
        console.log(`[${network}] ${pct.toFixed(1)}% done, ETA ~${formatDuration(remainingMs)} ` +
          `(scanned=${scanned} queuedForHttp=${queuedForHttp} cursor=${cursor}/${endId}, batchSize=${state.batchSize} sleepMs=${state.sleepMs})`);
      }
      await sleep(state.sleepMs);
    }
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
  }

  if (!interrupted) {
    try { fs.unlinkSync(checkpointPath(args.outDir, network)); } catch { /* already gone or never created */ }
  }
  const doneLabel = interrupted ? `${pctDone(lastConfirmedId).toFixed(1)}% done (stopped)` : '100% done';
  console.log(`[${network}] ${doneLabel}. scanned=${scanned} queuedForHttp=${queuedForHttp} took ${formatDuration(Date.now() - runStartedAt)}`);
}

// ─── summary tally ──────────────────────────────────────────────────────────
// Recomputed by reading the finished CSV back, NOT accumulated in memory during
// the scan. A resumed run only holds this-run's tallies in memory — printing
// those would silently under-report everything a PRIOR (interrupted) run
// already wrote. The CSV file is the one thing that's actually complete across
// however many resumes it took, so it's the only trustworthy source for totals.
function summarizeFromCsv(reportPath) {
  const raw = fs.readFileSync(reportPath, 'utf8').trim().split('\n');
  if (raw.length < 2) { console.log('\n(no rows scanned yet)'); return; }
  const header = parseCsvLine(raw[0]);
  const netIdx = header.indexOf('network');
  const monthIdx = header.indexOf('month');
  const catIdx = header.indexOf('category');

  const data = new Map(); // `${network}|${month}` -> { [category]: count }
  for (const line of raw.slice(1)) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const network = cols[netIdx];
    const month = cols[monthIdx];
    const category = cols[catIdx];
    const key = `${network}|${month}`;
    if (!data.has(key)) data.set(key, {});
    const bucket = data.get(key);
    bucket.scanned = (bucket.scanned || 0) + 1;
    bucket[category] = (bucket[category] || 0) + 1;
  }

  console.log('\n=== Summary (per network per month) ===');
  const keys = Array.from(data.keys()).sort();
  for (const key of keys) {
    const [network, month] = key.split('|');
    const bucket = data.get(key);
    const broken = BROKEN_CATEGORIES.reduce((sum, c) => sum + (bucket[c] || 0), 0);
    const uncertain = UNCERTAIN_CATEGORIES.reduce((sum, c) => sum + (bucket[c] || 0), 0);
    const pending = bucket.would_verify || 0;
    // In --dry-count, corrupted/http_error/etc are simply unknown yet (no HTTP check ran) —
    // "broken" here only ever reflects missing/default_fallback. Surface `pending` explicitly
    // so it doesn't read as "everything else must be fine".
    const pendingNote = pending ? ` pending_verification=${pending}` : '';
    const uncertainNote = uncertain ? ` uncertain(${UNCERTAIN_CATEGORIES.join('+')})=${uncertain}` : '';
    console.log(`${network} | ${month} | scanned=${bucket.scanned || 0} broken=${broken} ok=${bucket.ok || 0}${pendingNote}${uncertainNote} ` +
      `(missing=${bucket.missing || 0} default=${bucket.default_fallback || 0} corrupted=${bucket.corrupted || 0} ` +
      `bad_status=${bucket.bad_status || 0} network_error=${bucket.network_error || 0} fake_html=${bucket.fake_200_html || 0} tiny=${bucket.empty_or_tiny || 0})`);
  }
}

// ─── delete mode ─────────────────────────────────────────────────────────────

async function runDelete(args) {
  if (!args.fromReport) throw new Error('--delete requires --from-report=<path to a previously generated CSV>');

  // Which categories are eligible for delete — default is only the CONFIDENT
  // broken categories (BROKEN_CATEGORIES). rate_limited/network_error are
  // real-but-uncertain (a CDN throttle or a transient network blip doesn't
  // prove the image is broken) so they're never in the default set — only
  // selectable if you explicitly name them, having reviewed those rows yourself.
  const selected = args.categories || BROKEN_CATEGORIES;
  const unknown = selected.filter((c) => !ALL_SELECTABLE_CATEGORIES.includes(c));
  if (unknown.length) {
    throw new Error(`Unknown --categories value(s): ${unknown.join(', ')}. Valid: ${ALL_SELECTABLE_CATEGORIES.join(', ')}`);
  }
  const SELECTED = new Set(selected);

  const REQUIRED_PHRASE = 'DELETE BROKEN IMAGES';
  if (args.confirm !== REQUIRED_PHRASE) {
    console.log(`Refusing to delete. Pass --confirm="${REQUIRED_PHRASE}" (exact match) after you have reviewed ${args.fromReport}.`);
    console.log(`Categories that would be deleted: ${selected.join(', ')}`);
    return;
  }

  const raw = fs.readFileSync(args.fromReport, 'utf8').trim().split('\n');
  const header = parseCsvLine(raw[0]);
  const netIdx = header.indexOf('network');
  const idIdx = header.indexOf('id');
  const urlIdx = header.indexOf('image_url');
  const catIdx = header.indexOf('category');

  // Dedupe by (network,id): a variants table with more than one row per ad
  // would otherwise put the same ad in the CSV multiple times, and without
  // this, processDelete() gets called on it twice — the second call always
  // fails ("not present") since the first already removed it. Harmless to the
  // data, but noisy/confusing in the audit log, so dedupe before deleting.
  // Keeping the url alongside the id lets the delete loop re-verify live,
  // right before deleting — the report could be hours/days old by the time
  // you actually run --delete, and the image may have been fixed since.
  const toDelete = { native: [], linkedin: [] };
  const seen = { native: new Set(), linkedin: new Set() };
  const byCategory = {};
  for (const line of raw.slice(1)) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    const network = cols[netIdx];
    const id = cols[idIdx];
    const url = cols[urlIdx];
    const category = cols[catIdx];
    if (toDelete[network] && SELECTED.has(category) && !seen[network].has(id)) {
      seen[network].add(id);
      toDelete[network].push({ id, url, category });
      byCategory[category] = (byCategory[category] || 0) + 1;
    }
  }

  console.log(`\n=== Delete preview (categories: ${selected.join(', ')}) ===`);
  for (const network of Object.keys(toDelete)) {
    console.log(`${network}: ${toDelete[network].length} ads match (each is re-verified live right before deleting — actual deleted count may be lower if any were fixed since the report ran)`);
  }
  console.log('By category:', byCategory);

  const neededNetworks = Object.keys(toDelete).filter((n) => toDelete[n].length);
  await databaseManager.connectAll(scopedNetworksConfig(neededNetworks));

  const auditPath = path.join(args.outDir, `delete-audit-${Date.now()}.csv`);
  const auditCsv = openCsv(auditPath, ['network', 'id', 'result', 'message']);
  let reVerifiedFixed = 0;

  for (const network of neededNetworks) {
    const cfg = NETWORK_MAP[network];
    const db = databaseManager.getConnections(network);
    const log = { info() {}, warn: console.warn, error: console.error, debug() {} };
    let done = 0;
    for (const item of toDelete[network]) {
      const { id, url } = item;

      // The report can be hours or days old by the time --delete actually
      // runs — re-check live, right before deleting, instead of trusting a
      // stale row. 'missing' has no url to re-check (nothing was ever there
      // to have been fixed), so it skips straight to delete.
      if (url) {
        const fresh = await verifyUrl(url, 6000);
        if (fresh.ok) {
          reVerifiedFixed++;
          await writeCsvRow(auditCsv, [network, id, 'skipped-now-ok', 'image passed live re-verification, not deleted'].map(csvEscape).join(',') + '\n');
          done++;
          await sleep(50);
          continue;
        }
      }

      let result;
      try {
        // Transient (lock/connection) failures retry; a real rejection (already
        // gone, bad id) comes back as a normal {code:4xx} result, not a thrown
        // error, so it is NOT retried — retrying a "doesn't exist" is pointless.
        result = await withRetry(
          () => cfg.deletePipeline.processDelete({ id }, { db, log, network }),
          { retries: 3, label: `${network} delete id=${id}` },
        );
      } catch (err) {
        result = { code: 500, message: `retries exhausted: ${err.message}` };
      }
      await writeCsvRow(auditCsv, [network, id, result.code === 200 ? 'deleted' : 'failed', result.message || ''].map(csvEscape).join(',') + '\n');
      done++;
      if (done % 200 === 0) console.log(`[${network}] processed ${done}/${toDelete[network].length}`);
      await sleep(50); // small throttle between deletes — cascade delete + ES sync per ad
    }
  }
  if (reVerifiedFixed) {
    console.log(`\n${reVerifiedFixed} ad(s) passed live re-verification and were skipped (not deleted) — see the audit CSV for which ones.`);
  }
  await closeCsv(auditCsv);
  console.log(`\nDelete audit written to ${auditPath}`);
}

// ─── entry point ─────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(args.outDir, { recursive: true });

  if (args.delete) {
    await runDelete(args);
    await databaseManager.disconnectAll();
    return;
  }

  await databaseManager.connectAll(scopedNetworksConfig(args.networks));

  // Deterministic filename (mode + date window), NOT Date.now() — a resumed
  // run must write into the SAME file the interrupted run was building, or
  // the final dataset ends up split across two CSVs with neither one complete.
  const modeTag = args.dryCount ? 'drycount' : 'full';
  const reportPath = path.join(args.outDir, `broken-images-${modeTag}-${args.from}_${args.to}.csv`);

  // Only append-resume into an existing file when we're ACTUALLY resuming one
  // of the requested networks. Otherwise (first run ever, or a prior run of
  // this exact mode+window already completed successfully, or --fresh) any
  // leftover file at this deterministic path is stale — reusing it would
  // silently duplicate every row it already has. Start clean instead.
  const isResuming = !args.fresh && args.networks.some((n) => loadCheckpoint(args.outDir, n) !== null);
  if (!isResuming) {
    try { fs.unlinkSync(reportPath); } catch { /* nothing stale to remove */ }
  }

  const reportCsv = openCsv(reportPath, ['network', 'id', 'image_url', 'month', 'category', 'detail']);

  // Networks run concurrently, not one-after-another — native and linkedin are
  // separate DB servers with their own connection pools and their own CDN
  // traffic, so there's no reason to make one wait on the other. Each keeps
  // its own checkpoint file, its own id-range, its own adaptive throttle state;
  // they only share reportCsv (safe — each write() call carries one whole,
  // already-terminated line, so concurrent writers interleave rows, never
  // corrupt one) and the DB connection pool set up above (each network's pool
  // is separate within it, per scopedNetworksConfig). allSettled so one
  // network's failure doesn't cancel the other's still-running scan.
  const validNetworks = args.networks.filter((network) => {
    if (!NETWORK_MAP[network]) { console.warn(`Unknown network "${network}", skipping`); return false; }
    return true;
  });
  const results = await Promise.allSettled(
    validNetworks.map((network) => scanNetwork(network, args, reportCsv)),
  );
  const failedNetworks = [];
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      const network = validNetworks[i];
      // One network's DB having a bad day (native under heavy load, say) must not
      // abort the other's still-running scan — the checkpoint for it is intact,
      // log and move on; re-run later to pick that network back up (auto-resumes).
      failedNetworks.push(network);
      console.error(`[${network}] scan aborted: ${result.reason?.message}. Checkpoint preserved — re-running will auto-resume this network.`);
    }
  });

  await closeCsv(reportCsv); // must be flushed to disk before reading it back for the summary
  summarizeFromCsv(reportPath);
  if (failedNetworks.length) {
    console.log(`\nNetworks that stopped early (checkpoint saved, will auto-resume next run): ${failedNetworks.join(', ')}`);
  }
  console.log(`\nReport written to ${reportPath}`);
  await databaseManager.disconnectAll();
}

main().catch((err) => {
  console.error('FATAL', err);
  databaseManager.disconnectAll().finally(() => process.exit(1));
});
