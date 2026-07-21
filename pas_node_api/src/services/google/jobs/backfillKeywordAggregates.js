'use strict';

/**
 * Backfill `keyword_advertiser` and `keyword_domain` from the google_ads_data
 * corpus (Tier-2). These tables join a keyword to the advertisers / landing
 * domains that bid on it, with a per-pair ad `count` — the foundation for
 * keyword-gap and competitor analysis. They ship empty; this job populates them.
 *
 * Strategy: a single paginated ES *composite* aggregation per target table
 * (target_keyword × post_owner_lower, target_keyword × domain) sweeps every
 * (keyword, advertiser|domain) pair in one exhaustive pass — far cheaper than a
 * per-keyword query. Each pair's `count` is the distinct-ad cardinality (same
 * semantic as /keywords/insight), or raw doc_count in --count-mode=doc_count.
 * The base query reuses the search builder's exclusions (ORGANIC SEARCH +
 * IMAGE-without-NAS) so counts line up with the product's keyword surfaces.
 *
 * Mapping → ids:
 *   - keyword string → google_text_keywords.id (a string can map to several ids,
 *     one per country; a row is written for each — the table has no country col)
 *   - post_owner_lower → google_text_ad_post_owners.id
 *   - domain          → google_text_ad_domains.id
 * Pairs whose keyword/advertiser/domain are absent from the master tables are
 * skipped and counted (these include the URL/empty junk in target_keyword).
 *
 * SAFETY: dry-run by default (computes + reports, writes nothing). Pass --commit
 * to insert. Refuses to write a non-empty table unless --truncate is given.
 *
 * Usage:
 *   node src/services/google/jobs/backfillKeywordAggregates.js              # dry run, both tables
 *   node src/services/google/jobs/backfillKeywordAggregates.js --commit --truncate
 *   node ... --target=advertiser            # advertiser table only (or =domain / =both)
 *   node ... --count-mode=doc_count         # faster, no cardinality sub-agg
 *   node ... --batch=2000 --limit=50000     # composite page size / cap pairs (testing)
 */

require('dotenv').config();
const databaseManager = require('../../../database/DatabaseManager');
const networksConfig = require('../../../config/networks');
const { buildBaseQuery, readAggs, REDIRECT_DOMAINS } = require('../helpers/aggregations');

const NETWORK = 'google';
const ID_PRECISION = 40000;
const INSERT_FLUSH = 500; // rows per multi-row INSERT

const TARGETS = {
  advertiser: {
    table: 'keyword_advertiser',
    idCol: 'post_owner_id',
    source: 'post_owner_lower',
    sourceKey: 'adv',
    masterSql: 'SELECT id, LOWER(post_owner_lower) AS k FROM google_text_ad_post_owners',
  },
  domain: {
    table: 'keyword_domain',
    idCol: 'domain_id',
    source: 'domain',
    sourceKey: 'dom',
    masterSql: 'SELECT id, LOWER(domain) AS k FROM google_text_ad_domains',
    // Ad-network redirect hosts (unresolved aclk) are not real landing domains —
    // exclude so keyword_domain reflects true destinations, not click-tracking noise.
    skipValues: new Set(REDIRECT_DOMAINS.map((d) => d.toLowerCase())),
  },
};

function log(...a) { console.log('[backfill]', ...a); }

function parseArgs(argv) {
  const args = { commit: false, truncate: false, target: 'both', batch: 1000, limit: 0, countMode: 'cardinality' };
  for (const a of argv.slice(2)) {
    if (a === '--commit') args.commit = true;
    else if (a === '--truncate') args.truncate = true;
    else if (a.startsWith('--target=')) args.target = a.split('=')[1];
    else if (a.startsWith('--batch=')) args.batch = parseInt(a.split('=')[1], 10) || 1000;
    else if (a.startsWith('--limit=')) args.limit = parseInt(a.split('=')[1], 10) || 0;
    else if (a.startsWith('--count-mode=')) args.countMode = a.split('=')[1];
  }
  if (!['cardinality', 'doc_count'].includes(args.countMode)) args.countMode = 'cardinality';
  return args;
}

// Map of keyword(lower) → [keyword_id, ...]
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

// Map of source-string(lower) → id (advertiser/domain). Last id wins on dupes.
async function loadIdMap(sql, masterSql) {
  const rows = await sql.query(masterSql);
  const map = new Map();
  for (const r of rows) if (r.k) map.set(r.k, r.id);
  return map;
}

