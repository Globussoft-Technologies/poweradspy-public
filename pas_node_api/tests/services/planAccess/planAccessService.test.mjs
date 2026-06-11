import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const loggerPath = require.resolve("../../../src/logger");
const childLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { createChild: vi.fn(() => childLog) },
};

const sduiDbPath = require.resolve("../../../src/services/sdui/db");
const getDB = vi.fn();
require.cache[sduiDbPath] = {
  id: sduiDbPath, filename: sduiDbPath, loaded: true,
  exports: { getDB },
};

import fs from "node:fs";
const realReadFileSync = fs.readFileSync;
let existsSpy, readSpy;
let readFileMockReturn = "[]";

const sutPath = require.resolve("../../../src/services/planAccess/planAccessService");
function freshSut() {
  delete require.cache[sutPath];
  return require(sutPath);
}

beforeEach(() => {
  childLog.info.mockClear(); childLog.warn.mockClear(); childLog.error.mockClear();
  getDB.mockReset();
  existsSpy = vi.spyOn(fs, "existsSync").mockImplementation((p) => {
    if (typeof p === "string" && p.includes("plan_config.json")) return false;
    return true;
  });
  readFileMockReturn = "[]";
  readSpy = vi.spyOn(fs, "readFileSync").mockImplementation((p, enc) => {
    if (typeof p === "string" && p.includes("plan_config.json")) return readFileMockReturn;
    return realReadFileSync(p, enc);
  });
});
afterEach(() => {
  existsSpy.mockRestore();
  readSpy.mockRestore();
});

describe("planAccessService > getConfig", () => {
  it("returns docs from MongoDB on first call", async () => {
    getDB.mockResolvedValue({ collection: () => ({ find: () => ({ toArray: vi.fn(async () => [{ _id: "x" }]) }) }) });
    const svc = freshSut();
    expect(await svc.getConfig()).toEqual([{ _id: "x" }]);
  });

  it("cache hit on second call within TTL", async () => {
    getDB.mockResolvedValue({ collection: () => ({ find: () => ({ toArray: vi.fn(async () => [{ _id: "x" }]) }) }) });
    const svc = freshSut();
    await svc.getConfig();
    await svc.getConfig();
    expect(getDB).toHaveBeenCalledTimes(1);
  });

  it("inflight request is reused (concurrent calls)", async () => {
    getDB.mockResolvedValue({ collection: () => ({ find: () => ({ toArray: vi.fn(async () => [{ _id: "x" }]) }) }) });
    const svc = freshSut();
    const [a, b] = await Promise.all([svc.getConfig(), svc.getConfig()]);
    expect(a).toEqual(b);
    expect(getDB).toHaveBeenCalledTimes(1);
  });

  it("empty MongoDB result falls back to JSON file when exists", async () => {
    getDB.mockResolvedValue({ collection: () => ({ find: () => ({ toArray: vi.fn(async () => []) }) }) });
    existsSpy.mockImplementation((p) => typeof p === "string" && p.includes("plan_config.json"));
    readFileMockReturn = JSON.stringify([{ _id: "from-json" }]);
    const svc = freshSut();
    expect(await svc.getConfig()).toEqual([{ _id: "from-json" }]);
    expect(childLog.warn).toHaveBeenCalled();
  });

  it("empty MongoDB + missing JSON → returns []", async () => {
    getDB.mockResolvedValue({ collection: () => ({ find: () => ({ toArray: vi.fn(async () => []) }) }) });
    const svc = freshSut();
    expect(await svc.getConfig()).toEqual([]);
  });

  it("MongoDB throws → JSON fallback used", async () => {
    getDB.mockRejectedValue(new Error("db-down"));
    existsSpy.mockImplementation((p) => typeof p === "string" && p.includes("plan_config.json"));
    readFileMockReturn = JSON.stringify([{ _id: "fb" }]);
    const svc = freshSut();
    expect(await svc.getConfig()).toEqual([{ _id: "fb" }]);
  });

  it("JSON parse failure logs error and returns []", async () => {
    getDB.mockRejectedValue(new Error("db-down"));
    existsSpy.mockImplementation((p) => typeof p === "string" && p.includes("plan_config.json"));
    readFileMockReturn = "not-valid-json{";
    const svc = freshSut();
    expect(await svc.getConfig()).toEqual([]);
    expect(childLog.error).toHaveBeenCalled();
  });
});

