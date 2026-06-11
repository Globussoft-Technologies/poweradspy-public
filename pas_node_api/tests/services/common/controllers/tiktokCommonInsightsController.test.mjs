import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const registryPath = require.resolve("../../../../src/services/ServiceRegistry");
const fakeRegistry = { getService: vi.fn() };
require.cache[registryPath] = {
  id: registryPath, filename: registryPath, loaded: true, exports: fakeRegistry,
};

const paramsPath = require.resolve("../../../../src/services/tiktok/helpers/paramParser");
const normalizeParams = vi.fn((raw) => raw);
require.cache[paramsPath] = {
  id: paramsPath, filename: paramsPath, loaded: true, exports: { normalizeParams },
};

const ssePath = require.resolve("../../../../src/services/common/helpers/sseHelper");
const streamInsights = vi.fn();
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: { streamInsights },
};

const insightsPath = require.resolve("../../../../src/services/tiktok/controllers/adInsightsController");
require.cache[insightsPath] = {
  id: insightsPath, filename: insightsPath, loaded: true,
  exports: {
    getLCS: vi.fn(),
    getAnalytics: vi.fn(),
    getIndustries: vi.fn(),
    getAdvertiserLCSData: vi.fn(),
    getAdvertiserCountryData: vi.fn(),
  },
};

const { getAdInsights } = require("../../../../src/services/common/controllers/tiktokCommonInsightsController");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

beforeEach(() => {
  fakeRegistry.getService.mockReset();
  normalizeParams.mockReset().mockImplementation((raw) => raw);
  streamInsights.mockReset();
});

describe("services/common/tiktokCommonInsightsController > getAdInsights", () => {
  it("401 when both tiktok_ad_id and ad_id missing", async () => {
    const res = mockRes();
    await getAdInsights({ body: { user_id: "u1" }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ code: 401, message: expect.stringContaining("tiktok_ad_id") });
  });

  it("503 when ServiceRegistry has no tiktok service", async () => {
    fakeRegistry.getService.mockReturnValueOnce(null);
    const res = mockRes();
    await getAdInsights({ body: { tiktok_ad_id: "t1" }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ code: 503, message: "TikTok service not available" });
  });

  it("delegates to streamInsights with tiktok_ad_id present", async () => {
    fakeRegistry.getService.mockReturnValueOnce({ db: {}, log: {} });
    const req = { body: { tiktok_ad_id: "t1", user_id: "u1" }, query: {} };
    const res = mockRes();
    await getAdInsights(req, res);
    expect(streamInsights).toHaveBeenCalled();
    const registry = streamInsights.mock.calls[0][2];
    expect(registry.map(r => r.key)).toEqual([
      "analytics", "lcs", "industries", "advertiserLCSData", "advertiserCountryData",
    ]);
    const p = { tiktok_ad_id: "t1", user_id: "u1" };
    expect(registry[0].payload(p)).toEqual({ ad_id: "t1", user_id: "u1" });
    expect(registry[1].payload(p)).toEqual({ ad_id: "t1", user_id: "u1" });
    expect(registry[2].payload(p)).toEqual({});
    expect(registry[3].payload(p)).toEqual({ tiktok_ad_id: "t1", user_id: "u1" });
    expect(registry[4].payload(p)).toEqual({ tiktok_ad_id: "t1", user_id: "u1" });
  });

  it("uses ad_id fallback when tiktok_ad_id missing in payload functions", async () => {
    fakeRegistry.getService.mockReturnValueOnce({ db: {}, log: {} });
    const req = { body: { ad_id: "a1" }, query: {} };
    const res = mockRes();
    await getAdInsights(req, res);
    const registry = streamInsights.mock.calls[0][2];
    const p = { ad_id: "a1" };
    expect(registry[0].payload(p)).toEqual({ ad_id: "a1", user_id: undefined });
    expect(registry[1].payload(p)).toEqual({ ad_id: "a1", user_id: undefined });
  });

  it("merges req.body and req.query into normalizeParams input", async () => {
    fakeRegistry.getService.mockReturnValueOnce({ db: {}, log: {} });
    const req = { body: { tiktok_ad_id: "t1" }, query: { extra: "z" } };
    const res = mockRes();
    await getAdInsights(req, res);
    expect(normalizeParams).toHaveBeenCalledWith({ tiktok_ad_id: "t1", extra: "z" });
  });
});
