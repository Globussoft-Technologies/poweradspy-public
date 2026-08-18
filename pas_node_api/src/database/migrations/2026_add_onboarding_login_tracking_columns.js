'use strict';

/**
 * Onboarding login tracking — additive migration on `am_user_action`.
 *
 * Adds nullable columns only, so existing readers/writers remain unaffected.
 *
 * Usage (from pas_node_api root):
 *   node src/database/migrations/2026_add_onboarding_login_tracking_columns.js
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const dbManager = require('../DatabaseManager');
const networksConfig = require('../../config/networks');

const TABLE = 'am_user_action';

const COLUMNS = [
  { name: 'onboarding_first_login_at',  ddl: 'DATETIME DEFAULT NULL' },
  { name: 'onboarding_last_login_at',   ddl: 'DATETIME DEFAULT NULL' },
  { name: 'onboarding_user_created_at', ddl: 'DATETIME DEFAULT NULL' },
];

async function columnExists(sql, dbName, columnName) {
  const rows = await sql.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.columns
     WHERE table_schema = ? AND table_name = ? AND column_name = ?`,
    [dbName, TABLE, columnName]
  );
  const row = Array.isArray(rows[0]) ? rows[0][0] : rows[0];
  return (row?.cnt || 0) > 0;
}

async function migrate() {
  await dbManager.connectAll(networksConfig);

  const sql = dbManager.getSQL('facebook') || dbManager.getSQL('instagram');
  if (!sql) {
    console.error('No SQL connection available (facebook/instagram) — check .env');
    process.exit(1);
  }

  const dbNameRows = await sql.query('SELECT DATABASE() AS db');
  const dbNameRow = Array.isArray(dbNameRows[0]) ? dbNameRows[0][0] : dbNameRows[0];
  const dbName = dbNameRow?.db;
  console.log(`Migrating table \`${TABLE}\` in database \`${dbName}\``);

  for (const col of COLUMNS) {
    const exists = await columnExists(sql, dbName, col.name);
    if (exists) {
      console.log(`  SKIP   ${col.name} (already exists)`);
      continue;
    }
    await sql.query(`ALTER TABLE ${TABLE} ADD COLUMN ${col.name} ${col.ddl}`);
    console.log(`  ADDED  ${col.name}`);
  }

  console.log('Migration complete.');
  await dbManager.disconnectAll();
}

migrate().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
