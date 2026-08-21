#!/usr/bin/env node
'use strict';

/**
 * requeue-lander-ads.js - reset AdMob lander-processing state for a chosen
 * set of ads, or for the full AdMob corpus.
 *
 * Use this when DS testing polluted the AdMob lander workflow and the same
 * ads must become eligible again for `GET /landers/get_ads_for_blackhat`.
 *
 * What this script resets for the selected ads:
 *   - `mob_ads.redirect_status` -> always reset to `0`
 *   - `mob_es_outbox` rows      -> always deleted
 *   - `mob_ad_lander_claims`    -> always deleted
 *   - `mob_ad_lander_content`   -> deleted only with `--delete-lander-content`
 *   - AdMob ES docs             -> rebuilt from SQL only with `--resync-es`
 *
 * Important:
 *   - Dry-run is the default. Add `--commit` or `--apply` to actually write.
 *   - `--resync-es` rewrites only the selected AdMob ES documents from the
 *     current SQL state. If SQL lander rows were deleted first, this clears
 *     lander data from the ES docs too.
 *   - `--resync-es` does NOT remove fields from the ES mapping itself. Use
 *     `rebuild-search-index.js` when the mapping must also be cleaned.
 *
 * Common commands:
 *   node scripts/admob/requeue-lander-ads.js --reset-all
 *     Preview a full reset for every AdMob ad. Nothing is written.
 *
 *   node scripts/admob/requeue-lander-ads.js --reset-all --delete-lander-content --commit
 *     Reset every AdMob ad back to `redirect_status=0`, clear queue/claim
 *     state, and delete all SQL lander rows.
 *
 *   node scripts/admob/requeue-lander-ads.js --reset-all --delete-lander-content --resync-es --commit
 *     Perform the same full SQL reset and also rebuild every AdMob ES
 *     document from SQL so test lander data is scrubbed from ES docs too.
 *
 *   node scripts/admob/requeue-lander-ads.js --from-lander-table --delete-lander-content --resync-es --commit
 *     Reset only ads that currently have rows in `mob_ad_lander_content`.
 *
 *   node scripts/admob/requeue-lander-ads.js --public-ad-ids=abc123,def456 --resync-es --commit
 *     Reset only the chosen public `ad_id` values and resync just those ES
 *     documents from SQL.
 *
 *   node scripts/admob/requeue-lander-ads.js --internal-ids=101,102 --commit
 *     Reset only the chosen internal `mob_ads.id` rows.
 */

require('dotenv').config();
const databaseManager = require('../../src/database/DatabaseManager');
const networksConfig = require('../../src/config/networks');
const repo = require('../../src/services/admob/insertion/repository');
const { buildAdmobDocument } = require('../../src/services/admob/insertion/esDocBuilder');

const NETWORK = 'admob';
const DEFAULT_INDEX = 'mob_search_mix';
const OPTIONAL_TABLES = {
  claims: 'mob_ad_lander_claims',
  esOutbox: 'mob_es_outbox',
  landerContent: 'mob_ad_lander_content',
};

function parseCsvOption(argv, names) {
  for (const name of names) {
    const inline = argv.find((arg) => arg.startsWith(`${name}=`));
    if (inline) {
      return inline
        .slice(name.length + 1)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }

    const index = argv.indexOf(name);
    if (index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--')) {
      return String(argv[index + 1])
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    }
  }

  return [];
}

function parseArgs(argv) {
  const publicAdIds = parseCsvOption(argv, ['--public-ad-ids', '--ad-ids']);
  const internalIds = parseCsvOption(argv, ['--internal-ids']);
  const fromLanderTable = argv.includes('--from-lander-table');
  const resetAll = argv.includes('--reset-all');
  const deleteLanderContent = argv.includes('--delete-lander-content') || argv.includes('--purge-lander-content');
  const resyncEs = argv.includes('--resync-es')
    || argv.includes('--sync-es-from-sql')
    || argv.includes('--clear-es-lander-docs');

  return {
    commit: argv.includes('--commit') || argv.includes('--apply'),
    deleteLanderContent,
    fromLanderTable,
    help: argv.includes('--help') || argv.includes('-h'),
    internalIds,
    publicAdIds,
    resetAll,
    resyncEs,
  };
}

function usage() {
  console.log([
    'Usage:',
    '  node scripts/admob/requeue-lander-ads.js --from-lander-table [--delete-lander-content] [--resync-es] [--commit]',
    '  node scripts/admob/requeue-lander-ads.js --public-ad-ids=ad1,ad2 [--resync-es] [--commit]',
    '  node scripts/admob/requeue-lander-ads.js --internal-ids=1,2 [--resync-es] [--commit]',
    '  node scripts/admob/requeue-lander-ads.js --reset-all [--delete-lander-content] [--resync-es] [--commit]',
    '',
    'Notes:',
    '  - Dry-run is the default.',
    '  - The script always resets redirect_status to 0 for the chosen ads.',
    '  - --reset-all is the explicit full-replay mode for every mob_ads row.',
    '  - It also clears mob_es_outbox rows for the same ads so the retry job starts fresh.',
    '  - It also clears mob_ad_lander_claims for the same ads so same-day scraper locks are removed.',
    '  - --resync-es rebuilds only the chosen AdMob ES docs from SQL. Pair it with',
    '    --delete-lander-content to scrub lander-only data from ES while preserving',
    '    unrelated AdMob document fields.',
  ].join('\n'));
}

