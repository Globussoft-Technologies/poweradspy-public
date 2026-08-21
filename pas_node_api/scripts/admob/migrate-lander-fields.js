#!/usr/bin/env node
'use strict';

/**
 * migrate-lander-fields.js - AdMob lander MySQL migration for the finalized
 * PAS/DS payload contract.
 *
 * This script changes only AdMob SQL tables. It does not modify ES mappings
 * and it does not rewrite ES documents.
 *
 * Default/additive mode:
 *   - ensures `mob_ads.redirect_status` exists
 *   - ensures finalized columns/indexes exist on `mob_ad_lander_content`
 *   - ensures `mob_ad_lander_claims` exists for same-day crawler locking
 *   - keeps old lander-only SQL columns in place
 *
 * Strict cleanup mode (`--drop-obsolete`) adds this on top:
 *   - best-effort backfill from legacy lander columns into finalized columns
 *   - normalization of legacy WhatsApp data to the final `url` shape
 *   - recomputation of PAS-maintained rotator fields
 *   - dropping deprecated AdMob lander-only SQL columns
 *
 * Important:
 *   - Dry-run is the default. Add `--commit` or `--apply` to actually write.
 *   - If `mob_ad_lander_content` has already been cleared, strict cleanup is
 *     the cleanest way to finish the final SQL schema.
 *   - Old ES lander fields are not removed by this script. Use
 *     `rebuild-search-index.js` afterwards when ES must match the final SQL
 *     schema exactly.
 *
 * Common commands:
 *   node scripts/admob/migrate-lander-fields.js
 *     Preview only the additive SQL changes. Old lander columns stay as-is.
 *
 *   node scripts/admob/migrate-lander-fields.js --commit
 *     Apply only the additive SQL changes and keep old lander columns.
 *
 *   node scripts/admob/migrate-lander-fields.js --drop-obsolete
 *     Preview the full finalization: additive changes, legacy backfill, and
 *     dropping old AdMob lander-only SQL columns.
 *
 *   node scripts/admob/migrate-lander-fields.js --drop-obsolete --commit
 *     Apply the final AdMob lander SQL schema in MySQL.
 */

require('dotenv').config();
const databaseManager = require('../../src/database/DatabaseManager');
const networksConfig = require('../../src/config/networks');

const NETWORK = 'admob';
const ADS_TABLE = 'mob_ads';
const LANDER_TABLE = 'mob_ad_lander_content';
const LANDER_CLAIMS_TABLE = 'mob_ad_lander_claims';
const REDIRECT_STATUS_INDEX = 'idx_mob_ads_redirect_status';
const HIGH_VOLUME_LEAD_TAG = 'high-volume-lead-campaign';
const PYTHON_CRAWLER_PLATFORM = 12;

const REDIRECT_STATUS_COLUMN = {
  name: 'redirect_status',
  definition: '`redirect_status` TINYINT UNSIGNED NOT NULL DEFAULT 0',
  after: '`status`',
};

const LANDER_COLUMN_SPECS = [
  { name: 'platform', definition: '`platform` SMALLINT UNSIGNED NULL' },
  { name: 'lander_status', definition: '`lander_status` TINYINT UNSIGNED NOT NULL DEFAULT 1' },
  { name: 'destinations', definition: '`destinations` TEXT NULL' },
  { name: 'html_path', definition: '`html_path` VARCHAR(2048) NULL' },
  { name: 'screen_shot', definition: '`screen_shot` VARCHAR(2048) NULL' },
  { name: 'html_content', definition: '`html_content` LONGTEXT NULL' },
  { name: 'domain_registered_date', definition: '`domain_registered_date` DATE NULL' },
  { name: 'domain_age', definition: '`domain_age` SMALLINT UNSIGNED NULL' },
  { name: 'country_iso_json', definition: '`country_iso_json` LONGTEXT NULL' },
  { name: 'outgoing_url_json', definition: '`outgoing_url_json` LONGTEXT NULL' },
  { name: 'redirects_json', definition: '`redirects_json` LONGTEXT NULL' },
  { name: 'source_app', definition: '`source_app` VARCHAR(255) NULL' },
  { name: 'whatsapp_json', definition: '`whatsapp_json` LONGTEXT NULL' },
  { name: 'campaign_id', definition: '`campaign_id` VARCHAR(255) NULL' },
  { name: 'whatsapp_rotator_detected', definition: '`whatsapp_rotator_detected` TINYINT(1) NOT NULL DEFAULT 0' },
  { name: 'whatsapp_rotator_count', definition: '`whatsapp_rotator_count` SMALLINT UNSIGNED NOT NULL DEFAULT 0' },
  { name: 'lead_campaign_tag', definition: '`lead_campaign_tag` VARCHAR(255) NULL' },
  { name: 'created', definition: '`created` DATETIME(3) NULL' },
  { name: 'updated', definition: '`updated` DATETIME(3) NULL' },
];

