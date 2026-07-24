'use strict';

/**
 * Entitlement Evaluator — the single decision engine for plan control.
 *
 * This is a PURE function (no DB calls, no side effects) wherever possible.
 * It receives all context as arguments and returns a standard decision object.
 *
 * See docs/PLAN_CONTROL_REVAMP_PLAN.md §8 — Entitlement decision engine.
 *
 * Decision priority (§8):
 *   1. Missing or invalid user subscription identity → deny
 *   2. Globally disabled capability → deny
 *   3. Soft-deleted plan → deny
 *   4. User-specific custom invoice/JWT explicit network denial → deny
 *   5. Variant-specific explicit deny → deny
 *   6. Family capability deny → deny
 *   7. Requested network not permitted for the capability → deny
 *   8. Quota exhausted → deny
 *   9. Explicit/inherited allow → allow
 */

const {
  MISSING_IDENTITY,
  CAPABILITY_DISABLED,
  PLAN_DELETED,
  CUSTOM_INVOICE_DENY,
  VARIANT_DENY,
  CAPABILITY_NOT_IN_PLAN,
  NETWORK_NOT_PERMITTED,
  QUOTA_EXHAUSTED,
  ALLOWED,
  UNKNOWN_CAPABILITY,
  NEEDS_REVIEW,
  ALLOWED_PENDING_REVIEW,
  isDenial,
  shouldShowSubscriptionModal,
} = require('./reasonCodes');

const { isRegisteredCapability, getCapability, getParentCapability } = require('../registries/capabilityRegistry');

/**
 * @typedef {Object} EvaluateInput
 * @property {Object} user                - Authenticated user object
 * @property {Object|null} planIdentity   - Resolved plan identity (from planIdentityResolver)
 * @property {string} capabilityId        - The capability being evaluated
 * @property {string[]} [requestedNetworks] - Networks the request targets
 * @property {string} [action]            - Specific action (for quota capabilities)
 * @property {Object} policySnapshot      - The active policy snapshot
 */

/**
 * @typedef {Object} EntitlementDecision
 * @property {boolean} allowed
 * @property {string} capabilityId
 * @property {string} reasonCode         - One of the standard reason codes
 * @property {string|null} planFamilyId
 * @property {number|null} planId
 * @property {string[]} requestedNetworks
 * @property {string[]} allowedNetworks  - Which networks are permitted (may differ from requested)
 * @property {Object} limits             - Applicable quota limits
 * @property {string|null} policyVersion
 * @property {boolean} showSubscriptionModal
 */

/**
 * Build a standard decision result object.
 * @param {boolean} allowed
 * @param {string} reasonCode
 * @param {Object} context
 * @returns {EntitlementDecision}
 */
function makeDecision(allowed, reasonCode, context = {}) {
  return {
    allowed,
    capabilityId: context.capabilityId || '',
    reasonCode,
    planFamilyId: context.planFamilyId || null,
    planId: context.planId || null,
    requestedNetworks: context.requestedNetworks || [],
    allowedNetworks: context.allowedNetworks || [],
    limits: context.limits || {},
    policyVersion: context.policyVersion || null,
    showSubscriptionModal: shouldShowSubscriptionModal(reasonCode),
  };
}

/**
 * Evaluate entitlement — the core decision function.
 *
 * @param {EvaluateInput} input
 * @returns {EntitlementDecision}
 */
