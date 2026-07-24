import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── Fake express Router with handler-capture (same pattern as adminRoutes.test.mjs) ──
const handlers = { get: {} };
const FakeRouter = () => ({
  get: vi.fn((p, ...rest) => { handlers.get[p] = rest; }),
});
const expressPath = require.resolve("express");
require.cache[expressPath] = { id: expressPath, filename: expressPath, loaded: true, exports: { Router: FakeRouter } };

const authMwPath = require.resolve("../../src/middleware/auth");
const authMiddleware = vi.fn((req, res, next) => next());
require.cache[authMwPath] = { id: authMwPath, filename: authMwPath, loaded: true, exports: { authMiddleware } };

const errHandlerPath = require.resolve("../../src/middleware/errorHandler");
require.cache[errHandlerPath] = { id: errHandlerPath, filename: errHandlerPath, loaded: true, exports: { asyncHandler: (fn) => fn } };

const planSvcPath = require.resolve("../../src/services/planAccess/planAccessService");
const planSvc = { getConfig: vi.fn(async () => []), getFilterStatus: vi.fn(() => ({})), getAllowedPlatforms: vi.fn(() => []) };
require.cache[planSvcPath] = { id: planSvcPath, filename: planSvcPath, loaded: true, exports: planSvc };

const routeControlPath = require.resolve("../../src/services/planControl/registries/routeClassification");
const getCapabilityDecision = vi.fn(async () => null);
require.cache[routeControlPath] = {
  id: routeControlPath, filename: routeControlPath, loaded: true, exports: { getCapabilityDecision },
};

const dbMgrPath = require.resolve("../../src/database/DatabaseManager");
const getElastic = vi.fn();
require.cache[dbMgrPath] = { id: dbMgrPath, filename: dbMgrPath, loaded: true, exports: { getElastic } };

const registryPath = require.resolve("../../src/services/ServiceRegistry");
const getService = vi.fn();
require.cache[registryPath] = { id: registryPath, filename: registryPath, loaded: true, exports: { getService } };

const configPath = require.resolve("../../src/config");
let configExports = { intelligence: { enabled: true, allowedUserIds: [] } };
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true,
  get exports() { return configExports; },
  set exports(v) { configExports = v; },
};

const sutPath = require.resolve("../../src/services/marketTrends");
function freshSut() {
  for (const k of Object.keys(handlers.get)) delete handlers.get[k];
  delete require.cache[sutPath];
  return require(sutPath);
}
function mkRes() {
  const r = { statusCode: 200, body: null };
  r.status = vi.fn((c) => { r.statusCode = c; return r; });
  r.json = vi.fn((b) => { r.body = b; return r; });
  return r;
}
function chain(path) { return handlers.get[path]; }
function lastHandler(path) { const c = chain(path); return c[c.length - 1]; }
// accessGuard is third-from-last in the /trends/* chains (…, accessGuard,
// restrictNetworkToPlan, asyncHandler(realHandler)) — grab it directly rather
// than the real ES-querying handler, which needs a full ES/DB mock to exercise
// safely.
function guardHandler(path) { const c = chain(path); return c[c.length - 3]; }

beforeEach(() => {
  authMiddleware.mockClear();
  planSvc.getConfig.mockReset().mockResolvedValue([]);
  planSvc.getFilterStatus.mockReset().mockReturnValue({});
  planSvc.getAllowedPlatforms.mockReset().mockReturnValue([]);
  getCapabilityDecision.mockReset().mockResolvedValue(null);
  getService.mockReset();
  getElastic.mockReset();
  configExports = { intelligence: { enabled: true, allowedUserIds: [] } };
});
// restrictNetworkToPlan is the last middleware before the real handler in every
// /trends/* chain — grab it the same way guardHandler grabs accessGuard.
function networkMw(path) { const c = chain(path); return c[c.length - 2]; }

// 2026-07-14: access = mechanism 1 (config.intelligence.allowedUserIds, a targeted
// override for SPECIFIC listed user IDs) OR mechanism 2 (plan_access_config's
// market_trends filter doc, computed directly — no planAccessMiddleware dependency).
// Both must work independently; neither can break the other. See docs/PLAN_ACCESS.md
// § "Market Trends beta→GA" for the full history (a 2026-07-13 attempt to REPLACE
// mechanism 1 with mechanism 2 was reverted; a 2026-07-14 follow-up then flipped
// mechanism 1's empty-list default from "everyone" to "contributes nothing" — an
// empty list used to silently make ANY plan-tier restriction on allowed_plan_ids
// unenforceable, since mechanism 1 unconditionally won via OR).

