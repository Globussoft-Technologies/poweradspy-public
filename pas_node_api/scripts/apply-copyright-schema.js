'use strict';

/**
 * Creates + validates the 12 copyright-compliance tables in every distinct
 * physical SQL database (B1 blocklist, B2 image hashes, B3 takedown, B6
 * complaints/audit).
 * It ONLY creates and validates tables — takedown deletion and auditing are
 * implemented elsewhere.
 *
 *   B1  copyright_blocklist, copyright_blocked_attempts
 *   B2  copyright_image_hashes, copyright_review_queue, copyright_image_hash_jobs, copyright_image_hash_results
 *   B3  copyright_takedown_runs, copyright_takedown_actions,
 *       copyright_takedown_blocklist_entries                    (requires B1 table)
 *   B6  copyright_complaints, copyright_complaint_items,
 *       copyright_complaint_blocklist_entries, copyright_audit_runs,
 *       copyright_audit_findings                                (requires B1 table)
 *
 * Contract:
 *  - DRY-RUN by default: connects, reads information_schema, prints what it would
 *    do. Nothing is written without --apply --confirm-prod and a typed confirmation.
 *  - Targets = every network with database.sql.enabled, EVEN IF the application
 *    network itself is disabled (B3/B6 act on existing data). Only the SQL part
 *    of the config is passed to connectAll() (enabled forced on) so Mongo/ES are
 *    never touched.
 *  - Physical databases are deduplicated by host + port + user + database; the
 *    other networks resolving to the same database are "covered by shared target".
 *  - Existing tables are validated (columns, types, nullability, character set and
 *    collation, indexes). A mismatch is REPORTED, never altered.
 *  - --only=B3 / --only=B6 fail clearly if copyright_blocklist is missing
 *    (unless B1 is selected in the same run).
 *  - B2 is partially dependent: --only=B2 creates copyright_image_hashes on its
 *    own, but reports copyright_review_queue as dependency-missing unless
 *    copyright_blocklist exists or B1 is selected in the same run (--only=B1,B2).
 *  - A failure on one database never stops the others.
 *  - No foreign keys at all (and none into ad tables); correlation is by UUIDs.
 *    Timestamps are UTC DATETIMEs supplied by the writer (no DB defaults).
 *    Every NOT NULL column therefore has to be supplied by the writer's INSERT
 *    (for copyright_blocklist that includes added_by).
 *
 * Usage:
 *   node scripts/apply-copyright-schema.js                       # dry-run, all SQL databases
 *   node scripts/apply-copyright-schema.js --only=B1,B2          # subset of B1,B2,B3,B6
 *   node scripts/apply-copyright-schema.js --networks=facebook,reddit
 *   node scripts/apply-copyright-schema.js --show-ddl            # also print the DDL
 *   node scripts/apply-copyright-schema.js --apply --confirm-prod # actually create tables
 */

require('dotenv').config();
const readline = require('readline');
const config = require('../src/config');
const databaseManager = require('../src/database/DatabaseManager');
const networksConfig = require('../src/config/networks');

const OWNERS = ['B1', 'B2', 'B3', 'B6'];
const APPLY_PHRASE = 'create copyright tables in production';

// ─── Table definitions ──────────────────────────────────────────────────
// Column helpers. `ascii` columns hold ids/hashes/enums-as-strings; ad
// identifiers are kept as case-sensitive strings so they never depend on a
// network's ad-table id type.
const ASCII = 'CHARACTER SET ascii COLLATE ascii_bin';
// The collation is written on every text column. In MySQL a column-level
// CHARACTER SET without COLLATE takes the character set's default collation
// (e.g. utf8mb4_0900_ai_ci), NOT the table's, so relying on the table default
// would create columns that the validator below then reports as a mismatch.
const TABLE_COLLATION = 'utf8mb4_bin';
const UTF8 = `CHARACTER SET utf8mb4 COLLATE ${TABLE_COLLATION}`;

const c = (name, type, { nullable = false, charset = '', auto = false } = {}) =>
  ({ name, type, nullable, charset, auto });

const id = () => c('id', 'bigint unsigned', { auto: true });
const network = () => c('network', 'varchar(32)', { charset: ASCII });
const uuid = (name, nullable = false) => c(name, 'char(36)', { charset: ASCII, nullable });
const code = (name, len, nullable = false) => c(name, `varchar(${len})`, { charset: ASCII, nullable });
// Internal and platform IDs are identifier strings, not user-facing text. Keeping
// them ASCII preserves case-sensitive matching and keeps composite indexes
// compatible with older InnoDB index-size limits.
const adId = (name, nullable = false) => c(name, 'varchar(255)', { charset: ASCII, nullable });
const str = (name, len, nullable = true) => c(name, `varchar(${len})`, { charset: UTF8, nullable });
const text = (name, nullable = true) => c(name, 'mediumtext', { charset: UTF8, nullable });
const longText = (name, nullable = true) => c(name, 'longtext', { charset: UTF8, nullable });
const count = (name, nullable = true) => c(name, 'bigint unsigned', { nullable });
const dt = (name, nullable = false) => c(name, 'datetime', { nullable });

