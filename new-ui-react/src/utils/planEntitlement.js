export function isCapabilityAllowed(entitlements, capabilityId) {
  return entitlements?.capabilities?.[capabilityId]?.allowed === true;
}

export function isCapabilityAllowedOnNetwork(entitlements, capabilityId, network) {
  const decision = entitlements?.capabilities?.[capabilityId];
  if (!decision?.allowed) return false;
  if (!network) return true;

  const allowedNetworks = decision.allowedNetworks || [];
  if (allowedNetworks.length) {
    return allowedNetworks.includes(String(network).toLowerCase());
  }

  // Compatibility for an older entitlement response that did not expose its
  // network mode. New responses include networkMode; an empty effective list
  // in a new response is an intentional denial.
  return !decision.networkMode;
}
