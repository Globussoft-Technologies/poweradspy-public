import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const expressPath = require.resolve("express");
const routerInstances = [];
function FakeRouter() {
  const r = {
    routes: { get: {}, post: {} },
    get: vi.fn((path, ...rest) => { r.routes.get[path] = rest; }),
    post: vi.fn((path, ...rest) => { r.routes.post[path] = rest; }),
    use: vi.fn(),
  };
  routerInstances.push(r);
  return r;
}
require.cache[expressPath] = {
  id: expressPath, filename: expressPath, loaded: true, exports: { Router: FakeRouter },
};

const errHandlerPath = require.resolve("../../../../src/middleware/errorHandler");
const asyncHandler = (fn) => fn;
require.cache[errHandlerPath] = {
  id: errHandlerPath, filename: errHandlerPath, loaded: true,
  exports: { asyncHandler, AppError: class {} },
};

const respPath = require.resolve("../../../../src/utils/responseFormatter");
const ResponseFormatter = { success: vi.fn((res, payload) => res.status(200).json(payload)) };
require.cache[respPath] = {
  id: respPath, filename: respPath, loaded: true, exports: ResponseFormatter,
};

function mkCtrlMock(filename, exportName) {
  const p = require.resolve(`../../../../src/services/instagram/controllers/${filename}`);
  if (Array.isArray(exportName)) {
    const exports = {};
    for (const name of exportName) exports[name] = vi.fn();
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
    return exports;
  }
  const fn = vi.fn();
  require.cache[p] = { id: p, filename: p, loaded: true, exports: { [exportName]: fn } };
  return fn;
}
const searchAds = mkCtrlMock("adSearchController", "searchAds");
const getAdDetails = mkCtrlMock("adDetailController", "getAdDetails");
const getAdsCount = mkCtrlMock("adCountController", "getAdsCount");
const hideExports = mkCtrlMock("hideAdsController", ["hideAds", "getHiddenPostOwners", "unHide"]);
const insightsExports = mkCtrlMock("adInsightsController", [
  "getLikeCommentShareDetails", "getInstagramAdCountry", "getInstagramUserData",
  "getRedirectOutgoingUrls", "getAdsLibUserData", "getAdvertiserLCSData",
  "getAdvertiserCountryData", "getAdvertiserInsightsByDateRange",
]);

const authMwPath = require.resolve("../../../../src/middleware/auth");
require.cache[authMwPath] = {
  id: authMwPath, filename: authMwPath, loaded: true,
  exports: { authMiddleware: vi.fn((req, res, next) => next()), generateToken: vi.fn() },
};
const freePlanPath = require.resolve("../../../../src/middleware/freePlanCheck");
require.cache[freePlanPath] = {
  id: freePlanPath, filename: freePlanPath, loaded: true,
  exports: { freePlanCheck: vi.fn((req, res, next) => next()) },
};
const planAccessPath = require.resolve("../../../../src/middleware/planAccess");
require.cache[planAccessPath] = {
  id: planAccessPath, filename: planAccessPath, loaded: true,
  exports: {
    planAccessMiddleware: vi.fn((req, res, next) => next()),
    requirePlatform: vi.fn(() => (req, res, next) => next()),
  },
};
const validatorPath = require.resolve("../../../../src/middleware/validator");
require.cache[validatorPath] = {
  id: validatorPath, filename: validatorPath, loaded: true,
  exports: vi.fn(() => (req, res, next) => next()),
};

const { createInstagramRoutes } = require(
  "../../../../src/services/instagram/routes/instagramRoutes"
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
  for (const fn of [searchAds, getAdDetails, getAdsCount, ...Object.values(hideExports), ...Object.values(insightsExports)]) {
    fn.mockReset();
  }
});

function lastHandler(router, method, path) {
  const stack = router.routes[method][path];
  return stack[stack.length - 1];
}

const svc = { db: {}, log: { info: vi.fn() } };

describe("instagramRoutes > registration", () => {
  it("registers every endpoint", () => {
    const router = createInstagramRoutes(svc);
    for (const p of [
      "/ads/search", "/ads/detail", "/ads/hide_ads", "/ads/getHiddenPostOwners",
      "/ads/getLikeCommentShareDetails", "/ads/getInstagramAdCountry",
      "/ads/getInstagramUserData", "/ads/getRedirectOutgoingUrls",
      "/ads/getAdsLibUserData", "/ads/getAdvertiserLCSData",
      "/ads/getAdvertiserCountryData", "/ads/getAdvertiserInsightsByDateRange",
      "/ads/un-hide",
    ]) expect(router.routes.post[p]).toBeDefined();
    expect(router.routes.get["/ads/count"]).toBeDefined();
  });
});

