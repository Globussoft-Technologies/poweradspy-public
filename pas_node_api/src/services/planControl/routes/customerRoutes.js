'use strict';

/**
 * Plan Control Customer API Routes
 * Mounted at: /api/v1/auth
 */

const express = require('express');
const config = require('../../../config');
const { authMiddleware } = require('../../../middleware/auth');
const { getLatestPolicy } = require('../storage/storage');
const { evaluateAllCapabilities } = require('../engine/evaluator');
const { resolvePlanIdentity } = require('../engine/planIdentityResolver');
const { getCapabilities } = require('../registries/capabilityRegistry');
const { withDefaultPlanNetworks } = require('../registries/networkRegistry');

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

    const planId = user.userSubscriptionType || user.plan_id;

    // Custom plans are an aMember invoice/JWT runtime entitlement. They can
    // still be evaluated when this installation has no published Plan Control
    // snapshot; regular plans remain fail-closed in that situation.
    const policySnapshot = await getLatestPolicy();
    const planIdentity = resolvePlanIdentity(planId, policySnapshot || undefined);
    if (!policySnapshot && planIdentity?.status !== 'custom') {
      return res.status(503).json({
        code: 503,
        message: 'Entitlement policy is not available.',
        reasonCode: 'POLICY_UNAVAILABLE',
      });
    }

    // Get all registered capability IDs
    const capabilityIds = getCapabilities().map(c => c.id);

    // Evaluate all capabilities
    const evaluations = evaluateAllCapabilities({
      user,
      planIdentity,
      capabilityIds,
      policySnapshot,
    });
    const customInvoiceNetworks = planIdentity?.status === 'custom'
      ? Object.entries(user.platformAccess || {})
        .filter(([, value]) => value === 1 || value === true || String(value) === '1')
        .map(([network]) => String(network).trim().toLowerCase())
        .filter(Boolean)
      : null;

    res.json({
      code: 200,
      data: {
        planId: planIdentity?.planId || planId,
        planFamilyId: planIdentity?.familyId || null,
        planLabel: planIdentity?.label || 'Unknown',
        planStatus: planIdentity?.status || null,
        billingCycle: planIdentity?.billingCycle || null,
        policyVersion: policySnapshot?.versionId || null,
        enforcementMode: config.planControl?.enforcementMode || 'enforce',
        // Since generalNetworks are on the family policy, we extract them from the snapshot
        generalNetworks: customInvoiceNetworks || withDefaultPlanNetworks(
          policySnapshot?.snapshot?.policies?.[planIdentity?.familyId]?.generalNetworks || []
        ),
        capabilities: evaluations,
      },
    });
  } catch (error) {
    res.status(500).json({ code: 500, message: error.message });
  }
});

module.exports = router;
