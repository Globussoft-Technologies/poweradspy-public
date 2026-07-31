'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { getDB } = require('../../../services/sdui/db');
const logger = require('../../../logger');
const config = require('../../../config');
const { syncLegacyPlanAccessFromPolicy } = require('../legacyPlanAccessSync');
const {
  checksumSnapshot,
  diffSnapshots,
  validateSnapshot,
} = require('../engine/policyValidation');

const log = logger.createChild('plan-control-storage');
const COLLECTION_VERSIONS = 'plan_policy_versions';
const COLLECTION_DRAFTS = 'plan_policy_drafts';
const COLLECTION_STATE = 'plan_policy_state';
const ACTIVE_POINTER_ID = 'active';
const MAX_POLICY_VERSIONS = 20;
const policyEvents = new EventEmitter();
let indexesReady = false;
let policyCache = { value: null, loadedAt: 0 };

function now() {
  return new Date().toISOString();
}

function safeActor(adminSession) {
  return adminSession?.username || adminSession?.email || adminSession?.id || 'system';
}

function draftRevisionOf(draft) {
  return Number(draft?.draftRevision ?? draft?.revision ?? 0) || 0;
}

function normalizedDraft(draft) {
  return draft ? { ...draft, draftRevision: draftRevisionOf(draft) } : null;
}

function effectiveVariantPolicy(policy, planId) {
  const override = policy?.variantOverrides?.[String(planId)] || {};
  const capabilities = {};
  const capabilityIds = new Set([
    ...Object.keys(policy?.capabilities || {}),
    ...Object.keys(override.capabilities || {}),
  ]);
  for (const capabilityId of capabilityIds) {
    const baseRule = policy?.capabilities?.[capabilityId];
    const overrideRule = override.capabilities?.[capabilityId];
    capabilities[capabilityId] = overrideRule ? {
      ...(baseRule || {}),
      ...overrideRule,
      networks: {
        ...(baseRule?.networks || {}),
        ...(overrideRule.networks || {}),
      },
      limits: {
        ...(baseRule?.limits || {}),
        ...(overrideRule.limits || {}),
      },
    } : baseRule;
  }
  return {
    generalNetworks: Array.isArray(override.generalNetworks)
      ? [...override.generalNetworks]
      : [...(policy?.generalNetworks || [])],
    capabilities,
  };
}

function canonicalPolicyValue(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalPolicyValue).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalPolicyValue(value[key])]));
}

function uniformEffectiveFamilyPolicy(family, policy) {
  const variants = family?.variants || [];
  if (variants.length < 2 || !policy) return null;
  const first = effectiveVariantPolicy(policy, variants[0].planId);
  const fingerprint = JSON.stringify(canonicalPolicyValue(first));
  return variants.every((variant) => (
    JSON.stringify(canonicalPolicyValue(effectiveVariantPolicy(policy, variant.planId))) === fingerprint
  )) ? first : null;
}

function recoverUniformFamilyApplications(input) {
  const existingApplications = input?.adminMetadata?.familyApplications || {};
  const recoveredApplications = {};
  let recoveredPolicies = input?.policies;
  for (const family of input?.planFamilies || []) {
    if (existingApplications[family.familyId]) continue;
    const variants = family.variants || [];
    const policy = input?.policies?.[family.familyId];
    const commonPolicy = uniformEffectiveFamilyPolicy(family, policy);
    if (variants.length < 2 || !commonPolicy) continue;
    const referencePlanId = Number(variants[0]?.planId);
    if (!Number.isInteger(referencePlanId)) continue;
    recoveredApplications[family.familyId] = {
      mode: 'same_settings_all_plan_ids',
      sourcePlanId: referencePlanId,
      sourceStatus: 'recovered_uniform',
    };
    if (Object.keys(policy.variantOverrides || {}).length) {
      if (recoveredPolicies === input.policies) recoveredPolicies = { ...(input.policies || {}) };
      recoveredPolicies[family.familyId] = {
        ...policy,
        generalNetworks: commonPolicy.generalNetworks,
        capabilities: commonPolicy.capabilities,
        variantOverrides: {},
      };
    }
  }
  const recoveredFamilyIds = Object.keys(recoveredApplications);
  if (!recoveredFamilyIds.length) return { snapshot: input, recoveredFamilyIds };
  return {
    snapshot: {
      ...input,
      policies: recoveredPolicies,
      adminMetadata: {
        ...(input.adminMetadata || {}),
        familyApplications: {
          ...existingApplications,
          ...recoveredApplications,
        },
      },
    },
    recoveredFamilyIds,
  };
}

