'use strict';

const express = require('express');
const { adminAuthMiddleware, requireEditorRole } = require('../../../admin/adminAuth');
const {
  getLatestPolicy,
  getDraft,
  saveDraft,
  deleteDraft,
  publishDraft,
  listVersions,
  listDrafts,
  getPolicyVersion,
  createRestoreDraft,
} = require('../storage/storage');
const {
  getCapabilities,
  getCapability,
  getChildCapabilities,
} = require('../registries/capabilityRegistry');
const { getAllActiveNetworks } = require('../registries/networkRegistry');
const { GENERATIONS, getPlanFamilies } = require('../engine/planFamilies');
const { resolvePlanIdentity } = require('../engine/planIdentityResolver');
const { evaluateEntitlement } = require('../engine/evaluator');
const { validateSnapshot, diffSnapshots } = require('../engine/policyValidation');
const { getDB } = require('../../sdui/db');
const { convertLegacyDocs } = require('../migration/legacyMigration');

const router = typeof express.Router === 'function'
  ? express.Router()
  : { use() { return this; }, get() { return this; }, post() { return this; }, patch() { return this; }, delete() { return this; } };
router.use(adminAuthMiddleware);

function actor(req) {
  return req.adminSession;
}

function writeGuard(req, res, next) {
  if (req.get('x-admin-action') !== 'plan-control') {
    return res.status(403).json({ success: false, message: 'Missing plan-control action header.' });
  }
  return requireEditorRole(req, res, next);
}

function validId(value) {
  return /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(String(value || ''));
}

function bootstrapSnapshot() {
  const planFamilies = getPlanFamilies();
  const capabilities = getCapabilities();
  const policies = {};
  for (const family of planFamilies) {
    policies[family.familyId] = {
      generalNetworks: [],
      capabilities: Object.fromEntries(capabilities.map((capability) => [
        capability.id,
        {
          effect: capability.defaultPolicy === 'allow' ? 'allow' : 'deny',
          reviewed: capability.status !== 'needs_review',
          networks: {
            mode: capability.networkAware ? 'inherit_general' : 'not_applicable',
          },
        },
      ])),
      variantOverrides: {},
    };
  }
  return {
    generations: GENERATIONS.map((generation) => ({ ...generation })),
    planFamilies: planFamilies.map((family) => ({
      ...family,
      variants: (family.variants || []).map((variant) => ({ ...variant, verified: true })),
    })),
    policies,
    capabilityCatalogRevision: 1,
  };
}

async function readablePolicySource() {
  const active = await getLatestPolicy();
  if (active?.snapshot) {
    return {
      snapshot: active.snapshot,
      active,
      source: 'live_policy',
      storage: {
        kind: 'mongodb',
        collection: 'plan_policy_versions',
        recordId: active.versionId,
        readOnly: true,
      },
    };
  }

  const db = await getDB();
  const legacyDocs = await db.collection('plan_access_config').find({}).toArray();
  if (legacyDocs.length) {
    const converted = convertLegacyDocs(legacyDocs);
    return {
      snapshot: converted.snapshot,
      active: null,
      source: 'legacy_config_preview',
      storage: {
        kind: 'mongodb',
        collection: 'plan_access_config',
        recordId: 'converted-read-only-preview',
        readOnly: true,
      },
      warnings: converted.warnings,
    };
  }

  return {
    snapshot: bootstrapSnapshot(),
    active: null,
    source: 'bootstrap_preview',
    storage: {
      kind: 'generated',
      collection: null,
      recordId: null,
      readOnly: true,
    },
  };
}

function capabilityPreview(capability) {
  if (!capability) return null;
  return {
    ...capability,
    frontend: {
      route: capability.frontend?.route || null,
      location: capability.frontend?.location || 'Backend only',
      controls: (capability.frontend?.controls || capability.frontend?.controlIds || []).map((control) => (
        typeof control === 'string' ? { id: control, label: control.replaceAll('_', ' '), type: 'control' } : control
      )),
      preview: capability.frontend?.preview || {
        type: capability.frontend?.previewMode || 'structured',
        renderer: capability.frontend?.previewRenderer || null,
      },
    },
    impact: {
      routes: (capability.routes || []).map((route) => `${route.method} ${route.path}`),
      requestConditions: (capability.routes || []).map((route) => route.condition).filter(Boolean),
      lockedBehavior: capability.lockedExperience?.behavior || 'blocked',
      message: capability.lockedExperience?.message || 'This action is not available on the selected plan.',
    },
    children: getChildCapabilities(capability.id).map((child) => ({
      id: child.id,
      label: child.label,
    })),
    metadataComplete: Boolean(
      capability.label &&
      capability.description &&
      capability.owner &&
      capability.routes?.length &&
      capability.lockedExperience &&
      (capability.frontend?.location || capability.backendOnly)
    ),
  };
}