describe("marketTrends router > module load", () => {
  it("registers all expected routes, only authMiddleware in the chain (no planAccessMiddleware)", () => {
    freshSut();
    for (const path of ["/access", "/trends/overview", "/trends/categories", "/trends/top", "/trends/regions", "/trends/keywords", "/trends/search"]) {
      expect(chain(path)).toBeDefined();
      expect(chain(path)).toContain(authMiddleware);
    }
  });
});

describe("marketTrends router > active Plan Control policy", () => {
  it("uses the active policy instead of a conflicting legacy denial", async () => {
    getCapabilityDecision.mockResolvedValue({
      allowed: true,
      reasonCode: "ALLOWED",
      allowedNetworks: ["facebook"],
      policyVersion: "policy-live",
    });
    planSvc.getFilterStatus.mockReturnValue({ market_trends: { enabled: false } });
    freshSut();
    const res = mkRes();
    await lastHandler("/access")({ user: { id: 999, plan_id: 69 }, query: {}, body: {} }, res);
    expect(res.body.data).toMatchObject({
      enabled: true,
      networks: ["facebook"],
      reasonCode: "ALLOWED",
      policyVersion: "policy-live",
    });
  });

  it("reports an active billing-variant denial even when legacy access is open", async () => {
    getCapabilityDecision.mockResolvedValue({
      allowed: false,
      reasonCode: "VARIANT_DENY",
      allowedNetworks: [],
      policyVersion: "policy-live",
      showSubscriptionModal: true,
    });
    planSvc.getConfig.mockResolvedValue([{ _id: "market_trends", allowed_plan_ids: null }]);
    freshSut();
    const res = mkRes();
    await lastHandler("/access")({ user: { id: 999, plan_id: 69 }, query: {}, body: {} }, res);
    expect(res.body.data.enabled).toBe(false);
    expect(res.body.data.reasonCode).toBe("VARIANT_DENY");
  });
});

describe("marketTrends router > production aggregation efficiency", () => {
  it("resolves max(last_seen) once and reuses it for the overview histogram", async () => {
    const search = vi.fn(async ({ body }) => {
      if (body.aggs?.a?.max) {
        return { aggregations: { a: { value: 1784678400000, value_as_string: "2026-07-22T00:00:00.000Z" } } };
      }
      return { aggregations: { d: { buckets: [{ key_as_string: "2026-07-22", doc_count: 7 }] } } };
    });
    const es = { indexName: "search_mix", esMajor: 7, search };
    getService.mockImplementation((net) => net === "facebook" ? { db: { elastic: es } } : null);
    freshSut();

    const res = mkRes();
    await lastHandler("/trends/overview")({ query: { network: "facebook", days: 30 }, body: {} }, res);

    expect(search).toHaveBeenCalledTimes(2);
    expect(search.mock.calls.filter(([request]) => request.body.aggs?.a?.max)).toHaveLength(1);
    expect(search.mock.calls.every(([request]) => request.request_cache === true)).toBe(true);
    expect(res.body.data.total).toBe(7);
  });
});

