import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const configPath = require.resolve("../../../src/config");
let configExports = { pricing: { planIds: { basic: 101, basicYearly: 105, standard: 102, standardYearly: 112, platinum: 103, platinumYearly: 113, palladium: 104, palladiumYearly: 114 } } };
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true,
  get exports() { return configExports; },
  set exports(v) { configExports = v; },
};

const sutPath = require.resolve("../../../src/services/planAccess/restructure2026");
function freshSut() {
  delete require.cache[sutPath];
  return require(sutPath);
}

beforeEach(() => {
  configExports = { pricing: { planIds: { basic: 101, basicYearly: 105, standard: 102, standardYearly: 112, platinum: 103, platinumYearly: 113, palladium: 104, palladiumYearly: 114 } } };
});

describe("restructure2026 — config.pricing.planIds is the only source of these numbers", () => {
  it("getPlanIds reflects config.pricing.planIds exactly", () => {
    const { getPlanIds } = freshSut();
    expect(getPlanIds()).toEqual({
      basic: 101, basicYearly: 105, standard: 102, standardYearly: 112,
      platinum: 103, platinumYearly: 113, palladium: 104, palladiumYearly: 114,
    });
  });

  it("an unconfigured slot resolves to null, not a guessed default", () => {
    configExports = { pricing: { planIds: { basic: 101 } } };
    const { getPlanIds } = freshSut();
    expect(getPlanIds().basicYearly).toBeNull();
    expect(getPlanIds().standard).toBeNull();
  });

  it("platform_access contribution is cumulative per tier and uses only configured IDs", () => {
    const { getContributionDocs } = freshSut();
    const docs = getContributionDocs();
    const pa = docs.find((d) => d._id === "platform_access");
    expect(pa.platform_plans.facebook).toEqual(expect.arrayContaining([101, 105, 102, 112, 103, 113, 104, 114]));
    expect(pa.platform_plans.linkedin).toEqual([104, 114]); // Palladium-only network
    expect(pa.platform_plans.gdn).toEqual(expect.arrayContaining([102, 112, 103, 113, 104, 114]));
    expect(pa.platform_plans.gdn).not.toContain(101);
  });

  it("competitor_limits + plan_billing_metadata contributions key by the configured IDs", () => {
    const { getContributionDocs } = freshSut();
    const docs = getContributionDocs();
    const cl = docs.find((d) => d._id === "competitor_limits");
    expect(cl.plan_limits[101]).toEqual({ brandLimit: 1, competitorLimit: 7 });
    expect(cl.plan_limits[114]).toEqual({ brandLimit: 30, competitorLimit: 210 });

    const bm = docs.find((d) => d._id === "plan_billing_metadata");
    expect(bm.plan_info[101].billingType).toBe("trial");
    expect(bm.plan_info[105].billingType).toBe("yearly");
    expect(bm.plan_info[105].tier).toBe("Basic");
  });

  it("tier-gated filter docs only include the appropriate tiers' IDs", () => {
    const { getContributionDocs } = freshSut();
    const docs = getContributionDocs();
    const gender = docs.find((d) => d._id === "gender"); // Standard+
    expect(gender.allowed_plan_ids).toEqual(expect.arrayContaining([102, 112, 103, 113, 104, 114]));
    expect(gender.allowed_plan_ids).not.toContain(101);
    expect(gender.allowed_plan_ids).not.toContain(105);

    const category = docs.find((d) => d._id === "category"); // all tiers
    expect(category.allowed_plan_ids).toContain(101);
  });

  // 2026-07-14: project_access was left out of every tier list, so canAccessProjects
  // (new-ui-react's App.jsx) was false for every 2026-tier plan including Palladium —
  // "All Projects" always redirected to the upgrade modal regardless of plan.
  it("project_access is granted to every tier (every 2026 tier has a real, nonzero brandLimit/competitorLimit)", () => {
    const { getContributionDocs } = freshSut();
    const docs = getContributionDocs();
    const projectAccess = docs.find((d) => d._id === "project_access");
    expect(projectAccess.allowed_plan_ids).toEqual(
      expect.arrayContaining([101, 105, 102, 112, 103, 113, 104, 114])
    );
  });

  it("getPlanGroups skips a tier entirely when neither its monthly nor yearly ID is configured", () => {
    configExports = { pricing: { planIds: { basic: 101, basicYearly: 105 } } };
    const { getPlanGroups } = freshSut();
    const groups = getPlanGroups();
    expect(groups["Basic (2026)"].plans).toEqual([101, 105]);
    expect(groups["Standard (2026)"]).toBeUndefined();
  });

  it("mergeContributions never overwrites an existing base doc's pre-existing content, only adds", () => {
    const { mergeContributions } = freshSut();
    const base = [{ _id: "gender", allowed_plan_ids: [20, 5, 999] }]; // 999 = some real legacy plan, unrelated
    const merged = mergeContributions(base);
    const doc = merged.find((d) => d._id === "gender");
    expect(doc.allowed_plan_ids).toContain(999); // untouched
    expect(doc.allowed_plan_ids).toContain(20);  // untouched
    expect(doc.allowed_plan_ids).toEqual(expect.arrayContaining([102, 112, 103, 113, 104, 114])); // added
  });

  it("mergeContributions is a no-op when no plan IDs are configured at all", () => {
    configExports = { pricing: { planIds: {} } };
    const { mergeContributions } = freshSut();
    const base = [{ _id: "gender", allowed_plan_ids: [20] }];
    expect(mergeContributions(base)).toEqual(base);
  });
});
