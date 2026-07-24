'use strict';

/**
 * Usage:
 *   node scripts/rollback-google-transparency-schema.js
 *   node scripts/rollback-google-transparency-schema.js --apply --confirm-drop
 *
 * Dry-run is the default. Destructive execution requires both flags.
 */
const fs = require('fs');
const path = require('path');
const networks = require('../src/config/networks');
const databaseManager = require('../src/database/DatabaseManager');

const apply = process.argv.includes('--apply');
const confirmed = process.argv.includes('--confirm-drop');
const rollbackFile = path.join(__dirname, 'rollback-google-transparency-schema.sql');
const tables = [
  'google_transparency_country_delivery',
  'google_transparency_ad_payload',
];

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

async function existingRowCount(sql, table) {
  try {
    const rows = selectRows(await sql.query(`SELECT COUNT(*) AS count FROM ${table}`));
    return Number(rows?.[0]?.count || 0);
  } catch (error) {
    if (error?.errno === 1146 || error?.code === 'ER_NO_SUCH_TABLE') return null;
    throw error;
  }
}

async function main() {
  const cfg = { google: networks.google };
  const target = cfg.google?.database?.sql;
  console.log(`Google Transparency rollback target: ${target?.host}:${target?.port}/${target?.database}`);
  console.log(apply ? 'Mode: APPLY' : 'Mode: DRY RUN');
  console.log(`Tables: ${tables.join(', ')}`);

  if (!apply) {
    console.log('No SQL executed. To drop these tables, rerun with --apply --confirm-drop.');
    return;
  }
  if (!confirmed) {
    throw new Error('Rollback not confirmed. Add --confirm-drop together with --apply.');
  }

  await databaseManager.connectAll(cfg);
  const sql = databaseManager.getSQL('google');
  if (!sql) throw new Error('Google SQL connection is unavailable');

  for (const table of tables) {
    const count = await existingRowCount(sql, table);
    console.log(`${table}: ${count === null ? 'not present' : `${count} row(s) will be removed`}`);
  }
  for (const statement of statements(fs.readFileSync(rollbackFile, 'utf8'))) {
    await sql.query(statement);
  }
  console.log('Google Transparency additive tables dropped. Canonical google_text_* tables were not changed.');
}

if (require.main === module) {
  main()
    .catch((error) => { console.error(error); process.exitCode = 1; })
    .finally(() => databaseManager.disconnectAll().catch(() => {}));
}

module.exports = { selectRows, statements, existingRowCount, main };