describe("marketTrends router > GET /access — OR of both mechanisms", () => {
  it("empty allowedUserIds contributes nothing; with no plan info at all → denied", async () => {
    freshSut();
    const req = { user: {} };
    const res = mkRes();
    await lastHandler("/access")(req, res);
    expect(res.body.data.enabled).toBe(false);
  });

  it("empty allowedUserIds + plan-tier restricted to a different plan → denied (the real incident this fixed: an admin-configured allowed_plan_ids restriction must actually take effect)", async () => {
    freshSut();
    planSvc.getConfig.mockResolvedValue([{ _id: "market_trends", allowed_plan_ids: [102] }]);
    planSvc.getFilterStatus.mockReturnValue({ market_trends: { enabled: false } }); // e.g. allowed_plan_ids: [102], this user is on 101
    const req = { user: { id: 999, plan_id: 101 } };
    const res = mkRes();
    await lastHandler("/access")(req, res);
    expect(res.body.data.enabled).toBe(false);
  });

  it("allowed_plan_ids:null is directly treated as unrestricted even if shared status is stale", async () => {
    freshSut();
    planSvc.getConfig.mockResolvedValue([{ _id: "market_trends", allowed_plan_ids: null }]);
    planSvc.getFilterStatus.mockReturnValue({ market_trends: { enabled: false } });
    const res = mkRes();
    await lastHandler("/access")({ user: { id: 999, plan_id: 36 } }, res);
    expect(res.body.data.enabled).toBe(true);
  });

  it("mechanism 1 only: unlisted user_id but their plan's market_trends filter is enabled → enabled=true", async () => {
    configExports.intelligence.allowedUserIds = [1, 2, 3];
    freshSut();
    planSvc.getConfig.mockResolvedValue([{ _id: "market_trends" }]); // non-empty → isAllowedByPlan proceeds
    planSvc.getFilterStatus.mockReturnValue({ market_trends: { enabled: true } });
    const req = { user: { id: 999, plan_id: 103 } };
    const res = mkRes();
    await lastHandler("/access")(req, res);
    expect(res.body.data.enabled).toBe(true);
  });

  it("mechanism 2 only: listed user_id but plan's market_trends filter is disabled → still enabled=true (mechanism 1 wins)", async () => {
    configExports.intelligence.allowedUserIds = [42];
    freshSut();
    planSvc.getFilterStatus.mockReturnValue({ market_trends: { enabled: false } });
    const req = { user: { id: 42, plan_id: 101 } };
    const res = mkRes();
    await lastHandler("/access")(req, res);
    expect(res.body.data.enabled).toBe(true);
  });

  it("neither mechanism grants access → enabled=false", async () => {
    configExports.intelligence.allowedUserIds = [1, 2, 3];
    freshSut();
    planSvc.getFilterStatus.mockReturnValue({ market_trends: { enabled: false } });
    const req = { user: { id: 999, plan_id: 101 } };
    const res = mkRes();
    await lastHandler("/access")(req, res);
    expect(res.body.data.enabled).toBe(false);
  });

  it("mechanism 2 lookup throwing doesn't block mechanism 1 when the user IS explicitly listed", async () => {
    configExports.intelligence.allowedUserIds = [5];
    freshSut();
    planSvc.getConfig.mockRejectedValue(new Error("db-down"));
    const req = { user: { id: 5, plan_id: 101 } };
    const res = mkRes();
    await lastHandler("/access")(req, res);
    expect(res.body.data.enabled).toBe(true); // mechanism 1 (listed override) still grants it
  });

  it("no plan_id/userSubscriptionType at all → mechanism 2 contributes false, doesn't throw", async () => {
    configExports.intelligence.allowedUserIds = [1];
    freshSut();
    const req = { user: { id: 999 } };
    const res = mkRes();
    await lastHandler("/access")(req, res);
    expect(res.body.data.enabled).toBe(false);
  });

  it("stage is read from plan_access_config's market_trends doc (label only, independent of enabled)", async () => {
    freshSut();
    planSvc.getConfig.mockResolvedValue([{ _id: "market_trends", stage: "ga" }]);
    const req = { user: { id: 1 } };
    const res = mkRes();
    await lastHandler("/access")(req, res);
    expect(res.body.data.stage).toBe("ga");
  });

  it("defaults stage to 'beta' when the doc/field is missing", async () => {
    freshSut();
    const req = { user: { id: 1 } };
    const res = mkRes();
    await lastHandler("/access")(req, res);
    expect(res.body.data.stage).toBe("beta");
  });
});

