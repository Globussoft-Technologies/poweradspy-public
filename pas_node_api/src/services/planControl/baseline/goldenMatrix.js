'use strict';

/**
 * Golden Matrix — builds the authoritative "before" entitlement matrix
 * by calling the EXISTING planAccessService for every known plan ID.
 *
 * This is Phase 0 of the plan control revamp. The golden matrix is the
 * comparison target for proving the new evaluator matches the old one.
 *
 * Usage:
 *   node src/services/planControl/baseline/goldenMatrix.js
 *   node src/services/planControl/baseline/goldenMatrix.js --compare <new-matrix.json>
 *
 * See docs/PLAN_CONTROL_REVAMP_PLAN.md §16 Phase 0.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Build the golden matrix by evaluating every known plan ID through the
 * existing planAccessService.
 *
 * @param {Object} options
 * @param {number[]} options.planIds           - All known plan IDs to evaluate
 * @param {Function} options.getAllowedPlatforms - planAccessService.getAllowedPlatforms
 * @param {Function} options.getFilterStatus    - planAccessService.getFilterStatus
 * @param {Function} options.getCompetitorLimits - planAccessService.getCompetitorLimits
 * @param {Function} options.resolvePlanTier    - planAccessService.resolvePlanTier
 * @param {Array}    options.config             - The plan_access_config array
 * @param {string}   [options.outputPath]       - Where to write the matrix
 * @param {Object}   [options.logger]           - Logger instance
 * @returns {Promise<Object>} The matrix result
 */
