#!/usr/bin/env node
'use strict';

/**
 * apply-es-mapping.js — add the explicit `ai` object mapping to each network's
 * live search index (docs/AI_META_ES_MAPPING_RUNBOOK.md, spec v1.6).
 *
 * SAFETY (does NOT touch existing data):
 *   - Only ever does `PUT <index>/_mapping` — an ADDITIVE mapping update on the
 *     EXISTING index. It never creates an index, never reindexes, never deletes,
 *     and never rewrites documents.
 *   - If the index does not exist, it is SKIPPED (never created).
 *   - A putMapping that would conflict with an existing incompatible `ai.*` type is
 *     REJECTED by Elasticsearch with a 400 — the script reports it and moves on; your
 *     data is left exactly as-is (see the runbook §5 reindex fallback for that case).
 *   - DRY-RUN by default: prints the target index + mapping body. Pass --commit to apply.
 *
 * USAGE:
 *   node scripts/ai-meta/apply-es-mapping.js               # dry-run (all networks)
 *   node scripts/ai-meta/apply-es-mapping.js --commit      # apply the mapping
 *   node scripts/ai-meta/apply-es-mapping.js --only=facebook,tiktok [--commit]
 *
 * Node URLs / creds are read from config.json (databases.elastic + elastic_tiktok);
 * per-network index names from src/config/networks (same resolution the app uses).
 */

const fs   = require('fs');
const path = require('path');

const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../config.json'), 'utf8'));
const networksCfg = require('../../src/config/networks');

// The v1.6 `ai` mapping — identical across every network (docs/AI_META_ES_MAPPING_RUNBOOK.md §2).
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
  category:       { type: 'keyword' },
  category_id:    { type: 'keyword' },
  sub_category:   { type: 'keyword' },
  subcategory_id: { type: 'keyword' },
};
const MAPPING_BODY = { properties: { ai: { properties: AI_PROPS } } };

// network → which cluster + resolved index (matches the app's own resolution).
function resolveTarget(net) {
  const d = networksCfg[net]?.database;
  if (!d) return null;
  if (d.elastic_tiktok) return { cluster: 'elastic_tiktok', index: d.elastic_tiktok.index };
  if (d.elastic)        return { cluster: 'elastic',        index: d.elastic.index };
  return null;
}
const NETWORKS = ['facebook', 'instagram', 'gdn', 'youtube', 'google', 'native', 'linkedin', 'reddit', 'quora', 'pinterest', 'tiktok'];

function auth(c) { return 'Basic ' + Buffer.from(`${c.username}:${c.password}`).toString('base64'); }

async function esFetch(node, headers, method, p, body) {
  const r = await fetch(node + p, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: r.status, json, text };
}

// esMajor from GET / ; used to pick the typed (ES6) vs typeless (ES7+/8) _mapping URL.
async function esMajor(node, headers) {
  const r = await esFetch(node, headers, 'GET', '/');
  const v = r.json?.version?.number;
  return v ? parseInt(v.split('.')[0], 10) : null;
}

// Discover the existing mapping type name for ES6 (usually 'doc'); typeless for ES7+/8.
async function resolveMappingPath(node, headers, index, major) {
  if (major != null && major >= 7) return `/${index}/_mapping`;
  const r = await esFetch(node, headers, 'GET', `/${index}/_mapping`);
  const mappings = r.json?.[index]?.mappings || {};
  const typeKey = Object.keys(mappings).find((k) => !['properties', '_meta', 'dynamic', '_source', 'dynamic_templates'].includes(k));
  return `/${index}/_mapping/${typeKey || 'doc'}`; // ES6 needs the type in the path
}

(async () => {
  const args   = process.argv.slice(2);
  const COMMIT = args.includes('--commit');
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.split('=')[1].split(',').map((s) => s.trim()) : null;

  console.log(`\n=== AI-Meta ES mapping apply — ${COMMIT ? 'COMMIT' : 'DRY-RUN'} ===\n`);

  const clusterMeta = {}; // cluster → { node, headers, major }
  const summary = [];

  for (const net of NETWORKS) {
    if (only && !only.includes(net)) continue;
    const t = resolveTarget(net);
    if (!t || !t.index) { console.log(`✗ ${net}: no ES index resolved — skipped`); summary.push({ net, status: 'no_index' }); continue; }

    const cc = cfg.databases[t.cluster];
    if (!cc?.node) { console.log(`✗ ${net}: cluster ${t.cluster} not configured — skipped`); summary.push({ net, status: 'no_cluster' }); continue; }

    // one handshake per cluster
    if (!clusterMeta[t.cluster]) {
      const headers = { Authorization: auth(cc) };
      const major = await esMajor(cc.node, headers).catch(() => null);
      clusterMeta[t.cluster] = { node: cc.node, headers, major };
    }
    const { node, headers, major } = clusterMeta[t.cluster];
    const label = `${net} → ${node}/${t.index} (ES${major ?? '?'})`;

    try {
      // Index must already exist — we never create it.
      const head = await esFetch(node, headers, 'GET', `/${t.index}`);
      if (head.status === 404) { console.log(`✗ ${label}: index does NOT exist — skipped (never created by this script)`); summary.push({ net, status: 'index_missing' }); continue; }
      if (head.status >= 400)  { console.log(`✗ ${label}: cannot read index (${head.status}) — skipped`); summary.push({ net, status: 'read_error' }); continue; }

      const mappingPath = await resolveMappingPath(node, headers, t.index, major);

      if (!COMMIT) {
        console.log(`• ${label}\n    PUT ${mappingPath}\n    ${JSON.stringify(MAPPING_BODY)}\n`);
        summary.push({ net, status: 'would_apply' });
        continue;
      }

      const res = await esFetch(node, headers, 'PUT', mappingPath, MAPPING_BODY);
      if (res.status < 400 && res.json?.acknowledged !== false) {
        console.log(`✓ ${label}: mapping applied (acknowledged)`);
        summary.push({ net, status: 'applied' });
      } else {
        console.log(`✗ ${label}: PUT failed (${res.status}) — data untouched — ${res.text.slice(0, 300)}`);
        summary.push({ net, status: 'put_failed', error: res.text.slice(0, 200) });
      }
    } catch (err) {
      console.log(`✗ ${label}: ERROR ${err.message}`);
      summary.push({ net, status: 'error', error: err.message });
    }
  }

  console.log('\n--- summary ---');
  for (const r of summary) console.log(`  ${r.net.padEnd(10)} ${r.status}${r.error ? ' — ' + r.error : ''}`);
  if (!COMMIT) console.log('\n(DRY-RUN — nothing was changed. Re-run with --commit to apply.)');
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
