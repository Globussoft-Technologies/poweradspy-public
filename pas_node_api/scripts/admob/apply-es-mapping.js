#!/usr/bin/env node
'use strict';

/**
 * apply-es-mapping.js - additive Elasticsearch mapping update for AdMob.
 *
 * Use this when the live AdMob index is missing new lander fields but you do
 * NOT want to rebuild the whole index. This script only performs PUT _mapping;
 * it never rewrites documents and it never removes old fields.
 *
 * What this script does on `--commit`:
 *   - reads the additive field fragment from `mob_search_mix_fields.mapping.json`
 *   - compares it with the current AdMob index mapping
 *   - adds only fields that do not exist yet
 *   - fails fast if an existing field conflicts with the new definition
 *
 * Important:
 *   - Dry-run is the default. Add `--commit` or `--apply` to actually write.
 *   - This script cannot remove obsolete mapping fields from ES.
 *   - Use `rebuild-search-index.js` instead when the final goal is to delete
 *     old AdMob lander fields from the live mapping.
 *
 * Common commands:
 *   node scripts/admob/apply-es-mapping.js
 *     Preview the target index and the additive fields in the mapping patch.
 *
 *   node scripts/admob/apply-es-mapping.js --commit
 *     Apply only the additive mapping patch to the live AdMob index.
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const databaseManager = require('../../src/database/DatabaseManager');
const networksConfig = require('../../src/config/networks');

const NETWORK = 'admob';
const TARGET_INDEX = 'mob_search_mix';
const FRAGMENT_PATH = path.join(__dirname, 'mob_search_mix_fields.mapping.json');
const FRAGMENT = JSON.parse(fs.readFileSync(FRAGMENT_PATH, 'utf8'));

function parseArgs(argv) {
  return {
    commit: argv.includes('--commit') || argv.includes('--apply'),
  };
}

function mappingProperties(response, indexName) {
  const body = response?.body || response || {};
  const indexMapping = body[indexName]?.mappings || {};
  return indexMapping.doc?.properties || indexMapping.properties || {};
}

function buildMappingPatch(existingProperties) {
  const desired = FRAGMENT.properties || {};
  const patch = {};
  const skipped = [];
  const conflicts = [];

  for (const [field, definition] of Object.entries(desired)) {
    const current = existingProperties?.[field];
    if (current === undefined) {
      patch[field] = definition;
      continue;
    }
    if (isDeepStrictEqual(current, definition)) {
      skipped.push(field);
      continue;
    }
    conflicts.push(field);
  }

  return {
    body: { properties: patch },
    skipped,
    conflicts,
  };
}

async function indexExists(client, indexName) {
  const exists = await client.indices.exists({ index: indexName });
  return typeof exists === 'boolean' ? exists : !!(exists?.body ?? exists);
}

async function main() {
  const { commit } = parseArgs(process.argv.slice(2));
  const mode = commit ? 'COMMIT' : 'DRY-RUN';
  console.log(`\n=== AdMob ES mapping apply - ${mode} ===`);
  console.log(`target index: ${TARGET_INDEX}`);
  console.log(`new fields: ${Object.keys(FRAGMENT.properties || {}).join(', ')}`);

  if (!commit) {
    return;
  }

  await databaseManager.connectAll({ [NETWORK]: networksConfig[NETWORK] });
  const elastic = databaseManager.getElastic(NETWORK);
  if (!elastic?.client || !elastic.indexName) {
    console.log(`[${NETWORK}] SKIP - no Elasticsearch connection`);
    await databaseManager.disconnectAll();
    return;
  }

  const indexName = elastic.indexName || TARGET_INDEX;
  if (!(await indexExists(elastic.client, indexName))) {
    console.log(`[${NETWORK}] SKIP - index ${indexName} is missing`);
    await databaseManager.disconnectAll();
    return;
  }

  const current = await elastic.client.indices.getMapping({ index: indexName });
  const properties = mappingProperties(current, indexName);
  const prepared = buildMappingPatch(properties);

  if (prepared.conflicts.length) {
    throw new Error(`Existing mapping conflict for: ${prepared.conflicts.join(', ')}`);
  }

  if (!Object.keys(prepared.body.properties).length) {
    console.log(`[${NETWORK}] NO-OP - all fields already exist in ${indexName}`);
    await databaseManager.disconnectAll();
    return;
  }

  const params = { index: indexName, body: prepared.body };
  if (elastic.esMajor != null && elastic.esMajor < 7) {
    params.type = 'doc';
  }
  await elastic.client.indices.putMapping(params);
  console.log(`[${NETWORK}] APPLIED - mapping updated for ${indexName}`);

  await databaseManager.disconnectAll();
}

if (require.main === module) {
  main().catch((error) => {
    console.error('FATAL', error);
    databaseManager.disconnectAll().finally(() => process.exit(1));
  });
}

module.exports = {
  buildMappingPatch,
  indexExists,
  main,
  mappingProperties,
  parseArgs,
};