function evaluateEntitlement(input) {
  const {
    user,
    planIdentity,
    capabilityId,
    requestedNetworks = [],
    action,
    policySnapshot,
  } = input;

  const snapshot = policySnapshot?.snapshot || policySnapshot || {};
  const policyVersion = policySnapshot?.versionId || snapshot.versionId || null;
  const baseContext = {
    capabilityId,
    planId: planIdentity?.planId || user?.plan_id || user?.userSubscriptionType || null,
    planFamilyId: planIdentity?.familyId || null,
    requestedNetworks,
    policyVersion,
  };

  // ── Priority 1: Missing or invalid user subscription identity ─────────
  if (!planIdentity) {
    return makeDecision(false, MISSING_IDENTITY, baseContext);
  }

  baseContext.planId = baseContext.planId || null;
  baseContext.planFamilyId = planIdentity.familyId;

  // ── Check capability exists in registry ───────────────────────────────
  if (!isRegisteredCapability(capabilityId)) {
    return makeDecision(false, UNKNOWN_CAPABILITY, baseContext);
  }

  const capDef = getCapability(capabilityId);
  let grantReason = ALLOWED;

  // ── Priority 2: Globally disabled capability ──────────────────────────
  if (capDef.status === 'disabled') {
    return makeDecision(false, CAPABILITY_DISABLED, baseContext);
  }

  // ── Priority 3: Soft-deleted plan ─────────────────────────────────────
  if (planIdentity.status === 'deleted') {
    return makeDecision(false, PLAN_DELETED, baseContext);
  }

  // ── Check parent capability first (hierarchical deny) ─────────────────
  if (capDef.parentCapability) {
    const parentCap = getParentCapability(capabilityId);
    if (parentCap) {
      const parentDecision = evaluateEntitlement({
        ...input,
        capabilityId: capDef.parentCapability,
      });
      if (!parentDecision.allowed) {
        // Parent denied → child is also denied, keeping parent's reason
        return makeDecision(false, parentDecision.reasonCode, {
          ...baseContext,
          allowedNetworks: parentDecision.allowedNetworks,
          limits: parentDecision.limits,
        });
      }
    }
  }

  // ── Resolve policy for this family + capability ───────────────────────
  const familyPolicy = snapshot?.policies?.[planIdentity.familyId];
  const variantPolicy = familyPolicy?.variantOverrides?.[String(baseContext.planId)] || {};
  const familyCapabilityPolicy = familyPolicy?.capabilities?.[capabilityId];
  const variantCapabilityPolicy = variantPolicy?.capabilities?.[capabilityId];
  const capabilityPolicy = variantCapabilityPolicy
    ? {
      ...(familyCapabilityPolicy || {}),
      ...variantCapabilityPolicy,
      networks: {
        ...(familyCapabilityPolicy?.networks || {}),
        ...(variantCapabilityPolicy.networks || {}),
      },
      limits: {
        ...(familyCapabilityPolicy?.limits || {}),
        ...(variantCapabilityPolicy.limits || {}),
      },
    }
    : familyCapabilityPolicy;

  // ── Priority 4: Custom invoice/JWT explicit denial ────────────────────
  if (planIdentity.status === 'custom' && user?.platformAccess) {
    // Custom plans use JWT platformAccess as a maximum boundary.
    // If the capability is network-aware and the custom invoice denies all
    // requested networks, deny with CUSTOM_INVOICE_DENY.
    if (capDef.networkAware && requestedNetworks.length > 0) {
      const pa = user.platformAccess;
      const paLower = Object.fromEntries(
        Object.entries(pa).map(([k, v]) => [k.toLowerCase(), v])
      );
      const jwtAllowed = requestedNetworks.filter((n) => {
        const key = n.toLowerCase();
        return !(key in paLower) || paLower[key] === 1;
      });
      if (jwtAllowed.length === 0) {
        return makeDecision(false, CUSTOM_INVOICE_DENY, {
          ...baseContext,
          allowedNetworks: [],
        });
      }
    }
  }

  // ── Priority 5: Variant-specific explicit deny ────────────────────────
  if (variantCapabilityPolicy) {
    if (variantCapabilityPolicy.effect === 'deny') {
      return makeDecision(false, VARIANT_DENY, baseContext);
    }
  }

  // ── Priority 6: Family capability deny ────────────────────────────────
  if (capabilityPolicy) {
    if (capabilityPolicy.effect === 'deny') {
      return makeDecision(false, CAPABILITY_NOT_IN_PLAN, baseContext);
    }
  } else if (capDef.status === 'needs_review') {
    // Compatibility-first rollout: a newly registered feature absent from an
    // already-published snapshot remains available while it is visibly queued
    // for admin review. A generation may explicitly choose strict deny.
    const generation = (snapshot.generations || []).find(
      (item) => item.generationId === planIdentity.generation
    );
    if (generation?.newCapabilityDefault === 'deny') {
      return makeDecision(false, NEEDS_REVIEW, baseContext);
    }
    grantReason = ALLOWED_PENDING_REVIEW;
  } else if (capDef.defaultPolicy === 'deny') {
    // No explicit policy and default is deny → deny
    return makeDecision(false, CAPABILITY_NOT_IN_PLAN, baseContext);
  }

  // ── Priority 7: Network access ────────────────────────────────────────
  if (capDef.networkAware) {
    // Determine which networks are allowed for this capability
    let allowedNetworks;

    const networkMode = capabilityPolicy?.networks?.mode || 'inherit_general';

    if (networkMode === 'not_applicable') {
      // Network doesn't apply to this capability
      allowedNetworks = requestedNetworks;
    } else if (networkMode === 'custom') {
      // Per-capability network override
      allowedNetworks = capabilityPolicy?.networks?.allowed || [];
    } else {
      // inherit_general — use the family's general network list
      allowedNetworks = variantPolicy.generalNetworks || familyPolicy?.generalNetworks || [];
    }

    // Intersect with custom plan JWT boundaries if applicable
    if (planIdentity.status === 'custom' && user?.platformAccess) {
      const pa = user.platformAccess;
      const paLower = Object.fromEntries(
        Object.entries(pa).map(([k, v]) => [k.toLowerCase(), v])
      );
      allowedNetworks = allowedNetworks.filter((n) => {
        const key = n.toLowerCase();
        return !(key in paLower) || paLower[key] === 1;
      });
    }

    // A bulk entitlement response still needs the effective network list even
    // when no particular network was requested.
    const allowedSet = new Set(allowedNetworks.map((n) => n.toLowerCase()));
    if (requestedNetworks.length === 0) {
      baseContext.allowedNetworks = [...allowedSet];
    } else {
      // "all" is the frontend/API wildcard meaning "use every network this
      // plan permits". It is not a real network ID and must not be compared
      // literally with facebook/instagram/etc.
      const requestsAll = requestedNetworks.some(
        (n) => String(n).toLowerCase() === 'all'
      );
      const concreteRequestedNetworks = requestedNetworks.filter(
        (n) => String(n).toLowerCase() !== 'all'
      );
      const deniedNetworks = concreteRequestedNetworks.filter(
        (n) => !allowedSet.has(n.toLowerCase())
      );

      if (deniedNetworks.length > 0 || (requestsAll && allowedSet.size === 0)) {
        // At least one requested network is not permitted
        return makeDecision(false, NETWORK_NOT_PERMITTED, {
          ...baseContext,
          allowedNetworks: [...allowedSet],
        });
      }

      baseContext.allowedNetworks = [...allowedSet];
    }
  }

  // ── Priority 8: Quota exhausted ───────────────────────────────────────
  // Note: Quota checks need current usage data which is outside the pure
  // evaluator's scope. The caller must provide quota status.
  // For now, we evaluate limits from policy and return them for the caller.
  const limits = {};
  if (capabilityPolicy?.limits) {
    Object.assign(limits, capabilityPolicy.limits);
  }
  // Also check family-level competitor limits
  if (familyPolicy?.limits) {
    for (const [key, val] of Object.entries(familyPolicy.limits)) {
      if (!(key in limits)) limits[key] = val;
    }
  }

  baseContext.limits = limits;

  // If the caller provided a quotaStatus and it's exhausted, deny
  if (input.quotaStatus && input.quotaStatus.exhausted === true) {
    return makeDecision(false, QUOTA_EXHAUSTED, baseContext);
  }

  // ── Priority 9: Allow ────────────────────────────────────────────────
  return makeDecision(true, grantReason, baseContext);
}

/**
 * Evaluate entitlement for multiple capabilities at once (bulk).
 * Useful for the /auth/entitlements endpoint that returns all capabilities.
 *
 * @param {Object} params
 * @param {Object} params.user
 * @param {Object} params.planIdentity
 * @param {string[]} params.capabilityIds
 * @param {Object} params.policySnapshot
 * @returns {Object.<string, EntitlementDecision>}
 */
function evaluateAllCapabilities({ user, planIdentity, capabilityIds, policySnapshot }) {
  const results = {};
  for (const capId of capabilityIds) {
    results[capId] = evaluateEntitlement({
      user,
      planIdentity,
      capabilityId: capId,
      requestedNetworks: [],
      policySnapshot,
    });
  }
  return results;
}

module.exports = {
  evaluateEntitlement,
  evaluateAllCapabilities,
  makeDecision,
};