const pk = (...cols) => ({ name: 'PRIMARY', unique: true, cols });
const uq = (name, ...cols) => ({ name, unique: true, cols });
const ix = (name, ...cols) => ({ name, unique: false, cols });

const TABLES = [
  // ── B1 ──
  {
    owner: 'B1',
    name: 'copyright_blocklist',
    columns: [
      id(), network(),
      // ad_id | advertiser | page | url | image_url | domain  (matched at ingestion by B1)
      // image_hash                                             (B2 only; ignored by B1)
      code('entry_type', 32),
      // ad_id: 'platform' (scraper ad id) or 'internal' (our SQL row id); 'none' for every other type.
      // Equal-looking ids can be different ads, so B1 matches only 'platform' at insertion.
      code('identifier_namespace', 16),
      // For entry_type = image_hash, B1 and B2 writers both use value = image_sha256
      // (lowercase hex) and value_sha256 = sha256(value), so uq_blocklist_entry
      // allows one row per banned image per network.
      str('value', 2048, false),              // human-readable value (URLs up to 2048, as in ad tables)
      c('value_sha256', 'char(64)', { charset: ASCII }),
      // entry_type = image_hash only: the banned image's own hashes, so B2 can compare
      // exact (sha256 =) and near (bits that differ in image_phash) without parsing `value`.
      // No phash bucket: a near copy can differ inside any bucket's bits and be skipped.
      // The blocklist is small enough to compare in memory against every active row.
      c('image_sha256', 'char(64)', { charset: ASCII, nullable: true }),
      code('image_phash_algo', 16, true),     // hash version, e.g. sscd-simhash-v1; must match B2.phash_algo before comparing
      // 256-bit perceptual hash of the image-hashing service (sscd-simhash-v1) as 64 lowercase hex
      // characters. Too wide for a BIGINT, and MySQL BIT_COUNT is 64-bit, so the distance is
      // computed in the application (8 x 32-bit words), never in SQL.
      c('image_phash', 'char(64)', { charset: ASCII, nullable: true }),
      str('reason', 255), code('source', 64, true),
      uuid('complaint_id', true),
      code('status', 32),                     // active | expired | revoked
      dt('expires_at', true), text('details'),
      dt('created_at'),                       // block added_at
      str('added_by', 128, false),            // service, owner, or operator that added the block (required)
      dt('removed_at', true), str('removed_by', 128),
      dt('updated_at'),
    ],
    indexes: [
      pk('id'),
      uq('uq_blocklist_entry', 'network', 'entry_type', 'identifier_namespace', 'value_sha256'),
      ix('idx_blocklist_status', 'network', 'status'),
      ix('idx_blocklist_complaint', 'complaint_id'),
      ix('idx_blocklist_image_sha256', 'image_sha256'),
    ],
  },
  {
    owner: 'B1',
    name: 'copyright_blocked_attempts',
    // One row per ad rejected at ingestion. Identifiers only — never the payload.
    columns: [
      id(), network(),
      adId('platform_ad_id', true),           // ad id as received
      str('advertiser', 255), str('image_url', 2048),
      count('blocklist_id', false),           // which copyright_blocklist row matched
      code('match_type', 32),                 // e.g. ad_id | advertiser | url | domain | sha256 | phash
      c('distance', 'smallint unsigned', { nullable: true }),  // phash bits different, 0..256 (phash matches only)
      code('source', 64, true),               // endpoint / pipeline that rejected it
      dt('created_at'),
    ],
    indexes: [
      pk('id'),
      ix('idx_blocked_attempts_time', 'network', 'created_at'),
      ix('idx_blocked_attempts_entry', 'blocklist_id'),
    ],
  },

  // ── B2 ──
  {
    owner: 'B2',
    name: 'copyright_image_hashes',
    // One row per image (both hashes side by side). phash is the 256-bit hash as 64 hex
    // characters; near-match sweeps read it in batches and compare in the application
    // (BIT_COUNT is 64-bit and cannot compare it in SQL).
    // Ingestion never reads this table: a new image is compared only against the
    // active copyright_blocklist rows (small, cached in memory). Only B3 takedown and
    // B6 audit sweeps scan this table, as offline batch jobs, so ingestion latency does
    // not grow with the image count. There is deliberately no bucket / candidate index:
    // a near copy can differ inside any bucket's bits and be skipped.
    columns: [
      id(), network(),
      adId('internal_ad_id'), adId('platform_ad_id'),
      code('media_role', 32),                 // e.g. creative | thumbnail | logo
      c('ordinal', 'smallint unsigned'),      // position inside a carousel (0 = first)
      c('sha256', 'char(64)', { charset: ASCII }),   // exact copy
      // Nullable: an image that cannot be decoded for a perceptual hash is still
      // stored with its sha256, so exact-copy sweeps can find it.
      c('phash', 'char(64)', { charset: ASCII, nullable: true }),   // 256-bit perceptual hash, 64 hex characters
      code('phash_algo', 16, true),           // hash version, e.g. sscd-simhash-v1; NULL when phash is NULL
      str('source_url', 2048), str('storage_path', 2048),
      code('source', 16),                     // ingest | backfill
      dt('created_at'),
    ],
    indexes: [
      pk('id'),
      uq('uq_image_slot', 'network', 'platform_ad_id', 'media_role', 'ordinal'),
      ix('idx_image_sha256', 'sha256'),
      ix('idx_image_hash_internal', 'network', 'internal_ad_id'),
    ],
  },
  {
    owner: 'B2',
    name: 'copyright_review_queue',
    // Near-threshold matches held for a human (B7 owner); the ad is not saved while pending.
    columns: [
      id(), network(),
      adId('platform_ad_id', true), str('advertiser', 255), str('image_url', 2048),
      // Media-slot identity, so a decision maps to the exact creative of a carousel /
      // multi-media ad. internal_ad_id is NULL for a new ad (not saved while pending).
      adId('internal_ad_id', true),
      code('media_role', 32),                 // e.g. creative | thumbnail | logo
      c('ordinal', 'smallint unsigned'),      // position inside a carousel (0 = first)
      c('sha256', 'char(64)', { charset: ASCII }),
      c('phash', 'char(64)', { charset: ASCII }),   // 256-bit perceptual hash, 64 hex characters
      code('phash_algo', 16),                 // must match copyright_blocklist.image_phash_algo
      count('blocklist_id', false),           // closest copyright_blocklist row
      c('distance', 'smallint unsigned'),     // phash bits different, 0..256
      code('status', 16),                     // pending | allowed | blocked
      str('reviewed_by', 128), dt('reviewed_at', true), str('note', 512),
      dt('created_at'),
    ],
    indexes: [
      pk('id'),
      // One row per image per banned entry: before holding an image, the writer looks
      // this up and reuses an earlier decision (allowed / blocked) or pending row
      // instead of queuing the same image again.
      uq('uq_review_image', 'network', 'sha256', 'blocklist_id'),
      ix('idx_review_status', 'network', 'status', 'created_at'),
      ix('idx_review_blocklist', 'blocklist_id'),
    ],
  },
  {
    owner: 'B2',
    name: 'copyright_image_hash_jobs',
    // One row per blocked advertiser (a copyright_blocklist entry of type advertiser / page) whose
    // images are to be hashed by the background worker (src/compliance/imagematch/worker.js).
    // The worker creates the row itself (one per entry, so a repeat is harmless), one worker claims
    // it at a time, and `state` holds the job's place so a stopped job continues where it stopped.
    // Small table: a few rows per blocked advertiser. No delete anywhere: finished rows stay as the record.
    columns: [
      id(), network(),
      count('blocklist_id', false),           // the copyright_blocklist entry that started the job
      code('entry_type', 32),                 // advertiser | page | ad_id | url | image_url (what the entry blocks)
      code('identifier_namespace', 16),       // copied from the entry: internal | platform for ad_id; none otherwise
      str('advertiser_name', 255, false),     // its value, as written
      uuid('complaint_id', true),             // copied from that entry; the image_hash entries get the same one
      code('status', 32),                     // pending | running | done | no_owner | limit_reached | unresolved | failed
      c('attempts', 'smallint unsigned'),     // times it was claimed; a job that keeps failing ends as failed
      // Generations: every block of the entry (the first, and each re-block / requeue) is one generation. requested_gen is the newest
      // one asked for, run_gen the one the current/last run works for, covered_gen the newest one a run completed (done / no_owner).
      // Work is covered for a block only when covered_gen >= the requested_gen that block made. A run that finishes after a newer
      // request arrived does not count for it: the job goes back to pending and runs again.
      c('requested_gen', 'int unsigned'), c('run_gen', 'int unsigned'), c('covered_gen', 'int unsigned'),
      dt('requested_at', true),               // when requested_gen last changed (NULL until the first re-block)
      code('claimed_by', 128, true), dt('claimed_at', true),
      dt('heartbeat_at', true),               // renewed after every page: an old one means the worker died
      c('progress_seq', 'int unsigned'),      // +1 at every save, so a save always changes the row
      text('state'),                          // JSON: the owners and the last ad id done of each, and the counts
      str('last_error', 512),
      dt('created_at'), dt('updated_at'), dt('finished_at', true),
    ],
    indexes: [
      pk('id'),
      uq('uq_hashjob_entry', 'network', 'blocklist_id'),
      ix('idx_hashjob_status', 'network', 'status', 'id'),
    ],
  },
  {
    owner: 'B2',
    name: 'copyright_image_hash_results',
    // What a hash job did with each image it looked at: one row per (job, generation, ad, image). B3 reads it to see which ads and
    // images were processed, skipped or failed, and why, and to retry. It holds identifiers and outcomes only, never image data.
    // `generation` is the job's run (copyright_image_hash_jobs.requested_gen when the run started): a requeued job writes new rows
    // under a new generation and the old rows stay, so the previous run and the current run are told apart by generation.
    // Written only by the hash job (side job); ingestion never reads it. No delete anywhere.
    columns: [
      id(), network(),
      count('job_id', false), count('blocklist_id', false), c('generation', 'int unsigned'),
      adId('platform_ad_id', true),                                 // the scraper's ad id; NULL for a media URL hashed on its own
      adId('internal_ad_id'),                                       // our row id; '' for a media URL hashed on its own
      c('slot_hash', 'char(40)', { charset: ASCII }),               // sha1 of the stored path / URL: the image inside the ad
      str('source_url', 2048),                                      // the stored path or URL, as found
      code('outcome', 16),                                          // hashed | duplicate | skipped | failed
      str('reason', 128),                                           // why, for skipped / failed (and what a duplicate repeats)
      c('sha256', 'char(64)', { charset: ASCII, nullable: true }),  // of the image, when it was hashed
      dt('created_at'), dt('updated_at'),
    ],
    indexes: [
      pk('id'),
      uq('uq_hashresult_slot', 'job_id', 'generation', 'internal_ad_id', 'slot_hash'),
      ix('idx_hashresult_ad', 'network', 'platform_ad_id'),
      ix('idx_hashresult_job', 'job_id', 'generation', 'outcome', 'id'),
    ],
  },

  // ── B3 ──
  {
    owner: 'B3',
    name: 'copyright_takedown_runs',
    columns: [
      uuid('run_id'), network(),
      uuid('complaint_id', true),
      code('trigger_type', 32), code('mode', 16),     // mode: dry_run | execute
      code('status', 32),
      dt('started_at'), dt('finished_at', true),
      count('items_planned'), count('items_succeeded'), count('items_failed'),
      code('code_revision', 64, true), str('operator', 128),
      // Immutable JSON captured after resolution and before the first delete.
      longText('preflight_snapshot', false),
      str('report_uri', 1024), str('proof_uri', 1024), text('details'),
      dt('created_at'),
    ],
    indexes: [
      pk('run_id', 'network'),
      ix('idx_takedown_runs_complaint', 'complaint_id'),
      ix('idx_takedown_runs_status', 'network', 'status'),
    ],
  },
  {
    owner: 'B3',
    name: 'copyright_takedown_actions',
    columns: [
      id(), uuid('run_id'), network(),
      code('target_type', 32),                // ad | image | url | storage_path | queue_job
      adId('target_id', true), adId('internal_ad_id', true),
      // target_value carries long paths, queue IDs, or other identifiers that
      // do not fit the optional 255-character target_id column.
      str('target_value', 2048), str('target_url', 2048),
      code('system', 32),                     // sql | mongo | elastic | storage | cdn | saved_state | export | queue | verification
      code('operation', 32),                  // delete | redact | disable
      code('status', 32), text('error_message'), text('details'),
      c('attempts', 'smallint unsigned'),
      str('proof_uri', 1024), code('code_revision', 64, true),
      dt('next_retry_at', true),
      dt('started_at', true), dt('finished_at', true), dt('created_at'),
    ],
    indexes: [
      pk('id'),
      ix('idx_takedown_actions_run', 'run_id', 'network'),
      ix('idx_takedown_actions_target', 'network', 'target_id'),
      ix('idx_takedown_actions_status', 'status'),
      ix('idx_takedown_actions_retry', 'status', 'next_retry_at'),
    ],
  },
  {
    owner: 'B3',
    name: 'copyright_takedown_blocklist_entries',
    // A single takedown can create several blocklist rows (advertiser, ad,
    // URL, and hashes), so keep the complete run-to-blocklist relationship.
    columns: [
      id(), uuid('run_id'), network(), count('blocklist_id', false), dt('created_at'),
    ],
    indexes: [
      pk('id'),
      uq('uq_takedown_blocklist_entry', 'network', 'run_id', 'blocklist_id'),
      ix('idx_takedown_blocklist_run', 'network', 'run_id'),
      ix('idx_takedown_blocklist_entry', 'network', 'blocklist_id'),
    ],
  },

  // ── B6 ──
  {
    owner: 'B6',
    name: 'copyright_complaints',
    columns: [
      uuid('complaint_id'), network(),
      code('source', 64), str('source_reference', 255),
      str('complainant_name', 255), str('complainant_email', 255), str('complainant_org', 255),
      text('claim_description'),
      code('status', 32),
      dt('received_at'),
      code('action_taken', 64, true), text('action_summary'),
      dt('closed_at', true), str('closure_reason', 255),
      str('report_uri', 1024), str('proof_uri', 1024), text('details'),
      dt('created_at'), dt('updated_at'),
    ],
    indexes: [
      pk('complaint_id', 'network'),
      ix('idx_complaints_status', 'network', 'status'),
      ix('idx_complaints_received', 'received_at'),
    ],
  },
  {
    owner: 'B6',
    name: 'copyright_complaint_items',
    columns: [
      id(), uuid('complaint_id'), network(),
      code('item_type', 32),                  // ad | image | url | advertiser
      adId('internal_ad_id', true), adId('platform_ad_id', true),
      // item_value also carries advertiser names and ad IDs; item_url remains
      // for URL-specific queries and backwards-compatible report fields.
      str('item_value', 2048), c('item_value_sha256', 'char(64)', { charset: ASCII, nullable: true }),
      str('item_url', 2048), c('item_url_sha256', 'char(64)', { charset: ASCII, nullable: true }),
      uuid('takedown_run_id', true),
      code('status', 32), code('action_taken', 64, true),
      str('proof_uri', 1024), text('details'),
      dt('created_at'), dt('updated_at'),
    ],
    indexes: [
      pk('id'),
      ix('idx_complaint_items_complaint', 'complaint_id', 'network'),
      ix('idx_complaint_items_value', 'network', 'item_value_sha256'),
      ix('idx_complaint_items_url', 'network', 'item_url_sha256'),
      ix('idx_complaint_items_run', 'takedown_run_id'),
    ],
  },
  {
    owner: 'B6',
    name: 'copyright_complaint_blocklist_entries',
    // A complaint item may produce multiple blocklist entries; do not collapse
    // that relationship into one nullable column on copyright_complaint_items.
    columns: [
      id(), count('complaint_item_id', false), network(), count('blocklist_id', false), dt('created_at'),
    ],
    indexes: [
      pk('id'),
      uq('uq_complaint_blocklist_entry', 'network', 'complaint_item_id', 'blocklist_id'),
      ix('idx_complaint_blocklist_item', 'network', 'complaint_item_id'),
      ix('idx_complaint_blocklist_entry', 'network', 'blocklist_id'),
    ],
  },
  {
    owner: 'B6',
    name: 'copyright_audit_runs',
    columns: [
      uuid('audit_id'), network(),
      code('audit_type', 32),
      code('status', 32),
      dt('started_at'), dt('finished_at', true),
      count('expected_count'), count('found_count'),
      uuid('takedown_run_id', true),
      code('code_revision', 64, true),
      str('report_uri', 1024), text('details'),
      dt('created_at'),
    ],
    indexes: [
      pk('audit_id', 'network'),
      ix('idx_audit_runs_type', 'network', 'audit_type', 'status'),
      ix('idx_audit_runs_takedown', 'takedown_run_id'),
    ],
  },
  {
    owner: 'B6',
    name: 'copyright_audit_findings',
    columns: [
      id(), uuid('audit_id'), network(),
      code('finding_type', 32),
      code('system', 32), str('location', 2048),      // where it was found (table / index / path)
      adId('internal_ad_id', true), adId('platform_ad_id', true),
      code('target_type', 32, true), str('target_value', 2048),
      c('value_sha256', 'char(64)', { charset: ASCII, nullable: true }),
      count('expected_count'), count('found_count'),
      text('details'),
      code('status', 32),                         // open | in_progress | resolved | false_positive
      code('resolution', 32, true), text('resolution_note'), dt('resolved_at', true),
      uuid('takedown_run_id', true), str('proof_uri', 1024),
      dt('created_at'),
    ],
    indexes: [
      pk('id'),
      ix('idx_audit_findings_audit', 'audit_id', 'network'),
      ix('idx_audit_findings_status', 'network', 'status'),
      ix('idx_audit_findings_value', 'network', 'value_sha256'),
      ix('idx_audit_findings_resolution', 'network', 'resolution'),
      ix('idx_audit_findings_takedown', 'takedown_run_id'),
    ],
  },
];

