import { describe, expect, it } from "vitest";
import {
  isCapabilityAllowed,
  isCapabilityAllowedOnNetwork,
  isAdAnalyticsAllowed,
  isPlanNetworkAllowed,
  normalizePlanNetwork,
} from "../../src/utils/planEntitlement.js";

describe("plan entitlement decisions", () => {
  it("normalizes SDUI network values before comparing plan access", () => {
    expect(normalizePlanNetwork(" YouTube ")).toBe("youtube");
    expect(isPlanNetworkAllowed(["youtube", "GOOGLE", "Native"], "YOUTUBE")).toBe(true);
    expect(isPlanNetworkAllowed(["youtube", "google", "native"], "linkedin")).toBe(false);
  });

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

  it("allows Ad Analytics when its migrated Advanced Ad Analytics capability is enabled", () => {
    const entitlements = {
      capabilities: {
        "legacy.advanced_ad_analytics": { allowed: true },
        "intelligence.competitive": { allowed: false },
      },
    };
    expect(isAdAnalyticsAllowed(entitlements, null)).toBe(true);
  });

  it("keeps legacy Ad Analytics compatibility when no published policy exists", () => {
    expect(isAdAnalyticsAllowed(null, {
      filters: { ad_analytics: { enabled: true } },
      competitorLimits: { brandLimit: 0 },
    })).toBe(true);
    expect(isAdAnalyticsAllowed(null, {
      filters: {
        ad_analytics: { enabled: false },
        advanced_ad_analytics: { enabled: false },
      },
      competitorLimits: { brandLimit: 0 },
    })).toBe(false);
  });
});