const LANDER_INDEX_SPECS = [
  { name: 'idx_mob_ad_lander_content_status', definition: '`lander_status`, `ad_id`' },
  { name: 'idx_mob_ad_lander_content_updated', definition: '`updated`, `ad_id`' },
  { name: 'idx_mob_ad_lander_content_campaign_id', definition: '`campaign_id`' },
  { name: 'idx_mob_ad_lander_content_campaign_tag', definition: '`lead_campaign_tag`' },
];

const CLAIMS_COLUMN_SPECS = [
  { name: 'scraper_name', definition: '`scraper_name` VARCHAR(255) NOT NULL' },
  { name: 'requested_status', definition: '`requested_status` TINYINT UNSIGNED NOT NULL DEFAULT 0' },
  { name: 'claimed_at', definition: '`claimed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)' },
  { name: 'completed_at', definition: '`completed_at` DATETIME(3) NULL' },
  { name: 'last_lander_status', definition: '`last_lander_status` TINYINT UNSIGNED NULL' },
  { name: 'created_at', definition: '`created_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)' },
  { name: 'updated_at', definition: '`updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)' },
];

const CLAIMS_INDEX_SPECS = [
  { name: 'idx_mob_ad_lander_claims_queue', definition: '`process_date`, `requested_status`, `claimed_at`, `ad_id`' },
  { name: 'idx_mob_ad_lander_claims_scraper', definition: '`scraper_name`, `process_date`, `claimed_at`' },
];

const OBSOLETE_LANDER_COLUMNS = [
  'crawled_by',
  'ad_category',
  'source_website',
  'source_parameters_json',
  'whatsapp_url',
  'whatsapp_domain',
  'whatsapp_phone',
  'whatsapp_message',
  'whatsapp_parameters_json',
  'location_without_vpn_json',
  'location_with_vpn_json',
  'comparison_json',
  'whatsapp_links_json',
  'whatsapp_texts_json',
  'phone_numbers_json',
  'contact_buttons_json',
  'contact_button_count',
  'whatsapp_rotator_phone_count',
  'whatsapp_details_json',
  'raw_payload_json',
  'created_at',
  'updated_at',
  'whatsapp_path',
];

function parseArgs(argv) {
  return {
    commit: argv.includes('--commit') || argv.includes('--apply'),
    dropObsolete: argv.includes('--drop-obsolete') || argv.includes('--strict-lander'),
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

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function firstNonBlank(...values) {
  for (const value of values) {
    if (!isBlank(value)) return String(value).trim();
  }
  return null;
}

function toArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function parseJsonValue(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { value: null, invalid: false };
  }
  if (typeof raw === 'object') {
    return { value: raw, invalid: false };
  }
  try {
    return { value: JSON.parse(raw), invalid: false };
  } catch {
    return { value: null, invalid: true };
  }
}

function normalizeFraction(fraction) {
  const text = String(fraction || '').replace('.', '');
  return `.${text.padEnd(3, '0').slice(0, 3)}`;
}

function formatDateTime(value) {
  if (isBlank(value)) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 23).replace('T', ' ');
  }

  const text = String(value).trim();
  const localMatch = text.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d{1,3})?$/);
  if (localMatch) {
    return `${localMatch[1]} ${localMatch[2]}${normalizeFraction(localMatch[3])}`;
  }

  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 23).replace('T', ' ');
}