// Tables an owner needs to exist (created by B1) before it may be created.
const OWNER_REQUIRES = { B3: 'copyright_blocklist', B6: 'copyright_blocklist' };
// A table-level dependency is used where only one table in an owner needs B1.
// The B2 hash store can stand alone, but its human-review queue cannot.
const TABLE_REQUIRES = { copyright_review_queue: 'copyright_blocklist', copyright_image_hash_jobs: 'copyright_blocklist' };
const TABLE_BY_NAME = new Map(TABLES.map((table) => [table.name, table]));

// ─── DDL generation ─────────────────────────────────────────────────────
function createDdl(t) {
  const colSql = t.columns.map((col) =>
    `  \`${col.name}\` ${col.type}${col.charset ? ' ' + col.charset : ''} ${col.nullable ? 'NULL' : 'NOT NULL'}${col.auto ? ' AUTO_INCREMENT' : ''}`);
  const idxSql = t.indexes.map((i) => {
    const cols = i.cols.map((n) => `\`${n}\``).join(', ');
    if (i.name === 'PRIMARY') return `  PRIMARY KEY (${cols})`;
    return `  ${i.unique ? 'UNIQUE KEY' : 'KEY'} \`${i.name}\` (${cols})`;
  });
  return `CREATE TABLE IF NOT EXISTS \`${t.name}\` (\n${[...colSql, ...idxSql].join(',\n')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=${TABLE_COLLATION}`;
}

