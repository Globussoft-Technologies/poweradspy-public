'use strict';

/**
 * Delete ads by last_seen YEAR — MySQL (full child-table cascade) + Elasticsearch.
 *
 * An ad is selected when its main-table `last_seen` falls inside the given
 * calendar year: [YYYY-01-01 00:00:00, (YYYY+1)-01-01 00:00:00).
 * (LinkedIn stores last_seen as a UNIX epoch int — handled with UTC epoch bounds.)
 *
 * Safety model:
 *   - DRY-RUN by default: only counts (SQL + ES) are printed, nothing is deleted;
 *   - --apply requires --confirm "DELETE_ADS_BY_YEAR:<years>" (exact);
 *   - SQL-driven, keyset paged by id (never OFFSET) in small batches;
 *   - per batch, inside ONE MySQL transaction:
 *       1. re-select + lock the batch ids that STILL have last_seen in the year
 *          (an ad seen again since selection is skipped, not deleted);
 *       2. delete those ids from Elasticsearch (delete_by_query on the ad-id field);
 *       3. delete child rows + main row in MySQL (the network's OWN
 *          repository.deleteAdCascade table list, replayed as WHERE col IN (...));
 *       4. commit.
 *     ES is deleted before the SQL commit, so a failure never leaves an ES doc
 *     whose SQL row is gone; a re-run picks up anything not finished (rerun-safe);
 *   - --es-sweep (optional) checks ES docs whose last_seen is in the year against
 *     MySQL and deletes only those with NO SQL row (orphans); docs whose SQL row
 *     still exists (stale ES last_seen) are reported, never deleted;
 *   - --limit caps ads per network (use for a small test run first);
 *   - a summary is printed to the console (no files are written).
 *
 * Does NOT touch NAS media files, post-owner ads_count, or TikTok.
 *
 * Usage: node scripts/delete-ads-by-year.js --help
 */

const config = require('../src/config');
const networksConfig = require('../src/config/networks');
const dbManager = require('../src/database/DatabaseManager');

const DEFAULT_BATCH = 500;
const DEFAULT_SLEEP_MS = 100;

// User hide/favourite rows: type 2 = hidden ad, 3 = favourite ad. type 1 = hidden
// ADVERTISER (kept — it must not be un-hidden because one of its ads is deleted).
const HIDDEN_AD_ROWS = 'type IN (2, 3)';