describe("marketTrends router > accessGuard (via /trends/overview)", () => {
  it("plan-tier grants access (open market_trends doc) even with an empty allow-list", async () => {
    freshSut();
    planSvc.getConfig.mockResolvedValue([{ _id: "market_trends" }]);
    planSvc.getFilterStatus.mockReturnValue({ market_trends: { enabled: true } });
    const res = mkRes();
    const next = vi.fn();
    await guardHandler("/trends/overview")({ user: { id: 7, plan_id: 101 } }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("neither mechanism → 403 + showSubscriptionModal", async () => {
    configExports.intelligence.allowedUserIds = [1, 2, 3];
    freshSut();
    planSvc.getFilterStatus.mockReturnValue({ market_trends: { enabled: false } });
    const res = mkRes();
    const next = vi.fn();
    await guardHandler("/trends/overview")({ user: { id: 999, plan_id: 101 } }, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body.showSubscriptionModal).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });

  it("mechanism 1 (userId allow-list) grants access even on a plan that wouldn't qualify", async () => {
    configExports.intelligence.allowedUserIds = [2];
    freshSut();
    planSvc.getFilterStatus.mockReturnValue({ market_trends: { enabled: false } });
    const res = mkRes();
    const next = vi.fn();
    await guardHandler("/trends/overview")({ user: { id: 2, plan_id: 101 } }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("mechanism 2 (plan tier) grants access even when not in the userId allow-list", async () => {
    configExports.intelligence.allowedUserIds = [1, 2, 3];
    freshSut();
    planSvc.getConfig.mockResolvedValue([{ _id: "market_trends" }]); // non-empty → isAllowedByPlan proceeds
    planSvc.getFilterStatus.mockReturnValue({ market_trends: { enabled: true } });
    const res = mkRes();
    const next = vi.fn();
    await guardHandler("/trends/overview")({ user: { id: 999, plan_id: 103 } }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("falls back to req.body.user_id / req.query.user_id when req.user.id is absent", async () => {
    configExports.intelligence.allowedUserIds = [5];
    freshSut();
    const res = mkRes();
    const next = vi.fn();
    await guardHandler("/trends/overview")({ body: { user_id: 5 }, user: {} }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

// 2026-07-14: Market Trends previously had NO server-side network restriction at
// all — the frontend's network chips only looked restricted; a direct API call
// (devtools/curl) with any network param worked regardless of plan. This closes
// that gap: the requested network is clamped to the plan's real allowedPlatforms.
describe("marketTrends router > restrictNetworkToPlan (via /trends/overview)", () => {
  it("no plan_id at all → no restriction applied (allow-list override testers aren't network-limited)", async () => {
    freshSut();
    const req = { user: { id: 1 }, query: { network: "youtube" } };
    const res = mkRes();
    const next = vi.fn();
    await networkMw("/trends/overview")(req, res, next);
    expect(req.query.network).toBe("youtube");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("requested network not in the plan's allowedPlatforms → clamped to the plan's allowed set", async () => {
    freshSut();
    planSvc.getConfig.mockResolvedValue([{ _id: "platform_access" }]);
    planSvc.getAllowedPlatforms.mockReturnValue(["facebook", "instagram"]);
    const req = { user: { plan_id: 101 }, query: { network: "youtube" } };
    const res = mkRes();
    const next = vi.fn();
    await networkMw("/trends/overview")(req, res, next);
    expect(req.query.network).toBe("facebook,instagram");
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("requested network IS in the plan's allowedPlatforms → passes through unchanged", async () => {
    freshSut();
    planSvc.getConfig.mockResolvedValue([{ _id: "platform_access" }]);
    planSvc.getAllowedPlatforms.mockReturnValue(["facebook", "instagram", "youtube"]);
    const req = { user: { plan_id: 103 }, query: { network: "youtube" } };
    const res = mkRes();
    const next = vi.fn();
    await networkMw("/trends/overview")(req, res, next);
    expect(req.query.network).toBe("youtube");
  });

  it("network='all' (or absent) → clamped to the full allowed set, not left as 'all'", async () => {
    freshSut();
    planSvc.getConfig.mockResolvedValue([{ _id: "platform_access" }]);
    planSvc.getAllowedPlatforms.mockReturnValue(["facebook", "instagram"]);
    const req = { user: { plan_id: 101 }, query: {} };
    const res = mkRes();
    const next = vi.fn();
    await networkMw("/trends/overview")(req, res, next);
    expect(req.query.network).toBe("facebook,instagram");
  });

  it("empty allowedPlatforms (nothing configured) → no restriction applied", async () => {
    freshSut();
    planSvc.getConfig.mockResolvedValue([{ _id: "platform_access" }]);
    planSvc.getAllowedPlatforms.mockReturnValue([]);
    const req = { user: { plan_id: 101 }, query: { network: "youtube" } };
    const res = mkRes();
    const next = vi.fn();
    await networkMw("/trends/overview")(req, res, next);
    expect(req.query.network).toBe("youtube");
  });

  it("lookup throws → fails open, next() still called, request left unrestricted", async () => {
    freshSut();
    planSvc.getConfig.mockRejectedValue(new Error("db-down"));
    const req = { user: { plan_id: 101 }, query: { network: "youtube" } };
    const res = mkRes();
    const next = vi.fn();
    await networkMw("/trends/overview")(req, res, next);
    expect(req.query.network).toBe("youtube");
    expect(next).toHaveBeenCalledTimes(1);
  });
});
