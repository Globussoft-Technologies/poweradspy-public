'use strict';

/**
 * Plan Access Migration — syncs plan_config.json (+ planAccessSeed.js's
 * plan_billing_metadata/DEFAULT_PLAN_GROUPS) into the live `plan_access_config`
 * collection. Safe to re-run in any environment — dev, staging, prod.
 *
 * Usage (from pas_node_api root):
 *   node src/services/planAccess/planAccessMigrate.js           (dry run — prints only)
 *   node src/services/planAccess/planAccessMigrate.js --apply   (writes)
 *
 * Environment-aware by construction: connects via the exact same getDB() (and
 * therefore the exact same config.databases.mongo.{uri,database} from config.json)
 * that planAccessService.js and adminRoutes.js use at runtime. There is no
 * hardcoded database name — whatever database a given environment's config.json
 * points at is the one this script reads and writes, so the same command is
 * correct in dev and in prod without edits.
 *
 * Additive-only merge (never destructive):
 *   - Doc missing live entirely           -> insertOne
 *   - Array field (allowed_plan_ids,
 *     platform_plans.<network>)           -> $addToSet with $each (Mongo dedupes
 *                                             automatically — safe to pass the
 *                                             full source array every time)
 *   - Object-map field (plan_limits,
 *     plan_info, plan_groups.groups)      -> $set only the keys ABSENT live;
 *                                             existing live keys are never
 *                                             overwritten, even if their value
 *                                             differs from the JSON source
 *                                             (the live collection is the
 *                                             editable source of truth after
 *                                             the admin panel touches it —
 *                                             this script only fills gaps).
 *
 * This script never does a full-document replaceOne. A previous version of
 * this file did (and additionally targeted a hardcoded, inaccessible 'pas_dev'
 * database) — both were bugs: replaceOne would have silently discarded any
 * plan_access_config edits made via the admin panel that aren't reflected in
 * this repo's plan_config.json snapshot, and the wrong database meant the
 * script never actually reached the data the live app reads. See
 * docs/PLAN_ACCESS.md § 2026 Pricing Restructure for the incident this fixed.
 */

const path = require('path');
const fs = require('fs');

const { getDB, closeDB } = require('../sdui/db');
const { planBillingMetadata, DEFAULT_PLAN_GROUPS } = require('./planAccessSeed');
const { getContributionDocs } = require('./restructure2026');

const CONFIG_PATH = path.join(__dirname, 'plan_config.json');
const APPLY = process.argv.includes('--apply');

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Recursively finds every array field and every "plan-id-keyed object map"
 * field in a doc, relative to a dot-path prefix. Returns:
 *   arrayPaths: [{ path: 'allowed_plan_ids', value: [...] }, { path: 'platform_plans.facebook', value: [...] }]
 *   mapPaths:   [{ path: 'plan_limits', value: {...} }, { path: 'plan_info', value: {...} }, { path: 'groups', value: {...} }]
 * A "plan-id-keyed object map" is heuristically any object whose values are
 * themselves objects/primitives and whose keys look like plan IDs or group
 * names — in practice this repo only has 3 such fields (plan_limits,
 * plan_info, groups), detected by name below rather than by guessing shape.
 */
const KNOWN_MAP_FIELDS = new Set(['plan_limits', 'plan_info', 'groups']);

function collectFields(obj, prefix, arrayPaths, mapPaths) {
  for (const [key, value] of Object.entries(obj)) {
    if (key === '_id') continue;
    const fieldPath = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(value)) {
      arrayPaths.push({ path: fieldPath, value });
    } else if (isPlainObject(value)) {
      if (KNOWN_MAP_FIELDS.has(key)) {
        mapPaths.push({ path: fieldPath, value });
      } else {
        collectFields(value, fieldPath, arrayPaths, mapPaths);
      }
    }
  }
}

async function migrateDoc(col, sourceDoc) {
  const liveDoc = await col.findOne({ _id: sourceDoc._id });

  if (!liveDoc) {
    return { op: 'insert', exec: () => col.insertOne(sourceDoc) };
  }

  const arrayPaths = [];
  const mapPaths = [];
  collectFields(sourceDoc, '', arrayPaths, mapPaths);

  const addToSet = {};
  for (const { path: p, value } of arrayPaths) {
    if (value.length === 0) continue;
    addToSet[p] = { $each: value };
  }

  const set = {};
  for (const { path: p, value } of mapPaths) {
    const liveMap = p.split('.').reduce((o, k) => (o ? o[k] : undefined), liveDoc) || {};
    for (const [k, v] of Object.entries(value)) {
      if (!(k in liveMap)) set[`${p}.${k}`] = v;
    }
  }

  if (Object.keys(addToSet).length === 0 && Object.keys(set).length === 0) {
    return { op: 'noop' };
  }

  const update = {};
  if (Object.keys(addToSet).length) update.$addToSet = addToSet;
  if (Object.keys(set).length) update.$set = set;

  return {
    op: 'update',
    detail: { addToSet: Object.keys(addToSet), set: Object.keys(set) },
    exec: () => col.updateOne({ _id: sourceDoc._id }, update),
  };
}

async function migrate() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('plan_config.json not found at', CONFIG_PATH);
    process.exit(1);
  }
  const jsonDocs = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

  let allSourceDocs = [...jsonDocs];
  if (planBillingMetadata && !allSourceDocs.find((d) => d._id === 'plan_billing_metadata')) {
    allSourceDocs.push(planBillingMetadata);
  }
  if (DEFAULT_PLAN_GROUPS && !allSourceDocs.find((d) => d._id === 'plan_groups')) {
    allSourceDocs.push(DEFAULT_PLAN_GROUPS);
  }

  // Merge in the 2026-restructure tiers, resolved from config.pricing.planIds —
  // none of the docs above hardcode those plan IDs. See restructure2026.js.
  const { mergeContributions } = require('./restructure2026');
  allSourceDocs = mergeContributions(allSourceDocs);
  console.log(`(2026-restructure contributions merged in from config.pricing.planIds: ${JSON.stringify(getContributionDocs().length ? 'yes' : 'no configured plan IDs — skipped')})`);

  const db = await getDB();
  const col = db.collection('plan_access_config');
  console.log(`Target: ${db.databaseName}.plan_access_config  |  mode: ${APPLY ? 'APPLY (will write)' : 'DRY RUN (read-only)'}\n`);

  const plans = [];
  for (const doc of allSourceDocs) {
    const plan = await migrateDoc(col, doc);
    plans.push({ id: doc._id, ...plan });
  }

  const active = plans.filter((p) => p.op !== 'noop');
  console.log(`${active.length} of ${plans.length} docs need changes:\n`);
  for (const p of active) {
    if (p.op === 'insert') console.log(`  INSERT   ${p.id}`);
    else console.log(`  UPDATE   ${p.id}  addToSet:[${p.detail.addToSet.join(', ')}]  set:[${p.detail.set.join(', ')}]`);
  }

  if (!APPLY) {
    console.log('\nDRY RUN ONLY — nothing was written. Re-run with --apply to execute.');
    await closeDB();
    return;
  }

  console.log('\nAPPLYING...\n');
  for (const p of active) {
    const result = await p.exec();
    console.log(`  OK  ${p.id} ->`, JSON.stringify({
      matched: result.matchedCount, modified: result.modifiedCount,
      upserted: result.upsertedCount, insertedId: result.insertedId,
    }));
  }
  console.log(`\nDone. ${active.length} docs updated.`);
  await closeDB();
}

migrate().catch((err) => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
