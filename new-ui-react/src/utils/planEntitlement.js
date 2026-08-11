export function isCapabilityAllowed(entitlements, capabilityId) {
  return entitlements?.capabilities?.[capabilityId]?.allowed === true;
}

/**
 * Resolves Projects access without treating a partially migrated entitlement
 * response as a denial. An explicit unified decision remains authoritative;
 * otherwise the legacy project_access decision is used during migration.
 */
export function resolveProjectsAccess(entitlements, planAccess, planAccessResolved) {
  if (!planAccessResolved) {
    return { resolved: false, allowed: false, denied: false, unavailable: false };
  }

  const unifiedDecision = entitlements?.capabilities?.['projects.access'];
  if (unifiedDecision) {
    const allowed = unifiedDecision.allowed === true;
    return { resolved: true, allowed, denied: !allowed, unavailable: false };
  }

  const legacyDecision = planAccess?.filters?.project_access;
  if (legacyDecision) {
    const allowed = legacyDecision.enabled === true;
    return { resolved: true, allowed, denied: !allowed, unavailable: false };
  }

  // Missing Projects data is an access-resolution problem, not proof that the
  // user's subscription should be upgraded.
  return { resolved: true, allowed: false, denied: false, unavailable: true };
}

/**
 * The customer-facing Advanced Analytics modal is controlled only by its
 * dedicated capability. Competitive Intelligence is a separate product area
 * and must never unlock this modal when Advanced Analytics is disabled in the
 * active policy.
 */
export function isAdAnalyticsAllowed(entitlements, planAccess) {
  if (entitlements) {
    return isCapabilityAllowed(entitlements, 'legacy.advanced_ad_analytics');
  }

  if (!planAccess?.filters) return false;
  if (planAccess.filters.advanced_ad_analytics !== undefined) {
    return planAccess.filters.advanced_ad_analytics?.enabled === true;
  }
  return planAccess.filters.ad_analytics?.enabled === true;
}

/**
 * Keyword Analytics is controlled by its own Plan Control capability. It must
 * not inherit the unrelated Competitive Intelligence/Ad Analytics UI gate.
 */
export function isKeywordAnalyticsAllowed(entitlements, planAccess) {
  if (entitlements?.capabilities?.['intelligence.keyword_explorer.analytics']) {
    return isCapabilityAllowedOnNetwork(
      entitlements,
      'intelligence.keyword_explorer.analytics',
      'google',
    );
  }

  // Older/partially upgraded APIs do not expose the child capability. In that
  // migration state Keyword Analytics follows its own legacy Keyword Explorer
  // feature, never the unrelated Advanced Analytics/Competitive Intelligence
  // controls. An explicit unified child decision above remains authoritative.
  return planAccess?.filters?.keyword_explorer?.enabled === true;
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

export function resolveCustomPlanDefaultNetwork(platformOptions, allowedNetworks) {
  if (!Array.isArray(platformOptions) || !Array.isArray(allowedNetworks)) return null;
  return platformOptions.find(network => isPlanNetworkAllowed(allowedNetworks, network)) || null;
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

/**
 * Resolve the effective Ads Library networks from the published policy first.
 * The legacy plan-access response is used only when the unified ads.search
 * decision is unavailable during an older-policy rollout.
 *
 * null means access data has not resolved yet; [] is an explicit deny-all.
 */
export function resolveAdsSearchAllowedNetworks(entitlements, planAccess) {
  const decision = entitlements?.capabilities?.['ads.search'];
  if (decision) {
    if (!decision.allowed) return [];

    const networks = Array.isArray(decision.allowedNetworks)
      ? [...new Set(decision.allowedNetworks.map(normalizePlanNetwork).filter(Boolean))]
      : [];
    if (networks.length > 0) return networks;

    // New policy responses include networkMode. An empty effective list is an
    // intentional deny, not permission to query every platform.
    if (decision.networkMode) return [];
  }

  if (Array.isArray(planAccess?.allowedPlatforms)) {
    return [...new Set(planAccess.allowedPlatforms.map(normalizePlanNetwork).filter(Boolean))];
  }
  return null;
}

/**
 * Guests use separate public search endpoints and do not need plan resolution.
 * Authenticated Ads Library requests must wait for an authoritative array;
 * `null` means policy bootstrap is still unresolved, not "allow every network".
 */
export function isAdsSearchAccessReady(isAuthenticated, isGuest, allowedNetworks) {
  return !isAuthenticated || isGuest === true || Array.isArray(allowedNetworks);
}