// extraChildDeletes: [table, column, extraWhere?] — tables that store the internal
// ad id but are NOT in the network's repository.deleteAdCascade (found by reading
// the insertion / landers / hide-ads / insights code). They are optional: a table
// or column that doesn't exist in an environment is skipped, not fatal.
//
// sqlLastSeen: 'datetime' | 'epoch'
// esIdField:   ES field holding the internal SQL id
// esIdIsDocId: ES _id === internal id (also match with an `ids` query)
// esLastSeenField: ES field used by the dry-run ES count and --es-sweep
const NETWORKS = {
  facebook: {
    mainTable: 'facebook_ad', sqlLastSeen: 'datetime',
    esIdField: 'facebook_ad.id', esLastSeenField: 'facebook_ad.last_seen',
    repo: '../src/services/facebook/insertion/repository',
    extraChildDeletes: [
      ['facebook_ad_html_lander_content', 'facebook_ad_id'], // landers/repository.js
      ['facebook_ad_outgoing_links', 'facebook_ad_id'],      // landers/repository.js (cascade has old name facebook_ad_outgoing)
      ['facebook_ad_url', 'facebook_ad_id'],                 // landers/repository.js
      ['facebook_meta_ad_budget', 'facebook_ad_id'],         // insertion/repository.js insertBudget
      ['facebook_accounts_activities', 'facebook_ad_id'],    // insertion/repository.js insertAccountActivity
      ['facebook_lib_page_details', 'facebook_ad_id'],       // insertion/repository.js setLibPageAdId
      ['facebook_ad_user_analytics', 'facebook_ad_id'],      // controllers/adInsightsController.js
      ['hidden_ads', 'ad_id', HIDDEN_AD_ROWS],               // controllers/hideAdsController.js
    ],
  },
  instagram: {
    mainTable: 'instagram_ad', sqlLastSeen: 'datetime',
    esIdField: 'instagram_ad.id', esLastSeenField: 'instagram_ad.last_seen',
    repo: '../src/services/instagram/insertion/repository',
    extraChildDeletes: [
      ['instagram_meta_ad_budget', 'instagram_ad_id'],       // insertion/repository.js
      ['instagram_accounts_activities', 'instagram_ad_id'],  // insertion/repository.js
    ],
  },
  youtube: {
    mainTable: 'youtube_ad', sqlLastSeen: 'datetime',
    esIdField: 'id', esIdIsDocId: true, esLastSeenField: 'last_seen',
    repo: '../src/services/youtube/insertion/repository',
    extraChildDeletes: [
      ['youtube_account_activities', 'youtube_ad_id'],       // insertion/repository.js
    ],
  },
  google: {
    mainTable: 'google_text_ad', sqlLastSeen: 'datetime',
    esIdField: 'id', esLastSeenField: 'last_seen',
    repo: '../src/services/google/insertion/repository',
    extraChildDeletes: [
      ['google_accout_activities', 'google_ad_id'],          // insertion/repository.js (table name typo is real)
      ['google_ad_outgoing_links', 'google_text_ad_id'],     // landers/repository.js
      ['google_ad_url', 'google_text_ad_id'],                // landers/repository.js
      ['google_ad_html_lander_content', 'google_text_ad_id'],// landers/repository.js
    ],
  },
  gdn: {
    mainTable: 'gdn_ad', sqlLastSeen: 'datetime',
    esIdField: 'gdn_ad.id', esLastSeenField: 'gdn_ad.last_seen',
    repo: '../src/services/gdn/insertion/repository',
    extraChildDeletes: [
      ['gdn_ad_bug_report', 'ad_id'],                        // FK adid_FKey → gdn_ad.id
      ['gdn_account_activities', 'gdn_ad_id'],               // insertion/repository.js
      ['gdn_ad_outgoing_links', 'gdn_ad_id'],                // landers/repository.js
      ['gdn_hidden_ads', 'ad_id', HIDDEN_AD_ROWS],           // controllers/hideAdsController.js
    ],
  },
  native: {
    mainTable: 'native_ad', sqlLastSeen: 'datetime',
    esIdField: 'native_ad.id', esLastSeenField: 'native_ad.last_seen',
    repo: '../src/services/native/insertion/repository',
    extraChildDeletes: [
      ['native_account_activities', 'native_ad_id'],         // insertion/repository.js
    ],
  },
  linkedin: {
    // SQL last_seen is DATETIME (normalize.js: nowDateTime()); only the ES doc uses epoch seconds.
    mainTable: 'linkedin_ad', sqlLastSeen: 'datetime', esLastSeen: 'epoch',
    esIdField: 'id', esIdIsDocId: true, esLastSeenField: 'last_seen',
    repo: '../src/services/linkedin/insertion/repository',
    extraChildDeletes: [
      ['linkedin_account_activities', 'linkedin_ad_id'],     // insertion/repository.js
    ],
  },
  reddit: {
    mainTable: 'reddit_ad', sqlLastSeen: 'datetime',
    esIdField: 'reddit_ad.id', esIdIsDocId: true, esLastSeenField: 'reddit_ad.last_seen',
    repo: '../src/services/reddit/insertion/repository',
    extraChildDeletes: [
      ['reddit_user_affiliate_ads', 'reddit_ad_id'],         // FK instagram_insta_ad_id → reddit_ad.id
      ['reddit_hidden_ads', 'ad_id', HIDDEN_AD_ROWS],        // controllers/hideAdsController.js
    ],
  },
  quora: {
    mainTable: 'quora_ad', sqlLastSeen: 'datetime',
    esIdField: 'quora_ad.id', esLastSeenField: 'quora_ad.last_seen',
    repo: '../src/services/quora/insertion/repository',
    disableFkChecks: true, // same as quora deletePipeline
    extraChildDeletes: [
      ['quora_ad_outgoing_links', 'quora_ad_id'],            // landers/repository.js
      ['quora_ad_html_lander_content', 'quora_ad_id'],       // landers/repository.js
      ['hidden_ads', 'ad_id', HIDDEN_AD_ROWS],               // controllers/hideAdsController.js
    ],
  },
  pinterest: {
    mainTable: 'pinterest_ad', sqlLastSeen: 'datetime',
    esIdField: 'pinterest_ad.id', esLastSeenField: 'pinterest_ad.last_seen',
    repo: '../src/services/pinterest/insertion/repository',
    extraChildDeletes: [
      ['pinterest_account_activities', 'pinterest_ad_id'],   // insertion/repository.js
    ],
  },
};
const ALL_NETWORKS = Object.keys(NETWORKS);

