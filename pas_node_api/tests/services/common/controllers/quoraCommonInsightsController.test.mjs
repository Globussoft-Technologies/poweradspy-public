import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const registryPath = require.resolve("../../../../src/services/ServiceRegistry");
const fakeRegistry = { getService: vi.fn() };
require.cache[registryPath] = {
  id: registryPath, filename: registryPath, loaded: true, exports: fakeRegistry,
};

const paramsPath = require.resolve("../../../../src/services/quora/helpers/paramParser");
const normalizeParams = vi.fn((raw) => raw);
require.cache[paramsPath] = {
  id: paramsPath, filename: paramsPath, loaded: true, exports: { normalizeParams },
};

const ssePath = require.resolve("../../../../src/services/common/helpers/sseHelper");
const streamInsights = vi.fn();
require.cache[ssePath] = {
  id: ssePath, filename: ssePath, loaded: true, exports: { streamInsights },
};

const insightsPath = require.resolve("../../../../src/services/quora/controllers/adInsightsController");
require.cache[insightsPath] = {
  id: insightsPath, filename: insightsPath, loaded: true,
  exports: {
    getQuoraAdCountry: vi.fn(),
    getQuoraOutgoings: vi.fn(),
    getQuoraUserData: vi.fn(),
    getAdvertiserCountryData: vi.fn(),
  },
};

const detailPath = require.resolve("../../../../src/services/quora/controllers/adDetailController");
require.cache[detailPath] = {
  id: detailPath, filename: detailPath, loaded: true,
  exports: { getAdDetails: vi.fn() },
};

const { getAdInsights } = require("../../../../src/services/common/controllers/quoraCommonInsightsController");

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

describe("services/common/quoraCommonInsightsController > getAdInsights", () => {
  it("401 when quora_ad_id missing", async () => {
    const res = mockRes();
    await getAdInsights({ body: { user_id: "u1" }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("401 when user_id missing", async () => {
    const res = mockRes();
    await getAdInsights({ body: { quora_ad_id: "q1" }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("503 when ServiceRegistry has no quora service", async () => {
    fakeRegistry.getService.mockReturnValueOnce(null);
    const res = mockRes();
    await getAdInsights({ body: { quora_ad_id: "q1", user_id: "u1" }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ code: 503, message: "Quora service not available" });
  });

  it("delegates to streamInsights with 5-entry registry (adDetails/advertiserCountry/country/outgoing/userData)", async () => {
    const fakeDb = {}, fakeLog = {};
    fakeRegistry.getService.mockReturnValueOnce({ db: fakeDb, log: fakeLog });
    const req = { body: { quora_ad_id: "q1", user_id: "u1", language: "en" }, query: {} };
    const res = mockRes();
    await getAdInsights(req, res);
    expect(streamInsights).toHaveBeenCalled();
    const registry = streamInsights.mock.calls[0][2];
    expect(registry.map(r => r.key)).toEqual([
      "adDetails", "advertiserCountryData", "country", "outgoingLinks", "userData",
    ]);
    const p = { quora_ad_id: "q1", user_id: "u1", language: "en" };
    expect(registry[0].payload(p)).toEqual({ ad_id: "q1", user_id: "u1", language: "en" });
    expect(registry[1].payload(p)).toEqual({ quora_ad_id: "q1", user_id: "u1" });
    expect(registry[2].payload(p)).toEqual({ quora_ad_id: "q1", user_id: "u1" });
    expect(registry[3].payload(p)).toEqual({ ad_id: "q1", user_id: "u1" });
    expect(registry[4].payload(p)).toEqual({ quora_ad_id: "q1", user_id: "u1" });
  });

  it("merges req.body and req.query into normalizeParams input", async () => {
    fakeRegistry.getService.mockReturnValueOnce({ db: {}, log: {} });
    const req = { body: { quora_ad_id: "q1" }, query: { user_id: "u1" } };
    const res = mockRes();
    await getAdInsights(req, res);
    expect(normalizeParams).toHaveBeenCalledWith({ quora_ad_id: "q1", user_id: "u1" });
  });
});
