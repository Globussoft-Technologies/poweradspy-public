'use strict';

/**
 * Refresh `keyword_stats` — the per-keyword rollup that backs the Keywords
 * Explorer table (POST /api/v1/google/keywords/explorer). Browsing/filtering/
 * sorting thousands of keyword rows isn't viable as a live per-request ES
 * aggregation over a 200M+ doc index, so this job pre-computes it, the same
 * way `backfillKeywordAggregates.js` pre-computes `keyword_advertiser` /
 * `keyword_domain` — a paginated ES *composite* aggregation, single source
 * this time (`target_keyword` only, not a pair), swept once per run.
 *
 * All metrics here are proxies derived from the crawled ad corpus, NOT real
 * Google search volume / backlink-based Keyword Difficulty — no third-party
 * keyword-data provider is used or licensed. See GOOGLE_COMPETITIVE_INTEL_FEATURE.md.
 *   ads_total / advertisers_total / domains_total → distinct-cardinality counts
 *   ads_30d / ads_prior_30d / growth_pct          → trailing vs. prior 30-day window
 *   competition_score                             → 0-100 percentile rank of
 *                                                    advertisers_total across the
 *                                                    whole rollup (computed in a
 *                                                    second pass after the sweep)
 *   category / sub_category / top_country / type_mix / position_top_pct →
 *                                                    majority-vote buckets from
 *                                                    already-crawled taxonomy fields
 *
 * Mapping → ids: a keyword string can map to several `google_text_keywords.id`
 * (one per country — the corpus has no country-split aggregation here), so the
 * same computed row is written under every matching id, exactly like the
 * Tier-2 backfill job.
 *
 * Cost control: by default the base query is scoped to `last_seen >= now -
 * LOOKBACK_MONTHS months` so cold/dead keywords are skipped rather than
 * sweeping the full 200M+ doc history every run. Pass --full for an
 * occasional complete rebuild.
 *
 * SAFETY: dry-run by default (computes + reports, writes nothing). Pass
 * --commit to write. Refuses to write into a non-empty table unless --truncate
 * is given (same contract as backfillKeywordAggregates.js).
 *
 * Usage:
 *   node src/services/google/jobs/refreshKeywordStats.js                 # dry run, trailing 18mo
 *   node src/services/google/jobs/refreshKeywordStats.js --commit --truncate
 *   node ... --full                    # no lookback filter, sweep entire history
 *   node ... --batch=200 --limit=5000  # composite page size / cap keywords (testing)
 */

require('dotenv').config();
const databaseManager = require('../../../database/DatabaseManager');
const networksConfig = require('../../../config/networks');
const {
  buildBaseQuery,
  readAggs,
  AGG_FIELD,
  UNIQUE_ADS,
  UNIQUE_ADVERTISERS,
  UNIQUE_DOMAINS,
  last2WindowAggs,
  majorityTermsAgg,
  majorityBucketKey,
} = require('../helpers/aggregations');

const NETWORK = 'google';
const LOOKBACK_MONTHS = 18;
const INSERT_FLUSH = 500;

function log(...a) { console.log('[refresh-keyword-stats]', ...a); }

function parseArgs(argv) {
  const args = { commit: false, truncate: false, full: false, batch: 200, limit: 0 };
  for (const a of argv.slice(2)) {
    if (a === '--commit') args.commit = true;
    else if (a === '--truncate') args.truncate = true;
    else if (a === '--full') args.full = true;
    else if (a.startsWith('--batch=')) args.batch = parseInt(a.split('=')[1], 10) || 200;
    else if (a.startsWith('--limit=')) args.limit = parseInt(a.split('=')[1], 10) || 0;
  }
  return args;
}

function ymd(d) { return d.toISOString().slice(0, 10); }

function buildScopedQuery(index, full) {
  if (full) return buildBaseQuery({}, index);
  const to = new Date();
  const from = new Date(to.getTime());
  from.setMonth(from.getMonth() - LOOKBACK_MONTHS);
  return buildBaseQuery({ from_date: ymd(from), to_date: ymd(to) }, index);
}

// Map of keyword(lower) → [keyword_id, ...] — a string can map to several ids
// (one per country); a row is written for each, same as the Tier-2 backfill.
async function loadKeywordMap(sql) {
  const rows = await sql.query('SELECT id, LOWER(TRIM(keyword)) AS k FROM google_text_keywords WHERE keyword IS NOT NULL');
  const map = new Map();
  for (const r of rows) {
    if (!r.k) continue;
    const arr = map.get(r.k);
    if (arr) arr.push(r.id);
    else map.set(r.k, [r.id]);
  }
  return map;
}

function pct(part, whole) {
  if (!whole) return null;
  return Math.round((part / whole) * 10000) / 100; // 2 decimal places
}

function growthPct(ads30, adsPrior30) {
  if (!adsPrior30) return null;
  return Math.round(((ads30 - adsPrior30) / adsPrior30) * 10000) / 100;
}