describe("planAccessService > updateConfig + invalidateConfigCache", () => {
  it("upserts each doc and invalidates cache", async () => {
    const replaceOne = vi.fn(async () => ({}));
    getDB.mockResolvedValue({ collection: () => ({ replaceOne, find: () => ({ toArray: vi.fn(async () => [{ _id: "y" }]) }) }) });
    const svc = freshSut();
    await svc.updateConfig([{ _id: "a" }, { _id: "b" }]);
    expect(replaceOne).toHaveBeenCalledTimes(2);
    // After update, cache should be cleared — next getConfig hits DB again
    await svc.getConfig();
    expect(getDB).toHaveBeenCalledTimes(2);
  });

  it("updateConfig throws when DB fails", async () => {
    getDB.mockRejectedValue(new Error("db-down"));
    const svc = freshSut();
    await expect(svc.updateConfig([{ _id: "a" }])).rejects.toThrow("db-down");
  });
});

describe("planAccessService > getAllowedPlatforms", () => {
  it("returns empty when plan is soft-deleted", () => {
    const svc = freshSut();
    const config = [
      { _id: "plan_groups", deleted_plan_ids: [{ plan_id: 5 }] },
      { _id: "platform_access", platform_plans: { facebook: [5] } },
    ];
    expect(svc.getAllowedPlatforms(5, config)).toEqual([]);
  });
  it("returns [] when platform_access doc missing", () => {
    const svc = freshSut();
    expect(svc.getAllowedPlatforms(5, [])).toEqual([]);
  });
  it("returns [] when invalid planId", () => {
    const svc = freshSut();
    expect(svc.getAllowedPlatforms("bogus", [{ _id: "platform_access", platform_plans: { facebook: [5] } }])).toEqual([]);
  });
  it("returns platforms whose plan_lists include planId", () => {
    const svc = freshSut();
    const config = [{ _id: "platform_access", platform_plans: { facebook: [5, 10], instagram: [10] } }];
    expect(svc.getAllowedPlatforms(5, config)).toEqual(["facebook"]);
    expect(svc.getAllowedPlatforms(10, config)).toEqual(expect.arrayContaining(["facebook", "instagram"]));
  });
  it("non-array plan_list entries skipped", () => {
    const svc = freshSut();
    const config = [{ _id: "platform_access", platform_plans: { facebook: "not-array" } }];
    expect(svc.getAllowedPlatforms(5, config)).toEqual([]);
  });
});

describe("planAccessService > getCompetitorLimits", () => {
  it("returns default 0/0 when no limits doc", () => {
    expect(freshSut().getCompetitorLimits(5, [])).toEqual({ brandLimit: 0, competitorLimit: 0 });
  });
  it("returns plan-specific limits when present", () => {
    const config = [{ _id: "competitor_limits", plan_limits: { "5": { brandLimit: 10, competitorLimit: 20 } } }];
    expect(freshSut().getCompetitorLimits(5, config)).toEqual({ brandLimit: 10, competitorLimit: 20 });
  });
  it("defaults when plan not in limits", () => {
    const config = [{ _id: "competitor_limits", plan_limits: {} }];
    expect(freshSut().getCompetitorLimits(99, config)).toEqual({ brandLimit: 0, competitorLimit: 0 });
  });
});

