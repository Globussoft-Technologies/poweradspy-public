#!/usr/bin/env node
'use strict';

/**
 * migrate-lander-fields.js - additive MySQL migration for the live AdMob schema.
 *
 * This script is intentionally narrow:
 *   - It only touches the AdMob SQL schema.
 *   - It adds the new redirect status column on `mob_ads` when missing.
 *   - It creates or patches `mob_ad_lander_content` with the new lander fields.
 *   - It never drops data, and it defaults to dry-run mode.
 *
 * Usage:
 *   node scripts/admob/migrate-lander-fields.js
 *   node scripts/admob/migrate-lander-fields.js --commit
 *
 * The connection resolution mirrors the app and the other migration scripts:
 * dotenv/env -> src/config -> src/config/networks -> DatabaseManager.
 */

require('dotenv').config();
const databaseManager = require('../../src/database/DatabaseManager');
const networksConfig = require('../../src/config/networks');

const NETWORK = 'admob';
const ADS_TABLE = 'mob_ads';
const LANDER_TABLE = 'mob_ad_lander_content';
const REDIRECT_STATUS_INDEX = 'idx_mob_ads_redirect_status';

const REDIRECT_STATUS_COLUMN = {
  name: 'redirect_status',
  definition: '`redirect_status` TINYINT UNSIGNED NOT NULL DEFAULT 0',
  after: '`status`',
};

// The live lander table should already have the primary key and FK columns. The
// additive migration only needs to backfill the new lander payload fields.
const LANDER_COLUMN_SPECS = [
  { name: 'lander_status', definition: '`lander_status` TINYINT UNSIGNED NOT NULL DEFAULT 0' },
  { name: 'crawled_by', definition: '`crawled_by` VARCHAR(16) NULL' },
  { name: 'destinations', definition: '`destinations` TEXT NULL' },
  { name: 'html_path', definition: '`html_path` VARCHAR(2048) NULL' },
  { name: 'screen_shot', definition: '`screen_shot` VARCHAR(2048) NULL' },
  { name: 'html_content', definition: '`html_content` LONGTEXT NULL' },
  { name: 'domain_registered_date', definition: '`domain_registered_date` DATE NULL' },
  { name: 'domain_age', definition: '`domain_age` SMALLINT UNSIGNED NULL' },
  { name: 'country_iso_json', definition: '`country_iso_json` LONGTEXT NULL' },
  { name: 'outgoing_url_json', definition: '`outgoing_url_json` LONGTEXT NULL' },
  { name: 'redirects_json', definition: '`redirects_json` LONGTEXT NULL' },
  { name: 'ad_category', definition: '`ad_category` VARCHAR(160) NULL' },
  { name: 'source_website', definition: '`source_website` VARCHAR(2048) NULL' },
  { name: 'source_parameters_json', definition: '`source_parameters_json` LONGTEXT NULL' },
  { name: 'whatsapp_url', definition: '`whatsapp_url` VARCHAR(2048) NULL' },
  { name: 'whatsapp_domain', definition: '`whatsapp_domain` VARCHAR(255) NULL' },
  { name: 'whatsapp_path', definition: '`whatsapp_path` VARCHAR(2048) NULL' },
  { name: 'whatsapp_phone', definition: '`whatsapp_phone` VARCHAR(64) NULL' },
  { name: 'whatsapp_message', definition: '`whatsapp_message` LONGTEXT NULL' },
  { name: 'whatsapp_parameters_json', definition: '`whatsapp_parameters_json` LONGTEXT NULL' },
  { name: 'campaign_id', definition: '`campaign_id` VARCHAR(255) NULL' },
  { name: 'location_without_vpn_json', definition: '`location_without_vpn_json` LONGTEXT NULL' },
  { name: 'location_with_vpn_json', definition: '`location_with_vpn_json` LONGTEXT NULL' },
  { name: 'comparison_json', definition: '`comparison_json` LONGTEXT NULL' },
  { name: 'whatsapp_links_json', definition: '`whatsapp_links_json` LONGTEXT NULL' },
  { name: 'whatsapp_texts_json', definition: '`whatsapp_texts_json` LONGTEXT NULL' },
  { name: 'phone_numbers_json', definition: '`phone_numbers_json` LONGTEXT NULL' },
  { name: 'contact_buttons_json', definition: '`contact_buttons_json` LONGTEXT NULL' },
  { name: 'contact_button_count', definition: '`contact_button_count` SMALLINT UNSIGNED NOT NULL DEFAULT 0' },
  { name: 'whatsapp_rotator_detected', definition: '`whatsapp_rotator_detected` TINYINT(1) NOT NULL DEFAULT 0' },
  { name: 'whatsapp_rotator_phone_count', definition: '`whatsapp_rotator_phone_count` SMALLINT UNSIGNED NOT NULL DEFAULT 0' },
  { name: 'lead_campaign_tag', definition: '`lead_campaign_tag` VARCHAR(255) NULL' },
  { name: 'raw_payload_json', definition: '`raw_payload_json` LONGTEXT NULL' },
  { name: 'created_at', definition: '`created_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)' },
  { name: 'updated_at', definition: '`updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)' },
];