function usage() {
  return `
Delete ads whose last_seen is in a given year, from MySQL and Elasticsearch.

DRY-RUN (default — counts only, nothing deleted):
  node scripts/delete-ads-by-year.js --year 2019
  node scripts/delete-ads-by-year.js --year 2019,2020 --networks facebook,instagram

SMALL TEST DELETE (e.g. 100 ads per network):
  node scripts/delete-ads-by-year.js --year 2019 --networks facebook --limit 100 --apply --confirm "DELETE_ADS_BY_YEAR:2019"

FULL DELETE:
  node scripts/delete-ads-by-year.js --year 2019 --apply --confirm "DELETE_ADS_BY_YEAR:2019"

Options:
  --year <YYYY[,YYYY...]>   Required. Calendar year(s) of last_seen to delete.
  --networks <csv|all>      Default: all (${ALL_NETWORKS.join(', ')}).
  --apply                   Actually delete. Without it the run is read-only.
  --confirm <phrase>        Must equal DELETE_ADS_BY_YEAR:<years exactly as given to --year>.
  --limit <n>               Max ads to delete per network per year (test runs).
  --batch-size <n>          Ads per SQL transaction / ES delete. Default ${DEFAULT_BATCH} (max 2000).
  --sleep-ms <n>            Pause between batches to protect MySQL/ES. Default ${DEFAULT_SLEEP_MS}.
  --es-sweep                Also check ES docs with last_seen in the year against MySQL: docs with NO SQL
                            row (orphans) are deleted on --apply (reported only in dry-run); docs whose
                            SQL row still exists (stale ES last_seen) are never deleted, only reported.
  --skip-es-count           Skip the ES count in the dry-run (if the ES range query errors).
  --help                    Show this help.
`.trim();
}