// ─── Validation of an existing table ────────────────────────────────────
// MySQL 5.7 reports int(11) / bigint(20) unsigned; 8.x reports int / bigint unsigned.
const normType = (s) => String(s).toLowerCase().replace(/\b(tinyint|smallint|mediumint|int|bigint)\(\d+\)/, '$1');
const EXPECTED_CHARSETS = new Map([
  [ASCII, { characterSet: 'ascii', collation: 'ascii_bin' }],
  // UTF8 names its collation explicitly (see the note at its definition).
  [UTF8, { characterSet: 'utf8mb4', collation: TABLE_COLLATION }],
]);

async function inspectTable(sql, dbName, t) {
  // IF NOT EXISTS does not repair a pre-existing table, so validate the
  // storage engine and table collation before accepting it as compatible.
  const tableRows = await sql.query(
    `SELECT engine, table_collation AS tableCollation
       FROM information_schema.tables
      WHERE table_schema = ? AND table_name = ?`,
    [dbName, t.name]
  );
  if (!tableRows.length) return { state: 'missing', problems: [] };

  const cols = await sql.query(
    `SELECT column_name AS name, column_type AS type, is_nullable AS nullable, extra,
            character_set_name AS characterSet, collation_name AS collation
       FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ?`,
    [dbName, t.name]
  );
  if (!cols.length) return { state: 'mismatch', problems: ['table exists but has no columns'] };

  const problems = [];
  const tableMeta = tableRows[0];
  if (String(tableMeta.engine || '').toUpperCase() !== 'INNODB') {
    problems.push(`table engine ${tableMeta.engine || '(none)'} != InnoDB`);
  }
  if (String(tableMeta.tableCollation || '').toLowerCase() !== TABLE_COLLATION) {
    problems.push(`table collation ${tableMeta.tableCollation || '(none)'} != ${TABLE_COLLATION}`);
  }

  const actual = new Map(cols.map((r) => [r.name, r]));
  for (const col of t.columns) {
    const a = actual.get(col.name);
    if (!a) { problems.push(`missing column ${col.name}`); continue; }
    if (normType(a.type) !== col.type) problems.push(`column ${col.name}: type ${a.type} != ${col.type}`);
    if ((a.nullable === 'YES') !== col.nullable) problems.push(`column ${col.name}: nullable ${a.nullable} != ${col.nullable ? 'YES' : 'NO'}`);
    if (/auto_increment/i.test(a.extra || '') !== col.auto) problems.push(`column ${col.name}: auto_increment mismatch`);
    const expectedCharset = EXPECTED_CHARSETS.get(col.charset);
    if (expectedCharset && (
      String(a.characterSet || '').toLowerCase() !== expectedCharset.characterSet
      || String(a.collation || '').toLowerCase() !== expectedCharset.collation
    )) {
      problems.push(
        `column ${col.name}: charset/collation ${a.characterSet || '(none)'}/${a.collation || '(none)'} `
        + `!= ${expectedCharset.characterSet}/${expectedCharset.collation}`
      );
    }
  }
  const expectedNames = new Set(t.columns.map((col) => col.name));
  for (const name of actual.keys()) if (!expectedNames.has(name)) problems.push(`unexpected column ${name}`);

  const idxRows = await sql.query(
    // Prefix indexes can report the same column names while weakening hash
    // uniqueness; sub_part and index_type are checked below for that reason.
    `SELECT index_name AS name, non_unique AS nonUnique, seq_in_index AS seq, column_name AS col,
            sub_part AS subPart, index_type AS indexType
       FROM information_schema.statistics
      WHERE table_schema = ? AND table_name = ?
      ORDER BY index_name, seq_in_index`,
    [dbName, t.name]
  );
  const actualIdx = new Map();
  for (const r of idxRows) {
    if (!actualIdx.has(r.name)) {
      actualIdx.set(r.name, {
        unique: Number(r.nonUnique) === 0,
        cols: [],
        hasPrefix: false,
        indexType: r.indexType,
      });
    }
    const index = actualIdx.get(r.name);
    index.cols.push(r.col);
    if (r.subPart !== null && r.subPart !== undefined) index.hasPrefix = true;
  }
  for (const i of t.indexes) {
    const a = actualIdx.get(i.name);
    if (!a) { problems.push(`missing index ${i.name}`); continue; }
    if (a.unique !== i.unique) problems.push(`index ${i.name}: uniqueness differs`);
    if (a.cols.join(',') !== i.cols.join(',')) problems.push(`index ${i.name}: columns (${a.cols.join(',')}) != (${i.cols.join(',')})`);
    if (a.hasPrefix) problems.push(`index ${i.name}: prefix index is not allowed`);
    if (String(a.indexType || '').toUpperCase() !== 'BTREE') problems.push(`index ${i.name}: type ${a.indexType} != BTREE`);
  }
  const expectedIdx = new Set(t.indexes.map((i) => i.name));
  for (const name of actualIdx.keys()) if (!expectedIdx.has(name)) problems.push(`unexpected index ${name}`);

  return { state: problems.length ? 'mismatch' : 'ok', problems };
}

