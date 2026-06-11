import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── Mock express.Router ─────────────────────────────────────────────────────
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
require.cache[expressPath] = { id: expressPath, filename: expressPath, loaded: true, exports: fakeExpress };

// ── Mock middleware ─────────────────────────────────────────────────────────
const errorPath = require.resolve("../../../../src/middleware/errorHandler");
require.cache[errorPath] = {
  id: errorPath, filename: errorPath, loaded: true,
  exports: { asyncHandler: (fn) => fn },
};

const authPath = require.resolve("../../../../src/middleware/auth");
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: { authMiddleware: vi.fn((req, res, next) => next && next()) },
};

const validatorPath = require.resolve("../../../../src/middleware/validator");
require.cache[validatorPath] = {
  id: validatorPath, filename: validatorPath, loaded: true,
  exports: vi.fn(() => (req, res, next) => next && next()),
};

// ── Mock ResponseFormatter ──────────────────────────────────────────────────
const rfPath = require.resolve("../../../../src/utils/responseFormatter");
const successSpy = vi.fn((res, payload) => res.json({ ok: true, ...payload }));
require.cache[rfPath] = {
  id: rfPath, filename: rfPath, loaded: true,
  exports: { success: successSpy },
};

// ── Mock controllers ────────────────────────────────────────────────────────
const adSearchPath = require.resolve("../../../../src/services/reddit/controllers/adSearchController");
const searchAds = vi.fn();
require.cache[adSearchPath] = { id: adSearchPath, filename: adSearchPath, loaded: true, exports: { searchAds } };

const adCountPath = require.resolve("../../../../src/services/reddit/controllers/adCountController");
const getAdsCount = vi.fn();
require.cache[adCountPath] = { id: adCountPath, filename: adCountPath, loaded: true, exports: { getAdsCount } };

const adDetailPath = require.resolve("../../../../src/services/reddit/controllers/adDetailController");
const getAdDetails = vi.fn();
require.cache[adDetailPath] = { id: adDetailPath, filename: adDetailPath, loaded: true, exports: { getAdDetails } };

const hideAdsPath = require.resolve("../../../../src/services/reddit/controllers/hideAdsController");
const hideAds = vi.fn();
const getHiddenPostOwners = vi.fn();
const unHide = vi.fn();
require.cache[hideAdsPath] = {
  id: hideAdsPath, filename: hideAdsPath, loaded: true,
  exports: { hideAds, getHiddenPostOwners, unHide },
};

const adInsightsPath = require.resolve("../../../../src/services/reddit/controllers/adInsightsController");
const getLikeCommentShareDetails = vi.fn();
const getRedditAdCountry = vi.fn();
const getRedirectOutgoingUrls = vi.fn();
const getAdvertiserLCSData = vi.fn();
const getAdvertiserCountryData = vi.fn();
const getAdvertiserInsightsByDateRange = vi.fn();
require.cache[adInsightsPath] = {
  id: adInsightsPath, filename: adInsightsPath, loaded: true,
  exports: {
    getLikeCommentShareDetails, getRedditAdCountry, getRedirectOutgoingUrls,
    getAdvertiserLCSData, getAdvertiserCountryData, getAdvertiserInsightsByDateRange,
  },
};

const { createRedditRoutes } = require("../../../../src/services/reddit/routes/redditRoutes");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

let service;
beforeEach(() => {
  Object.keys(handlers.get).forEach((k) => delete handlers.get[k]);
  Object.keys(handlers.post).forEach((k) => delete handlers.post[k]);
  [searchAds, getAdsCount, getAdDetails, hideAds, getHiddenPostOwners, unHide,
   getLikeCommentShareDetails, getRedditAdCountry, getRedirectOutgoingUrls,
   getAdvertiserLCSData, getAdvertiserCountryData, getAdvertiserInsightsByDateRange,
   successSpy].forEach((s) => s.mockReset());
  service = { db: { mark: "db" }, log: { info: vi.fn(), error: vi.fn() } };
  createRedditRoutes(service);
});

function lastHandler(method, path) {
  return handlers[method][path][handlers[method][path].length - 1];
}

describe("services/reddit/routes/redditRoutes > registration", () => {
  it("registers every documented route", () => {
    expect(handlers.post["/ads/search"]).toBeDefined();
    expect(handlers.get["/ads/count"]).toBeDefined();
    expect(handlers.post["/ads/detail"]).toBeDefined();
    expect(handlers.post["/ads/getAdDetails"]).toBeDefined();
    expect(handlers.post["/ads/getLikeCommentShareDetails"]).toBeDefined();
    expect(handlers.post["/ads/getRedditAdCountry"]).toBeDefined();
    expect(handlers.post["/ads/getRedirectOutgoingUrls"]).toBeDefined();
    expect(handlers.post["/ads/getAdvertiserLCSData"]).toBeDefined();
    expect(handlers.post["/ads/getAdvertiserCountryData"]).toBeDefined();
    expect(handlers.post["/ads/getAdvertiserInsightsByDateRange"]).toBeDefined();
    expect(handlers.post["/ads/hide_ads"]).toBeDefined();
    expect(handlers.post["/ads/getHiddenPostOwners"]).toBeDefined();
    expect(handlers.post["/ads/un-hide"]).toBeDefined();
  });
});