function recoverPublishedFamilyApplications(activePolicy) {
  const uniformRecovery = recoverUniformFamilyApplications(activePolicy?.snapshot);
  const snapshot = uniformRecovery.snapshot;
  const normalizedReason = String(activePolicy?.reason || '').trim().toLowerCase();
  if (normalizedReason !== 'all done new & legacy') return uniformRecovery;

  const applications = snapshot?.adminMetadata?.familyApplications || {};
  const changedVariants = new Map();
  for (const change of activePolicy?.diff || []) {
    const match = /^policies\.([^.]+)\.variantOverrides\.([^.]+)(?:\.|$)/.exec(String(change?.path || ''));
    if (!match || !/^\d+$/.test(match[2])) continue;
    const candidates = changedVariants.get(match[1]) || new Set();
    candidates.add(Number(match[2]));
    changedVariants.set(match[1], candidates);
  }

  const recoveredApplications = {};
  const recoveredPolicies = { ...(snapshot?.policies || {}) };
  for (const family of snapshot?.planFamilies || []) {
    if (applications[family.familyId]) continue;
    const candidates = [...(changedVariants.get(family.familyId) || [])]
      .filter((planId) => (family.variants || []).some((variant) => Number(variant.planId) === planId));
    if (candidates.length !== 1) continue;
    const sourcePlanId = candidates[0];
    const policy = snapshot?.policies?.[family.familyId];
    if (!policy) continue;
    const commonPolicy = effectiveVariantPolicy(policy, sourcePlanId);
    recoveredPolicies[family.familyId] = {
      ...policy,
      generalNetworks: commonPolicy.generalNetworks,
      capabilities: commonPolicy.capabilities,
      variantOverrides: {},
    };
    recoveredApplications[family.familyId] = {
      mode: 'same_settings_all_plan_ids',
      sourcePlanId,
      sourceStatus: 'recovered_from_publish_diff',
    };
  }

  const diffRecoveredFamilyIds = Object.keys(recoveredApplications);
  if (!diffRecoveredFamilyIds.length) return uniformRecovery;
  return {
    snapshot: {
      ...snapshot,
      policies: recoveredPolicies,
      adminMetadata: {
        ...(snapshot.adminMetadata || {}),
        familyApplications: {
          ...applications,
          ...recoveredApplications,
        },
      },
    },
    recoveredFamilyIds: [...uniformRecovery.recoveredFamilyIds, ...diffRecoveredFamilyIds],
    diffRecoveredFamilyIds,
  };
}

async function pruneOldPolicyVersions(versions, activeVersionId) {
  const expiredVersions = await versions
    .find({}, { projection: { _id: 1, versionId: 1 } })
    .sort({ revision: -1, createdAt: -1 })
    .skip(MAX_POLICY_VERSIONS)
    .toArray();
  const expiredIds = expiredVersions
    .filter((item) => item.versionId !== activeVersionId)
    .map((item) => item._id);
  if (!expiredIds.length) return 0;
  await versions.deleteMany({ _id: { $in: expiredIds } });
  log.info('Pruned old plan policy history', {
    retained: MAX_POLICY_VERSIONS,
    removed: expiredIds.length,
  });
  return expiredIds.length;
}

async function collections() {
  const db = await getDB();
  if (!indexesReady) {
    const versions = db.collection(COLLECTION_VERSIONS);
    const state = db.collection(COLLECTION_STATE);
    await Promise.all([
      versions.createIndex({ versionId: 1 }, { unique: true }),
      versions.createIndex({ revision: -1 }),
      db.collection(COLLECTION_DRAFTS).createIndex({ draftId: 1 }, { unique: true }),
    ]);
    indexesReady = true;
    try {
      const pointer = await state.findOne({ _id: ACTIVE_POINTER_ID });
      await pruneOldPolicyVersions(versions, pointer?.versionId);
    } catch (error) {
      log.error('Unable to prune old plan policy history during startup', { error: error.message });
    }
  }
  return {
    versions: db.collection(COLLECTION_VERSIONS),
    drafts: db.collection(COLLECTION_DRAFTS),
    state: db.collection(COLLECTION_STATE),
  };
}

