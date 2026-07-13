#!/usr/bin/env node
'use strict';

/**
 * reindex-ai-mapping.js — bring indices that already have a STALE `ai` mapping
 * (dynamically mapped as text by an old v1.1 prototype doc) up to the correct v1.6
 * `ai` mapping, since ES cannot change a field's base type in place.
 *
 * Only needed for facebook/instagram/gdn (their search_mix indices). The other 8
 * networks were mapped cleanly by apply-es-mapping.js.
 *
 * STRATEGY (per index <name>):
 *   1. reindex-only (default, NON-DESTRUCTIVE — source untouched):
 *        - create `<name>_v2` copying the source settings + full mapping, but with the
 *          `ai` block REPLACED by the correct v1.6 mapping (old v1.1 ai sub-fields gone);
 *        - reindex <name> → <name>_v2 running `ctx._source.remove('ai')` so the stale
 *          v1.1 `ai` object is DROPPED (this is the "remove that doc" step — its ai is
 *          not carried over; every other field of every doc is copied verbatim);
 *        - verify <name>_v2 doc count matches source.
 *   2. --swap (DESTRUCTIVE, run only after you have verified step 1):
 *        - delete the old concrete `<name>` and create an alias `<name>` → `<name>_v2`,
 *          so the app keeps using the same name with the corrected mapping.
 *
 * SAFETY:
 *   - Step 1 never modifies or deletes the source; it only creates `<name>_v2`.
 *   - Re-running step 1 is safe: if `<name>_v2` already exists it is reused and the
 *     reindex catches up any docs added since (copies by _id, conflicts=proceed).
 *   - Step 2 is the only destructive action and requires the explicit --swap flag.
 *
 * USAGE:
 *   node scripts/ai-meta/reindex-ai-mapping.js --only=instagram          # reindex only (canary)
 *   node scripts/ai-meta/reindex-ai-mapping.js                           # reindex all 3
 *   node scripts/ai-meta/reindex-ai-mapping.js --only=instagram --swap   # + swap in the alias
 */

const fs   = require('fs');
const path = require('path');

const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../config.json'), 'utf8'));
const E = cfg.databases.elastic; // all 3 conflicting indices are on the main cluster
const H = { Authorization: 'Basic ' + Buffer.from(`${E.username}:${E.password}`).toString('base64'), 'Content-Type': 'application/json' };

const TARGETS = { facebook: 'search_mix', instagram: 'instagram_search_mix', gdn: 'gdn_search_mix' };

const AI_PROPS = {
  ad_type: { type: 'keyword' }, intent: { type: 'keyword' }, hook: { type: 'keyword' }, offering_type: { type: 'keyword' },
  offers: { properties: { type: { type: 'keyword' }, value: { type: 'float' } } },
  colors: { type: 'keyword' },
  offering: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 }, suggest: { type: 'completion', max_input_length: 200 } } },
  caption: { type: 'text', fields: { keyword: { type: 'keyword', ignore_above: 256 } } },
  roa: { properties: { intent: { type: 'text' }, hook: { type: 'text' }, offering_type: { type: 'text' }, offering: { type: 'text' } } },
  category: { type: 'keyword' }, category_id: { type: 'keyword' }, sub_category: { type: 'keyword' }, subcategory_id: { type: 'keyword' },
};

// index settings that ES generates and refuses on create — strip them.
const STRIP_SETTINGS = ['uuid', 'creation_date', 'version', 'provided_name', 'resize', 'routing'];

async function es(method, p, body) {
  const r = await fetch(E.node + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: r.status, json, text };
}

function sanitizeSettings(src) {
  const idx = { ...(src?.index || {}) };
  for (const k of STRIP_SETTINGS) delete idx[k];
  if (idx.number_of_replicas == null) idx.number_of_replicas = '0';
  return { index: idx };
}

