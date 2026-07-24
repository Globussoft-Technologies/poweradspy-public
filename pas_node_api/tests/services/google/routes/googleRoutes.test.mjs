import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const expressPath = require.resolve("express");
const routerInstances = [];
function FakeRouter() {
  const r = {
    routes: { get: {}, post: {} },
    uses: [],
    use: vi.fn((path, ...rest) => { r.uses.push({ path, handlers: rest }); }),
    get: vi.fn((path, ...rest) => { r.routes.get[path] = rest; }),
    post: vi.fn((path, ...rest) => { r.routes.post[path] = rest; }),
  };
  routerInstances.push(r);
  return r;
}
require.cache[expressPath] = { id: expressPath, filename: expressPath, loaded: true, exports: { Router: FakeRouter } };

const errHandlerPath = require.resolve("../../../../src/middleware/errorHandler");
require.cache[errHandlerPath] = {
  id: errHandlerPath, filename: errHandlerPath, loaded: true,
  exports: { asyncHandler: (fn) => fn, AppError: class {} },
};

const respPath = require.resolve("../../../../src/utils/responseFormatter");
const ResponseFormatter = { success: vi.fn((res, p) => res.status(200).json(p)) };
require.cache[respPath] = { id: respPath, filename: respPath, loaded: true, exports: ResponseFormatter };

function mkCtrlMock(filename, exportName) {
  const p = require.resolve(`../../../../src/services/google/controllers/${filename}`);
  if (Array.isArray(exportName)) {
    const ex = {};
    for (const n of exportName) ex[n] = vi.fn();
    require.cache[p] = { id: p, filename: p, loaded: true, exports: ex };
    return ex;
  }
  const fn = vi.fn();
  require.cache[p] = { id: p, filename: p, loaded: true, exports: { [exportName]: fn } };
  return fn;
}
const searchAds = mkCtrlMock("adSearchController", "searchAds");
const getTopAds = mkCtrlMock("getTopAdsController", "getTopAds");
const getAdsCount = mkCtrlMock("adCountController", "getAdsCount");
const getAdDetails = mkCtrlMock("adDetailController", "getAdDetails");
const hideExports = mkCtrlMock("hideAdsController", ["hideAds", "getHiddenPostOwners", "unHide"]);
const insightsExports = mkCtrlMock("adInsightsController", [
  "getLikeCommentShareDetails", "getGoogleAdCountry", "getGoogleOutgoings",
  "getAdvertiserCountryData", "getAdvertiserInsightsByDateRange",
]);

const authMwPath = require.resolve("../../../../src/middleware/auth");
require.cache[authMwPath] = {
  id: authMwPath, filename: authMwPath, loaded: true,
  exports: { authMiddleware: vi.fn((req, res, next) => next()), generateToken: vi.fn() },
};
const validatorPath = require.resolve("../../../../src/middleware/validator");
require.cache[validatorPath] = {
  id: validatorPath, filename: validatorPath, loaded: true,
  exports: vi.fn(() => (req, res, next) => next()),
};

const { createGoogleRoutes } = require(
  "../../../../src/services/google/routes/googleRoutes"
);

function mkRes() {
  const r = { statusCode: 200, body: null };
  r.status = vi.fn((c) => { r.statusCode = c; return r; });
  r.json = vi.fn((b) => { r.body = b; return r; });
  return r;
}

beforeEach(() => {
  routerInstances.length = 0;
  ResponseFormatter.success.mockClear();
  for (const fn of [searchAds, getTopAds, getAdsCount, getAdDetails, ...Object.values(hideExports), ...Object.values(insightsExports)]) fn.mockReset();
});

function lastHandler(router, method, path) {
  const stack = router.routes[method][path];
  return stack[stack.length - 1];
}

const svc = { db: {}, log: { info: vi.fn() } };

describe("googleRoutes > registration", () => {
  it("registers all endpoints", () => {
    const router = createGoogleRoutes(svc);
    for (const p of [
      "/ads/search", "/ads/getTopAds", "/ads/detail", "/ads/getAdDetails",
      "/ads/getLikeCommentShareDetails", "/ads/getGoogleAdCountry",
      "/ads/getGoogleOutgoings", "/ads/getAdvertiserCountryData",
      "/ads/getAdvertiserInsightsByDateRange", "/ads/hide_ads",
      "/ads/getHiddenPostOwners", "/ads/un-hide",
    ]) expect(router.routes.post[p]).toBeDefined();
    expect(router.routes.get["/ads/count"]).toBeDefined();
  });
});

