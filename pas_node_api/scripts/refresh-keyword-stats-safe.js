'use strict';

require('dotenv').config();
const databaseManager = require('../src/database/DatabaseManager');
const networksConfig = require('../src/config/networks');
const { keywordArray } = require('../src/services/google/insertion/esDocBuilder');

const NETWORK = 'google';
const JOB_NAME = 'keyword_stats_safe_refresh';
const LOCK_NAME = 'keyword_stats_safe_refresh_lock';
const DEFAULT_BATCH = 500;
const DEFAULT_SLEEP_MS = 2000;
const KEYWORD_QUERY_CHUNK = 1000;
const INSERT_CHUNK = 1000;
const RECOMPUTE_CHUNK = 500;
const SCORE_BATCH = 5000;

const LOAD_CHECK_INTERVAL_MS = 10000;
const DEFAULT_MIN_BATCH = 100;
const DEFAULT_MAX_BATCH = 5000;
const DEFAULT_MIN_SLEEP_MS = 200;
const DEFAULT_MAX_SLEEP_MS = 15000;
const DEFAULT_SQL_THREADS_MAX = 40;
const DEFAULT_ES_CPU_MAX = 85;
const ES_QUEUE_MAX = 50;

let stopRequested = false;

function log(...args) {
  console.log(`[keyword-stats-safe] ${new Date().toISOString()}`, ...args);
}

