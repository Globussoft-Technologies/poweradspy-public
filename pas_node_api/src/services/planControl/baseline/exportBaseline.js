'use strict';

/**
 * Baseline Export — exports the current live plan_access_config from MongoDB
 * and produces a timestamped, checksummed snapshot file.
 *
 * This is Phase 0 of the plan control revamp. Run this BEFORE any changes
 * to create the authoritative "before" reference.
 *
 * Usage:
 *   node src/services/planControl/baseline/exportBaseline.js
 *   node src/services/planControl/baseline/exportBaseline.js --output ./my-snapshot.json
 *
 * See docs/PLAN_CONTROL_REVAMP_PLAN.md §16 Phase 0.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Export the current plan_access_config collection.
 *
 * @param {Object} options
 * @param {Function} options.getDB    - Async function that returns the MongoDB db instance
 * @param {string} [options.outputPath] - Where to write the snapshot (default: auto-generated)
 * @param {Object} [options.logger]   - Logger instance (default: console)
 * @returns {Promise<Object>} The export result with path, checksum, and doc count
 */
async function exportBaseline({ getDB, outputPath, logger = console }) {
  const log = logger;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  log.info?.('[exportBaseline] Starting baseline export...');

  // ── Connect and fetch ─────────────────────────────────────────────────
  const db = await getDB();
  const collection = db.collection('plan_access_config');
  const docs = await collection.find({}).toArray();

  if (docs.length === 0) {
    log.warn?.('[exportBaseline] plan_access_config collection is EMPTY');
  }

  // ── Build snapshot ────────────────────────────────────────────────────
  const snapshot = {
    exportedAt: new Date().toISOString(),
    source: 'plan_access_config',
    documentCount: docs.length,
    documentIds: docs.map((d) => d._id),
    documents: docs,
  };

  // ── Compute checksum ──────────────────────────────────────────────────
  const canonical = JSON.stringify(snapshot.documents, null, 0);
  const checksum = crypto.createHash('sha256').update(canonical).digest('hex');
  snapshot.checksum = `sha256:${checksum}`;

  // ── Extract known plan IDs ────────────────────────────────────────────
  const planIds = new Set();

  // From plan_groups
  const pgDoc = docs.find((d) => d._id === 'plan_groups');
  if (pgDoc?.groups) {
    for (const group of Object.values(pgDoc.groups)) {
      if (Array.isArray(group?.plans)) {
        group.plans.forEach((id) => planIds.add(Number(id)));
      }
    }
  }

  // From platform_access
  const paDoc = docs.find((d) => d._id === 'platform_access');
  if (paDoc?.platform_plans) {
    for (const ids of Object.values(paDoc.platform_plans)) {
      if (Array.isArray(ids)) ids.forEach((id) => planIds.add(Number(id)));
    }
  }

  // From competitor_limits
  const clDoc = docs.find((d) => d._id === 'competitor_limits');
  if (clDoc?.plan_limits) {
    Object.keys(clDoc.plan_limits).forEach((id) => planIds.add(Number(id)));
  }

  // From filter allowed_plan_ids
  for (const doc of docs) {
    if (Array.isArray(doc.allowed_plan_ids)) {
      doc.allowed_plan_ids.forEach((id) => planIds.add(Number(id)));
    }
  }

  // Deleted plan IDs
  const deletedPlanIds = [];
  if (pgDoc && Array.isArray(pgDoc.deleted_plan_ids)) {
    pgDoc.deleted_plan_ids.forEach((d) => {
      planIds.add(Number(d.plan_id));
      deletedPlanIds.push(d);
    });
  }

  snapshot.knownPlanIds = [...planIds].sort((a, b) => a - b);
  snapshot.deletedPlanIds = deletedPlanIds;
  snapshot.planGroupNames = pgDoc?.groups ? Object.keys(pgDoc.groups) : [];

  // ── Write to file ─────────────────────────────────────────────────────
  const finalPath = outputPath || path.join(
    __dirname,
    `baseline_snapshot_${timestamp}.json`
  );

  const dir = path.dirname(finalPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(finalPath, JSON.stringify(snapshot, null, 2), 'utf8');

  log.info?.(`[exportBaseline] Exported ${docs.length} documents`);
  log.info?.(`[exportBaseline] Found ${planIds.size} unique plan IDs`);
  log.info?.(`[exportBaseline] Checksum: ${snapshot.checksum}`);
  log.info?.(`[exportBaseline] Written to: ${finalPath}`);

  return {
    path: finalPath,
    checksum: snapshot.checksum,
    documentCount: docs.length,
    planIdCount: planIds.size,
    planGroupNames: snapshot.planGroupNames,
  };
}

// ── CLI runner ──────────────────────────────────────────────────────────────

if (require.main === module) {
  (async () => {
    try {
      const { getDB, closeDB } = require('../../sdui/db');
      const outputArg = process.argv.find((a) => a.startsWith('--output'));
      const outputPath = outputArg ? process.argv[process.argv.indexOf(outputArg) + 1] : undefined;

      const result = await exportBaseline({ getDB, outputPath });
      console.log('\n✅ Baseline export complete:', JSON.stringify(result, null, 2));

      if (typeof closeDB === 'function') await closeDB();
      process.exit(0);
    } catch (err) {
      console.error('❌ Baseline export failed:', err);
      process.exit(1);
    }
  })();
}

module.exports = { exportBaseline };