describe("planAccessService > getFilterStatus", () => {
  it("returns {} on invalid planId", () => {
    expect(freshSut().getFilterStatus("bogus", "all", [])).toEqual({});
  });
  it("soft-deleted plan returns all filters denied", () => {
    const config = [
      { _id: "plan_groups", deleted_plan_ids: [{ plan_id: 5 }] },
      { _id: "filt1", category: "filter" },
      { _id: "filt2", category: "filter" },
      { _id: "platform_access", category: "platform" }, // excluded
    ];
    const out = freshSut().getFilterStatus(5, "all", config);
    expect(out.filt1).toEqual({ enabled: false, planAllowed: false });
    expect(out.filt2).toEqual({ enabled: false, planAllowed: false });
    expect(out.platform_access).toBeUndefined();
  });
  it("filter with no allowed_plan_ids → planAllowed=true (legacy default)", () => {
    const config = [{ _id: "f1", category: "filter" }];
    expect(freshSut().getFilterStatus(5, "all", config).f1).toEqual({ enabled: true, planAllowed: true });
  });
  it("allowed_plan_ids matches plan → enabled", () => {
    const config = [{ _id: "f1", category: "filter", allowed_plan_ids: [5] }];
    expect(freshSut().getFilterStatus(5, "all", config).f1.enabled).toBe(true);
  });
  it("allowed_plan_ids doesn't match → disabled", () => {
    const config = [{ _id: "f1", category: "filter", allowed_plan_ids: [99] }];
    expect(freshSut().getFilterStatus(5, "all", config).f1.enabled).toBe(false);
  });
  it("empty allowed_plan_ids → planAllowed=false", () => {
    const config = [{ _id: "f1", category: "filter", allowed_plan_ids: [] }];
    expect(freshSut().getFilterStatus(5, "all", config).f1.planAllowed).toBe(false);
  });
  it("network='all' skips platform_support check", () => {
    const config = [{ _id: "f1", category: "filter", platform_support: { facebook: false } }];
    expect(freshSut().getFilterStatus(5, "all", config).f1.enabled).toBe(true);
  });
  it("network=facebook with platform_support.facebook=false → disabled", () => {
    const config = [{ _id: "f1", category: "filter", platform_support: { facebook: false } }];
    expect(freshSut().getFilterStatus(5, "facebook", config).f1.enabled).toBe(false);
  });
  it("network array intersects platform_support object", () => {
    const config = [{ _id: "f1", category: "filter", platform_support: { facebook: false, instagram: true } }];
    expect(freshSut().getFilterStatus(5, ["facebook", "instagram"], config).f1.enabled).toBe(true);
  });
  it("network=other (key missing) → treated as true (no rule)", () => {
    const config = [{ _id: "f1", category: "filter", platform_support: { facebook: false } }];
    expect(freshSut().getFilterStatus(5, "youtube", config).f1.enabled).toBe(true);
  });
  it("platform_support as array → list-of-supported semantics", () => {
    const config = [{ _id: "f1", category: "filter", platform_support: ["facebook"] }];
    expect(freshSut().getFilterStatus(5, "facebook", config).f1.enabled).toBe(true);
    expect(freshSut().getFilterStatus(5, "instagram", config).f1.enabled).toBe(false);
  });
  it("platform_support of unexpected type (string) → neither branch applies (line 197 falsy)", () => {
    // platform_support is a string → not array (line 194 false) and typeof
    // !== 'object' (line 197 false). Both branches skipped, enabled stays
    // at the planAllowed default.
    const config = [{ _id: "f1", category: "filter", platform_support: "facebook" }];
    expect(freshSut().getFilterStatus(5, "facebook", config).f1.enabled).toBe(true);
  });
  it("category='limits' / category='platform' both excluded", () => {
    const config = [
      { _id: "f1", category: "filter" },
      { _id: "lm", category: "limits" },
      { _id: "pl", category: "platform" },
    ];
    const out = freshSut().getFilterStatus(5, "all", config);
    expect(out.f1).toBeDefined();
    expect(out.lm).toBeUndefined();
    expect(out.pl).toBeUndefined();
  });
});

