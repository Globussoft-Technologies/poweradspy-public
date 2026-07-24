'use strict';

/**
 * Plan Control Customer API Routes
 * Mounted at: /api/v1/auth
 */

const express = require('express');
const { authMiddleware } = require('../../../middleware/auth');
const { getLatestPolicy } = require('../storage/storage');
const { evaluateAllCapabilities } = require('../engine/evaluator');
const { resolvePlanIdentity } = require('../engine/planIdentityResolver');
const { getCapabilities } = require('../registries/capabilityRegistry');

const router = typeof express.Router === 'function'
  ? express.Router()
  : { get() { return this; } };

/**
 * GET /api/v1/auth/entitlements
 * Returns the evaluated capabilities and network access for the current user.
 */
router.get('/entitlements', authMiddleware, async (req, res) => {
  try {
    const user = req.user;
    if (!user) {
      return res.status(401).json({ code: 401, message: 'Unauthorized' });
    }

    // Fetch the active policy snapshot
    const policySnapshot = await getLatestPolicy();
    if (!policySnapshot) {
      return res.status(503).json({
        code: 503,
        message: 'Entitlement policy is not available.',
        reasonCode: 'POLICY_UNAVAILABLE',
      });
    }
    const planId = user.userSubscriptionType || user.plan_id;
    const planIdentity = resolvePlanIdentity(planId, policySnapshot);

    // Get all registered capability IDs
    const capabilityIds = getCapabilities().map(c => c.id);

    // Evaluate all capabilities
    const evaluations = evaluateAllCapabilities({
      user,
      planIdentity,
      capabilityIds,
      policySnapshot,
    });

    res.json({
      code: 200,
      data: {
        planId: planIdentity?.planId || planId,
        planFamilyId: planIdentity?.familyId || null,
        planLabel: planIdentity?.label || 'Unknown',
        billingCycle: planIdentity?.billingCycle || null,
        policyVersion: policySnapshot?.versionId || null,
        // Since generalNetworks are on the family policy, we extract them from the snapshot
        generalNetworks: policySnapshot?.snapshot?.policies?.[planIdentity?.familyId]?.generalNetworks || [],
        capabilities: evaluations,
      },
    });
  } catch (error) {
    res.status(500).json({ code: 500, message: error.message });
  }
});

module.exports = router;