async function getActivePointer() {
  const { state } = await collections();
  return state.findOne({ _id: ACTIVE_POINTER_ID });
}

async function getLatestPolicy() {
  const cacheMs = Math.max(Number(config.planControl?.policyCacheMs) || 5000, 250);
  if (policyCache.value && Date.now() - policyCache.loadedAt < cacheMs) return policyCache.value;
  try {
    const { versions } = await collections();
    const pointer = await getActivePointer();
    let policy = null;
    if (pointer?.versionId) {
      const pointed = await versions.findOne({ versionId: pointer.versionId });
      if (pointed && checksumSnapshot(pointed.snapshot) === pointed.checksum) {
        policy = await persistRecoveredFamilyApplications(pointed, pointer, versions);
      }
      else log.error('Active plan policy failed checksum or is missing', { versionId: pointer.versionId });
    } else {
      // Compatibility for installations created before the active pointer existed.
      const legacy = await versions.find({ status: 'active' }).sort({ revision: -1 }).limit(1).next();
      if (legacy && checksumSnapshot(legacy.snapshot) === legacy.checksum) policy = legacy;
    }
    if (policy) policyCache = { value: policy, loadedAt: Date.now() };
    return policy;
  } catch (error) {
    if (policyCache.value) {
      log.warn('Using last-known-good plan policy after storage error', {
        versionId: policyCache.value.versionId,
        error: error.message,
      });
      return policyCache.value;
    }
    throw error;
  }
}

async function persistRecoveredFamilyApplications(activePolicy, pointer, versions) {
  const recovered = recoverPublishedFamilyApplications(activePolicy);
  if (!recovered.recoveredFamilyIds.length) return activePolicy;

  const validation = validateSnapshot(recovered.snapshot);
  if (!validation.valid) {
    log.error('Unable to persist recovered all-plan metadata because validation failed', {
      versionId: activePolicy.versionId,
      errors: validation.errors,
    });
    return activePolicy;
  }

  const revision = Number(pointer.revision) + 1;
  const versionId = `policy_${revision}_${crypto.randomUUID()}`;
  const timestamp = now();
  const recoveredVersion = {
    versionId,
    revision,
    status: 'published',
    sourceDraftId: null,
    basedOnVersionId: activePolicy.versionId,
    schemaVersion: activePolicy.schemaVersion || 1,
    createdAt: timestamp,
    createdBy: { adminId: 'system:family-application-backfill' },
    reason: 'Automatic durable recovery of same-settings-for-all-plan-IDs state',
    checksum: validation.checksum,
    validation: {
      warnings: validation.warnings,
      summary: validation.summary,
    },
    diff: diffSnapshots(activePolicy.snapshot, recovered.snapshot),
    snapshot: recovered.snapshot,
  };

  await versions.insertOne(recoveredVersion);
  const { state } = await collections();
  const activation = await state.updateOne(
    {
      _id: ACTIVE_POINTER_ID,
      versionId: activePolicy.versionId,
      revision: Number(pointer.revision),
    },
    {
      $set: {
        versionId,
        revision,
        checksum: recoveredVersion.checksum,
        updatedAt: timestamp,
        updatedBy: recoveredVersion.createdBy.adminId,
      },
    },
  );
  if (activation.modifiedCount !== 1) {
    await versions.deleteOne({ versionId });
    const currentPointer = await state.findOne({ _id: ACTIVE_POINTER_ID });
    const winner = currentPointer?.versionId
      ? await versions.findOne({ versionId: currentPointer.versionId })
      : null;
    return winner && checksumSnapshot(winner.snapshot) === winner.checksum ? winner : activePolicy;
  }

  try {
    await pruneOldPolicyVersions(versions, versionId);
  } catch (error) {
    log.error('Unable to prune plan policy history after metadata backfill', { error: error.message });
  }
  policyEvents.emit('published', { versionId, revision });
  log.info('Persisted recovered all-plan metadata in a new immutable policy revision', {
    versionId,
    revision,
    families: recovered.recoveredFamilyIds,
  });
  return recoveredVersion;
}

async function getPolicyVersion(versionId) {
  const { versions } = await collections();
  return versions.findOne({ versionId });
}

async function getDraft(draftId) {
  const { drafts } = await collections();
  return normalizedDraft(await drafts.findOne({ draftId }));
}

