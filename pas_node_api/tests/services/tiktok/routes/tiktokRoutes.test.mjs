import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── Mock express.Router to capture route handlers ──────────────────────────
const expressPath = require.resolve("express");
const handlers = { get: {}, post: {} };
function fakeRouter() {
  return {
    get: vi.fn((path, ...fns) => { handlers.get[path] = fns; }),
    post: vi.fn((path, ...fns) => { handlers.post[path] = fns; }),
    use: vi.fn(),
  };
}
const fakeExpress = function () { return fakeRouter(); };
fakeExpress.Router = fakeRouter;
require.cache[expressPath] = {
  id: expressPath, filename: expressPath, loaded: true, exports: fakeExpress,
};

// ── Mock middleware ─────────────────────────────────────────────────────────
const errorPath = require.resolve("../../../../src/middleware/errorHandler");
const asyncHandler = (fn) => fn; // pass-through
require.cache[errorPath] = {
  id: errorPath, filename: errorPath, loaded: true,
  exports: { asyncHandler },
};

const authPath = require.resolve("../../../../src/middleware/auth");
const authMiddleware = vi.fn((req, res, next) => next && next());
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: { authMiddleware },
};

const validatorPath = require.resolve("../../../../src/middleware/validator");
const validator = vi.fn(() => (req, res, next) => next && next());
require.cache[validatorPath] = {
  id: validatorPath, filename: validatorPath, loaded: true,
  exports: { default: validator },
};
// Some modules use require()-style default; the SUT does `require('...../validator')`.
// Replace exports with the function form too:
require.cache[validatorPath].exports = validator;

// ── Mock ResponseFormatter ──────────────────────────────────────────────────
const rfPath = require.resolve("../../../../src/utils/responseFormatter");
const successSpy = vi.fn((res, payload) => res.json({ ok: true, ...payload }));
require.cache[rfPath] = {
  id: rfPath, filename: rfPath, loaded: true,
  exports: { success: successSpy },
};
// SUT uses default-style import: `const ResponseFormatter = require(...)`; expose
// the whole module so .success() works on it.
require.cache[rfPath].exports = { success: successSpy };

// ── Mock controllers ────────────────────────────────────────────────────────
function stubController(method) {
  const spy = vi.fn();
  return [method, spy];
}

const adSearchPath = require.resolve("../../../../src/services/tiktok/controllers/adSearchController");
const searchAds = vi.fn();
require.cache[adSearchPath] = { id: adSearchPath, filename: adSearchPath, loaded: true, exports: { searchAds } };

const adCountPath = require.resolve("../../../../src/services/tiktok/controllers/adCountController");
const getAdsCount = vi.fn();
require.cache[adCountPath] = { id: adCountPath, filename: adCountPath, loaded: true, exports: { getAdsCount } };

const adInsightsPath = require.resolve("../../../../src/services/tiktok/controllers/adInsightsController");
const getLCS = vi.fn();
const getAnalytics = vi.fn();
const getIndustries = vi.fn();
const getAdvertiserInsightsByDateRange = vi.fn();
require.cache[adInsightsPath] = {
  id: adInsightsPath, filename: adInsightsPath, loaded: true,
  exports: { getLCS, getAnalytics, getIndustries, getAdvertiserInsightsByDateRange },
};

const hideAdsPath = require.resolve("../../../../src/services/tiktok/controllers/hideAdsController");
const hideAds = vi.fn();
const getHiddenPostOwners = vi.fn();
const unHide = vi.fn();
require.cache[hideAdsPath] = {
  id: hideAdsPath, filename: hideAdsPath, loaded: true,
  exports: { hideAds, getHiddenPostOwners, unHide },
};

const videoRefreshPath = require.resolve("../../../../src/services/tiktok/controllers/videoRefreshController");
const refreshVideoUrl = vi.fn();
require.cache[videoRefreshPath] = {
  id: videoRefreshPath, filename: videoRefreshPath, loaded: true,
  exports: { refreshVideoUrl },
};

const videoProxyPath = require.resolve("../../../../src/services/tiktok/controllers/videoProxyController");
const proxyTikTokVideo = vi.fn();
require.cache[videoProxyPath] = {
  id: videoProxyPath, filename: videoProxyPath, loaded: true,
  exports: { proxyTikTokVideo },
};

const { createTiktokRoutes } = require("../../../../src/services/tiktok/routes/tiktokRoutes");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.set = vi.fn(() => res);
  return res;
}

let service;
beforeEach(() => {
  Object.keys(handlers.get).forEach((k) => delete handlers.get[k]);
  Object.keys(handlers.post).forEach((k) => delete handlers.post[k]);
  [searchAds, getAdsCount, getLCS, getAnalytics, getIndustries, getAdvertiserInsightsByDateRange,
   hideAds, getHiddenPostOwners, unHide, refreshVideoUrl, proxyTikTokVideo, successSpy].forEach((s) => s.mockReset && s.mockReset());
  service = { db: { mark: "db" }, log: { info: vi.fn(), error: vi.fn() } };
  createTiktokRoutes(service);
});

function lastHandler(method, path) {
  return handlers[method][path][handlers[method][path].length - 1];
}

