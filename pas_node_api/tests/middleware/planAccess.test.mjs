import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const planSvcPath = require.resolve("../../src/services/planAccess/planAccessService");
const planSvc = {
  getConfig: vi.fn(),
  getAllowedPlatforms: vi.fn(),
  getFilterStatus: vi.fn(),
  getCompetitorLimits: vi.fn(),
  stripRestrictedFilters: vi.fn(),
  resolvePlanTier: vi.fn(() => "TIER_GOLD"),
};
require.cache[planSvcPath] = {
  id: planSvcPath, filename: planSvcPath, loaded: true, exports: planSvc,
};

const configPath = require.resolve("../../src/config");
let configExports = { amember: { plans: { custom: [33, 46, 70] } } };
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true,
  get exports() { return configExports; },
  set exports(v) { configExports = v; },
};

const loggerPath = require.resolve("../../src/logger");
const childLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { createChild: vi.fn(() => childLog) },
};

// sdui/db is lazy-required inside getSduiQueryParamMap — pre-stub
const sduiDbPath = require.resolve("../../src/services/sdui/db");
const sduiToArray = vi.fn(async () => []);
const sduiFind = vi.fn(() => ({ toArray: sduiToArray }));
const sduiCollection = vi.fn(() => ({ find: sduiFind }));
const sduiDb = { collection: sduiCollection };
const getDB = vi.fn(async () => sduiDb);
require.cache[sduiDbPath] = {
  id: sduiDbPath, filename: sduiDbPath, loaded: true, exports: { getDB },
};

const sutPath = require.resolve("../../src/middleware/planAccess");
function freshSut() {
  delete require.cache[sutPath];
  return require(sutPath);
}

function mkRes() {
  const r = { statusCode: 200, body: null };
  r.status = vi.fn((code) => { r.statusCode = code; return r; });
  r.json = vi.fn((body) => { r.body = body; return r; });
  return r;
}

beforeEach(() => {
  configExports = { amember: { plans: { custom: [33, 46, 70] } } };
  childLog.info.mockClear(); childLog.warn.mockClear(); childLog.error.mockClear();
  planSvc.getConfig.mockReset();
  planSvc.getAllowedPlatforms.mockReset().mockReturnValue(["facebook", "google"]);
  planSvc.getFilterStatus.mockReset().mockReturnValue({});
  planSvc.getCompetitorLimits.mockReset().mockReturnValue({ brandLimit: 5, competitorLimit: 5 });
  planSvc.stripRestrictedFilters.mockReset().mockReturnValue({ planRestricted: [], platformRestricted: [] });
  planSvc.resolvePlanTier.mockReset().mockReturnValue("TIER_GOLD");
  sduiToArray.mockReset().mockResolvedValue([]);
  sduiFind.mockClear(); sduiCollection.mockClear(); getDB.mockClear().mockResolvedValue(sduiDb);
});

