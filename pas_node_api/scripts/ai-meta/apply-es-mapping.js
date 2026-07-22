#!/usr/bin/env node
'use strict';

/**
 * apply-es-mapping.js — add the explicit AI-Meta object mapping to each live
 * search index.
 *
 * SAFETY (does NOT touch existing data):
 *   - Only ever does `PUT <index>/_mapping` — an ADDITIVE mapping update on the
 *     EXISTING index. It never creates an index, never reindexes, never deletes,
 *     and never rewrites documents.
 *   - If the index does not exist, it is SKIPPED.
 *   - DRY-RUN by default: prints the target index + mapping body. Pass --commit
 *     to apply.
 *
 * USAGE:
 *   node scripts/ai-meta/apply-es-mapping.js
 *   node scripts/ai-meta/apply-es-mapping.js --commit
 *   node scripts/ai-meta/apply-es-mapping.js --only=facebook,tiktok
 *
 * IMPORTANT:
 *   - Connection details are resolved the same way the app does in the active
 *     environment: dotenv/env → src/config → src/config/networks →
 *     DatabaseManager.
 *   - Dev/normal environments map `ai`; production facebook maps `ai_meta`.
 */

require('dotenv').config();
const config = require('../../src/config');
const databaseManager = require('../../src/database/DatabaseManager');
const networksConfig = require('../../src/config/networks');

// Shared AI-Meta field properties. Only the top-level field name varies by
// environment/platform; the sub-field mapping stays identical.
const AI_PROPS = {
  ad_type:       { type: 'keyword' },
  intent:        { type: 'keyword' },
  hook:          { type: 'keyword' },
  offering_type: { type: 'keyword' },
  offers:        { properties: { type: { type: 'keyword' }, value: { type: 'float' } } },
  colors:        { type: 'keyword' },
  offering:      { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 }, suggest: { type: 'completion', max_input_length: 200 } } },
  caption:       { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 } } },
  roa:           { properties: { intent: { type: 'text' }, hook: { type: 'text' }, offering_type: { type: 'text' }, offering: { type: 'text' } } },
  category:      { type: 'keyword' },
  category_id:   { type: 'keyword' },
  sub_category:  { type: 'keyword' },
  subcategory_id:{ type: 'keyword' },
};

const NETWORKS = ['facebook', 'instagram', 'gdn', 'youtube', 'google', 'native', 'linkedin', 'reddit', 'quora', 'pinterest', 'tiktok'];

function parseArgs(argv) {
  const args = { commit: false, networks: NETWORKS };
  for (const a of argv) {
    if (a === '--commit') args.commit = true;
    else if (a.startsWith('--only=')) {
      args.networks = a.slice('--only='.length).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
    }
  }
  const unknown = args.networks.filter((n) => !NETWORKS.includes(n));
  if (unknown.length) throw new Error(`Unknown network(s): ${unknown.join(', ')}. Valid: ${NETWORKS.join(', ')}`);
  return args;
}

function aiFieldFor(net) {
  return config.env === 'production' && net === 'facebook' ? 'ai_meta' : 'ai';
}

function mappingBodyFor(net) {
  return { properties: { [aiFieldFor(net)]: { properties: AI_PROPS } } };
}

function resolvedEsNode(net) {
  const db = networksConfig[net]?.database || {};
  return db.elastic?.node || db.elastic_tiktok?.node || '(unknown-node)';
}

async function indexExists(client, index) {
  try {
    const res = await client.indices.exists({ index });
    return typeof res === 'boolean' ? res : !!(res?.body ?? res);
  } catch (err) {
    if (err?.meta?.statusCode === 404) return false;
    throw err;
  }
}

async function main() {
  const { commit, networks } = parseArgs(process.argv.slice(2));
  console.log(`\n=== AI-Meta ES mapping apply — ${commit ? 'COMMIT' : 'DRY-RUN'} ===`);
  console.log(`networks: ${networks.join(', ')}\n`);

  await databaseManager.connectAll(networksConfig);

  const summary = [];
  for (const net of networks) {
    const elastic = databaseManager.getElastic(net);
    if (!elastic?.client || !elastic.indexName) {
      console.log(`[${net}] SKIP — no Elasticsearch connection`);
      summary.push({ net, status: 'no-elastic' });
      continue;
    }

    const index = elastic.indexName;
    const field = aiFieldFor(net);
    const node = resolvedEsNode(net);
    const label = `${net} -> ${node}/${index} (field=${field}, ES${elastic.esMajor ?? '?'})`;

    try {
      const exists = await indexExists(elastic.client, index);
      if (!exists) {
        console.log(`[${net}] SKIP — ${label} index missing`);
        summary.push({ net, status: 'index-missing' });
        continue;
      }

      const body = mappingBodyFor(net);
      if (!commit) {
        console.log(`[${net}] WOULD APPLY — ${label}`);
        console.log(JSON.stringify(body));
        console.log('');
        summary.push({ net, status: 'would-apply', field });
        continue;
      }

      const params = elastic.esMajor != null && elastic.esMajor < 7
        ? { index, type: 'doc', body }
        : { index, body };
      await elastic.client.indices.putMapping(params);
      console.log(`[${net}] APPLIED — ${label}`);
      summary.push({ net, status: 'applied', field });
    } catch (err) {
      const reason = err?.meta?.body?.error?.reason || err.message;
      console.log(`[${net}] ERROR — ${label} — ${reason}`);
      summary.push({ net, status: 'error', field, error: reason });
    }
  }

  console.log('\n=== summary ===');
  for (const s of summary) console.log('  ', JSON.stringify(s));
  await databaseManager.disconnectAll();
}

main().catch((e) => {
  console.error('FATAL', e);
  databaseManager.disconnectAll().finally(() => process.exit(1));
});
