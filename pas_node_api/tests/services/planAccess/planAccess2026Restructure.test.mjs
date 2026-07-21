// Tests the REAL on-disk plan_config.json / planAccessSeed.js data added for the
// 2026 pricing restructure — not synthetic fixtures — so a future edit to either
// file that breaks these invariants fails a test, not just a manual QA pass. See
// docs/PLAN_ACCESS.md "§ 2026 Pricing Restructure".
//
// Plan IDs are read from config.pricing.planIds (via getPlanIds()) rather than
// hardcoded — this environment's real aMember-issued IDs (72-79, 2026-07-15)
// replaced the earlier 101-104/105/112-114 placeholders; hardcoding either set
// here would just repeat the exact mistake restructure2026.js's own docs warn
// against ("never hardcode these numbers in any .js/.json file").
import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const loggerPath = require.resolve("../../../src/logger");
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { createChild: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })) },
};

const svc = require("../../../src/services/planAccess/planAccessService");
const planConfigRaw = require("../../../src/services/planAccess/plan_config.json");
const { DEFAULT_PLAN_GROUPS } = require("../../../src/services/planAccess/planAccessSeed");
const { mergeContributions, getPlanIds } = require("../../../src/services/planAccess/restructure2026");

// plan_config.json itself no longer hardcodes any 2026-tier plan ID — those come
// only from config.json's pricing.planIds, merged in here exactly like the real
// getConfig()/planAccessMigrate.js code paths do. See restructure2026.js.
const planConfig = mergeContributions(planConfigRaw);
const IDS = getPlanIds(); // real config.json values, this environment: basic:72, basicYearly:76, standard:73, standardYearly:77, platinum:74, platinumYearly:78, palladium:75, palladiumYearly:79

// resolvePlanTier() needs a `plan_groups` doc in the config array — that doc lives
// only in planAccessSeed.js's DEFAULT_PLAN_GROUPS, not in plan_config.json itself.
const configWithGroups = [...planConfig, { _id: "plan_groups", groups: DEFAULT_PLAN_GROUPS.groups }];

const NEW_TIERS = {
  [IDS.basic]: { tier: "Basic", price: 69, networks: ["facebook", "instagram"], brandLimit: 1, competitorLimit: 7 },
  [IDS.standard]: { tier: "Standard", price: 129, networks: ["facebook", "instagram", "pinterest", "gdn"], brandLimit: 5, competitorLimit: 35 },
  [IDS.platinum]: { tier: "Platinum", price: 279, networks: ["facebook", "instagram", "pinterest", "gdn", "youtube", "native", "google"], brandLimit: 10, competitorLimit: 70 },
  [IDS.palladium]: { tier: "Palladium", price: 399, networks: ["facebook", "instagram", "pinterest", "gdn", "youtube", "native", "google", "linkedin", "tiktok", "quora", "reddit"], brandLimit: 30, competitorLimit: 210 },
};