// Buffered upsert writer for keyword_stats — bulk INSERT ... ON DUPLICATE KEY
// UPDATE so re-running the job (e.g. nightly) refreshes existing rows in place.
function makeStatsWriter(sql, commit) {
  const cols = [
    'keyword_id', 'ads_total', 'advertisers_total', 'domains_total',
    'ads_30d', 'ads_prior_30d', 'growth_pct', 'category', 'sub_category',
    'top_country', 'type_mix', 'position_top_pct', 'first_seen', 'last_seen',
  ];
  let buffer = [];
  let written = 0;
  async function flush() {
    if (!buffer.length) return;
    if (commit) {
      const placeholders = buffer.map(() => `(${cols.map(() => '?').join(', ')}, NOW())`).join(', ');
      const params = [];
      for (const row of buffer) for (const c of cols) params.push(row[c] ?? null);
      const updateCols = cols.filter((c) => c !== 'keyword_id').map((c) => `${c} = VALUES(${c})`).join(', ');
      await sql.query(
        `INSERT INTO keyword_stats (${cols.join(', ')}, updated_at) VALUES ${placeholders}
         ON DUPLICATE KEY UPDATE ${updateCols}, updated_at = VALUES(updated_at)`,
        params
      );
    }
    written += buffer.length;
    buffer = [];
  }
  return {
    async add(row) { buffer.push(row); if (buffer.length >= INSERT_FLUSH) await flush(); },
    async done() { await flush(); return written; },
  };
}

// Paginated composite sweep on target_keyword alone. Calls onBucket(row) per keyword.
async function sweep(elastic, index, query, pageSize, limit, onBucket) {
  const sources = [{ kw: { terms: { field: AGG_FIELD.keyword } } }];
  const windows = last2WindowAggs('last_seen');
  let after = null;
  let total = 0;
  let pages = 0;
  for (;;) {
    const composite = { size: pageSize, sources };
    if (after) composite.after = after;
    const res = await elastic.search({
      index,
      body: {
        size: 0,
        track_total_hits: false,
        query,
        aggs: {
          pairs: {
            composite,
            aggs: {
              ads: UNIQUE_ADS,
              advertisers: UNIQUE_ADVERTISERS,
              domains: UNIQUE_DOMAINS,
              category_terms: majorityTermsAgg('category'),
              sub_category_terms: majorityTermsAgg('subCategory'),
              type_terms: majorityTermsAgg('type', 5),
              country_terms: majorityTermsAgg(AGG_FIELD.country, 3),
              position_terms: majorityTermsAgg(AGG_FIELD.position, 5),
              first_seen: { min: { field: 'first_seen' } },
              last_seen: { max: { field: 'last_seen' } },
              ...windows,
            },
          },
        },
      },
    });
    const agg = readAggs(res)?.pairs;
    const buckets = agg?.buckets || [];
    if (!buckets.length) break;
    for (const b of buckets) {
      const positionBuckets = b.position_terms?.buckets || [];
      const topBucket = positionBuckets.find((pb) => String(pb.key).toUpperCase() === 'TOP');
      const positionTotal = positionBuckets.reduce((s, pb) => s + pb.doc_count, 0);
      const ads30 = b.ads_30d?.ads?.value ?? 0;
      const adsPrior30 = b.ads_prior_30d?.ads?.value ?? 0;
      const typeBuckets = (b.type_terms?.buckets || []).map((tb) => String(tb.key).toUpperCase());

      await onBucket({
        kw: b.key.kw,
        ads_total: b.ads?.value ?? 0,
        advertisers_total: b.advertisers?.value ?? 0,
        domains_total: b.domains?.value ?? 0,
        ads_30d: ads30,
        ads_prior_30d: adsPrior30,
        growth_pct: growthPct(ads30, adsPrior30),
        category: majorityBucketKey(b.category_terms?.buckets),
        sub_category: majorityBucketKey(b.sub_category_terms?.buckets),
        top_country: majorityBucketKey(b.country_terms?.buckets),
        type_mix: JSON.stringify({
          text: typeBuckets.includes('TEXT'),
          image: typeBuckets.includes('IMAGE'),
          video: typeBuckets.includes('VIDEO'),
        }),
        position_top_pct: pct(topBucket?.doc_count ?? 0, positionTotal),
        first_seen: b.first_seen?.value_as_string ? String(b.first_seen.value_as_string).slice(0, 10) : null,
        last_seen: b.last_seen?.value_as_string ? String(b.last_seen.value_as_string).slice(0, 10) : null,
      });
      total++;
      if (limit && total >= limit) return total;
    }
    after = agg?.after_key || null;
    pages++;
    if (pages % 25 === 0) log(`  …${total} keywords swept (${pages} pages)`);
    if (!after) break;
  }
  return total;
}

