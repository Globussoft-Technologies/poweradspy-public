'use strict';

/**
 * Adds copyright_status to each supported network's primary ad table.
 *
 *   node src/services/copyrightVerification/migrate.js                      # dry-run: show what would change
 *   node src/services/copyrightVerification/migrate.js --apply              # change the tables
 *   node src/services/copyrightVerification/migrate.js --networks=facebook,reddit
 *
 * Per table:
 *   1. ADD COLUMN copyright_status TINYINT UNSIGNED NOT NULL DEFAULT 1  -> existing ads stay visible (approved)
 *   2. SET DEFAULT 0                                                    -> every new insert is pending
 *   3. ADD INDEX idx_copyright_status (copyright_status, id)            -> the crons read pages by index, no scan
 * Already-present column/index are left alone. Only SQL is touched (no Mongo / ES).
 * Existing ES docs need no backfill: search hides only docs with status 0 or 2.
 */

require('dotenv').config();
const networksConfig = require('../../config/networks');
const databaseManager = require('../../database/DatabaseManager');
const { NETWORKS } = require('./status');

const apply = process.argv.includes('--apply');
const only = (process.argv.find((a) => a.startsWith('--networks=')) || '').split('=')[1];
const selected = (only ? only.split(',') : Object.keys(NETWORKS)).map((n) => n.trim()).filter((n) => NETWORKS[n]);

async function migrate(sql, table) {
  const has = async (q, p) => (await sql.query(q, p)).length > 0;
  const column = await has(`SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = 'copyright_status'`, [table]);
  const index = await has(`SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = 'idx_copyright_status'`, [table]);
  const todo = [];
  if (!column) todo.push(`ALTER TABLE \`${table}\` ADD COLUMN copyright_status TINYINT UNSIGNED NOT NULL DEFAULT 1`,
    `ALTER TABLE \`${table}\` ALTER COLUMN copyright_status SET DEFAULT 0`);
  if (!index) todo.push(`ALTER TABLE \`${table}\` ADD INDEX idx_copyright_status (copyright_status, id), ALGORITHM=INPLACE, LOCK=NONE`);
  if (!todo.length) return console.log(`  ok        ${table}`);
  for (const ddl of todo) {
    console.log(`  ${apply ? 'apply' : 'would'}     ${ddl}`);
    if (apply) await sql.query(ddl);
  }
}

async function main() {
  const scoped = {};
  for (const n of selected) if (networksConfig[n]?.database?.sql) scoped[n] = { enabled: true, database: { sql: { ...networksConfig[n].database.sql, enabled: true } } };
  await databaseManager.connectAll(scoped);
  let failures = 0;
  for (const network of selected) {
    const sql = databaseManager.getSQL(network);
    console.log(`\n${network}`);
    if (!sql) { console.log('  FAIL      no SQL connection'); failures++; continue; }
    try { await migrate(sql, NETWORKS[network][0]); }
    catch (error) { console.log(`  FAIL      ${error.message}`); failures++; }
  }
  if (!apply) console.log('\nDry-run only. Re-run with --apply to change the tables.');
  return failures ? 1 : 0;
}

if (require.main === module) {
  main()
    .then(async (code) => { await databaseManager.disconnectAll().catch(() => {}); process.exit(code); })
    .catch(async (error) => { console.error('[copyright-migrate] FATAL', error.message); await databaseManager.disconnectAll().catch(() => {}); process.exit(1); });
}