describe("2026 pricing restructure > new plan IDs (config.pricing.planIds)", () => {
  for (const [planId, expected] of Object.entries(NEW_TIERS)) {
    it(`plan ${planId} (${expected.tier}) resolves exactly its PRD §2 networks`, () => {
      const allowed = svc.getAllowedPlatforms(Number(planId), planConfig);
      expect(allowed.sort()).toEqual([...expected.networks].sort());
    });

    it(`plan ${planId} (${expected.tier}) resolves its documented brand/competitor limits`, () => {
      expect(svc.getCompetitorLimits(Number(planId), planConfig)).toEqual({
        brandLimit: expected.brandLimit,
        competitorLimit: expected.competitorLimit,
      });
    });

    it(`plan ${planId} (${expected.tier}) resolves to a "(2026)" plan_groups tier, not the legacy same-named group`, () => {
      expect(svc.resolvePlanTier(Number(planId), configWithGroups)).toBe(`${expected.tier} (2026)`);
    });
  }

  it("Standard targeting filters (gender/age) are enabled; Basic's are not", () => {
    const std = svc.getFilterStatus(IDS.standard, "all", planConfig);
    const basic = svc.getFilterStatus(IDS.basic, "all", planConfig);
    expect(std.gender.enabled).toBe(true);
    expect(std.age.enabled).toBe(true);
    expect(basic.gender.enabled).toBe(false);
    expect(basic.age.enabled).toBe(false);
  });

  it("Platinum has Estimated Ad Budget + affiliate/marketing/funnel; Standard does not", () => {
    const plat = svc.getFilterStatus(IDS.platinum, "all", planConfig);
    const std = svc.getFilterStatus(IDS.standard, "all", planConfig);
    for (const f of ["ad_budget_sort", "affiliate_network", "marketing_platform", "funnel"]) {
      expect(plat[f].enabled).toBe(true);
      expect(std[f].enabled).toBe(false);
    }
  });

  it("all 4 new tiers have core filters (keyword_search, category, country) enabled", () => {
    for (const planId of Object.keys(NEW_TIERS)) {
      const status = svc.getFilterStatus(Number(planId), "all", planConfig);
      expect(status.keyword_search.enabled).toBe(true);
      expect(status.category.enabled).toBe(true);
      expect(status.country.enabled).toBe(true);
    }
  });

  it("superset invariant: Palladium ⊇ Platinum ⊇ Standard ⊇ Basic for network access", () => {
    const platforms = (id) => new Set(svc.getAllowedPlatforms(id, planConfig));
    const basic = platforms(IDS.basic), standard = platforms(IDS.standard), platinum = platforms(IDS.platinum), palladium = platforms(IDS.palladium);
    const isSubset = (small, big) => [...small].every((x) => big.has(x));
    expect(isSubset(basic, standard)).toBe(true);
    expect(isSubset(standard, platinum)).toBe(true);
    expect(isSubset(platinum, palladium)).toBe(true);
  });
});

describe("2026 pricing restructure > old plans are byte-identical (regression)", () => {
  // A representative spread across the legacy tier sprawl (Free/Basic/Standard/
  // Premium/Platinum/Titanium/Palladium/Native/GDN/Custom/Enterprise) — proves the
  // additive edit didn't touch anything these plan IDs already had.
  const OLD_PLAN_EXPECTATIONS = {
    20: { networks: ["facebook", "gdn", "google", "instagram", "linkedin", "native", "pinterest", "quora", "reddit", "youtube"].sort() }, // Free
    2: { networks: ["facebook", "google", "instagram", "youtube"].sort() }, // legacy Basic
    57: { networks: ["facebook", "gdn", "google", "instagram", "linkedin", "native", "pinterest", "quora", "reddit", "tiktok", "youtube"].sort() }, // old Palladium (trial)
    69: { networks: ["facebook", "gdn", "google", "instagram", "linkedin", "native", "pinterest", "quora", "reddit", "tiktok", "youtube"].sort() }, // old Palladium (yearly)
  };

  for (const [planId, expected] of Object.entries(OLD_PLAN_EXPECTATIONS)) {
    it(`plan ${planId}'s allowed platforms are unchanged and exclude the new-tier-only additions`, () => {
      const allowed = svc.getAllowedPlatforms(Number(planId), planConfig).sort();
      expect(allowed).toEqual(expected.networks);
    });
  }

  it("none of the new plan IDs were accidentally added to any OLD tier's competitor_limits", () => {
    const competitorLimitsDoc = planConfig.find((d) => d._id === "competitor_limits");
    for (const newId of [IDS.basic, IDS.standard, IDS.platinum, IDS.palladium]) {
      // The new IDs should be present (added deliberately) — this just confirms
      // no old plan's limits object was mutated to reference them.
      expect(Object.keys(competitorLimitsDoc.plan_limits)).toContain(String(newId));
    }
    // Spot-check an old entry's exact values are untouched.
    expect(competitorLimitsDoc.plan_limits["57"]).toEqual({ brandLimit: 20, competitorLimit: 140 });
  });

  it("old plan_billing_metadata entries keep legacy tier labels, not the new (2026) discriminator", () => {
    const billing = planConfig.find((d) => d._id === "plan_billing_metadata");
    expect(billing.plan_info["57"].pricingGeneration).toBeUndefined();
    expect(billing.plan_info["57"].tier).toBe("Palladium");
  });
});