router.get('/catalog', (_req, res) => {
  const capabilities = getCapabilities().map(capabilityPreview);
  res.json({
    success: true,
    data: {
      capabilities,
      networks: getAllActiveNetworks(),
      categories: [...new Set(capabilities.map((capability) => capability.category))],
    },
  });
});

router.get('/families', async (_req, res) => {
  try {
    const policySource = await readablePolicySource();
    const { active, snapshot } = policySource;
    res.json({
      success: true,
      data: {
        generations: snapshot.generations || GENERATIONS,
        families: snapshot.planFamilies || getPlanFamilies(),
        snapshot,
        source: policySource.source,
        storage: policySource.storage,
        warnings: policySource.warnings || [],
        policyVersion: active?.versionId || null,
        revision: active?.revision || 0,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/families/:familyId', async (req, res) => {
  try {
    const { active, snapshot, source, storage } = await readablePolicySource();
    const family = (snapshot.planFamilies || []).find((item) => item.familyId === req.params.familyId);
    if (!family) return res.status(404).json({ success: false, message: 'Plan family not found.' });
    return res.json({
      success: true,
      data: {
        family,
        policy: snapshot.policies?.[family.familyId] || null,
        policyVersion: active?.versionId || null,
        source,
        storage,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/versions', async (req, res) => {
  try {
    res.json({ success: true, data: await listVersions(req.query.limit) });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/versions/active', async (_req, res) => {
  try {
    res.json({ success: true, data: await getLatestPolicy() });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/versions/:versionId', async (req, res) => {
  try {
    const version = await getPolicyVersion(req.params.versionId);
    if (!version) return res.status(404).json({ success: false, message: 'Policy version not found.' });
    return res.json({ success: true, data: version });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/drafts', async (_req, res) => {
  try {
    res.json({ success: true, data: await listDrafts() });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/drafts/:draftId', async (req, res) => {
  try {
    const draft = await getDraft(req.params.draftId);
    if (!draft) return res.status(404).json({ success: false, message: 'Draft not found.' });
    return res.json({ success: true, data: draft });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/drafts', writeGuard, async (req, res) => {
  try {
    const draftId = String(req.body?.draftId || '').trim();
    if (!validId(draftId)) {
      return res.status(400).json({ success: false, message: 'Draft ID format is invalid.' });
    }
    const policySource = await readablePolicySource();
    const active = policySource.active;
    const snapshot = req.body?.snapshot || policySource.snapshot;
    const result = await saveDraft({
      draftId,
      baseVersionId: active?.versionId || null,
      baseRevision: active?.revision || 0,
      snapshot,
    }, 0, actor(req));
    if (!result.success) return res.status(409).json(result);
    return res.status(201).json(result);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.patch('/drafts/:draftId', writeGuard, async (req, res) => {
  try {
    const existing = await getDraft(req.params.draftId);
    if (!existing) return res.status(404).json({ success: false, message: 'Draft not found.' });
    const result = await saveDraft({
      ...existing,
      draftId: req.params.draftId,
      snapshot: req.body?.snapshot,
    }, req.body?.expectedDraftRevision, actor(req));
    if (!result.success) return res.status(409).json(result);
    return res.json(result);
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.delete('/drafts/:draftId', writeGuard, async (req, res) => {
  try {
    const existing = await getDraft(req.params.draftId);
    if (!existing) return res.status(404).json({ success: false, message: 'Draft not found.' });
    const expectedDraftRevision = Number(req.body?.expectedDraftRevision);
    if (!Number.isInteger(expectedDraftRevision) || expectedDraftRevision !== Number(existing.draftRevision)) {
      return res.status(409).json({
        success: false,
        conflict: 'DRAFT_CHANGED',
        latestDraftRevision: existing.draftRevision,
        message: 'This draft changed in another tab. Reload before deleting it.',
      });
    }
    const deleted = await deleteDraft(req.params.draftId, expectedDraftRevision);
    if (!deleted) {
      return res.status(409).json({
        success: false,
        conflict: 'DRAFT_CHANGED',
        message: 'This draft changed while it was being deleted.',
      });
    }
    return res.json({ success: true, data: { draftId: req.params.draftId } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/drafts/:draftId/validate', adminAuthMiddleware, async (req, res) => {
  try {
    const draft = await getDraft(req.params.draftId);
    if (!draft) return res.status(404).json({ success: false, message: 'Draft not found.' });
    const active = await getLatestPolicy();
    return res.json({
      success: true,
      data: {
        ...validateSnapshot(draft.snapshot),
        diff: diffSnapshots(active?.snapshot || {}, draft.snapshot),
        activeRevision: active?.revision || 0,
        draftRevision: draft.draftRevision,
        staleBase: Number(draft.baseRevision) !== Number(active?.revision || 0),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/drafts/:draftId/preview', async (req, res) => {
  try {
    const draft = await getDraft(req.params.draftId);
    if (!draft) return res.status(404).json({ success: false, message: 'Draft not found.' });
    const capability = getCapability(req.body?.capabilityId);
    if (!capability) return res.status(404).json({ success: false, message: 'Capability not found.' });
    const active = await getLatestPolicy();
    const planId = Number(req.body?.planId);
    const draftIdentity = resolvePlanIdentity(planId, draft.snapshot);
    const activeIdentity = resolvePlanIdentity(planId, active);
    const requestedNetworks = req.body?.network ? [req.body.network] : [];
    return res.json({
      success: true,
      data: {
        capability: capabilityPreview(capability),
        selected: {
          familyId: req.body?.familyId || draftIdentity?.familyId || null,
          planId: Number.isInteger(planId) ? planId : null,
          network: req.body?.network || null,
        },
        before: evaluateEntitlement({
          user: {},
          planIdentity: activeIdentity,
          capabilityId: capability.id,
          requestedNetworks,
          policySnapshot: active,
        }),
        after: evaluateEntitlement({
          user: {},
          planIdentity: draftIdentity,
          capabilityId: capability.id,
          requestedNetworks,
          policySnapshot: draft.snapshot,
        }),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/drafts/:draftId/publish', writeGuard, async (req, res) => {
  try {
    const result = await publishDraft(req.params.draftId, {
      expectedBaseRevision: req.body?.expectedBaseRevision,
      expectedDraftRevision: req.body?.expectedDraftRevision,
      reason: req.body?.reason,
    }, actor(req));
    if (!result.success) {
      return res.status(result.validation ? 422 : 409).json(result);
    }
    return res.json(result);
  } catch (error) {
    if (error.message === 'Draft not found') return res.status(404).json({ success: false, message: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post('/versions/:versionId/restore-draft', writeGuard, async (req, res) => {
  try {
    const draftId = String(req.body?.draftId || `restore-${Date.now()}`).trim();
    if (!validId(draftId)) return res.status(400).json({ success: false, message: 'Draft ID format is invalid.' });
    const result = await createRestoreDraft(req.params.versionId, draftId, actor(req));
    if (!result.success) return res.status(409).json(result);
    return res.status(201).json(result);
  } catch (error) {
    if (error.message === 'Policy version not found') return res.status(404).json({ success: false, message: error.message });
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.get('/capabilities/:capabilityId/preview', (req, res) => {
  const capability = capabilityPreview(getCapability(req.params.capabilityId));
  if (!capability) return res.status(404).json({ success: false, message: 'Capability not found.' });
  return res.json({ success: true, data: capability });
});

router.get('/coverage', async (_req, res) => {
  try {
    const capabilities = getCapabilities();
    const incomplete = capabilities.filter((capability) => !capabilityPreview(capability).metadataComplete);
    const active = await getLatestPolicy();
    const draftRows = await listDrafts();
    const latestDraft = draftRows[0] ? await getDraft(draftRows[0].draftId) : null;
    // Prefer an editable draft when one exists so the global Review button has
    // a real target. Otherwise report review work from the live policy.
    const source = latestDraft || active;
    const snapshot = source?.snapshot || bootstrapSnapshot();
    const reviewItems = [];
    for (const capability of capabilities.filter((item) => item.status === 'needs_review')) {
      for (const family of snapshot.planFamilies || []) {
        const rule = snapshot.policies?.[family.familyId]?.capabilities?.[capability.id];
        if (rule?.reviewed === true) continue;
        reviewItems.push({
          capabilityId: capability.id,
          capabilityLabel: capability.label,
          familyId: family.familyId,
          familyLabel: family.adminLabel || family.label,
          generationId: family.generation,
          draftId: latestDraft?.draftId || null,
        });
      }
    }
    res.json({
      success: true,
      data: {
        totalCapabilities: capabilities.length,
        activeCapabilities: capabilities.filter((capability) => capability.status === 'active').length,
        needsReview: [...new Set(reviewItems.map((item) => item.capabilityId))],
        reviewItems,
        reviewSource: latestDraft ? 'draft' : active ? 'active' : 'bootstrap',
        incompletePreview: incomplete.map((capability) => capability.id),
        coveragePercent: capabilities.length
          ? Math.round(((capabilities.length - incomplete.length) / capabilities.length) * 100)
          : 100,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
