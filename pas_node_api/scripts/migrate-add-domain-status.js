'use strict';

/**
 * Migration: add a `status` column to every network's domains table so the
 * registration-date backfill flow can permanently skip unresolvable domains.
 *
 *   status 0 = PENDING      (default) — NULL date, not yet attempted → returned by
 *                            GET /api/v1/common/get-domains-without-registration-date
 *   status 1 = RESOLVED     — a registration date was found & written
 *   status 2 = UNRESOLVABLE  — attempted, no date obtainable (dead/redacted domain); PERMANENT
 *
 * What it does per network (facebook, instagram, google, youtube, linkedin, native,
 * pinterest, reddit, quora, gdn — TikTok excluded, no SQL domains table):
 *   1. ADD COLUMN `status` TINYINT NOT NULL DEFAULT 0   (skipped if it already exists)
 *   2. ADD INDEX  `idx_domain_status` (status)          (skipped if it already exists)
 *   3. BACKFILL: rows that already have a date → status 1 (idempotent; NULL rows stay 0)
 *
 * Idempotent — safe to re-run. All checks go through information_schema.
 *
 * Usage (env-driven — points at whatever DBs the network config resolves to):
 *   node scripts/migrate-add-domain-status.js            # DRY RUN — report only, no changes
 *   node scripts/migrate-add-domain-status.js --apply    # apply ALTER + index + backfill
 *   node scripts/migrate-add-domain-status.js --apply --network=google,reddit   # scope to some networks
 *
 * PROD: run the same file with the prod environment loaded. It prints the target host/schema
 * per network before touching anything so you can confirm you're on the right environment.
 */

require('dotenv').config();
const databaseManager = require('../src/database/DatabaseManager');
const networksConfig = require('../src/config/networks');
const { DOMAIN_TABLES, DOMAIN_NETWORKS } = require('../src/services/common/helpers/domainTables');

const COLUMN = 'status';
const INDEX = 'idx_domain_status';

function parseArgs(argv) {
  const args = { apply: false, networks: DOMAIN_NETWORKS };
  for (const a of argv) {
    if (a === '--apply') args.apply = true;
    else if (a.startsWith('--network=')) {
      args.networks = a.slice('--network='.length).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    }
  }
  const unknown = args.networks.filter((n) => !DOMAIN_TABLES[n]);
  if (unknown.length) throw new Error(`Unknown network(s): ${unknown.join(', ')}. Valid: ${DOMAIN_NETWORKS.join(', ')}`);
  return args;
}

async function columnExists(sql, table, column) {
  const r = await sql.query(
    'SELECT COLUMN_TYPE ct FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND COLUMN_NAME = ? LIMIT 1',
    [table, column]
  );
  return r && r.length ? r[0].ct : null;
}
async function indexExists(sql, table, index) {
  const r = await sql.query(
    'SELECT 1 FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND INDEX_NAME = ? LIMIT 1',
    [table, index]
  );
  return !!(r && r.length);
}
async function schemaHost(sql) {
  try {
    const r = await sql.query("SELECT @@hostname host, DATABASE() db");
    return r && r[0] ? `${r[0].host}/${r[0].db}` : '(unknown)';
  } catch { return '(unknown)'; }
}

async function main() {
  const { apply, networks } = parseArgs(process.argv.slice(2));
  console.log(`\n=== add-domain-status migration — ${apply ? 'APPLY' : 'DRY RUN (no changes)'} ===`);
  console.log(`networks: ${networks.join(', ')}\n`);

  await databaseManager.connectAll(networksConfig);

  const summary = [];
  for (const net of networks) {
    const { table } = DOMAIN_TABLES[net];
    const sql = databaseManager.getSQL(net);
    if (!sql) { console.log(`[${net}] SKIP — no SQL connection`); summary.push({ net, skipped: 'no-conn' }); continue; }

    const where = await schemaHost(sql);
    const existingType = await columnExists(sql, table, COLUMN);
    const hasIndex = existingType ? await indexExists(sql, table, INDEX) : false;
    console.log(`[${net}] ${table} @ ${where}`);
    console.log(`   column '${COLUMN}': ${existingType ? `EXISTS (${existingType})` : 'missing'} · index '${INDEX}': ${hasIndex ? 'exists' : 'missing'}`);

    if (!apply) {
      // Report how much the backfill WOULD touch.
      const [{ pend }] = await sql.query(`SELECT COUNT(*) pend FROM ${table} WHERE domain_registered_date IS NULL`);
      const [{ dated }] = await sql.query(`SELECT COUNT(*) dated FROM ${table} WHERE domain_registered_date IS NOT NULL`);
      console.log(`   would: ${existingType ? 'keep column' : `ADD COLUMN ${COLUMN} TINYINT NOT NULL DEFAULT 0`}; ${hasIndex ? 'keep index' : `ADD INDEX ${INDEX}(status)`}; backfill ${dated} dated→status 1, ${pend} NULL stay 0`);
      summary.push({ net, column: existingType || 'missing', index: hasIndex, dated, pend });
      continue;
    }

    if (!existingType) {
      await sql.query(`ALTER TABLE ${table} ADD COLUMN ${COLUMN} TINYINT NOT NULL DEFAULT 0`);
      console.log(`   + added column ${COLUMN}`);
    }
    if (!hasIndex) {
      await sql.query(`ALTER TABLE ${table} ADD INDEX ${INDEX} (${COLUMN})`);
      console.log(`   + added index ${INDEX}`);
    }
    const res = await sql.query(`UPDATE ${table} SET ${COLUMN} = 1 WHERE domain_registered_date IS NOT NULL AND ${COLUMN} <> 1`);
    const affected = res && (res.affectedRows ?? res.changedRows) != null ? (res.affectedRows ?? res.changedRows) : 0;
    console.log(`   ✓ backfilled ${affected} dated row(s) → status 1`);
    summary.push({ net, applied: true, backfilled: affected });
  }

  console.log('\n=== summary ===');
  for (const s of summary) console.log('  ', JSON.stringify(s));
  await databaseManager.disconnectAll();
}

main().catch((e) => { console.error('FATAL', e); databaseManager.disconnectAll().finally(() => process.exit(1)); });