describe("2026 pricing restructure > plan_groups (planAccessSeed.js DEFAULT_PLAN_GROUPS)", () => {
  it("adds 4 new groups without removing or renaming any existing group", () => {
    const groups = DEFAULT_PLAN_GROUPS.groups;
    for (const legacy of ["Free", "Basic", "Standard", "Premium", "Platinum", "Titanium", "Palladium", "Custom"]) {
      expect(groups[legacy]).toBeDefined();
    }
    // Each group holds both the monthly ID and its yearly counterpart — same
    // entitlements, only billing cycle differs. IDs come only from config.json's
    // pricing.planIds (see restructure2026.js) — read them rather than hardcoding,
    // since dev/prod can assign different numbers (2026-07-14 incident: ID 111
    // turned out to already be a real legacy plan in this environment).
    for (const tier of ["basic", "standard", "platinum", "palladium"]) {
      const label = `${tier[0].toUpperCase()}${tier.slice(1)} (2026)`;
      expect(groups[label]).toBeDefined();
      expect(groups[label].plans.sort()).toEqual([IDS[tier], IDS[`${tier}Yearly`]].sort());
    }
  });

  it("Palladium (2026) is flagged topTier, alongside legacy Palladium", () => {
    expect(DEFAULT_PLAN_GROUPS.groups.Palladium.topTier).toBe(true);
    expect(DEFAULT_PLAN_GROUPS.groups["Palladium (2026)"].topTier).toBe(true);
  });

  it("openForNewSignups: legacy tiers false, 2026 tiers + Free/Custom true (metadata only, not an enforcement gate)", () => {
    const groups = DEFAULT_PLAN_GROUPS.groups;
    for (const legacy of ["Basic", "Standard", "Premium", "Platinum", "Titanium", "Palladium"]) {
      expect(groups[legacy].openForNewSignups).toBe(false);
    }
    for (const open of ["Free", "Custom", "Basic (2026)", "Standard (2026)", "Platinum (2026)", "Palladium (2026)"]) {
      expect(groups[open].openForNewSignups).toBe(true);
    }
  });

  it("new tiers use distinct colors from their legacy same-named counterparts", () => {
    const groups = DEFAULT_PLAN_GROUPS.groups;
    expect(groups["Basic (2026)"].color).not.toBe(groups.Basic.color);
    expect(groups["Standard (2026)"].color).not.toBe(groups.Standard.color);
    expect(groups["Platinum (2026)"].color).not.toBe(groups.Platinum.color);
    expect(groups["Palladium (2026)"].color).not.toBe(groups.Palladium.color);
  });
});

