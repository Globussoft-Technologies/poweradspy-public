#!/usr/bin/env node
'use strict';

/**
 * rebuild-search-index.js - delete and recreate the AdMob ES index from the
 * checked-in full mapping, then repopulate every AdMob document from SQL.
 *
 * Use this when the live AdMob ES mapping must be fully cleaned, such as
 * removing obsolete lander fields that additive mapping updates cannot delete.
 * It only touches the AdMob search index; other network indices are untouched.
 *
 * What this script does on `--commit`:
 *   - reads the full checked-in mapping from `mob_search_mix.mapping.json`
 *   - deletes the current AdMob index if it exists
 *   - recreates the index with the checked-in mapping
 *   - rebuilds every AdMob ES document from current SQL data
 *
 * Important:
 *   - Dry-run is the default. Add `--commit` or `--apply` to actually write.
 *   - This is a full AdMob ES rebuild, not an additive mapping patch.
 *   - Unrelated AdMob fields are preserved only if they still come from SQL
 *     through the normal document builder.
 *
 * Common commands:
 *   node scripts/admob/rebuild-search-index.js
 *     Preview the index name and document count that would be rebuilt.
 *
 *   node scripts/admob/rebuild-search-index.js --commit
 *     Delete the current AdMob ES index, recreate it from the checked-in full
 *     mapping, and repopulate all AdMob documents from SQL.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const databaseManager = require('../../src/database/DatabaseManager');
const networksConfig = require('../../src/config/networks');
const repo = require('../../src/services/admob/insertion/repository');
const { buildAdmobDocument } = require('../../src/services/admob/insertion/esDocBuilder');

const NETWORK = 'admob';
const DEFAULT_INDEX = 'mob_search_mix';
const FULL_MAPPING_PATH = path.join(__dirname, 'mob_search_mix.mapping.json');
const FULL_MAPPING = JSON.parse(fs.readFileSync(FULL_MAPPING_PATH, 'utf8'));

function parseArgs(argv) {
  return {
    commit: argv.includes('--commit') || argv.includes('--apply'),
  };
}

function createIndexBody(raw, esMajor) {
  if (esMajor != null && esMajor < 7) {
    return raw;
  }

  const mappings = raw?.mappings?.doc
    ? raw.mappings.doc
    : raw.mappings;

  return {
    ...raw,
    mappings,
  };
}

async function indexExists(client, indexName) {
  const exists = await client.indices.exists({ index: indexName });
  return typeof exists === 'boolean' ? exists : !!(exists?.body ?? exists);
}

async function getAdIds(sql) {
  const rows = await sql.query('SELECT ad_id FROM mob_ads ORDER BY id');
  return (rows || [])
    .map((row) => String(row.ad_id || '').trim())
    .filter(Boolean);
}

async function recreateIndex(elastic, indexName, body) {
  if (await indexExists(elastic.client, indexName)) {
    await elastic.client.indices.delete({ index: indexName });
  }

  await elastic.client.indices.create({
    index: indexName,
    body,
  });
}

async function reindexAllAds(sql, elastic, indexName, adIds) {
  let indexed = 0;

  for (const publicAdId of adIds) {
    // Rebuild from SQL so the new index only contains the current schema.
    // This avoids carrying stale lander-only fields across from old ES docs.
    // eslint-disable-next-line no-await-in-loop
    const complete = await repo.getCompleteAd(sql, publicAdId);
    if (!complete) continue;

    const document = buildAdmobDocument(complete);
    const params = {
      index: indexName,
      id: String(complete.id),
      body: document,
      refresh: false,
    };

    if (Number(elastic.esMajor) <= 6) {
      params.type = 'doc';
    }

    // eslint-disable-next-line no-await-in-loop
    await elastic.index(params);
    indexed += 1;

    if (indexed % 100 === 0) {
      console.log(`   indexed ${indexed}/${adIds.length} ad(s)`);
    }
  }

  await elastic.client.indices.refresh({ index: indexName });
  return indexed;
}

async function main() {
  const { commit } = parseArgs(process.argv.slice(2));
  const mode = commit ? 'COMMIT' : 'DRY-RUN';
  console.log(`\n=== AdMob ES rebuild - ${mode} ===`);

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
    console.log(`[${NETWORK}] ads to rebuild: ${adIds.length}`);

    if (!commit) {
      console.log(`[${NETWORK}] would delete/recreate ${indexName} from ${path.basename(FULL_MAPPING_PATH)} and repopulate it from SQL`);
      return;
    }

    const body = createIndexBody(FULL_MAPPING, elastic.esMajor);
    await recreateIndex(elastic, indexName, body);
    const indexed = await reindexAllAds(sql, elastic, indexName, adIds);
    console.log(`[${NETWORK}] APPLIED - rebuilt ${indexName} with ${indexed} document(s)`);
  } finally {
    await databaseManager.disconnectAll();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('FATAL', error);
    databaseManager.disconnectAll().finally(() => process.exit(1));
  });
}

module.exports = {
  createIndexBody,
  getAdIds,
  indexExists,
  main,
  parseArgs,
  recreateIndex,
  reindexAllAds,
};
