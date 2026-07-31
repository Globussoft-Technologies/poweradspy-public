export function isCapabilityAllowed(entitlements, capabilityId) {
  return entitlements?.capabilities?.[capabilityId]?.allowed === true;
}

/**
 * Ad Analytics existed under two legacy names during the plan-control
 * migration. The customer modal must honour either migrated capability, while
 * installations without a published policy continue to use plan-access data.
 */
export function isAdAnalyticsAllowed(entitlements, planAccess) {
  if (entitlements) {
    return (
      isCapabilityAllowed(entitlements, 'legacy.advanced_ad_analytics') ||
      isCapabilityAllowed(entitlements, 'intelligence.competitive')
    );
  }

  return !!planAccess && (
    planAccess.filters?.advanced_ad_analytics?.enabled === true ||
    planAccess.filters?.ad_analytics?.enabled === true ||
    (planAccess.competitorLimits?.brandLimit ?? 0) > 0
  );
}

/**
 * Keyword Analytics is controlled by its own Plan Control capability. It must
 * not inherit the unrelated Competitive Intelligence/Ad Analytics UI gate.
 */
export function isKeywordAnalyticsAllowed(entitlements, planAccess) {
  if (entitlements) {
    return isCapabilityAllowedOnNetwork(
      entitlements,
      'intelligence.keyword_explorer.analytics',
      'google',
    );
  }
  return isAdAnalyticsAllowed(null, planAccess);
}

/**
 * Legacy plan access exposes two independent facts:
 * - planAllowed: whether the subscription purchased the filter
 * - enabled: whether it is usable on the currently selected network
 *
 * Only the first one should open the upgrade dialog. Platform applicability is
 * handled by SDUI visibility and must not be presented as a subscription deny.
 */
export function isLegacyFilterPlanRestricted(status) {
  if (!status) return false;
  if (typeof status.planAllowed === 'boolean') return status.planAllowed === false;
  return status.enabled === false;
}

export function normalizePlanNetwork(network) {
  return String(network ?? '').trim().toLowerCase();
}

export function isPlanNetworkAllowed(allowedNetworks, network) {
  if (!Array.isArray(allowedNetworks)) return true;
  const requested = normalizePlanNetwork(network);
  return allowedNetworks.some((allowed) => normalizePlanNetwork(allowed) === requested);
}

export function isCapabilityAllowedOnNetwork(entitlements, capabilityId, network) {
  const decision = entitlements?.capabilities?.[capabilityId];
  if (!decision?.allowed) return false;
  if (!network) return true;

  const allowedNetworks = decision.allowedNetworks || [];
  if (allowedNetworks.length) {
    return isPlanNetworkAllowed(allowedNetworks, network);
  }

  // Compatibility for an older entitlement response that did not expose its
  // network mode. New responses include networkMode; an empty effective list
  // in a new response is an intentional denial.
  return !decision.networkMode;
}
