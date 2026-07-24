'use strict';

const crypto = require('crypto');
const { EventEmitter } = require('events');
const { getDB } = require('../../../services/sdui/db');
const logger = require('../../../logger');
const config = require('../../../config');
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

async function collections() {
  const db = await getDB();
  if (!indexesReady) {
    await Promise.all([
      db.collection(COLLECTION_VERSIONS).createIndex({ versionId: 1 }, { unique: true }),
      db.collection(COLLECTION_VERSIONS).createIndex({ revision: -1 }),
      db.collection(COLLECTION_DRAFTS).createIndex({ draftId: 1 }, { unique: true }),
    ]);
    indexesReady = true;
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
      if (pointed && checksumSnapshot(pointed.snapshot) === pointed.checksum) policy = pointed;
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
  policyCache = { value: version, loadedAt: Date.now() };
  policyEvents.emit('published', { versionId, revision });
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
    .limit(Math.min(Math.max(Number(limit) || 20, 1), 100))
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
