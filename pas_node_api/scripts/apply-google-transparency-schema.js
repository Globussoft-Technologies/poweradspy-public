'use strict';

/**
 * Usage:
 *   node scripts/apply-google-transparency-schema.js          # dry run
 *   node scripts/apply-google-transparency-schema.js --apply  # execute
 */
const fs = require('fs');
const path = require('path');
const networks = require('../src/config/networks');
const databaseManager = require('../src/database/DatabaseManager');

const apply = process.argv.includes('--apply');
const schemaFile = path.join(__dirname, 'google_transparency_schema.sql');

function statements(sql) {
  return sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((part) => part.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
}

function selectRows(result) {
  if (!Array.isArray(result)) return [];
  return Array.isArray(result[0]) ? result[0] : result;
}

async function migrateCountryDateColumns(sql) {
  const rows = selectRows(await sql.query(
    `SELECT COLUMN_NAME, DATA_TYPE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'google_transparency_country_delivery'
        AND COLUMN_NAME IN ('first_shown', 'last_shown', 'first_seen', 'last_seen')`
  ));
  const columns = new Map(rows.map((row) => [row.COLUMN_NAME, String(row.DATA_TYPE).toLowerCase()]));
  for (const [oldName, newName] of [['first_shown', 'first_seen'], ['last_shown', 'last_seen']]) {
    if (columns.has(oldName) && !columns.has(newName)) {
      await sql.query(
        `ALTER TABLE google_transparency_country_delivery CHANGE COLUMN ${oldName} ${newName} DATETIME NULL`
      );
      columns.delete(oldName);
      columns.set(newName, 'datetime');
    }
    if (columns.has(newName) && columns.get(newName) !== 'datetime') {
      await sql.query(
        `ALTER TABLE google_transparency_country_delivery MODIFY COLUMN ${newName} DATETIME NULL`
      );
    }
  }
}

async function relaxDraftDuplicateColumns(sql) {
  const rows = selectRows(await sql.query(
    `SELECT COLUMN_NAME
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'google_transparency_ad_payload'
        AND COLUMN_NAME IN ('system_id', 'contract_version')`
  ));
  const columns = new Set(rows.map((row) => row.COLUMN_NAME));
  if (columns.has('system_id')) {
    await sql.query('ALTER TABLE google_transparency_ad_payload MODIFY COLUMN system_id VARCHAR(128) NULL');
  }
  if (columns.has('contract_version')) {
    await sql.query('ALTER TABLE google_transparency_ad_payload MODIFY COLUMN contract_version VARCHAR(16) NULL');
  }
}

async function main() {
  const cfg = { google: networks.google };
  const target = cfg.google?.database?.sql;
  console.log(`Google Transparency schema: ${target?.host}:${target?.port}/${target?.database}`);
  console.log(apply ? 'Mode: APPLY' : 'Mode: DRY RUN (pass --apply to execute)');
  const ddl = statements(fs.readFileSync(schemaFile, 'utf8'));
  if (!apply) {
    for (const statement of ddl) console.log(`- ${statement.match(/CREATE TABLE IF NOT EXISTS\s+(\w+)/i)?.[1] || 'statement'}`);
    console.log('- compatibility migration: first_shown/last_shown -> first_seen/last_seen DATETIME');
    console.log('- compatibility migration: obsolete draft system/version duplicates made nullable');
    return;
  }
  await databaseManager.connectAll(cfg);
  const sql = databaseManager.getSQL('google');
  if (!sql) throw new Error('Google SQL connection is unavailable');
  for (const statement of ddl) await sql.query(statement);
  await migrateCountryDateColumns(sql);
  await relaxDraftDuplicateColumns(sql);
  console.log(`Applied ${ddl.length} idempotent statement(s) and country-date compatibility migration.`);
}

if (require.main === module) {
  main()
    .catch((error) => { console.error(error); process.exitCode = 1; })
    .finally(() => databaseManager.disconnectAll().catch(() => {}));
}

module.exports = {
  selectRows,
  statements,
  migrateCountryDateColumns,
  relaxDraftDuplicateColumns,
  main,
};
