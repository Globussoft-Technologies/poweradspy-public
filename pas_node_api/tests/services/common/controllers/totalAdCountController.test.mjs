import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const dbmPath = require.resolve("../../../../src/database/DatabaseManager");
const getElasticSpy = vi.fn();
require.cache[dbmPath] = {
  id: dbmPath, filename: dbmPath, loaded: true,
  exports: { getElastic: getElasticSpy },
};

const rfPath = require.resolve("../../../../src/utils/responseFormatter");
const ResponseFormatter = {
  success: vi.fn((res, data) => ({ code: 200, data })),
  error: vi.fn((res, msg, code, detail) => ({ code, message: msg, detail })),
};
require.cache[rfPath] = {
  id: rfPath, filename: rfPath, loaded: true,
  exports: ResponseFormatter,
};

const loggerPath = require.resolve("../../../../src/logger");
const childLogger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { createChild: vi.fn(() => childLogger) },
};

// Mock the displayable-media filters helper so each test can pick whether
// the "no filter" or "filter present" branch runs, without depending on
// the real per-network data (which evolves over time).
const dmfPath = require.resolve(
  "../../../../src/services/common/helpers/displayableMediaFilters"
);
const getDisplayableMediaFilterSpy = vi.fn();
require.cache[dmfPath] = {
  id: dmfPath, filename: dmfPath, loaded: true,
  exports: { getDisplayableMediaFilter: getDisplayableMediaFilterSpy },
};

const { getTotalAdCount, SUPPORTED_NETWORKS } = require(
  "../../../../src/services/common/controllers/totalAdCountController"
);

// A throw-away filter clause used to assert composition behaviour without
// pinning to any specific network's real shape.
const FAKE_MEDIA_CLAUSE = {
  bool: { should: [{ match_all: {} }], minimum_should_match: 1 },
};

beforeEach(() => {
  getElasticSpy.mockReset();
  ResponseFormatter.success.mockClear();
  ResponseFormatter.error.mockClear();
  childLogger.error.mockClear();
  getDisplayableMediaFilterSpy.mockReset();
  // Default for each test: helper returns null (no media filter applied).
  // Individual tests opt-in with mockReturnValueOnce.
  getDisplayableMediaFilterSpy.mockReturnValue(null);
});

const res = {};

