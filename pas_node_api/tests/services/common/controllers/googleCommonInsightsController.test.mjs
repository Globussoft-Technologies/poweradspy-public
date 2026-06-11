import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Mock all collaborators
const registryPath = require.resolve("../../../../src/services/ServiceRegistry");
const fakeRegistry = { getService: vi.fn() };
require.cache[registryPath] = {
  id: registryPath, filename: registryPath, loaded: true, exports: fakeRegistry,
};

const paramsPath = require.resolve("../../../../src/services/google/helpers/paramParser");
const normalizeParams = vi.fn((raw) => raw);
require.cache[paramsPath] = {
  id: paramsPath, filename: paramsPath, loaded: true, exports: { normalizeParams },
};

const ssePath = require.resolve("../../../../src/services/common/helpers/sseHelper");
const streamInsights = vi.fn();
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: { streamInsights },
};

const insightsPath = require.resolve("../../../../src/services/google/controllers/adInsightsController");
require.cache[insightsPath] = {
  id: insightsPath, filename: insightsPath, loaded: true,
  exports: {
    getGoogleAdCountry: vi.fn(),
    getGoogleOutgoings: vi.fn(),
    getAdvertiserCountryData: vi.fn(),
  },
};

const detailPath = require.resolve("../../../../src/services/google/controllers/adDetailController");
require.cache[detailPath] = {
  id: detailPath, filename: detailPath, loaded: true,
  exports: { getAdDetails: vi.fn() },
};

const { getAdInsights } = require("../../../../src/services/common/controllers/googleCommonInsightsController");

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

describe("services/common/googleCommonInsightsController > getAdInsights", () => {
  it("401 when google_text_ad_id missing", async () => {
    const res = mockRes();
    await getAdInsights({ body: { user_id: "u1" }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ code: 401, message: expect.stringContaining("Missing parameters") });
  });

  it("401 when user_id missing", async () => {
    const res = mockRes();
    await getAdInsights({ body: { google_text_ad_id: "g1" }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("503 when ServiceRegistry has no gdn service", async () => {
    fakeRegistry.getService.mockReturnValueOnce(null);
    const res = mockRes();
    await getAdInsights({ body: { google_text_ad_id: "g1", user_id: "u1" }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ code: 503, message: "Google service not available" });
  });

  it("delegates to streamInsights with service db + logger", async () => {
    const fakeDb = { sql: {}, elastic: {} };
    const fakeLog = { info: vi.fn() };
    fakeRegistry.getService.mockReturnValueOnce({ db: fakeDb, log: fakeLog });
    const req = { body: { google_text_ad_id: "g1", user_id: "u1", language: "en" }, query: {} };
    const res = mockRes();
    await getAdInsights(req, res);
    expect(streamInsights).toHaveBeenCalledWith(
      req, res, expect.any(Array), expect.objectContaining({ google_text_ad_id: "g1", user_id: "u1" }), fakeDb, fakeLog
    );
    const registry = streamInsights.mock.calls[0][2];
    expect(registry.map(r => r.key)).toEqual([
      "adDetails", "advertiserCountryData", "country", "outgoingLinks",
    ]);
    // Verify each payload function returns the right shape
    const p = { google_text_ad_id: "g1", user_id: "u1", language: "en" };
    expect(registry[0].payload(p)).toEqual({ ad_id: "g1", user_id: "u1", language: "en" });
    expect(registry[1].payload(p)).toEqual({ google_text_ad_id: "g1", user_id: "u1" });
    expect(registry[2].payload(p)).toEqual({ google_text_ad_id: "g1", user_id: "u1" });
    expect(registry[3].payload(p)).toEqual({ google_text_ad_id: "g1" });
  });

  it("merges req.body and req.query into normalizeParams input", async () => {
    fakeRegistry.getService.mockReturnValueOnce({ db: {}, log: {} });
    const req = { body: { google_text_ad_id: "g1" }, query: { user_id: "u1" } };
    const res = mockRes();
    await getAdInsights(req, res);
    expect(normalizeParams).toHaveBeenCalledWith({ google_text_ad_id: "g1", user_id: "u1" });
    expect(streamInsights).toHaveBeenCalled();
  });
});