function toFiniteNumber(value) {
  if (isBlank(value)) return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeWhatsappEntry(entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    return null;
  }

  const normalized = {
    domain: firstNonBlank(entry.domain, entry.host),
    phone: firstNonBlank(entry.phone, entry.phone_number, entry.msisdn),
    button: firstNonBlank(entry.button, entry.label, entry.title, entry.text),
    message: firstNonBlank(entry.message, entry.prefilled_text, entry.text),
    first_detected: firstNonBlank(entry.first_detected, entry.fisrt_detected),
    last_detected: firstNonBlank(entry.last_detected, entry.lastDetected),
    state: firstNonBlank(entry.state),
    city: firstNonBlank(entry.city),
    country: firstNonBlank(entry.country, entry.countrty, entry.country_code),
  };

  const url = firstNonBlank(entry.url, entry.href, entry.link, entry.path, entry.pathname, entry.route);
  if (url) normalized.url = url;

  return Object.values(normalized).some((value) => !isBlank(value))
    ? normalized
    : null;
}

function normalizeWhatsappDetailsJson(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { changed: false, value: raw };
  }

  const parsed = parseJsonValue(raw);
  if (parsed.invalid) {
    return { changed: false, value: raw, invalid: true };
  }

  const wasArray = Array.isArray(parsed.value);
  const entries = toArray(parsed.value)
    .map((item) => normalizeWhatsappEntry(item))
    .filter(Boolean);

  const normalizedValue = JSON.stringify(wasArray ? entries : (entries[0] || null));
  return {
    changed: normalizedValue !== String(raw),
    value: normalizedValue,
  };
}

function extractContactButton(raw) {
  const parsed = parseJsonValue(raw);
  if (parsed.invalid) return null;

  for (const item of toArray(parsed.value)) {
    if (isBlank(item)) continue;
    if (typeof item === 'string') return item.trim();
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const text = firstNonBlank(item.text, item.label, item.title, item.button, item.value);
      if (text) return text;
    }
  }

  return null;
}

