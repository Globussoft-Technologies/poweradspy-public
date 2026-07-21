'use strict';

/**
 * One-time seed: insert `project_access` into MongoDB `plan_access_config`.
 *
 * Usage (from pas_node_api root):
 *   node src/services/planAccess/seedProjectAccess.js
 *
 * Safe to re-run — uses upsert.
 * Plan 25 and other basic/mid plans are NOT in allowed_plan_ids.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

const { getDB, closeDB } = require('../sdui/db');

// Taken directly from compPlans in checkPlanFilter.blade.php — all plans that have
// brandLimit + competitorLimit defined. Plans NOT listed here (pure basic: 2,5,9,14,15,25,40,52,59,64)
// will not have project access.
const PROJECT_ACCESS_PLAN_IDS = [
  4, 7, 9, 10, 11, 12, 17, 22, 25, 26, 27, 28, 29, 30, 31, 32,
  34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45,
  52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69,
];

async function seed() {
  // Use the exact same database getDB() resolves to at runtime (config.databases.mongo.database) —
  // a previous version hardcoded 'pas_dev', which this DB user isn't even authorized on and which
  // isn't the database planAccessService.js/adminRoutes.js actually read. See planAccessMigrate.js's
  // header comment and docs/PLAN_ACCESS.md § 2026 Pricing Restructure for the incident this fixed.
  const db = await getDB();
  const col = db.collection('plan_access_config');

  const doc = {
    _id: 'project_access',
    label: 'Projects Section Access',
    category: 'feature',
    query_param: null,
    description: 'Controls which plans can access the All Projects section',
    allowed_plan_ids: PROJECT_ACCESS_PLAN_IDS,
    visible: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const result = await col.replaceOne({ _id: 'project_access' }, doc, { upsert: true });

  if (result.upsertedCount > 0) {
    console.log('project_access document INSERTED into plan_access_config');
  } else if (result.modifiedCount > 0) {
    console.log('project_access document UPDATED in plan_access_config');
  } else {
    console.log('project_access already up to date — no changes made');
  }

  await closeDB();
}

seed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
