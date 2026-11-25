'use strict';

/**
 * Adds the index idx_blocked_attempts_ad (network, platform_ad_id) to copyright_blocked_attempts in each network's database.
 *
 *   node src/services/copyrightVerification/migrateAttemptsIndex.js                      # dry-run: table size, and what would change
 *   node src/services/copyrightVerification/migrateAttemptsIndex.js --apply              # add the index
 *   node src/services/copyrightVerification/migrateAttemptsIndex.js --networks=facebook,reddit
 *
 * Why: the admin Takedown Monitor shows WHY the cleanup blocked an ad id (what the ad matched when it failed the copyright check). That
 * answer is the newest copyright_blocked_attempts row of the platform ad id. Without this index the monitor can only look two days back
 * through the (network, created_at) index; with it, the lookup goes straight to the ad id, for blocks of any age.
 *
 * The index is added online (ALGORITHM=INPLACE, LOCK=NONE): inserts keep working while it builds. The time grows with the table: the
 * dry run prints each table's estimated rows and size first, so run it before --apply. An index already present is left alone.
 * Only SQL is touched. A network without the table is reported and skipped (create it with scripts/apply-copyright-schema.js).
 */

require('dotenv').config();

const TABLE = 'copyright_blocked_attempts';
const INDEX = 'idx_blocked_attempts_ad';
const DDL = `ALTER TABLE \`${TABLE}\` ADD INDEX ${INDEX} (network, platform_ad_id), ALGORITHM=INPLACE, LOCK=NONE`;

/** Megabytes, one decimal, for the size line of the dry run. */
const mb = (bytes) => `${(Number(bytes || 0) / 1048576).toFixed(1)} MB`;

/**
 * One database: report the table's size, then add the index when it is missing and `apply` is set.
 * Returns 'missing_table' | 'ok' (index already there) | 'would_add' | 'added'. `print` receives each output line.
 */
async function migrateOne(sql, { apply = false, print = console.log } = {}) {
  const [table] = await sql.query(
    `SELECT table_rows AS est_rows, data_length AS data_bytes, index_length AS index_bytes
       FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?`, [TABLE]);
  if (!table) { print(`  skip      ${TABLE} does not exist (run scripts/apply-copyright-schema.js first)`); return 'missing_table'; }
  // MySQL 8 may return information_schema names in upper case unless aliased; the aliases above keep them stable.
  print(`  size      ~${Number(table.est_rows || 0).toLocaleString('en-IN')} rows, data ${mb(table.data_bytes)}, indexes ${mb(table.index_bytes)} (estimate)`);
  const present = await sql.query(
    `SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1`, [TABLE, INDEX]);
  if (present.length) { print(`  ok        ${INDEX} already exists`); return 'ok'; }
  print(`  ${apply ? 'apply' : 'would'}     ${DDL}`);
  if (!apply) return 'would_add';
  const started = Date.now();
  await sql.query(DDL);
  print(`  done      in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  return 'added';
}

async function main() {
  // required here, not at the top, so tests can load migrateOne without a database configuration
  const networksConfig = require('../../config/networks');
  const databaseManager = require('../../database/DatabaseManager');
  const { NETWORKS } = require('./status');
  const apply = process.argv.includes('--apply');
  const only = (process.argv.find((a) => a.startsWith('--networks=')) || '').split('=')[1];
  const selected = (only ? only.split(',') : Object.keys(NETWORKS)).map((n) => n.trim()).filter((n) => NETWORKS[n]);

  const scoped = {};
  for (const n of selected) if (networksConfig[n]?.database?.sql) scoped[n] = { enabled: true, database: { sql: { ...networksConfig[n].database.sql, enabled: true } } };
  await databaseManager.connectAll(scoped);
  let failures = 0;
  // one network at a time: never two index builds at once on the same server
  for (const network of selected) {
    const sql = databaseManager.getSQL(network);
    console.log(`\n${network}`);
    if (!sql) { console.log('  FAIL      no SQL connection'); failures++; continue; }
    try { await migrateOne(sql, { apply }); }
    catch (error) { console.log(`  FAIL      ${error.message}`); failures++; }
  }
  if (!apply) console.log('\nDry-run only. Check the sizes above, then re-run with --apply to add the index.');
  return { code: failures ? 1 : 0, databaseManager };
}

if (require.main === module) {
  let db = null;
  main()
    .then(async ({ code, databaseManager }) => { db = databaseManager; await db.disconnectAll().catch(() => {}); process.exit(code); })
    .catch(async (error) => {
      console.error('[copyright-attempts-index] FATAL', error.message);
      if (db) await db.disconnectAll().catch(() => {});
      process.exit(1);
    });
}

module.exports = { migrateOne, INDEX, TABLE };
