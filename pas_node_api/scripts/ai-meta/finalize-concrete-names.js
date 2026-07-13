#!/usr/bin/env node
'use strict';

/**
 * finalize-concrete-names.js — convert the alias'd indices (facebook/instagram/gdn,
 * currently `<name>` → alias → `<name>_v2`) back to CONCRETE indices under the original
 * name, so all 11 networks look uniform (plain concrete indices, no aliases).
 *
 * WHY a reindex-back (not a rename): the main cluster is ES 6.8, which has no rename and
 * no _clone API. So we free the name (drop the alias) and reindex `<name>_v2` into a fresh
 * concrete `<name>` that carries the correct v1.6 mapping, then drop `<name>_v2`.
 *
 * SAFETY:
 *   - Precondition check: `<name>` must currently be an alias → `<name>_v2` with equal
 *     counts; otherwise the network is skipped (won't touch already-concrete indices).
 *   - Reindex uses `op_type: create` + `conflicts: proceed`, so a doc written by the app
 *     into the new `<name>` during the window is NOT overwritten by the older `_v2` copy.
 *   - If anything fails after the alias is dropped, the alias `<name>` → `<name>_v2` is
 *     restored so the app keeps working.
 *   - `<name>_v2` is only deleted after the new `<name>` count is verified.
 *   - There is a brief window (duration of the reindep) where `<name>` is repopulating —
 *     run during low ingestion. DRY-RUN by default; pass --commit to execute.
 *
 * USAGE:
 *   node scripts/ai-meta/finalize-concrete-names.js --only=instagram           # dry-run
 *   node scripts/ai-meta/finalize-concrete-names.js --only=instagram --commit  # canary
 *   node scripts/ai-meta/finalize-concrete-names.js --only=facebook,gdn --commit
 */

const fs = require('fs');
const path = require('path');
const cfg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../config.json'), 'utf8'));
const E = cfg.databases.elastic;
const H = { Authorization: 'Basic ' + Buffer.from(`${E.username}:${E.password}`).toString('base64'), 'Content-Type': 'application/json' };

const TARGETS = { facebook: 'search_mix', instagram: 'instagram_search_mix', gdn: 'gdn_search_mix' };
const STRIP = ['uuid', 'creation_date', 'version', 'provided_name', 'resize', 'routing'];

async function es(method, p, body) {
  const r = await fetch(E.node + p, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json; try { json = text ? JSON.parse(text) : null; } catch { json = null; }
  return { status: r.status, json, text };
}
async function count(idx) { const r = await es('GET', `/${idx}/_count`); return r.json?.count; }
function sanitize(src) { const idx = { ...(src?.index || {}) }; for (const k of STRIP) delete idx[k]; delete idx.blocks; if (idx.number_of_replicas == null) idx.number_of_replicas = '0'; return { index: idx }; }

async function finalizeOne(net, name, COMMIT) {
  const v2 = `${name}_v2`;
  console.log(`\n### ${net}: make ${name} a concrete index (from alias → ${v2})`);

  // Precondition: name must be an alias pointing to v2.
  const al = await es('GET', `/${name}/_alias`);
  const concrete = al.json ? Object.keys(al.json)[0] : null;
  if (al.status === 404 || !concrete) { console.log(`  ✗ ${name} not found — skipped`); return { net, status: 'not_found' }; }
  if (concrete === name) { console.log(`  • ${name} is ALREADY a concrete index (no alias) — nothing to do`); return { net, status: 'already_concrete' }; }
  if (concrete !== v2) { console.log(`  ✗ ${name} → ${concrete}, expected ${v2} — skipped (unexpected state)`); return { net, status: 'unexpected' }; }

  const n2 = await count(v2);
  console.log(`  ${v2} docs=${n2}`);

  if (!COMMIT) { console.log(`  (dry-run) would: drop alias ${name}; create concrete ${name} w/ v1.6 mapping; reindex ${v2}→${name} (op_type=create); verify; delete ${v2}`); return { net, status: 'would_finalize' }; }

  // Snapshot v2 settings + mapping to recreate name identically (v2 mapping is already v1.6-correct).
  const [{ json: setJson }, { json: mapJson }] = await Promise.all([es('GET', `/${v2}/_settings`), es('GET', `/${v2}/_mapping`)]);
  const settings = sanitize(setJson?.[v2]?.settings);
  const mappings = mapJson?.[v2]?.mappings || {};

  // 1) free the name
  let aliasDropped = false;
  const rm = await es('POST', '/_aliases', { actions: [{ remove: { index: v2, alias: name } }] });
  if (rm.status >= 400) { console.log(`  ✗ could not drop alias: ${rm.text.slice(0, 200)}`); return { net, status: 'alias_drop_failed' }; }
  aliasDropped = true;

  try {
    // 2) create concrete name with the correct (v2) mapping
    const cr = await es('PUT', `/${name}`, { settings, mappings });
    if (cr.status >= 400) throw new Error(`create ${name}: ${cr.text.slice(0, 200)}`);

    // 3) reindex v2 → name, never overwriting an app write that landed in the meantime
    const rx = await es('POST', `/_reindex?wait_for_completion=true&slices=auto&refresh=true`, {
      conflicts: 'proceed', source: { index: v2, size: 2000 }, dest: { index: name, op_type: 'create' },
    });
    if (rx.status >= 400) throw new Error(`reindex: ${rx.text.slice(0, 200)}`);

    // 4) verify: new name has at least as many docs as v2 (>= allows for in-window app creates)
    const nName = await count(name);
    if (nName < n2) throw new Error(`count check: ${name}=${nName} < ${v2}=${n2}`);
    console.log(`  ✓ reindexed: ${name} docs=${nName} (created=${rx.json.created}, conflicts=${rx.json.version_conflicts})`);

    // 5) drop v2
    const del = await es('DELETE', `/${v2}`);
    if (del.status >= 400) console.log(`  ⚠ ${name} is concrete & correct, but deleting ${v2} failed (${del.text.slice(0, 120)}) — delete it manually`);
    else console.log(`  ✓ ${name} is now a CONCRETE index (v1.6 mapping); ${v2} removed`);
    return { net, status: 'finalized', docs: nName };
  } catch (err) {
    // restore service: re-point the alias to v2 so the app keeps working
    console.log(`  ✗ ${net}: ${err.message}`);
    if (aliasDropped) {
      await es('DELETE', `/${name}`).catch(() => {}); // remove partial concrete index if created
      const restore = await es('POST', '/_aliases', { actions: [{ add: { index: v2, alias: name } }] });
      console.log(`  ↩ restored alias ${name} → ${v2}: ${restore.status < 400 ? 'OK' : 'FAILED — MANUAL FIX NEEDED'}`);
    }
    return { net, status: 'error', error: err.message };
  }
}

(async () => {
  const args = process.argv.slice(2);
  const COMMIT = args.includes('--commit');
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.split('=')[1].split(',').map((s) => s.trim()) : null;

  console.log(`\n=== Finalize concrete index names — ${COMMIT ? 'COMMIT' : 'DRY-RUN'} ===\ncluster=${E.node}`);
  const summary = [];
  for (const [net, name] of Object.entries(TARGETS)) {
    if (only && !only.includes(net)) continue;
    summary.push(await finalizeOne(net, name, COMMIT));
  }
  console.log('\n--- summary ---');
  for (const r of summary) console.log(`  ${r.net.padEnd(10)} ${r.status}${r.error ? ' — ' + r.error : ''}`);
  if (!COMMIT) console.log('\n(DRY-RUN — nothing changed. Re-run with --commit.)');
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
