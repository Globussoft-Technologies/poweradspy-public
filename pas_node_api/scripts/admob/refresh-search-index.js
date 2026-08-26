#!/usr/bin/env node
'use strict';

/**
 * refresh-search-index.js - rebuild every AdMob ES document from current SQL
 * data and re-index it in place, WITHOUT deleting/recreating the index.
 *
 * Use this to pick up a derived-field formula change (e.g. occurrence_count,
 * source_app_count, poster_intelligence_score) across all existing ads,
 * without the search-outage risk of rebuild-search-index.js (which deletes
 * the live index first). This script only ever upserts documents one at a
 * time into the index that's already serving traffic.
 *
 * Important:
 *   - Dry-run is the default. Add `--commit` or `--apply` to actually write.
 *   - Does not touch the ES mapping — run apply-es-mapping.js first if a new
 *     field also needs a mapping entry.
 *
 * Common commands:
 *   node scripts/admob/refresh-search-index.js
 *     Preview how many ads would be refreshed.
 *
 *   node scripts/admob/refresh-search-index.js --commit
 *     Re-index every AdMob ad's document from current SQL data.
 */

require('dotenv').config();
const databaseManager = require('../../src/database/DatabaseManager');
const networksConfig = require('../../src/config/networks');
const repo = require('../../src/services/admob/insertion/repository');
const { buildAdmobDocument } = require('../../src/services/admob/insertion/esDocBuilder');

const NETWORK = 'admob';
const DEFAULT_INDEX = 'mob_search_mix';

function parseArgs(argv) {
  return {
    commit: argv.includes('--commit') || argv.includes('--apply'),
  };
}

async function getAdIds(sql) {
  const rows = await sql.query('SELECT ad_id FROM mob_ads ORDER BY id');
  return (rows || [])
    .map((row) => String(row.ad_id || '').trim())
    .filter(Boolean);
}

async function refreshAllAds(sql, elastic, indexName, adIds) {
  let indexed = 0;
  let skipped = 0;

  for (const publicAdId of adIds) {
    // eslint-disable-next-line no-await-in-loop
    const complete = await repo.getCompleteAd(sql, publicAdId);
    if (!complete) {
      skipped += 1;
      continue;
    }

    const document = buildAdmobDocument(complete);
    const params = {
      index: indexName,
      id: String(complete.id),
      body: document,
      refresh: false,
    };
    if (Number(elastic.esMajor) <= 6) params.type = 'doc';

    // eslint-disable-next-line no-await-in-loop
    await elastic.index(params);
    indexed += 1;

    if (indexed % 100 === 0) {
      console.log(`   refreshed ${indexed}/${adIds.length} ad(s)`);
    }
  }

  await elastic.client.indices.refresh({ index: indexName });
  return { indexed, skipped };
}

async function main() {
  const { commit } = parseArgs(process.argv.slice(2));
  const mode = commit ? 'COMMIT' : 'DRY-RUN';
  console.log(`\n=== AdMob ES refresh (in-place, no index delete) - ${mode} ===`);

  await databaseManager.connectAll({ [NETWORK]: networksConfig[NETWORK] });
  try {
    const sql = databaseManager.getSQL(NETWORK);
    const elastic = databaseManager.getElastic(NETWORK);

    if (!sql) {
      console.log(`[${NETWORK}] SKIP - no SQL connection`);
      return;
    }
    if (!elastic?.client) {
      console.log(`[${NETWORK}] SKIP - no Elasticsearch connection`);
      return;
    }

    const indexName = elastic.indexName || DEFAULT_INDEX;
    const adIds = await getAdIds(sql);
    console.log(`[${NETWORK}] index: ${indexName}`);
    console.log(`[${NETWORK}] ads to refresh: ${adIds.length}`);

    if (!commit) {
      console.log(`[${NETWORK}] would re-index ${adIds.length} document(s) in place (no delete/recreate)`);
      return;
    }

    const { indexed, skipped } = await refreshAllAds(sql, elastic, indexName, adIds);
    console.log(`[${NETWORK}] APPLIED - refreshed ${indexed} document(s), skipped ${skipped}`);
  } finally {
    await databaseManager.disconnectAll();
  }
}

main().catch((error) => {
  console.error('FATAL', error);
  databaseManager.disconnectAll().finally(() => process.exit(1));
});