async function saveDraft(input, expectedDraftRevision = 0, adminSession) {
  const { drafts } = await collections();
  const existing = await drafts.findOne({ draftId: input.draftId });
  const timestamp = now();

  if (!existing) {
    if (Number(expectedDraftRevision) !== 0) {
      return { success: false, conflict: 'DRAFT_CHANGED', latestDraftRevision: 0 };
    }
    const draft = {
      draftId: input.draftId,
      baseVersionId: input.baseVersionId || null,
      baseRevision: Number(input.baseRevision) || 0,
      draftRevision: 1,
      owner: safeActor(adminSession),
      createdAt: timestamp,
      updatedAt: timestamp,
      snapshot: input.snapshot,
    };
    try {
      await drafts.insertOne(draft);
      return { success: true, draft };
    } catch (error) {
      if (error?.code === 11000) {
        const latest = await drafts.findOne({ draftId: input.draftId });
        return { success: false, conflict: 'DRAFT_CHANGED', latestDraftRevision: latest?.draftRevision || 0 };
      }
      throw error;
    }
  }

  const existingRevision = draftRevisionOf(existing);
  if (Number(expectedDraftRevision) !== existingRevision) {
    return {
      success: false,
      conflict: 'DRAFT_CHANGED',
      latestDraftRevision: existingRevision,
      updatedAt: existing.updatedAt,
      owner: existing.owner,
    };
  }

  const revisionFilter = existing.draftRevision === undefined
    ? {
        draftId: input.draftId,
        $or: [
          { draftRevision: { $exists: false }, revision: { $exists: false } },
          { draftRevision: { $exists: false }, revision: existing.revision },
        ],
      }
    : { draftId: input.draftId, draftRevision: existingRevision };
  const result = await drafts.updateOne(
    revisionFilter,
    {
      $set: {
        snapshot: input.snapshot,
        updatedAt: timestamp,
        updatedBy: safeActor(adminSession),
      },
      $inc: { draftRevision: 1 },
    },
  );
  if (result.modifiedCount !== 1) {
    const latest = await drafts.findOne({ draftId: input.draftId });
    return { success: false, conflict: 'DRAFT_CHANGED', latestDraftRevision: latest?.draftRevision || 0 };
  }
  return { success: true, draft: normalizedDraft(await drafts.findOne({ draftId: input.draftId })) };
}

async function deleteDraft(draftId, draftRevision) {
  const { drafts } = await collections();
  const existing = await drafts.findOne({ draftId });
  if (!existing) return false;
  const existingRevision = draftRevisionOf(existing);
  if (draftRevision !== undefined && Number(draftRevision) !== existingRevision) return false;
  const filter = existing.draftRevision === undefined
    ? { _id: existing._id, draftRevision: { $exists: false } }
    : { _id: existing._id, draftRevision: existingRevision };
  const result = await drafts.deleteOne(filter);
  return result.deletedCount === 1;
}