const LANDER_INDEX_SPECS = [
  { name: 'idx_mob_ad_lander_content_status', definition: '`lander_status`, `ad_id`' },
  { name: 'idx_mob_ad_lander_content_campaign_id', definition: '`campaign_id`' },
  { name: 'idx_mob_ad_lander_content_campaign_tag', definition: '`lead_campaign_tag`' },
];

function parseArgs(argv) {
  return {
    commit: argv.includes('--commit') || argv.includes('--apply'),
  };
}

async function tableExists(sql, tableName) {
  const rows = await sql.query(
    'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?',
    [tableName]
  );
  return Number(rows?.[0]?.n || 0) > 0;
}

async function getColumnInfo(sql, tableName, columnName) {
  const rows = await sql.query(
    `SELECT DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, EXTRA
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1`,
    [tableName, columnName]
  );
  return rows?.[0] || null;
}

async function getColumnNames(sql, tableName) {
  const rows = await sql.query(
    `SELECT COLUMN_NAME
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?`,
    [tableName]
  );
  return new Set((rows || []).map((row) => row.COLUMN_NAME));
}

async function getIndexNames(sql, tableName) {
  const rows = await sql.query(
    `SELECT DISTINCT INDEX_NAME
       FROM information_schema.statistics
      WHERE table_schema = DATABASE()
        AND table_name = ?`,
    [tableName]
  );
  return new Set((rows || []).map((row) => row.INDEX_NAME));
}

function redirectStatusMatches(info) {
  if (!info) return false;
  return String(info.DATA_TYPE || '').toLowerCase() === 'tinyint'
    && String(info.COLUMN_TYPE || '').toLowerCase().includes('unsigned')
    && String(info.IS_NULLABLE || '').toUpperCase() === 'NO'
    && String(info.COLUMN_DEFAULT) === '0';
}

function buildRedirectStatusStatements(info, hasIndex) {
  const statements = [];
  const definition = REDIRECT_STATUS_COLUMN.definition;

  if (!info) {
    statements.push(`ALTER TABLE \`${ADS_TABLE}\` ADD COLUMN ${definition} AFTER ${REDIRECT_STATUS_COLUMN.after}`);
  } else if (!redirectStatusMatches(info)) {
    statements.push(`ALTER TABLE \`${ADS_TABLE}\` MODIFY COLUMN ${definition} AFTER ${REDIRECT_STATUS_COLUMN.after}`);
  }

  if (!hasIndex) {
    statements.push(`ALTER TABLE \`${ADS_TABLE}\` ADD KEY \`${REDIRECT_STATUS_INDEX}\` (\`redirect_status\`, \`id\`)`);
  }
  return statements;
}

function buildLanderCreateTableSql() {
  // The base create statement stays in sync with the checked-in schema file so
  // fresh databases and live migrations land on the same structure.
  return [
    'CREATE TABLE IF NOT EXISTS `mob_ad_lander_content` (',
    '  `ad_id` BIGINT UNSIGNED NOT NULL,',
    '  `lander_status` TINYINT UNSIGNED NOT NULL DEFAULT 0,',
    '  `crawled_by` VARCHAR(16) NULL,',
    '  `destinations` TEXT NULL,',
    '  `html_path` VARCHAR(2048) NULL,',
    '  `screen_shot` VARCHAR(2048) NULL,',
    '  `html_content` LONGTEXT NULL,',
    '  `domain_registered_date` DATE NULL,',
    '  `domain_age` SMALLINT UNSIGNED NULL,',
    '  `country_iso_json` LONGTEXT NULL,',
    '  `outgoing_url_json` LONGTEXT NULL,',
    '  `redirects_json` LONGTEXT NULL,',
    '  `ad_category` VARCHAR(160) NULL,',
    '  `source_website` VARCHAR(2048) NULL,',
    '  `source_parameters_json` LONGTEXT NULL,',
    '  `whatsapp_url` VARCHAR(2048) NULL,',
    '  `whatsapp_domain` VARCHAR(255) NULL,',
    '  `whatsapp_path` VARCHAR(2048) NULL,',
    '  `whatsapp_phone` VARCHAR(64) NULL,',
    '  `whatsapp_message` LONGTEXT NULL,',
    '  `whatsapp_parameters_json` LONGTEXT NULL,',
    '  `campaign_id` VARCHAR(255) NULL,',
    '  `location_without_vpn_json` LONGTEXT NULL,',
    '  `location_with_vpn_json` LONGTEXT NULL,',
    '  `comparison_json` LONGTEXT NULL,',
    '  `whatsapp_links_json` LONGTEXT NULL,',
    '  `whatsapp_texts_json` LONGTEXT NULL,',
    '  `phone_numbers_json` LONGTEXT NULL,',
    '  `contact_buttons_json` LONGTEXT NULL,',
    '  `contact_button_count` SMALLINT UNSIGNED NOT NULL DEFAULT 0,',
    '  `whatsapp_rotator_detected` TINYINT(1) NOT NULL DEFAULT 0,',
    '  `whatsapp_rotator_phone_count` SMALLINT UNSIGNED NOT NULL DEFAULT 0,',
    '  `lead_campaign_tag` VARCHAR(255) NULL,',
    '  `raw_payload_json` LONGTEXT NULL,',
    '  `created_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),',
    '  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),',
    '  PRIMARY KEY (`ad_id`),',
    '  KEY `idx_mob_ad_lander_content_status` (`lander_status`, `ad_id`),',
    '  KEY `idx_mob_ad_lander_content_campaign_id` (`campaign_id`),',
    '  KEY `idx_mob_ad_lander_content_campaign_tag` (`lead_campaign_tag`),',
    '  CONSTRAINT `fk_mob_ad_lander_content_ad` FOREIGN KEY (`ad_id`) REFERENCES `mob_ads` (`id`) ON DELETE CASCADE',
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;'
  ].join('\n');
}