describe("services/tiktok/routes/tiktokRoutes > all routes registered", () => {
  it("registers every documented route", () => {
    expect(handlers.post["/ads/search"]).toBeDefined();
    expect(handlers.get["/ads/count"]).toBeDefined();
    expect(handlers.get["/ads/getIndustries"]).toBeDefined();
    expect(handlers.post["/ads/getLCS"]).toBeDefined();
    expect(handlers.post["/ads/analytics"]).toBeDefined();
    expect(handlers.post["/ads/hide_ads"]).toBeDefined();
    expect(handlers.post["/ads/getHiddenPostOwners"]).toBeDefined();
    expect(handlers.post["/ads/un-hide"]).toBeDefined();
    expect(handlers.post["/ads/getAdvertiserInsightsByDateRange"]).toBeDefined();
    expect(handlers.post["/ads/refresh-video"]).toBeDefined();
    expect(handlers.get["/ads/video-proxy"]).toBeDefined();
  });
});

describe("services/tiktok/routes/tiktokRoutes > POST /ads/search", () => {
  it("200 → ResponseFormatter.success with data + meta.total", async () => {
    searchAds.mockResolvedValueOnce({ code: 200, data: [1, 2], total: 99 });
    const res = mockRes();
    await lastHandler("post", "/ads/search")({}, res);
    expect(successSpy).toHaveBeenCalledWith(res, expect.objectContaining({
      data: [1, 2],
      meta: { total: 99 },
    }));
  });

  it("non-200 → res.status(code).json(result)", async () => {
    searchAds.mockResolvedValueOnce({ code: 500, message: "err" });
    const res = mockRes();
    await lastHandler("post", "/ads/search")({}, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ code: 500, message: "err" });
  });
});

describe("services/tiktok/routes/tiktokRoutes > GET /ads/count", () => {
  it("200 → ResponseFormatter.success with data", async () => {
    getAdsCount.mockResolvedValueOnce({ code: 200, data: { count: 5 } });
    const res = mockRes();
    await lastHandler("get", "/ads/count")({}, res);
    expect(successSpy).toHaveBeenCalledWith(res, { data: { count: 5 } });
  });

  it("non-200 → status + json", async () => {
    getAdsCount.mockResolvedValueOnce({ code: 503, message: "es-down" });
    const res = mockRes();
    await lastHandler("get", "/ads/count")({}, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });
});

describe("services/tiktok/routes/tiktokRoutes > simple pass-through routes", () => {
  it.each([
    ["get",  "/ads/getIndustries", () => getIndustries],
    ["post", "/ads/getLCS",        () => getLCS],
    ["post", "/ads/analytics",     () => getAnalytics],
    ["post", "/ads/hide_ads",      () => hideAds],
    ["post", "/ads/getHiddenPostOwners", () => getHiddenPostOwners],
    ["post", "/ads/un-hide",       () => unHide],
    ["post", "/ads/getAdvertiserInsightsByDateRange", () => getAdvertiserInsightsByDateRange],
  ])("%s %s returns res.status(code).json(result)", async (method, path, getCtrl) => {
    const ctrl = getCtrl();
    ctrl.mockResolvedValueOnce({ code: 200, data: { ok: 1 } });
    const res = mockRes();
    await lastHandler(method, path)({}, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ code: 200, data: { ok: 1 } });
  });

  it.each([
    ["get",  "/ads/getIndustries", () => getIndustries],
    ["post", "/ads/getLCS",        () => getLCS],
    ["post", "/ads/analytics",     () => getAnalytics],
    ["post", "/ads/hide_ads",      () => hideAds],
    ["post", "/ads/getHiddenPostOwners", () => getHiddenPostOwners],
    ["post", "/ads/un-hide",       () => unHide],
    ["post", "/ads/getAdvertiserInsightsByDateRange", () => getAdvertiserInsightsByDateRange],
  ])("%s %s preserves non-200 code (e.g. 401)", async (method, path, getCtrl) => {
    const ctrl = getCtrl();
    ctrl.mockResolvedValueOnce({ code: 401, message: "Unauthorized" });
    const res = mockRes();
    await lastHandler(method, path)({}, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe("services/tiktok/routes/tiktokRoutes > POST /ads/refresh-video", () => {
  it("200 → ResponseFormatter.success", async () => {
    refreshVideoUrl.mockResolvedValueOnce({ code: 200, data: { url: "https://new.video" } });
    const res = mockRes();
    await lastHandler("post", "/ads/refresh-video")({}, res);
    expect(successSpy).toHaveBeenCalledWith(res, { data: { url: "https://new.video" } });
  });

  it("non-200 → status+json", async () => {
    refreshVideoUrl.mockResolvedValueOnce({ code: 500, message: "refresh-fail" });
    const res = mockRes();
    await lastHandler("post", "/ads/refresh-video")({}, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("services/tiktok/routes/tiktokRoutes > GET /ads/video-proxy", () => {
  it("delegates to proxyTikTokVideo(req, res, service.log)", async () => {
    const req = { query: { url: "https://v16.tiktokcdn.com/x.mp4" } };
    const res = mockRes();
    proxyTikTokVideo.mockResolvedValueOnce(undefined);
    await lastHandler("get", "/ads/video-proxy")(req, res);
    expect(proxyTikTokVideo).toHaveBeenCalledWith(req, res, service.log);
  });
});