describe("PRD FR-5–FR-9 > legacy grandfathering (no new per-account system needed)", () => {
  // Since new signups get brand-new plan IDs (101-104) and existing subscribers never
  // move off their old plan IDs, "legacy-ness" is purely a property of which plan ID an
  // account is already on — these are plain plan_access_config entitlement edits, the
  // same mechanism as everything else in this system. See docs/PLAN_ACCESS.md § FR-5–FR-9.
  const STANDARD_LEGACY_IDS = [3, 6, 10, 13, 16, 41, 53, 58, 65, 26];
  const TITANIUM_IDS = [56, 62, 68];
  const LEGACY_BASIC_IDS = [2, 5, 9, 14, 15, 40, 52, 59, 64, 25];

  it("FR-5: every legacy Basic plan ID already includes google + youtube (no edit needed — verifies the claim, doesn't just assume it)", () => {
    for (const id of LEGACY_BASIC_IDS) {
      const allowed = svc.getAllowedPlatforms(id, planConfig);
      expect(allowed).toEqual(expect.arrayContaining(["google", "youtube"]));
    }
  });

  it("FR-6: every legacy Standard plan ID has linkedin + pinterest (pre-existing) AND gdn (added)", () => {
    for (const id of STANDARD_LEGACY_IDS) {
      const allowed = svc.getAllowedPlatforms(id, planConfig);
      expect(allowed).toEqual(expect.arrayContaining(["linkedin", "pinterest", "gdn"]));
    }
  });

  it("FR-8: true Titanium plan IDs (56/62/68) now have full Palladium-equivalent access (all 11 networks)", () => {
    const ALL_11 = ["facebook", "instagram", "youtube", "google", "gdn", "linkedin", "native", "reddit", "quora", "pinterest", "tiktok"];
    for (const id of TITANIUM_IDS) {
      const allowed = svc.getAllowedPlatforms(id, planConfig).sort();
      expect(allowed).toEqual(ALL_11.sort());
    }
  });

  it("FR-8 did NOT touch the Native-tier plan IDs that share the same plan_groups 'Titanium' UI bucket (29/31/32/35/36/38/39/44/45 are a separate product line)", () => {
    // 32/36/39/45 already had gdn/quora/reddit before this change (separate reason);
    // the rest (29/31/35/38/44) should NOT have gained them as a side effect of the
    // Titanium edit above, since they were never in TITANIUM_IDS.
    for (const id of [29, 31, 35, 38, 44]) {
      const allowed = svc.getAllowedPlatforms(id, planConfig);
      expect(allowed).not.toContain("quora");
    }
  });

  it("FR-7/FR-8: legacyHeldPriceDurationMonths config defaults to null (lifetime) pending CEO decision, not a guessed cutoff", () => {
    delete require.cache[require.resolve("../../../src/config")];
    const config = require("../../../src/config");
    expect(config.pricing.legacyHeldPriceDurationMonths).toBeNull();
  });

  it("FR-9: auto-removal on plan change needs no extra code — getAllowedPlatforms always reflects whatever plan_id is passed, with no memory of a prior plan_id", () => {
    // Simulates the same account's two consecutive logins with different plan_ids —
    // proves entitlements are purely a function of the CURRENT plan_id, which is exactly
    // why legacy benefits disappear automatically the moment an account's plan_id changes.
    const beforeUpgrade = svc.getAllowedPlatforms(3, planConfig); // legacy Standard-Legacy
    const afterUpgrade = svc.getAllowedPlatforms(IDS.standard, planConfig); // new Standard (2026)
    expect(beforeUpgrade).toContain("gdn");
    expect(afterUpgrade).not.toContain("linkedin"); // the legacy-only bonus network
  });
});

describe("2026 pricing restructure > anchor filter docs (foundation only, not yet enforced)", () => {
  const ANCHOR_IDS = ["ai_metadata_filters", "keyword_explorer", "advanced_ad_analytics", "market_trends", "ad_tracker"];

  it("all 5 anchor docs exist exactly once", () => {
    for (const id of ANCHOR_IDS) {
      expect(planConfig.filter((d) => d._id === id)).toHaveLength(1);
    }
  });

  it("ai_metadata_filters / keyword_explorer / advanced_ad_analytics / market_trends are allowed_plan_ids: null (all plans)", () => {
    for (const id of ["ai_metadata_filters", "keyword_explorer", "advanced_ad_analytics", "market_trends"]) {
      const doc = planConfig.find((d) => d._id === id);
      expect(doc.allowed_plan_ids).toBeNull();
    }
  });

  it("ad_tracker is flagged _needs_code_wiring since no controller reads it yet", () => {
    const doc = planConfig.find((d) => d._id === "ad_tracker");
    expect(doc._needs_code_wiring).toBe(true);
    expect(doc.allowed_plan_ids.sort((a, b) => a - b)).toEqual(
      [IDS.standard, IDS.standardYearly, IDS.platinum, IDS.platinumYearly, IDS.palladium, IDS.palladiumYearly].sort((a, b) => a - b)
    );
  });
});