// ─── Per-database processing ────────────────────────────────────────────
async function processTarget(sql, selectedOwners, apply) {
  const rows = await sql.query('SELECT DATABASE() AS db');
  const dbName = (Array.isArray(rows) ? rows[0] : rows).db;

  const selected = TABLES.filter((t) => selectedOwners.has(t.owner));
  const toInspect = new Set(selected);
  const requiredNames = new Set();
  for (const owner of selectedOwners) {
    if (OWNER_REQUIRES[owner]) requiredNames.add(OWNER_REQUIRES[owner]);
  }
  for (const table of selected) {
    if (TABLE_REQUIRES[table.name]) requiredNames.add(TABLE_REQUIRES[table.name]);
  }
  for (const name of requiredNames) {
    const dependency = TABLE_BY_NAME.get(name);
    if (dependency) toInspect.add(dependency);
  }
  const inspected = new Map();
  for (const t of toInspect) inspected.set(t.name, await inspectTable(sql, dbName, t));

  const results = [];
  for (const owner of OWNERS.filter((o) => selectedOwners.has(o))) {
    const ownerTables = TABLES.filter((t) => t.owner === owner);
    const dep = OWNER_REQUIRES[owner];
    if (dep) {
      const depState = inspected.get(dep).state;
      const depOk = depState === 'ok' || (depState === 'missing' && selectedOwners.has('B1'));
      if (!depOk) {
        const why = depState === 'missing'
          ? `requires ${dep}, which is missing — include B1 (--only=B1,${owner}) or create it first`
          : `requires ${dep}, which exists but does not match the expected schema`;
        for (const t of ownerTables) results.push({ table: t.name, state: 'dependency-missing', problems: [why] });
        continue;
      }
    }
    for (const t of ownerTables) {
      const tableDep = TABLE_REQUIRES[t.name];
      if (tableDep) {
        const depState = inspected.get(tableDep).state;
        const depOk = depState === 'ok' || (depState === 'missing' && selectedOwners.has('B1'));
        if (!depOk) {
          const why = depState === 'missing'
            ? `requires ${tableDep}, which is missing — include B1 (--only=B1,${owner}) or create it first`
            : `requires ${tableDep}, which exists but does not match the expected schema`;
          results.push({ table: t.name, state: 'dependency-missing', problems: [why] });
          continue;
        }
      }
      const cur = inspected.get(t.name);
      if (cur.state !== 'missing') { results.push({ table: t.name, ...cur }); continue; }
      if (!apply) { results.push({ table: t.name, state: 'would-create', problems: [] }); continue; }
      await sql.query(createDdl(t));
      const after = await inspectTable(sql, dbName, t); // verify what the server actually built
      inspected.set(t.name, after);
      results.push(after.state === 'ok'
        ? { table: t.name, state: 'created', problems: [] }
        : { table: t.name, state: 'mismatch', problems: ['created but does not validate: ' + after.problems.join('; ')] });
    }
  }
  return { dbName, results };
}

