'use strict';

/**
 * Standard reason codes for entitlement decisions.
 *
 * Every plan-control denial or grant returns one of these codes so the frontend,
 * admin UI, logs, and cross-service clients can display/process the result without
 * parsing free-text messages.
 *
 * See docs/PLAN_CONTROL_REVAMP_PLAN.md §8 — Decision priority.
 */

/** User subscription identity is missing, invalid, or unresolvable. */
const MISSING_IDENTITY = 'MISSING_IDENTITY';

/** The requested capability is globally disabled (status = disabled). */
const CAPABILITY_DISABLED = 'CAPABILITY_DISABLED';

/** The user's plan has been soft-deleted. */
const PLAN_DELETED = 'PLAN_DELETED';

/** Custom-plan invoice/JWT has an explicit network or capability denial. */
const CUSTOM_INVOICE_DENY = 'CUSTOM_INVOICE_DENY';

/** A variant-specific override explicitly denies this capability. */
const VARIANT_DENY = 'VARIANT_DENY';

/** The plan family's policy explicitly denies this capability. */
const CAPABILITY_NOT_IN_PLAN = 'CAPABILITY_NOT_IN_PLAN';

/** The requested network is not permitted for this capability under the plan. */
const NETWORK_NOT_PERMITTED = 'NETWORK_NOT_PERMITTED';

/** A quota (brand, competitor, member, alert-rule, etc.) is exhausted. */
const QUOTA_EXHAUSTED = 'QUOTA_EXHAUSTED';

/** Access is granted — explicit allow or inherited allow. */
const ALLOWED = 'ALLOWED';

/** The capability is not registered in the capability registry. */
const UNKNOWN_CAPABILITY = 'UNKNOWN_CAPABILITY';

/** The capability exists but has no policy entry (needs_review). */
const NEEDS_REVIEW = 'NEEDS_REVIEW';
const ALLOWED_PENDING_REVIEW = 'ALLOWED_PENDING_REVIEW';

/**
 * All reason codes as an array (useful for validation / test assertions).
 */
const ALL_REASON_CODES = [
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
];

/**
 * Returns true when the reason code represents a denial.
 * @param {string} code
 * @returns {boolean}
 */
function isDenial(code) {
  return ![ALLOWED, ALLOWED_PENDING_REVIEW].includes(code);
}

/**
 * Returns true when the denial should show the subscription/upgrade modal.
 * Network-only denials and quota denials use different UI treatment.
 * @param {string} code
 * @returns {boolean}
 */
function shouldShowSubscriptionModal(code) {
  return [
    CAPABILITY_NOT_IN_PLAN,
    CUSTOM_INVOICE_DENY,
    VARIANT_DENY,
    PLAN_DELETED,
    MISSING_IDENTITY,
  ].includes(code);
}

module.exports = {
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
  ALL_REASON_CODES,
  isDenial,
  shouldShowSubscriptionModal,
};
