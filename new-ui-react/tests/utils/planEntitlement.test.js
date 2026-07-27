import { describe, expect, it } from "vitest";
import {
  isCapabilityAllowed,
  isCapabilityAllowedOnNetwork,
} from "../../src/utils/planEntitlement.js";

describe("plan entitlement decisions", () => {
  const disabledSerp = {
    enforcementMode: "shadow",
    capabilities: {
      "intelligence.keyword_explorer.analytics.serp_mix": {
        allowed: false,
        reasonCode: "VARIANT_DENY",
        allowedNetworks: ["google"],
      },
    },
  };

  it("never turns an explicit child Disable into Allow because of shadow metadata", () => {
    expect(isCapabilityAllowed(
      disabledSerp,
      "intelligence.keyword_explorer.analytics.serp_mix",
    )).toBe(false);
    expect(isCapabilityAllowedOnNetwork(
      disabledSerp,
      "intelligence.keyword_explorer.analytics.serp_mix",
      "google",
    )).toBe(false);
  });

  it("allows an enabled child only on its effective networks", () => {
    const entitlements = {
      capabilities: {
        "intelligence.market_trends.keywords": {
          allowed: true,
          networkMode: "custom",
          allowedNetworks: ["facebook", "instagram"],
        },
      },
    };
    expect(isCapabilityAllowedOnNetwork(entitlements, "intelligence.market_trends.keywords", "facebook")).toBe(true);
    expect(isCapabilityAllowedOnNetwork(entitlements, "intelligence.market_trends.keywords", "google")).toBe(false);
  });

  it("fails closed for a missing child and for a new explicit empty network rule", () => {
    expect(isCapabilityAllowed({}, "intelligence.market_trends.keywords")).toBe(false);
    expect(isCapabilityAllowedOnNetwork({
      capabilities: {
        "intelligence.market_trends.keywords": {
          allowed: true,
          networkMode: "custom",
          allowedNetworks: [],
        },
      },
    }, "intelligence.market_trends.keywords", "facebook")).toBe(false);
  });
});