// ── args ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const opts = {
    years: [], yearsRaw: '', networks: [...ALL_NETWORKS], apply: false, confirm: null,
    limit: null, batchSize: DEFAULT_BATCH, sleepMs: DEFAULT_SLEEP_MS,
    esSweep: false, skipEsCount: false, help: false,
  };
  const val = (i, flag) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${flag} requires a value.`);
    return v;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--year' || a === '--years') { opts.yearsRaw = val(i++, a); }
    else if (a === '--networks') {
      const v = val(i++, a).toLowerCase();
      opts.networks = v === 'all' ? [...ALL_NETWORKS] : v.split(',').map((s) => s.trim()).filter(Boolean);
    } else if (a === '--apply') opts.apply = true;
    else if (a === '--confirm') opts.confirm = val(i++, a);
    else if (a === '--limit') opts.limit = Number(val(i++, a));
    else if (a === '--batch-size') opts.batchSize = Number(val(i++, a));
    else if (a === '--sleep-ms') opts.sleepMs = Number(val(i++, a));
    else if (a === '--es-sweep') opts.esSweep = true;
    else if (a === '--skip-es-count') opts.skipEsCount = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (opts.help) return opts;

  const thisYear = new Date().getUTCFullYear();
  opts.years = [...new Set(String(opts.yearsRaw).split(',').map((s) => s.trim()).filter(Boolean))];
  if (!opts.years.length) throw new Error('--year is required (e.g. --year 2019).');
  for (const y of opts.years) {
    if (!/^\d{4}$/.test(y) || Number(y) < 2000 || Number(y) > thisYear) {
      throw new Error(`Invalid year "${y}". Use a 4-digit year between 2000 and ${thisYear}.`);
    }
  }
  opts.years = opts.years.map(Number).sort((a, b) => a - b);
  opts.networks = [...new Set(opts.networks)];
  for (const n of opts.networks) {
    if (!NETWORKS[n]) throw new Error(`Unsupported network "${n}". Allowed: ${ALL_NETWORKS.join(', ')}`);
  }
  if (opts.limit !== null && (!Number.isInteger(opts.limit) || opts.limit < 1)) {
    throw new Error('--limit must be a positive integer.');
  }
  if (!Number.isInteger(opts.batchSize) || opts.batchSize < 1 || opts.batchSize > 2000) {
    throw new Error('--batch-size must be an integer from 1 to 2000.');
  }
  if (!Number.isInteger(opts.sleepMs) || opts.sleepMs < 0) throw new Error('--sleep-ms must be >= 0.');
  return opts;
}

function confirmPhrase(opts) {
  return `DELETE_ADS_BY_YEAR:${opts.yearsRaw}`;
}

// ── helpers ─────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const unwrap = (res) => (res && res.body !== undefined ? res.body : res);

function yearBounds(year, kind) {
  if (kind === 'epoch') {
    return { from: Math.floor(Date.UTC(year, 0, 1) / 1000), to: Math.floor(Date.UTC(year + 1, 0, 1) / 1000) };
  }
  return { from: `${year}-01-01 00:00:00`, to: `${year + 1}-01-01 00:00:00` };
}

function esLastSeenRange(spec, year) {
  if ((spec.esLastSeen || spec.sqlLastSeen) === 'epoch') {
    const b = yearBounds(year, 'epoch');
    return { range: { [spec.esLastSeenField]: { gte: b.from, lt: b.to } } };
  }
  const b = yearBounds(year, 'datetime');
  return { range: { [spec.esLastSeenField]: { gte: b.from, lt: b.to, format: 'yyyy-MM-dd HH:mm:ss' } } };
}

function esIdsQuery(spec, ids) {
  const should = [{ terms: { [spec.esIdField]: ids } }];
  if (spec.esIdIsDocId) should.push({ ids: { values: ids.map(String) } });
  return { bool: { should, minimum_should_match: 1 } };
}

function scopedNetworkConfig(names) {
  const scoped = {};
  for (const name of names) {
    const original = networksConfig[name];
    scoped[name] = {
      ...original,
      enabled: true,
      database: { sql: original?.database?.sql, elastic: original?.database?.elastic },
    };
  }
  return scoped;
}

const SIMPLE_DELETE = /^DELETE FROM (`?[\w.]+`?) WHERE (`?\w+`?) = \?$/i;
const PROBE_ID = -987654321;

/**
 * Records the network's own repository.deleteAdCascade (no DB touched) and
 * returns its statements as [{ table, col }], main table last. Throws if the
 * cascade is not plain single-id DELETEs (then it can't be safely batched).
 */
async function cascadeStatements(network, spec, repo) {
  const recorded = [];
  const recorder = {
    query: async (sql, params) => {
      recorded.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      return { affectedRows: 1 };
    },
  };
  await repo.deleteAdCascade(recorder, PROBE_ID);
  const out = [];
  const seen = new Set();
  for (const r of recorded) {
    const m = r.sql.match(SIMPLE_DELETE);
    if (!m || !Array.isArray(r.params) || r.params.length !== 1 || r.params[0] !== PROBE_ID) {
      throw new Error(`[${network}] deleteAdCascade has an unexpected statement: ${r.sql}`);
    }
    out.push({ table: m[1], col: m[2] });
    seen.add(`${m[1]}.${m[2]}`.replace(/`/g, '').toLowerCase());
  }
  // Extras go first (they're children); skip any already in the repository cascade.
  const extras = (spec.extraChildDeletes || [])
    .filter(([table, col]) => !seen.has(`${table}.${col}`.toLowerCase()))
    .map(([table, col, where]) => ({
      table, col, where: where || null, optional: true,
      // hidden-ads tables: rows NOT deleted (type 1 = hidden advertiser) get ad_id = NULL,
      // so an FK on ad_id (e.g. gdn_hidden_ads.ad_jd_FK) can't block the main delete.
      keepOthersUnlinked: where === HIDDEN_AD_ROWS,
    }));
  out.unshift(...extras);
  const last = out[out.length - 1];
  if (!last || last.table.replace(/`/g, '') !== spec.mainTable || last.col.replace(/`/g, '') !== 'id') {
    throw new Error(`[${network}] deleteAdCascade does not end with DELETE FROM ${spec.mainTable} WHERE id = ?`);
  }
  return out;
}

/**
 * Read-only: every table in this DB with a FOREIGN KEY → <mainTable>.id. Any FK
 * child not already in the cascade is added before the main-table delete, so a
 * missing child table (as in gdn_ad_bug_report / reddit_user_affiliate_ads)
 * can't block the delete. Returns the tables that were added.
 */
