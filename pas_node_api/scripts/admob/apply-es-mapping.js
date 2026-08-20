#!/usr/bin/env node
'use strict';

/**
 * apply-es-mapping.js - additive Elasticsearch mapping update for AdMob.
 *
 * This mirrors the repo's AI-Meta and Google transparency maintenance scripts:
 *   - dry-run by default
 *   - only performs PUT _mapping
 *   - skips missing indices
 *   - keeps the live mapping patch small and additive
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