// ─── CLI / target resolution ────────────────────────────────────────────
function parseArgs(argv) {
  const opts = {
    apply: false,
    confirmProd: false,
    showDdl: false,
    only: new Set(OWNERS),
    networks: null,
  };
  for (const arg of argv) {
    if (arg === '--apply') opts.apply = true;
    else if (arg === '--confirm-prod') opts.confirmProd = true;
    else if (arg === '--show-ddl') opts.showDdl = true;
    else if (arg.startsWith('--only=')) {
      const list = arg.slice(7).split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
      const bad = list.filter((o) => !OWNERS.includes(o));
      if (!list.length || bad.length) throw new Error(`--only accepts ${OWNERS.join(',')} (got ${bad.join(',') || 'nothing'})`);
      opts.only = new Set(list);
    } else if (arg.startsWith('--networks=')) {
      opts.networks = arg.slice(11).split(',').map((s) => s.trim()).filter(Boolean);
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

function resolveTargets(requested) {
  const available = Object.entries(networksConfig).filter(([, cfg]) => cfg.database?.sql?.enabled);
  const availableSlugs = new Set(available.map(([slug]) => slug));
  if (requested) {
    const unknown = requested.filter((s) => !availableSlugs.has(s));
    if (unknown.length) throw new Error(`No SQL configured (database.sql.enabled) for: ${unknown.join(', ')}`);
  }
  const chosen = available.filter(([slug]) => !requested || requested.includes(slug));

  // Dedupe by physical database identity — password deliberately excluded.
  const byKey = new Map();
  for (const [slug, cfg] of chosen) {
    const s = cfg.database.sql;
    const key = `${s.host}:${s.port}|${s.user}|${s.database}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        key, slug, sql: s,
        appDisabled: !cfg.enabled,
        sharedDefaultDb: s.database === config.databases.sql.database,
        covered: [],
      });
    } else byKey.get(key).covered.push(slug);
  }
  return [...byKey.values()];
}

function confirmProduction(targets) {
  console.log('\n--apply will create tables in:');
  for (const t of targets) console.log(`  - ${t.sql.host}:${t.sql.port}/${t.sql.database} (${[t.slug, ...t.covered].join(', ')})`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`Type "${APPLY_PHRASE}" to continue: `, (answer) => {
      rl.close();
      resolve(answer.trim() === APPLY_PHRASE);
    });
  });
}

// ─── Main ───────────────────────────────────────────────────────────────
async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const targets = resolveTargets(opts.networks);
  if (!targets.length) throw new Error('No SQL databases selected.');

  const mode = opts.apply ? 'APPLY' : 'DRY-RUN';
  console.log(`[copyright-schema] ${mode} | env=${config.env} | owners=${[...opts.only].join(',')} | ${targets.length} distinct database(s)`);
  if (opts.showDdl) {
    for (const t of TABLES.filter((x) => opts.only.has(x.owner))) console.log(`\n-- ${t.owner}\n${createDdl(t)};`);
    console.log('');
  }

  // Require the explicit flag and phrase for every write. This keeps a
  // misclassified production environment from silently bypassing confirmation.
  if (opts.apply) {
    if (!opts.confirmProd) {
      throw new Error('Refusing --apply: pass --confirm-prod and type the exact confirmation phrase.');
    }
    if (!(await confirmProduction(targets))) {
      console.log('Confirmation not given — nothing was changed.');
      return 1;
    }
  }

  // Only the SQL part of each representative network is connected, with
  // enabled forced on, so a disabled app network can be migrated without
  // touching its Mongo/Elasticsearch.
  const scoped = {};
  for (const t of targets) scoped[t.slug] = { enabled: true, database: { sql: { ...t.sql } } };
  await databaseManager.connectAll(scoped);

  let failures = 0;
  for (const t of targets) {
    const names = [t.slug, ...t.covered];
    console.log(`\n=== ${t.sql.host}:${t.sql.port}/${t.sql.database}  [${names.join(', ')}]`);
    if (t.appDisabled) console.log(`  NOTE  ${t.slug}: application network is disabled — included because its SQL is configured`);
    if (t.sharedDefaultDb) console.log(`  WARN  ${t.slug}: database is the SHARED DEFAULT (no network-specific name) — confirm this is the intended target`);
    for (const slug of t.covered) console.log(`  ${slug}: covered by shared target ${t.slug}`);

    const sql = databaseManager.getSQL(t.slug);
    if (!sql) { console.log('  FAIL  SQL connection failed (see log above); covered networks are NOT covered'); failures++; continue; }
    try {
      const { results } = await processTarget(sql, opts.only, opts.apply);
      for (const r of results) {
        console.log(`  ${r.state.toUpperCase().padEnd(18)} ${r.table}`);
        for (const p of r.problems) console.log(`      - ${p}`);
        if (['mismatch', 'dependency-missing'].includes(r.state)) failures++;
      }
    } catch (err) {
      console.log(`  FAIL  ${err.message}`);
      failures++;
    }
  }

  console.log(`\n[copyright-schema] ${mode} finished — ${failures ? failures + ' problem(s), see above' : 'no problems'}.`);
  if (!opts.apply) console.log('[copyright-schema] DRY-RUN: nothing was changed. Re-run with --apply --confirm-prod to create missing tables.');
  return failures ? 1 : 0;
}

main()
  .then(async (code) => { await databaseManager.disconnectAll().catch(() => {}); process.exit(code); })
  .catch(async (err) => {
    console.error('[copyright-schema] FATAL', err.message);
    await databaseManager.disconnectAll().catch(() => {});
    process.exit(1);
  });