function mergeRows(targets, rows) {
  for (const row of rows || []) {
    const id = Number(row.id);
    if (!Number.isFinite(id) || id <= 0) continue;
    targets.set(id, {
      id,
      ad_id: row.ad_id,
    });
  }
}

async function getExistingTables(sql, tableNames) {
  if (!tableNames.length) {
    return new Set();
  }

  const placeholders = tableNames.map(() => '?').join(', ');
  const rows = await sql.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name IN (${placeholders})`,
    tableNames
  );

  return new Set((rows || []).map((row) => String(row.table_name || row.TABLE_NAME || '').trim()).filter(Boolean));
}

function buildCleanupPlan(options, existingTables) {
  const clearOutbox = existingTables.has(OPTIONAL_TABLES.esOutbox);
  const clearClaims = existingTables.has(OPTIONAL_TABLES.claims);
  const deleteLanderContent = options.deleteLanderContent && existingTables.has(OPTIONAL_TABLES.landerContent);
  const skippedTables = [];

  if (!clearOutbox) skippedTables.push(OPTIONAL_TABLES.esOutbox);
  if (!clearClaims) skippedTables.push(OPTIONAL_TABLES.claims);
  if (options.deleteLanderContent && !deleteLanderContent) skippedTables.push(OPTIONAL_TABLES.landerContent);

  return {
    clearClaims,
    clearOutbox,
    deleteLanderContent,
    skippedTables,
  };
}

async function resolveTargets(sql, options, existingTables = null) {
  const targets = new Map();

  if (options.fromLanderTable) {
    if (!existingTables || existingTables.has(OPTIONAL_TABLES.landerContent)) {
      const rows = await sql.query(
        `SELECT a.id, a.ad_id
           FROM mob_ad_lander_content lc
           INNER JOIN mob_ads a ON a.id = lc.ad_id
          ORDER BY a.id`
      );
      mergeRows(targets, rows);
    }
  }

  if (options.internalIds.length) {
    const placeholders = options.internalIds.map(() => '?').join(', ');
    const rows = await sql.query(
      `SELECT id, ad_id
         FROM mob_ads
        WHERE id IN (${placeholders})`,
      options.internalIds
    );
    mergeRows(targets, rows);
  }

  if (options.publicAdIds.length) {
    const placeholders = options.publicAdIds.map(() => '?').join(', ');
    const rows = await sql.query(
      `SELECT id, ad_id
         FROM mob_ads
        WHERE ad_id IN (${placeholders})`,
      options.publicAdIds
    );
    mergeRows(targets, rows);
  }

  return [...targets.values()].sort((left, right) => left.id - right.id);
}

function previewRows(rows, limit = 20) {
  const sample = rows.slice(0, limit).map((row) => `${row.id}:${row.ad_id}`).join(', ');
  return rows.length > limit ? `${sample}, ...` : sample;
}

async function listAllTargets(sql) {
  const rows = await sql.query(
    `SELECT id, ad_id
       FROM mob_ads
      ORDER BY id`
  );
  return rows || [];
}

async function resyncAdsInElastic(sql, elastic, targets) {
  const indexName = elastic.indexName || DEFAULT_INDEX;
  let indexed = 0;

  for (const row of targets) {
    // Rebuild each document from the current SQL state so lander-only data is
    // removed from ES when the SQL lander row has been deleted/reset.
    // eslint-disable-next-line no-await-in-loop
    const complete = await repo.getCompleteAd(sql, row.ad_id);
    if (!complete) continue;

    const params = {
      index: indexName,
      id: String(complete.id),
      body: buildAdmobDocument(complete),
      refresh: false,
    };

    if (Number(elastic.esMajor) <= 6) {
      params.type = 'doc';
    }

    // eslint-disable-next-line no-await-in-loop
    await elastic.index(params);
    indexed += 1;
  }

  await elastic.client.indices.refresh({ index: indexName });
  return indexed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  if (!args.resetAll && !args.fromLanderTable && !args.internalIds.length && !args.publicAdIds.length) {
    usage();
    throw new Error('Choose at least one selector: --reset-all, --from-lander-table, --public-ad-ids, or --internal-ids.');
  }

  const mode = args.commit ? 'COMMIT' : 'DRY-RUN';
  console.log(`\n=== AdMob lander requeue - ${mode} ===`);

  await databaseManager.connectAll({ [NETWORK]: networksConfig[NETWORK] });
  try {
    const sql = databaseManager.getSQL(NETWORK);
    const elastic = databaseManager.getElastic(NETWORK);
    if (!sql) {
      console.log(`[${NETWORK}] SKIP - no SQL connection`);
      return;
    }
    if (args.resyncEs && !elastic?.client) {
      throw new Error('The AdMob Elasticsearch connection is required when --resync-es is used.');
    }

    const existingTables = await getExistingTables(sql, Object.values(OPTIONAL_TABLES));
    const cleanupPlan = buildCleanupPlan(args, existingTables);
    if (cleanupPlan.skippedTables.length) {
      console.log(`[${NETWORK}] optional tables missing and skipped: ${cleanupPlan.skippedTables.join(', ')}`);
    }

    if (args.resetAll) {
      const allTargets = args.resyncEs ? await listAllTargets(sql) : [];
      console.log(`[${NETWORK}] targets: ALL mob_ads rows`);
      console.log(`[${NETWORK}] sample: n/a`);
      console.log(`[${NETWORK}] actions: reset redirect_status=0 for every mob_ads row${cleanupPlan.clearOutbox ? ', clear mob_es_outbox' : ''}${cleanupPlan.clearClaims ? ', clear mob_ad_lander_claims' : ''}${cleanupPlan.deleteLanderContent ? ', delete mob_ad_lander_content rows' : ''}${args.resyncEs ? ', rebuild selected ES docs from SQL' : ''}`);

      if (!args.commit) {
        return;
      }

      // Full replay mode is intentionally explicit so we do not accidentally requeue
      // the entire corpus during a targeted recovery.
      await repo.withTransaction(sql, async (tx) => {
        await tx.query('UPDATE mob_ads SET redirect_status = 0');

        if (cleanupPlan.clearOutbox) {
          await tx.query('DELETE FROM mob_es_outbox');
        }
        if (cleanupPlan.clearClaims) {
          await tx.query('DELETE FROM mob_ad_lander_claims');
        }

        if (cleanupPlan.deleteLanderContent) {
          await tx.query('DELETE FROM mob_ad_lander_content');
        }
      });

      if (args.resyncEs) {
        const indexed = await resyncAdsInElastic(sql, elastic, allTargets);
        console.log(`[${NETWORK}] APPLIED - rebuilt ${indexed} ES document(s) from SQL`);
      }

      console.log(`[${NETWORK}] APPLIED - reset redirect_status for all ad(s)`);
      return;
    }

    const targets = await resolveTargets(sql, args, existingTables);
    if (!targets.length) {
      console.log(`[${NETWORK}] NO-OP - no matching ads were found`);
      return;
    }

    console.log(`[${NETWORK}] targets: ${targets.length}`);
    console.log(`[${NETWORK}] sample: ${previewRows(targets)}`);
    console.log(`[${NETWORK}] actions: reset redirect_status=0${cleanupPlan.clearOutbox ? ', clear mob_es_outbox' : ''}${cleanupPlan.clearClaims ? ', clear mob_ad_lander_claims' : ''}${cleanupPlan.deleteLanderContent ? ', delete mob_ad_lander_content rows' : ''}${args.resyncEs ? ', rebuild selected ES docs from SQL' : ''}`);

    if (!args.commit) {
      return;
    }

    await repo.withTransaction(sql, async (tx) => {
      const ids = targets.map((row) => row.id);
      const placeholders = ids.map(() => '?').join(', ');

      await tx.query(`UPDATE mob_ads SET redirect_status = 0 WHERE id IN (${placeholders})`, ids);
      if (cleanupPlan.clearOutbox) {
        await tx.query(`DELETE FROM mob_es_outbox WHERE ad_id IN (${placeholders})`, ids);
      }
      if (cleanupPlan.clearClaims) {
        await tx.query(`DELETE FROM mob_ad_lander_claims WHERE ad_id IN (${placeholders})`, ids);
      }

      if (cleanupPlan.deleteLanderContent) {
        await tx.query(`DELETE FROM mob_ad_lander_content WHERE ad_id IN (${placeholders})`, ids);
      }
    });

    if (args.resyncEs) {
      const indexed = await resyncAdsInElastic(sql, elastic, targets);
      console.log(`[${NETWORK}] APPLIED - rebuilt ${indexed} ES document(s) from SQL`);
    }

    console.log(`[${NETWORK}] APPLIED - requeued ${targets.length} ad(s)`);
  } finally {
    await databaseManager.disconnectAll();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('FATAL', error.message);
    databaseManager.disconnectAll().finally(() => process.exit(1));
  });
}

module.exports = {
  buildCleanupPlan,
  getExistingTables,
  main,
  mergeRows,
  parseArgs,
  parseCsvOption,
  previewRows,
  resyncAdsInElastic,
  resolveTargets,
  usage,
};