describe("services/reddit/routes/redditRoutes > POST /ads/search", () => {
  it("200 → ResponseFormatter.success with data + meta.total", async () => {
    searchAds.mockResolvedValueOnce({ code: 200, data: ["x"], total: 1 });
    const res = mockRes();
    await lastHandler("post", "/ads/search")({}, res);
    expect(successSpy).toHaveBeenCalledWith(res, { data: ["x"], meta: { total: 1 } });
  });

  it("non-200 → status+json", async () => {
    searchAds.mockResolvedValueOnce({ code: 500, message: "boom" });
    const res = mockRes();
    await lastHandler("post", "/ads/search")({}, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("services/reddit/routes/redditRoutes > GET /ads/count", () => {
  it("200 → ResponseFormatter.success with data", async () => {
    getAdsCount.mockResolvedValueOnce({ code: 200, data: { count: 7 } });
    const res = mockRes();
    await lastHandler("get", "/ads/count")({}, res);
    expect(successSpy).toHaveBeenCalledWith(res, { data: { count: 7 } });
  });

  it("non-200 → status+json", async () => {
    getAdsCount.mockResolvedValueOnce({ code: 503, message: "es-down" });
    const res = mockRes();
    await lastHandler("get", "/ads/count")({}, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });
});

describe("services/reddit/routes/redditRoutes > simple pass-through routes", () => {
  it.each([
    ["/ads/detail",                       () => getAdDetails],
    ["/ads/getAdDetails",                 () => getAdDetails],
    ["/ads/getLikeCommentShareDetails",   () => getLikeCommentShareDetails],
    ["/ads/getRedditAdCountry",           () => getRedditAdCountry],
    ["/ads/getRedirectOutgoingUrls",      () => getRedirectOutgoingUrls],
    ["/ads/hide_ads",                     () => hideAds],
    ["/ads/getHiddenPostOwners",          () => getHiddenPostOwners],
    ["/ads/un-hide",                      () => unHide],
  ])("POST %s 200 path", async (path, getCtrl) => {
    const ctrl = getCtrl();
    ctrl.mockResolvedValueOnce({ code: 200, data: { ok: 1 } });
    const res = mockRes();
    await lastHandler("post", path)({}, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ code: 200, data: { ok: 1 } });
  });

  it.each([
    ["/ads/detail",                       () => getAdDetails],
    ["/ads/getAdDetails",                 () => getAdDetails],
    ["/ads/getLikeCommentShareDetails",   () => getLikeCommentShareDetails],
    ["/ads/getRedditAdCountry",           () => getRedditAdCountry],
    ["/ads/getRedirectOutgoingUrls",      () => getRedirectOutgoingUrls],
    ["/ads/hide_ads",                     () => hideAds],
    ["/ads/getHiddenPostOwners",          () => getHiddenPostOwners],
    ["/ads/un-hide",                      () => unHide],
  ])("POST %s non-200 preserved", async (path, getCtrl) => {
    const ctrl = getCtrl();
    ctrl.mockResolvedValueOnce({ code: 401, message: "Unauthorized" });
    const res = mockRes();
    await lastHandler("post", path)({}, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe("services/reddit/routes/redditRoutes > Advertiser*Data falsy-result fallback", () => {
  it.each([
    ["/ads/getAdvertiserLCSData",                () => getAdvertiserLCSData],
    ["/ads/getAdvertiserCountryData",            () => getAdvertiserCountryData],
    ["/ads/getAdvertiserInsightsByDateRange",    () => getAdvertiserInsightsByDateRange],
  ])("POST %s null result → 400 'No data found.'", async (path, getCtrl) => {
    const ctrl = getCtrl();
    ctrl.mockResolvedValueOnce(null);
    const res = mockRes();
    await lastHandler("post", path)({}, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ code: 400, message: "No data found.", data: null });
  });

  it.each([
    ["/ads/getAdvertiserLCSData",                () => getAdvertiserLCSData],
    ["/ads/getAdvertiserCountryData",            () => getAdvertiserCountryData],
    ["/ads/getAdvertiserInsightsByDateRange",    () => getAdvertiserInsightsByDateRange],
  ])("POST %s 200 path", async (path, getCtrl) => {
    const ctrl = getCtrl();
    ctrl.mockResolvedValueOnce({ code: 200, data: { ok: 1 } });
    const res = mockRes();
    await lastHandler("post", path)({}, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it.each([
    ["/ads/getAdvertiserLCSData",                () => getAdvertiserLCSData],
    ["/ads/getAdvertiserCountryData",            () => getAdvertiserCountryData],
    ["/ads/getAdvertiserInsightsByDateRange",    () => getAdvertiserInsightsByDateRange],
  ])("POST %s non-200 preserved", async (path, getCtrl) => {
    const ctrl = getCtrl();
    ctrl.mockResolvedValueOnce({ code: 503, message: "ES down" });
    const res = mockRes();
    await lastHandler("post", path)({}, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
