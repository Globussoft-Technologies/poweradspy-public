import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const registryPath = require.resolve("../../../../src/services/ServiceRegistry");
const fakeRegistry = { getService: vi.fn() };
require.cache[registryPath] = {
  id: registryPath, filename: registryPath, loaded: true, exports: fakeRegistry,
};

const paramsPath = require.resolve("../../../../src/services/facebook/helpers/paramParser");
const normalizeParams = vi.fn((raw) => raw);
require.cache[paramsPath] = {
  id: paramsPath, filename: paramsPath, loaded: true, exports: { normalizeParams },
};

const ssePath = require.resolve("../../../../src/services/common/helpers/sseHelper");
const streamInsights = vi.fn();
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: { streamInsights },
};

const insightsPath = require.resolve("../../../../src/services/facebook/controllers/adInsightsController");
require.cache[insightsPath] = {
  id: insightsPath, filename: insightsPath, loaded: true,
  exports: {
    getLikeCommentShareDetails: vi.fn(),
    getFacebookAdCountry: vi.fn(),
    getFacebookUserData: vi.fn(),
    getFacebookOutgoings: vi.fn(),
    getAdsPageDetails: vi.fn(),
    getAdvertiserLCSData: vi.fn(),
    getAdvertiserCountryData: vi.fn(),
    getAdvertiserUserData: vi.fn(),
  },
};

const detailPath = require.resolve("../../../../src/services/facebook/controllers/adDetailController");
require.cache[detailPath] = {
  id: detailPath, filename: detailPath, loaded: true,
  exports: { getAdDetails: vi.fn() },
};

const { getAdInsights } = require("../../../../src/services/common/controllers/commonInsightsController");

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

describe("services/common/commonInsightsController > getAdInsights", () => {
  it("401 when facebook_ad_id missing", async () => {
    const res = mockRes();
    await getAdInsights({ body: { user_id: "u1" }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("401 when user_id missing", async () => {
    const res = mockRes();
    await getAdInsights({ body: { facebook_ad_id: "f1" }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("503 when ServiceRegistry has no facebook service", async () => {
    fakeRegistry.getService.mockReturnValueOnce(null);
    const res = mockRes();
    await getAdInsights({ body: { facebook_ad_id: "f1", user_id: "u1" }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ code: 503, message: "Facebook service not available" });
  });

  it("delegates to streamInsights with 9-entry registry + verifies payload functions + pageDetails condition", async () => {
    fakeRegistry.getService.mockReturnValueOnce({ db: {}, log: {} });
    const req = { body: { facebook_ad_id: "f1", user_id: "u1", language: "en", platform: "15" }, query: {} };
    const res = mockRes();
    await getAdInsights(req, res);
    expect(streamInsights).toHaveBeenCalled();
    const registry = streamInsights.mock.calls[0][2];
    expect(registry.map(r => r.key)).toEqual([
      "adDetails", "advertiserLCSData", "advertiserCountryData", "advertiserUserData",
      "lcs", "country", "userData", "outgoingLinks", "pageDetails",
    ]);
    const p = { facebook_ad_id: "f1", user_id: "u1", language: "en", platform: "15" };
    expect(registry[0].payload(p)).toEqual({ ad_id: "f1", user_id: "u1", language: "en" });
    for (let i = 1; i < 7; i++) {
      expect(registry[i].payload(p)).toEqual({ facebook_ad_id: "f1", user_id: "u1" });
    }
    expect(registry[7].payload(p)).toEqual({ ad_id: "f1" });
    expect(registry[8].payload(p)).toEqual({ facebook_ad_id: "f1", user_id: "u1" });
    // pageDetails condition: platform=15 → true
    expect(registry[8].condition(p)).toBe(true);
    // platform=10 → false
    expect(registry[8].condition({ platform: "10" })).toBe(false);
  });

  it("merges req.body and req.query into normalizeParams input", async () => {
    fakeRegistry.getService.mockReturnValueOnce({ db: {}, log: {} });
    const req = { body: { facebook_ad_id: "f1" }, query: { user_id: "u1" } };
    const res = mockRes();
    await getAdInsights(req, res);
    expect(normalizeParams).toHaveBeenCalledWith({ facebook_ad_id: "f1", user_id: "u1" });
  });
});
