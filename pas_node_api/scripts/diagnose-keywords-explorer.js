'use strict';

/**
 * Diagnose POST /api/v1/google/keywords/explorer performance — runs the SAME
 * three queries the controller runs against `keyword_stats_unique` (count,
 * stats aggregate, paginated rows), times each one for real, and EXPLAINs
 * them. Read-only.
 *
 * Background (2026-08-13 incident): the Explorer originally read from
 * `keyword_stats` (one row PER COUNTRY-VARIANT keyword_id) joined to
 * `google_text_keywords`, GROUP BY gtk.keyword to dedupe — measured
 * 20-38s/query in production ("Using temporary; Using filesort" even with an
 * index on the sort column, since no index can satisfy a GROUP BY on a joined
 * string column). Fixed by deduplicating at WRITE time instead: both
 * refreshKeywordStats.js and refresh-keyword-stats-safe.js now also upsert
 * into `keyword_stats_unique` (one row per keyword TEXT — see
 * keyword_stats_unique_schema.sql), which keywordsExplorerController.js reads
 * directly with no JOIN and no GROUP BY at all.
 *
 * Usage:
 *   node scripts/diagnose-keywords-explorer.js
 *   node scripts/diagnose-keywords-explorer.js --sort=growth_pct --volume_min=10
 */

require('dotenv').config();
const networks = require('../src/config/networks');
const databaseManager = require('../src/database/DatabaseManager');

function parseArgs(argv) {
  const args = { sort: 'ads_total' };
  for (const token of argv) {
    const [key, value] = token.replace(/^--/, '').split('=');
    args[key] = value;
  }
  return args;
}

function heading(t) { console.log(`\n${'='.repeat(72)}\n${t}\n${'='.repeat(72)}`); }

async function timed(label, fn) {
  const t0 = Date.now();
  const result = await fn();
  console.log(`  ${label}: ${Date.now() - t0}ms`);
  return result;
}

async function explain(sql, query, params) {
  const rows = await sql.query(`EXPLAIN ${query}`, params);
  rows.forEach((r) => {
    console.log(`    table=${r.table} type=${r.type} key=${r.key || 'NONE'} rows=${r.rows} Extra=${r.Extra}`);
  });
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  await databaseManager.connectAll({ google: networks.google });
  const conns = databaseManager.getConnections('google');
  if (!conns?.sql) throw new Error('Could not connect to google MySQL.');
  const sql = conns.sql;

  heading('TABLE SIZES');
  const [ksuExists] = await sql.query(`SHOW TABLES LIKE 'keyword_stats_unique'`);
  if (!ksuExists) {
    console.log('keyword_stats_unique does NOT exist yet — run: node scripts/apply-keyword-stats-schema.js');
    await databaseManager.disconnectAll();
    return;
  }
  const [{ n: ksuCount }] = await sql.query('SELECT COUNT(*) AS n FROM keyword_stats_unique');
  const [{ n: ksCount }] = await sql.query('SELECT COUNT(*) AS n FROM keyword_stats');
  console.log(`keyword_stats_unique: ${ksuCount} rows (deduped — the only table every google keyword-stats read path uses now)`);
  console.log(`keyword_stats: ${ksCount} rows (legacy, no longer read or written — safe to drop once keyword_stats_unique is verified)`);
  if (ksuCount === 0) {
    console.log('\nkeyword_stats_unique is empty — the refresh job (refresh-keyword-stats-safe.js or');
    console.log('refreshKeywordStats.js) needs to run at least one batch before the Explorer has data.');
  }

  heading('INDEXES: keyword_stats_unique');
  (await sql.query('SHOW INDEX FROM keyword_stats_unique')).forEach((r) => console.log(`  ${r.Key_name} (${r.Column_name}) unique=${r.Non_unique === 0}`));

  const baseFrom = 'FROM keyword_stats_unique ksu';
  const sortBy = args.sort;
  const where = [];
  const params = [];
  if (args.volume_min) { where.push('ksu.ads_total >= ?'); params.push(Number(args.volume_min)); }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  heading('QUERY 1: COUNT(*)');
  const countSql = `SELECT COUNT(*) AS total ${baseFrom} ${whereSql}`;
  await explain(sql, countSql, params);
  await timed('actual time', () => sql.query(countSql, params));

  heading('QUERY 2: stats aggregate');
  const statsSql = `SELECT AVG(competition_score) AS avg_competition, SUM(ads_total) AS total_ad_volume
     ${baseFrom} ${whereSql}`;
  await explain(sql, statsSql, params);
  await timed('actual time', () => sql.query(statsSql, params));

  heading(`QUERY 3: paginated rows (ORDER BY ${sortBy})`);
  const rowsSql = `SELECT sample_keyword_id AS keyword_id, keyword, ${sortBy} AS sort_col
     ${baseFrom} ${whereSql} ORDER BY ${sortBy} DESC LIMIT 50 OFFSET 0`;
  await explain(sql, rowsSql, params);
  await timed('actual time', () => sql.query(rowsSql, params));

  heading('VERDICT');
  console.log('Expect type=index/range (not ALL) and NO "Using temporary; Using filesort" on Query 3 —');
  console.log('no JOIN, no GROUP BY means MySQL can walk the sort-column index directly and stop after');
  console.log('50 rows instead of scanning + sorting the whole table. If you still see "Using temporary"');
  console.log('here, something is off (e.g. an unindexed filter column) — paste the output to investigate.');

  await databaseManager.disconnectAll();
}

main().catch((err) => {
  console.error(`ERROR: ${err.message}`);
  process.exitCode = 1;
});
