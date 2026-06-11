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
  };
  routerInstances.push(r);
  return r;
}
require.cache[expressPath] = {
  id: expressPath, filename: expressPath, loaded: true,
  exports: { Router: FakeRouter },
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

// Pre-mock all controllers
function mkCtrlMock(filename, exportName) {
  const p = require.resolve(`../../../../src/services/facebook/controllers/${filename}`);
  const fn = vi.fn();
  if (Array.isArray(exportName)) {
    const exports = {};
    for (const name of exportName) exports[name] = vi.fn();
    require.cache[p] = { id: p, filename: p, loaded: true, exports };
    return exports;
  }
  require.cache[p] = { id: p, filename: p, loaded: true, exports: { [exportName]: fn } };
  return fn;
}
const searchAds = mkCtrlMock("adSearchController", "searchAds");
const getAdDetails = mkCtrlMock("adDetailController", "getAdDetails");
const getAdsCount = mkCtrlMock("adCountController", "getAdsCount");
const hideExports = mkCtrlMock("hideAdsController", ["hideAds", "getHiddenPostOwners", "unHide"]);
const insightsExports = mkCtrlMock("adInsightsController", [
  "getLikeCommentShareDetails", "getFacebookAdCountry", "getFacebookUserData",
  "getFacebookOutgoings", "getAdsPageDetails", "getAdvertiserInsightsByDateRange",
]);
const getAdsByAdvertiser = mkCtrlMock("getAdsByAdvertiserController", "getAdsByAdvertiser");

const authMwPath = require.resolve("../../../../src/middleware/auth");
const authMiddleware = vi.fn((req, res, next) => next());
require.cache[authMwPath] = {
  id: authMwPath, filename: authMwPath, loaded: true,
  exports: { authMiddleware, generateToken: vi.fn() },
};

const freePlanCheckPath = require.resolve("../../../../src/middleware/freePlanCheck");
require.cache[freePlanCheckPath] = {
  id: freePlanCheckPath, filename: freePlanCheckPath, loaded: true,
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

const { createFacebookRoutes } = require(
  "../../../../src/services/facebook/routes/facebookRoutes"
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
  for (const fn of [searchAds, getAdDetails, getAdsCount, getAdsByAdvertiser, ...Object.values(hideExports), ...Object.values(insightsExports)]) {
    fn.mockReset();
  }
});

function lastHandler(router, method, path) {
  const stack = router.routes[method][path];
  return stack[stack.length - 1];
}

const svc = { db: {}, log: { info: vi.fn() } };

describe("facebookRoutes > createFacebookRoutes registration", () => {
  it("registers all expected routes", () => {
    const router = createFacebookRoutes(svc);
    expect(router.routes.post["/ads/search"]).toBeDefined();
    expect(router.routes.post["/ads/detail"]).toBeDefined();
    expect(router.routes.get["/ads/count"]).toBeDefined();
    expect(router.routes.post["/ads/hide_ads"]).toBeDefined();
    expect(router.routes.post["/ads/getHiddenPostOwners"]).toBeDefined();
    expect(router.routes.post["/ads/un-hide"]).toBeDefined();
    expect(router.routes.post["/ads/getLikeCommentShareDetails"]).toBeDefined();
    expect(router.routes.post["/ads/getFacebookAdCountry"]).toBeDefined();
    expect(router.routes.post["/ads/getFacebookUserData"]).toBeDefined();
    expect(router.routes.post["/ads/getFacebookOutgoings"]).toBeDefined();
    expect(router.routes.post["/ads/getAdsPageDetails"]).toBeDefined();
    expect(router.routes.post["/ads/getAdvertiserInsightsByDateRange"]).toBeDefined();
    expect(router.routes.post["/ads/getAdsByAdvertiser"]).toBeDefined();
  });
});

describe("facebookRoutes > /ads/search handler", () => {
  it("200 → uses ResponseFormatter.success", async () => {
    searchAds.mockResolvedValue({ code: 200, data: [], total: 0 });
    const router = createFacebookRoutes(svc);
    const res = mkRes();
    await lastHandler(router, "post", "/ads/search")({ body: {}, query: {} }, res);
    expect(ResponseFormatter.success).toHaveBeenCalled();
  });
  it("non-200 → passes through with status", async () => {
    searchAds.mockResolvedValue({ code: 503, message: "down" });
    const router = createFacebookRoutes(svc);
    const res = mkRes();
    await lastHandler(router, "post", "/ads/search")({ body: {} }, res);
    expect(res.statusCode).toBe(503);
  });
});

describe("facebookRoutes > /ads/detail handler", () => {
  it("200 → uses ResponseFormatter.success with country meta", async () => {
    getAdDetails.mockResolvedValue({ code: 200, data: [{}], country: ["US"], builtwithStatusCode: 501 });
    const router = createFacebookRoutes(svc);
    const res = mkRes();
    await lastHandler(router, "post", "/ads/detail")({ body: {} }, res);
    expect(ResponseFormatter.success).toHaveBeenCalled();
    const payload = ResponseFormatter.success.mock.calls[0][1];
    expect(payload.meta.country).toEqual(["US"]);
  });
  it("non-200 → passes through", async () => {
    getAdDetails.mockResolvedValue({ code: 404 });
    const router = createFacebookRoutes(svc);
    const res = mkRes();
    await lastHandler(router, "post", "/ads/detail")({ body: {} }, res);
    expect(res.statusCode).toBe(404);
  });
});

describe("facebookRoutes > /ads/count handler", () => {
  it("200 → uses ResponseFormatter.success with data", async () => {
    getAdsCount.mockResolvedValue({ code: 200, data: { count: 100 } });
    const router = createFacebookRoutes(svc);
    const res = mkRes();
    await lastHandler(router, "get", "/ads/count")({ query: {} }, res);
    expect(ResponseFormatter.success).toHaveBeenCalled();
  });
  it("non-200 → passes through", async () => {
    getAdsCount.mockResolvedValue({ code: 500 });
    const router = createFacebookRoutes(svc);
    const res = mkRes();
    await lastHandler(router, "get", "/ads/count")({ query: {} }, res);
    expect(res.statusCode).toBe(500);
  });
});

describe("facebookRoutes > pass-through delegate handlers", () => {
  const delegateRoutes = [
    ["/ads/hide_ads", hideExports.hideAds],
    ["/ads/getHiddenPostOwners", hideExports.getHiddenPostOwners],
    ["/ads/un-hide", hideExports.unHide],
    ["/ads/getLikeCommentShareDetails", insightsExports.getLikeCommentShareDetails],
    ["/ads/getFacebookAdCountry", insightsExports.getFacebookAdCountry],
    ["/ads/getFacebookUserData", insightsExports.getFacebookUserData],
    ["/ads/getFacebookOutgoings", insightsExports.getFacebookOutgoings],
    ["/ads/getAdsPageDetails", insightsExports.getAdsPageDetails],
    ["/ads/getAdvertiserInsightsByDateRange", insightsExports.getAdvertiserInsightsByDateRange],
    ["/ads/getAdsByAdvertiser", getAdsByAdvertiser],
  ];
  it.each(delegateRoutes)("%s returns controller result via status+json", async (path, ctrlMock) => {
    ctrlMock.mockResolvedValue({ code: 200, data: [] });
    const router = createFacebookRoutes(svc);
    const res = mkRes();
    await lastHandler(router, "post", path)({ body: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.code).toBe(200);
    expect(ctrlMock).toHaveBeenCalledWith({ body: {} }, svc.db, svc.log);
  });
  it.each(delegateRoutes)("%s passes through non-200 code", async (path, ctrlMock) => {
    ctrlMock.mockResolvedValue({ code: 503, message: "down" });
    const router = createFacebookRoutes(svc);
    const res = mkRes();
    await lastHandler(router, "post", path)({ body: {} }, res);
    expect(res.statusCode).toBe(503);
  });
});