describe("instagramRoutes > /ads/search", () => {
  it("200 path uses ResponseFormatter.success", async () => {
    searchAds.mockResolvedValue({ code: 200, data: [], total: 0 });
    await lastHandler(createInstagramRoutes(svc), "post", "/ads/search")({ body: {} }, mkRes());
    expect(ResponseFormatter.success).toHaveBeenCalled();
  });
  it("non-200 passes through", async () => {
    searchAds.mockResolvedValue({ code: 503 });
    const res = mkRes();
    await lastHandler(createInstagramRoutes(svc), "post", "/ads/search")({ body: {} }, res);
    expect(res.statusCode).toBe(503);
  });
});

describe("instagramRoutes > /ads/detail", () => {
  it("200 path with country meta", async () => {
    getAdDetails.mockResolvedValue({ code: 200, data: [{}], country: ["US"], builtwithStatusCode: 200 });
    await lastHandler(createInstagramRoutes(svc), "post", "/ads/detail")({ body: {} }, mkRes());
    expect(ResponseFormatter.success).toHaveBeenCalled();
  });
  it("non-200 passes through", async () => {
    getAdDetails.mockResolvedValue({ code: 404 });
    const res = mkRes();
    await lastHandler(createInstagramRoutes(svc), "post", "/ads/detail")({ body: {} }, res);
    expect(res.statusCode).toBe(404);
  });
});

describe("instagramRoutes > /ads/count", () => {
  it("200 path", async () => {
    getAdsCount.mockResolvedValue({ code: 200, data: { count: 5 } });
    await lastHandler(createInstagramRoutes(svc), "get", "/ads/count")({ query: {} }, mkRes());
    expect(ResponseFormatter.success).toHaveBeenCalled();
  });
  it("non-200 passes through", async () => {
    getAdsCount.mockResolvedValue({ code: 500 });
    const res = mkRes();
    await lastHandler(createInstagramRoutes(svc), "get", "/ads/count")({ query: {} }, res);
    expect(res.statusCode).toBe(500);
  });
});

describe("instagramRoutes > pass-through delegates", () => {
  const directDelegates = [
    ["/ads/hide_ads", hideExports.hideAds],
    ["/ads/getHiddenPostOwners", hideExports.getHiddenPostOwners],
    ["/ads/un-hide", hideExports.unHide],
    ["/ads/getLikeCommentShareDetails", insightsExports.getLikeCommentShareDetails],
    ["/ads/getInstagramAdCountry", insightsExports.getInstagramAdCountry],
    ["/ads/getInstagramUserData", insightsExports.getInstagramUserData],
    ["/ads/getRedirectOutgoingUrls", insightsExports.getRedirectOutgoingUrls],
    ["/ads/getAdsLibUserData", insightsExports.getAdsLibUserData],
  ];
  it.each(directDelegates)("%s returns controller result", async (path, ctrl) => {
    ctrl.mockResolvedValue({ code: 200, data: [] });
    const res = mkRes();
    await lastHandler(createInstagramRoutes(svc), "post", path)({ body: {} }, res);
    expect(res.statusCode).toBe(200);
  });
  it.each(directDelegates)("%s non-200 passes through", async (path, ctrl) => {
    ctrl.mockResolvedValue({ code: 503 });
    const res = mkRes();
    await lastHandler(createInstagramRoutes(svc), "post", path)({ body: {} }, res);
    expect(res.statusCode).toBe(503);
  });

  const nullGuardDelegates = [
    ["/ads/getAdvertiserLCSData", insightsExports.getAdvertiserLCSData],
    ["/ads/getAdvertiserCountryData", insightsExports.getAdvertiserCountryData],
    ["/ads/getAdvertiserInsightsByDateRange", insightsExports.getAdvertiserInsightsByDateRange],
  ];
  it.each(nullGuardDelegates)("%s null result → 400 with 'No data found.'", async (path, ctrl) => {
    ctrl.mockResolvedValue(null);
    const res = mkRes();
    await lastHandler(createInstagramRoutes(svc), "post", path)({ body: {} }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("No data found.");
  });
  it.each(nullGuardDelegates)("%s non-null result passes through", async (path, ctrl) => {
    ctrl.mockResolvedValue({ code: 200, data: {} });
    const res = mkRes();
    await lastHandler(createInstagramRoutes(svc), "post", path)({ body: {} }, res);
    expect(res.statusCode).toBe(200);
  });
  it.each(nullGuardDelegates)("%s non-200 result.code propagates (ternary false branch)", async (path, ctrl) => {
    ctrl.mockResolvedValue({ code: 503, message: "es-down" });
    const res = mkRes();
    await lastHandler(createInstagramRoutes(svc), "post", path)({ body: {} }, res);
    expect(res.statusCode).toBe(503);
  });
});