describe("services/common/controllers/totalAdCountController > getTotalAdCount", () => {
  it("400 when network missing", async () => {
    await getTotalAdCount({ body: {}, query: {} }, res);
    expect(ResponseFormatter.error).toHaveBeenCalledWith(
      res, expect.stringMatching(/Missing required parameter: network/), 400,
    );
  });

  it("400 when network unsupported", async () => {
    await getTotalAdCount({ body: { network: "myspace" }, query: {} }, res);
    expect(ResponseFormatter.error.mock.calls[0][1]).toMatch(/Unsupported network "myspace"/);
  });

  it("503 when ES not configured for network", async () => {
    getElasticSpy.mockReturnValueOnce(null);
    await getTotalAdCount({ body: { network: "facebook" }, query: {} }, res);
    expect(ResponseFormatter.error.mock.calls[0][1]).toMatch(/Elasticsearch is not configured/);
    expect(ResponseFormatter.error.mock.calls[0][2]).toBe(503);
  });

  it("503 when ES connection missing client", async () => {
    getElasticSpy.mockReturnValueOnce({ client: null, indexName: "fb_ads" });
    await getTotalAdCount({ body: { network: "facebook" }, query: {} }, res);
    expect(ResponseFormatter.error.mock.calls[0][2]).toBe(503);
  });

  it("happy: no range and no media filter → match_all (ES v8 shape)", async () => {
    const client = { count: vi.fn().mockResolvedValueOnce({ count: 1234 }) };
    getElasticSpy.mockReturnValueOnce({ client, indexName: "fb_ads" });
    await getTotalAdCount({ body: { network: "facebook" }, query: {} }, res);
    expect(client.count.mock.calls[0][0].body.query).toEqual({ match_all: {} });
    expect(ResponseFormatter.success.mock.calls[0][1]).toEqual({
      network: "facebook",
      totalAds: 1234,
      index: "fb_ads",
      rangeApplied: false,
      mediaFilterApplied: false,
    });
  });

  it("happy: ES v7 shape (count wrapped in body.count)", async () => {
    const client = { count: vi.fn().mockResolvedValueOnce({ body: { count: 99 } }) };
    getElasticSpy.mockReturnValueOnce({ client, indexName: "fb_ads" });
    await getTotalAdCount({ body: { network: "facebook" }, query: {} }, res);
    expect(ResponseFormatter.success.mock.calls[0][1].totalAds).toBe(99);
  });

  it("totalAds defaults to 0 when count missing in response", async () => {
    const client = { count: vi.fn().mockResolvedValueOnce({}) };
    getElasticSpy.mockReturnValueOnce({ client, indexName: "fb_ads" });
    await getTotalAdCount({ body: { network: "facebook" }, query: {} }, res);
    expect(ResponseFormatter.success.mock.calls[0][1].totalAds).toBe(0);
  });

  it("media filter applied: clauses appear in bool.filter, mediaFilterApplied=true", async () => {
    getDisplayableMediaFilterSpy.mockReturnValueOnce([FAKE_MEDIA_CLAUSE]);
    const client = { count: vi.fn().mockResolvedValueOnce({ count: 10 }) };
    getElasticSpy.mockReturnValueOnce({ client, indexName: "fb_ads" });
    await getTotalAdCount({ body: { network: "facebook" }, query: {} }, res);
    const body = client.count.mock.calls[0][0].body;
    expect(body.query).toEqual({ bool: { filter: [FAKE_MEDIA_CLAUSE] } });
    expect(ResponseFormatter.success.mock.calls[0][1].mediaFilterApplied).toBe(true);
    expect(ResponseFormatter.success.mock.calls[0][1].rangeApplied).toBe(false);
  });

  it("media filter with multiple clauses (e.g. YouTube): all appear in bool.filter in order", async () => {
    const c1 = { bool: { should: [{ term: { foo: "x" } }], minimum_should_match: 1 } };
    const c2 = { bool: { must_not: [{ term: { "ad_type.keyword": "" } }] } };
    getDisplayableMediaFilterSpy.mockReturnValueOnce([c1, c2]);
    const client = { count: vi.fn().mockResolvedValueOnce({ count: 0 }) };
    getElasticSpy.mockReturnValueOnce({ client, indexName: "yt_ads" });
    await getTotalAdCount({ body: { network: "youtube" }, query: {} }, res);
    expect(client.count.mock.calls[0][0].body.query.bool.filter).toEqual([c1, c2]);
  });

  it("datetime range (no media filter): builds yyyy-MM-dd HH:mm:ss range, rangeApplied=true", async () => {
    const client = { count: vi.fn().mockResolvedValueOnce({ count: 5 }) };
    getElasticSpy.mockReturnValueOnce({ client, indexName: "fb_ads" });
    await getTotalAdCount({
      body: { network: "facebook", range: { from: "2025-01-01", to: "2025-01-31" } },
      query: {},
    }, res);
    const body = client.count.mock.calls[0][0].body;
    expect(body.query.bool.filter[0].range["facebook_ad.last_seen"]).toEqual({
      gte: "2025-01-01 00:00:00",
      lte: "2025-01-31 23:59:59",
      format: "yyyy-MM-dd HH:mm:ss",
    });
    expect(ResponseFormatter.success.mock.calls[0][1].rangeApplied).toBe(true);
    expect(ResponseFormatter.success.mock.calls[0][1].mediaFilterApplied).toBe(false);
  });

  it("epoch_second range (linkedin, no media filter): builds epoch_second range", async () => {
    const client = { count: vi.fn().mockResolvedValueOnce({ count: 7 }) };
    getElasticSpy.mockReturnValueOnce({ client, indexName: "li_ads" });
    await getTotalAdCount({
      body: { network: "linkedin", range: { from: "2025-01-01", to: "2025-01-31" } },
      query: {},
    }, res);
    const body = client.count.mock.calls[0][0].body;
    expect(body.query.bool.filter[0].range["last_seen"].format).toBe("epoch_second");
    expect(typeof body.query.bool.filter[0].range["last_seen"].gte).toBe("number");
  });

  it("range + media compose: range at filter[0], media clauses follow, both flags true", async () => {
    getDisplayableMediaFilterSpy.mockReturnValueOnce([FAKE_MEDIA_CLAUSE]);
    const client = { count: vi.fn().mockResolvedValueOnce({ count: 3 }) };
    getElasticSpy.mockReturnValueOnce({ client, indexName: "fb_ads" });
    await getTotalAdCount({
      body: { network: "facebook", range: { from: "2025-01-01", to: "2025-01-31" } },
      query: {},
    }, res);
    const filter = client.count.mock.calls[0][0].body.query.bool.filter;
    expect(filter).toHaveLength(2);
    expect(filter[0].range["facebook_ad.last_seen"].format).toBe("yyyy-MM-dd HH:mm:ss");
    expect(filter[1]).toEqual(FAKE_MEDIA_CLAUSE);
    expect(ResponseFormatter.success.mock.calls[0][1].rangeApplied).toBe(true);
    expect(ResponseFormatter.success.mock.calls[0][1].mediaFilterApplied).toBe(true);
  });

  it("partial range (only `from`) with media filter → media filter alone is applied", async () => {
    getDisplayableMediaFilterSpy.mockReturnValueOnce([FAKE_MEDIA_CLAUSE]);
    const client = { count: vi.fn().mockResolvedValueOnce({ count: 1 }) };
    getElasticSpy.mockReturnValueOnce({ client, indexName: "fb_ads" });
    await getTotalAdCount({
      body: { network: "facebook", range: { from: "2025-01-01" } },
      query: {},
    }, res);
    expect(client.count.mock.calls[0][0].body.query).toEqual({
      bool: { filter: [FAKE_MEDIA_CLAUSE] },
    });
    expect(ResponseFormatter.success.mock.calls[0][1].rangeApplied).toBe(false);
    expect(ResponseFormatter.success.mock.calls[0][1].mediaFilterApplied).toBe(true);
  });

  it("partial range (only `from`) with no media filter → match_all", async () => {
    const client = { count: vi.fn().mockResolvedValueOnce({ count: 1 }) };
    getElasticSpy.mockReturnValueOnce({ client, indexName: "fb_ads" });
    await getTotalAdCount({
      body: { network: "facebook", range: { from: "2025-01-01" } },
      query: {},
    }, res);
    expect(client.count.mock.calls[0][0].body.query).toEqual({ match_all: {} });
  });

  it("500 when ES count throws", async () => {
    const client = { count: vi.fn().mockRejectedValueOnce(new Error("es-down")) };
    getElasticSpy.mockReturnValueOnce({ client, indexName: "fb_ads" });
    await getTotalAdCount({ body: { network: "facebook" }, query: {} }, res);
    expect(ResponseFormatter.error.mock.calls[0][2]).toBe(500);
    expect(ResponseFormatter.error.mock.calls[0][3]).toBe("es-down");
    expect(childLogger.error).toHaveBeenCalled();
  });

  it("network casing/whitespace normalized to lowercase trimmed", async () => {
    const client = { count: vi.fn().mockResolvedValueOnce({ count: 0 }) };
    getElasticSpy.mockReturnValueOnce({ client, indexName: "fb_ads" });
    await getTotalAdCount({ body: { network: "  FACEBOOK  " }, query: {} }, res);
    expect(ResponseFormatter.success.mock.calls[0][1].network).toBe("facebook");
  });

  it("query params merged with body (body takes precedence)", async () => {
    const client = { count: vi.fn().mockResolvedValueOnce({ count: 0 }) };
    getElasticSpy.mockReturnValueOnce({ client, indexName: "fb_ads" });
    await getTotalAdCount({ body: { network: "facebook" }, query: { network: "google" } }, res);
    // body overrides query
    expect(ResponseFormatter.success.mock.calls[0][1].network).toBe("facebook");
  });

  it("SUPPORTED_NETWORKS exports all 11 networks", () => {
    expect(SUPPORTED_NETWORKS).toEqual([
      "facebook", "instagram", "google", "quora", "native", "gdn",
      "pinterest", "reddit", "linkedin", "youtube", "tiktok",
    ]);
  });
});