// Buffered writer: counts always; inserts when commit=true.
function makeWriter(sql, table, idCol, commit) {
  let buffer = [];
  let written = 0;
  async function flush() {
    if (!buffer.length) return;
    if (commit) {
      const placeholders = buffer.map(() => '(?, ?, ?, NOW(), NOW())').join(', ');
      const params = [];
      for (const row of buffer) params.push(row.keyword_id, row.id, row.count);
      await sql.query(
        `INSERT INTO ${table} (keyword_id, ${idCol}, count, created_date, updated_date) VALUES ${placeholders}`,
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

// Paginated composite sweep. Calls onBucket({ kw, val, count }) for each pair.
async function sweep(elastic, index, query, valSourceField, valSourceKey, countMode, pageSize, limit, onBucket) {
  const sources = [
    { kw: { terms: { field: 'target_keyword' } } },
    { [valSourceKey]: { terms: { field: valSourceField } } },
  ];
  const subAggs = countMode === 'cardinality'
    ? { aggs: { ads: { cardinality: { field: 'id', precision_threshold: ID_PRECISION } } } }
    : {};
  let after = null;
  let total = 0;
  let pages = 0;
  for (;;) {
    const composite = { size: pageSize, sources };
    if (after) composite.after = after;
    const res = await elastic.search({
      index,
      body: { size: 0, track_total_hits: false, query, aggs: { pairs: { composite, ...subAggs } } },
    });
    const agg = readAggs(res)?.pairs;
    const buckets = agg?.buckets || [];
    if (!buckets.length) break;
    for (const b of buckets) {
      const count = countMode === 'cardinality' ? (b.ads?.value ?? b.doc_count) : b.doc_count;
      await onBucket({ kw: b.key.kw, val: b.key[valSourceKey], count });
      total++;
      if (limit && total >= limit) return total;
    }
    after = agg?.after_key || null;
    pages++;
    if (pages % 25 === 0) log(`    …${total} pairs swept (${pages} pages)`);
    if (!after) break;
  }
  return total;
}

async function backfillOne(targetKey, ctx) {
  const t = TARGETS[targetKey];
  const { sql, elastic, index, keywordMap, args } = ctx;
  log(`── ${targetKey} → ${t.table} ──`);

  if (args.commit) {
    const [{ c: existing }] = await sql.query(`SELECT COUNT(*) AS c FROM ${t.table}`);
    if (existing > 0 && !args.truncate) {
      log(`  SKIP: ${t.table} has ${existing} rows. Re-run with --truncate to rebuild.`);
      return;
    }
    if (existing > 0 && args.truncate) {
      log(`  TRUNCATE ${t.table} (${existing} rows)`);
      await sql.query(`TRUNCATE TABLE ${t.table}`);
    }
  }

  const idMap = await loadIdMap(sql, t.masterSql);
  log(`  loaded ${idMap.size} ${targetKey} ids`);

  const stats = { pairs: 0, rows: 0, unmappedKw: 0, unmappedVal: 0, skippedRedirect: 0 };
  const sampleRows = [];
  const writer = makeWriter(sql, t.table, t.idCol, args.commit);

  await sweep(elastic, index, ctx.query, t.source, t.sourceKey, args.countMode, args.batch, args.limit, async (b) => {
    stats.pairs++;
    const val = (b.val || '').toLowerCase();
    if (t.skipValues && t.skipValues.has(val)) { stats.skippedRedirect++; return; }
    const kwIds = keywordMap.get((b.kw || '').toLowerCase());
    if (!kwIds) { stats.unmappedKw++; return; }
    const valId = idMap.get(val);
    if (!valId) { stats.unmappedVal++; return; }
    for (const keyword_id of kwIds) {
      stats.rows++;
      if (sampleRows.length < 8) sampleRows.push({ kw: b.kw, val: b.val, keyword_id, [t.idCol]: valId, count: b.count });
      await writer.add({ keyword_id, id: valId, count: b.count });
    }
  });

  const written = await writer.done();
  const redirectNote = stats.skippedRedirect ? `, ${stats.skippedRedirect} redirect-domain` : '';
  log(`  pairs=${stats.pairs} → rows=${stats.rows} (skipped: ${stats.unmappedKw} unmapped-keyword, ${stats.unmappedVal} unmapped-${targetKey}${redirectNote})`);
  log(`  ${args.commit ? 'INSERTED' : 'WOULD INSERT'} ${written} rows into ${t.table}`);
  log('  sample:', JSON.stringify(sampleRows.slice(0, 5)));
}

async function main() {
  const args = parseArgs(process.argv);
  log(`mode=${args.commit ? 'COMMIT' : 'DRY-RUN'} target=${args.target} count-mode=${args.countMode} batch=${args.batch}${args.limit ? ` limit=${args.limit}` : ''}${args.truncate ? ' truncate' : ''}`);

  await databaseManager.connectAll(networksConfig);
  const sql = databaseManager.getSQL(NETWORK);
  const elastic = databaseManager.getElastic(NETWORK);
  if (!sql || !elastic) throw new Error('google SQL/Elastic connection unavailable');
  const index = elastic.indexName || process.env.GOOG_ELASTIC_INDEX || 'google_ads_data';

  const query = buildBaseQuery({}, index); // match_all + organic/NAS exclusions
  const keywordMap = await loadKeywordMap(sql);
  log(`loaded ${keywordMap.size} distinct keyword strings from google_text_keywords`);

  const ctx = { sql, elastic, index, keywordMap, query, args };
  const targets = args.target === 'both' ? ['advertiser', 'domain'] : [args.target];
  for (const tk of targets) {
    if (!TARGETS[tk]) { log(`unknown target '${tk}', skipping`); continue; }
    await backfillOne(tk, ctx);
  }

  await databaseManager.disconnectAll();
  log('done.');
}

main().catch((err) => {
  console.error('[backfill] FATAL', err);
  databaseManager.disconnectAll().finally(() => process.exit(1));
});

module.exports = { parseArgs, TARGETS };
