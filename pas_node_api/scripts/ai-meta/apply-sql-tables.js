#!/usr/bin/env node
'use strict';

/**
 * apply-sql-tables.js — create the per-network `<net>_ad_ai_meta` tables.
 *
 * SAFETY (does NOT touch existing data):
 *   - Every statement is `CREATE TABLE IF NOT EXISTS` — it NEVER drops, alters, or
 *     truncates an existing table. Re-running is a no-op on tables that already exist.
 *   - No writes to any existing table; the new table only adds a FK that REFERENCES
 *     <net>_ad(id) with ON DELETE CASCADE (cascade only fires if an ad row is deleted —
 *     it never deletes ad rows itself).
 *   - DRY-RUN by default: prints the DDL and what it would do. Pass --commit to execute.
 *
 * USAGE:
 *   node scripts/ai-meta/apply-sql-tables.js                # dry-run (all networks)
 *   node scripts/ai-meta/apply-sql-tables.js --commit       # actually create them
 *   node scripts/ai-meta/apply-sql-tables.js --only=facebook,native [--commit]
 *
 * Connection + per-network schema names are read from config.json
 * (databases.sql + networks.<net>.sql.database). Matches docs/AI_META_SQL_STORAGE.md.
 */

const fs   = require('fs');
const path = require('path');

const CONFIG_PATH = path.resolve(__dirname, '../../config.json');
const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

// network → { schema, adTable, fkCol, fkType }. Verified live: all <net>_ad.id are
// INT UNSIGNED except tiktok_ads.id which is signed INT, so the FK column matches.
const NETWORKS = {
  facebook:  { schema: cfgDb('facebook'),  adTable: 'facebook_ad',    fkCol: 'facebook_ad_id',    fkType: 'INT UNSIGNED' },
  instagram: { schema: cfgDb('instagram'), adTable: 'instagram_ad',   fkCol: 'instagram_ad_id',   fkType: 'INT UNSIGNED' },
  gdn:       { schema: cfgDb('gdn'),       adTable: 'gdn_ad',         fkCol: 'gdn_ad_id',         fkType: 'INT UNSIGNED' },
  youtube:   { schema: cfgDb('youtube'),   adTable: 'youtube_ad',     fkCol: 'youtube_ad_id',     fkType: 'INT UNSIGNED' },
  google:    { schema: cfgDb('google'),    adTable: 'google_text_ad', fkCol: 'google_text_ad_id', fkType: 'INT UNSIGNED' },
  native:    { schema: cfgDb('native'),    adTable: 'native_ad',      fkCol: 'native_ad_id',      fkType: 'INT UNSIGNED' },
  linkedin:  { schema: cfgDb('linkedin'),  adTable: 'linkedin_ad',    fkCol: 'linkedin_ad_id',    fkType: 'INT UNSIGNED' },
  reddit:    { schema: cfgDb('reddit'),    adTable: 'reddit_ad',      fkCol: 'reddit_ad_id',      fkType: 'INT UNSIGNED' },
  quora:     { schema: cfgDb('quora'),     adTable: 'quora_ad',       fkCol: 'quora_ad_id',       fkType: 'INT UNSIGNED' },
  pinterest: { schema: cfgDb('pinterest'), adTable: 'pinterest_ad',   fkCol: 'pinterest_ad_id',   fkType: 'INT UNSIGNED' },
  tiktok:    { schema: cfgDb('tiktok'),    adTable: 'tiktok_ads',     fkCol: 'ad_id',             fkType: 'INT' },
};

function cfgDb(net) {
  const d = cfg.networks?.[net]?.sql?.database;
  if (d) return d;
  // fallback conventions if a network omits it
  const fallback = { google: 'pasdev_gtext', tiktok: 'tiktok_database_development' };
  return fallback[net] || `pasdev_${net}`;
}

function metaTable(net, adTable) {
  // <ad-table>_ai_meta (matches docs/AI_META_SQL_STORAGE.md exactly)
  return `${adTable}_ai_meta`;
}

function buildDDL(net, cfgNet) {
  const table = metaTable(net, cfgNet.adTable);
  return `CREATE TABLE IF NOT EXISTS \`${cfgNet.schema}\`.\`${table}\` (
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

async function tableExists(conn, schema, table) {
  const [r] = await conn.query(
    'SELECT COUNT(*) n FROM information_schema.tables WHERE table_schema=? AND table_name=?',
    [schema, table],
  );
  return r[0].n > 0;
}

(async () => {
  const args   = process.argv.slice(2);
  const COMMIT = args.includes('--commit');
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.split('=')[1].split(',').map((s) => s.trim()) : null;

  let mysql;
  try { mysql = require('mysql2/promise'); }
  catch { console.error('mysql2 not installed (npm install mysql2)'); process.exit(1); }

  const s = cfg.databases.sql;
  const conn = await mysql.createConnection({ host: s.host, port: s.port, user: s.user, password: s.password, multipleStatements: false });

  console.log(`\n=== AI-Meta SQL table apply — ${COMMIT ? 'COMMIT' : 'DRY-RUN'} ===`);
  console.log(`host=${s.host}:${s.port} user=${s.user}\n`);

  const summary = [];
  for (const [net, c] of Object.entries(NETWORKS)) {
    if (only && !only.includes(net)) continue;
    const table = metaTable(net, c.adTable);
    const label = `${net} → ${c.schema}.${table}`;
    try {
      // Parent ad table must exist for the FK.
      if (!(await tableExists(conn, c.schema, c.adTable))) {
        console.log(`✗ ${label}: parent table ${c.schema}.${c.adTable} NOT found — skipped`);
        summary.push({ net, status: 'skipped_no_parent' }); continue;
      }
      const exists = await tableExists(conn, c.schema, table);
      const ddl = buildDDL(net, c);

      if (!COMMIT) {
        console.log(`• ${label}: ${exists ? 'ALREADY EXISTS (no-op)' : 'would CREATE'}`);
        console.log(ddl + '\n');
        summary.push({ net, status: exists ? 'exists' : 'would_create' });
        continue;
      }

      await conn.query(ddl); // CREATE TABLE IF NOT EXISTS — safe no-op if present
      const nowExists = await tableExists(conn, c.schema, table);
      console.log(`✓ ${label}: ${exists ? 'already existed (no-op)' : 'CREATED'}${nowExists ? '' : ' (verify FAILED!)'}`);
      summary.push({ net, status: exists ? 'existed' : 'created' });
    } catch (err) {
      console.log(`✗ ${label}: ERROR ${err.message}`);
      summary.push({ net, status: 'error', error: err.message });
    }
  }

  console.log('\n--- summary ---');
  for (const r of summary) console.log(`  ${r.net.padEnd(10)} ${r.status}${r.error ? ' — ' + r.error : ''}`);
  if (!COMMIT) console.log('\n(DRY-RUN — nothing was changed. Re-run with --commit to apply.)');
  await conn.end();
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
