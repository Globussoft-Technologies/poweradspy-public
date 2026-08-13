#!/usr/bin/env node
'use strict';

/**
 * Safely move the active plan-control settings between environments.
 *
 * The exported bundle contains no database credentials. On import, the target
 * environment's family definitions and billing plan IDs remain authoritative;
 * only family policy settings and their all-plan application intent are moved.
 *
 * Export on development:
 *   node scripts/sync-plan-policy-environments.js export --output ./dev-plan-policy.json
 *
 * Preview on production (no database writes):
 *   node scripts/sync-plan-policy-environments.js apply --input ./dev-plan-policy.json --expected-current-revision 2
 *
 * Publish revision 3 on production:
 *   node scripts/sync-plan-policy-environments.js apply --input ./dev-plan-policy.json --expected-current-revision 2 --publish --reason "Sync dev live plan settings"
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { getDB, closeDB } = require('../src/services/sdui/db');
const {
  checksumSnapshot,
  diffSnapshots,
  validateSnapshot,
} = require('../src/services/planControl/engine/policyValidation');
const {
  withConfiguredPlanVariants,
} = require('../src/services/planControl/engine/planFamilies');
const {
  saveDraft,
  publishDraft,
} = require('../src/services/planControl/storage/storage');

const COLLECTION_VERSIONS = 'plan_policy_versions';
const COLLECTION_STATE = 'plan_policy_state';
const ACTIVE_POINTER_ID = 'active';
const BUNDLE_SCHEMA = 'pas-plan-policy-transfer/v1';

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.keys(value).sort().reduce((out, key) => {
    out[key] = canonical(value[key]);
    return out;
  }, {});
}

function digest(value) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')}`;
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command, publish: false };
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token === '--publish') {
      args.publish = true;
      continue;
    }
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const equalAt = token.indexOf('=');
    const key = token.slice(2, equalAt > 0 ? equalAt : undefined);
    const value = equalAt > 0 ? token.slice(equalAt + 1) : rest[++index];
    if (value === undefined || String(value).startsWith('--')) throw new Error(`Missing value for --${key}`);
    args[key.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  export --output <file> [--families family-a,family-b]',
    '  apply  --input <file> --expected-current-revision <n> [--publish --reason <text>]',
    '',
    'apply is a read-only dry-run unless --publish is explicitly supplied.',
  ].join('\n');
}

async function readActivePolicyReadOnly() {
  const db = await getDB();
  const versions = db.collection(COLLECTION_VERSIONS);
  const pointer = await db.collection(COLLECTION_STATE).findOne({ _id: ACTIVE_POINTER_ID });
  let version = pointer?.versionId
    ? await versions.findOne({ versionId: pointer.versionId })
    : await versions.find({ status: { $in: ['published', 'active'] } }).sort({ revision: -1, createdAt: -1 }).limit(1).next();
  if (!version) throw new Error('No active plan policy exists in this environment.');
  const actualChecksum = checksumSnapshot(version.snapshot);
  if (actualChecksum !== version.checksum) {
    throw new Error(`Active policy checksum mismatch for ${version.versionId}; refusing to continue.`);
  }
  if (pointer && Number(pointer.revision) !== Number(version.revision)) {
    throw new Error(`Active pointer revision ${pointer.revision} does not match policy revision ${version.revision}.`);
  }
  return { version, pointer };
}

function effectiveVariantPolicy(policy, planId) {
  const base = policy || {};
  const override = base.variantOverrides?.[String(planId)] || {};
  const capabilities = {};
  const capabilityIds = new Set([
    ...Object.keys(base.capabilities || {}),
    ...Object.keys(override.capabilities || {}),
  ]);
  for (const capabilityId of capabilityIds) {
    const baseRule = base.capabilities?.[capabilityId];
    const overrideRule = override.capabilities?.[capabilityId];
    capabilities[capabilityId] = overrideRule ? {
      ...(baseRule || {}),
      ...overrideRule,
      networks: { ...(baseRule?.networks || {}), ...(overrideRule.networks || {}) },
      limits: { ...(baseRule?.limits || {}), ...(overrideRule.limits || {}) },
    } : clone(baseRule);
  }
  return {
    generalNetworks: Array.isArray(override.generalNetworks)
      ? clone(override.generalNetworks)
      : clone(base.generalNetworks || []),
    capabilities,
  };
}

function sameValue(left, right) {
  return digest(left) === digest(right);
}

function familyVariantGroups(family) {
  return (family?.variants || []).reduce((groups, variant) => {
    const cycle = String(variant.billingCycle || 'unknown');
    if (!groups[cycle]) groups[cycle] = [];
    groups[cycle].push(variant);
    return groups;
  }, {});
}

function chooseSourceVariant(sourceFamily, sourcePolicy, targetVariant) {
  const variants = sourceFamily?.variants || [];
  const sameId = variants.find((variant) => Number(variant.planId) === Number(targetVariant.planId));
  if (sameId) return sameId;

  const sameCycle = variants.filter((variant) => variant.billingCycle === targetVariant.billingCycle);
  if (!sameCycle.length) return null;
  const effective = sameCycle.map((variant) => effectiveVariantPolicy(sourcePolicy, variant.planId));
  if (!effective.every((item) => sameValue(item, effective[0]))) {
    throw new Error(
      `Cannot safely map ${sourceFamily.familyId}/${targetVariant.billingCycle}: `
      + 'development has multiple different settings for that billing cycle.',
    );
  }
  return sameCycle[0];
}

function transferFamilyPolicy(sourceFamily, sourcePolicy, sourceApplication, targetFamily) {
  if (!sourcePolicy) throw new Error(`Development policy is missing family ${sourceFamily.familyId}.`);
  const sourceVariants = sourceFamily.variants || [];
  const effectiveSource = sourceVariants.map((variant) => effectiveVariantPolicy(sourcePolicy, variant.planId));
  const uniform = effectiveSource.length === 0
    || effectiveSource.every((item) => sameValue(item, effectiveSource[0]));
  const allPlanMode = sourceApplication?.mode === 'same_settings_all_plan_ids' || uniform;

  if (allPlanMode) {
    const settings = effectiveSource[0] || {
      generalNetworks: clone(sourcePolicy.generalNetworks || []),
      capabilities: clone(sourcePolicy.capabilities || {}),
    };
    const sourcePlanId = Number(targetFamily.variants?.[0]?.planId);
    return {
      policy: { ...settings, variantOverrides: {} },
      application: Number.isInteger(sourcePlanId) ? {
        ...clone(sourceApplication || {}),
        mode: 'same_settings_all_plan_ids',
        sourcePlanId,
        sourceStatus: sourceApplication?.sourceStatus || 'recovered_uniform',
      } : null,
      mapping: 'same-settings-all-target-plan-ids',
    };
  }

  const basePolicy = {
    generalNetworks: clone(sourcePolicy.generalNetworks || []),
    capabilities: clone(sourcePolicy.capabilities || {}),
    variantOverrides: {},
  };
  const baseEffective = effectiveVariantPolicy(basePolicy, null);
  for (const targetVariant of targetFamily.variants || []) {
    const sourceVariant = chooseSourceVariant(sourceFamily, sourcePolicy, targetVariant);
    if (!sourceVariant) continue;
    const effective = effectiveVariantPolicy(sourcePolicy, sourceVariant.planId);
    if (!sameValue(effective, baseEffective)) {
      basePolicy.variantOverrides[String(targetVariant.planId)] = effective;
    }
  }
  return { policy: basePolicy, application: null, mapping: 'billing-cycle-aware-overrides' };
}

function buildTargetSnapshot(sourceBundle, targetSnapshot) {
  const sourceFamilies = new Map(sourceBundle.families.map((family) => [family.familyId, family]));
  const targetFamilies = withConfiguredPlanVariants(targetSnapshot.planFamilies || []);
  const candidate = clone(targetSnapshot);
  candidate.planFamilies = targetFamilies;
  candidate.policies = { ...(candidate.policies || {}) };
  candidate.adminMetadata = clone(candidate.adminMetadata || {});
  candidate.adminMetadata.familyApplications = {
    ...(candidate.adminMetadata.familyApplications || {}),
  };

  const applied = [];
  const productionOnly = [];
  for (const targetFamily of targetFamilies) {
    const sourceFamily = sourceFamilies.get(targetFamily.familyId);
    if (!sourceFamily) {
      productionOnly.push(targetFamily.familyId);
      continue;
    }
    const transferred = transferFamilyPolicy(
      sourceFamily,
      sourceBundle.policies[sourceFamily.familyId],
      sourceBundle.familyApplications?.[sourceFamily.familyId],
      targetFamily,
    );
    candidate.policies[targetFamily.familyId] = transferred.policy;
    if (transferred.application) {
      candidate.adminMetadata.familyApplications[targetFamily.familyId] = transferred.application;
    } else {
      delete candidate.adminMetadata.familyApplications[targetFamily.familyId];
    }
    applied.push({
      familyId: targetFamily.familyId,
      generation: targetFamily.generation,
      targetPlanIds: (targetFamily.variants || []).map((variant) => Number(variant.planId)),
      mapping: transferred.mapping,
    });
  }

  const targetIds = new Set(targetFamilies.map((family) => family.familyId));
  const missingInProduction = sourceBundle.families
    .filter((family) => !targetIds.has(family.familyId))
    .map((family) => family.familyId);
  return { candidate, applied, productionOnly, missingInProduction };
}

function createBundle(version, requestedFamilies) {
  const snapshot = version.snapshot || {};
  const requested = requestedFamilies?.length ? new Set(requestedFamilies) : null;
  const families = (snapshot.planFamilies || []).filter((family) => !requested || requested.has(family.familyId));
  if (!families.length) throw new Error('No matching plan families were found in the active development revision.');
  if (requested) {
    const found = new Set(families.map((family) => family.familyId));
    const missing = [...requested].filter((familyId) => !found.has(familyId));
    if (missing.length) throw new Error(`Unknown development families: ${missing.join(', ')}`);
  }
  const payload = {
    schema: BUNDLE_SCHEMA,
    exportedAt: new Date().toISOString(),
    source: {
      versionId: version.versionId,
      revision: Number(version.revision),
      checksum: version.checksum,
    },
    families: clone(families),
    policies: Object.fromEntries(families.map((family) => [
      family.familyId,
      clone(snapshot.policies?.[family.familyId]),
    ])),
    familyApplications: Object.fromEntries(families
      .filter((family) => snapshot.adminMetadata?.familyApplications?.[family.familyId])
      .map((family) => [
        family.familyId,
        clone(snapshot.adminMetadata.familyApplications[family.familyId]),
      ])),
  };
  return { ...payload, bundleChecksum: digest(payload) };
}

function readBundle(filePath) {
  const bundle = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (bundle.schema !== BUNDLE_SCHEMA) throw new Error(`Unsupported bundle schema: ${bundle.schema || 'missing'}`);
  const { bundleChecksum, ...payload } = bundle;
  if (digest(payload) !== bundleChecksum) throw new Error('Bundle checksum mismatch; the export file was changed or damaged.');
  return bundle;
}

function writeJson(filePath, value) {
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  return resolved;
}

async function exportPolicy(args) {
  if (!args.output) throw new Error('--output is required.');
  const { version } = await readActivePolicyReadOnly();
  const families = args.families ? args.families.split(',').map((item) => item.trim()).filter(Boolean) : null;
  const bundle = createBundle(version, families);
  const output = writeJson(args.output, bundle);
  console.log(JSON.stringify({
    mode: 'export', output, sourceRevision: version.revision, sourceVersionId: version.versionId,
    families: bundle.families.map((family) => family.familyId), bundleChecksum: bundle.bundleChecksum,
  }, null, 2));
}

async function applyPolicy(args) {
  if (!args.input) throw new Error('--input is required.');
  if (args.expectedCurrentRevision === undefined) throw new Error('--expected-current-revision is required.');
  const expectedRevision = Number(args.expectedCurrentRevision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error('--expected-current-revision must be a non-negative integer.');
  }
  if (args.publish && !String(args.reason || '').trim()) throw new Error('--reason is required with --publish.');

  const bundle = readBundle(path.resolve(args.input));
  const { version: active, pointer } = await readActivePolicyReadOnly();
  if (Number(active.revision) !== expectedRevision) {
    throw new Error(
      `Production revision guard failed: expected ${expectedRevision}, active is ${active.revision}. Nothing was changed.`,
    );
  }
  const built = buildTargetSnapshot(bundle, active.snapshot);
  const validation = validateSnapshot(built.candidate);
  const changes = diffSnapshots(active.snapshot, built.candidate);
  const report = {
    mode: args.publish ? 'publish' : 'dry-run',
    sourceRevision: bundle.source.revision,
    productionRevisionBefore: Number(active.revision),
    productionRevisionAfter: Number(active.revision) + 1,
    productionVersionBefore: active.versionId,
    beforeChecksum: active.checksum,
    candidateChecksum: checksumSnapshot(built.candidate),
    valid: validation.valid,
    errors: validation.errors,
    warnings: validation.warnings,
    appliedFamilies: built.applied,
    productionOnlyFamiliesPreserved: built.productionOnly,
    developmentOnlyFamiliesSkipped: built.missingInProduction,
    changedFields: changes.length,
    changes,
  };
  console.log(JSON.stringify(report, null, 2));
  if (!validation.valid) throw new Error('Candidate policy failed validation. Nothing was changed.');
  if (!args.publish) {
    console.log('\nDRY RUN ONLY: no database records were written. Re-run with --publish and --reason after reviewing this diff.');
    return;
  }
  if (!changes.length) throw new Error('Development settings already match production; refusing to create an empty revision.');
  if (!pointer?.versionId) {
    throw new Error('Production has no atomic active-policy pointer; refusing to publish. Run the normal Plan Control migration first.');
  }

  const backupDir = path.resolve(args.backupDir || './plan-policy-backups');
  const backupPath = writeJson(path.join(
    backupDir,
    `production-before-revision-${active.revision}-${Date.now()}.json`,
  ), active);
  const draftId = `environment-sync-${Date.now()}-${crypto.randomUUID()}`;
  const actor = { username: 'script:sync-plan-policy-environments' };
  const saved = await saveDraft({
    draftId,
    baseVersionId: active.versionId,
    baseRevision: Number(active.revision),
    snapshot: built.candidate,
  }, 0, actor);
  if (!saved.success) throw new Error(`Unable to create protected publish draft: ${JSON.stringify(saved)}`);
  const published = await publishDraft(draftId, {
    expectedBaseRevision: Number(active.revision),
    expectedDraftRevision: Number(saved.draft.draftRevision),
    reason: String(args.reason).trim(),
  }, actor);
  if (!published.success) throw new Error(`Publish was rejected: ${JSON.stringify(published)}`);
  console.log(JSON.stringify({ success: true, backupPath, ...published }, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === 'export') await exportPolicy(args);
  else if (args.command === 'apply') await applyPolicy(args);
  else throw new Error(usage());
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
  }).finally(() => closeDB().catch(() => {}));
}

module.exports = {
  createBundle,
  effectiveVariantPolicy,
  transferFamilyPolicy,
  buildTargetSnapshot,
};