async function addMissingFkChildren(sql, spec, statements) {
  const rows = await sql.query(
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE REFERENCED_TABLE_SCHEMA = DATABASE()
        AND REFERENCED_TABLE_NAME = ?
        AND REFERENCED_COLUMN_NAME = 'id'`,
    [spec.mainTable]
  );
  const have = new Set(statements.map((s) => `${s.table.replace(/`/g, '')}.${s.col.replace(/`/g, '')}`.toLowerCase()));
  const added = [];
  for (const r of rows) {
    const table = r.t || r.TABLE_NAME;
    const col = r.c || r.COLUMN_NAME;
    if (!/^\w+$/.test(table) || !/^\w+$/.test(col) || table === spec.mainTable) continue;
    if (have.has(`${table}.${col}`.toLowerCase())) continue;
    statements.splice(statements.length - 1, 0, { table: `\`${table}\``, col: `\`${col}\`` });
    have.add(`${table}.${col}`.toLowerCase());
    added.push(`${table}.${col}`);
  }
  return added;
}

// ── counts (dry-run) ────────────────────────────────────────────────────────

async function sqlCount(sql, spec, year) {
  const b = yearBounds(year, spec.sqlLastSeen);
  const rows = await sql.query(
    `SELECT COUNT(*) AS c, MIN(id) AS min_id, MAX(id) AS max_id
       FROM ${spec.mainTable}
      WHERE last_seen >= ? AND last_seen < ?`,
    [b.from, b.to]
  );
  const r = rows[0] || {};
  return { count: Number(r.c || 0), minId: r.min_id ?? null, maxId: r.max_id ?? null };
}

async function esCount(elastic, spec, year) {
  const res = unwrap(await elastic.client.count({
    index: elastic.indexName,
    body: { query: esLastSeenRange(spec, year) },
  }));
  return Number(res.count || 0);
}

// ── delete ──────────────────────────────────────────────────────────────────

async function selectBatch(sql, spec, year, afterId, size) {
  const b = yearBounds(year, spec.sqlLastSeen);
  // LIMIT is inlined (validated integer) — mysql2 execute() rejects a bound LIMIT on some servers.
  return sql.query(
    `SELECT id FROM ${spec.mainTable}
      WHERE id > ? AND last_seen >= ? AND last_seen < ?
      ORDER BY id ASC
      LIMIT ${Number(size)}`,
    [afterId, b.from, b.to]
  );
}

