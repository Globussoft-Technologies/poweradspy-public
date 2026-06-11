import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const sutPath = require.resolve("../../../src/services/planAccess/planAccessSeed");
function freshSut() {
  delete require.cache[sutPath];
  return require(sutPath);
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("planAccessSeed > module export shape", () => {
  it("exports filterDocs, platformAccessDoc, competitorLimitsDoc, planBillingMetadata, DEFAULT_PLAN_GROUPS", () => {
    const m = freshSut();
    expect(Array.isArray(m.filterDocs)).toBe(true);
    expect("platformAccessDoc" in m).toBe(true);
    expect("competitorLimitsDoc" in m).toBe(true);
    expect(m.planBillingMetadata._id).toBe("plan_billing_metadata");
    expect(m.DEFAULT_PLAN_GROUPS._id).toBe("plan_groups");
  });

  it("planBillingMetadata has plan_info entries for known plans", () => {
    const m = freshSut();
    expect(m.planBillingMetadata.plan_info["20"].tier).toBe("Free");
    expect(m.planBillingMetadata.plan_info["52"].billingType).toBe("trial");
    expect(m.planBillingMetadata.plan_info["64"].yearPlan).toBe(true);
    expect(m.planBillingMetadata.plan_info["71"].tier).toBe("Enterprise");
  });

  it("DEFAULT_PLAN_GROUPS contains all expected groups with color + plans", () => {
    const m = freshSut();
    for (const name of ["Free", "Basic", "Standard", "Premium", "Platinum", "Titanium", "Palladium", "Custom"]) {
      expect(m.DEFAULT_PLAN_GROUPS.groups[name]).toBeDefined();
      expect(m.DEFAULT_PLAN_GROUPS.groups[name].color).toMatch(/^#/);
      expect(Array.isArray(m.DEFAULT_PLAN_GROUPS.groups[name].plans)).toBe(true);
    }
  });

  it("planBillingMetadata has created_at and updated_at ISO strings", () => {
    const m = freshSut();
    expect(typeof m.planBillingMetadata.created_at).toBe("string");
    expect(typeof m.planBillingMetadata.updated_at).toBe("string");
    expect(m.planBillingMetadata.visible).toBe(true);
  });
});

describe("planAccessSeed > plan_config.json catch branch", () => {
  it("when plan_config.json fails to load, falls back to [] and warns", () => {
    // Resolve the plan_config.json path and pre-cache a throwing exports
    const jsonPath = require.resolve("../../../src/services/planAccess/plan_config.json");
    const orig = require.cache[jsonPath];
    require.cache[jsonPath] = {
      id: jsonPath, filename: jsonPath, loaded: true,
      get exports() { throw new Error("simulated-load-fail"); },
    };
    const m = freshSut();
    expect(Array.isArray(m.filterDocs)).toBe(true);
    expect(m.filterDocs).toEqual([]);
    expect(m.platformAccessDoc).toBeNull();
    expect(m.competitorLimitsDoc).toBeNull();
    expect(console.warn).toHaveBeenCalled();
    // Restore
    if (orig) require.cache[jsonPath] = orig;
    else delete require.cache[jsonPath];
  });
});