async function publishDraft(draftId, options, adminSession) {
  const { drafts, versions, state } = await collections();
  const draft = await drafts.findOne({ draftId });
  if (!draft) throw new Error('Draft not found');

  const expectedBaseRevision = Number(options.expectedBaseRevision);
  const expectedDraftRevision = Number(options.expectedDraftRevision);
  const currentDraftRevision = draftRevisionOf(draft);
  if (expectedDraftRevision !== currentDraftRevision) {
    return { success: false, conflict: 'DRAFT_CHANGED', latestDraftRevision: currentDraftRevision };
  }
  if (!String(options.reason || '').trim()) {
    return { success: false, validation: { errors: [{ code: 'CHANGE_REASON_REQUIRED', path: 'reason', message: 'A change reason is required.' }] } };
  }

  const validation = validateSnapshot(draft.snapshot);
  if (!validation.valid) return { success: false, validation };

  const pointer = await state.findOne({ _id: ACTIVE_POINTER_ID });
  const legacyLatest = pointer ? null : await getLatestPolicy();
  const latestRevision = Number(pointer?.revision ?? legacyLatest?.revision ?? 0);
  const latestVersionId = pointer?.versionId ?? legacyLatest?.versionId ?? null;
  if (latestRevision !== expectedBaseRevision) {
    return {
      success: false,
      conflict: 'ACTIVE_POLICY_CHANGED',
      latestRevision,
      latestVersionId,
    };
  }

  const previous = latestVersionId ? await versions.findOne({ versionId: latestVersionId }) : null;
  const revision = latestRevision + 1;
  const versionId = `policy_${revision}_${crypto.randomUUID()}`;
  const version = {
    versionId,
    revision,
    status: 'published',
    sourceDraftId: draftId,
    basedOnVersionId: latestVersionId,
    schemaVersion: 1,
    createdAt: now(),
    createdBy: { adminId: safeActor(adminSession) },
    reason: String(options.reason).trim(),
    checksum: validation.checksum,
    validation: {
      warnings: validation.warnings,
      summary: validation.summary,
    },
    diff: diffSnapshots(previous?.snapshot || {}, draft.snapshot),
    snapshot: draft.snapshot,
  };

  await versions.insertOne(version);
  let activation;
  try {
    activation = await state.updateOne(
      { _id: ACTIVE_POINTER_ID, revision: expectedBaseRevision },
      {
        $set: {
          versionId,
          revision,
          checksum: version.checksum,
          updatedAt: version.createdAt,
          updatedBy: version.createdBy.adminId,
        },
      },
      { upsert: !pointer },
    );
  } catch (error) {
    if (error?.code === 11000) activation = { matchedCount: 0, upsertedCount: 0 };
    else throw error;
  }

  if (activation.matchedCount !== 1 && activation.upsertedCount !== 1) {
    await versions.deleteOne({ versionId });
    const current = await state.findOne({ _id: ACTIVE_POINTER_ID });
    return {
      success: false,
      conflict: 'ACTIVE_POLICY_CHANGED',
      latestRevision: current?.revision ?? latestRevision,
      latestVersionId: current?.versionId ?? latestVersionId,
    };
  }

  const publishedDraftFilter = draft.draftRevision === undefined
    ? { draftId, draftRevision: { $exists: false } }
    : { draftId, draftRevision: expectedDraftRevision };
  await drafts.deleteOne(publishedDraftFilter);
  try {
    await pruneOldPolicyVersions(versions, versionId);
  } catch (error) {
    // Publishing is already live at this point. Retention cleanup is retried
    // after the next successful publish instead of reporting a false failure.
    log.error('Unable to prune old plan policy history', { error: error.message });
  }
  policyCache = { value: version, loadedAt: Date.now() };
  policyEvents.emit('published', { versionId, revision });

  // Keep legacy plan_access_config rows in sync for capabilities that still
  // need a backward-compatible Mongo mirror after plan-control publish.
  try {
    await syncLegacyPlanAccessFromPolicy(version.snapshot);
  } catch (error) {
    log.warn('Published policy activated, but legacy plan-access sync failed', {
      versionId,
      revision,
      error: error.message,
    });
  }

  log.info('Policy published', { versionId, revision, actor: version.createdBy.adminId });
  return { success: true, versionId, revision, checksum: version.checksum };
}

async function createRestoreDraft(versionId, draftId, adminSession) {
  const version = await getPolicyVersion(versionId);
  if (!version) throw new Error('Policy version not found');
  const active = await getLatestPolicy();
  return saveDraft({
    draftId,
    baseVersionId: active?.versionId || null,
    baseRevision: active?.revision || 0,
    snapshot: version.snapshot,
  }, 0, adminSession);
}

async function listVersions(limit = 20) {
  const { versions } = await collections();
  const pointer = await getActivePointer();
  const rows = await versions.find({}, { projection: { snapshot: 0 } })
    .sort({ revision: -1, createdAt: -1 })
    .limit(Math.min(Math.max(Number(limit) || MAX_POLICY_VERSIONS, 1), MAX_POLICY_VERSIONS))
    .toArray();
  return rows.map((row) => ({ ...row, isActive: row.versionId === pointer?.versionId }));
}

async function listDrafts() {
  const { drafts } = await collections();
  const rows = await drafts.find({}, { projection: { snapshot: 0 } }).sort({ updatedAt: -1 }).toArray();
  return rows.map(normalizedDraft);
}

module.exports = {
  policyEvents,
  recoverUniformFamilyApplications,
  recoverPublishedFamilyApplications,
  getActivePointer,
  getLatestPolicy,
  getPolicyVersion,
  getDraft,
  saveDraft,
  deleteDraft,
  publishDraft,
  createRestoreDraft,
  listVersions,
  listDrafts,
};