async function deleteBatch({ network, spec, db, statements, year, ids }) {
  const b = yearBounds(year, spec.sqlLastSeen);
  const conn = await db.sql.getConnection();
  const q = async (s, p) => (await conn.execute(s, p))[0];
  let fkOff = false;
  try {
    await conn.beginTransaction();
    if (spec.disableFkChecks) { await conn.query('SET FOREIGN_KEY_CHECKS=0'); fkOff = true; }

    // 1. lock + re-verify: only ids whose last_seen is STILL in the year.
    const marks = ids.map(() => '?').join(',');
    const locked = await q(
      `SELECT id FROM ${spec.mainTable}
        WHERE id IN (${marks}) AND last_seen >= ? AND last_seen < ?
        FOR UPDATE`,
      [...ids, b.from, b.to]
    );
    const keep = locked.map((r) => r.id);
    if (!keep.length) {
      await conn.commit();
      return { sql: 0, es: 0, skipped: ids.length };
    }

    // 2. MySQL cascade (children first, main row last) — not committed yet.
    //    Runs BEFORE ES, so an SQL error (e.g. FK) aborts with ES untouched.
    const keepMarks = keep.map(() => '?').join(',');
    let mainDeleted = 0;
    for (const { table, col, where, optional, keepOthersUnlinked } of statements) {
      try {
        if (keepOthersUnlinked && where) {
          try {
            await q(`UPDATE ${table} SET ${col} = NULL WHERE ${col} IN (${keepMarks}) AND NOT (${where})`, keep);
          } catch (err) {
            // column is NOT NULL in this env → those rows must go too, or the FK blocks the ad delete.
            if (err && (err.errno === 1048 || err.errno === 1263 || err.code === 'ER_BAD_NULL_ERROR' || err.code === 'WARN_DATA_TRUNCATED')) {
              await q(`DELETE FROM ${table} WHERE ${col} IN (${keepMarks})`, keep);
              continue;
            }
            throw err;
          }
        }
        const r = await q(`DELETE FROM ${table} WHERE ${col} IN (${keepMarks})${where ? ` AND ${where}` : ''}`, keep);
        if (table.replace(/`/g, '') === spec.mainTable) mainDeleted = Number(r?.affectedRows || 0);
      } catch (err) {
        if (err && (err.errno === 1146 || err.code === 'ER_NO_SUCH_TABLE')) continue; // table absent in this env
        // optional extra whose column differs in this env (ER_BAD_FIELD_ERROR) — skip, don't fail the batch
        if (optional && err && (err.errno === 1054 || err.code === 'ER_BAD_FIELD_ERROR')) continue;
        throw err;
      }
    }

    // 3. Elasticsearch (SQL tx still open) — if it fails, the SQL deletes are rolled back.
    const esRes = unwrap(await db.elastic.client.deleteByQuery({
      index: db.elastic.indexName,
      conflicts: 'proceed',
      refresh: false,
      wait_for_completion: true,
      body: { query: esIdsQuery(spec, keep) },
    }));
    if (Array.isArray(esRes.failures) && esRes.failures.length) {
      throw new Error(`ES delete_by_query reported ${esRes.failures.length} failure(s): ${JSON.stringify(esRes.failures[0])}`);
    }

    // 4. commit.
    if (fkOff) { await conn.query('SET FOREIGN_KEY_CHECKS=1'); fkOff = false; }
    await conn.commit();
    return { sql: mainDeleted, es: Number(esRes.deleted || 0), skipped: ids.length - keep.length };
  } catch (err) {
    try { await conn.rollback(); } catch { /* keep original error */ }
    throw new Error(`[${network}] batch ${ids[0]}..${ids[ids.length - 1]} failed (rolled back): ${err.message}`);
  } finally {
    if (fkOff) { try { await conn.query('SET FOREIGN_KEY_CHECKS=1'); } catch { /* ignore */ } }
    conn.release();
  }
}

async function deleteYear({ network, spec, db, statements, year, opts }) {
  const res = { year, sqlDeleted: 0, esDeleted: 0, skippedSeenAgain: 0, batches: 0, esSweepDeleted: 0 };
  let afterId = 0;
  const started = Date.now();
  for (;;) {
    const remaining = opts.limit === null ? opts.batchSize : Math.min(opts.batchSize, opts.limit - res.sqlDeleted);
    if (remaining <= 0) break;
    const rows = await selectBatch(db.sql, spec, year, afterId, remaining);
    if (!rows.length) break;
    const ids = rows.map((r) => r.id);
    afterId = ids[ids.length - 1];

    const r = await deleteBatch({ network, spec, db, statements, year, ids });
    res.sqlDeleted += r.sql;
    res.esDeleted += r.es;
    res.skippedSeenAgain += r.skipped;
    res.batches += 1;
    const secs = Math.round((Date.now() - started) / 1000);
    console.log(`[${network}] ${year} batch ${res.batches}: up to id ${afterId} | SQL deleted ${res.sqlDeleted} | ES deleted ${res.esDeleted} | skipped ${res.skippedSeenAgain} | ${secs}s`);
    if (opts.sleepMs) await sleep(opts.sleepMs);
  }

  await db.elastic.client.indices.refresh({ index: db.elastic.indexName }).catch(() => {});
  return res;
}

function sourceValue(source, field) {
  if (!source || typeof source !== 'object') return undefined;
  if (Object.prototype.hasOwnProperty.call(source, field)) return source[field]; // flat dotted key
  return field.split('.').reduce((v, k) => (v == null ? undefined : v[k]), source);
}

/**
 * ES docs with last_seen in the year, checked one page at a time against MySQL:
 *   - orphan = no SQL row with that id (or no id at all) → deleted when apply=true;
 *   - stale  = SQL row EXISTS (its SQL last_seen is another year; ES wasn't
 *              updated) → NEVER deleted, only reported with samples.
 */
async function esOrphanSweep({ network, spec, db, year, apply }) {
  const client = db.elastic.client;
  const index = db.elastic.indexName;
  const out = { esInRange: 0, orphans: 0, orphanDeleted: 0, stale: 0, staleSamples: [], orphanSamples: [] };
  let page = unwrap(await client.search({
    index, scroll: '2m', size: 1000,
    body: { query: esLastSeenRange(spec, year), sort: ['_doc'], _source: [spec.esIdField, spec.esLastSeenField] },
  }));
  let scrollId = page._scroll_id;
  try {
    for (;;) {
      const hits = page?.hits?.hits || [];
      if (!hits.length) break;
      out.esInRange += hits.length;

      const ids = [...new Set(hits.map((h) => sourceValue(h._source, spec.esIdField))
        .filter((v) => v !== undefined && v !== null && v !== '' && /^\d+$/.test(String(v))).map(Number))];
      const existing = new Map();
      if (ids.length) {
        const rows = await db.sql.query(
          `SELECT id, last_seen FROM ${spec.mainTable} WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
        for (const r of rows) existing.set(Number(r.id), r.last_seen);
      }

      const orphanHits = [];
      for (const h of hits) {
        const raw = sourceValue(h._source, spec.esIdField);
        const id = raw !== undefined && raw !== null && /^\d+$/.test(String(raw)) ? Number(raw) : null;
        if (id !== null && existing.has(id)) {
          out.stale += 1;
          if (out.staleSamples.length < 10) {
            out.staleSamples.push({ id, esLastSeen: sourceValue(h._source, spec.esLastSeenField), sqlLastSeen: existing.get(id) });
          }
        } else {
          orphanHits.push(h);
          if (out.orphanSamples.length < 10) out.orphanSamples.push({ _id: h._id, id: raw ?? null, esLastSeen: sourceValue(h._source, spec.esLastSeenField) });
        }
      }
      out.orphans += orphanHits.length;

      if (apply && orphanHits.length) {
        const body = [];
        for (const h of orphanHits) {
          const action = { _index: h._index || index, _id: h._id };
          if (db.elastic.esMajor && db.elastic.esMajor < 7 && h._type) action._type = h._type;
          body.push({ delete: action });
        }
        const bulk = unwrap(await client.bulk({ refresh: false, body }));
        const failed = (bulk.items || []).map((i) => i.delete).filter((d) => d && d.status >= 300 && d.status !== 404);
        if (failed.length) throw new Error(`ES orphan bulk delete failed for ${failed.length} doc(s): ${JSON.stringify(failed[0].error || failed[0])}`);
        out.orphanDeleted += orphanHits.length;
      }

      if (!scrollId) break;
      page = unwrap(await client.scroll({ scroll_id: scrollId, scroll: '2m' }));
      scrollId = page._scroll_id || scrollId;
    }
  } finally {
    if (scrollId) await client.clearScroll({ scroll_id: scrollId }).catch(() => {});
  }
  if (apply && out.orphanDeleted) await client.indices.refresh({ index }).catch(() => {});
  console.log(`[${network}] ${year} ES sweep: in range ${out.esInRange} | orphans (no SQL row) ${out.orphans}`
    + `${apply ? ` → deleted ${out.orphanDeleted}` : ' (dry-run, not deleted)'} | stale (SQL row exists, kept) ${out.stale}`);
  if (out.orphanSamples.length) console.log(`[${network}] ${year} orphan samples: ${JSON.stringify(out.orphanSamples)}`);
  if (out.staleSamples.length) console.log(`[${network}] ${year} stale samples (NOT deleted): ${JSON.stringify(out.staleSamples)}`);
  return out;
}

// ── main ────────────────────────────────────────────────────────────────────

async function main(argv = process.argv.slice(2)) {
  const opts = parseArgs(argv);
  if (opts.help) { console.log(usage()); return { code: 0 }; }

  if (opts.apply && opts.confirm !== confirmPhrase(opts)) {
    throw new Error(`Refusing --apply: --confirm must exactly equal "${confirmPhrase(opts)}".`);
  }

  console.log('='.repeat(78));
  console.log(`Mode      : ${opts.apply ? 'APPLY (DELETING)' : 'DRY-RUN (read-only)'}`);
  console.log(`Env       : ${config.env || 'unset'}`);
  console.log(`Years     : ${opts.years.join(', ')}  (by last_seen)`);
  console.log(`Networks  : ${opts.networks.join(', ')}`);
  if (opts.apply) console.log(`Batch     : ${opts.batchSize}  sleep ${opts.sleepMs}ms  limit ${opts.limit ?? 'none'}  es-sweep ${opts.esSweep}`);
  console.log('='.repeat(78));

  // Prepare cascades before connecting (pure, no DB) so a bad cascade aborts early.
  const prepared = {};
  for (const network of opts.networks) {
    const spec = NETWORKS[network];
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const repo = require(spec.repo);
    prepared[network] = { spec, statements: await cascadeStatements(network, spec, repo) };
  }

  await dbManager.connectAll(scopedNetworkConfig(opts.networks));
  const report = { startedAt: new Date().toISOString(), mode: opts.apply ? 'apply' : 'dry-run', env: config.env, years: opts.years, networks: {} };

  try {
    for (const network of opts.networks) {
      const { spec, statements } = prepared[network];
      const db = dbManager.getConnections(network);
      const dbName = networksConfig[network]?.database?.sql?.database || '?';
      if (!db?.sql || !db?.elastic) {
        console.error(`[${network}] SKIPPED — SQL or ES connection unavailable.`);
        report.networks[network] = { error: 'connection unavailable' };
        continue;
      }
      report.networks[network] = { database: dbName, esIndex: db.elastic.indexName, mainTable: spec.mainTable, years: {} };
      console.log(`\n[${network}] db=${dbName} table=${spec.mainTable} es=${db.elastic.indexName}`);
      try {
        const added = await addMissingFkChildren(db.sql, spec, statements);
        if (added.length) console.log(`[${network}] added FK child table(s) missing from deleteAdCascade: ${added.join(', ')}`);
        report.networks[network].fkChildrenAdded = added;
      } catch (e) {
        console.warn(`[${network}] FK discovery skipped (${e.message}) — using the declared cascade only.`);
      }
      console.log(`[${network}] cascade tables: ${statements.map((s) => s.table.replace(/`/g, '')).join(', ')}`);

      for (const year of opts.years) {
        const entry = {};
        try {
          const c = await sqlCount(db.sql, spec, year);
          entry.sqlCount = c.count;
          entry.minId = c.minId;
          entry.maxId = c.maxId;
          if (!opts.skipEsCount) {
            try { entry.esCountByLastSeen = await esCount(db.elastic, spec, year); }
            catch (e) { entry.esCountError = e.message; }
          }
          console.log(`[${network}] ${year}: SQL ads=${c.count} (ids ${c.minId ?? '-'}..${c.maxId ?? '-'})`
            + `${entry.esCountByLastSeen !== undefined ? ` | ES docs by last_seen=${entry.esCountByLastSeen}` : ''}`
            + `${entry.esCountError ? ` | ES count error: ${entry.esCountError}` : ''}`);

          if (opts.apply && c.count > 0) {
            Object.assign(entry, await deleteYear({ network, spec, db, statements, year, opts }));
            console.log(`[${network}] ${year}: DONE — SQL deleted ${entry.sqlDeleted}, ES deleted ${entry.esDeleted}, skipped (seen again) ${entry.skippedSeenAgain}`);
          }
          // Runs in dry-run too (report only) and even when SQL=0 — that's exactly the orphan case.
          if (opts.esSweep && opts.limit === null) {
            entry.esSweep = await esOrphanSweep({ network, spec, db, year, apply: opts.apply });
            entry.esSweepDeleted = entry.esSweep.orphanDeleted;
          }
        } catch (err) {
          entry.error = err.message;
          console.error(`[${network}] ${year}: ERROR — ${err.message}`);
        }
        report.networks[network].years[year] = entry;
      }
    }
  } finally {
    await dbManager.disconnectAll().catch(() => {});
  }

  report.finishedAt = new Date().toISOString();

  console.log(`\n${'='.repeat(78)}\nSUMMARY (${report.mode})`);
  for (const [network, r] of Object.entries(report.networks)) {
    for (const [year, e] of Object.entries(r.years || {})) {
      const parts = [`SQL=${e.sqlCount ?? '-'}`];
      if (e.esCountByLastSeen !== undefined) parts.push(`ES(by last_seen)=${e.esCountByLastSeen}`);
      if (opts.apply) parts.push(`deleted SQL=${e.sqlDeleted ?? 0} ES=${e.esDeleted ?? 0}`);
      if (e.esSweep) parts.push(`sweep: orphans=${e.esSweep.orphans}${opts.apply ? ` deleted=${e.esSweep.orphanDeleted}` : ''} stale(kept)=${e.esSweep.stale}`);
      if (e.error) parts.push(`ERROR: ${e.error}`);
      console.log(`  ${network.padEnd(10)} ${year}  ${parts.join('  ')}`);
    }
    if (r.error) console.log(`  ${network.padEnd(10)} ERROR: ${r.error}`);
  }
  if (!opts.apply) console.log(`\nNothing was deleted. To delete, re-run with: --apply --confirm "${confirmPhrase(opts)}"`);

  const failed = Object.values(report.networks).some((r) => r.error || Object.values(r.years || {}).some((e) => e.error));
  return { code: failed ? 1 : 0 };
}

module.exports = { NETWORKS, parseArgs, confirmPhrase, yearBounds, esIdsQuery, esLastSeenRange, cascadeStatements, main };

if (require.main === module) {
  main().then(
    (r) => { process.exitCode = r.code; },
    (err) => { console.error(err.message); process.exitCode = 1; }
  );
}
