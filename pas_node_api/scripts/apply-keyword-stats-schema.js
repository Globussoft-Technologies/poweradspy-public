'use strict';

/**
 * One-off runner for the Keywords Explorer schema — applies keyword_stats_schema.sql
 * (keyword_stats, keyword_lists, keyword_list_items) AND keyword_stats_unique_schema.sql
 * (the deduplicated table keywordsExplorerController.js reads from), using the SAME
 * `google` network SQL connection pas_node_api itself already uses (config.json
 * credentials), so no separate `mysql` CLI install is needed on the machine.
 *
 * All CREATE TABLEs are IF NOT EXISTS — safe to run more than once. After creating
 * keyword_stats_unique, this ALSO backfills it instantly from the existing
 * keyword_stats + google_text_keywords data (old data is only READ, never modified) —
 * otherwise the Explorer would show zero results until the refresh job slowly
 * reprocesses everything from scratch.
 *
 * Usage:
 *   node scripts/apply-keyword-stats-schema.js
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const databaseManager = require('../src/database/DatabaseManager');
const networksConfig = require('../src/config/networks');

const NETWORK = 'google';
const SCHEMA_FILES = [
  path.join(__dirname, 'keyword_stats_schema.sql'),
  path.join(__dirname, 'keyword_stats_unique_schema.sql'),
];

function splitStatements(sql) {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--')) // strip comment lines
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function backfillUnique(sql) {
  // Table may already exist from a previous run (CREATE IF NOT EXISTS doesn't
  // retroactively widen columns) — widen it here so re-running this script
  // fixes an already-created table too, not just fresh installs.
  await sql.query('ALTER TABLE keyword_stats_unique MODIFY keyword VARCHAR(500) NOT NULL');

  const [{ n: before }] = await sql.query('SELECT COUNT(*) AS n FROM keyword_stats_unique');
  if (before > 0) {
    console.log(`[apply-schema] keyword_stats_unique already has ${before} rows — skipping backfill (re-run with TRUNCATE first if you want a clean rebuild).`);
    return;
  }
  console.log('[apply-schema] backfilling keyword_stats_unique from existing keyword_stats data (one-time, ~30-90s)...');
  const t0 = Date.now();
  await sql.query(`
    INSERT INTO keyword_stats_unique
      (keyword, sample_keyword_id, countries, ads_total, advertisers_total, domains_total,
       ads_30d, ads_prior_30d, growth_pct, competition_score, category, sub_category,
       top_country, type_mix, position_top_pct, first_seen, last_seen, updated_at)
    SELECT
      LEFT(gtk.keyword, 500), MIN(gtk.id), JSON_ARRAYAGG(gtk.country),
      MAX(ks.ads_total), MAX(ks.advertisers_total), MAX(ks.domains_total),
      MAX(ks.ads_30d), MAX(ks.ads_prior_30d), MAX(ks.growth_pct), MAX(ks.competition_score),
      ANY_VALUE(ks.category), ANY_VALUE(ks.sub_category), ANY_VALUE(ks.top_country),
      ANY_VALUE(ks.type_mix), ANY_VALUE(ks.position_top_pct),
      MIN(ks.first_seen), MAX(ks.last_seen), NOW()
    FROM keyword_stats ks
    JOIN google_text_keywords gtk ON gtk.id = ks.keyword_id
    GROUP BY gtk.keyword
  `);
  const [{ n: after }] = await sql.query('SELECT COUNT(*) AS n FROM keyword_stats_unique');
  console.log(`[apply-schema] ✓ backfilled ${after} rows in ${Date.now() - t0}ms`);
}

async function main() {
  await databaseManager.connectAll(networksConfig);
  const sql = databaseManager.getSQL(NETWORK);
  if (!sql) throw new Error(`No SQL connection for network "${NETWORK}"`);

  for (const schemaFile of SCHEMA_FILES) {
    const sqlText = fs.readFileSync(schemaFile, 'utf8');
    const statements = splitStatements(sqlText);
    console.log(`[apply-schema] ${statements.length} statement(s) found in ${schemaFile}`);
    for (const [i, stmt] of statements.entries()) {
      const label = stmt.match(/CREATE TABLE IF NOT EXISTS (\w+)/i)?.[1] || `statement ${i + 1}`;
      await sql.query(stmt);
      console.log(`[apply-schema] ✓ ${label}`);
    }
  }

  await backfillUnique(sql);

  await databaseManager.disconnectAll();
  console.log('[apply-schema] done.');
}

main().catch((err) => {
  console.error('[apply-schema] FATAL', err);
  databaseManager.disconnectAll().finally(() => process.exit(1));
});
