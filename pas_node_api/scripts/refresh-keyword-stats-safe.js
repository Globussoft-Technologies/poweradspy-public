'use strict';

require('dotenv').config();
const databaseManager = require('../src/database/DatabaseManager');
const networksConfig = require('../src/config/networks');
const appLogger = require('../src/logger');

// Child of the app's shared Winston logger — writes to BOTH the console AND
// logs/combined-<date>.log (DailyRotateFile transport), unlike a bare
// console.log call. Previously this script logged with plain console.log,
// which meant its progress/timing never showed up in the app's log files at
// all, only in whatever terminal it happened to be run from.
const jobLogger = appLogger.createChild('keyword-stats-safe');

const NETWORK = 'google';
const JOB_NAME = 'keyword_stats_safe_refresh';
const LOCK_NAME = 'keyword_stats_safe_refresh_lock';
// Backfill never goes earlier than January of this year, even if real ads exist
// further back — hardcoded here (not a CLI flag) so it always applies with no
// argument needed. Change this constant directly to move the cutoff.
const FLOOR_YEAR = 2020;
const DEFAULT_BATCH = 500;
// No sleep between batches unless asked for (--sleep-ms=N). With the adaptive
// throttle on, it can still add a short sleep while MySQL/ES are under load, and
// drops back to 0 once they recover.
const DEFAULT_SLEEP_MS = 0;
const INSERT_CHUNK = 1000;
const RECOMPUTE_CHUNK = 500;
const SCORE_BATCH = 5000;
const SAMPLE_KEYWORDS_LIMIT = 20;
// In --loop mode, how long to wait before re-checking for newly added ads once
// everything up to the resume pointer has been processed.
const IDLE_POLL_MS = 30000;
// Optional longer pause every N batches (--pause-every / --pause-ms), on top of
// the short per-batch sleep. Off unless asked for. If only --pause-ms is given,
// it applies every DEFAULT_PAUSE_EVERY batches; if only --pause-every is given,
// it lasts DEFAULT_PAUSE_MS.
const DEFAULT_PAUSE_EVERY = 10;
const DEFAULT_PAUSE_MS = 10000;

// How often MySQL/ES load is sampled (override with --load-check-ms=N). Sampling is
// always on so the log can show load; it only CHANGES the pace when adaptive is on.
const LOAD_CHECK_INTERVAL_MS = 10000;
const DEFAULT_MIN_BATCH = 100;
// Batches are 500 ads. The adaptive throttle may still shrink a batch when
// MySQL/ES are under load, but it no longer grows one past 500 (it used to scale
// up to 5000 when resources were free). Raise with --max-batch=N if needed.
const DEFAULT_MAX_BATCH = 500;
const DEFAULT_MIN_SLEEP_MS = 0;
const DEFAULT_MAX_SLEEP_MS = 15000;
const DEFAULT_SQL_THREADS_MAX = 40;
const DEFAULT_ES_CPU_MAX = 85;
const ES_QUEUE_MAX = 50;

// ES fields pulled per ad document. `id` is the ad's own numeric id (used for
// pagination AND for the MySQL domain_id/post_owner_id lookup below) — not
// the ES internal _id. subCategory is camelCase in the index (matches the
// mapping used elsewhere in this codebase, e.g. jobs/refreshKeywordStats.js).
const ES_SOURCE_FIELDS = ['id', 'first_seen', 'last_seen', 'ad_position', 'type', 'target_keyword', 'category', 'subCategory', 'country'];

// Only ads that actually carry a target keyword are fetched. An ad without one
// contributes nothing to keyword stats (there's no keyword to attach it to), so
// filtering in ES avoids pulling those documents over the wire and avoids the
// per-ad MySQL owner/domain lookup for them. Every count the script reports —
// ads to process, ads per batch, running total — therefore means "ads with a
// target keyword".
const HAS_TARGET_KEYWORD = { exists: { field: 'target_keyword' } };

// The set of ads a query covers: those whose id falls in `idRange` (an ES range body,
// e.g. { gt: 100 } or { gte: 1, lte: 500 }) that have a target keyword.
function adsQuery(idRange) {
  return { bool: { filter: [{ range: { id: idRange } }, HAS_TARGET_KEYWORD] } };
}

// Same, but bounded by last_seen instead of id — for the month-by-month walk (a month
// is itself defined by a last_seen range). last_seen is mapped as
// date/"yyyy-MM-dd HH:mm:ss" (confirmed against the real index's mapping), and the
// range values passed in must be strings in that same format.
function adsQueryByLastSeen(lastSeenRange) {
  return { bool: { filter: [{ range: { last_seen: lastSeenRange } }, HAS_TARGET_KEYWORD] } };
}

let stopRequested = false;

function log(...args) {
  // Keeps the existing call style (log('a', 'b', 'c')) used throughout this
  // file, joined into one line for the logger — winston adds its own
  // timestamp, so we don't need to prefix one ourselves anymore.
  jobLogger.info(args.filter((a) => a !== '').join(' '));
}

function parseArgs(argv) {
  const args = {
    batch: DEFAULT_BATCH,
    sleepMs: DEFAULT_SLEEP_MS,
    pauseEvery: 0, // 0 = no periodic pause
    pauseMs: DEFAULT_PAUSE_MS,
    loadCheckMs: LOAD_CHECK_INTERVAL_MS,
    loop: false,
    maxBatches: 0,
    recomputeScores: true,
    resetState: false,
    rebuild: false,
    start: false,
    resume: false,
    revert: false,
    dryRun: false, // --dry-run: real fetch/compute against real ES+MySQL, every write rolled back — see withTransaction
    prod: false, // --prod: controls FLOOR_YEAR directly, NOT config.json/NODE_ENV — see run()
    adaptive: true,
    minBatch: DEFAULT_MIN_BATCH,
    maxBatch: DEFAULT_MAX_BATCH,
    minSleepMs: DEFAULT_MIN_SLEEP_MS,
    maxSleepMs: DEFAULT_MAX_SLEEP_MS,
    sqlThreadsMax: DEFAULT_SQL_THREADS_MAX,
    esCpuMax: DEFAULT_ES_CPU_MAX,
  };
  const given = new Set(); // which of the tunables the caller passed explicitly
  for (const raw of argv.slice(2)) {
    if (raw === '--loop') args.loop = true;
    else if (raw === '--no-score') args.recomputeScores = false;
    else if (raw === '--reset-state') args.resetState = true; // rejected in run() — see --rebuild
    else if (raw === '--rebuild') args.rebuild = true;
    else if (raw === '--start') args.start = true;
    else if (raw === '--resume') args.resume = true;
    else if (raw === '--prod') args.prod = true;
    else if (raw === '--dry-run') args.dryRun = true;
    else if (raw === '--revert') args.revert = true;
    else if (raw === '--no-adaptive') args.adaptive = false;
    else if (raw.startsWith('--batch=')) { args.batch = clampInt(raw.split('=')[1], DEFAULT_BATCH, 1, 5000); given.add('batch'); }
    else if (raw.startsWith('--sleep-ms=')) { args.sleepMs = clampInt(raw.split('=')[1], DEFAULT_SLEEP_MS, 0, 3600000); given.add('sleep'); }
    else if (raw.startsWith('--load-check-ms=')) args.loadCheckMs = clampInt(raw.split('=')[1], LOAD_CHECK_INTERVAL_MS, 200, 3600000);
    else if (raw.startsWith('--pause-every=')) { args.pauseEvery = clampInt(raw.split('=')[1], 0, 0, 1000000); given.add('pauseEvery'); }
    else if (raw.startsWith('--pause-ms=')) { args.pauseMs = clampInt(raw.split('=')[1], DEFAULT_PAUSE_MS, 0, 3600000); given.add('pauseMs'); }
    else if (raw.startsWith('--max-batches=')) args.maxBatches = clampInt(raw.split('=')[1], 0, 0, 1000000);
    else if (raw.startsWith('--min-batch=')) { args.minBatch = clampInt(raw.split('=')[1], DEFAULT_MIN_BATCH, 1, 5000); given.add('minBatch'); }
    else if (raw.startsWith('--max-batch=')) { args.maxBatch = clampInt(raw.split('=')[1], DEFAULT_MAX_BATCH, 1, 5000); given.add('maxBatch'); }
    else if (raw.startsWith('--min-sleep-ms=')) { args.minSleepMs = clampInt(raw.split('=')[1], DEFAULT_MIN_SLEEP_MS, 0, 3600000); given.add('minSleep'); }
    else if (raw.startsWith('--max-sleep-ms=')) { args.maxSleepMs = clampInt(raw.split('=')[1], DEFAULT_MAX_SLEEP_MS, 0, 3600000); given.add('maxSleep'); }
    else if (raw.startsWith('--sql-threads-max=')) args.sqlThreadsMax = clampInt(raw.split('=')[1], DEFAULT_SQL_THREADS_MAX, 1, 100000);
    else if (raw.startsWith('--es-cpu-max=')) args.esCpuMax = clampInt(raw.split('=')[1], DEFAULT_ES_CPU_MAX, 1, 100);
  }
  // An explicit --batch / --sleep-ms is a direct request, so the DEFAULT bounds
  // yield to it instead of silently overriding it: --batch=1000 lifts the default
  // 500 ceiling to 1000 (which the adaptive throttle then also treats as its
  // ceiling), --batch=50 lowers the default floor of 100. Only a bound the caller
  // also passed explicitly (--max-batch, --min-batch, ...) can override the value.
  if (given.has('batch')) {
    if (!given.has('maxBatch')) args.maxBatch = Math.max(args.maxBatch, args.batch);
    if (!given.has('minBatch')) args.minBatch = Math.min(args.minBatch, args.batch);
  }
  // --pause-ms on its own means "pause for that long every DEFAULT_PAUSE_EVERY batches".
  if (given.has('pauseMs') && !given.has('pauseEvery')) args.pauseEvery = DEFAULT_PAUSE_EVERY;
  // An explicit --sleep-ms is also the FLOOR for the adaptive throttle: it may lengthen
  // the sleep under load, but must not let it decay below what was asked for (when
  // resources are free it shrinks the sleep ~15% per check, which would otherwise
  // erode a fixed 30s/1min/10min pace back toward 0).
  if (given.has('sleep')) {
    if (!given.has('maxSleep')) args.maxSleepMs = Math.max(args.maxSleepMs, args.sleepMs);
    if (!given.has('minSleep')) args.minSleepMs = args.sleepMs;
  }
  if (args.minBatch > args.maxBatch) args.minBatch = args.maxBatch;
  if (args.minSleepMs > args.maxSleepMs) args.minSleepMs = args.maxSleepMs;
  args.batch = Math.min(Math.max(args.batch, args.minBatch), args.maxBatch);
  args.sleepMs = Math.min(Math.max(args.sleepMs, args.minSleepMs), args.maxSleepMs);
  return args;
}

function clampInt(value, fallback, min, max) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function pickNetworkConfig(slugs, sourceConfig) {
  const selected = {};
  for (const slug of slugs) {
    if (sourceConfig[slug]) selected[slug] = sourceConfig[slug];
  }
  return selected;
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sleep that ends early once a stop has been requested (Ctrl+C / SIGTERM), so a
// long pause never keeps the script alive for its whole length after a stop.
async function sleepUnlessStopped(ms) {
  const until = Date.now() + ms;
  while (!stopRequested && Date.now() < until) {
    await sleep(Math.min(250, until - Date.now()));
  }
}

function pct(part, whole) {
  if (!whole) return null;
  return Math.round((part / whole) * 10000) / 100;
}

function growthPct(ads30, adsPrior30) {
  if (!adsPrior30) return null;
  return Math.round(((ads30 - adsPrior30) / adsPrior30) * 10000) / 100;
}

function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

function trimTo(value, limit) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  return text.length > limit ? text.slice(0, limit) : text;
}

function normalizeType(value) {
  const text = trimTo(value, 64);
  return text ? text.toUpperCase() : null;
}

function normalizePosition(value) {
  return trimTo(value, 128);
}

// Increment a value's count in a Map — used to tally category/sub_category/
// country/ad_type occurrences while walking one keyword's raw keyword_ad rows.
function bump(map, key) {
  map.set(key, (map.get(key) || 0) + 1);
}

