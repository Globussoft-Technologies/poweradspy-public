import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const expressPath = require.resolve("express");
const routes = { get: {}, post: {}, patch: {} };
function FakeRouter() {
  return {
    get: vi.fn((path, ...rest) => { routes.get[path] = rest; }),
    post: vi.fn((path, ...rest) => { routes.post[path] = rest; }),
    patch: vi.fn((path, ...rest) => { routes.patch[path] = rest; }),
  };
}
require.cache[expressPath] = { id: expressPath, filename: expressPath, loaded: true, exports: { Router: FakeRouter } };

const errHandlerPath = require.resolve("../../../../src/middleware/errorHandler");
require.cache[errHandlerPath] = {
  id: errHandlerPath, filename: errHandlerPath, loaded: true,
  exports: { asyncHandler: (fn) => fn, AppError: class {} },
};

// Mock controllers
function mkCtrlMock(relPath, exportName) {
  const p = require.resolve(`../../../../src/services/common/controllers/${relPath}`);
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
const commonSearchExports = mkCtrlMock("commonSearchController", ["searchAllNetworks", "getAdsByAdvertiserAll"]);
const networks = ["", "insta", "pinterest", "youtube", "gdn", "google", "native", "linkedin", "reddit", "quora", "tiktok"];
const insightHandlers = {};
// Each common insights controller exports getAdInsights
for (const n of [
  { slug: "facebook", file: "commonInsightsController" },
  { slug: "instagram", file: "instaCommonInsightsController" },
  { slug: "pinterest", file: "pinterestCommonInsightsController" },
  { slug: "youtube", file: "youtubeCommonInsightsController" },
  { slug: "gdn", file: "gdnCommonInsightsController" },
  { slug: "google", file: "googleCommonInsightsController" },
  { slug: "native", file: "nativeCommonInsightsController" },
  { slug: "linkedin", file: "linkedinCommonInsightsController" },
  { slug: "reddit", file: "redditCommonInsightsController" },
  { slug: "quora", file: "quoraCommonInsightsController" },
  { slug: "tiktok", file: "tiktokCommonInsightsController" },
]) {
  insightHandlers[n.slug] = mkCtrlMock(n.file, "getAdInsights");
}
const shareAdExports = mkCtrlMock("shareAdController", ["createShareLink", "getSharedAd"]);
const categoryExports = mkCtrlMock("categoryController", ["syncCategory", "syncAllCategories"]);
const addCategoryExports = mkCtrlMock("addCategoryController", ["getDescriptionDetails", "newCatInsertion"]);
const dashboardShareExports = mkCtrlMock("dashboardShareController", ["createDashboardShare", "getDashboardShare", "guestSearch"]);
const dailyKeywordExports = mkCtrlMock("dailyKeywordRequestController", ["dailyKeywordRequest", "getPriorityRequests"]);
const notifExports = mkCtrlMock("notificationController", ["getNotifications", "markNotificationsRead"]);
const pushExports = mkCtrlMock("pushNotificationController", [
  "registerToken", "sendPushNotification", "getPendingNotifications",
  "getAllNotifications", "markNotificationAsRead", "resetDailyKeywordStatus",
]);
const dailyMailExports = mkCtrlMock("dailyMailUpdateController", "sendMailDailyUpdate");

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
  exports: { planAccessMiddleware: vi.fn((req, res, next) => next()), requirePlatform: vi.fn() },
};
const validatorPath = require.resolve("../../../../src/middleware/validator");
require.cache[validatorPath] = {
  id: validatorPath, filename: validatorPath, loaded: true,
  exports: vi.fn(() => (req, res, next) => next()),
};

const axiosPath = require.resolve("axios");
const axiosGet = vi.fn();
require.cache[axiosPath] = {
  id: axiosPath, filename: axiosPath, loaded: true,
  exports: { get: axiosGet, default: { get: axiosGet } },
};