describe("googleRoutes > ResponseFormatter paths", () => {
  it("/ads/search 200 → success", async () => {
    searchAds.mockResolvedValue({ code: 200, data: [], total: 0 });
    await lastHandler(createGoogleRoutes(svc), "post", "/ads/search")({ body: {} }, mkRes());
    expect(ResponseFormatter.success).toHaveBeenCalled();
  });
  it("/ads/search non-200", async () => {
    searchAds.mockResolvedValue({ code: 503 });
    const res = mkRes();
    await lastHandler(createGoogleRoutes(svc), "post", "/ads/search")({ body: {} }, res);
    expect(res.statusCode).toBe(503);
  });
  it("/ads/getTopAds 200 → success", async () => {
    getTopAds.mockResolvedValue({ code: 200, data: [], total: 0 });
    await lastHandler(createGoogleRoutes(svc), "post", "/ads/getTopAds")({ body: {} }, mkRes());
    expect(ResponseFormatter.success).toHaveBeenCalled();
  });
  it("/ads/getTopAds non-200", async () => {
    getTopAds.mockResolvedValue({ code: 500 });
    const res = mkRes();
    await lastHandler(createGoogleRoutes(svc), "post", "/ads/getTopAds")({ body: {} }, res);
    expect(res.statusCode).toBe(500);
  });
  it("/ads/count 200 → success", async () => {
    getAdsCount.mockResolvedValue({ code: 200, data: { c: 1 } });
    await lastHandler(createGoogleRoutes(svc), "get", "/ads/count")({ query: {} }, mkRes());
    expect(ResponseFormatter.success).toHaveBeenCalled();
  });
  it("/ads/count non-200", async () => {
    getAdsCount.mockResolvedValue({ code: 500 });
    const res = mkRes();
    await lastHandler(createGoogleRoutes(svc), "get", "/ads/count")({ query: {} }, res);
    expect(res.statusCode).toBe(500);
  });
});

describe("googleRoutes > pass-through delegates", () => {
  const direct = [
    ["/ads/detail", getAdDetails],
    ["/ads/getAdDetails", getAdDetails],
    ["/ads/getLikeCommentShareDetails", insightsExports.getLikeCommentShareDetails],
    ["/ads/getGoogleAdCountry", insightsExports.getGoogleAdCountry],
    ["/ads/getGoogleOutgoings", insightsExports.getGoogleOutgoings],
    ["/ads/hide_ads", hideExports.hideAds],
    ["/ads/getHiddenPostOwners", hideExports.getHiddenPostOwners],
    ["/ads/un-hide", hideExports.unHide],
  ];
  it.each(direct)("%s returns controller result", async (path, ctrl) => {
    ctrl.mockResolvedValue({ code: 200, data: [] });
    const res = mkRes();
    await lastHandler(createGoogleRoutes(svc), "post", path)({ body: {} }, res);
    expect(res.statusCode).toBe(200);
  });
  it.each(direct)("%s non-200 passes through", async (path, ctrl) => {
    ctrl.mockResolvedValue({ code: 503 });
    const res = mkRes();
    await lastHandler(createGoogleRoutes(svc), "post", path)({ body: {} }, res);
    expect(res.statusCode).toBe(503);
  });

  const nullGuard = [
    ["/ads/getAdvertiserCountryData", insightsExports.getAdvertiserCountryData],
    ["/ads/getAdvertiserInsightsByDateRange", insightsExports.getAdvertiserInsightsByDateRange],
  ];
  it.each(nullGuard)("%s null result → 400", async (path, ctrl) => {
    ctrl.mockResolvedValue(null);
    const res = mkRes();
    await lastHandler(createGoogleRoutes(svc), "post", path)({ body: {} }, res);
    expect(res.statusCode).toBe(400);
  });
  it.each(nullGuard)("%s 200 passes through", async (path, ctrl) => {
    ctrl.mockResolvedValue({ code: 200, data: [] });
    const res = mkRes();
    await lastHandler(createGoogleRoutes(svc), "post", path)({ body: {} }, res);
    expect(res.statusCode).toBe(200);
  });
  it.each(nullGuard)("%s non-200 result.code propagates (ternary false branch)", async (path, ctrl) => {
    ctrl.mockResolvedValue({ code: 503, message: "es-down" });
    const res = mkRes();
    await lastHandler(createGoogleRoutes(svc), "post", path)({ body: {} }, res);
    expect(res.statusCode).toBe(503);
  });
});