function parseArgs(argv) {
  const args = {
    batch: DEFAULT_BATCH,
    sleepMs: DEFAULT_SLEEP_MS,
    loop: false,
    maxBatches: 0,
    recomputeScores: true,
    resetState: false,
    adaptive: true,
    minBatch: DEFAULT_MIN_BATCH,
    maxBatch: DEFAULT_MAX_BATCH,
    minSleepMs: DEFAULT_MIN_SLEEP_MS,
    maxSleepMs: DEFAULT_MAX_SLEEP_MS,
    sqlThreadsMax: DEFAULT_SQL_THREADS_MAX,
    esCpuMax: DEFAULT_ES_CPU_MAX,
  };
  for (const raw of argv.slice(2)) {
    if (raw === '--loop') args.loop = true;
    else if (raw === '--no-score') args.recomputeScores = false;
    else if (raw === '--reset-state') args.resetState = true;
    else if (raw === '--no-adaptive') args.adaptive = false;
    else if (raw.startsWith('--batch=')) args.batch = clampInt(raw.split('=')[1], DEFAULT_BATCH, 1, 5000);
    else if (raw.startsWith('--sleep-ms=')) args.sleepMs = clampInt(raw.split('=')[1], DEFAULT_SLEEP_MS, 0, 3600000);
    else if (raw.startsWith('--max-batches=')) args.maxBatches = clampInt(raw.split('=')[1], 0, 0, 1000000);
    else if (raw.startsWith('--min-batch=')) args.minBatch = clampInt(raw.split('=')[1], DEFAULT_MIN_BATCH, 1, 5000);
    else if (raw.startsWith('--max-batch=')) args.maxBatch = clampInt(raw.split('=')[1], DEFAULT_MAX_BATCH, 1, 5000);
    else if (raw.startsWith('--min-sleep-ms=')) args.minSleepMs = clampInt(raw.split('=')[1], DEFAULT_MIN_SLEEP_MS, 0, 3600000);
    else if (raw.startsWith('--max-sleep-ms=')) args.maxSleepMs = clampInt(raw.split('=')[1], DEFAULT_MAX_SLEEP_MS, 0, 3600000);
    else if (raw.startsWith('--sql-threads-max=')) args.sqlThreadsMax = clampInt(raw.split('=')[1], DEFAULT_SQL_THREADS_MAX, 1, 100000);
    else if (raw.startsWith('--es-cpu-max=')) args.esCpuMax = clampInt(raw.split('=')[1], DEFAULT_ES_CPU_MAX, 1, 100);
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

function uniqueInts(values) {
  return [...new Set((values || []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function hasRealImage(variantRows) {
  return (variantRows || []).some((row) => {
    const imageUrl = trimTo(row.image_url, 2048);
    return imageUrl && !imageUrl.includes('DefaultImage');
  });
}

function isEligibleAd(adRow, variantRows) {
  const type = String(adRow.type || '').trim().toLowerCase();
  if (type === 'organic search') return false;
  if (type === 'image' && !hasRealImage(variantRows)) return false;
  return true;
}

function collectKeywords(variantRows) {
  const keywords = [];
  for (const row of variantRows || []) {
    const parsed = keywordArray(row.target_keyword) || [];
    for (const keyword of parsed) keywords.push(keyword);
  }
  return [...new Set(keywords.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))];
}

function firstByKeyword(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const keywordId = Number(row.keyword_id);
    if (!map.has(keywordId)) map.set(keywordId, row.value);
  }
  return map;
}

function typeMixByKeyword(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const keywordId = Number(row.keyword_id);
    if (!map.has(keywordId)) map.set(keywordId, {});
    map.get(keywordId)[row.value] = Number(row.c) || 0;
  }
  return map;
}

function positionPctByKeyword(rows) {
  const map = new Map();
  for (const row of rows || []) {
    const keywordId = Number(row.keyword_id);
    if (!map.has(keywordId)) map.set(keywordId, { total: 0, top: 0 });
    const bucket = map.get(keywordId);
    const count = Number(row.c) || 0;
    bucket.total += count;
    if (String(row.value || '').toLowerCase().includes('top')) bucket.top += count;
  }
  const out = new Map();
  for (const [keywordId, value] of map.entries()) out.set(keywordId, pct(value.top, value.total));
  return out;
}

async function withTransaction(sql, fn) {
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
    await conn.commit();
    return result;
  } catch (error) {
    try { await conn.rollback(); } catch (_) {}
    throw error;
  } finally {
    conn.release();
  }
}

async function ensureSupportTables(sql) {
  const keywordAdTableWithFk = `
    CREATE TABLE IF NOT EXISTS keyword_ad (
      keyword_id         INT UNSIGNED NOT NULL,
      google_text_ad_id  INT UNSIGNED NOT NULL,
      post_owner_id      INT UNSIGNED NULL,
      domain_id          INT UNSIGNED NULL,
      ad_type            VARCHAR(64) NULL,
      ad_position        VARCHAR(128) NULL,
      first_seen         DATETIME NULL,
      last_seen          DATETIME NULL,
      country            VARCHAR(191) NULL,
      category           VARCHAR(191) NULL,
      sub_category       VARCHAR(191) NULL,
      updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (keyword_id, google_text_ad_id),
      KEY idx_keyword_ad_ad (google_text_ad_id),
      KEY idx_keyword_ad_keyword_last_seen (keyword_id, last_seen),
      KEY idx_keyword_ad_keyword_owner (keyword_id, post_owner_id),
      KEY idx_keyword_ad_keyword_domain (keyword_id, domain_id),
      CONSTRAINT fk_keyword_ad_google_text_ad FOREIGN KEY (google_text_ad_id) REFERENCES google_text_ad (id) ON DELETE CASCADE
    )
  `;
  const keywordAdTableWithoutFk = `
    CREATE TABLE IF NOT EXISTS keyword_ad (
      keyword_id         INT UNSIGNED NOT NULL,
      google_text_ad_id  INT UNSIGNED NOT NULL,
      post_owner_id      INT UNSIGNED NULL,
      domain_id          INT UNSIGNED NULL,
      ad_type            VARCHAR(64) NULL,
      ad_position        VARCHAR(128) NULL,
      first_seen         DATETIME NULL,
      last_seen          DATETIME NULL,
      country            VARCHAR(191) NULL,
      category           VARCHAR(191) NULL,
      sub_category       VARCHAR(191) NULL,
      updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (keyword_id, google_text_ad_id),
      KEY idx_keyword_ad_ad (google_text_ad_id),
      KEY idx_keyword_ad_keyword_last_seen (keyword_id, last_seen),
      KEY idx_keyword_ad_keyword_owner (keyword_id, post_owner_id),
      KEY idx_keyword_ad_keyword_domain (keyword_id, domain_id)
    )
  `;
  try {
    await sql.query(keywordAdTableWithFk);
  } catch (error) {
    log(`keyword_ad FK create failed (${error.message}). Retrying without FK.`);
    await sql.query(keywordAdTableWithoutFk);
  }
  await sql.query(`
    CREATE TABLE IF NOT EXISTS keyword_stats_refresh_state (
      job_name                 VARCHAR(64) NOT NULL PRIMARY KEY,
      last_google_text_ad_id   INT UNSIGNED NOT NULL DEFAULT 0,
      ads_processed_cycle      BIGINT UNSIGNED NOT NULL DEFAULT 0,
      total_ads_cycle          BIGINT UNSIGNED NOT NULL DEFAULT 0,
      batches_processed_cycle  BIGINT UNSIGNED NOT NULL DEFAULT 0,
      cycle_started_at         DATETIME NULL,
      cycle_completed_at       DATETIME NULL,
      last_started_at          DATETIME NULL,
      last_finished_at         DATETIME NULL,
      last_error               TEXT NULL,
      updated_at               TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  await sql.query(`
    INSERT INTO keyword_stats_refresh_state (job_name)
    VALUES (?)
    ON DUPLICATE KEY UPDATE job_name = VALUES(job_name)
  `, [JOB_NAME]);
}

async function purgeOrphanKeywordAdRows(sql) {
  let deleted = 0;
  for (;;) {
    const result = await sql.query(`
      DELETE FROM keyword_ad
       WHERE google_text_ad_id IN (
         SELECT orphan_ad_id
           FROM (
             SELECT DISTINCT ka.google_text_ad_id AS orphan_ad_id
               FROM keyword_ad ka
               LEFT JOIN google_text_ad a ON a.id = ka.google_text_ad_id
              WHERE a.id IS NULL
              LIMIT 5000
           ) orphan_ids
       )
    `);
    const affected = Number(result?.affectedRows || 0);
    deleted += affected;
    if (!affected) break;
  }
  return deleted;
}

async function getSupportMeta(sql) {
  const rows = await sql.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name IN ('google_text_category', 'google_text_ad_ai_meta', 'google_text_country_only')`
  );
  const present = new Set(rows.map((row) => String(row.table_name)));
  return {
    hasCategory: present.has('google_text_category'),
    hasAiMeta: present.has('google_text_ad_ai_meta'),
    hasCountry: present.has('google_text_country_only'),
  };
}

function buildBaseBatchQuery(meta, batchSize) {
  const joins = [];
  let categoryExpr = 'NULL';
  if (meta.hasCategory) {
    joins.push('LEFT JOIN google_text_category cat ON cat.id = a.category_id');
    categoryExpr = 'cat.category_name';
  }
  if (meta.hasAiMeta) {
    joins.push('LEFT JOIN google_text_ad_ai_meta ai ON ai.google_text_ad_id = a.id');
    categoryExpr = meta.hasCategory ? `COALESCE(ai.category, ${categoryExpr})` : 'ai.category';
  }
  if (meta.hasCountry) joins.push('LEFT JOIN google_text_country_only co ON co.id = a.country_only_id');
  const subCategoryExpr = meta.hasAiMeta ? 'ai.sub_category' : 'NULL';
  const countryExpr = meta.hasCountry ? 'co.country' : 'NULL';
  return `
    SELECT
      a.id AS id,
      ANY_VALUE(a.post_owner_id) AS post_owner_id,
      ANY_VALUE(a.domain_id) AS domain_id,
      ANY_VALUE(a.type) AS type,
      ANY_VALUE(a.ad_position) AS ad_position,
      ANY_VALUE(a.first_seen) AS first_seen,
      ANY_VALUE(a.last_seen) AS last_seen,
      ANY_VALUE(${categoryExpr}) AS category,
      ANY_VALUE(${subCategoryExpr}) AS sub_category,
      ANY_VALUE(${countryExpr}) AS top_country
    FROM google_text_ad a
    ${joins.join('\n')}
    WHERE a.id > ?
    GROUP BY a.id
    ORDER BY a.id ASC
    LIMIT ${batchSize}
  `;
}

async function loadState(sql) {
  const [row] = await sql.query(
    `SELECT job_name, last_google_text_ad_id, ads_processed_cycle, total_ads_cycle,
            batches_processed_cycle, cycle_started_at, cycle_completed_at,
            last_started_at, last_finished_at, last_error
       FROM keyword_stats_refresh_state
      WHERE job_name = ?
      LIMIT 1`,
    [JOB_NAME]
  );
  return row || null;
}

async function updateState(exec, fields) {
  const entries = Object.entries(fields);
  if (!entries.length) return;
  const sql = `UPDATE keyword_stats_refresh_state SET ${entries.map(([key]) => `${key} = ?`).join(', ')} WHERE job_name = ?`;
  const params = entries.map(([, value]) => value);
  params.push(JOB_NAME);
  await exec.query(sql, params);
}

async function resetState(sql) {
  await updateState(sql, {
    last_google_text_ad_id: 0,
    ads_processed_cycle: 0,
    total_ads_cycle: 0,
    batches_processed_cycle: 0,
    cycle_started_at: null,
    cycle_completed_at: null,
    last_started_at: null,
    last_finished_at: null,
    last_error: null,
  });
}

async function ensureCycleStarted(sql, state) {
  const completedCycle = Number(state.last_google_text_ad_id || 0) === 0 && !!state.cycle_completed_at;
  if (!completedCycle && Number(state.total_ads_cycle || 0) > 0 && state.cycle_started_at) return state;
  const [countRow] = await sql.query('SELECT COUNT(*) AS c FROM google_text_ad');
  await updateState(sql, {
    last_google_text_ad_id: 0,
    ads_processed_cycle: 0,
    total_ads_cycle: Number(countRow.c || 0),
    batches_processed_cycle: 0,
    cycle_started_at: new Date(),
    cycle_completed_at: null,
    last_error: null,
  });
  return loadState(sql);
}

async function acquireLock(sql) {
  const [row] = await sql.query('SELECT GET_LOCK(?, 0) AS locked', [LOCK_NAME]);
  return Number(row?.locked) === 1;
}

async function releaseLock(sql) {
  try { await sql.query('SELECT RELEASE_LOCK(?)', [LOCK_NAME]); } catch (_) {}
}

async function resolveKeywordIds(sql, keywords) {
  const lowered = [...new Set((keywords || []).map((value) => String(value || '').trim().toLowerCase()).filter(Boolean))];
  const map = new Map();
  for (const names of chunk(lowered, KEYWORD_QUERY_CHUNK)) {
    const placeholders = names.map(() => '?').join(', ');
    const rows = await sql.query(
      `SELECT id, LOWER(keyword) AS keyword_key
         FROM google_text_keywords
        WHERE keyword IN (${placeholders})`,
      names
    );
    for (const row of rows) {
      const key = String(row.keyword_key || '').trim().toLowerCase();
      if (!key) continue;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(Number(row.id));
    }
  }
  return map;
}

async function fetchVariants(sql, adIds) {
  if (!adIds.length) return new Map();
  const map = new Map();
  for (const ids of chunk(adIds, INSERT_CHUNK)) {
    const placeholders = ids.map(() => '?').join(', ');
    const rows = await sql.query(
      `SELECT google_text_ad_id, target_keyword, image_url
         FROM google_text_ad_variants
        WHERE google_text_ad_id IN (${placeholders})`,
      ids
    );
    for (const row of rows) {
      const adId = Number(row.google_text_ad_id);
      if (!map.has(adId)) map.set(adId, []);
      map.get(adId).push(row);
    }
  }
  return map;
}

async function fetchBatch(sql, baseBatchQuery, lastId) {
  const rows = await sql.query(baseBatchQuery, [lastId]);
  if (!rows.length) return [];
  const adIds = rows.map((row) => Number(row.id));
  const variantsByAdId = await fetchVariants(sql, adIds);
  return rows.map((row) => ({
    id: Number(row.id),
    post_owner_id: row.post_owner_id ? Number(row.post_owner_id) : null,
    domain_id: row.domain_id ? Number(row.domain_id) : null,
    type: row.type || null,
    ad_position: row.ad_position || null,
    first_seen: row.first_seen || null,
    last_seen: row.last_seen || null,
    category: trimTo(row.category, 191),
    sub_category: trimTo(row.sub_category, 191),
    top_country: trimTo(row.top_country, 191),
    variants: variantsByAdId.get(Number(row.id)) || [],
  }));
}

async function fetchExistingKeywordIdsForAds(exec, adIds) {
  if (!adIds.length) return [];
  const out = [];
  for (const ids of chunk(adIds, INSERT_CHUNK)) {
    const placeholders = ids.map(() => '?').join(', ');
    const rows = await exec.query(
      `SELECT DISTINCT keyword_id
         FROM keyword_ad
        WHERE google_text_ad_id IN (${placeholders})`,
      ids
    );
    for (const row of rows) out.push(Number(row.keyword_id));
  }
  return out;
}

async function deleteKeywordAdRows(exec, adIds) {
  if (!adIds.length) return;
  for (const ids of chunk(adIds, INSERT_CHUNK)) {
    const placeholders = ids.map(() => '?').join(', ');
    await exec.query(`DELETE FROM keyword_ad WHERE google_text_ad_id IN (${placeholders})`, ids);
  }
}

async function insertKeywordAdRows(exec, rows) {
  if (!rows.length) return;
  const cols = [
    'keyword_id',
    'google_text_ad_id',
    'post_owner_id',
    'domain_id',
    'ad_type',
    'ad_position',
    'first_seen',
    'last_seen',
    'country',
    'category',
    'sub_category',
  ];
  for (const part of chunk(rows, INSERT_CHUNK)) {
    const placeholders = part.map(() => `(${cols.map(() => '?').join(', ')})`).join(', ');
    const params = [];
    for (const row of part) {
      params.push(
        row.keyword_id,
        row.google_text_ad_id,
        row.post_owner_id,
        row.domain_id,
        row.ad_type,
        row.ad_position,
        row.first_seen,
        row.last_seen,
        row.country,
        row.category,
        row.sub_category
      );
    }
    await exec.query(
      `INSERT INTO keyword_ad (${cols.join(', ')}) VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE
         post_owner_id = VALUES(post_owner_id),
         domain_id = VALUES(domain_id),
         ad_type = VALUES(ad_type),
         ad_position = VALUES(ad_position),
         first_seen = VALUES(first_seen),
         last_seen = VALUES(last_seen),
         country = VALUES(country),
         category = VALUES(category),
         sub_category = VALUES(sub_category),
         updated_at = CURRENT_TIMESTAMP`,
      params
    );
  }
}

async function fetchValueCounts(exec, keywordIds, expr, extraWhere) {
  if (!keywordIds.length) return [];
  const placeholders = keywordIds.map(() => '?').join(', ');
  const sql = `
    SELECT keyword_id, ${expr} AS value, COUNT(*) AS c
      FROM keyword_ad
     WHERE keyword_id IN (${placeholders})
       ${extraWhere ? `AND ${extraWhere}` : ''}
     GROUP BY keyword_id, value
     ORDER BY keyword_id ASC, c DESC, value ASC
  `;
  return exec.query(sql, keywordIds);
}

// keyword_id -> { keyword, country } for the deduplicated keyword_stats_unique
// write below (see recomputeKeywordStats). A keyword TEXT can map to several
// google_text_keywords ids (one per country) — same fan-out this whole script
// already applies when writing keyword_ad/keyword_stats (see processOneBatch).
async function fetchKeywordTextAndCountry(exec, keywordIds) {
  const map = new Map();
  if (!keywordIds.length) return map;
  for (const ids of chunk(keywordIds, INSERT_CHUNK)) {
    const placeholders = ids.map(() => '?').join(', ');
    const rows = await exec.query(
      `SELECT id, LOWER(keyword) AS keyword, country FROM google_text_keywords WHERE id IN (${placeholders})`,
      ids
    );
    for (const row of rows) map.set(Number(row.id), { keyword: row.keyword, country: row.country || null });
  }
  return map;
}

// Upsert one row per keyword TEXT into keyword_stats_unique — the deduplicated
// rollup keywordsExplorerController.js reads from (see
// scripts/keyword_stats_unique_schema.sql for why: keyword_stats has one row
// PER COUNTRY-VARIANT keyword_id, which forced a GROUP BY on every Explorer
// request and measured ~20-38s/query in production, 2026-08-13). statsRows here
// are already per-keyword_id (this script computes ad counts per keyword_id
// independently, unlike refreshKeywordStats.js's ES sweep) but every variant of
// the same keyword text shares the same underlying ad set (processOneBatch
// fans the same ad out to every variant id), so summing across variants and
// deduping by text is safe — it just re-merges what was fanned out.
async function upsertUniqueKeywordStats(exec, statsRows, keywordMeta) {
  if (!statsRows.length) return 0;
  const byKeyword = new Map(); // keyword text -> merged row
  for (const row of statsRows) {
    const meta = keywordMeta.get(Number(row.keyword_id));
    if (!meta?.keyword) continue;
    let merged = byKeyword.get(meta.keyword);
    if (!merged) {
      merged = { ...row, keyword: meta.keyword, sample_keyword_id: row.keyword_id, countries: new Set() };
      byKeyword.set(meta.keyword, merged);
    } else {
      merged.sample_keyword_id = Math.min(merged.sample_keyword_id, row.keyword_id);
    }
    if (meta.country) merged.countries.add(meta.country);
  }
  const uniqueRows = [...byKeyword.values()];
  if (!uniqueRows.length) return 0;

  const cols = [
    'keyword', 'sample_keyword_id', 'countries', 'ads_total', 'advertisers_total',
    'domains_total', 'ads_30d', 'ads_prior_30d', 'growth_pct', 'category',
    'sub_category', 'top_country', 'type_mix', 'position_top_pct', 'first_seen', 'last_seen',
  ];
  for (const part of chunk(uniqueRows, INSERT_CHUNK)) {
    const placeholders = part.map(() => `(${cols.map(() => '?').join(', ')}, NOW())`).join(', ');
    const params = [];
    for (const row of part) {
      for (const col of cols) {
        params.push(col === 'countries' ? JSON.stringify([...row.countries]) : (row[col] ?? null));
      }
    }
    const updateSql = cols.filter((c) => c !== 'keyword').map((c) => `${c} = VALUES(${c})`).join(', ');
    await exec.query(
      `INSERT INTO keyword_stats_unique (${cols.join(', ')}, updated_at)
       VALUES ${placeholders}
       ON DUPLICATE KEY UPDATE ${updateSql}, updated_at = VALUES(updated_at)`,
      params
    );
  }
  return uniqueRows.length;
}

async function recomputeKeywordStats(exec, keywordIds) {
  const ids = uniqueInts(keywordIds);
  if (!ids.length) return { upserted: 0, deleted: 0, upsertedUnique: 0 };
  let upserted = 0;
  let deleted = 0;
  let upsertedUnique = 0;
  const now = new Date();
  const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const d60 = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000);
  for (const idChunk of chunk(ids, RECOMPUTE_CHUNK)) {
    const placeholders = idChunk.map(() => '?').join(', ');
    const aggregateRows = await exec.query(
      `SELECT keyword_id,
              COUNT(*) AS ads_total,
              COUNT(DISTINCT post_owner_id) AS advertisers_total,
              COUNT(DISTINCT domain_id) AS domains_total,
              SUM(CASE WHEN last_seen >= ? THEN 1 ELSE 0 END) AS ads_30d,
              SUM(CASE WHEN last_seen >= ? AND last_seen < ? THEN 1 ELSE 0 END) AS ads_prior_30d,
              MIN(DATE(first_seen)) AS first_seen,
              MAX(DATE(last_seen)) AS last_seen
         FROM keyword_ad
        WHERE keyword_id IN (${placeholders})
        GROUP BY keyword_id`,
      [d30, d60, d30, ...idChunk]
    );
    const categoryRows = await fetchValueCounts(exec, idChunk, 'TRIM(category)', `category IS NOT NULL AND TRIM(category) <> ''`);
    const subCategoryRows = await fetchValueCounts(exec, idChunk, 'TRIM(sub_category)', `sub_category IS NOT NULL AND TRIM(sub_category) <> ''`);
    const countryRows = await fetchValueCounts(exec, idChunk, 'TRIM(country)', `country IS NOT NULL AND TRIM(country) <> ''`);
    const typeRows = await fetchValueCounts(exec, idChunk, 'UPPER(TRIM(ad_type))', `ad_type IS NOT NULL AND TRIM(ad_type) <> ''`);
    const positionRows = await fetchValueCounts(exec, idChunk, 'TRIM(ad_position)', `ad_position IS NOT NULL AND TRIM(ad_position) <> ''`);

    const aggregateMap = new Map(aggregateRows.map((row) => [Number(row.keyword_id), row]));
    const categoryMap = firstByKeyword(categoryRows);
    const subCategoryMap = firstByKeyword(subCategoryRows);
    const countryMap = firstByKeyword(countryRows);
    const typeMixMap = typeMixByKeyword(typeRows);
    const positionPctMap = positionPctByKeyword(positionRows);

    const statsRows = [];
    const deleteIds = [];
    for (const keywordId of idChunk) {
      const base = aggregateMap.get(Number(keywordId));
      if (!base) {
        deleteIds.push(keywordId);
        continue;
      }
      const ads30 = Number(base.ads_30d) || 0;
      const adsPrior30 = Number(base.ads_prior_30d) || 0;
      statsRows.push({
        keyword_id: keywordId,
        ads_total: Number(base.ads_total) || 0,
        advertisers_total: Number(base.advertisers_total) || 0,
        domains_total: Number(base.domains_total) || 0,
        ads_30d: ads30,
        ads_prior_30d: adsPrior30,
        growth_pct: growthPct(ads30, adsPrior30),
        category: trimTo(categoryMap.get(Number(keywordId)), 191),
        sub_category: trimTo(subCategoryMap.get(Number(keywordId)), 191),
        top_country: trimTo(countryMap.get(Number(keywordId)), 8),
        type_mix: JSON.stringify(typeMixMap.get(Number(keywordId)) || {}),
        position_top_pct: positionPctMap.get(Number(keywordId)) ?? null,
        first_seen: base.first_seen || null,
        last_seen: base.last_seen || null,
      });
    }

    if (statsRows.length) {
      upserted += statsRows.length;
      const keywordMeta = await fetchKeywordTextAndCountry(exec, statsRows.map((row) => row.keyword_id));
      upsertedUnique += await upsertUniqueKeywordStats(exec, statsRows, keywordMeta);
    }

    // deleteIds = keyword_ids with zero ads left in THIS chunk. keyword_stats_unique
    // is keyed by keyword TEXT, not keyword_id, and a keyword's other country
    // variants (processed in a different chunk/batch) may still have ads — so we
    // don't delete here. A keyword text that truly has zero ads across every
    // variant just stops being refreshed; its stale row is cleaned up on the next
    // full --truncate rebuild (see refreshKeywordStats.js). deleted is still
    // counted for log visibility.
    deleted += deleteIds.length;
  }
  return { upserted, deleted, upsertedUnique };
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

async function checkSqlLoad(sql) {
  try {
    const [row] = await sql.query(`SHOW GLOBAL STATUS LIKE 'Threads_running'`);
    const threadsRunning = Number(row?.Value) || 0;
    const pool = sql.pool?.pool;
    return {
      ok: true,
      threadsRunning,
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

  if (!sqlLoad.ok) {
    holdSteady = true;
    reasons.push(`sql check failed (${sqlLoad.error})`);
  } else {
    if (sqlLoad.poolPending > 0) { scaleDown = true; reasons.push(`sql pool queueing (pending=${sqlLoad.poolPending})`); }
    if (sqlLoad.threadsRunning >= args.sqlThreadsMax) { scaleDown = true; reasons.push(`mysql threads_running=${sqlLoad.threadsRunning}>=${args.sqlThreadsMax}`); }
    else if (sqlLoad.threadsRunning >= args.sqlThreadsMax * 0.7) { holdSteady = true; reasons.push(`mysql threads_running=${sqlLoad.threadsRunning} nearing limit`); }
  }

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

function batchProgress(state) {
  const total = Number(state.total_ads_cycle || 0);
  const done = Number(state.ads_processed_cycle || 0);
  const progress = total > 0 ? (done / total) * 100 : 100;
  const startedAt = state.cycle_started_at ? new Date(state.cycle_started_at).getTime() : Date.now();
  const elapsedMs = Math.max(0, Date.now() - startedAt);
  const etaMs = done > 0 && total > done ? Math.round((elapsedMs / done) * (total - done)) : 0;
  const rate = elapsedMs > 0 ? (done / (elapsedMs / 1000)) : 0;
  return { progress, etaMs, elapsedMs, rate };
}

async function processOneBatch(sql, baseBatchQuery) {
  const state = await ensureCycleStarted(sql, await loadState(sql));
  const batchRows = await fetchBatch(sql, baseBatchQuery, Number(state.last_google_text_ad_id || 0));
  if (!batchRows.length) return { completedCycle: true, batchRows: 0, eligibleAds: 0, touchedKeywords: 0, upserted: 0, deleted: 0 };

  const adIds = batchRows.map((row) => Number(row.id));
  const eligibleAds = [];
  const allKeywords = [];
  const eligibleByAdId = new Map();
  for (const row of batchRows) {
    if (!isEligibleAd(row, row.variants)) continue;
    const keywords = collectKeywords(row.variants);
    eligibleAds.push(row);
    eligibleByAdId.set(row.id, keywords);
    allKeywords.push(...keywords);
  }

  const keywordIdMap = await resolveKeywordIds(sql, allKeywords);
  const insertRows = [];
  for (const ad of eligibleAds) {
    const keywords = eligibleByAdId.get(ad.id) || [];
    for (const keyword of keywords) {
      const keywordIds = keywordIdMap.get(keyword) || [];
      for (const keywordId of keywordIds) {
        insertRows.push({
          keyword_id: keywordId,
          google_text_ad_id: ad.id,
          post_owner_id: ad.post_owner_id,
          domain_id: ad.domain_id,
          ad_type: normalizeType(ad.type),
          ad_position: normalizePosition(ad.ad_position),
          first_seen: ad.first_seen || null,
          last_seen: ad.last_seen || null,
          country: trimTo(ad.top_country, 191),
          category: trimTo(ad.category, 191),
          sub_category: trimTo(ad.sub_category, 191),
        });
      }
    }
  }

  const result = await withTransaction(sql, async (tx) => {
    const previousKeywordIds = await fetchExistingKeywordIdsForAds(tx, adIds);
    await deleteKeywordAdRows(tx, adIds);
    await insertKeywordAdRows(tx, insertRows);
    const touchedKeywordIds = uniqueInts([
      ...previousKeywordIds,
      ...insertRows.map((row) => row.keyword_id),
    ]);
    const statsResult = await recomputeKeywordStats(tx, touchedKeywordIds);
    await updateState(tx, {
      last_google_text_ad_id: Number(batchRows[batchRows.length - 1].id),
      ads_processed_cycle: Number(state.ads_processed_cycle || 0) + batchRows.length,
      batches_processed_cycle: Number(state.batches_processed_cycle || 0) + 1,
      last_started_at: new Date(),
      last_finished_at: new Date(),
      last_error: null,
    });
    return {
      batchRows: batchRows.length,
      eligibleAds: eligibleAds.length,
      touchedKeywords: touchedKeywordIds.length,
      upserted: statsResult.upserted,
      upsertedUnique: statsResult.upsertedUnique,
      deleted: statsResult.deleted,
      lastId: Number(batchRows[batchRows.length - 1].id),
    };
  });

  return { completedCycle: false, ...result };
}

async function finalizeCycle(sql, recomputeScores) {
  const stateBefore = await loadState(sql);
  const cycleStartedAt = stateBefore?.cycle_started_at ? new Date(stateBefore.cycle_started_at).getTime() : Date.now();
  await updateState(sql, {
    last_google_text_ad_id: 0,
    cycle_completed_at: new Date(),
    last_finished_at: new Date(),
    last_error: null,
  });
  let scored = 0;
  if (recomputeScores) scored = await recomputeCompetitionScores(sql);
  const totalMs = Math.max(0, Date.now() - cycleStartedAt);
  return { scored, totalMs };
}

async function run(args = {}) {
  const cliNetworks = pickNetworkConfig([NETWORK], networksConfig);
  await databaseManager.connectAll(cliNetworks);
  const sql = databaseManager.getSQL(NETWORK);
  if (!sql) throw new Error('google SQL connection unavailable');
  const es = databaseManager.getElastic(NETWORK);
  if (args.adaptive && !es) log('warning: Elasticsearch client unavailable; adaptive throttle will hold steady on ES checks.');

  if (!await acquireLock(sql)) {
    log('another refresh is already running; exiting safely.');
    return;
  }

  try {
    await ensureSupportTables(sql);
    const orphanRowsDeleted = await purgeOrphanKeywordAdRows(sql);
    if (orphanRowsDeleted) log(`purged ${orphanRowsDeleted} orphan keyword_ad row(s) before starting`);
    const [keywordStatsUniqueExists] = await sql.query(`SHOW TABLES LIKE 'keyword_stats_unique'`);
    if (!keywordStatsUniqueExists) {
      throw new Error('keyword_stats_unique table is missing — run: node scripts/apply-keyword-stats-schema.js');
    }
    if (args.resetState) {
      await resetState(sql);
      log('state reset completed.');
    }
    const meta = await getSupportMeta(sql);

    log(
      `start batch=${args.batch} sleepMs=${args.sleepMs} loop=${args.loop} maxBatches=${args.maxBatches || 'full-cycle'}`,
      `recomputeScores=${args.recomputeScores} adaptive=${args.adaptive}`,
      args.adaptive
        ? `bounds=[batch ${args.minBatch}-${args.maxBatch}, sleep ${args.minSleepMs}-${args.maxSleepMs}ms, sqlThreadsMax=${args.sqlThreadsMax}, esCpuMax=${args.esCpuMax}%]`
        : ''
    );
    let batchesThisRun = 0;
    let currentBatch = args.batch;
    let currentSleepMs = args.sleepMs;
    let lastLoadCheckAt = 0;
    let lastEsRejectedTotal = null;
    let lastSqlLoad = { threadsRunning: '?', poolPending: '?' };
    let lastEsLoad = { status: '?', maxCpu: '?', maxQueue: '?', rejectedDelta: '?' };

    for (;;) {
      if (stopRequested) {
        log('stop requested; exiting after current checkpoint.');
        break;
      }

      const stateBefore = await ensureCycleStarted(sql, await loadState(sql));
      if (Number(stateBefore.total_ads_cycle || 0) === 0) {
        log('google_text_ad has no rows. Nothing to process.');
        break;
      }

      if (args.adaptive && Date.now() - lastLoadCheckAt >= LOAD_CHECK_INTERVAL_MS) {
        const [sqlLoad, esLoad] = await Promise.all([checkSqlLoad(sql), checkEsLoad(es)]);
        let rejectedDelta = 0;
        if (esLoad.ok) {
          rejectedDelta = lastEsRejectedTotal === null ? 0 : Math.max(0, esLoad.totalRejected - lastEsRejectedTotal);
          lastEsRejectedTotal = esLoad.totalRejected;
        }
        const esLoadWithDelta = { ...esLoad, rejectedDelta };
        lastSqlLoad = sqlLoad;
        lastEsLoad = esLoadWithDelta;
        lastLoadCheckAt = Date.now();
        const decision = decideAdaptive({ batch: currentBatch, sleepMs: currentSleepMs }, sqlLoad, esLoadWithDelta, args);
        if (decision.batch !== currentBatch || decision.sleepMs !== currentSleepMs) {
          log(`adaptive: batch ${currentBatch}→${decision.batch} sleep ${currentSleepMs}→${decision.sleepMs}ms | ${decision.reasons.join('; ')}`);
        }
        currentBatch = decision.batch;
        currentSleepMs = decision.sleepMs;
      }

      const baseBatchQuery = buildBaseBatchQuery(meta, currentBatch);
      const result = await processOneBatch(sql, baseBatchQuery);
      if (result.completedCycle) {
        const finalResult = await finalizeCycle(sql, args.recomputeScores);
        log(`cycle complete ads=${stateBefore.total_ads_cycle} scored=${finalResult.scored} duration=${formatDuration(finalResult.totalMs)}`);
        if (!args.loop || stopRequested) break;
        await resetState(sql);
        if (currentSleepMs > 0) {
          log(`sleeping ${currentSleepMs}ms before next cycle`);
          await sleep(currentSleepMs);
        }
        continue;
      }

      batchesThisRun += 1;
      const stateAfter = await loadState(sql);
      const progress = batchProgress(stateAfter);
      log(
        `progress=${progress.progress.toFixed(2)}%`,
        `ads=${stateAfter.ads_processed_cycle}/${stateAfter.total_ads_cycle}`,
        `eta=${formatDuration(progress.etaMs)}`,
        `speed=${progress.rate.toFixed(2)}/sec`,
        `batch=${currentBatch}`,
        `sleep=${currentSleepMs}ms`,
        `batchRows=${result.batchRows}`,
        `eligibleAds=${result.eligibleAds}`,
        `touchedKeywords=${result.touchedKeywords}`,
        `upserted=${result.upserted}`,
        `upsertedUnique=${result.upsertedUnique}`,
        `deleted=${result.deleted}`,
        `lastId=${result.lastId}`,
        `sql[threads=${lastSqlLoad.threadsRunning},pending=${lastSqlLoad.poolPending}]`,
        `es[status=${lastEsLoad.status},cpu=${lastEsLoad.maxCpu}%,queue=${lastEsLoad.maxQueue},rejected+=${lastEsLoad.rejectedDelta}]`
      );

      if (args.maxBatches > 0 && batchesThisRun >= args.maxBatches) {
        log(`max-batches reached (${args.maxBatches}). stopping cleanly.`);
        break;
      }

      if (currentSleepMs > 0) await sleep(currentSleepMs);
    }
  } catch (error) {
    try {
      const sqlConn = databaseManager.getSQL(NETWORK);
      if (sqlConn) {
        await ensureSupportTables(sqlConn);
        await updateState(sqlConn, {
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
      console.error('[keyword-stats-safe] FATAL', error);
      process.exit(1);
    });
}

module.exports = {
  parseArgs,
  run,
  growthPct,
  pct,
  // Exposed for jobs/competitionScoreCron.js — competition_score is a
  // percentile rank over the WHOLE keyword_stats_unique table (a row's
  // score depends on every other row), so it can't be computed per-row
  // incrementally; recomputeCompetitionScores() itself is a fast, cheap
  // set-based operation on this table (~500k-1M rows — the small per-
  // keyword-TEXT rollup, NOT the 42M-row ad corpus). The reason it was
  // previously stuck at effectively-never-runs wasn't its own cost — it's
  // that run()/finalizeCycle() above only call it once a FULL ad-corpus
  // sweep cycle completes, and that sweep can take a very long time against
  // production's real row counts. Decoupling it onto its own frequent,
  // independent schedule (see the cron) fixes that without touching this
  // script's own batch-sweep cadence at all.
  recomputeCompetitionScores,
};
