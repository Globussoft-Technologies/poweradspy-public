#!/usr/bin/env node
'use strict';

/**
 * Migration: add `updated_date` to the Facebook and LinkedIn domains tables and
 * backfill it for rows that are already RESOLVED (`status = 1`).
 *
 * Why this exists:
 *   - The shared domain-date API now bumps `updated_date` for every network.
 *   - Facebook and LinkedIn previously lacked the column, so their domain rows
 *     could not participate in the same recency/sort/update flow.
 *
 * Behaviour:
 *   1. Add `updated_date DATETIME NULL DEFAULT NULL` if the column is missing.
 *   2. Backfill `updated_date = NOW()` for rows where `status = 1` and the value
 *      is currently NULL.
 *
 * Notes:
 *   - The database timestamp is the durable source of truth here; `NOW()` is the
 *     SQL-side equivalent of "stamp it with the current time" for this migration.
 *   - The script is idempotent and safe to re-run.
 *
 * Usage:
 *   node scripts/domain-migrations/add-facebook-linkedin-updated-date.js
 *   node scripts/domain-migrations/add-facebook-linkedin-updated-date.js --commit
 *   node scripts/domain-migrations/add-facebook-linkedin-updated-date.js --only=facebook
 */

require('dotenv').config();

const databaseManager = require('../../src/database/DatabaseManager');
const networksConfig = require('../../src/config/networks');
const { DOMAIN_TABLES } = require('../../src/services/common/helpers/domainTables');

const TARGET_NETWORKS = ['facebook', 'linkedin'];
const COLUMN = 'updated_date';

function parseArgs(argv) {
  const args = { commit: false, networks: [...TARGET_NETWORKS] };
  for (const a of argv) {
    if (a === '--commit') args.commit = true;
    else if (a.startsWith('--only=')) {
      args.networks = a.slice('--only='.length)
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
    }
  }

  const unknown = args.networks.filter((n) => !TARGET_NETWORKS.includes(n));
  if (unknown.length) {
    throw new Error(`This migration only supports facebook/linkedin. Unknown: ${unknown.join(', ')}`);
  }

  return args;
}

async function columnExists(sql, table, column) {
  const rows = await sql.query(
    'SELECT COLUMN_TYPE ct FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND COLUMN_NAME = ? LIMIT 1',
    [table, column]
  );
  return !!(rows && rows.length);
}

async function schemaHost(sql) {
  try {
    const rows = await sql.query('SELECT @@hostname host, DATABASE() db');
    return rows && rows[0] ? `${rows[0].host}/${rows[0].db}` : '(unknown)';
  } catch {
    return '(unknown)';
  }
}

async function main() {
  const { commit, networks } = parseArgs(process.argv.slice(2));
  console.log(`\n=== add-facebook-linkedin-updated-date migration — ${commit ? 'COMMIT' : 'DRY-RUN'} ===`);
  console.log(`networks: ${networks.join(', ')}\n`);

  await databaseManager.connectAll(networksConfig);

  const summary = [];
  for (const net of networks) {
    const { table } = DOMAIN_TABLES[net];
    const sql = databaseManager.getSQL(net);
    if (!sql) {
      console.log(`[${net}] SKIP — no SQL connection`);
      summary.push({ net, skipped: 'no-conn' });
      continue;
    }

    const where = await schemaHost(sql);
    const hasColumn = await columnExists(sql, table, COLUMN);
    console.log(`[${net}] ${table} @ ${where}`);
    console.log(`   column '${COLUMN}': ${hasColumn ? 'exists' : 'missing'}`);

    if (!commit) {
      const [{ eligible }] = await sql.query(`SELECT COUNT(*) eligible FROM ${table} WHERE status = 1`);
      console.log(`   would: ${hasColumn ? 'keep column' : `ADD COLUMN ${COLUMN} DATETIME NULL DEFAULT NULL`}; backfill ${eligible} resolved row(s) to NOW()`);
      summary.push({ net, column: hasColumn ? 'exists' : 'missing', eligible });
      continue;
    }

    if (!hasColumn) {
      await sql.query(`ALTER TABLE ${table} ADD COLUMN ${COLUMN} DATETIME NULL DEFAULT NULL`);
      console.log(`   + added column ${COLUMN}`);
    }

    const res = await sql.query(`UPDATE ${table} SET ${COLUMN} = NOW() WHERE status = 1`);
    const affected = res && (res.affectedRows ?? res.changedRows) != null ? (res.affectedRows ?? res.changedRows) : 0;
    console.log(`   ✓ backfilled ${affected} resolved row(s) → ${COLUMN} = NOW()`);
    summary.push({ net, applied: true, backfilled: affected });
  }

  console.log('\n=== summary ===');
  for (const s of summary) console.log('  ', JSON.stringify(s));
  await databaseManager.disconnectAll();
}

main().catch((e) => {
  console.error('FATAL', e);
  databaseManager.disconnectAll().finally(() => process.exit(1));
});