async function reindexOne(net, name) {
  const v2 = `${name}_v2`;
  console.log(`\n### ${net}: ${name} → ${v2}`);

  // source settings + mapping
  const [{ json: setJson }, { json: mapJson }] = await Promise.all([es('GET', `/${name}/_settings`), es('GET', `/${name}/_mapping`)]);
  const srcSettings = setJson?.[name]?.settings;
  const srcMappings = mapJson?.[name]?.mappings || {};
  const typeKey = Object.keys(srcMappings).find((k) => !['properties', '_meta', 'dynamic', '_source', 'dynamic_templates'].includes(k)); // ES6 'doc'

  // dest mapping = clone of source, with ai replaced by the v1.6 block
  const destMappings = JSON.parse(JSON.stringify(srcMappings));
  const target = typeKey ? destMappings[typeKey] : destMappings;
  target.properties = target.properties || {};
  target.properties.ai = { properties: AI_PROPS };

  // create v2 (reuse if it already exists from a previous run)
  const exists = (await es('GET', `/${v2}`)).status === 200;
  if (!exists) {
    const create = await es('PUT', `/${v2}`, { settings: sanitizeSettings(srcSettings), mappings: destMappings });
    if (create.status >= 400) { console.log(`  ✗ create ${v2} failed: ${create.text.slice(0, 300)}`); return { net, status: 'create_failed' }; }
    console.log(`  ✓ created ${v2} with corrected ai mapping`);
  } else {
    console.log(`  • ${v2} already exists — reusing (reindex will catch up)`);
  }

  // reindex, dropping the stale ai object from every doc
  console.log(`  … reindexing (dropping stale ai)…`);
  const rx = await es('POST', `/_reindex?wait_for_completion=true&slices=auto&refresh=true`, {
    conflicts: 'proceed',
    source: { index: name, size: 2000 },
    dest:   { index: v2 },
    script: { source: "if (ctx._source.containsKey('ai')) { ctx._source.remove('ai'); }", lang: 'painless' },
  });
  if (rx.status >= 400) { console.log(`  ✗ reindex failed: ${rx.text.slice(0, 400)}`); return { net, status: 'reindex_failed' }; }
  console.log(`  ✓ reindex done: created=${rx.json.created} updated=${rx.json.updated} version_conflicts=${rx.json.version_conflicts} failures=${(rx.json.failures || []).length}`);

  // verify counts
  const [sc, dc] = await Promise.all([es('GET', `/${name}/_count`), es('GET', `/${v2}/_count`)]);
  const srcN = sc.json?.count, dstN = dc.json?.count;
  const ok = srcN === dstN;
  console.log(`  ${ok ? '✓' : '⚠'} counts: source=${srcN} ${v2}=${dstN}${ok ? '' : ' (MISMATCH — re-run to catch up before --swap)'}`);
  return { net, name, v2, status: ok ? 'reindexed_verified' : 'count_mismatch', srcN, dstN };
}

async function swapOne(net, name) {
  const v2 = `${name}_v2`;
  // final safety: counts must match right now
  const [sc, dc] = await Promise.all([es('GET', `/${name}/_count`), es('GET', `/${v2}/_count`)]);
  if (sc.json?.count !== dc.json?.count) { console.log(`  ✗ ${net}: refuse swap — counts differ (source=${sc.json?.count} v2=${dc.json?.count}). Re-run reindex first.`); return { net, status: 'swap_refused' }; }
  // delete concrete index, then alias name → v2 (aliases API is atomic for the add)
  const del = await es('DELETE', `/${name}`);
  if (del.status >= 400) { console.log(`  ✗ ${net}: delete ${name} failed: ${del.text.slice(0, 200)}`); return { net, status: 'delete_failed' }; }
  const alias = await es('POST', `/_aliases`, { actions: [{ add: { index: v2, alias: name } }] });
  if (alias.status >= 400) { console.log(`  ✗ ${net}: CRITICAL alias add failed after delete: ${alias.text.slice(0, 200)} — run: POST /_aliases {add ${v2}->${name}}`); return { net, status: 'alias_failed' }; }
  console.log(`  ✓ ${net}: ${name} is now an alias → ${v2} (app unchanged)`);
  return { net, status: 'swapped' };
}

(async () => {
  const args = process.argv.slice(2);
  const SWAP = args.includes('--swap');
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.split('=')[1].split(',').map((s) => s.trim()) : null;

  console.log(`\n=== AI-Meta reindex for full v1.6 parity — ${SWAP ? 'REINDEX + SWAP' : 'REINDEX ONLY (non-destructive)'} ===`);
  console.log(`cluster=${E.node}\n`);

  const summary = [];
  for (const [net, name] of Object.entries(TARGETS)) {
    if (only && !only.includes(net)) continue;
    const r = await reindexOne(net, name);
    if (SWAP && r.status === 'reindexed_verified') {
      const sw = await swapOne(net, name);
      summary.push({ ...r, swap: sw.status });
    } else {
      summary.push(r);
    }
  }

  console.log('\n--- summary ---');
  for (const r of summary) console.log(`  ${r.net.padEnd(10)} ${r.status}${r.swap ? ' | swap=' + r.swap : ''}`);
  if (!SWAP) console.log('\n(REINDEX ONLY — source indices untouched. After verifying counts, re-run with --swap to cut over.)');
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
