import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Mock cacheStore
const cacheStorePath = require.resolve("../../src/cache/CacheStore");
const fakeCacheStore = {
  buildKey: vi.fn((net, ns, id) => `${net}:${ns}:${id}`),
  get: vi.fn(),
  set: vi.fn(),
  backend: "redis",
};
require.cache[cacheStorePath] = {
  id: cacheStorePath, filename: cacheStorePath, loaded: true, exports: fakeCacheStore,
};

// Mock logger
const loggerPath = require.resolve("../../src/logger");
const fakeLogger = {
  debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn(),
};
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { createChild: () => fakeLogger },
};

// Mock ResponseFormatter
const rfPath = require.resolve("../../src/utils/responseFormatter");
const fakeRF = {
  success: vi.fn((res, payload) => res.json({ wrapped: payload })),
  error: vi.fn(),
};
require.cache[rfPath] = {
  id: rfPath, filename: rfPath, loaded: true, exports: fakeRF,
};

const cache = require("../../src/middleware/cache");

function mockReqRes({ method = "GET", baseUrl = "/api/facebook", path = "/list", query = {}, statusCode = 200 } = {}) {
  const req = { method, baseUrl, path, query };
  const res = {
    statusCode,
    json: vi.fn(function (body) { this._lastJson = body; return this; }),
  };
  return { req, res };
}

beforeEach(() => {
  fakeCacheStore.get.mockReset();
  fakeCacheStore.set.mockReset().mockReturnValue(Promise.resolve());
  fakeRF.success.mockClear();
  fakeLogger.debug.mockClear();
  fakeLogger.error.mockClear();
});

describe("middleware/cache", () => {
  it("non-GET requests pass through", async () => {
    const mw = cache("posts");
    const { req, res } = mockReqRes({ method: "POST" });
    const next = vi.fn();
    await mw(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(fakeCacheStore.get).not.toHaveBeenCalled();
  });

  it("missing network in baseUrl path passes through", async () => {
    const mw = cache("posts");
    const { req, res } = mockReqRes({ baseUrl: "/api" });
    const next = vi.fn();
    await mw(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(fakeCacheStore.get).not.toHaveBeenCalled();
  });

  it("cache hit → ResponseFormatter.success with cached metadata", async () => {
    fakeCacheStore.get.mockResolvedValueOnce({ posts: [1, 2, 3] });
    const mw = cache("posts");
    const { req, res } = mockReqRes({ query: { page: "2", limit: "10" } });
    const next = vi.fn();
    await mw(req, res, next);
    expect(fakeRF.success).toHaveBeenCalled();
    const payload = fakeRF.success.mock.calls[0][1];
    expect(payload.data).toEqual({ posts: [1, 2, 3] });
    expect(payload.meta).toEqual({ cached: true, backend: "redis" });
    expect(next).not.toHaveBeenCalled();
  });

  it("cache miss → wraps res.json; caches successful response data", async () => {
    fakeCacheStore.get.mockResolvedValueOnce(null);
    const mw = cache("posts", 60);
    const { req, res } = mockReqRes();
    const originalJsonSpy = res.json;
    const next = vi.fn();
    await mw(req, res, next);
    expect(next).toHaveBeenCalled();
    // res.json was overridden
    expect(res.json).not.toBe(originalJsonSpy);
    // Fire the wrapped json with a successful body
    res.json({ success: true, data: { items: [1, 2] } });
    expect(fakeCacheStore.set).toHaveBeenCalledWith(
      expect.any(String), { items: [1, 2] }, 60
    );
  });

  it("wrapped res.json: non-200 status → no cache write", async () => {
    fakeCacheStore.get.mockResolvedValueOnce(null);
    const mw = cache("posts");
    const { req, res } = mockReqRes({ statusCode: 500 });
    await mw(req, res, vi.fn());
    res.json({ success: true, data: { items: [] } });
    expect(fakeCacheStore.set).not.toHaveBeenCalled();
  });

  it("wrapped res.json: 200 but body.success=false → no cache write", async () => {
    fakeCacheStore.get.mockResolvedValueOnce(null);
    const mw = cache("posts");
    const { req, res } = mockReqRes();
    await mw(req, res, vi.fn());
    res.json({ success: false, data: { x: 1 } });
    expect(fakeCacheStore.set).not.toHaveBeenCalled();
  });

  it("wrapped res.json: 200 + success but no body.data → no cache write", async () => {
    fakeCacheStore.get.mockResolvedValueOnce(null);
    const mw = cache("posts");
    const { req, res } = mockReqRes();
    await mw(req, res, vi.fn());
    res.json({ success: true });
    expect(fakeCacheStore.set).not.toHaveBeenCalled();
  });

  it("cacheStore.set rejection is logged but doesn't crash", async () => {
    fakeCacheStore.get.mockResolvedValueOnce(null);
    fakeCacheStore.set.mockReturnValueOnce(Promise.reject(new Error("redis-down")));
    const mw = cache("posts");
    const { req, res } = mockReqRes();
    await mw(req, res, vi.fn());
    res.json({ success: true, data: { x: 1 } });
    // Wait for the .catch to fire
    await new Promise((r) => setImmediate(r));
    expect(fakeLogger.error).toHaveBeenCalledWith(
      "Failed to set cache after response",
      expect.objectContaining({ error: "redis-down" })
    );
  });

  it("cacheStore.get rejection → outer catch logs + next() still called", async () => {
    fakeCacheStore.get.mockRejectedValueOnce(new Error("get-down"));
    const mw = cache("posts");
    const { req, res } = mockReqRes();
    const next = vi.fn();
    await mw(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(fakeLogger.error).toHaveBeenCalledWith(
      "Cache middleware error",
      expect.objectContaining({ error: "get-down" })
    );
  });
});