// Second pass: 0-100 percentile rank of advertisers_total across the whole
// table. Done in JS (not a SQL window function) so this doesn't assume a
// MySQL version with PERCENT_RANK() support; grouped by rounded score so this
// is at most 101 UPDATE statements regardless of table size.
async function computeCompetitionScores(sql, commit) {
  const rows = await sql.query('SELECT keyword_id, advertisers_total FROM keyword_stats ORDER BY advertisers_total ASC');
  if (!rows.length) return 0;
  const n = rows.length;
  const byScore = new Map();
  rows.forEach((r, i) => {
    const rank = n === 1 ? 100 : Math.round((i / (n - 1)) * 100);
    if (!byScore.has(rank)) byScore.set(rank, []);
    byScore.get(rank).push(r.keyword_id);
  });
  if (!commit) return n;
  for (const [score, ids] of byScore) {
    const placeholders = ids.map(() => '?').join(', ');
    await sql.query(`UPDATE keyword_stats SET competition_score = ? WHERE keyword_id IN (${placeholders})`, [score, ...ids]);
  }
  return n;
}

/**
 * Core run function — usable both by the CLI entrypoint below (which owns the
 * DB connection lifecycle) and by the cron registry (which runs inside the
 * already-connected server process; see src/jobs/cronManager.js).
 *
 * `args` = { commit, truncate, full, batch, limit } (defaults applied — see parseArgs).
 */
async function runKeywordStatsRefresh(args = {}) {
  const opts = { commit: false, truncate: false, full: false, batch: 200, limit: 0, ...args };
  log(`mode=${opts.commit ? 'COMMIT' : 'DRY-RUN'} scope=${opts.full ? 'FULL' : `trailing ${LOOKBACK_MONTHS}mo`} batch=${opts.batch}${opts.limit ? ` limit=${opts.limit}` : ''}${opts.truncate ? ' truncate' : ''}`);

  const sql = databaseManager.getSQL(NETWORK);
  const elastic = databaseManager.getElastic(NETWORK);
  if (!sql || !elastic) throw new Error('google SQL/Elastic connection unavailable');
  const index = elastic.indexName || process.env.GOOG_ELASTIC_INDEX || 'google_ads_data';

  if (opts.commit) {
    const [{ c: existing }] = await sql.query('SELECT COUNT(*) AS c FROM keyword_stats');
    if (existing > 0 && !opts.truncate) {
      log(`no --truncate: refreshing ${existing} existing rows in place via upsert (rows for keywords outside this run's scope are left untouched — pass --truncate for a clean rebuild).`);
    } else if (existing > 0 && opts.truncate) {
      log(`TRUNCATE keyword_stats (${existing} rows)`);
      await sql.query('TRUNCATE TABLE keyword_stats');
    }
  }

  const query = buildScopedQuery(index, opts.full);
  const keywordMap = await loadKeywordMap(sql);
  log(`loaded ${keywordMap.size} distinct keyword strings from google_text_keywords`);

  const stats = { keywords: 0, rows: 0, unmapped: 0 };
  const sampleRows = [];
  const writer = makeStatsWriter(sql, opts.commit);

  await sweep(elastic, index, query, opts.batch, opts.limit, async (row) => {
    stats.keywords++;
    const kwIds = keywordMap.get((row.kw || '').toLowerCase());
    if (!kwIds) { stats.unmapped++; return; }
    for (const keyword_id of kwIds) {
      stats.rows++;
      const record = { keyword_id, ...row };
      delete record.kw;
      if (sampleRows.length < 8) sampleRows.push({ kw: row.kw, keyword_id, ads_total: row.ads_total, advertisers_total: row.advertisers_total, growth_pct: row.growth_pct });
      await writer.add(record);
    }
  });

  const written = await writer.done();
  log(`keywords=${stats.keywords} → rows=${stats.rows} (skipped: ${stats.unmapped} unmapped-keyword)`);
  log(`${opts.commit ? 'UPSERTED' : 'WOULD UPSERT'} ${written} rows into keyword_stats`);
  log('sample:', JSON.stringify(sampleRows.slice(0, 5)));

  const scored = await computeCompetitionScores(sql, opts.commit);
  log(`${opts.commit ? 'COMPUTED' : 'WOULD COMPUTE'} competition_score percentile rank over ${scored} rows`);

  return { ...stats, written, scored };
}

// CLI entrypoint — owns the connect/disconnect lifecycle; not used by the cron.
if (require.main === module) {
  const args = parseArgs(process.argv);
  databaseManager.connectAll(networksConfig)
    .then(() => runKeywordStatsRefresh(args))
    .then(() => databaseManager.disconnectAll())
    .then(() => log('done.'))
    .catch((err) => {
      console.error('[refresh-keyword-stats] FATAL', err);
      databaseManager.disconnectAll().finally(() => process.exit(1));
    });
}

module.exports = { parseArgs, growthPct, pct, runKeywordStatsRefresh };
