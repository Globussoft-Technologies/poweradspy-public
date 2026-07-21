import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { FEATURES, LEGACY_PLANS, RESTRUCTURE_2026_PLANS, getCatalog } =
  require("../../../src/services/planAccess/planCatalog");

describe("planCatalog", () => {
  it("FEATURES has a 'Networks' header plus 25 feature rows (incl. Market Trends + Keyword Explorer)", () => {
    expect(FEATURES[0]).toBe("Networks");
    expect(FEATURES).toHaveLength(26);
    expect(FEATURES).toContain("Market Trends");
    expect(FEATURES).toContain("Keyword Explorer");
  });

  it("Market Trends + Keyword Explorer are true (free) on every plan, both generations — beta, not yet tier-gated", () => {
    const marketTrendsIdx = FEATURES.indexOf("Market Trends") - 1; // -1: features arrays exclude the "Networks" header
    const keywordExplorerIdx = FEATURES.indexOf("Keyword Explorer") - 1;
    for (const p of [...LEGACY_PLANS, ...RESTRUCTURE_2026_PLANS]) {
      expect(p.features[marketTrendsIdx]).toBe(true);
      expect(p.features[keywordExplorerIdx]).toBe(true);
    }
  });

  it("every plan (both generations) has a features array matching FEATURES.length - 1", () => {
    for (const p of [...LEGACY_PLANS, ...RESTRUCTURE_2026_PLANS]) {
      expect(p.features).toHaveLength(FEATURES.length - 1);
    }
  });

  it("2026-restructure tier labels match plan_groups keys exactly (for resolvePlanTier string matching)", () => {
    expect(RESTRUCTURE_2026_PLANS.map((p) => p.tier)).toEqual([
      "Basic (2026)", "Standard (2026)", "Platinum (2026)", "Palladium (2026)",
    ]);
  });

  it("2026-restructure networks are cumulative supersets per PRD §2", () => {
    const byTier = Object.fromEntries(RESTRUCTURE_2026_PLANS.map((p) => [p.tier, new Set(p.platforms)]));
    const isSubset = (a, b) => [...a].every((x) => b.has(x));
    expect(isSubset(byTier["Basic (2026)"], byTier["Standard (2026)"])).toBe(true);
    expect(isSubset(byTier["Standard (2026)"], byTier["Platinum (2026)"])).toBe(true);
    expect(isSubset(byTier["Platinum (2026)"], byTier["Palladium (2026)"])).toBe(true);
    expect(byTier["Palladium (2026)"].size).toBe(11); // all networks
  });

  it("2026-restructure prices match the published pricing (Standard revised to $129, 2026-07-15)", () => {
    const prices = Object.fromEntries(RESTRUCTURE_2026_PLANS.map((p) => [p.tier, p.price]));
    expect(prices).toEqual({
      "Basic (2026)": "$69/Month",
      "Standard (2026)": "$129/Month",
      "Platinum (2026)": "$279/Month",
      "Palladium (2026)": "$399/Month",
    });
  });

  it("getCatalog('legacy') returns only legacy plans", () => {
    const { plans } = getCatalog("legacy");
    expect(plans).toBe(LEGACY_PLANS);
  });

  it("getCatalog('2026-restructure') returns only new plans", () => {
    const { plans } = getCatalog("2026-restructure");
    expect(plans).toBe(RESTRUCTURE_2026_PLANS);
  });

  it("getCatalog('both') concatenates legacy then 2026", () => {
    const { plans } = getCatalog("both");
    expect(plans).toEqual([...LEGACY_PLANS, ...RESTRUCTURE_2026_PLANS]);
  });

  it("label strips the '(2026)' suffix that only exists to avoid colliding with the legacy plan_groups key", () => {
    expect(RESTRUCTURE_2026_PLANS.map((p) => p.label)).toEqual(["Basic", "Standard", "Platinum", "Palladium"]);
    // Legacy entries have no suffix to strip — label is identical to tier.
    for (const p of LEGACY_PLANS) expect(p.label).toBe(p.tier);
  });

  it("getCatalog(unknown) falls back to 2026-restructure", () => {
    const { plans } = getCatalog("something-invalid");
    expect(plans).toBe(RESTRUCTURE_2026_PLANS);
  });
});