import dnsMod from "node:dns";
const dnsLookup = vi.spyOn(dnsMod.promises, "lookup");

// Load SUT (registers all routes at module load)
const sutPath = require.resolve("../../../../src/services/common/routes/commonRoutes");
delete require.cache[sutPath];
require(sutPath);

function mkRes() {
  const r = { statusCode: 200, body: null, headers: {}, _piped: null };
  r.status = vi.fn((c) => { r.statusCode = c; return r; });
  r.json = vi.fn((b) => { r.body = b; return r; });
  r.setHeader = vi.fn((k, v) => { r.headers[k] = v; });
  return r;
}

function lastHandler(method, path) {
  const stack = routes[method][path];
  return stack[stack.length - 1];
}

beforeEach(() => {
  commonSearchExports.searchAllNetworks.mockReset();
  commonSearchExports.getAdsByAdvertiserAll.mockReset();
  for (const fn of Object.values(insightHandlers)) fn.mockReset();
  Object.values(shareAdExports).forEach(f => f.mockReset());
  Object.values(categoryExports).forEach(f => f.mockReset());
  Object.values(addCategoryExports).forEach(f => f.mockReset());
  Object.values(dashboardShareExports).forEach(f => f.mockReset());
  Object.values(dailyKeywordExports).forEach(f => f.mockReset());
  Object.values(notifExports).forEach(f => f.mockReset());
  Object.values(pushExports).forEach(f => f.mockReset());
  dailyMailExports.mockReset();
  axiosGet.mockReset();
  dnsLookup.mockReset();
  vi.unstubAllGlobals();
});

describe("commonRoutes > registration", () => {
  it("registers all expected paths", () => {
    for (const p of [
      "/ads/search", "/catsearch", "/ads/getAdsByAdvertiser", "/ads/getAdInsights",
      "/dashboard/share", "/dashboard/guest-search", "/ads/share",
      "/daily-keyword-request", "/internal/category/sync", "/internal/category/sync-all",
      "/newCatInsertion", "/register-push-token", "/send-push-notification/:action",
      "/push-notifications/all", "/push-notifications/read", "/send-mail-dailyup",
      "/reset-daily-keyword-status", "/notifications/read",
    ]) expect(routes.post[p]).toBeDefined();
    for (const p of [
      "/dashboard/share/:token", "/ads/share/:token",
      "/get-priority-requests/:platform/:limit", "/notifications",
      "/getDescriptionDetails", "/image-proxy",
      "/push-notifications/pending",
    ]) expect(routes.get[p]).toBeDefined();
  });
});

