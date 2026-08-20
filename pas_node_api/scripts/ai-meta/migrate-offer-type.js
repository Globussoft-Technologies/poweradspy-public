#!/usr/bin/env node
'use strict';

/**
 * migrate-offer-type.js — add the nullable `offer_type` column to existing
 * `<network>_ad_ai_meta` tables and keep the ES object mapping in sync.
 *
 * This is an additive, non-destructive migration:
 *   - SQL: `ALTER TABLE ... ADD COLUMN` only when the column is missing, or
 *     `MODIFY COLUMN` when a previous partial migration left the wrong type.
 *   - ES: apply the additive mapping update handled by apply-es-mapping.js
 *     (run the companion script separately; this file focuses on SQL).
 *
 * USAGE:
 *   node scripts/ai-meta/migrate-offer-type.js
 *   node scripts/ai-meta/migrate-offer-type.js --commit
 *   node scripts/ai-meta/migrate-offer-type.js --only=facebook,native --commit
 *
 * The script resolves DBs the same way the app does in the active environment:
 * dotenv/env -> src/config -> src/config/networks -> DatabaseManager.
 */

require('dotenv').config();
const databaseManager = require('../../src/database/DatabaseManager');
const networksConfig = require('../../src/config/networks');
const { NET_SQL } = require('../../src/services/common/helpers/aiMetaSqlWriter');

const NETWORKS = Object.keys(NET_SQL);
const COLUMN = 'offer_type';
const COLUMN_DEF = 'VARCHAR(32) NULL';

function parseArgs(argv) {
  const args = { commit: false, networks: NETWORKS };
  for (const a of argv) {
    if (a === '--commit') args.commit = true;
    else if (a.startsWith('--only=')) {
      args.networks = a.slice('--only='.length).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    }
  }
  const unknown = args.networks.filter((n) => !NETWORKS.includes(n));
  if (unknown.length) throw new Error(`Unknown network(s): ${unknown.join(', ')}. Valid: ${NETWORKS.join(', ')}`);
  return args;
}

async function columnType(sql, table, column) {
  const rows = await sql.query(
    'SELECT COLUMN_TYPE ct, IS_NULLABLE nullable FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1',
    [table, column]
  );
  return rows && rows.length ? rows[0] : null;
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
  console.log(`\n=== AI-Meta offer_type migration - ${commit ? 'COMMIT' : 'DRY-RUN'} ===`);
  console.log(`networks: ${networks.join(', ')}\n`);

  await databaseManager.connectAll(networksConfig);

  const summary = [];
  for (const net of networks) {
    const sql = databaseManager.getSQL(net);
    const cfgNet = NET_SQL[net];
    if (!sql) {
      console.log(`[${net}] SKIP - no SQL connection`);
      summary.push({ net, status: 'no-sql' });
      continue;
    }

    const table = cfgNet.metaTable;
    const where = await schemaHost(sql);
    const existing = await columnType(sql, table, COLUMN);
    console.log(`[${net}] ${table} @ ${where}`);
    console.log(`   column '${COLUMN}': ${existing ? `EXISTS (${existing.ct}${existing.nullable === 'YES' ? ', nullable' : ', not null'})` : 'missing'}`);

    if (!commit) {
      if (!existing) {
        console.log(`   would: ALTER TABLE \`${table}\` ADD COLUMN \`${COLUMN}\` ${COLUMN_DEF}`);
      } else if (String(existing.ct).toUpperCase() !== 'VARCHAR(32)' || existing.nullable !== 'YES') {
        console.log(`   would: ALTER TABLE \`${table}\` MODIFY COLUMN \`${COLUMN}\` ${COLUMN_DEF}`);
      } else {
        console.log(`   would: no-op`);
      }
      summary.push({ net, status: existing ? 'exists' : 'missing' });
      continue;
    }

    if (!existing) {
      await sql.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${COLUMN}\` ${COLUMN_DEF}`);
      console.log(`   + added column ${COLUMN}`);
      summary.push({ net, status: 'added' });
      continue;
    }

    if (String(existing.ct).toUpperCase() !== 'VARCHAR(32)' || existing.nullable !== 'YES') {
      await sql.query(`ALTER TABLE \`${table}\` MODIFY COLUMN \`${COLUMN}\` ${COLUMN_DEF}`);
      console.log(`   + normalized column ${COLUMN}`);
      summary.push({ net, status: 'modified' });
      continue;
    }

    console.log(`   * no-op`);
    summary.push({ net, status: 'exists' });
  }

  console.log('\n=== summary ===');
  for (const s of summary) console.log('  ', JSON.stringify(s));
  await databaseManager.disconnectAll();
}

main().catch((e) => {
  console.error('FATAL', e);
  databaseManager.disconnectAll().finally(() => process.exit(1));
});
