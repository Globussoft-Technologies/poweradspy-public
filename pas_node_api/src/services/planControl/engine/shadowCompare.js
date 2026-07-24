'use strict';

/**
 * Shadow Compare — middleware that runs the new evaluator alongside the
 * existing planAccessMiddleware and logs any decision mismatch.
 *
 * DOES NOT change the response — purely diagnostic.
 *
 * See docs/PLAN_CONTROL_REVAMP_PLAN.md §16 Phase 2.
 *
 * Enable via config:
 *   planControl.shadowMode = true   (in config.json)
 *   PLAN_CONTROL_SHADOW_MODE=true   (env)
 *
 * This middleware should be added AFTER the existing planAccessMiddleware
 * so it can read req.planAccess (old system's decision) and compare with
 * the new evaluator's decision.
 */

const config = require('../../../config');
const logger = require('../../../logger');
const { evaluateEntitlement } = require('./evaluator');
const { resolvePlanIdentity } = require('./planIdentityResolver');
const { isRegisteredCapability, resolveFromLegacyFilter } = require('../registries/capabilityRegistry');

const log = logger.createChild('plan-control-shadow');

/** Counter for rate-limiting log output */
let _logCounter = 0;
const LOG_EVERY_N = 100; // Log 1 in every N requests to avoid noise

/**
 * Shadow comparison middleware.
 *
 * Must run AFTER planAccessMiddleware (reads req.planAccess).
 *
 * Compares the existing system's decision (from req.planAccess) with the
 * new evaluator's decision and logs any differences.
 *
 * @param {Object} policySnapshot - The active policy snapshot (loaded once)
 * @returns {Function} Express middleware
 */
function createShadowCompareMiddleware(policySnapshot) {
  return async function shadowCompareMiddleware(req, _res, next) {
    // Only run when shadow mode is enabled
    if (!config.planControl?.shadowMode) return next();
    if (!req.planAccess) return next();

    try {
      const planId = req.planAccess.planId;
      const planIdentity = resolvePlanIdentity(planId);
      const capInfo = req._planControlCapability;

      if (!planIdentity || !capInfo) {
        // No capability binding on this route — skip
        return next();
      }

      const decision = evaluateEntitlement({
        user: req.user,
        planIdentity,
        capabilityId: capInfo.capabilityId,
        requestedNetworks: capInfo.networks || [],
        policySnapshot,
      });

      // Compare with old system
      // The old system doesn't have a single "allowed" boolean per capability,
      // so we infer from the planAccess object:
      const oldAllowed = req.planAccess.allowedPlatforms?.length > 0;
      const newAllowed = decision.allowed;

      _logCounter++;

      if (oldAllowed !== newAllowed) {
        // MISMATCH — always log
        log.warn('shadow-mismatch', {
          planId,
          capabilityId: capInfo.capabilityId,
          networks: capInfo.networks,
          oldAllowed,
          newAllowed,
          newReasonCode: decision.reasonCode,
          familyId: decision.planFamilyId,
          policyVersion: decision.policyVersion,
          path: req.path,
          userId: req.user?.id,
        });
      } else if (_logCounter % LOG_EVERY_N === 0) {
        // MATCH — periodic sample log
        log.debug('shadow-match', {
          planId,
          capabilityId: capInfo.capabilityId,
          allowed: newAllowed,
          sampleNumber: _logCounter,
        });
      }
    } catch (err) {
      // Shadow compare must NEVER break the request
      log.error('shadow-compare-error', { error: err.message });
    }

    next();
  };
}

module.exports = { createShadowCompareMiddleware };