function buildLanderAlterStatements(existingColumns, existingIndexes) {
  if (!existingColumns.has('ad_id')) {
    throw new Error('mob_ad_lander_content exists without ad_id; recreate it from the base schema before applying additive fields.');
  }

  const statements = [];
  const columnClauses = LANDER_COLUMN_SPECS
    .filter((spec) => !existingColumns.has(spec.name))
    .map((spec) => `ADD COLUMN ${spec.definition}`);
  const indexClauses = LANDER_INDEX_SPECS
    .filter((spec) => !existingIndexes.has(spec.name))
    .map((spec) => `ADD KEY \`${spec.name}\` (${spec.definition})`);

  if (columnClauses.length || indexClauses.length) {
    statements.push(`ALTER TABLE \`${LANDER_TABLE}\` ${[...columnClauses, ...indexClauses].join(', ')}`);
  }

  return statements;
}

async function executeStatements(sql, statements, commit) {
  if (!statements.length) return;
  if (!commit) {
    for (const statement of statements) console.log(`   would: ${statement}`);
    return;
  }

  for (const statement of statements) {
    await sql.query(statement);
    console.log(`   + applied: ${statement.split('\n')[0]}`);
  }
}

async function ensureRedirectStatus(sql, commit) {
  const info = await getColumnInfo(sql, ADS_TABLE, REDIRECT_STATUS_COLUMN.name);
  const indexNames = await getIndexNames(sql, ADS_TABLE);
  const statements = buildRedirectStatusStatements(info, indexNames.has(REDIRECT_STATUS_INDEX));
  await executeStatements(sql, statements, commit);
}

async function ensureLanderTable(sql, commit) {
  const exists = await tableExists(sql, LANDER_TABLE);
  if (!exists) {
    const ddl = buildLanderCreateTableSql();
    if (!commit) {
      console.log(`   would: ${ddl}`);
      return;
    }
    await sql.query(ddl);
    console.log(`   + created ${LANDER_TABLE}`);
    return;
  }

  const existingColumns = await getColumnNames(sql, LANDER_TABLE);
  const existingIndexes = await getIndexNames(sql, LANDER_TABLE);
  const statements = buildLanderAlterStatements(existingColumns, existingIndexes);
  await executeStatements(sql, statements, commit);
}

async function main() {
  const { commit } = parseArgs(process.argv.slice(2));
  const mode = commit ? 'COMMIT' : 'DRY-RUN';
  console.log(`\n=== AdMob lander SQL migration - ${mode} ===`);

  await databaseManager.connectAll({ [NETWORK]: networksConfig[NETWORK] });
  const sql = databaseManager.getSQL(NETWORK);
  if (!sql) {
    console.log(`[${NETWORK}] SKIP - no SQL connection`);
    await databaseManager.disconnectAll();
    return;
  }

  const tableHost = await sql.query('SELECT @@hostname AS host, DATABASE() AS db');
  const location = tableHost?.[0] ? `${tableHost[0].host}/${tableHost[0].db}` : '(unknown)';
  console.log(`[${NETWORK}] ${ADS_TABLE} / ${LANDER_TABLE} @ ${location}`);

  const adsTablePresent = await tableExists(sql, ADS_TABLE);
  if (!adsTablePresent) {
    console.log(`[${NETWORK}] SKIP - parent table ${ADS_TABLE} is missing`);
    await databaseManager.disconnectAll();
    return;
  }

  console.log(`   checking ${ADS_TABLE}.${REDIRECT_STATUS_COLUMN.name}`);
  await ensureRedirectStatus(sql, commit);

  console.log(`   checking ${LANDER_TABLE}`);
  await ensureLanderTable(sql, commit);

  await databaseManager.disconnectAll();
}

if (require.main === module) {
  main().catch((error) => {
    console.error('FATAL', error);
    databaseManager.disconnectAll().finally(() => process.exit(1));
  });
}

module.exports = {
  buildLanderAlterStatements,
  buildLanderCreateTableSql,
  buildRedirectStatusStatements,
  executeStatements,
  getColumnInfo,
  getColumnNames,
  getIndexNames,
  main,
  parseArgs,
  redirectStatusMatches,
  tableExists,
};