describe("middleware/planAccess > planAccessMiddleware (SQL user path)", () => {
  it("403 when no planId on req.user", async () => {
    const { planAccessMiddleware } = freshSut();
    const res = mkRes(); const next = vi.fn();
    await planAccessMiddleware({ user: {} }, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body.code).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("503 when planAccessService.getConfig returns empty", async () => {
    planSvc.getConfig.mockResolvedValue([]);
    const { planAccessMiddleware } = freshSut();
    const res = mkRes(); const next = vi.fn();
    await planAccessMiddleware({ user: { plan_id: 1 }, body: {}, query: {} }, res, next);
    expect(res.statusCode).toBe(503);
  });

  it("503 when planAccessService.getConfig returns null", async () => {
    planSvc.getConfig.mockResolvedValue(null);
    const { planAccessMiddleware } = freshSut();
    const res = mkRes();
    await planAccessMiddleware({ user: { plan_id: 1 }, body: {}, query: {} }, res, vi.fn());
    expect(res.statusCode).toBe(503);
  });

  it("happy path: sets req.planAccess + calls next", async () => {
    planSvc.getConfig.mockResolvedValue([{}]);
    const { planAccessMiddleware } = freshSut();
    const req = { user: { plan_id: 1 }, body: { network: "facebook" }, query: {} };
    const next = vi.fn();
    await planAccessMiddleware(req, mkRes(), next);
    expect(next).toHaveBeenCalled();
    expect(req.planAccess).toEqual({
      planId: 1,
      planTier: "TIER_GOLD",
      allowedPlatforms: ["facebook", "google"],
      filters: {},
      competitorLimits: { brandLimit: 5, competitorLimit: 5 },
      strippedFilters: [],
      customPlatformRestriction: false,
    });
  });

  it("network from query when body has none", async () => {
    planSvc.getConfig.mockResolvedValue([{}]);
    const { planAccessMiddleware } = freshSut();
    await planAccessMiddleware({ user: { plan_id: 1 }, body: {}, query: { network: "google" } }, mkRes(), vi.fn());
    expect(planSvc.getFilterStatus).toHaveBeenCalledWith(1, "google", expect.any(Array));
  });

  it("network defaults to 'all'", async () => {
    planSvc.getConfig.mockResolvedValue([{}]);
    const { planAccessMiddleware } = freshSut();
    await planAccessMiddleware({ user: { plan_id: 1 }, body: {}, query: {} }, mkRes(), vi.fn());
    expect(planSvc.getFilterStatus).toHaveBeenCalledWith(1, "all", expect.any(Array));
  });

  it("403 when planRestricted (non-silent) present", async () => {
    planSvc.getConfig.mockResolvedValue([{}]);
    planSvc.stripRestrictedFilters.mockReturnValue({ planRestricted: ["keyword"], platformRestricted: [] });
    const { planAccessMiddleware } = freshSut();
    const res = mkRes();
    await planAccessMiddleware({ user: { plan_id: 1 }, body: {}, query: {} }, res, vi.fn());
    expect(res.statusCode).toBe(403);
    expect(res.body.restrictedFilters).toEqual(["keyword"]);
    expect(res.body.showSubscriptionModal).toBe(true);
  });

  it("ad_position silently stripped, does NOT trigger 403", async () => {
    planSvc.getConfig.mockResolvedValue([{}]);
    planSvc.stripRestrictedFilters.mockReturnValue({ planRestricted: ["ad_position"], platformRestricted: [] });
    const { planAccessMiddleware } = freshSut();
    const next = vi.fn();
    await planAccessMiddleware({ user: { plan_id: 1 }, body: {}, query: {} }, mkRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("403 when platformRestricted (non-silent) present", async () => {
    planSvc.getConfig.mockResolvedValue([{}]);
    planSvc.stripRestrictedFilters.mockReturnValue({ planRestricted: [], platformRestricted: ["country"] });
    const { planAccessMiddleware } = freshSut();
    const res = mkRes();
    await planAccessMiddleware({ user: { plan_id: 1 }, body: {}, query: {} }, res, vi.fn());
    expect(res.statusCode).toBe(403);
    expect(res.body.restrictedFilters).toEqual(["country"]);
  });

  it("500 on unexpected throw", async () => {
    planSvc.getConfig.mockRejectedValue(new Error("boom"));
    const { planAccessMiddleware } = freshSut();
    const res = mkRes();
    await planAccessMiddleware({ user: { plan_id: 1 }, body: {}, query: {} }, res, vi.fn());
    expect(res.statusCode).toBe(500);
    expect(childLog.error).toHaveBeenCalled();
  });
});

describe("middleware/planAccess > planAccessMiddleware (aMember user path)", () => {
  it("custom plan (planId in custom set) uses JWT-only platforms", async () => {
    planSvc.getConfig.mockResolvedValue([{}]);
    const { planAccessMiddleware } = freshSut();
    const req = {
      user: {
        userSubscriptionType: 33,
        platformAccess: { Facebook: 1, Instagram: 0, Google: 1 },
      },
      body: {}, query: {},
    };
    const next = vi.fn();
    await planAccessMiddleware(req, mkRes(), next);
    expect(next).toHaveBeenCalled();
    expect(req.planAccess.allowedPlatforms).toEqual(expect.arrayContaining(["facebook", "google"]));
    expect(req.planAccess.allowedPlatforms).not.toContain("instagram");
    expect(req.planAccess.customPlatformRestriction).toBe(true);
  });

  it("regular plan intersects JWT with config", async () => {
    planSvc.getConfig.mockResolvedValue([{}]);
    planSvc.getAllowedPlatforms.mockReturnValue(["facebook"]);
    const { planAccessMiddleware } = freshSut();
    const req = {
      user: { userSubscriptionType: 69, platformAccess: { facebook: 1, google: 1 } },
      body: {}, query: {},
    };
    const next = vi.fn();
    await planAccessMiddleware(req, mkRes(), next);
    expect(req.planAccess.allowedPlatforms).toEqual(["facebook"]);
    expect(req.planAccess.customPlatformRestriction).toBe(false);
  });

  it("empty/null aMember config → all-platforms default + zero competitor limits", async () => {
    planSvc.getConfig.mockResolvedValue(null);
    const { planAccessMiddleware } = freshSut();
    const req = {
      user: { userSubscriptionType: 99, platformAccess: {} },
      body: {}, query: {},
    };
    const next = vi.fn();
    await planAccessMiddleware(req, mkRes(), next);
    expect(next).toHaveBeenCalled();
    expect(req.planAccess.competitorLimits).toEqual({ brandLimit: 0, competitorLimit: 0 });
  });

  it("403 when aMember planRestricted non-silent present", async () => {
    planSvc.getConfig.mockResolvedValue([{}]);
    planSvc.stripRestrictedFilters.mockReturnValue({ planRestricted: ["keyword"], platformRestricted: [] });
    const { planAccessMiddleware } = freshSut();
    const res = mkRes();
    await planAccessMiddleware(
      { user: { userSubscriptionType: 69, platformAccess: {} }, body: {}, query: {} }, res, vi.fn()
    );
    expect(res.statusCode).toBe(403);
    expect(res.body.restrictedFilters).toEqual(["keyword"]);
  });

  it("403 when aMember platformRestricted non-silent present", async () => {
    planSvc.getConfig.mockResolvedValue([{}]);
    planSvc.stripRestrictedFilters.mockReturnValue({ planRestricted: [], platformRestricted: ["country"] });
    const { planAccessMiddleware } = freshSut();
    const res = mkRes();
    await planAccessMiddleware(
      { user: { userSubscriptionType: 69, platformAccess: {} }, body: {}, query: {} }, res, vi.fn()
    );
    expect(res.statusCode).toBe(403);
  });

  it("aMember ad_position silently stripped → passes through", async () => {
    planSvc.getConfig.mockResolvedValue([{}]);
    planSvc.stripRestrictedFilters.mockReturnValue({ planRestricted: ["ad_position"], platformRestricted: ["ad_position"] });
    const { planAccessMiddleware } = freshSut();
    const next = vi.fn();
    await planAccessMiddleware(
      { user: { userSubscriptionType: 69, platformAccess: {} }, body: {}, query: {} }, mkRes(), next
    );
    expect(next).toHaveBeenCalled();
  });

  it("aMember network from body wins", async () => {
    planSvc.getConfig.mockResolvedValue([{}]);
    const { planAccessMiddleware } = freshSut();
    await planAccessMiddleware(
      { user: { userSubscriptionType: 69, platformAccess: {} }, body: { network: "instagram" }, query: {} },
      mkRes(), vi.fn()
    );
    expect(planSvc.getFilterStatus).toHaveBeenCalledWith(69, "instagram", expect.any(Array));
  });

  it("aMember default custom codes when config.amember missing", async () => {
    configExports = {};
    planSvc.getConfig.mockResolvedValue([{}]);
    const { planAccessMiddleware } = freshSut();
    const req = {
      user: { userSubscriptionType: 33, platformAccess: { facebook: 1 } },
      body: {}, query: {},
    };
    await planAccessMiddleware(req, mkRes(), vi.fn());
    // 33 still in default custom set [33,46,70]
    expect(req.planAccess.allowedPlatforms).toContain("facebook");
  });
});

describe("middleware/planAccess > getSduiQueryParamMap cache + error paths", () => {
  it("populates map from SDUI docs (first call)", async () => {
    planSvc.getConfig.mockResolvedValue([{}]);
    sduiToArray.mockResolvedValue([
      { _id: "doc1", filters: [{ query_param: "qp1" }, { query_param: "qp2" }] },
      { _id: "doc2", filters: [{ query_param: "qp1" }] }, // duplicate ignored
      { _id: "doc3", filters: "not-array" },              // skipped
      { _id: "doc4", filters: [{ /* no query_param */ }] },
    ]);
    const { planAccessMiddleware } = freshSut();
    await planAccessMiddleware({ user: { plan_id: 1 }, body: {}, query: {} }, mkRes(), vi.fn());
    expect(getDB).toHaveBeenCalled();
    // Trigger a second call — should hit the cache (no second getDB)
    await planAccessMiddleware({ user: { plan_id: 1 }, body: {}, query: {} }, mkRes(), vi.fn());
    expect(getDB).toHaveBeenCalledTimes(1);
  });

  it("getDB throws → warn logged, empty map returned (still passes)", async () => {
    planSvc.getConfig.mockResolvedValue([{}]);
    getDB.mockRejectedValueOnce(new Error("sdui-down"));
    const { planAccessMiddleware } = freshSut();
    const next = vi.fn();
    await planAccessMiddleware({ user: { plan_id: 1 }, body: {}, query: {} }, mkRes(), next);
    expect(childLog.warn).toHaveBeenCalledWith("getSduiQueryParamMap: failed to build dynamic map", expect.any(Object));
    expect(next).toHaveBeenCalled();
  });
});

describe("middleware/planAccess > requirePlatform", () => {
  it("500 when req.planAccess missing", () => {
    const { requirePlatform } = freshSut();
    const mw = requirePlatform("facebook");
    const res = mkRes(); const next = vi.fn();
    mw({}, res, next);
    expect(res.statusCode).toBe(500);
    expect(next).not.toHaveBeenCalled();
  });

  it("403 when platform not in allowedPlatforms", () => {
    const { requirePlatform } = freshSut();
    const res = mkRes(); const next = vi.fn();
    requirePlatform("instagram")({ planAccess: { allowedPlatforms: ["facebook"], planId: 1 }, user: { id: "u" } }, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body.requiredPlatform).toBe("instagram");
    expect(next).not.toHaveBeenCalled();
  });

  it("passes when platform allowed", () => {
    const { requirePlatform } = freshSut();
    const res = mkRes(); const next = vi.fn();
    requirePlatform("facebook")({ planAccess: { allowedPlatforms: ["facebook"], planId: 1 }, user: { id: "u" } }, res, next);
    expect(next).toHaveBeenCalled();
  });
});

// 2026-07-14: mirrors marketTrends.js's OR-of-two-mechanisms design exactly.
// isKeywordExplorerUserAllowed is a targeted override for SPECIFIC listed user IDs —
// an empty list contributes NOTHING (final access rests on the plan-tier check via
// isKeywordExplorerAllowedByPlan). Previously an empty list meant "everyone", which
// silently made the keyword_explorer doc's allowed_plan_ids (configured via the admin
// Plan Access tab) have zero effect on real access — confirmed live: an admin had set
// allowed_plan_ids:[102] but every plan still got in, because mechanism 1 unconditionally
// won via OR.
describe("middleware/planAccess > Keyword Explorer (isKeywordExplorerUserAllowed / hasKeywordExplorerAccess)", () => {
  beforeEach(() => {
    configExports.keywordExplorer = { enabled: true, allowedUserIds: [] };
  });

  it("isKeywordExplorerUserAllowed: empty list → false (contributes nothing), not true", () => {
    const { isKeywordExplorerUserAllowed } = freshSut();
    expect(isKeywordExplorerUserAllowed(999)).toBe(false);
  });

  it("isKeywordExplorerUserAllowed: non-empty list only allows the listed id(s)", () => {
    configExports.keywordExplorer.allowedUserIds = [42];
    const { isKeywordExplorerUserAllowed } = freshSut();
    expect(isKeywordExplorerUserAllowed(42)).toBe(true);
    expect(isKeywordExplorerUserAllowed(43)).toBe(false);
  });

  it("hasKeywordExplorerAccess: empty allow-list + plan-tier restricted to a different plan → denied", async () => {
    planSvc.getConfig.mockResolvedValue([{ _id: "keyword_explorer", allowed_plan_ids: [102] }]);
    planSvc.getFilterStatus.mockReturnValue({ keyword_explorer: { enabled: false } });
    const { hasKeywordExplorerAccess } = freshSut();
    expect(await hasKeywordExplorerAccess({ user: { id: 999, plan_id: 101 } })).toBe(false);
  });

  it("hasKeywordExplorerAccess: allowed_plan_ids:null is unrestricted even if shared status is stale", async () => {
    planSvc.getConfig.mockResolvedValue([{ _id: "keyword_explorer", allowed_plan_ids: null }]);
    planSvc.getFilterStatus.mockReturnValue({ keyword_explorer: { enabled: false } });
    const { hasKeywordExplorerAccess } = freshSut();
    expect(await hasKeywordExplorerAccess({ user: { id: 999, plan_id: 36 } })).toBe(true);
  });

  it("hasKeywordExplorerAccess: plan-tier grants access even with an empty allow-list", async () => {
    planSvc.getConfig.mockResolvedValue([{ _id: "keyword_explorer" }]);
    planSvc.getFilterStatus.mockReturnValue({ keyword_explorer: { enabled: true } });
    const { hasKeywordExplorerAccess } = freshSut();
    expect(await hasKeywordExplorerAccess({ user: { id: 999, plan_id: 102 } })).toBe(true);
  });

  it("hasKeywordExplorerAccess: listed user_id grants access even when plan-tier says no", async () => {
    configExports.keywordExplorer.allowedUserIds = [7];
    planSvc.getFilterStatus.mockReturnValue({ keyword_explorer: { enabled: false } });
    const { hasKeywordExplorerAccess } = freshSut();
    expect(await hasKeywordExplorerAccess({ user: { id: 7, plan_id: 101 } })).toBe(true);
  });

  it("hasKeywordExplorerAccess: plan lookup throwing fails to false, doesn't block the allow-list", async () => {
    configExports.keywordExplorer.allowedUserIds = [7];
    planSvc.getConfig.mockRejectedValue(new Error("db-down"));
    const { hasKeywordExplorerAccess } = freshSut();
    expect(await hasKeywordExplorerAccess({ user: { id: 7, plan_id: 101 } })).toBe(true);
  });

  it("requireKeywordExplorerEnabled: feature flag off → 404 regardless of access", async () => {
    configExports.keywordExplorer.enabled = false;
    const { requireKeywordExplorerEnabled } = freshSut();
    const res = mkRes(); const next = vi.fn();
    await requireKeywordExplorerEnabled({ user: { id: 1, plan_id: 102 } }, res, next);
    expect(res.statusCode).toBe(404);
    expect(next).not.toHaveBeenCalled();
  });

  it("requireKeywordExplorerEnabled: feature on, neither mechanism grants access → 403 with data:[]", async () => {
    planSvc.getFilterStatus.mockReturnValue({ keyword_explorer: { enabled: false } });
    const { requireKeywordExplorerEnabled } = freshSut();
    const res = mkRes(); const next = vi.fn();
    await requireKeywordExplorerEnabled({ user: { id: 999, plan_id: 101 } }, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body.data).toEqual([]);
    expect(next).not.toHaveBeenCalled();
  });

  it("requireKeywordExplorerEnabled: feature on, plan-tier grants access → next()", async () => {
    planSvc.getConfig.mockResolvedValue([{ _id: "keyword_explorer" }]);
    planSvc.getFilterStatus.mockReturnValue({ keyword_explorer: { enabled: true } });
    const { requireKeywordExplorerEnabled } = freshSut();
    const res = mkRes(); const next = vi.fn();
    await requireKeywordExplorerEnabled({ user: { id: 999, plan_id: 102 } }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