function uniqueEntries(entries) {
  const seen = new Set();
  const merged = [];

  for (const entry of entries) {
    const normalized = normalizeWhatsappEntry(entry);
    if (!normalized) continue;
    const key = JSON.stringify(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(normalized);
  }

  return merged;
}

function buildLegacyWhatsappEntry(row, payload) {
  const button = extractContactButton(row.contact_buttons_json);
  const payloadWhatsapp = payload && typeof payload === 'object' ? payload.whatsapp : null;
  const payloadEntry = normalizeWhatsappEntry(Array.isArray(payloadWhatsapp) ? payloadWhatsapp[0] : payloadWhatsapp);

  const legacyEntry = normalizeWhatsappEntry({
    domain: row.whatsapp_domain,
    phone: row.whatsapp_phone,
    button,
    message: row.whatsapp_message,
    url: row.whatsapp_url,
  });

  return uniqueEntries([payloadEntry, legacyEntry])[0] || null;
}

function buildWhatsappEntries(row, payload) {
  const sources = [];
  let invalidJson = false;

  for (const value of [row.whatsapp_json, row.whatsapp_details_json, payload?.whatsapp]) {
    const parsed = parseJsonValue(value);
    if (parsed.invalid) {
      invalidJson = true;
      continue;
    }

    for (const item of toArray(parsed.value)) {
      sources.push(item);
    }
  }

  const legacyEntry = buildLegacyWhatsappEntry(row, payload);
  if (legacyEntry) sources.push(legacyEntry);

  return {
    entries: uniqueEntries(sources),
    invalidJson,
  };
}

function computeCrawlerPlatform(row, payload) {
  const explicit = toFiniteNumber(row.platform ?? payload?.platform);
  if (explicit !== null) return explicit;

  const crawledBy = firstNonBlank(row.crawled_by);
  if (crawledBy && crawledBy.toLowerCase() === 'python') {
    return PYTHON_CRAWLER_PLATFORM;
  }

  return null;
}

function computeSourceApp(row, payload) {
  return firstNonBlank(row.source_app, payload?.source_app, payload?.sourceApp);
}

function computeCreated(row, payload) {
  return formatDateTime(
    payload?.created
      ?? row.created
      ?? row.created_at
      ?? payload?.updated
      ?? row.updated
      ?? row.updated_at
  );
}

function computeUpdated(row, payload) {
  return formatDateTime(
    payload?.updated
      ?? row.updated
      ?? row.updated_at
      ?? payload?.created
      ?? row.created
      ?? row.created_at
  );
}

function redirectStatusMatches(info) {
  if (!info) return false;
  return String(info.DATA_TYPE || '').toLowerCase() === 'tinyint'
    && String(info.COLUMN_TYPE || '').toLowerCase().includes('unsigned')
    && String(info.IS_NULLABLE || '').toUpperCase() === 'NO'
    && String(info.COLUMN_DEFAULT) === '0';
}

function landerStatusMatches(info) {
  if (!info) return false;
  return String(info.DATA_TYPE || '').toLowerCase() === 'tinyint'
    && String(info.COLUMN_TYPE || '').toLowerCase().includes('unsigned')
    && String(info.IS_NULLABLE || '').toUpperCase() === 'NO'
    && String(info.COLUMN_DEFAULT) === '1';
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
  return [
    'CREATE TABLE IF NOT EXISTS `mob_ad_lander_content` (',
    '  `ad_id` BIGINT UNSIGNED NOT NULL,',
    '  `platform` SMALLINT UNSIGNED NULL,',
    '  `lander_status` TINYINT UNSIGNED NOT NULL DEFAULT 1,',
    '  `destinations` TEXT NULL,',
    '  `html_path` VARCHAR(2048) NULL,',
    '  `screen_shot` VARCHAR(2048) NULL,',
    '  `html_content` LONGTEXT NULL,',
    '  `domain_registered_date` DATE NULL,',
    '  `domain_age` SMALLINT UNSIGNED NULL,',
    '  `country_iso_json` LONGTEXT NULL,',
    '  `outgoing_url_json` LONGTEXT NULL,',
    '  `redirects_json` LONGTEXT NULL,',
    '  `source_app` VARCHAR(255) NULL,',
    '  `whatsapp_json` LONGTEXT NULL,',
    '  `campaign_id` VARCHAR(255) NULL,',
    '  `whatsapp_rotator_detected` TINYINT(1) NOT NULL DEFAULT 0,',
    '  `whatsapp_rotator_count` SMALLINT UNSIGNED NOT NULL DEFAULT 0,',
    '  `lead_campaign_tag` VARCHAR(255) NULL,',
    '  `created` DATETIME(3) NULL,',
    '  `updated` DATETIME(3) NULL,',
    '  PRIMARY KEY (`ad_id`),',
    '  KEY `idx_mob_ad_lander_content_status` (`lander_status`, `ad_id`),',
    '  KEY `idx_mob_ad_lander_content_updated` (`updated`, `ad_id`),',
    '  KEY `idx_mob_ad_lander_content_campaign_id` (`campaign_id`),',
    '  KEY `idx_mob_ad_lander_content_campaign_tag` (`lead_campaign_tag`),',
    '  CONSTRAINT `fk_mob_ad_lander_content_ad` FOREIGN KEY (`ad_id`) REFERENCES `mob_ads` (`id`) ON DELETE CASCADE',
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;'
  ].join('\n');
}

function buildClaimsCreateTableSql() {
  return [
    'CREATE TABLE IF NOT EXISTS `mob_ad_lander_claims` (',
    '  `ad_id` BIGINT UNSIGNED NOT NULL,',
    '  `process_date` DATE NOT NULL,',
    '  `scraper_name` VARCHAR(255) NOT NULL,',
    '  `requested_status` TINYINT UNSIGNED NOT NULL DEFAULT 0,',
    '  `claimed_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),',
    '  `completed_at` DATETIME(3) NULL,',
    '  `last_lander_status` TINYINT UNSIGNED NULL,',
    '  `created_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),',
    '  `updated_at` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),',
    '  PRIMARY KEY (`ad_id`, `process_date`),',
    '  KEY `idx_mob_ad_lander_claims_queue` (`process_date`, `requested_status`, `claimed_at`, `ad_id`),',
    '  KEY `idx_mob_ad_lander_claims_scraper` (`scraper_name`, `process_date`, `claimed_at`),',
    '  CONSTRAINT `fk_mob_ad_lander_claims_ad` FOREIGN KEY (`ad_id`) REFERENCES `mob_ads` (`id`) ON DELETE CASCADE',
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;'
  ].join('\n');
}

function buildLanderAlterStatements(existingColumns, existingIndexes, landerStatusInfo) {
  if (!existingColumns.has('ad_id')) {
    throw new Error('mob_ad_lander_content exists without ad_id; recreate it from the base schema before applying additive fields.');
  }

  const clauses = [];

  if (existingColumns.has('lander_status') && !landerStatusMatches(landerStatusInfo)) {
    clauses.push('MODIFY COLUMN `lander_status` TINYINT UNSIGNED NOT NULL DEFAULT 1');
  }

  for (const spec of LANDER_COLUMN_SPECS) {
    if (!existingColumns.has(spec.name)) {
      clauses.push(`ADD COLUMN ${spec.definition}`);
    }
  }

  for (const spec of LANDER_INDEX_SPECS) {
    if (!existingIndexes.has(spec.name)) {
      clauses.push(`ADD KEY \`${spec.name}\` (${spec.definition})`);
    }
  }

  return clauses.length
    ? [`ALTER TABLE \`${LANDER_TABLE}\` ${clauses.join(', ')}`]
    : [];
}

function buildClaimsAlterStatements(existingColumns, existingIndexes) {
  if (!existingColumns.has('ad_id') || !existingColumns.has('process_date')) {
    throw new Error('mob_ad_lander_claims exists without its primary-key columns; recreate it from the base schema before applying additive fields.');
  }

  const clauses = [];

  for (const spec of CLAIMS_COLUMN_SPECS) {
    if (!existingColumns.has(spec.name)) {
      clauses.push(`ADD COLUMN ${spec.definition}`);
    }
  }

  for (const spec of CLAIMS_INDEX_SPECS) {
    if (!existingIndexes.has(spec.name)) {
      clauses.push(`ADD KEY \`${spec.name}\` (${spec.definition})`);
    }
  }

  return clauses.length
    ? [`ALTER TABLE \`${LANDER_CLAIMS_TABLE}\` ${clauses.join(', ')}`]
    : [];
}

function buildObsoleteLanderDropStatements(existingColumns) {
  return OBSOLETE_LANDER_COLUMNS
    .filter((column) => existingColumns.has(column))
    .map((column) => `ALTER TABLE \`${LANDER_TABLE}\` DROP COLUMN \`${column}\``);
}

function selectClause(existingColumns, name) {
  return existingColumns.has(name) ? `\`${name}\`` : `NULL AS \`${name}\``;
}

async function cleanupObsoleteLanderData(sql, commit, existingColumns) {
  const rows = await sql.query(
    `SELECT ${[
      'ad_id',
      'platform',
      'crawled_by',
      'source_app',
      'raw_payload_json',
      'whatsapp_json',
      'whatsapp_details_json',
      'whatsapp_url',
      'whatsapp_domain',
      'whatsapp_phone',
      'whatsapp_message',
      'contact_buttons_json',
      'lead_campaign_tag',
      'created',
      'updated',
      'created_at',
      'updated_at',
    ].map((name) => selectClause(existingColumns, name)).join(', ')}
       FROM \`${LANDER_TABLE}\``
  );

  if (!rows.length) {
    console.log('   no lander rows found for strict cleanup');
    return;
  }

  let changedRows = 0;
  let invalidJsonRows = 0;

  for (const row of rows) {
    const payloadParsed = parseJsonValue(row.raw_payload_json);
    if (payloadParsed.invalid) {
      invalidJsonRows += 1;
    }
    const payload = payloadParsed.value && typeof payloadParsed.value === 'object' && !Array.isArray(payloadParsed.value)
      ? payloadParsed.value
      : null;

    const { entries, invalidJson } = buildWhatsappEntries(row, payload);
    if (invalidJson) {
      invalidJsonRows += 1;
    }

    const uniquePhones = [...new Set(
      entries
        .map((entry) => firstNonBlank(entry.phone))
        .filter(Boolean)
    )];

    const normalized = {
      platform: computeCrawlerPlatform(row, payload),
      source_app: computeSourceApp(row, payload),
      whatsapp_json: JSON.stringify(entries),
      whatsapp_rotator_count: uniquePhones.length,
      whatsapp_rotator_detected: uniquePhones.length > 1 ? 1 : 0,
      lead_campaign_tag: firstNonBlank(
        row.lead_campaign_tag,
        payload?.lead_campaign_tag,
        payload?.campaign_tag,
        payload?.tracking_tag,
        uniquePhones.length > 1 ? HIGH_VOLUME_LEAD_TAG : null
      ),
      created: computeCreated(row, payload),
      updated: computeUpdated(row, payload),
    };

    changedRows += 1;
    if (!commit) {
      continue;
    }

    await sql.query(
      `UPDATE \`${LANDER_TABLE}\`
          SET \`platform\` = ?,
              \`source_app\` = ?,
              \`whatsapp_json\` = ?,
              \`whatsapp_rotator_count\` = ?,
              \`whatsapp_rotator_detected\` = ?,
              \`lead_campaign_tag\` = ?,
              \`created\` = ?,
              \`updated\` = ?
        WHERE \`ad_id\` = ?`,
      [
        normalized.platform,
        normalized.source_app,
        normalized.whatsapp_json,
        normalized.whatsapp_rotator_count,
        normalized.whatsapp_rotator_detected,
        normalized.lead_campaign_tag,
        normalized.created,
        normalized.updated,
        row.ad_id,
      ]
    );
  }

  console.log(`   ${commit ? 'rewrote' : 'would rewrite'} ${changedRows} lander row(s) to the finalized schema`);
  if (invalidJsonRows) {
    console.log(`   encountered ${invalidJsonRows} row(s) with invalid JSON while best-effort backfilling`);
  }
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

async function ensureLanderTable(sql, commit, dropObsolete) {
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
  const landerStatusInfo = existingColumns.has('lander_status')
    ? await getColumnInfo(sql, LANDER_TABLE, 'lander_status')
    : null;

  const statements = buildLanderAlterStatements(existingColumns, existingIndexes, landerStatusInfo);
  await executeStatements(sql, statements, commit);

  if (!dropObsolete) {
    return;
  }

  const cleanupReadableColumns = commit
    ? await getColumnNames(sql, LANDER_TABLE)
    : existingColumns;

  // Cleanup runs before dropping columns so legacy data can be folded into the
  // finalized payload-shaped fields in one pass. In dry-run mode we must keep
  // reading only the live columns; the previewed ADD COLUMN clauses have not
  // executed yet, so selecting those future columns would fail.
  await cleanupObsoleteLanderData(sql, commit, cleanupReadableColumns);
  const cleanupStatements = buildObsoleteLanderDropStatements(cleanupReadableColumns);
  await executeStatements(sql, cleanupStatements, commit);
}

async function ensureClaimsTable(sql, commit) {
  const exists = await tableExists(sql, LANDER_CLAIMS_TABLE);
  if (!exists) {
    const ddl = buildClaimsCreateTableSql();
    if (!commit) {
      console.log(`   would: ${ddl}`);
      return;
    }
    await sql.query(ddl);
    console.log(`   + created ${LANDER_CLAIMS_TABLE}`);
    return;
  }

  const existingColumns = await getColumnNames(sql, LANDER_CLAIMS_TABLE);
  const existingIndexes = await getIndexNames(sql, LANDER_CLAIMS_TABLE);
  const statements = buildClaimsAlterStatements(existingColumns, existingIndexes);
  await executeStatements(sql, statements, commit);
}

async function main() {
  const { commit, dropObsolete } = parseArgs(process.argv.slice(2));
  const mode = commit ? 'COMMIT' : 'DRY-RUN';
  console.log(`\n=== AdMob lander SQL migration - ${mode} ===`);
  if (dropObsolete) {
    console.log('strict cleanup: enabled (legacy lander fields will be backfilled and dropped)');
  }

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
  await ensureLanderTable(sql, commit, dropObsolete);

  console.log(`   checking ${LANDER_CLAIMS_TABLE}`);
  await ensureClaimsTable(sql, commit);

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
  buildClaimsAlterStatements,
  buildClaimsCreateTableSql,
  buildObsoleteLanderDropStatements,
  buildRedirectStatusStatements,
  cleanupObsoleteLanderData,
  ensureClaimsTable,
  executeStatements,
  getColumnInfo,
  getColumnNames,
  getIndexNames,
  isBlank,
  landerStatusMatches,
  main,
  normalizeWhatsappDetailsJson,
  parseArgs,
  redirectStatusMatches,
  tableExists,
};
