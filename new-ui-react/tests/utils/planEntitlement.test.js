import { describe, expect, it } from "vitest";
import {
  isCapabilityAllowed,
  isCapabilityAllowedOnNetwork,
  isAdAnalyticsAllowed,
  isKeywordAnalyticsAllowed,
  isLegacyFilterPlanRestricted,
  isPlanNetworkAllowed,
  normalizePlanNetwork,
  resolveAdsSearchAllowedNetworks,
  resolveCustomPlanDefaultNetwork,
} from "../../src/utils/planEntitlement.js";

describe("plan entitlement decisions", () => {
  it("normalizes SDUI network values before comparing plan access", () => {
    expect(normalizePlanNetwork(" YouTube ")).toBe("youtube");
    expect(isPlanNetworkAllowed(["youtube", "GOOGLE", "Native"], "YOUTUBE")).toBe(true);
    expect(isPlanNetworkAllowed(["youtube", "google", "native"], "linkedin")).toBe(false);
  });

  it("starts a Custom plan on its first purchased network", () => {
    const navbarOrder = ["facebook", "instagram", "youtube", "google", "reddit", "quora"];
    expect(resolveCustomPlanDefaultNetwork(navbarOrder, ["reddit"])).toBe("reddit");
    expect(resolveCustomPlanDefaultNetwork(navbarOrder, ["quora", "reddit"])).toBe("reddit");
    expect(resolveCustomPlanDefaultNetwork(navbarOrder, [])).toBeNull();
  });

  it("uses the published ads.search network decision instead of a stale legacy platform list", () => {
    const entitlements = {
      capabilities: {
        "ads.search": {
          allowed: true,
          networkMode: "custom",
          allowedNetworks: ["facebook", "instagram"],
        },
      },
    };
    expect(resolveAdsSearchAllowedNetworks(entitlements, {
      allowedPlatforms: ["facebook", "instagram", "gdn"],
    })).toEqual(["facebook", "instagram"]);
  });

  it("preserves an explicit deny-all network policy and falls back for legacy policies", () => {
    expect(resolveAdsSearchAllowedNetworks({
      capabilities: {
        "ads.search": { allowed: true, networkMode: "custom", allowedNetworks: [] },
      },
    }, { allowedPlatforms: ["gdn"] })).toEqual([]);

    expect(resolveAdsSearchAllowedNetworks(null, {
      allowedPlatforms: ["Facebook", "GDN"],
    })).toEqual(["facebook", "gdn"]);
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

  it("does not let Competitive Intelligence override an Advanced Analytics denial", () => {
    const entitlements = {
      capabilities: {
        "legacy.advanced_ad_analytics": { allowed: false },
        "intelligence.competitive": { allowed: true },
      },
    };
    expect(isAdAnalyticsAllowed(entitlements, null)).toBe(false);
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
    expect(isAdAnalyticsAllowed(null, {
      filters: { advanced_ad_analytics: { enabled: false } },
      competitorLimits: { brandLimit: 99 },
    })).toBe(false);
  });

  it("allows Keyword Analytics independently from Competitive Intelligence", () => {
    const entitlements = {
      capabilities: {
        "intelligence.competitive": { allowed: false },
        "intelligence.keyword_explorer.analytics": {
          allowed: true,
          networkMode: "custom",
          allowedNetworks: ["google"],
        },
      },
    };
    expect(isKeywordAnalyticsAllowed(entitlements, null)).toBe(true);
  });

  it("denies Keyword Analytics when its own effective capability is disabled", () => {
    const entitlements = {
      capabilities: {
        "intelligence.competitive": { allowed: true },
        "intelligence.keyword_explorer.analytics": {
          allowed: false,
          reasonCode: "VARIANT_DENY",
          allowedNetworks: ["google"],
        },
      },
    };
    expect(isKeywordAnalyticsAllowed(entitlements, null)).toBe(false);
  });

  it("uses the legacy Keyword Explorer gate when the child capability is unavailable", () => {
    expect(isKeywordAnalyticsAllowed({ capabilities: {} }, {
      filters: {
        keyword_explorer: { enabled: true },
        advanced_ad_analytics: { enabled: false },
      },
    })).toBe(true);
    expect(isKeywordAnalyticsAllowed(null, {
      filters: {
        keyword_explorer: { enabled: false },
        advanced_ad_analytics: { enabled: true },
      },
    })).toBe(false);
  });

  it("does not show an upgrade dialog for a plan-allowed filter on an inapplicable network", () => {
    expect(isLegacyFilterPlanRestricted({
      enabled: false,
      planAllowed: true,
    })).toBe(false);
    expect(isLegacyFilterPlanRestricted({
      enabled: false,
      planAllowed: false,
    })).toBe(true);
  });

  it("keeps compatibility with old filter responses that lack planAllowed", () => {
    expect(isLegacyFilterPlanRestricted({ enabled: false })).toBe(true);
    expect(isLegacyFilterPlanRestricted({ enabled: true })).toBe(false);
  });
});
