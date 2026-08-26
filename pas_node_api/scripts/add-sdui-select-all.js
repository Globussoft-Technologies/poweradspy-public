'use strict';

/**
 * Add (or remove) the `select_all: true` flag on every multi-select SDUI
 * filter that supports the "Select all" bulk-action checkbox
 * (FilterCheckboxList.jsx / ComboboxFilter.jsx read this flag directly —
 * see SchemaRenderer.jsx's `showSelectAll: filter.select_all === true`).
 *
 * Only touches the `select_all` field on the listed filters — no other
 * field (options, labels, platform_applicability, etc.) is read or written.
 *
 * Scope is a fixed, reviewed list (not "every checkbox/combobox filter found
 * at runtime") so a newly-added single-select filter can never be silently
 * swept in by accident. Single-select filters (multi_select: false, e.g.
 * Image Size, Ad Sub Position) are deliberately excluded — "select all"
 * doesn't make sense for a pick-one control.
 *
 * Status (read-only):
 *   node scripts/add-sdui-select-all.js
 *   node scripts/add-sdui-select-all.js --status
 *
 * Apply:
 *   node scripts/add-sdui-select-all.js --apply
 *
 * Rollback (remove the flag again):
 *   node scripts/add-sdui-select-all.js --rollback
 */

const { getDB, closeDB } = require('../src/services/sdui/db');

// { doc _id -> filter _id } for every multi-select filter that should get
// the flag. Language and Country already have it (applied manually earlier)
// but are listed here too so --status/--rollback account for them.
const TARGETS = [
  { doc: 'language', filter: 'language_filter' },
  { doc: 'country', filter: 'country_filter' },
  { doc: 'ecommerce_platform', filter: 'ecommerce_platform_filter' },
  { doc: 'funnel', filter: 'funnel_filter' },
  { doc: 'marketing_platform', filter: 'marketing_platform_filter' },
  { doc: 'source', filter: 'source_filter' },
  { doc: 'affiliate_network', filter: 'affiliate_network_filter' },
  { doc: 'ad_position', filter: 'ad_position_filter' },
  { doc: 'native_network', filter: 'native_network_filter' },
  { doc: 'sidebar_budget', filter: 'budget_filter' },
  { doc: 'admob_source_app', filter: 'source_app_filter' },
  { doc: 'admob_network', filter: 'admob_network_filter' },
];

function parseArgs(argv) {
  return {
    apply: argv.includes('--apply'),
    rollback: argv.includes('--rollback'),
  };
}

async function readState(collection) {
  const rows = [];
  for (const { doc, filter } of TARGETS) {
    const docRow = await collection.findOne(
      { _id: doc, 'filters._id': filter },
      { projection: { [`filters.$`]: 1, title: 1 } },
    );
    const f = docRow?.filters?.[0];
    rows.push({
      doc,
      filter,
      found: Boolean(f),
      label: f?.label,
      multi_select: f?.multi_select,
      select_all: f?.select_all === true,
    });
  }
  return rows;
}

function printState(rows, heading) {
  console.log(`\n${heading}`);
  for (const r of rows) {
    if (!r.found) {
      console.log(`  [MISSING] ${r.doc} > ${r.filter} — not found in sdui_config, skipping`);
      continue;
    }
    if (r.multi_select === false) {
      console.log(`  [SKIP]    ${r.doc} > ${r.filter} (${r.label}) — multi_select:false, select_all not applicable`);
      continue;
    }
    console.log(`  [${r.select_all ? 'ON ' : 'OFF'}]     ${r.doc} > ${r.filter} (${r.label})`);
  }
}

async function main() {
  const { apply, rollback } = parseArgs(process.argv.slice(2));
  const mode = apply ? 'APPLY' : rollback ? 'ROLLBACK' : 'STATUS (dry-run)';
  console.log(`\n=== SDUI select_all flag — ${mode} ===`);

  const db = await getDB();
  const collection = db.collection('sdui_config');

  const before = await readState(collection);
  printState(before, 'Current state:');

  if (!apply && !rollback) {
    console.log('\nDry-run only. Re-run with --apply to set select_all:true, or --rollback to remove it.');
    await closeDB();
    return;
  }

  const eligible = before.filter((r) => r.found && r.multi_select !== false);
  const toChange = eligible.filter((r) => r.select_all !== apply); // apply=true wants ON, rollback wants OFF

  if (toChange.length === 0) {
    console.log(`\nNO-OP — nothing to ${apply ? 'apply' : 'roll back'}.`);
    await closeDB();
    return;
  }

  for (const r of toChange) {
    await collection.updateOne(
      { _id: r.doc, 'filters._id': r.filter },
      { $set: { 'filters.$.select_all': apply } },
    );
    console.log(`  ${apply ? 'SET' : 'UNSET'} select_all on ${r.doc} > ${r.filter}`);
  }

  const after = await readState(collection);
  printState(after, 'New state:');

  await closeDB();
}

main().catch((error) => {
  console.error('FATAL', error);
  closeDB().finally(() => process.exit(1));
});
