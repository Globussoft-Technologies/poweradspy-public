'use strict';

const logger = require('../../logger');
const { getDB } = require('../sdui/db');
const { evaluateEntitlement } = require('./engine/evaluator');
const { resolvePlanIdentity } = require('./engine/planIdentityResolver');
const { invalidateConfigCache } = require('../planAccess/planAccessService');

const log = logger.createChild('plan-control-legacy-sync');
const COLLECTION = 'plan_access_config';

// Keep the publish-time sync explicit and easy to extend.
// Each entry links a plan-control capability to the legacy row that still needs
// to mirror its allowed_plan_ids for backward compatibility.
const LEGACY_PLAN_ACCESS_SYNC_RULES = [
  {
    capabilityId: 'legacy.ai_metadata_filters',
    legacyDocId: 'ai_meta',
    seed: {
      label: 'AI SIGNALS',
      category: 'sidebar',
      needs_review: true,
    },
  },
];

function normalizeSnapshot(policySource) {
  return policySource?.snapshot || policySource || {};
}

function collectPlanIds(snapshot) {
  const planIds = new Set();

  for (const family of snapshot.planFamilies || []) {
    for (const variant of family.variants || []) {
      const planId = Number(variant.planId);
      if (Number.isInteger(planId) && planId > 0) planIds.add(planId);
    }

    for (const variantId of Object.keys(family.variantOverrides || {})) {
      const planId = Number(variantId);
      if (Number.isInteger(planId) && planId > 0) planIds.add(planId);
    }
  }

  return [...planIds].sort((a, b) => a - b);
}

async function collectAllowedPlanIds(capabilityId, snapshot) {
  const allowedPlanIds = [];

  for (const planId of collectPlanIds(snapshot)) {
    const planIdentity = resolvePlanIdentity(planId, snapshot);
    if (!planIdentity) continue;

    const decision = evaluateEntitlement({
      user: {},
      planIdentity,
      capabilityId,
      requestedNetworks: [],
      policySnapshot: snapshot,
    });

    if (decision.allowed) allowedPlanIds.push(planId);
  }

  return [...new Set(allowedPlanIds)].sort((a, b) => a - b);
}

async function syncLegacyPlanAccessFromPolicy(policySource) {
  const snapshot = normalizeSnapshot(policySource);
  if (!snapshot || !Array.isArray(snapshot.planFamilies)) {
    return { success: false, skipped: true, reason: 'NO_POLICY_SNAPSHOT' };
  }

  const db = await getDB();
  const collection = db.collection(COLLECTION);
  const synced = [];
  const timestamp = new Date().toISOString();

  for (const rule of LEGACY_PLAN_ACCESS_SYNC_RULES) {
    try {
      const existing = await collection.findOne({ _id: rule.legacyDocId });
      if (!existing) {
        log.warn('Legacy plan-access row missing; skipping sync instead of creating a partial document', {
          legacyDocId: rule.legacyDocId,
          capabilityId: rule.capabilityId,
        });
        synced.push({
          legacyDocId: rule.legacyDocId,
          capabilityId: rule.capabilityId,
          skipped: true,
          reason: 'MISSING_LEGACY_ROW',
        });
        continue;
      }

      const allowedPlanIds = await collectAllowedPlanIds(rule.capabilityId, snapshot);
      await collection.updateOne(
        { _id: rule.legacyDocId },
        {
          $set: {
            allowed_plan_ids: allowedPlanIds,
            updated_at: timestamp,
          },
        },
        { upsert: false },
      );

      synced.push({
        legacyDocId: rule.legacyDocId,
        capabilityId: rule.capabilityId,
        allowedPlanIds,
      });
    } catch (error) {
      // Keep publishing resilient: runtime policy activation already succeeded,
      // so a sync failure should be logged for follow-up instead of blocking.
      log.warn('Failed to sync legacy plan-access row after plan publish', {
        legacyDocId: rule.legacyDocId,
        capabilityId: rule.capabilityId,
        error: error.message,
      });
    }
  }

  invalidateConfigCache();
  return { success: true, synced };
}

module.exports = {
  syncLegacyPlanAccessFromPolicy,
  LEGACY_PLAN_ACCESS_SYNC_RULES,
};
