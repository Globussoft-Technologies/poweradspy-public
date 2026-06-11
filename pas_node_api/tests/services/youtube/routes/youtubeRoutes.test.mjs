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

const planAccessPath = require.resolve("../../../../src/middleware/planAccess");
require.cache[planAccessPath] = {
  id: planAccessPath, filename: planAccessPath, loaded: true,
  exports: {
    planAccessMiddleware: vi.fn((req, res, next) => next && next()),
    requirePlatform: vi.fn(() => (req, res, next) => next && next()),
  },
};

const freePlanCheckPath = require.resolve("../../../../src/middleware/freePlanCheck");
require.cache[freePlanCheckPath] = {
  id: freePlanCheckPath, filename: freePlanCheckPath, loaded: true,
  exports: { freePlanCheck: vi.fn((req, res, next) => next && next()) },
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
const adSearchPath = require.resolve("../../../../src/services/youtube/controllers/adSearchController");
const searchAds = vi.fn();
require.cache[adSearchPath] = { id: adSearchPath, filename: adSearchPath, loaded: true, exports: { searchAds } };

const adDetailPath = require.resolve("../../../../src/services/youtube/controllers/adDetailController");
const getAdDetails = vi.fn();
require.cache[adDetailPath] = { id: adDetailPath, filename: adDetailPath, loaded: true, exports: { getAdDetails } };

const adInsightsPath = require.resolve("../../../../src/services/youtube/controllers/adInsightsController");
const getLikeCommentShareDetails = vi.fn();
const getYoutubeAdCountry = vi.fn();
const getYoutubeOutgoings = vi.fn();
const getAdvertiserLCSData = vi.fn();
const getAdvertiserCountryData = vi.fn();
const getAdvertiserInsightsByDateRange = vi.fn();
require.cache[adInsightsPath] = {
  id: adInsightsPath, filename: adInsightsPath, loaded: true,
  exports: {
    getLikeCommentShareDetails, getYoutubeAdCountry, getYoutubeOutgoings,
    getAdvertiserLCSData, getAdvertiserCountryData, getAdvertiserInsightsByDateRange,
  },
};

const hideAdsPath = require.resolve("../../../../src/services/youtube/controllers/hideAdsController");
const hideAds = vi.fn();
const getHiddenPostOwners = vi.fn();
const unHide = vi.fn();
require.cache[hideAdsPath] = {
  id: hideAdsPath, filename: hideAdsPath, loaded: true,
  exports: { hideAds, getHiddenPostOwners, unHide },
};

const { createYoutubeRoutes } = require("../../../../src/services/youtube/routes/youtubeRoutes");

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
  [searchAds, getAdDetails, getLikeCommentShareDetails, getYoutubeAdCountry,
   getYoutubeOutgoings, getAdvertiserLCSData, getAdvertiserCountryData,
   getAdvertiserInsightsByDateRange, hideAds, getHiddenPostOwners, unHide, successSpy]
    .forEach((s) => s.mockReset());
  service = { db: { mark: "db" }, log: { info: vi.fn(), error: vi.fn() } };
  createYoutubeRoutes(service);
});

function lastHandler(method, path) {
  return handlers[method][path][handlers[method][path].length - 1];
}

describe("services/youtube/routes/youtubeRoutes > registration", () => {
  it("registers every documented route", () => {
    expect(handlers.post["/ads/search"]).toBeDefined();
    expect(handlers.post["/ads/getAdDetails"]).toBeDefined();
    expect(handlers.post["/ads/getLikeCommentShareDetails"]).toBeDefined();
    expect(handlers.post["/ads/getYoutubeAdCountry"]).toBeDefined();
    expect(handlers.post["/ads/getYoutubeOutgoings"]).toBeDefined();
    expect(handlers.post["/ads/getAdvertiserLCSData"]).toBeDefined();
    expect(handlers.post["/ads/hide_ads"]).toBeDefined();
    expect(handlers.post["/ads/getHiddenPostOwners"]).toBeDefined();
    expect(handlers.post["/ads/un-hide"]).toBeDefined();
    expect(handlers.post["/ads/getAdvertiserCountryData"]).toBeDefined();
    expect(handlers.post["/ads/getAdvertiserInsightsByDateRange"]).toBeDefined();
  });
});

describe("services/youtube/routes/youtubeRoutes > POST /ads/search", () => {
  it("200 → ResponseFormatter.success with data + meta.total", async () => {
    searchAds.mockResolvedValueOnce({ code: 200, data: [1, 2], total: 50 });
    const res = mockRes();
    await lastHandler("post", "/ads/search")({}, res);
    expect(successSpy).toHaveBeenCalledWith(res, { data: [1, 2], meta: { total: 50 } });
  });

  it("non-200 → res.status(code).json(result)", async () => {
    searchAds.mockResolvedValueOnce({ code: 500, message: "boom" });
    const res = mockRes();
    await lastHandler("post", "/ads/search")({}, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ code: 500, message: "boom" });
  });
});

describe("services/youtube/routes/youtubeRoutes > simple pass-through routes", () => {
  it.each([
    ["/ads/getAdDetails",                  () => getAdDetails],
    ["/ads/getLikeCommentShareDetails",    () => getLikeCommentShareDetails],
    ["/ads/getYoutubeAdCountry",           () => getYoutubeAdCountry],
    ["/ads/getYoutubeOutgoings",           () => getYoutubeOutgoings],
    ["/ads/hide_ads",                       () => hideAds],
    ["/ads/getHiddenPostOwners",            () => getHiddenPostOwners],
    ["/ads/un-hide",                        () => unHide],
  ])("POST %s returns res.status(code).json(result)", async (path, getCtrl) => {
    const ctrl = getCtrl();
    ctrl.mockResolvedValueOnce({ code: 200, data: { ok: 1 } });
    const res = mockRes();
    await lastHandler("post", path)({}, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ code: 200, data: { ok: 1 } });
  });

  it.each([
    ["/ads/getAdDetails",                  () => getAdDetails],
    ["/ads/getLikeCommentShareDetails",    () => getLikeCommentShareDetails],
    ["/ads/getYoutubeAdCountry",           () => getYoutubeAdCountry],
    ["/ads/getYoutubeOutgoings",           () => getYoutubeOutgoings],
    ["/ads/hide_ads",                       () => hideAds],
    ["/ads/getHiddenPostOwners",            () => getHiddenPostOwners],
    ["/ads/un-hide",                        () => unHide],
  ])("POST %s preserves non-200 code", async (path, getCtrl) => {
    const ctrl = getCtrl();
    ctrl.mockResolvedValueOnce({ code: 401, message: "Unauthorized" });
    const res = mockRes();
    await lastHandler("post", path)({}, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe("services/youtube/routes/youtubeRoutes > getAdvertiserLCSData / getAdvertiserCountryData / getAdvertiserInsightsByDateRange — !result fallback", () => {
  it.each([
    ["/ads/getAdvertiserLCSData",                () => getAdvertiserLCSData],
    ["/ads/getAdvertiserCountryData",            () => getAdvertiserCountryData],
    ["/ads/getAdvertiserInsightsByDateRange",    () => getAdvertiserInsightsByDateRange],
  ])("POST %s returns 400 'No data found.' when controller returns falsy", async (path, getCtrl) => {
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
  ])("POST %s 200 path returns result", async (path, getCtrl) => {
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
  ])("POST %s preserves non-200 code", async (path, getCtrl) => {
    const ctrl = getCtrl();
    ctrl.mockResolvedValueOnce({ code: 503, message: "ES down" });
    const res = mockRes();
    await lastHandler("post", path)({}, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });
});
