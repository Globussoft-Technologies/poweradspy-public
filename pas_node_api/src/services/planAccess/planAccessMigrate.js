'use strict';

/**
 * Plan Access Migration — run ONCE to seed MongoDB from all plan data sources.
 *
 * Usage (from pas_node_api root):
 *   node src/services/planAccess/planAccessMigrate.js
 *
 * What it migrates into `plan_access_config` collection:
 *   1. All filter/platform/limits docs from plan_config.json
 *   2. plan_billing_metadata from planAccessSeed.js (was JS-only)
 *
 * Uses the same getDB() as the rest of the app — guaranteed same database.
 * Safe to re-run — uses upsert, never deletes existing data.
 */

const path = require('path');
const fs   = require('fs');

// Load .env so this script uses the same DB settings as the server
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

// Use the exact same DB connection as the rest of the app
const { getDB, closeDB } = require('../sdui/db');

const CONFIG_PATH = path.join(__dirname, 'plan_config.json');

async function migrate() {
  // ── 1. Load docs from plan_config.json ───────────────────────────────────
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('plan_config.json not found at', CONFIG_PATH);
    process.exit(1);
  }
  const jsonDocs = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  // console.log(`Loaded ${jsonDocs.length} documents from plan_config.json`);

  // ── 2. Load plan_billing_metadata from seed (not in JSON) ────────────────
  let billingMetadataDoc = null;
  try {
    const seed = require('./planAccessSeed');
    billingMetadataDoc = seed.planBillingMetadata || null;
    if (billingMetadataDoc) {
      // console.log('Loaded plan_billing_metadata from planAccessSeed.js');
    }
  } catch (e) {
    console.warn('Could not load planAccessSeed.js:', e.message);
  }

  // ── 3. Build final doc list (deduplicate) ─────────────────────────────────
  const allDocs = [...jsonDocs];
  if (billingMetadataDoc && !allDocs.find(d => d._id === 'plan_billing_metadata')) {
    allDocs.push(billingMetadataDoc);
    // console.log('Added plan_billing_metadata to migration set');
  }

  // console.log(`\nTotal documents to upsert: ${allDocs.length}`);

  // ── 4. Connect — reuse app connection but explicitly target pas_dev ─────────
  // getDB() may resolve to a different db name via config (e.g. pas_ui).
  // We call getDB() only to reuse the established MongoClient, then
  // explicitly switch to pas_dev where sdui_config lives.
  const appDb = await getDB();
  const db = appDb.client.db('pas_dev');
  const col = db.collection('plan_access_config');

  // console.log(`\nMigrating into: ${db.databaseName}.plan_access_config\n`);

  let upserted = 0;
  let unchanged = 0;

  for (const doc of allDocs) {
    const result = await col.replaceOne(
      { _id: doc._id },
      doc,
      { upsert: true }
    );
    if (result.upsertedCount > 0 || result.modifiedCount > 0) {
      upserted++;
      // console.log(`  UPSERTED  ${doc._id}`);
    } else {
      unchanged++;
      // console.log(`  UNCHANGED ${doc._id}`);
    }
  }

  // ── 5. Patch SDUI-only docs that have incomplete allowed_plan_ids ─────────
  // `verified` and `image_size` SDUI docs were saved with allowed_plan_ids:[20] only
  // (no real restriction configured). Null = all plans allowed.
  const incompleteSDUIDocs = ['verified', 'image_size'];
  for (const id of incompleteSDUIDocs) {
    const doc = await col.findOne({ _id: id });
    if (doc && Array.isArray(doc.allowed_plan_ids) && doc.allowed_plan_ids.length <= 1) {
      await col.updateOne({ _id: id }, { $set: { allowed_plan_ids: null, updated_at: new Date().toISOString() } });
      console.log(`  PATCHED   ${id}  (allowed_plan_ids set to null — all plans allowed)`);
    }
  }

  const total = await col.countDocuments();
  // console.log(`\nMigration complete`);
  // console.log(`  Upserted : ${upserted}`);
  // console.log(`  Unchanged: ${unchanged}`);
  // console.log(`  Collection ${db.databaseName}.plan_access_config now has ${total} total docs`);

  await closeDB();
}

migrate().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
