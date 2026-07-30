export function isCapabilityAllowed(entitlements, capabilityId) {
  return entitlements?.capabilities?.[capabilityId]?.allowed === true;
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
