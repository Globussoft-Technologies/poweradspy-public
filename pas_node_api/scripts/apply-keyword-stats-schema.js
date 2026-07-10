'use strict';

/**
 * One-off runner for keyword_stats_schema.sql — applies the Keywords Explorer
 * schema (keyword_stats, keyword_lists, keyword_list_items) using the SAME
 * `google` network SQL connection pas_node_api itself already uses (config.json
 * credentials), so no separate `mysql` CLI install is needed on the machine.
 *
 * All statements are `CREATE TABLE IF NOT EXISTS` — safe to run more than once.
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
const SCHEMA_FILE = path.join(__dirname, 'keyword_stats_schema.sql');

function splitStatements(sql) {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--')) // strip comment lines
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  const sqlText = fs.readFileSync(SCHEMA_FILE, 'utf8');
  const statements = splitStatements(sqlText);
  console.log(`[apply-schema] ${statements.length} statement(s) found in ${SCHEMA_FILE}`);

  await databaseManager.connectAll(networksConfig);
  const sql = databaseManager.getSQL(NETWORK);
  if (!sql) throw new Error(`No SQL connection for network "${NETWORK}"`);

  for (const [i, stmt] of statements.entries()) {
    const label = stmt.match(/CREATE TABLE IF NOT EXISTS (\w+)/i)?.[1] || `statement ${i + 1}`;
    await sql.query(stmt);
    console.log(`[apply-schema] ✓ ${label}`);
  }

  await databaseManager.disconnectAll();
  console.log('[apply-schema] done.');
}

main().catch((err) => {
  console.error('[apply-schema] FATAL', err);
  databaseManager.disconnectAll().finally(() => process.exit(1));
});
