#!/usr/bin/env node
'use strict';

/**
 * apply-sql-tables.js — create the per-network `<net>_ad_ai_meta` tables.
 *
 * SAFETY (does NOT touch existing data):
 *   - Every statement is `CREATE TABLE IF NOT EXISTS` — it never drops, alters,
 *     or truncates an existing table.
 *   - No writes hit existing business tables; the new table only references the
 *     parent ad table with an FK.
 *   - DRY-RUN by default: prints what it would do. Pass --commit to execute.
 *
 * USAGE:
 *   node scripts/ai-meta/apply-sql-tables.js
 *   node scripts/ai-meta/apply-sql-tables.js --commit
 *   node scripts/ai-meta/apply-sql-tables.js --only=facebook,native
 *
 * IMPORTANT:
 *   - SQL host/schema resolution comes from the active environment through
 *     dotenv/env → src/config → src/config/networks → DatabaseManager.
 *   - This mirrors the working migration scripts already used in the repo.
 */

require('dotenv').config();
const databaseManager = require('../../src/database/DatabaseManager');
const networksConfig = require('../../src/config/networks');

const NETWORKS = {
  facebook:  { adTable: 'facebook_ad',    fkCol: 'facebook_ad_id',    fkType: 'INT UNSIGNED' },
  instagram: { adTable: 'instagram_ad',   fkCol: 'instagram_ad_id',   fkType: 'INT UNSIGNED' },
  gdn:       { adTable: 'gdn_ad',         fkCol: 'gdn_ad_id',         fkType: 'INT UNSIGNED' },
  youtube:   { adTable: 'youtube_ad',     fkCol: 'youtube_ad_id',     fkType: 'INT UNSIGNED' },
  google:    { adTable: 'google_text_ad', fkCol: 'google_text_ad_id', fkType: 'INT UNSIGNED' },
  native:    { adTable: 'native_ad',      fkCol: 'native_ad_id',      fkType: 'INT UNSIGNED' },
  linkedin:  { adTable: 'linkedin_ad',    fkCol: 'linkedin_ad_id',    fkType: 'INT UNSIGNED' },
  reddit:    { adTable: 'reddit_ad',      fkCol: 'reddit_ad_id',      fkType: 'INT UNSIGNED' },
  quora:     { adTable: 'quora_ad',       fkCol: 'quora_ad_id',       fkType: 'INT UNSIGNED' },
  pinterest: { adTable: 'pinterest_ad',   fkCol: 'pinterest_ad_id',   fkType: 'INT UNSIGNED' },
  tiktok:    { adTable: 'tiktok_ads',     fkCol: 'ad_id',             fkType: 'INT' },
};

function parseArgs(argv) {
  const args = { commit: false, networks: Object.keys(NETWORKS) };
  for (const a of argv) {
    if (a === '--commit') args.commit = true;
    else if (a.startsWith('--only=')) {
      args.networks = a.slice('--only='.length).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    }
  }
  const unknown = args.networks.filter((n) => !NETWORKS[n]);
  if (unknown.length) throw new Error(`Unknown network(s): ${unknown.join(', ')}. Valid: ${Object.keys(NETWORKS).join(', ')}`);
  return args;
}

function metaTable(adTable) {
  // Follows the documented `<ad-table>_ai_meta` naming convention exactly.
  return `${adTable}_ai_meta`;
}

function buildDDL(net, cfgNet) {
  const table = metaTable(cfgNet.adTable);
  return `CREATE TABLE IF NOT EXISTS \`${table}\` (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  \`${cfgNet.fkCol}\` ${cfgNet.fkType} NOT NULL,
  ad_type        VARCHAR(32)  NULL,
  offering_type  VARCHAR(16)  NULL,
  offering       VARCHAR(255) NULL,
  caption        TEXT         NULL,
  category       VARCHAR(255) NULL,
  category_id    VARCHAR(4)   NULL,
  sub_category   VARCHAR(255) NULL,
  subcategory_id VARCHAR(8)   NULL,
  intent         JSON NULL,
  hook           JSON NULL,
  colors         JSON NULL,
  offers         JSON NULL,
  roa            JSON NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_${table} (\`${cfgNet.fkCol}\`),
  KEY idx_${net}_ai_ad_type (ad_type),
  KEY idx_${net}_ai_offering_type (offering_type),
  KEY idx_${net}_ai_category (category),
  CONSTRAINT fk_${table} FOREIGN KEY (\`${cfgNet.fkCol}\`) REFERENCES \`${cfgNet.adTable}\`(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`;
}

async function tableExists(sql, table) {
  const rows = await sql.query(
    'SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
    [table]
  );
  return rows && rows[0] ? rows[0].n > 0 : false;
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
  console.log(`\n=== AI-Meta SQL table apply — ${commit ? 'COMMIT' : 'DRY-RUN'} ===`);
  console.log(`networks: ${networks.join(', ')}\n`);

  await databaseManager.connectAll(networksConfig);

  const summary = [];
  for (const net of networks) {
    const sql = databaseManager.getSQL(net);
    const cfgNet = NETWORKS[net];
    if (!sql) {
      console.log(`[${net}] SKIP — no SQL connection`);
      summary.push({ net, status: 'no-sql' });
      continue;
    }

    const where = await schemaHost(sql);
    const table = metaTable(cfgNet.adTable);
    const label = `${net} -> ${table} @ ${where}`;

    try {
      const parentExists = await tableExists(sql, cfgNet.adTable);
      if (!parentExists) {
        console.log(`[${net}] SKIP — ${label} parent table missing (${cfgNet.adTable})`);
        summary.push({ net, status: 'missing-parent' });
        continue;
      }

      const exists = await tableExists(sql, table);
      const ddl = buildDDL(net, cfgNet);

      if (!commit) {
        console.log(`[${net}] ${exists ? 'ALREADY EXISTS' : 'WOULD CREATE'} — ${label}`);
        if (!exists) console.log(ddl + '\n');
        summary.push({ net, status: exists ? 'exists' : 'would-create' });
        continue;
      }

      await sql.query(ddl);
      console.log(`[${net}] ${exists ? 'NO-OP' : 'CREATED'} — ${label}`);
      summary.push({ net, status: exists ? 'existed' : 'created' });
    } catch (err) {
      console.log(`[${net}] ERROR — ${label} — ${err.message}`);
      summary.push({ net, status: 'error', error: err.message });
    }
  }

  console.log('\n=== summary ===');
  for (const s of summary) console.log('  ', JSON.stringify(s));
  await databaseManager.disconnectAll();
}

main().catch((e) => {
  console.error('FATAL', e);
  databaseManager.disconnectAll().finally(() => process.exit(1));
});