// Highest count wins; ties break on the alphabetically-smaller value.
function pickMajority(counts) {
  let best = null;
  let bestCount = -1;
  for (const [value, count] of counts) {
    if (count > bestCount || (count === bestCount && (best === null || value < best))) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

// 'YYYY-MM-DD' from a JS Date using LOCAL date parts (not .toISOString(),
// which converts to UTC and can shift the calendar date).
function ymd(date) {
  if (!date) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// mysql2 hands JSON columns back already parsed, but a string can still show
// up (older rows, other drivers) — accept either, fall back on anything else.
function parseJsonValue(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

// DATE columns come back as JS Dates (local midnight) — normalise to
// 'YYYY-MM-DD' so they compare and merge as plain strings.
function toYmd(value) {
  if (!value) return null;
  if (value instanceof Date) return ymd(value);
  return String(value).slice(0, 10);
}

function minDate(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return a < b ? a : b;
}

function maxDate(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return a > b ? a : b;
}

// Average of two percentages, weighted by how many ads each covers.
function weightedPct(oldPct, oldWeight, newPct, newWeight) {
  const o = oldPct == null ? null : Number(oldPct);
  const n = newPct == null ? null : Number(newPct);
  if (o == null) return n;
  if (n == null) return o;
  const total = oldWeight + newWeight;
  if (!total) return n;
  return Math.round(((o * oldWeight + n * newWeight) / total) * 100) / 100;
}

// Some ES documents carry system/log text in target_keyword instead of a real search
// term — e.g. a raw Elasticsearch error response or a Kibana log line, apparently
// written there by a failed upstream lookup instead of being caught and discarded.
// Not a real keyword, so it's dropped before it ever reaches keyword_ad /
// keyword_stats_unique. Heuristic, not exact — matches the actual junk seen in prod/local
// data: a JSON error envelope, a Kibana-style "[.xxx] action failed" log line, a bare
// "[object Object]" stringified value, invisible/control-character-only text, or a
// string far longer than any real search phrase.
const MAX_KEYWORD_LENGTH = 200;
const JUNK_KEYWORD_PATTERNS = [
  /^\{"error":/i, // raw ES error response, e.g. {"error":{"root_cause":[...
  /action failed with/i, // Kibana-style internal log line, e.g. [.kibana_task_manager] action failed with '...
  /^\[object object\]/i, // JS's default toString() of an object, stored by mistake
];

function isJunkKeyword(value) {
  if (value.length > MAX_KEYWORD_LENGTH) return true;
  if (JUNK_KEYWORD_PATTERNS.some((re) => re.test(value))) return true;
  // Nothing visible left after stripping control/zero-width characters (e.g. a lone ‍).
  if (!value.replace(/[\u0000-\u001f​-\u200F﻿]/g, '').trim()) return true;
  return false;
}

// target_keyword can be a single string or an array of strings on the ES
// document (e.g. ["jil sander", "puma india"]) — normalize either shape into
// a deduped array of lowercased, trimmed keyword strings, with junk (see
// isJunkKeyword) dropped. A junk entry only drops itself — an ad's other,
// real keywords are kept.
function collectKeywords(targetKeyword) {
  const arr = Array.isArray(targetKeyword) ? targetKeyword : (targetKeyword ? [targetKeyword] : []);
  return [...new Set(
    arr.map((value) => String(value || '').trim().toLowerCase()).filter((value) => value && !isJunkKeyword(value))
  )];
}

// dryRun: runs fn's queries for real (so it computes the same real numbers a live
// run would — real ES-sourced rows really get inserted into keyword_ad, really get
// merged against keyword_stats_unique, all within this transaction) but ALWAYS
// rolls back at the end instead of committing, success or not. This is the whole
// --dry-run mechanism: same code path as a real run, nothing kept. Each batch is
// its own transaction (see processOneMonthBatch), so a dry run doesn't see earlier
// dry-run batches' rows — this means the exact advertiser/domain counts it reports
// reflect only that one batch, not a true cumulative preview. Documented, not a bug:
// the alternative (one long-held transaction spanning the whole dry run) would hold
// real locks on prod rows for the run's whole duration, which is worse.
async function withTransaction(sql, fn, dryRun = false) {
  const conn = await sql.getConnection();
  const tx = {
    query: async (query, params) => {
      const [rows] = await conn.execute(query, params);
      return rows;
    },
  };
  try {
    await conn.beginTransaction();
    const result = await fn(tx);
    if (dryRun) await conn.rollback(); else await conn.commit();
    return result;
  } catch (error) {
    try { await conn.rollback(); } catch (_) {}
    throw error;
  } finally {
    conn.release();
  }
}

// keyword_ad holds every (keyword, post_owner_id, domain_id) triple ever seen, never
// emptied. INSERT IGNORE on the primary key makes re-inserting a combination a no-op,
// so a stopped-and-resumed batch can't create duplicates. COUNT(DISTINCT post_owner_id) /
// COUNT(DISTINCT domain_id) grouped by keyword then gives the EXACT advertiser/domain
// count for that keyword — see fetchExactOwnerDomainCounts and insertKeywordAdIds. 0
// stands in for "unknown" (post_owner_id/domain_id missing from google_text_ad) since a
// primary key can't use NULL; NULLIF(..., 0) excludes it from the distinct count.
// ad_id is NOT part of the key — it's one representative ad for that (keyword, owner,
// domain) combo (the first one seen; IGNORE leaves it alone once set), kept only so a
// row can be traced back to a real ad. If several ads share the same keyword/owner/
// domain, only one of their ids is kept — see insertKeywordAdIds.
async function ensureSupportTables(sql) {
  // Before this change keyword_ad was a per-batch STAGING table (id, ad_type,
  // ad_position, ... — emptied every batch). An old-style table is dropped and
  // recreated with the new permanent-ids schema; run with --rebuild afterwards
  // so the exact counts cover every ad, not just what's processed from here on.
  const [oldStyle] = await sql.query(`
    SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'keyword_ad' AND column_name = 'ad_type'
  `);
  if (Number(oldStyle?.n) > 0) {
    log('keyword_ad is the old per-batch staging table — dropping it to switch to permanent (keyword, post_owner_id, domain_id) ids. Run with --rebuild next.');
    await sql.query('DROP TABLE keyword_ad');
  }

  await sql.query(`
    CREATE TABLE IF NOT EXISTS keyword_ad (
      keyword          VARCHAR(500) NOT NULL,
      post_owner_id    INT UNSIGNED NOT NULL DEFAULT 0,
      domain_id        INT UNSIGNED NOT NULL DEFAULT 0,
      ad_id            INT UNSIGNED NULL,
      PRIMARY KEY (keyword, post_owner_id, domain_id)
    )
  `);

  // ad_id, added after the table's first release with this schema — existing
  // installs get it added (as NULL for rows inserted before this change).
  const [hasAdId] = await sql.query(`
    SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'keyword_ad' AND column_name = 'ad_id'
  `);
  if (!Number(hasAdId?.n)) {
    log('adding keyword_ad.ad_id');
    await sql.query('ALTER TABLE keyword_ad ADD COLUMN ad_id INT UNSIGNED NULL AFTER domain_id');
  }

  // keyword_stats_unique — created directly here now, with the new schema
  // (no sample_keyword_id, no FK to google_text_keywords). Previously this
  // table was expected to already exist via apply-keyword-stats-schema.js,
  // but that script's version of the schema still carries the old design
  // (sample_keyword_id + a legacy keyword_stats/google_text_keywords
  // backfill) — wrong for this pipeline now, and unusable on a fresh
  // database where those legacy tables don't exist at all.
  await sql.query(`
    CREATE TABLE IF NOT EXISTS keyword_stats_unique (
      keyword             VARCHAR(500) NOT NULL PRIMARY KEY,
      countries           JSON NULL,
      categories          JSON NULL,
      sub_categories      JSON NULL,
      ads_total           BIGINT UNSIGNED NOT NULL DEFAULT 0,
      advertisers_total   BIGINT UNSIGNED NOT NULL DEFAULT 0,
      domains_total       BIGINT UNSIGNED NOT NULL DEFAULT 0,
      ads_30d             BIGINT UNSIGNED NOT NULL DEFAULT 0,
      ads_prior_30d       BIGINT UNSIGNED NOT NULL DEFAULT 0,
      growth_pct          DECIMAL(10,2) NULL,
      competition_score   TINYINT UNSIGNED NULL,
      category            VARCHAR(191) NULL,
      sub_category        VARCHAR(191) NULL,
      top_country         VARCHAR(8) NULL,
      type_mix            JSON NULL,
      position_top_pct    DECIMAL(5,2) NULL,
      first_seen          DATE NULL,
      last_seen           DATE NULL,
      updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_ksu_ads_total (ads_total),
      INDEX idx_ksu_competition_score (competition_score),
      INDEX idx_ksu_growth_pct (growth_pct),
      INDEX idx_ksu_category (category),
      INDEX idx_ksu_last_seen (last_seen),
      INDEX idx_ksu_first_seen (first_seen)
    )
  `);

  // categories / sub_categories: every category (sub-category) seen on the keyword's ads,
  // as a JSON list like countries. category / sub_category stay as the single value the
  // Keywords Explorer API filters and displays. Older tables get the columns added.
  for (const col of ['categories', 'sub_categories']) {
    const [has] = await sql.query(`
      SELECT COUNT(*) AS n FROM information_schema.columns
       WHERE table_schema = DATABASE() AND table_name = 'keyword_stats_unique' AND column_name = ?
    `, [col]);
    if (!Number(has?.n)) {
      log(`adding keyword_stats_unique.${col}`);
      await sql.query(`ALTER TABLE keyword_stats_unique ADD COLUMN ${col} JSON NULL AFTER countries`);
    }
  }

  await sql.query(`
    CREATE TABLE IF NOT EXISTS keyword_stats_refresh_state (
      id                       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
      job_name                 VARCHAR(64) NOT NULL,
      month                    CHAR(7) NULL,
      last_google_text_ad_id   BIGINT UNSIGNED NOT NULL DEFAULT 0,
      batch_execution_ms       BIGINT UNSIGNED NULL,
      ads_processed_cycle      BIGINT UNSIGNED NOT NULL DEFAULT 0,
      total_ads_cycle          BIGINT UNSIGNED NOT NULL DEFAULT 0,
      batches_processed_cycle  BIGINT UNSIGNED NOT NULL DEFAULT 0,
      cycle_started_at         DATETIME NULL,
      cycle_completed_at       DATETIME NULL,
      last_started_at          DATETIME NULL,
      last_finished_at         DATETIME NULL,
      last_error               TEXT NULL,
      updated_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_state_job_id (job_name, id)
    )
  `);

  // This table is a per-batch HISTORY now — every batch inserts a new row — so
  // job_name can't be the primary key any more. Older installs (one row, updated
  // in place, job_name as PK) get a surrogate id; the existing row becomes id 1.
  // No-op once migrated.
  const [hasId] = await sql.query(`
    SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'keyword_stats_refresh_state' AND column_name = 'id'
  `);
  if (!Number(hasId?.n)) {
    log('migrating keyword_stats_refresh_state to one row per batch (adding an id primary key)');
    await sql.query(`
      ALTER TABLE keyword_stats_refresh_state
        DROP PRIMARY KEY,
        ADD COLUMN id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT FIRST,
        ADD PRIMARY KEY (id),
        ADD KEY idx_state_job_id (job_name, id)
    `);
  }

  // batch_execution_ms (how long each batch took) sits where resume_after_ad_id
  // used to be. Older tables get the new column added and the old one dropped;
  // both steps are no-ops once done. Nothing is lost by dropping resume_after_ad_id
  // — where the next cycle starts is worked out from the history rows now
  // (see loadState).
  const columnExists = async (name) => Number((await sql.query(`
    SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'keyword_stats_refresh_state' AND column_name = ?
  `, [name]))[0]?.n) > 0;
  if (!(await columnExists('batch_execution_ms'))) {
    log('adding keyword_stats_refresh_state.batch_execution_ms');
    await sql.query('ALTER TABLE keyword_stats_refresh_state ADD COLUMN batch_execution_ms BIGINT UNSIGNED NULL AFTER last_google_text_ad_id');
  }
  if (await columnExists('resume_after_ad_id')) {
    log('dropping keyword_stats_refresh_state.resume_after_ad_id (replaced by batch_execution_ms)');
    await sql.query('ALTER TABLE keyword_stats_refresh_state DROP COLUMN resume_after_ad_id');
  }
  // month: which last_seen month (e.g. '2026-09') this batch's ads came from — the
  // month-by-month walk's own bucket marker, alongside the existing per-batch columns.
  if (!(await columnExists('month'))) {
    log('adding keyword_stats_refresh_state.month');
    await sql.query("ALTER TABLE keyword_stats_refresh_state ADD COLUMN month CHAR(7) NULL AFTER job_name");
  }
  // resume_last_seen: the last_seen half of the month-walk's resume cursor (paired with
  // last_google_text_ad_id, the id half — last_seen alone isn't unique, see
  // fetchEsBatchByLastSeen). Stored as the exact 'yyyy-MM-dd HH:mm:ss' ES string, NOT a
  // DATETIME column — a DATETIME would round-trip through the MySQL driver's own
  // timezone handling, and a real bug already showed that mixing timezone
  // interpretations here silently corrupts the cursor (see esDateTime's comment).
  if (!(await columnExists('resume_last_seen'))) {
    log('adding keyword_stats_refresh_state.resume_last_seen');
    await sql.query('ALTER TABLE keyword_stats_refresh_state ADD COLUMN resume_last_seen CHAR(19) NULL AFTER last_google_text_ad_id');
  }

  // sample_keyword_id no longer makes sense (no google_text_keywords id to
  // reference) — drop it if it's still there from an older install. No-op if
  // already removed.
  const [col] = await sql.query(`
    SELECT COUNT(*) AS n FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = 'keyword_stats_unique' AND column_name = 'sample_keyword_id'
  `);
  if (Number(col?.n) > 0) {
    log('dropping keyword_stats_unique.sample_keyword_id (no longer used)');
    try {
      await sql.query('ALTER TABLE keyword_stats_unique DROP FOREIGN KEY fk_keyword_stats_unique_sample');
    } catch (_) { /* FK name may differ or already be gone — fine either way */ }
    await sql.query('ALTER TABLE keyword_stats_unique DROP COLUMN sample_keyword_id');
  }
}

// keyword_stats_refresh_state is a per-batch history: every batch adds a row, and
// the LATEST row (highest id) is the current state — it says where to resume.
// An empty table simply means "nothing processed yet", so it reads as all zeros
// rather than needing a placeholder row written into the history.
//
// The returned object adds `pointer`: the ad id the next batch must start after.
//   * latest row is a batch row            -> its last_google_text_ad_id
//   * latest row is a cycle's closing row  -> that row's own pointer is 0 by
//     design, so the answer is the pointer of the last batch row before it
//   * latest row is a --rebuild marker, or the table is empty -> 0
// keyword_stats_unique is cumulative, so a new cycle must begin after the last
// counted ad — starting at 0 again would count every ad a second time.
async function loadState(sql) {
  const [row] = await sql.query(
    `SELECT id, job_name, last_google_text_ad_id, batch_execution_ms, ads_processed_cycle, total_ads_cycle,
            batches_processed_cycle, cycle_started_at, cycle_completed_at,
            last_started_at, last_finished_at, last_error
       FROM keyword_stats_refresh_state
      WHERE job_name = ?
      ORDER BY id DESC
      LIMIT 1`,
    [JOB_NAME]
  );
  if (row) {
    let pointer = Number(row.last_google_text_ad_id || 0);
    if (pointer === 0 && row.cycle_completed_at) {
      const [lastBatch] = await sql.query(
        `SELECT last_google_text_ad_id AS pointer
           FROM keyword_stats_refresh_state
          WHERE job_name = ? AND id < ? AND last_google_text_ad_id > 0
          ORDER BY id DESC
          LIMIT 1`,
        [JOB_NAME, row.id]
      );
      pointer = Number(lastBatch?.pointer || 0);
    }
    return { ...row, pointer };
  }
  return {
    id: null,
    job_name: JOB_NAME,
    pointer: 0,
    last_google_text_ad_id: 0,
    batch_execution_ms: null,
    ads_processed_cycle: 0,
    total_ads_cycle: 0,
    batches_processed_cycle: 0,
    cycle_started_at: null,
    cycle_completed_at: null,
    last_started_at: null,
    last_finished_at: null,
    last_error: null,
  };
}

// Adds a new history row and returns its id. Column names come from this file,
// never from input.
async function insertStateRow(exec, fields = {}) {
  const row = { job_name: JOB_NAME, ...fields };
  const cols = Object.keys(row);
  const res = await exec.query(
    `INSERT INTO keyword_stats_refresh_state (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    cols.map((col) => row[col])
  );
  return res?.insertId;
}

// Amends the newest row in place — used only to record an error against the
// batch that was in flight, not to write progress.
async function updateLatestState(exec, fields) {
  const entries = Object.entries(fields);
  if (!entries.length) return;
  const res = await exec.query(
    `UPDATE keyword_stats_refresh_state
        SET ${entries.map(([key]) => `${key} = ?`).join(', ')}
      WHERE id = (SELECT id FROM (SELECT MAX(id) AS id FROM keyword_stats_refresh_state WHERE job_name = ?) latest)`,
    [...entries.map(([, value]) => value), JOB_NAME]
  );
  // Empty history (a failure before the first batch): nothing to amend, so
  // record the error as a row of its own instead of losing it.
  if (!Number(res?.affectedRows)) await insertStateRow(exec, fields);
}

// --rebuild: a fresh all-zero row on top of the history (the history itself is
// kept). Being the newest row, it's what the next run reads: start from ad 0.
// Skipped when there's nothing to rewind — an empty history, or one already
// sitting at 0 — so a rebuild of a fresh table doesn't start with a pointless
// all-zero row.
async function resetState(sql) {
  const current = await loadState(sql);
  if (startPointer(current) === 0 && Number(current.total_ads_cycle || 0) === 0) return;
  await insertStateRow(sql, {});
}

// Read the count out of an ES count() response across client major versions.
function readEsCount(res) {
  if (res == null) return 0;
  if (typeof res.count === 'number') return res.count;
  if (typeof res.body?.count === 'number') return res.body.count;
  return 0;
}

function readEsHits(res) {
  const hits = res?.hits || res?.body?.hits;
  return hits?.hits || [];
}

// Where the next batch starts: the ad id it must begin AFTER. The row's own
// last_google_text_ad_id goes back to 0 when a cycle finishes, so this is the
// `pointer` that loadState works out from the history — see the note there.
function startPointer(state) {
  return Number(state?.pointer || 0);
}

// Starts a cycle, or resumes one that was interrupted, and reports how many ads
// are still ahead of the pointer (0 = nothing new to do). It writes nothing:
// the cycle's start time and running total live in memory and are copied onto
// every batch row as the batches are written.
//   startedAt   stamped each time the script begins work
//   totalAds    running sum of ads processed in this cycle (500, 1000, ...);
//               starts again from 0 for each new cycle, carries on when a
//               cycle is resumed after an interruption
//   minId       lowest ad id ahead of the pointer — where the first fetch starts, so
//               it doesn't have to walk empty id space (ids rarely start at 0)
//   maxId       highest ad id ahead of the pointer right now — where the fetch
//               stops (ads that arrive later are picked up by the next cycle)
async function beginCycle(elastic, index, state) {
  const pointer = startPointer(state);
  const ahead = adsQuery({ gt: pointer });
  const remaining = readEsCount(await elastic.count({ index, body: { query: ahead } }));
  log(`ES count index=${index} pointer=${pointer} remaining=${remaining} body=${JSON.stringify({ query: ahead })}`);
  if (remaining === 0) return { remaining: 0, cycle: null };

  // One aggregation per cycle (not per batch), so its cost — proportional to the
  // ads ahead — is paid once. It returns the lowest AND highest id in a single pass.
  const idRes = await elastic.search({
    index,
    body: { size: 0, query: ahead, aggs: { min_id: { min: { field: 'id' } }, max_id: { max: { field: 'id' } } } },
  });
  log(`ES min/max id index=${index} took=${idRes.took ?? idRes.body?.took}ms min_id=${(idRes.aggregations || idRes.body?.aggregations)?.min_id?.value} max_id=${(idRes.aggregations || idRes.body?.aggregations)?.max_id?.value} body=${JSON.stringify({ size: 0, query: ahead, aggs: { min_id: { min: { field: 'id' } }, max_id: { max: { field: 'id' } } } })}`);
  const aggs = idRes?.aggregations || idRes?.body?.aggregations;
  const maxId = Number(aggs?.max_id?.value) || 0;
  const minId = Math.max(Number(aggs?.min_id?.value) || 0, pointer + 1);
  if (maxId <= pointer) return { remaining: 0, cycle: null };

  // Interrupted = pointer left mid-way and the cycle never completed.
  const resuming = Number(state.last_google_text_ad_id || 0) > 0 && !state.cycle_completed_at;
  return {
    remaining,
    cycle: { startedAt: new Date(), totalAds: resuming ? Number(state.total_ads_cycle || 0) : 0, minId, maxId },
  };
}

// ── Month-walk state (replaces the id-walk's beginCycle/loadState for run()) ──────
//
// Same per-batch HISTORY table (keyword_stats_refresh_state), same "latest row wins,
// a cycle_completed_at row closes it out" pattern as the id-walk — just grouped by
// `month` instead of being one single history. Each month gets its own resumable
// cursor (last_google_text_ad_id + resume_last_seen) and its own closing row.
//
// The one thing that's genuinely different from the id-walk: the CURRENT calendar
// month is never closed out. Its last_seen keeps moving (new ads, and old ads that
// get updated — last_seen always jumps to "now", never backward — see the
// target_keyword-on-update finding earlier), so it's treated as a permanently
// unfinished, ever-growing bucket: every run tries it first, and a "nothing new
// right now" result just means come back later, not that it's done. Only a month
// that is NOT the current one gets a closing row, and once closed it's never
// revisited — safe, because a closed month can't change (see monthHistorySummary).

// Latest row for one specific month (job_name + month), or "not started" if none.
async function monthHistorySummary(sql, month) {
  const [row] = await sql.query(
    `SELECT last_google_text_ad_id, resume_last_seen, total_ads_cycle, cycle_completed_at
       FROM keyword_stats_refresh_state
      WHERE job_name = ? AND month = ?
      ORDER BY id DESC
      LIMIT 1`,
    [JOB_NAME, month]
  );
  if (!row) return { started: false, completed: false, cursor: { lastSeen: null, id: -1 }, totalAds: 0 };
  return {
    started: true,
    completed: !!row.cycle_completed_at,
    cursor: { lastSeen: row.resume_last_seen || null, id: row.resume_last_seen ? Number(row.last_google_text_ad_id || 0) : -1 },
    totalAds: Number(row.total_ads_cycle || 0),
  };
}

// The oldest month that has EVER been touched (started), excluding the current one —
// with whether it's finished. Backfill always works on the oldest untouched-or-
// unfinished historical month, walking further back only once that one is done — so
// this single query is enough to know exactly where backfill is.
async function oldestTouchedHistoricalMonth(sql, currentMonth) {
  const [row] = await sql.query(
    `SELECT month, MAX(cycle_completed_at IS NOT NULL) AS done
       FROM keyword_stats_refresh_state
      WHERE job_name = ? AND month IS NOT NULL AND month <> ?
      GROUP BY month
      ORDER BY month ASC
      LIMIT 1`,
    [JOB_NAME, currentMonth]
  );
  return row ? { month: row.month, done: !!row.done } : null;
}

// The earliest/latest month with ads that have a target keyword — from MySQL, not ES.
// google_text_ad.last_seen is kept in sync with the SAME value written to ES's
// last_seen on every insert/update (see metaAdsPipeline.js's updateEsDoc).
//
// Single table, no join to google_text_ad_variants: the first version joined to it and
// checked v.target_keyword, which forced a full scan of that (large, and — at prod
// scale — unindexed for this filter) table. google_text_ad.default_variant_id is set
// exactly when an ad has a real keyword variant, and it's indexed — checked against
// real local data: every ad with a real target_keyword has default_variant_id set (0
// missed), with only 3 ads (out of 69,325) going the other way, negligible. Using it
// instead means this query only ever touches google_text_ad itself.
//
// YEAR()/MONTH() are computed BY MYSQL on the raw stored value, deliberately not
// fetched as a DATETIME and converted in JS — mysql2 converts a DATETIME column to a
// JS Date assuming it's LOCAL time, which silently shifted a real value by 5.5 hours
// in testing (IST). Since last_seen has no timezone and both MySQL and ES store/treat
// it as the literal wall-clock value (see esDateTime's comment), letting MySQL do the
// year/month extraction on its own raw value sidesteps that conversion entirely.
const KEYWORD_AD_MONTH_RANGE_SQL = `
  SELECT MIN(last_seen) AS min_val, MAX(last_seen) AS max_val,
         DATE_FORMAT(MIN(last_seen), '%Y-%m') AS min_month,
         DATE_FORMAT(MAX(last_seen), '%Y-%m') AS max_month
    FROM google_text_ad
   WHERE default_variant_id IS NOT NULL
`;

// Cached by the caller for the life of a run — the floor backfill stops at, so it
// doesn't walk into empty months forever once real history is exhausted.
async function floorMonth(sql) {
  const [row] = await sql.query(KEYWORD_AD_MONTH_RANGE_SQL);
  return row?.min_val ? row.min_month : null; // no ads with a target keyword at all
}

// The month of the MOST RECENT last_seen among ads with a target keyword — "current"
// means wherever the data actually is, not wall-clock "today". Using new Date()
// instead would break the moment the data lags behind real time (a paused crawler, or
// — the case that surfaced this — local/test data with old timestamps): it would look
// for a month with zero ads, report "nothing new" every time, and never start
// backfill at all. On a live system this naturally tracks real time anyway, since an
// ad update always sets last_seen to the real current moment (see the target_keyword
// update finding earlier) — so the self-cleaning "closed months can't change"
// property still holds; this is just the more robust way to find "now".
// Re-queried on every call (NOT cached like floorMonth) since new data can push it
// forward while the script keeps running.
async function latestDataMonth(sql) {
  const [row] = await sql.query(KEYWORD_AD_MONTH_RANGE_SQL);
  return row?.max_val ? row.max_month : null;
}

// Which month this run should work on next: current month first (always — it's
// never "done"); once it has nothing new, resume/continue the oldest unfinished
// historical month; once that's finished, step one month further back; once
// backfill reaches `floor`, there's nothing left to backfill and it's current
// month's turn again.
//
// `currentIsKnownEmpty`: pass true when the caller JUST checked current and found
// 0 ads waiting (via beginMonthCycle) — this is what starts backfill in the first
// place. Without it, a month never gets its first historical row (nothing has ever
// been "touched" yet), so oldestTouchedHistoricalMonth keeps coming back empty and
// this function would keep returning `current` forever, even after it's fully
// drained — a real bug caught in testing: the walk stopped dead after finishing
// 2026-02 instead of continuing to 2025-10, 2025-09, ..., down to 2022-09.
// backfillExhausted is only ever true on the ONE path where there's genuinely
// nothing left to do anywhere — the run loop uses it, and only it, to decide
// whether to actually stop/idle (see run()). Every other "nothing right now"
// result (current just found empty, a historical month just finished) means
// "immediately go pick again," not "stop."
//
// `floorOverride` ('yyyy-MM', e.g. '2020-01' — see the FLOOR_YEAR constant): an
// explicit stopping point that wins over the real floor whenever it's the MORE
// RECENT of the two — i.e. backfill never goes further back than this, even if real
// ads exist earlier. Comparing two 'yyyy-MM' strings this way works directly (no
// Date needed): lexicographic order on that fixed-width format IS chronological order.
async function pickWorkingMonth(sql, floorCache, currentIsKnownEmpty = false, floorOverride = null) {
  const current = (await latestDataMonth(sql)) || monthKeyUTC(new Date());
  if (floorCache.value === undefined) floorCache.value = await floorMonth(sql);
  const effectiveFloor = floorOverride && (floorCache.value === null || floorOverride > floorCache.value)
    ? floorOverride
    : floorCache.value;

  const touched = await oldestTouchedHistoricalMonth(sql, current);
  if (!touched) {
    if (currentIsKnownEmpty) {
      const next = shiftMonthKey(current, -1);
      // The very first backfill step is already past the floor — nothing to do.
      if (effectiveFloor !== null && next < effectiveFloor) return { month: current, isCurrent: true, backfillExhausted: true };
      return { month: next, isCurrent: false, backfillExhausted: false }; // kick off backfill
    }
    return { month: current, isCurrent: true, backfillExhausted: false }; // nothing historical started yet
  }
  if (!touched.done) return { month: touched.month, isCurrent: false, backfillExhausted: false }; // resume it
  if (effectiveFloor === null || touched.month <= effectiveFloor) {
    return { month: current, isCurrent: true, backfillExhausted: true }; // backfill complete — nothing older exists (or before the floor override)
  }
  return { month: shiftMonthKey(touched.month, -1), isCurrent: false, backfillExhausted: false }; // step further back
}

// Starts (or resumes) work on one month. Like beginCycle, but bounded to the
// month's own [start, end) instead of the whole dataset ahead of a pointer.
async function beginMonthCycle(sql, elastic, index, month) {
  const monthState = await monthHistorySummary(sql, month);
  const { start, end } = monthBoundsUTC(month);
  // A finished month's closing row resets its cursor to null/0 (same pattern as the
  // id-walk's closing rows — see finalizeMonthCycle), which is NOT "start from the
  // beginning of the month again": it's "nothing left, ever." Checked explicitly —
  // caught a real bug in testing where this fell through to a fresh gte:start count.
  if (monthState.completed) {
    return { remaining: 0, cursor: monthState.cursor, cycle: { startedAt: new Date(), totalAds: monthState.totalAds, start, end } };
  }
  const afterStr = monthState.cursor.lastSeen || start;
  const remaining = readEsCount(await elastic.count({ index, body: { query: adsQueryByLastSeen({ gte: afterStr, lt: end }) } }));
  log(`ES count index=${index} month=${month} after=${afterStr} remaining=${remaining}`);
  return {
    remaining,
    cursor: monthState.cursor,
    cycle: { startedAt: new Date(), totalAds: monthState.totalAds, start, end },
  };
}

// Guard against the one easy way to corrupt cumulative counts: starting from
// ad 0 while keyword_stats_unique already holds numbers. That happens on the
// first run after upgrading from the old recompute-from-ledger version (whose
// state row sits at 0 after a completed cycle), or if someone zeroes the state
// row by hand. Every ad would then be added on top of totals that already
// include it.
async function assertSafeToAccumulate(sql) {
  const state = await loadState(sql);
  if (startPointer(state) !== 0) return;
  const [row] = await sql.query('SELECT 1 AS present FROM keyword_stats_unique LIMIT 1');
  if (row) {
    throw new Error(
      'keyword_stats_unique already has rows but the resume pointer is at 0, so starting now would add every ad ' +
      'on top of counts that already include it. Re-run with --rebuild to truncate keyword_stats_unique and ' +
      'start clean from ad 0.'
    );
  }
}

async function acquireLock(sql) {
  const [row] = await sql.query('SELECT GET_LOCK(?, 0) AS locked', [LOCK_NAME]);
  return Number(row?.locked) === 1;
}

async function releaseLock(sql) {
  try { await sql.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]); } catch (_) {}
}

// One batch of ad documents from ES, walking forward by `id` with search_after.
//
// The query covers the cycle's ads — target keyword present, id up to the highest id seen
// when the cycle started (cycle.maxId) — sorted by id ascending. Every batch passes
// `search_after: [id]`: the first batch uses minId - 1 (just below the lowest ad id), and
// later batches (or a resumed cycle) use the last ad id already processed, so ES returns
// the next `batchSize` ads after it. `id` is unique, so it is a safe sort tiebreaker on its
// own. Unlike from/size there is no 10,000-result limit.
//
// Note (ES 6.x): every search still has to count and walk the ads that match the
// query, so the cost per batch can grow with the number of ads still ahead. Watch the
// `took` value in the "ES query" log line as the sweep goes deeper.
//
// The batch's resume pointer is simply the last doc's id.
async function fetchEsBatch(elastic, index, lastId, batchSize, cycle) {
  const body = {
    size: batchSize,
    query: adsQuery({ lte: cycle.maxId }),
    sort: [{ id: 'asc' }],
    _source: ES_SOURCE_FIELDS,
    // The first batch starts just below min_id (the lowest ad id); every later batch
    // starts after the last id already processed.
    search_after: [Math.max(lastId, (cycle.minId || 1) - 1)],
  };
  const res = await elastic.search({ index, body });
  log(`ES query index=${index} lastId=${lastId} batchSize=${batchSize} took=${res.took ?? res.body?.took}ms hits=${readEsHits(res).length} body=${JSON.stringify(body)}`);
  return readEsHits(res).map((h) => h._source || {});
}

// 'yyyy-MM-dd HH:mm:ss' matching last_seen's ES mapping format (confirmed via the
// index's own mapping: date, format "yyyy-MM-dd HH:mm:ss"). UTC, not local time — ES
// parses a date string with no explicit offset as UTC, and using local getters here
// caused a real bug: on this machine (IST, UTC+5:30) the window boundaries and the
// epoch values ES actually sorts by drifted apart by 5.5 hours, silently breaking the
// cursor (confirmed against a live index: a boundary built with local getters produced
// a DIFFERENT epoch number than the one ES returned for the exact same stored value).
function esDateTime(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${p(date.getUTCMonth() + 1)}-${p(date.getUTCDate())} ${p(date.getUTCHours())}:${p(date.getUTCMinutes())}:${p(date.getUTCSeconds())}`;
}

// Inverse of esDateTime. Deliberately NOT Date.parse(s) — Date.parse on this
// non-ISO "yyyy-MM-dd HH:mm:ss" shape is locale/engine-dependent and, per the bug
// above, does not reliably match ES's own UTC interpretation of the same string.
function parseEsDateTime(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`Not a "yyyy-MM-dd HH:mm:ss" ES datetime: ${s}`);
  const [, y, mo, d, h, mi, se] = m;
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
}

// ── Month bucketing (the last_seen-based walk) ────────────────────────────────
// A "month" is a calendar month in UTC, identified as 'yyyy-MM' (e.g. '2026-09').
// It's a real boundary in last_seen terms: monthBoundsUTC gives its [start, end)
// as ES datetime strings, end being the exclusive start of the next month.

function monthKeyUTC(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthBoundsUTC(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return {
    start: esDateTime(new Date(Date.UTC(y, m - 1, 1, 0, 0, 0))),
    end: esDateTime(new Date(Date.UTC(y, m, 1, 0, 0, 0))),
  };
}

function shiftMonthKey(monthKey, delta) {
  const [y, m] = monthKey.split('-').map(Number);
  return monthKeyUTC(new Date(Date.UTC(y, m - 1 + delta, 1)));
}

// One batch of ad documents from ES, bounded to the WHOLE month — `last_seen` between
// `window.start` and `window.end` (the month's own [start, end), see monthBoundsUTC) —
// sorted by last_seen then id, paged with search_after. Fixed bounds, not a
// density-sized sub-window: simpler, at the cost of every batch in a very dense month
// having to count that month's full match set each time (traded off deliberately —
// see the conversation this replaced the narrower-window version in).
//
// last_seen is NOT unique (many ads can share an exact timestamp, e.g. one crawl batch),
// so `id` is carried as the sort/search_after tiebreaker — verified against a local ES
// index with many docs sharing one last_seen: every doc came back exactly once, in order,
// with plain ascending (last_seen, id) search_after.
//
// `cursor` is { lastSeen: 'yyyy-MM-dd HH:mm:ss' | null, id }: null lastSeen means "start
// at window.start". `window` is { start, end }: the month's own bounds (end is the
// month's exclusive end, or "now" for the current month).
async function fetchEsBatchByLastSeen(elastic, index, cursor, batchSize, window) {
  const cursorMs = cursor.lastSeen ? parseEsDateTime(cursor.lastSeen) : parseEsDateTime(window.start);
  const cursorId = cursor.lastSeen ? cursor.id : -1; // -1: no doc excluded yet at the exact start second
  const body = {
    size: batchSize,
    query: adsQueryByLastSeen({ gte: window.start, lte: window.end }),
    sort: [{ last_seen: 'asc' }, { id: 'asc' }],
    _source: ES_SOURCE_FIELDS,
    // search_after on a `date` field must be the epoch-millis value ES itself sorts on
    // (confirmed against a live index — the formatted string is rejected with "Failed
    // to parse search_after value"), unlike the range filter above, which does accept
    // the formatted string.
    search_after: [cursorMs, cursorId],
  };
  const res = await elastic.search({ index, body });
  log(`ES query index=${index} lastSeen=${cursor.lastSeen} id=${cursor.id} batchSize=${batchSize} took=${res.took ?? res.body?.took}ms hits=${readEsHits(res).length} body=${JSON.stringify(body)}`);
  return readEsHits(res).map((h) => h._source || {});
}

// Bounded, indexed lookup against google_text_ad for just this batch's ad
// ids — the only MySQL read in the whole per-batch flow. domain_id/
// post_owner_id are kept from MySQL (not ES's text-based equivalents)
// because raw text can represent the same real domain/advertiser multiple
// ways; the MySQL id is the canonical, deduplicated identity.
async function fetchAdOwnerAndDomain(sql, adIds) {
  const map = new Map();
  if (!adIds.length) return map;
  for (const ids of chunk(adIds, INSERT_CHUNK)) {
    const placeholders = ids.map(() => '?').join(', ');
    const rows = await sql.query(
      `SELECT id, post_owner_id, domain_id FROM google_text_ad WHERE id IN (${placeholders})`,
      ids
    );
    for (const row of rows) {
      map.set(Number(row.id), {
        post_owner_id: row.post_owner_id != null ? Number(row.post_owner_id) : null,
        domain_id: row.domain_id != null ? Number(row.domain_id) : null,
      });
    }
  }
  return map;
}

// Adds this batch's (keyword, post_owner_id, domain_id) ids into the permanent
// keyword_ad table, carrying one ad_id along with each (the first ad seen for that
// combo, in this batch — IGNORE then leaves it as-is if an earlier batch got there
// first, so the very first ad ever seen for a combo is the one kept overall).
// Deduped in JS first (a batch commonly repeats the same advertiser/domain across
// many rows) to keep the INSERT small; IGNORE then covers the rest — an id
// combination already stored is silently skipped. Never emptied: see ensureSupportTables.
async function insertKeywordAdIds(exec, rows) {
  if (!rows.length) return;
  const seen = new Set();
  const unique = [];
  for (const row of rows) {
    const postOwnerId = row.post_owner_id ?? 0;
    const domainId = row.domain_id ?? 0;
    const key = `${row.keyword}\u0000${postOwnerId}\u0000${domainId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push([row.keyword, postOwnerId, domainId, row.google_text_ad_id ?? null]);
  }
  for (const part of chunk(unique, INSERT_CHUNK)) {
    const placeholders = part.map(() => '(?, ?, ?, ?)').join(', ');
    const params = part.flat();
    await exec.query(`INSERT IGNORE INTO keyword_ad (keyword, post_owner_id, domain_id, ad_id) VALUES ${placeholders}`, params);
  }
}

// EXACT advertiser/domain counts for these keywords, from every id ever stored
// for them in keyword_ad — not just this batch. NULLIF(..., 0) drops the
// "unknown owner/domain" placeholder before counting.
async function fetchExactOwnerDomainCounts(exec, keywords) {
  const map = new Map();
  for (const part of chunk(keywords, RECOMPUTE_CHUNK)) {
    const placeholders = part.map(() => '?').join(', ');
    const rows = await exec.query(
      `SELECT keyword,
              COUNT(DISTINCT NULLIF(post_owner_id, 0)) AS advertisers_total,
              COUNT(DISTINCT NULLIF(domain_id, 0)) AS domains_total
         FROM keyword_ad
        WHERE keyword IN (${placeholders})
        GROUP BY keyword`,
      part
    );
    for (const row of rows) {
      map.set(row.keyword, { advertisers_total: Number(row.advertisers_total) || 0, domains_total: Number(row.domains_total) || 0 });
    }
  }
  return map;
}

// Per-keyword numbers for THIS BATCH's rows (passed straight in — nothing is
// staged in MySQL for this any more). Pure function — takes the batch's ad
// rows, returns one stats object per keyword — so it can be tested without a
// database.
function aggregateBatchStats(rows, now = new Date()) {
  const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const d60 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);

  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.keyword)) grouped.set(row.keyword, []);
    grouped.get(row.keyword).push(row);
  }

  const out = [];
  for (const [keyword, groupRows] of grouped) {
    let adsTotal = 0;
    let ads30 = 0;
    let adsPrior30 = 0;
    const advertiserSet = new Set();
    const domainSet = new Set();
    let minFirstSeen = null;
    let maxLastSeen = null;
    const categoryCounts = new Map();
    const subCategoryCounts = new Map();
    const countryCounts = new Map();
    const countrySet = new Set();
    const categorySet = new Set();
    const subCategorySet = new Set();
    const typeCounts = new Map();
    let positionTotal = 0;
    let positionTop = 0;

    for (const row of groupRows) {
      adsTotal++;
      if (row.post_owner_id != null) advertiserSet.add(row.post_owner_id);
      if (row.domain_id != null) domainSet.add(row.domain_id);

      const lastSeen = row.last_seen ? new Date(row.last_seen) : null;
      const firstSeen = row.first_seen ? new Date(row.first_seen) : null;
      if (lastSeen) {
        if (lastSeen.getTime() >= d30.getTime()) ads30++;
        else if (lastSeen.getTime() >= d60.getTime()) adsPrior30++;
        if (!maxLastSeen || lastSeen > maxLastSeen) maxLastSeen = lastSeen;
      }
      if (firstSeen && (!minFirstSeen || firstSeen < minFirstSeen)) minFirstSeen = firstSeen;

      const category = trimTo(row.category, 191);
      if (category) { bump(categoryCounts, category); categorySet.add(category); }
      const subCategory = trimTo(row.sub_category, 191);
      if (subCategory) { bump(subCategoryCounts, subCategory); subCategorySet.add(subCategory); }
      const country = trimTo(row.country, 191);
      if (country) { bump(countryCounts, country); countrySet.add(country); }
      const adType = row.ad_type ? String(row.ad_type).trim().toUpperCase() : null;
      if (adType) bump(typeCounts, adType);
      const adPosition = trimTo(row.ad_position, 128);
      if (adPosition) {
        positionTotal++;
        if (adPosition.toLowerCase().includes('top')) positionTop++;
      }
    }

    out.push({
      keyword,
      countries: [...countrySet],
      categories: [...categorySet],
      sub_categories: [...subCategorySet],
      ads_total: adsTotal,
      advertisers_total: advertiserSet.size,
      domains_total: domainSet.size,
      ads_30d: ads30,
      ads_prior_30d: adsPrior30,
      growth_pct: growthPct(ads30, adsPrior30),
      category: pickMajority(categoryCounts),
      sub_category: pickMajority(subCategoryCounts),
      top_country: trimTo(pickMajority(countryCounts), 8),
      type_mix: Object.fromEntries(typeCounts),
      position_top_pct: pct(positionTop, positionTotal),
      first_seen: ymd(minFirstSeen),
      last_seen: ymd(maxLastSeen),
    });
  }
  return out;
}

// Fold one batch's numbers into what keyword_stats_unique already holds for
// that keyword. The table is CUMULATIVE — there is no per-ad ledger to
// recompute from — so each field is summed, min/max'd, or, where it can't be
// combined exactly, approximated:
//
//   exact        ads_total, ads_30d, ads_prior_30d (sums) · first_seen (min) ·
//                last_seen (max) · type_mix (per-key sums) · countries (union) ·
//                growth_pct (recomputed from the summed windows) ·
//                advertisers_total / domains_total — summed here as a fallback,
//                but applyBatchToKeywordStats immediately overwrites both with
//                an EXACT COUNT(DISTINCT ...) from keyword_ad (see
//                fetchExactOwnerDomainCounts), so what actually lands in the
//                table is exact, not a per-batch sum.
//   approximate  ads_30d / ads_prior_30d — each batch is measured against
//                "now" at the moment it ran, so earlier batches' windows
//                don't slide forward with time.
//                category / sub_category / top_country — the first non-null
//                value sticks; a per-batch majority can't be merged without
//                the underlying counts.
//                position_top_pct — average weighted by ads_total.
function mergeKeywordStats(existing, batch) {
  if (!existing) return batch; // first time we've seen this keyword: the batch IS the total
  const num = (v) => Number(v) || 0;

  const adsTotal = num(existing.ads_total) + num(batch.ads_total);
  const ads30 = num(existing.ads_30d) + num(batch.ads_30d);
  const adsPrior30 = num(existing.ads_prior_30d) + num(batch.ads_prior_30d);

  const existingCountries = parseJsonValue(existing.countries, []);
  const existingCategories = parseJsonValue(existing.categories, []);
  const existingSubCategories = parseJsonValue(existing.sub_categories, []);
  const typeMix = { ...parseJsonValue(existing.type_mix, {}) };
  for (const [type, count] of Object.entries(batch.type_mix || {})) {
    typeMix[type] = num(typeMix[type]) + num(count);
  }

  return {
    keyword: batch.keyword,
    countries: [...new Set([...(Array.isArray(existingCountries) ? existingCountries : []), ...(batch.countries || [])])],
    categories: [...new Set([...(Array.isArray(existingCategories) ? existingCategories : []), ...(batch.categories || [])])],
    sub_categories: [...new Set([...(Array.isArray(existingSubCategories) ? existingSubCategories : []), ...(batch.sub_categories || [])])],
    ads_total: adsTotal,
    advertisers_total: num(existing.advertisers_total) + num(batch.advertisers_total),
    domains_total: num(existing.domains_total) + num(batch.domains_total),
    ads_30d: ads30,
    ads_prior_30d: adsPrior30,
    growth_pct: growthPct(ads30, adsPrior30),
    category: existing.category ?? batch.category ?? null,
    sub_category: existing.sub_category ?? batch.sub_category ?? null,
    top_country: existing.top_country ?? batch.top_country ?? null,
    type_mix: typeMix,
    position_top_pct: weightedPct(existing.position_top_pct, num(existing.ads_total), batch.position_top_pct, num(batch.ads_total)),
    first_seen: minDate(toYmd(existing.first_seen), batch.first_seen),
    last_seen: maxDate(toYmd(existing.last_seen), batch.last_seen),
  };
}

// What keyword_stats_unique currently holds for these keywords (PK lookups,
// bounded by the batch). Keyed lowercase: the column's collation is
// case-insensitive, so a stored "Jeans" must still match our "jeans".
async function fetchExistingKeywordStats(exec, keywords) {
  const map = new Map();
  for (const part of chunk(keywords, RECOMPUTE_CHUNK)) {
    const placeholders = part.map(() => '?').join(', ');
    const rows = await exec.query(
      `SELECT keyword, countries, categories, sub_categories, ads_total, advertisers_total, domains_total, ads_30d, ads_prior_30d,
              category, sub_category, top_country, type_mix, position_top_pct, first_seen, last_seen
         FROM keyword_stats_unique
        WHERE keyword IN (${placeholders})`,
      part
    );
    for (const row of rows) map.set(String(row.keyword).toLowerCase(), row);
  }
  return map;
}

function toDbRow(stats) {
  return {
    ...stats,
    countries: JSON.stringify(stats.countries || []),
    categories: JSON.stringify(stats.categories || []),
    sub_categories: JSON.stringify(stats.sub_categories || []),
    type_mix: JSON.stringify(stats.type_mix || {}),
  };
}

// Writes the MERGED totals (already existing + batch), so a plain overwrite
// is right here — the addition happened in mergeKeywordStats().
async function upsertKeywordStats(exec, rows) {
  if (!rows.length) return 0;
  const cols = [
    'keyword', 'countries', 'categories', 'sub_categories', 'ads_total', 'advertisers_total', 'domains_total',
    'ads_30d', 'ads_prior_30d', 'growth_pct', 'category', 'sub_category',
    'top_country', 'type_mix', 'position_top_pct', 'first_seen', 'last_seen',
  ];
  for (const part of chunk(rows, INSERT_CHUNK)) {
    const placeholders = part.map(() => `(${cols.map(() => '?').join(', ')}, NOW())`).join(', ');
    const params = [];
    for (const row of part) for (const col of cols) params.push(row[col] ?? null);
    const updateSql = cols.filter((c) => c !== 'keyword').map((c) => `${c} = VALUES(${c})`).join(', ');
    await exec.query(
      `INSERT INTO keyword_stats_unique (${cols.join(', ')}, updated_at)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE ${updateSql}, updated_at = VALUES(updated_at)`,
      params
    );
  }
  return rows.length;
}

// This batch's rows -> this batch's per-keyword numbers -> added onto the
// existing keyword_stats_unique rows -> written back. Assumes insertKeywordAdIds
// has already run in this same transaction, so fetchExactOwnerDomainCounts sees
// this batch's ids too.
async function applyBatchToKeywordStats(exec, rows) {
  const batchStats = aggregateBatchStats(rows);
  if (!batchStats.length) return { upserted: 0, upsertedUnique: 0, sampleKeywords: [] };

  const keywords = batchStats.map((s) => s.keyword);
  const existing = await fetchExistingKeywordStats(exec, keywords);
  const exactCounts = await fetchExactOwnerDomainCounts(exec, keywords);
  const merged = batchStats.map((s) => {
    const stats = mergeKeywordStats(existing.get(s.keyword), s);
    const exact = exactCounts.get(s.keyword);
    if (exact) { stats.advertisers_total = exact.advertisers_total; stats.domains_total = exact.domains_total; }
    return stats;
  });
  const upsertedUnique = await upsertKeywordStats(exec, merged.map(toDbRow));
  return {
    upserted: merged.length,
    upsertedUnique,
    sampleKeywords: merged.slice(0, SAMPLE_KEYWORDS_LIMIT).map((s) => s.keyword),
  };
}

async function recomputeCompetitionScoresSql(sql) {
  const [countRow] = await sql.query('SELECT COUNT(*) AS c FROM keyword_stats_unique');
  const totalRows = Number(countRow.c || 0);
  if (!totalRows) return 0;
  await sql.query(`
    UPDATE keyword_stats_unique ks
    JOIN (
      SELECT keyword,
             CASE
               WHEN total_rows = 1 THEN 100
               ELSE ROUND(((row_num - 1) / (total_rows - 1)) * 100)
             END AS score
        FROM (
          SELECT keyword,
                 ROW_NUMBER() OVER (ORDER BY advertisers_total ASC, keyword ASC) AS row_num,
                 COUNT(*) OVER () AS total_rows
            FROM keyword_stats_unique
        ) ranked
    ) scores ON scores.keyword = ks.keyword
    SET ks.competition_score = scores.score
  `);
  return totalRows;
}

async function recomputeCompetitionScoresJs(sql) {
  const [countRow] = await sql.query('SELECT COUNT(*) AS c FROM keyword_stats_unique');
  const totalRows = Number(countRow.c || 0);
  if (!totalRows) return 0;
  let processed = 0;
  let lastAdvertisersTotal = null;
  let lastKeyword = null;
  while (processed < totalRows) {
    const rows = await sql.query(
      lastAdvertisersTotal === null
        ? `SELECT keyword, advertisers_total
             FROM keyword_stats_unique
            ORDER BY advertisers_total ASC, keyword ASC
            LIMIT ${SCORE_BATCH}`
        : `SELECT keyword, advertisers_total
             FROM keyword_stats_unique
            WHERE (advertisers_total > ?)
               OR (advertisers_total = ? AND keyword > ?)
            ORDER BY advertisers_total ASC, keyword ASC
            LIMIT ${SCORE_BATCH}`,
      lastAdvertisersTotal === null ? [] : [lastAdvertisersTotal, lastAdvertisersTotal, lastKeyword]
    );
    if (!rows.length) break;
    const byScore = new Map();
    rows.forEach((row, index) => {
      const absoluteIndex = processed + index;
      const score = totalRows === 1 ? 100 : Math.round((absoluteIndex / (totalRows - 1)) * 100);
      if (!byScore.has(score)) byScore.set(score, []);
      byScore.get(score).push(row.keyword);
    });
    for (const [score, keywords] of byScore.entries()) {
      const placeholders = keywords.map(() => '?').join(', ');
      await sql.query(`UPDATE keyword_stats_unique SET competition_score = ? WHERE keyword IN (${placeholders})`, [score, ...keywords]);
    }
    processed += rows.length;
    const lastRow = rows[rows.length - 1];
    lastAdvertisersTotal = Number(lastRow.advertisers_total || 0);
    lastKeyword = lastRow.keyword;
  }
  return totalRows;
}

async function recomputeCompetitionScores(sql) {
  try {
    return await recomputeCompetitionScoresSql(sql);
  } catch (error) {
    log(`competition_score SQL path failed: ${error.message}. Falling back to chunked mode.`);
    return recomputeCompetitionScoresJs(sql);
  }
}

// One reading of MySQL load. These are SERVER-wide counters (every client, not just
// this script), which is what you want when asking "is MySQL busy?":
//   threadsRunning    statements executing right now — the main "how busy" signal
//   threadsConnected  open connections
//   questions         running total of statements run; two readings give queries/sec
async function checkSqlLoad(sql) {
  try {
    const rows = await sql.query(`SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_running', 'Threads_connected', 'Questions')`);
    const v = Object.fromEntries(rows.map((r) => [r.Variable_name, Number(r.Value)]));
    const threadsRunning = v.Threads_running || 0;
    const pool = sql.pool?.pool;
    return {
      ok: true,
      threadsRunning,
      threadsConnected: v.Threads_connected || 0,
      questions: v.Questions || 0,
      at: Date.now(),
      poolPending: pool?._connectionQueue?.length || 0,
      poolFree: pool?._freeConnections?.length || 0,
      poolTotal: pool?._allConnections?.length || 0,
    };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function checkEsLoad(es) {
  if (!es || !es.client) return { ok: false, error: 'ES client unavailable' };
  try {
    const [healthResp, nodesResp] = await Promise.all([
      es.client.cluster.health(),
      es.client.nodes.stats({ metric: ['os', 'thread_pool'] }),
    ]);
    const health = healthResp.body || healthResp;
    const nodesStats = nodesResp.body || nodesResp;
    let maxCpu = 0;
    let maxQueue = 0;
    let totalRejected = 0;
    for (const node of Object.values(nodesStats.nodes || {})) {
      const cpu = node.os?.cpu?.percent;
      if (Number.isFinite(cpu)) maxCpu = Math.max(maxCpu, cpu);
      const pools = node.thread_pool || {};
      for (const poolName of ['write', 'bulk', 'search']) {
        const tp = pools[poolName];
        if (!tp) continue;
        if (Number.isFinite(tp.queue)) maxQueue = Math.max(maxQueue, tp.queue);
        if (Number.isFinite(tp.rejected)) totalRejected += tp.rejected;
      }
    }
    return { ok: true, status: health.status, maxCpu, maxQueue, totalRejected };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function decideAdaptive(current, sqlLoad, esLoad, args) {
  const reasons = [];
  let scaleDown = false;
  let holdSteady = false;

  // ES is now the primary read source, so its signals get first say; MySQL
  // load still matters (the domain/owner lookup + all writes), just weighted
  // second rather than first — reversed from the old MySQL-sourced version.
  if (!esLoad.ok) {
    holdSteady = true;
    reasons.push(`es check failed (${esLoad.error})`);
  } else {
    if (esLoad.status === 'red') { scaleDown = true; reasons.push('es cluster RED'); }
    else if (esLoad.status === 'yellow') { holdSteady = true; reasons.push('es cluster YELLOW'); }
    if (esLoad.rejectedDelta > 0) { scaleDown = true; reasons.push(`es thread pool new rejections=${esLoad.rejectedDelta} since last check`); }
    if (esLoad.maxQueue > ES_QUEUE_MAX) { scaleDown = true; reasons.push(`es queue=${esLoad.maxQueue}`); }
    if (esLoad.maxCpu >= args.esCpuMax) { scaleDown = true; reasons.push(`es cpu=${esLoad.maxCpu}%>=${args.esCpuMax}%`); }
    else if (esLoad.maxCpu >= args.esCpuMax * 0.8) { holdSteady = true; reasons.push(`es cpu=${esLoad.maxCpu}% nearing limit`); }
  }

  if (!sqlLoad.ok) {
    holdSteady = true;
    reasons.push(`sql check failed (${sqlLoad.error})`);
  } else {
    if (sqlLoad.poolPending > 0) { scaleDown = true; reasons.push(`sql pool queueing (pending=${sqlLoad.poolPending})`); }
    if (sqlLoad.threadsRunning >= args.sqlThreadsMax) { scaleDown = true; reasons.push(`mysql threads_running=${sqlLoad.threadsRunning}>=${args.sqlThreadsMax}`); }
    else if (sqlLoad.threadsRunning >= args.sqlThreadsMax * 0.7) { holdSteady = true; reasons.push(`mysql threads_running=${sqlLoad.threadsRunning} nearing limit`); }
  }

  let batch = current.batch;
  let sleepMs = current.sleepMs;

  if (scaleDown) {
    batch = Math.max(args.minBatch, Math.floor(current.batch * 0.5));
    sleepMs = Math.min(args.maxSleepMs, Math.max(args.minSleepMs, current.sleepMs > 0 ? current.sleepMs * 2 : 500));
  } else if (!holdSteady) {
    batch = Math.min(args.maxBatch, Math.ceil(current.batch * 1.2) + 50);
    sleepMs = Math.max(args.minSleepMs, Math.floor(current.sleepMs * 0.85));
    if (!reasons.length) reasons.push('resources free');
  } else if (!reasons.length) {
    reasons.push('holding steady');
  }

  return { batch, sleepMs, reasons };
}

// Progress for THIS run, tracked in memory: the state table's counters now hold
// per-batch / running-sum values, so they can't be used to derive a percentage.
function batchProgress(processed, remainingAtStart, startedAtMs) {
  const progress = remainingAtStart > 0 ? Math.min(100, (processed / remainingAtStart) * 100) : 100;
  const elapsedMs = Math.max(0, Date.now() - startedAtMs);
  const etaMs = processed > 0 && remainingAtStart > processed ? Math.round((elapsedMs / processed) * (remainingAtStart - processed)) : 0;
  const rate = elapsedMs > 0 ? (processed / (elapsedMs / 1000)) : 0;
  return { progress, etaMs, elapsedMs, rate };
}

async function processOneBatch(sql, elastic, index, state, batchSize, cycle) {
  const batchStartedAt = new Date();
  const lastId = startPointer(state);
  const docs = await fetchEsBatch(elastic, index, lastId, batchSize, cycle);
  if (!docs.length) {
    return { completedCycle: true, batchRows: 0, adsWithKeywords: 0, touchedKeywords: 0, upserted: 0, upsertedUnique: 0, sampleKeywords: [] };
  }

  const adIds = docs.map((doc) => Number(doc.id)).filter(Number.isFinite);
  const ownerDomainMap = await fetchAdOwnerAndDomain(sql, adIds);

  const insertRows = [];
  let adsWithKeywords = 0; // ads that actually carried a usable target keyword
  for (const doc of docs) {
    const adId = Number(doc.id);
    const od = ownerDomainMap.get(adId) || {};
    const keywords = collectKeywords(doc.target_keyword);
    if (keywords.length) adsWithKeywords++;
    for (const keyword of keywords) {
      insertRows.push({
        keyword,
        google_text_ad_id: adId,
        post_owner_id: od.post_owner_id ?? null,
        domain_id: od.domain_id ?? null,
        ad_type: normalizeType(doc.type),
        ad_position: normalizePosition(doc.ad_position),
        first_seen: doc.first_seen || null,
        last_seen: doc.last_seen || null,
        country: trimTo(doc.country, 191),
        category: trimTo(doc.category, 191),
        sub_category: trimTo(doc.subCategory, 191),
      });
    }
  }

  const lastDocId = Number(docs[docs.length - 1].id);

  const result = await withTransaction(sql, async (tx) => {
    // Everything below commits or rolls back together: the keyword_ad ids, the
    // keyword_stats_unique increments, and the resume pointer. A failed batch
    // therefore leaves NO partial counts behind, and retrying it can't double-add
    // (insertKeywordAdIds is IGNORE, so re-inserting an id already stored is a no-op).
    //
    // insertKeywordAdIds runs first so applyBatchToKeywordStats' exact-count lookup
    // (fetchExactOwnerDomainCounts) sees this batch's ids too, not just earlier ones.
    await insertKeywordAdIds(tx, insertRows);
    const statsResult = await applyBatchToKeywordStats(tx, insertRows);

    // One NEW row per batch in keyword_stats_refresh_state:
    //   ads_processed_cycle      ads in THIS batch (e.g. 500)
    //   total_ads_cycle          running sum for the cycle: previous total + this batch (500, 1000, ...)
    //   batches_processed_cycle  ads in THIS batch that had a target keyword
    //   last_google_text_ad_id   last ad id counted
    //   batch_execution_ms       how long the batch took — filled in just after commit (below)
    // Written inside the same transaction as the counts, so a batch's row exists
    // only if its counts were committed.
    const stateRowId = await insertStateRow(tx, {
      last_google_text_ad_id: lastDocId,
      ads_processed_cycle: docs.length,
      total_ads_cycle: cycle.totalAds + docs.length,
      batches_processed_cycle: adsWithKeywords,
      cycle_started_at: cycle.startedAt,
      cycle_completed_at: null,
      last_started_at: batchStartedAt,
      last_finished_at: new Date(),
    });

    return {
      batchRows: docs.length,
      adsWithKeywords,
      touchedKeywords: statsResult.upserted,
      upserted: statsResult.upserted,
      upsertedUnique: statsResult.upsertedUnique,
      sampleKeywords: statsResult.sampleKeywords,
      lastId: lastDocId,
      stateRowId,
    };
  });

  // Wall-clock time for the whole batch — ES fetch, MySQL owner/domain lookup and
  // the transaction including its commit. It can only be known once the commit is
  // done, so it's written to the row afterwards (the same number goes in the log).
  // If the process dies between the commit and this write, the column stays NULL
  // for that one row; the counts themselves are already safely committed.
  const executionMs = Date.now() - batchStartedAt.getTime();
  await sql.query('UPDATE keyword_stats_refresh_state SET batch_execution_ms = ? WHERE id = ?', [executionMs, result.stateRowId]);

  return { completedCycle: false, ...result, executionMs };
}

// Same shape and same underlying pipeline (insertKeywordAdIds, applyBatchToKeywordStats)
// as processOneBatch — the only difference is where the docs come from (last_seen-bounded,
// via fetchEsBatchByLastSeen) and what gets written as the resume cursor (both
// last_google_text_ad_id AND resume_last_seen, since last_seen alone isn't unique).
async function processOneMonthBatch(sql, elastic, index, month, cursor, batchSize, monthCycle, dryRun = false) {
  const batchStartedAt = new Date();
  const docs = await fetchEsBatchByLastSeen(elastic, index, cursor, batchSize, monthCycle);
  if (!docs.length) {
    return { completedCycle: true, batchRows: 0, adsWithKeywords: 0, touchedKeywords: 0, upserted: 0, upsertedUnique: 0, sampleKeywords: [] };
  }

  const adIds = docs.map((doc) => Number(doc.id)).filter(Number.isFinite);
  const ownerDomainMap = await fetchAdOwnerAndDomain(sql, adIds);

  const insertRows = [];
  let adsWithKeywords = 0;
  for (const doc of docs) {
    const adId = Number(doc.id);
    const od = ownerDomainMap.get(adId) || {};
    const keywords = collectKeywords(doc.target_keyword);
    if (keywords.length) adsWithKeywords++;
    for (const keyword of keywords) {
      insertRows.push({
        keyword,
        google_text_ad_id: adId,
        post_owner_id: od.post_owner_id ?? null,
        domain_id: od.domain_id ?? null,
        ad_type: normalizeType(doc.type),
        ad_position: normalizePosition(doc.ad_position),
        first_seen: doc.first_seen || null,
        last_seen: doc.last_seen || null,
        country: trimTo(doc.country, 191),
        category: trimTo(doc.category, 191),
        sub_category: trimTo(doc.subCategory, 191),
      });
    }
  }

  const lastDoc = docs[docs.length - 1];
  const lastDocId = Number(lastDoc.id);
  const lastDocLastSeen = String(lastDoc.last_seen);

  const result = await withTransaction(sql, async (tx) => {
    await insertKeywordAdIds(tx, insertRows);
    const statsResult = await applyBatchToKeywordStats(tx, insertRows);

    const stateRowId = await insertStateRow(tx, {
      month,
      last_google_text_ad_id: lastDocId,
      resume_last_seen: lastDocLastSeen,
      ads_processed_cycle: docs.length,
      total_ads_cycle: monthCycle.totalAds + docs.length,
      batches_processed_cycle: adsWithKeywords,
      cycle_started_at: monthCycle.startedAt,
      cycle_completed_at: null,
      last_started_at: batchStartedAt,
      last_finished_at: new Date(),
    });

    return {
      batchRows: docs.length,
      adsWithKeywords,
      touchedKeywords: statsResult.upserted,
      upserted: statsResult.upserted,
      upsertedUnique: statsResult.upsertedUnique,
      sampleKeywords: statsResult.sampleKeywords,
      lastId: lastDocId,
      lastSeen: lastDocLastSeen,
      stateRowId,
    };
  }, dryRun);

  const executionMs = Date.now() - batchStartedAt.getTime();
  // In dry-run, result.stateRowId's row was rolled back along with everything else in
  // the transaction — MySQL's auto-increment counter itself doesn't roll back (InnoDB
  // never reuses it, to avoid gap-related contention), so the id is real but the row
  // it would point to no longer exists. Writing batch_execution_ms to it would just be
  // a wasted query against nothing, so it's skipped here, not attempted and ignored.
  if (!dryRun) {
    await sql.query('UPDATE keyword_stats_refresh_state SET batch_execution_ms = ? WHERE id = ?', [executionMs, result.stateRowId]);
  }

  return { completedCycle: false, ...result, executionMs };
}

// Closes out a historical (non-current) month once it's fully drained. NEVER called
// for the current month — see the note above pickWorkingMonth for why.
// ALWAYS writes a closing row, even for a month with 0 ads (unlike finalizeCycle's
// "nothing to close" guard for the id-walk) — a genuinely empty month still needs a
// row, or oldestTouchedHistoricalMonth can never see it as "touched," and backfill
// would retry that same empty month forever instead of stepping past it. Real data
// hit this: 2026-01, 2025-12 and 2025-11 have zero ads with a target keyword between
// the real current month (2026-02) and the next real one (2025-10).
async function finalizeMonthCycle(sql, month, monthCycle) {
  await insertStateRow(sql, {
    month,
    last_google_text_ad_id: 0,
    resume_last_seen: null,
    ads_processed_cycle: 0,
    total_ads_cycle: monthCycle.totalAds,
    batches_processed_cycle: 0,
    cycle_started_at: monthCycle.startedAt,
    cycle_completed_at: new Date(),
    last_finished_at: new Date(),
  });
  return { totalMs: Math.max(0, Date.now() - monthCycle.startedAt.getTime()) };
}

async function finalizeCycle(sql, recomputeScores, cycle) {
  // All ads processed: add a closing row. The in-cycle pointer and per-batch
  // counters are 0 in it; total_ads_cycle carries the finished cycle's final sum.
  // Where the next cycle starts is taken from the last batch row before this one
  // (see loadState) — that's what stops it starting at ad 0 and counting
  // everything a second time.
  //
  // A cycle that processed no batches has nothing to close, and a closing row
  // with no batch rows before it would leave loadState unable to find where the
  // ads ended — so none is written.
  if (cycle.totalAds > 0) {
    await insertStateRow(sql, {
      last_google_text_ad_id: 0,
      ads_processed_cycle: 0,
      total_ads_cycle: cycle.totalAds,
      batches_processed_cycle: 0,
      cycle_started_at: cycle.startedAt,
      cycle_completed_at: new Date(),
      last_finished_at: new Date(),
    });
  }
  let scored = 0;
  if (recomputeScores) scored = await recomputeCompetitionScores(sql);
  const totalMs = Math.max(0, Date.now() - cycle.startedAt.getTime());
  return { scored, totalMs };
}

async function run(args = {}) {
  // Checked before connecting to anything. --reset-state used to just rewind the
  // pointer, which was harmless when stats were recomputed from a ledger. Now
  // they're cumulative, so rewinding without clearing them double-counts.
  if (args.resetState) {
    throw new Error('--reset-state has been replaced by --rebuild. Counts in keyword_stats_unique are now cumulative, so rewinding the pointer alone would count every ad twice; --rebuild truncates keyword_stats_unique AND rewinds the pointer.');
  }
  const modeCount = [args.start, args.resume, args.revert].filter(Boolean).length;
  if (modeCount > 1) {
    throw new Error('--start, --resume and --revert are mutually exclusive — pass at most one.');
  }
  // --dry-run only makes sense alongside a normal (resume-like) run — --start/--revert
  // are already "nothing real is kept until you choose to run for real" in spirit, but
  // their TRUNCATEs are real, immediate DDL with no transaction to roll back (see
  // ensureSupportTables/run()'s revert branch), so combining them with --dry-run would
  // be misleading: the truncation still happens for real even though "dry run" is set.
  if (args.dryRun && (args.start || args.revert)) {
    throw new Error('--dry-run cannot be combined with --start or --revert — both truncate tables for real, immediately, with no rollback. Use --dry-run on its own (or with --resume) instead.');
  }

  const cliNetworks = pickNetworkConfig([NETWORK], networksConfig);
  await databaseManager.connectAll(cliNetworks);
  const sql = databaseManager.getSQL(NETWORK);
  if (!sql) throw new Error('google SQL connection unavailable');
  const es = databaseManager.getElastic(NETWORK);
  if (!es) throw new Error('google Elasticsearch connection unavailable — this script now reads ads from ES');
  // Index name comes from config (networks.google.elastic.index, via GOOG_ELASTIC_INDEX/
  // config.json — see src/config/networks.js), same as every other controller that reads
  // this index (e.g. built-withController.js's `db.elastic?.indexName || GOOGLE_ES_INDEX`).
  // No script-specific override.

  const index = es.indexName || 'google_ads_data';
  // const index = 'google_ads_data';

  if (!await acquireLock(sql)) {
    log('another refresh is already running; exiting safely.');
    return;
  }

  try {
    await ensureSupportTables(sql);

    // --revert: wipe every table this script writes to, then stop — does NOT go on
    // to process any ads. This is the "undo everything, back to a clean slate" mode:
    // useful for clearing out a test run (like the prod sample loaded earlier this
    // conversation) before a real run starts. TRUNCATE, not DELETE, since there's no
    // transaction spanning all three to keep atomic here — this command's whole job
    // is destructive by design, so that trade-off is fine.
    if (args.revert) {
      log('REVERT: truncating keyword_ad, keyword_stats_unique and keyword_stats_refresh_state. Nothing will be processed after this.');
      await sql.query('TRUNCATE TABLE keyword_ad');
      await sql.query('TRUNCATE TABLE keyword_stats_unique');
      await sql.query('TRUNCATE TABLE keyword_stats_refresh_state');
      log('revert complete — all three tables are empty.');
      return;
    }

    // --start: same three tables wiped, but THEN proceeds to run from scratch —
    // ensureSupportTables above already created them if they didn't exist. More
    // thorough than the older --rebuild (which only clears keyword_stats_unique and
    // leaves keyword_ad's accumulated ids and the state history in place); --start
    // guarantees a truly clean run, including exact advertiser/domain counts
    // rebuilding from zero rather than on top of old keyword_ad rows.
    if (args.start) {
      log('START: truncating keyword_ad, keyword_stats_unique and keyword_stats_refresh_state, then running from scratch.');
      await sql.query('TRUNCATE TABLE keyword_ad');
      await sql.query('TRUNCATE TABLE keyword_stats_unique');
      await sql.query('TRUNCATE TABLE keyword_stats_refresh_state');
    }
    // --resume is the default behavior with no special handling needed: loadState /
    // monthHistorySummary / pickWorkingMonth already derive where to continue from
    // the existing history on every normal run. It exists as an explicit flag purely
    // so a command line can say what it means instead of relying on "no flag = resume".

    if (args.rebuild) {
      log('REBUILD: truncating keyword_stats_unique and rewinding the resume pointer to 0');
      await sql.query('TRUNCATE TABLE keyword_stats_unique');
      await resetState(sql);
    }
    await assertSafeToAccumulate(sql);

    if (args.dryRun) {
      log('=== DRY RUN === real ES fetches, real MySQL reads, every write rolled back. Nothing in keyword_ad, keyword_stats_unique, or keyword_stats_refresh_state will change.');
    }

    log(
      `start batch=${args.batch} sleepMs=${args.sleepMs} loop=${args.loop} maxBatches=${args.maxBatches || 'full-cycle'}`,
      args.pauseEvery > 0 && args.pauseMs > 0 ? `pause=${args.pauseMs}ms every ${args.pauseEvery} batches` : 'pause=off',
      `recomputeScores=${args.recomputeScores} adaptive=${args.adaptive}${args.adaptive ? '' : ' (pace fixed; load is still reported)'}`,
      `loadSampleEvery=${args.loadCheckMs}ms`,
      args.adaptive
        ? `bounds=[batch ${args.minBatch}-${args.maxBatch}, sleep ${args.minSleepMs}-${args.maxSleepMs}ms, sqlThreadsMax=${args.sqlThreadsMax}, esCpuMax=${args.esCpuMax}%]`
        : ''
    );
    let batchesThisRun = 0;
    let processedThisRun = 0;
    let cycle = null; // { startedAt, totalAds, start, end, density } for the month in progress; null between months
    let workingMonth = null; // { month, isCurrent }
    let cursor = null; // { lastSeen, id } — where the NEXT batch resumes within workingMonth
    let remainingAtStart = 0;
    let workStartedAt = Date.now();
    let currentKnownEmpty = false; // set once current is found to have nothing new — what kicks off backfill (see pickWorkingMonth)
    const floorCache = {}; // caches floorMonth()'s one aggregation for the life of this run
    // Hardcoded (see the FLOOR_YEAR constant, not a CLI flag), applied only when the
    // command itself says --prod — deliberately NOT config.json/NODE_ENV: config.json
    // has "nodeEnv": "development" checked in, so if a prod deployment doesn't
    // override that, isDev-based detection would silently stay "dev" in prod too and
    // this would never apply. --prod makes it explicit and independent of that.
    // Without --prod (the default), the floor stays whatever the real data's own
    // earliest month is, so local testing can still walk all the way back.
    const floorOverride = args.prod ? `${FLOOR_YEAR}-01` : null;
    log(args.prod
      ? `floor: --prod set — backfill will not go earlier than ${floorOverride} (FLOOR_YEAR=${FLOOR_YEAR})`
      : `floor: --prod not set — FLOOR_YEAR (${FLOOR_YEAR}) not applied, using the real data's own floor`);
    let currentBatch = args.batch;
    let currentSleepMs = args.sleepMs;
    let lastLoadCheckAt = 0;
    let lastEsRejectedTotal = null;
    let lastSqlLoad = { threadsRunning: '?', threadsConnected: '?', qps: null, poolPending: '?' };
    let lastEsLoad = { status: '?', maxCpu: '?', maxQueue: '?', rejectedDelta: '?' };
    let prevSqlReading = null; // previous MySQL reading, to turn the Questions counter into queries/sec
    const loadStats = { readings: 0, sumRunning: 0, maxRunning: 0, maxConnected: 0, qpsReadings: 0, sumQps: 0, maxQps: 0 };
    const fmtQps = (q) => (q == null ? '?' : Math.round(q));
    // Dry run can't persist "this historical month is done" (see below), so nothing
    // stops pickWorkingMonth's DB-backed decision from just returning the SAME month
    // forever once it's finished — confirmed in testing: a genuinely empty month
    // looped indefinitely. This in-memory set is what a real run gets from
    // cycle_completed_at instead: months THIS dry run has already fully handled
    // (whether they had 0 ads or real ones that got rolled back), so it can skip past
    // them itself rather than trusting the database, which doesn't know about them.
    const dryRunCompletedMonths = new Set();
    // Steps `picked` back past any month this dry run has already finished. Only ever
    // used for dryRun — a real run's DB state already reflects completed months, so
    // pickWorkingMonth's own answer is always current there.
    async function skipDryRunCompleted(picked) {
      if (!args.dryRun || picked.isCurrent) return picked;
      let month = picked.month;
      while (dryRunCompletedMonths.has(month)) {
        const next = shiftMonthKey(month, -1);
        const effectiveFloor = floorOverride && (floorCache.value === null || floorOverride > floorCache.value) ? floorOverride : floorCache.value;
        if (effectiveFloor !== null && next < effectiveFloor) {
          const current = (await latestDataMonth(sql)) || monthKeyUTC(new Date());
          return { month: current, isCurrent: true, backfillExhausted: true };
        }
        month = next;
      }
      return month === picked.month ? picked : { month, isCurrent: false, backfillExhausted: false };
    }

    for (;;) {
      if (stopRequested) {
        log('stop requested; exiting after current checkpoint.');
        break;
      }

      if (!cycle) {
        // Current month first, always; once it has nothing new, work the oldest
        // unfinished historical month, then step further back — see pickWorkingMonth.
        // currentKnownEmpty is what actually STARTS backfill the first time current
        // is found empty (see pickWorkingMonth's comment) — without it the walk would
        // just keep re-picking current forever and never reach any historical month.
        const picked = await skipDryRunCompleted(await pickWorkingMonth(sql, floorCache, currentKnownEmpty, floorOverride));
        const begun = await beginMonthCycle(sql, es, index, picked.month);
        if (begun.remaining === 0) {
          if (picked.isCurrent && picked.backfillExhausted) {
            // The ONE genuine stopping point: current has nothing new AND every
            // historical month down to the floor is already done. Everything else
            // below just continues straight on to the next month.
            log(`month ${picked.month} (current): nothing new, and backfill has reached the floor — nothing left to do.`);
            if (!args.loop || stopRequested) break;
            await sleepUnlessStopped(IDLE_POLL_MS);
            continue;
          }
          if (picked.isCurrent) {
            log(`month ${picked.month} (current): nothing new right now — moving to backfill.`);
            currentKnownEmpty = true;
          } else if (args.dryRun) {
            // Not persisted to the DB, but remembered in-memory (dryRunCompletedMonths)
            // so this dry run steps past it instead of rediscovering it forever — a
            // real infinite loop this caused in testing before this set existed.
            dryRunCompletedMonths.add(picked.month);
            log(`(dry run) month ${picked.month}: nothing left — would be closed, not persisted.`);
          } else {
            // Defensive: pickWorkingMonth already filters to unfinished months, so this
            // is only reached if a month was touched but genuinely has 0 ads — still
            // close it out so backfill doesn't get stuck retrying it forever.
            await finalizeMonthCycle(sql, picked.month, begun.cycle);
            log(`month ${picked.month}: nothing left — closed.`);
            if (args.recomputeScores) log(`competition_score recomputed for ${await recomputeCompetitionScores(sql)} keyword(s)`);
          }
          continue; // always keep going — there's known work waiting, --loop doesn't apply here
        }
        if (picked.isCurrent) currentKnownEmpty = false; // current has real work again — no longer "empty"
        workingMonth = picked;
        cycle = begun.cycle;
        cursor = begun.cursor;
        remainingAtStart = begun.remaining;
        processedThisRun = 0;
        workStartedAt = Date.now();
        // If this month has more ads waiting than the current batch size, raise the
        // batch size to fit the whole month in as few round trips as possible — capped
        // by --max-batch (the same ceiling --adaptive already respects), so a very
        // dense month still can't make one query unreasonably large. Only ever
        // increases: a month with fewer ads than the current batch size already gets
        // fetched in one hit regardless (size just caps the max returned), and this
        // never lowers a batch size adaptive already throttled down for load reasons.
        if (remainingAtStart > currentBatch) {
          const raised = Math.min(remainingAtStart, args.maxBatch);
          if (raised > currentBatch) {
            log(`batch ${currentBatch}→${raised} to fit ${picked.month}'s ${remainingAtStart} ad(s) in fewer round trips`);
            currentBatch = raised;
          }
        }
        log(`month start: ${picked.month}${picked.isCurrent ? ' (current)' : ''} — ${remainingAtStart} ad(s) after ${cursor.lastSeen || 'the start of the month'}`);
      }

      // Load is SAMPLED whether or not adaptive is on, so the log always shows it
      // (--no-adaptive used to switch the readings off too, leaving "?" in the log).
      // What adaptive adds is ACTING on the reading: shrinking the batch / adding
      // sleep. With --no-adaptive the pace never changes.
      if (Date.now() - lastLoadCheckAt >= args.loadCheckMs) {
        const [sqlLoad, esLoad] = await Promise.all([checkSqlLoad(sql), checkEsLoad(es)]);
        let rejectedDelta = 0;
        if (esLoad.ok) {
          rejectedDelta = lastEsRejectedTotal === null ? 0 : Math.max(0, esLoad.totalRejected - lastEsRejectedTotal);
          lastEsRejectedTotal = esLoad.totalRejected;
        }
        const esLoadWithDelta = { ...esLoad, rejectedDelta };
        if (sqlLoad.ok) {
          // queries/sec since the previous reading (server-wide); the first reading has none.
          const elapsedSec = prevSqlReading ? (sqlLoad.at - prevSqlReading.at) / 1000 : 0;
          const dq = prevSqlReading ? sqlLoad.questions - prevSqlReading.questions : 0;
          sqlLoad.qps = elapsedSec > 0 && dq >= 0 ? dq / elapsedSec : null; // dq < 0 = server restarted
          prevSqlReading = sqlLoad;
          loadStats.readings += 1;
          loadStats.sumRunning += sqlLoad.threadsRunning;
          loadStats.maxRunning = Math.max(loadStats.maxRunning, sqlLoad.threadsRunning);
          loadStats.maxConnected = Math.max(loadStats.maxConnected, sqlLoad.threadsConnected);
          if (sqlLoad.qps != null) {
            loadStats.qpsReadings += 1;
            loadStats.sumQps += sqlLoad.qps;
            loadStats.maxQps = Math.max(loadStats.maxQps, sqlLoad.qps);
          }
        }
        lastSqlLoad = sqlLoad;
        lastEsLoad = esLoadWithDelta;
        lastLoadCheckAt = Date.now();
        if (args.adaptive) {
          const decision = decideAdaptive({ batch: currentBatch, sleepMs: currentSleepMs }, sqlLoad, esLoadWithDelta, args);
          if (decision.batch !== currentBatch || decision.sleepMs !== currentSleepMs) {
            log(`adaptive: batch ${currentBatch}→${decision.batch} sleep ${currentSleepMs}→${decision.sleepMs}ms | ${decision.reasons.join('; ')}`);
          }
          currentBatch = decision.batch;
          currentSleepMs = decision.sleepMs;
        }
      }

      const result = await processOneMonthBatch(sql, es, index, workingMonth.month, cursor, currentBatch, cycle, args.dryRun);
      if (result.completedCycle) {
        // workingMonth still carries backfillExhausted from when it was picked (it's
        // the whole `picked` object — see `workingMonth = picked` above), so the same
        // "is this the ONE genuine stopping point" check applies here too. This branch
        // is where that check actually matters in practice: beginMonthCycle's
        // "remaining" count can't distinguish "0 left" from "the last doc I already
        // processed" as precisely as this real fetch just did (an already-processed
        // ad sharing its exact last_seen with nothing newer still counts as "remaining
        // 1" there), so current showing up here instead of via the other branch, right
        // after backfill reaches the floor, is the normal path — not an edge case.
        // Missing this check here (checking `!args.loop` only in the OTHER branch) is
        // exactly what caused an infinite loop once backfill reached 2022-09: current
        // kept reporting fake "remaining=1", so this branch ran every single time and
        // just kept looping back to "moving to backfill" forever, never stopping.
        if (workingMonth.isCurrent && workingMonth.backfillExhausted) {
          log(`month ${workingMonth.month} (current): nothing new, and backfill has reached the floor — nothing left to do.`);
          cycle = null;
          workingMonth = null;
          cursor = null;
          if (!args.loop || stopRequested) break;
          await sleepUnlessStopped(IDLE_POLL_MS);
          continue;
        }
        if (workingMonth.isCurrent) {
          log(`month ${workingMonth.month} (current): caught up for now — moving to backfill.`);
          currentKnownEmpty = true;
        } else if (args.dryRun) {
          dryRunCompletedMonths.add(workingMonth.month);
          log(`(dry run) month ${workingMonth.month} complete: ads=${cycle.totalAds} — would be closed, not persisted.`);
        } else {
          const finalResult = await finalizeMonthCycle(sql, workingMonth.month, cycle);
          log(`month ${workingMonth.month} complete: ads=${cycle.totalAds} duration=${formatDuration(finalResult.totalMs)}`);
        }
        if (args.recomputeScores && !args.dryRun) log(`competition_score recomputed for ${await recomputeCompetitionScores(sql)} keyword(s)`);
        else if (args.recomputeScores) log('(dry run) competition_score recompute skipped — not persisted.');
        cycle = null;
        workingMonth = null;
        cursor = null;
        if (stopRequested) break;
        continue;
      }

      batchesThisRun += 1;
      processedThisRun += result.batchRows;
      cycle.totalAds += result.batchRows;
      cursor = { lastSeen: result.lastSeen, id: result.lastId };
      const progress = batchProgress(processedThisRun, remainingAtStart, workStartedAt);
      log(
        `month=${workingMonth.month}${workingMonth.isCurrent ? '(current)' : ''}`,
        `progress=${progress.progress.toFixed(2)}%`,
        `batchAds=${result.batchRows}`,
        `adsWithKeywords=${result.adsWithKeywords}`,
        `cycleTotalAds=${cycle.totalAds}`,
        `eta=${formatDuration(progress.etaMs)}`,
        `speed=${progress.rate.toFixed(2)}/sec`,
        `batch=${currentBatch}`,
        `sleep=${currentSleepMs}ms`,
        // Wall-clock time for THIS batch alone (fetch from ES + MySQL
        // owner/domain lookup + transaction/write), excluding the sleep
        // that follows it — the number to look at for "how long does N ads
        // actually take." Identical to the batch_execution_ms stored on the row.
        `batchMs=${result.executionMs}`,
        `msPerAd=${result.batchRows ? (result.executionMs / result.batchRows).toFixed(2) : 'n/a'}`,
        `batchRows=${result.batchRows}`,
        `touchedKeywords=${result.touchedKeywords}`,
        `upserted=${result.upserted}`,
        `upsertedUnique=${result.upsertedUnique}`,
        `lastId=${result.lastId}`,
        `lastSeen=${result.lastSeen}`,
        `sampleKeywords=${JSON.stringify(result.sampleKeywords || [])}`,
        `mysql[running=${lastSqlLoad.threadsRunning},connected=${lastSqlLoad.threadsConnected},qps=${fmtQps(lastSqlLoad.qps)},pending=${lastSqlLoad.poolPending}]`,
        `es[status=${lastEsLoad.status},cpu=${lastEsLoad.maxCpu}%,queue=${lastEsLoad.maxQueue},rejected+=${lastEsLoad.rejectedDelta}]`
      );

      // A historical month can't gain new ads once it's no longer current (see the
      // self-cleaning property in pickWorkingMonth's comment), so if the batches
      // processed so far already account for everything beginMonthCycle counted at
      // the start, there's nothing left to find. Skip BOTH the extra confirm-empty ES
      // query AND the extra MySQL row that closing it out normally takes (finalizeCycle
      // inserts a fresh 0-ad row) — instead, just mark the batch row THIS ad landed in
      // (result.stateRowId, from processOneMonthBatch) as the closing row directly. One
      // UPDATE by primary key, not a whole new INSERT. Safe: monthHistorySummary only
      // reads cycle_completed_at off it (the row's own last_google_text_ad_id/
      // resume_last_seen stay as real values, but nothing reads them once completed is
      // true — beginMonthCycle returns remaining:0 before ever looking at the cursor).
      // NOT done for the current month: new ads can still arrive there, so its "empty"
      // has to come from an actual fetch (see processOneMonthBatch's completedCycle path).
      if (!workingMonth.isCurrent && processedThisRun >= remainingAtStart) {
        if (args.dryRun) {
          // result.stateRowId's row was already rolled back inside processOneMonthBatch
          // (dry-run transactions never commit), so there's nothing real to mark closed.
          dryRunCompletedMonths.add(workingMonth.month);
          log(`(dry run) month ${workingMonth.month} complete: ads=${cycle.totalAds} — would be closed, not persisted.`);
        } else {
          await sql.query('UPDATE keyword_stats_refresh_state SET cycle_completed_at = ? WHERE id = ?', [new Date(), result.stateRowId]);
          log(`month ${workingMonth.month} complete: ads=${cycle.totalAds} (skipped the confirm-empty query AND its extra row — marked the last batch's own row as the close)`);
        }
        if (args.recomputeScores && !args.dryRun) log(`competition_score recomputed for ${await recomputeCompetitionScores(sql)} keyword(s)`);
        else if (args.recomputeScores) log('(dry run) competition_score recompute skipped — not persisted.');
        cycle = null;
        workingMonth = null;
        cursor = null;
        if (stopRequested) break;
        continue;
      }

      if (args.maxBatches > 0 && batchesThisRun >= args.maxBatches) {
        log(`max-batches reached (${args.maxBatches}). stopping cleanly.`);
        break;
      }

      // Short sleep after every batch...
      if (currentSleepMs > 0) await sleepUnlessStopped(currentSleepMs);

      // ...and, if configured, a longer pause after every Nth batch. The script
      // just waits and then carries on by itself — nothing is torn down, and
      // the progress already recorded in keyword_stats_refresh_state is untouched.
      if (args.pauseEvery > 0 && args.pauseMs > 0 && batchesThisRun % args.pauseEvery === 0 && !stopRequested) {
        log(`pause: ${batchesThisRun} batches done this run — waiting ${args.pauseMs}ms before continuing`);
        await sleepUnlessStopped(args.pauseMs);
        if (!stopRequested) log('pause over — resuming');
      }
    }

    // One-line answer to "how loaded was MySQL during this run?". Server-wide
    // numbers (all clients), sampled every --load-check-ms.
    if (loadStats.readings > 0) {
      log(
        `mysql load summary: samples=${loadStats.readings}`,
        `threads_running avg=${(loadStats.sumRunning / loadStats.readings).toFixed(1)} max=${loadStats.maxRunning}`,
        `threads_connected max=${loadStats.maxConnected}`,
        loadStats.qpsReadings > 0
          ? `qps avg=${Math.round(loadStats.sumQps / loadStats.qpsReadings)} max=${Math.round(loadStats.maxQps)}`
          : 'qps n/a (needs 2+ samples — lower --load-check-ms for short runs)'
      );
    }
  } catch (error) {
    try {
      const sqlConn = databaseManager.getSQL(NETWORK);
      if (sqlConn) {
        await ensureSupportTables(sqlConn);
        await updateLatestState(sqlConn, {
          last_error: error.message,
          last_finished_at: new Date(),
        });
      }
    } catch (_) {}
    throw error;
  } finally {
    const sqlConn = databaseManager.getSQL(NETWORK);
    if (sqlConn) await releaseLock(sqlConn);
    await databaseManager.disconnectAll();
  }
}

process.on('SIGINT', () => { stopRequested = true; });
process.on('SIGTERM', () => { stopRequested = true; });

if (require.main === module) {
  const args = parseArgs(process.argv);
  run(args)
    .then(() => log('done.'))
    .catch((error) => {
      jobLogger.error(`FATAL ${error.message}`, { stack: error.stack });
      process.exit(1);
    });
}

module.exports = {
  parseArgs,
  run,
  growthPct,
  pct,
  collectKeywords,
  isJunkKeyword,
  aggregateBatchStats,
  mergeKeywordStats,
  fetchEsBatch,
  fetchEsBatchByLastSeen,
  monthKeyUTC,
  monthBoundsUTC,
  shiftMonthKey,
  monthHistorySummary,
  oldestTouchedHistoricalMonth,
  floorMonth,
  latestDataMonth,
  pickWorkingMonth,
  beginMonthCycle,
  processOneMonthBatch,
  finalizeMonthCycle,
  ensureSupportTables,
  insertKeywordAdIds,
  fetchExactOwnerDomainCounts,
  applyBatchToKeywordStats,
  decideAdaptive,
  sleepUnlessStopped,
  recomputeCompetitionScores,
};