async function buildGoldenMatrix({
  planIds,
  getAllowedPlatforms,
  getFilterStatus,
  getCompetitorLimits,
  resolvePlanTier,
  config: planConfig,
  outputPath,
  logger = console,
}) {
  const log = logger;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const networks = ['all', 'facebook', 'instagram', 'youtube', 'google', 'gdn',
    'linkedin', 'reddit', 'quora', 'pinterest', 'tiktok', 'native'];

  log.info?.(`[goldenMatrix] Evaluating ${planIds.length} plan IDs across ${networks.length} network contexts...`);

  const matrix = {};

  for (const planId of planIds) {
    const entry = {
      planId,
      tier: resolvePlanTier(planId, planConfig),
      allowedPlatforms: getAllowedPlatforms(planId, planConfig),
      competitorLimits: getCompetitorLimits(planId, planConfig),
      filtersByNetwork: {},
    };

    // Evaluate filter status for each network context
    for (const network of networks) {
      entry.filtersByNetwork[network] = getFilterStatus(planId, network, planConfig);
    }

    matrix[planId] = entry;
  }

  // ── Build output ──────────────────────────────────────────────────────
  const output = {
    generatedAt: new Date().toISOString(),
    planCount: planIds.length,
    networkContexts: networks,
    matrix,
  };

  const canonical = JSON.stringify(output.matrix, null, 0);
  output.checksum = `sha256:${crypto.createHash('sha256').update(canonical).digest('hex')}`;

  // ── Write to file ─────────────────────────────────────────────────────
  const finalPath = outputPath || path.join(
    __dirname,
    `golden_matrix_${timestamp}.json`
  );

  const dir = path.dirname(finalPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(finalPath, JSON.stringify(output, null, 2), 'utf8');

  log.info?.(`[goldenMatrix] Matrix for ${planIds.length} plans written to: ${finalPath}`);
  log.info?.(`[goldenMatrix] Checksum: ${output.checksum}`);

  return {
    path: finalPath,
    checksum: output.checksum,
    planCount: planIds.length,
  };
}

/**
 * Compare two golden matrices and report differences.
 *
 * @param {Object} oldMatrix - The "before" matrix
 * @param {Object} newMatrix - The "after" matrix (from the new evaluator)
 * @returns {{ matches: number, mismatches: Object[], missing: number[] }}
 */
function compareMatrices(oldMatrix, newMatrix) {
  const mismatches = [];
  let matches = 0;
  const missingInNew = [];

  for (const [planId, oldEntry] of Object.entries(oldMatrix.matrix || {})) {
    const newEntry = (newMatrix.matrix || {})[planId];
    if (!newEntry) {
      missingInNew.push(Number(planId));
      continue;
    }

    let planMatches = true;

    // Compare allowed platforms
    const oldPlatforms = (oldEntry.allowedPlatforms || []).sort().join(',');
    const newPlatforms = (newEntry.allowedPlatforms || []).sort().join(',');
    if (oldPlatforms !== newPlatforms) {
      planMatches = false;
      mismatches.push({
        planId: Number(planId),
        field: 'allowedPlatforms',
        old: oldEntry.allowedPlatforms,
        new: newEntry.allowedPlatforms,
      });
    }

    // Compare tier
    if (oldEntry.tier !== newEntry.tier) {
      planMatches = false;
      mismatches.push({
        planId: Number(planId),
        field: 'tier',
        old: oldEntry.tier,
        new: newEntry.tier,
      });
    }

    // Compare competitor limits
    if (JSON.stringify(oldEntry.competitorLimits) !== JSON.stringify(newEntry.competitorLimits)) {
      planMatches = false;
      mismatches.push({
        planId: Number(planId),
        field: 'competitorLimits',
        old: oldEntry.competitorLimits,
        new: newEntry.competitorLimits,
      });
    }

    // Compare filter status per network
    for (const network of Object.keys(oldEntry.filtersByNetwork || {})) {
      const oldFilters = oldEntry.filtersByNetwork[network] || {};
      const newFilters = (newEntry.filtersByNetwork || {})[network] || {};

      for (const filterId of new Set([...Object.keys(oldFilters), ...Object.keys(newFilters)])) {
        const oldF = oldFilters[filterId];
        const newF = newFilters[filterId];
        if (JSON.stringify(oldF) !== JSON.stringify(newF)) {
          planMatches = false;
          mismatches.push({
            planId: Number(planId),
            field: `filtersByNetwork.${network}.${filterId}`,
            old: oldF,
            new: newF,
          });
        }
      }
    }

    if (planMatches) matches++;
  }

  return { matches, mismatches, missing: missingInNew };
}

// ── CLI runner ──────────────────────────────────────────────────────────────

if (require.main === module) {
  (async () => {
    try {
      // Check for --compare mode
      const compareIdx = process.argv.indexOf('--compare');
      if (compareIdx !== -1) {
        const comparePath = process.argv[compareIdx + 1];
        if (!comparePath) {
          console.error('Usage: --compare <new-matrix.json>');
          process.exit(1);
        }
        // Find the most recent golden matrix
        const files = fs.readdirSync(__dirname)
          .filter((f) => f.startsWith('golden_matrix_'))
          .sort()
          .reverse();
        if (files.length === 0) {
          console.error('No golden matrix found. Run without --compare first.');
          process.exit(1);
        }
        const oldMatrix = JSON.parse(fs.readFileSync(path.join(__dirname, files[0]), 'utf8'));
        const newMatrix = JSON.parse(fs.readFileSync(comparePath, 'utf8'));
        const result = compareMatrices(oldMatrix, newMatrix);
        console.log('\n📊 Comparison result:');
        console.log(`  ✅ Matches: ${result.matches}`);
        console.log(`  ❌ Mismatches: ${result.mismatches.length}`);
        console.log(`  ⚠️  Missing in new: ${result.missing.length}`);
        if (result.mismatches.length > 0) {
          console.log('\nFirst 10 mismatches:');
          for (const m of result.mismatches.slice(0, 10)) {
            console.log(`  Plan ${m.planId} | ${m.field}`);
            console.log(`    Old: ${JSON.stringify(m.old)}`);
            console.log(`    New: ${JSON.stringify(m.new)}`);
          }
        }
        process.exit(result.mismatches.length > 0 ? 1 : 0);
      }

      // Build mode
      const planAccessService = require('../../planAccess/planAccessService');
      const planConfig = await planAccessService.getConfig();

      if (!planConfig || planConfig.length === 0) {
        console.error('❌ No plan config available. Is MongoDB running?');
        process.exit(1);
      }

      // Collect all known plan IDs
      const planIds = new Set();
      for (const doc of planConfig) {
        if (doc._id === 'plan_groups' && doc.groups) {
          for (const group of Object.values(doc.groups)) {
            if (Array.isArray(group?.plans)) group.plans.forEach((id) => planIds.add(Number(id)));
          }
        }
        if (doc._id === 'platform_access' && doc.platform_plans) {
          for (const ids of Object.values(doc.platform_plans)) {
            if (Array.isArray(ids)) ids.forEach((id) => planIds.add(Number(id)));
          }
        }
        if (doc._id === 'competitor_limits' && doc.plan_limits) {
          Object.keys(doc.plan_limits).forEach((id) => planIds.add(Number(id)));
        }
        if (Array.isArray(doc.allowed_plan_ids)) {
          doc.allowed_plan_ids.forEach((id) => planIds.add(Number(id)));
        }
      }

      const sortedIds = [...planIds].sort((a, b) => a - b);

      const result = await buildGoldenMatrix({
        planIds: sortedIds,
        getAllowedPlatforms: planAccessService.getAllowedPlatforms,
        getFilterStatus: planAccessService.getFilterStatus,
        getCompetitorLimits: planAccessService.getCompetitorLimits,
        resolvePlanTier: planAccessService.resolvePlanTier,
        config: planConfig,
      });

      console.log('\n✅ Golden matrix built:', JSON.stringify(result, null, 2));
      process.exit(0);
    } catch (err) {
      console.error('❌ Golden matrix build failed:', err);
      process.exit(1);
    }
  })();
}

module.exports = { buildGoldenMatrix, compareMatrices };
