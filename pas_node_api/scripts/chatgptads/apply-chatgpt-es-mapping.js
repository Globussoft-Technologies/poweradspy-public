#!/usr/bin/env node
'use strict';

/**
 * Create the brand-new chatgpt_search_mix ES index from the checked-in mapping
 * (chatgpt_search_mix.mapping.json). This network has no existing index to patch —
 * unlike apply-google-transparency-es-mapping.js (which PUTs fields onto a live
 * index), this CREATES the index, and refuses to touch it if it already exists
 * (use a real reindex procedure for schema changes once there is live data).
 *
 * Usage:
 *   node scripts/chatgptads/apply-chatgpt-es-mapping.js            # dry run
 *   node scripts/chatgptads/apply-chatgpt-es-mapping.js --apply    # connect + create
 */
const fs = require('fs');
const path = require('path');
const networks = require('../../src/config/networks');
const databaseManager = require('../../src/database/DatabaseManager');

const apply = process.argv.includes('--apply');
const MAPPING_PATH = path.join(__dirname, 'chatgpt_search_mix.mapping.json');
const RAW_MAPPING = JSON.parse(fs.readFileSync(MAPPING_PATH, 'utf8'));

/** Strip the script's own `_comment*` keys (not valid ES body) before sending. */
function stripComments(obj) {
  if (Array.isArray(obj)) return obj.map(stripComments);
  if (obj && typeof obj === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (k.startsWith('_comment')) continue;
      out[k] = stripComments(v);
    }
    return out;
  }
  return obj;
}

/** ES 6.x wants `mappings.doc.properties`; ES 7+ wants `mappings.properties` directly. */
function createIndexBody(raw, esMajor) {
  const clean = stripComments(raw);
  if (esMajor != null && esMajor < 7) return clean;
  const mappings = clean?.mappings?.doc ? clean.mappings.doc : clean.mappings;
  return { ...clean, mappings };
}

async function indexExists(client, indexName) {
  const exists = await client.indices.exists({ index: indexName });
  return typeof exists === 'boolean' ? exists : !!(exists?.body ?? exists);
}

async function main() {
  const elasticCfg = networks.chatgptads?.database?.elastic;
  const indexName = elasticCfg?.index || 'chatgpt_search_mix';
  console.log(`ChatGPT Ads ES index target: ${elasticCfg?.node}/${indexName}`);
  console.log(apply ? 'Mode: APPLY' : 'Mode: DRY RUN (pass --apply to execute)');
  if (!apply) {
    console.log(`Would create index "${indexName}" from ${path.basename(MAPPING_PATH)} if it does not already exist.`);
    return;
  }

  await databaseManager.connectAll({ chatgptads: networks.chatgptads });
  const elastic = databaseManager.getElastic('chatgptads');
  if (!elastic?.client) throw new Error('ChatGPT Ads Elasticsearch connection is unavailable (check networks.chatgptads.database.elastic.enabled/node in config.json)');

  if (await indexExists(elastic.client, indexName)) {
    console.log(`Index "${indexName}" already exists — refusing to touch it. Delete it manually first if you really want to recreate it from scratch, or write a proper reindex script once there is live data.`);
    return;
  }

  const body = createIndexBody(RAW_MAPPING, elastic.esMajor);
  await elastic.client.indices.create({ index: indexName, body });
  console.log(`Index "${indexName}" created successfully.`);
}

if (require.main === module) {
  main()
    .catch((error) => { console.error(error); process.exitCode = 1; })
    .finally(() => databaseManager.disconnectAll().catch(() => {}));
}

module.exports = { createIndexBody, stripComments, main };