describe("planAccessService > stripRestrictedFilters", () => {
  it("returns empty arrays when no body or filterStatus", () => {
    const svc = freshSut();
    expect(svc.stripRestrictedFilters(null, {})).toEqual({ planRestricted: [], platformRestricted: [] });
    expect(svc.stripRestrictedFilters({}, null)).toEqual({ planRestricted: [], platformRestricted: [] });
  });
  it("skips 'NA'/empty/undefined/null/'' values", () => {
    const svc = freshSut();
    const body = { keyword: "NA", advertiser: "", domain: null, gender: undefined };
    const out = svc.stripRestrictedFilters(body, { keyword_search: { enabled: false, planAllowed: false } });
    expect(out.planRestricted).toEqual([]);
  });
  it("skips empty arrays", () => {
    const out = freshSut().stripRestrictedFilters({ country: [] }, { country: { enabled: false, planAllowed: false } });
    expect(out.planRestricted).toEqual([]);
  });
  it("skips empty range objects", () => {
    const out = freshSut().stripRestrictedFilters({ likes_sort: { min: "", max: "" } }, { likes_sort: { enabled: false, planAllowed: false } });
    expect(out.planRestricted).toEqual([]);
  });
  it("range with min only → still treated as active", () => {
    const body = { likes_sort: { min: 10, max: "" } };
    const out = freshSut().stripRestrictedFilters(body, { likes_sort: { enabled: false, planAllowed: false } });
    expect(out.planRestricted).toContain("likes_sort");
  });
  it("planRestricted when disabled+!planAllowed", () => {
    const body = { keyword: "test" };
    const out = freshSut().stripRestrictedFilters(body, { keyword_search: { enabled: false, planAllowed: false } });
    expect(out.planRestricted).toEqual(["keyword"]);
    expect(body.keyword).toBeUndefined();
  });
  it("platformRestricted when disabled but planAllowed", () => {
    const body = { keyword: "test" };
    const out = freshSut().stripRestrictedFilters(body, { keyword_search: { enabled: false, planAllowed: true } });
    expect(out.platformRestricted).toEqual(["keyword"]);
  });
  it("FILTER_ID_ALIASES fallback: cta → call_to_action", () => {
    // sduiQueryParamMap routes call_to_action body key to 'cta' filter (which is blocked).
    // The alias 'call_to_action' should override and let it through (planAllowed:true from alias).
    const body = { call_to_action: "BUY" };
    const fs = {
      cta: { enabled: false, planAllowed: false },
      call_to_action: { enabled: true, planAllowed: true },
    };
    const out = freshSut().stripRestrictedFilters(body, fs, { call_to_action: "cta" });
    expect(out.planRestricted).toEqual([]);
  });
  it("FILTER_ID_ALIASES fallback actually triggered when filterId is 'cta' via sdui-only key (lines 362-364)", () => {
    // Body key not in BODY_KEY_TO_FILTER_ID, so sduiQueryParamMap wins:
    // 'sdui_only_cta_field' → filterId 'cta' (blocked) → alias 'call_to_action' (allowed) →
    // fs gets remapped to { planAllowed:true, enabled:false } meaning platformRestricted.
    const body = { sdui_only_cta_field: "BUY" };
    const fs = {
      cta: { enabled: false, planAllowed: false },
      call_to_action: { enabled: true, planAllowed: true },
    };
    const out = freshSut().stripRestrictedFilters(body, fs, { sdui_only_cta_field: "cta" });
    // After alias fallback, planAllowed=true but enabled=false (cta's enabled) so platformRestricted
    expect(out.platformRestricted).toContain("sdui_only_cta_field");
    expect(out.planRestricted).toEqual([]);
    expect(body.sdui_only_cta_field).toBeUndefined();
  });
  it("filter not in status map → skipped", () => {
    const out = freshSut().stripRestrictedFilters({ keyword: "x" }, {});
    expect(out.planRestricted).toEqual([]);
    expect(out.platformRestricted).toEqual([]);
  });
  it("alias entry also has planAllowed=false → fallback short-circuits (line 363 falsy)", () => {
    // cta is blocked AND its alias call_to_action is ALSO blocked. The chain
    // `aliasId && filterStatus[aliasId] && filterStatus[aliasId].planAllowed`
    // hits the third operand falsy → fs stays as-is → planRestricted fires.
    const body = { sdui_only_cta_field: "BUY" };
    const fs = {
      cta: { enabled: false, planAllowed: false },
      call_to_action: { enabled: true, planAllowed: false },
    };
    const out = freshSut().stripRestrictedFilters(body, fs, { sdui_only_cta_field: "cta" });
    expect(out.planRestricted).toContain("sdui_only_cta_field");
  });
  it("enabled filter → not stripped", () => {
    const body = { keyword: "x" };
    freshSut().stripRestrictedFilters(body, { keyword_search: { enabled: true, planAllowed: true } });
    expect(body.keyword).toBe("x");
  });
  it("sduiQueryParamMap entries respected when BODY_KEY_TO_FILTER_ID doesn't cover", () => {
    const body = { custom_field: "x" };
    const out = freshSut().stripRestrictedFilters(body, { my_filter: { enabled: false, planAllowed: false } }, { custom_field: "my_filter" });
    expect(out.planRestricted).toEqual(["custom_field"]);
  });
});

describe("planAccessService > resolvePlanTier", () => {
  it("invalid planId → null", () => {
    expect(freshSut().resolvePlanTier("bogus", [])).toBeNull();
    expect(freshSut().resolvePlanTier(0, [])).toBeNull();
    expect(freshSut().resolvePlanTier(-1, [])).toBeNull();
  });
  it("non-array config → null", () => {
    expect(freshSut().resolvePlanTier(5, null)).toBeNull();
  });
  it("no plan_groups doc → null", () => {
    expect(freshSut().resolvePlanTier(5, [{ _id: "other" }])).toBeNull();
  });
  it("plan_groups.groups not object → null", () => {
    expect(freshSut().resolvePlanTier(5, [{ _id: "plan_groups", groups: null }])).toBeNull();
  });
  it("returns tier when plan in group", () => {
    const config = [{ _id: "plan_groups", groups: { Basic: { plans: [5] }, Premium: { plans: [10] } } }];
    expect(freshSut().resolvePlanTier(5, config)).toBe("Basic");
    expect(freshSut().resolvePlanTier(10, config)).toBe("Premium");
  });
  it("returns null when plan not in any group", () => {
    const config = [{ _id: "plan_groups", groups: { Basic: { plans: [5] } } }];
    expect(freshSut().resolvePlanTier(99, config)).toBeNull();
  });
  it("group with non-array plans skipped", () => {
    const config = [{ _id: "plan_groups", groups: { Bad: { plans: "not-array" }, Basic: { plans: [5] } } }];
    expect(freshSut().resolvePlanTier(5, config)).toBe("Basic");
  });
});