describe("commonRoutes > /catsearch (fetch proxy)", () => {
  it("proxies to AI category URL on success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ status: 200, json: async () => ({ ok: true }) })));
    const res = mkRes();
    await lastHandler("post", "/catsearch")({ body: { q: "x" } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
  it("502 on fetch throw", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("net-fail"); }));
    const res = mkRes();
    await lastHandler("post", "/catsearch")({ body: {} }, res);
    expect(res.statusCode).toBe(502);
  });
  it("uses env URL when set", async () => {
    process.env.AI_CATEGORY = "https://custom/url";
    const fetchSpy = vi.fn(async () => ({ status: 200, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchSpy);
    await lastHandler("post", "/catsearch")({ body: {} }, mkRes());
    expect(fetchSpy.mock.calls[0][0]).toBe("https://custom/url");
    delete process.env.AI_CATEGORY;
  });
});

describe("commonRoutes > /ads/getAdInsights routing", () => {
  it("default network=facebook", async () => {
    insightHandlers.facebook.mockImplementation((req, res) => res.status(200).json({ ok: true }));
    const res = mkRes();
    await lastHandler("post", "/ads/getAdInsights")({ body: {}, query: {} }, res);
    expect(insightHandlers.facebook).toHaveBeenCalled();
  });
  it("routes to instagram when network=instagram in body", async () => {
    insightHandlers.instagram.mockImplementation((req, res) => res.status(200).json({}));
    await lastHandler("post", "/ads/getAdInsights")({ body: { network: "INSTAGRAM" }, query: {} }, mkRes());
    expect(insightHandlers.instagram).toHaveBeenCalled();
  });
  it("routes via query.network when body missing", async () => {
    insightHandlers.tiktok.mockImplementation((req, res) => res.status(200).json({}));
    await lastHandler("post", "/ads/getAdInsights")({ body: {}, query: { network: "tiktok" } }, mkRes());
    expect(insightHandlers.tiktok).toHaveBeenCalled();
  });
  it("400 for unsupported network", async () => {
    const res = mkRes();
    await lastHandler("post", "/ads/getAdInsights")({ body: { network: "myspace" }, query: {} }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("Unsupported");
  });
});

describe("commonRoutes > /image-proxy", () => {
  it("400 when no url", async () => {
    const res = mkRes();
    await lastHandler("get", "/image-proxy")({ query: {} }, res);
    expect(res.statusCode).toBe(400);
  });
  it("400 on invalid URL", async () => {
    const res = mkRes();
    await lastHandler("get", "/image-proxy")({ query: { url: "not a url" } }, res);
    expect(res.statusCode).toBe(400);
  });
  it("400 when protocol is not http/https", async () => {
    const res = mkRes();
    await lastHandler("get", "/image-proxy")({ query: { url: "ftp://x" } }, res);
    expect(res.statusCode).toBe(400);
  });
  it("400 when DNS resolves to a private IP (127.0.0.1)", async () => {
    dnsLookup.mockResolvedValue({ address: "127.0.0.1" });
    const res = mkRes();
    await lastHandler("get", "/image-proxy")({ query: { url: "http://x/y.png" } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("Private");
  });
  it("400 when DNS resolves to 10.x.x.x", async () => {
    dnsLookup.mockResolvedValue({ address: "10.0.0.1" });
    const res = mkRes();
    await lastHandler("get", "/image-proxy")({ query: { url: "http://x/y.png" } }, res);
    expect(res.statusCode).toBe(400);
  });
  it("400 when DNS resolves to 192.168.x.x", async () => {
    dnsLookup.mockResolvedValue({ address: "192.168.0.1" });
    const res = mkRes();
    await lastHandler("get", "/image-proxy")({ query: { url: "http://x/y.png" } }, res);
    expect(res.statusCode).toBe(400);
  });
  it("400 when DNS resolves to 169.254.x.x", async () => {
    dnsLookup.mockResolvedValue({ address: "169.254.1.1" });
    const res = mkRes();
    await lastHandler("get", "/image-proxy")({ query: { url: "http://x/y.png" } }, res);
    expect(res.statusCode).toBe(400);
  });
  it("400 when DNS resolves to ::1 (IPv6 loopback)", async () => {
    dnsLookup.mockResolvedValue({ address: "::1" });
    const res = mkRes();
    await lastHandler("get", "/image-proxy")({ query: { url: "http://x/y.png" } }, res);
    expect(res.statusCode).toBe(400);
  });
  it("400 when DNS resolves to 172.16-31.x.x range", async () => {
    dnsLookup.mockResolvedValue({ address: "172.16.0.1" });
    const res = mkRes();
    await lastHandler("get", "/image-proxy")({ query: { url: "http://x/y.png" } }, res);
    expect(res.statusCode).toBe(400);
  });
  it("172.32.x is NOT private → continues to axios", async () => {
    dnsLookup.mockResolvedValue({ address: "172.32.0.1" });
    const streamObj = { pipe: vi.fn(), destroy: vi.fn() };
    axiosGet.mockResolvedValue({ headers: { "content-type": "image/png" }, data: streamObj });
    const res = mkRes();
    await lastHandler("get", "/image-proxy")({ query: { url: "http://x/y.png" } }, res);
    expect(streamObj.pipe).toHaveBeenCalledWith(res);
  });
  it("invalid IP from DNS (isIP returns 0) → treated as not-private → continues", async () => {
    dnsLookup.mockResolvedValue({ address: "not-an-ip" });
    const streamObj = { pipe: vi.fn() };
    axiosGet.mockResolvedValue({ headers: { "content-type": "image/png" }, data: streamObj });
    const res = mkRes();
    await lastHandler("get", "/image-proxy")({ query: { url: "http://x/y.png" } }, res);
    expect(streamObj.pipe).toHaveBeenCalled();
  });
  it("400 when DNS rejects", async () => {
    dnsLookup.mockRejectedValue(new Error("dns-fail"));
    const res = mkRes();
    await lastHandler("get", "/image-proxy")({ query: { url: "http://x/y.png" } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("DNS");
  });
  it("415 when upstream content-type is not image", async () => {
    dnsLookup.mockResolvedValue({ address: "8.8.8.8" });
    const streamObj = { destroy: vi.fn() };
    axiosGet.mockResolvedValue({ headers: { "content-type": "text/html" }, data: streamObj });
    const res = mkRes();
    await lastHandler("get", "/image-proxy")({ query: { url: "http://x/y.html" } }, res);
    expect(res.statusCode).toBe(415);
    expect(streamObj.destroy).toHaveBeenCalled();
  });
  it("415 also handles no upstream.data", async () => {
    dnsLookup.mockResolvedValue({ address: "8.8.8.8" });
    axiosGet.mockResolvedValue({ headers: { "content-type": "text/html" }, data: null });
    const res = mkRes();
    await lastHandler("get", "/image-proxy")({ query: { url: "http://x/y" } }, res);
    expect(res.statusCode).toBe(415);
  });
  it("happy path streams image with CORS headers", async () => {
    dnsLookup.mockResolvedValue({ address: "8.8.8.8" });
    const streamObj = { pipe: vi.fn() };
    axiosGet.mockResolvedValue({ headers: { "content-type": "image/jpeg" }, data: streamObj });
    const res = mkRes();
    await lastHandler("get", "/image-proxy")({ query: { url: "http://x/y.jpg" } }, res);
    expect(res.headers["Content-Type"]).toBe("image/jpeg");
    expect(res.headers["Access-Control-Allow-Origin"]).toBe("*");
    expect(streamObj.pipe).toHaveBeenCalledWith(res);
  });
  it("happy path with no content-type header → ''", async () => {
    dnsLookup.mockResolvedValue({ address: "8.8.8.8" });
    axiosGet.mockResolvedValue({ headers: {}, data: { destroy: vi.fn() } });
    const res = mkRes();
    await lastHandler("get", "/image-proxy")({ query: { url: "http://x/y" } }, res);
    expect(res.statusCode).toBe(415);
  });
  it("502 when axios throws", async () => {
    dnsLookup.mockResolvedValue({ address: "8.8.8.8" });
    axiosGet.mockRejectedValue(new Error("upstream-fail"));
    const res = mkRes();
    await lastHandler("get", "/image-proxy")({ query: { url: "http://x/y.png" } }, res);
    expect(res.statusCode).toBe(502);
  });
  it("axios validateStatus callback returns true for <500", async () => {
    dnsLookup.mockResolvedValue({ address: "8.8.8.8" });
    axiosGet.mockResolvedValue({ headers: { "content-type": "image/png" }, data: { pipe: vi.fn() } });
    await lastHandler("get", "/image-proxy")({ query: { url: "http://x/y.png" } }, mkRes());
    const opts = axiosGet.mock.calls[0][1];
    expect(opts.validateStatus(200)).toBe(true);
    expect(opts.validateStatus(404)).toBe(true);
    expect(opts.validateStatus(500)).toBe(false);
  });

  it("non-string url is rejected (400)", async () => {
    const res = mkRes();
    await lastHandler("get", "/image-proxy")({ query: { url: ["array"] } }, res);
    expect(res.statusCode).toBe(400);
  });
});
