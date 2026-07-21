'use strict';

/**
 * Onboarding feature — additive migration on `am_user_action`.
 *
 * Adds new, nullable columns only. Never touches existing columns
 * (am_id, am_email, fcm_token, pinterest_launch_status, etc.) or existing
 * rows' data — every existing reader (pushNotificationController.js, the
 * legacy PHP am_user_action.php model) is unaffected.
 *
 * Safe to re-run — checks information_schema before adding each column
 * instead of relying on `IF NOT EXISTS` (not supported on older MySQL).
 *
 * Usage (from pas_node_api root):
 *   node src/database/migrations/2026_add_onboarding_columns.js
 *
 * NOTE: this only prints/runs against the DB this process's config points at
 * (same .env as the server) — review the connection target before running
 * against a shared/production database.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const dbManager = require('../DatabaseManager');
const networksConfig = require('../../config/networks');

const TABLE = 'am_user_action';

const COLUMNS = [
  { name: 'onboarding_major_category_id',   ddl: 'INT DEFAULT NULL' },
  { name: 'onboarding_major_category_name', ddl: 'VARCHAR(255) DEFAULT NULL' },
  { name: 'onboarding_sub_category_id',     ddl: 'BIGINT DEFAULT NULL' },
  { name: 'onboarding_sub_category_name',   ddl: 'VARCHAR(255) DEFAULT NULL' },
  { name: 'onboarding_competitors',         ddl: 'JSON DEFAULT NULL' },
  { name: 'onboarding_countries',           ddl: 'JSON DEFAULT NULL' },
  { name: 'onboarding_completed',           ddl: 'TINYINT(1) NOT NULL DEFAULT 0' },
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

async function uniqueKeyExists(sql, dbName) {
  const rows = await sql.query(
    `SELECT COUNT(*) AS cnt FROM information_schema.statistics
     WHERE table_schema = ? AND table_name = ? AND index_name = 'uniq_am_id'`,
    [dbName, TABLE]
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

  const hasUniqueKey = await uniqueKeyExists(sql, dbName);
  if (hasUniqueKey) {
    console.log('  SKIP   uniq_am_id (already exists)');
  } else {
    try {
      await sql.query(`ALTER TABLE ${TABLE} ADD UNIQUE KEY uniq_am_id (am_id)`);
      console.log('  ADDED  uniq_am_id');
    } catch (err) {
      // If duplicate am_id rows already exist, this fails loudly — report and
      // let a human decide how to dedupe rather than silently skipping.
      console.error('  FAILED to add uniq_am_id — check for duplicate am_id rows:', err.message);
    }
  }

  console.log('Migration complete.');
  await dbManager.disconnectAll();
}

migrate().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
