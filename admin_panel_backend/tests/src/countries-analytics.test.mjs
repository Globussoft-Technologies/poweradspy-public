import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const esConnPath = require.resolve("../../es-connections/connection");
const searchAllInstancesSpy = vi.fn();
require.cache[esConnPath] = {
  id: esConnPath, filename: esConnPath, loaded: true,
  exports: searchAllInstancesSpy,
};

const { countryStatsWithFilter } = require("../../src/countries-analytics");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

let consoleErrSpy;
beforeEach(() => {
  searchAllInstancesSpy.mockReset();
  consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("src/countries-analytics > countryStatsWithFilter", () => {
  it("400 when network missing or unknown", async () => {
    const res = mockRes();
    await countryStatsWithFilter({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "Please provide valid network" });

    const res2 = mockRes();
    await countryStatsWithFilter({ body: { network: "tiktok" } }, res2);
    expect(res2.status).toHaveBeenCalledWith(400);
  });

  it("no-filter: composite aggregation, empty buckets → bypasses processAnalytics", async () => {
    searchAllInstancesSpy.mockResolvedValueOnce({
      type: "agg",
      data: {
        hits: { total: 5 },
        aggregations: { countries_count: { buckets: [], after_key: null } },
      },
    });
    const res = mockRes();
    await countryStatsWithFilter({ body: { network: "facebook" } }, res);
    const [, query, , responseType] = searchAllInstancesSpy.mock.calls[0];
    expect(responseType).toBe("agg");
    expect(query.aggs.countries_count.composite.sources[0].country.terms.field).toContain(
      "country_only.country"
    );
    const out = res.json.mock.calls[0][0];
    expect(out.type).toBe("agg");
    expect(out.data).toEqual([]);
  });

  it("no-filter buckets non-empty: routes through processAnalytics (iso match wins)", async () => {
    searchAllInstancesSpy.mockResolvedValueOnce({
      type: "agg",
      data: {
        hits: { total: 100 },
        aggregations: {
          countries_count: {
            buckets: [
              { key: { country: "Afghanistan" }, doc_count: 12 },
              { key: { country: "ZZ" }, doc_count: 3 }, // filtered out: length <= 2
              { key: { country: "UnknownLand" }, doc_count: 1 }, // no iso match
            ],
            after_key: { country: "UnknownLand" },
          },
        },
      },
    });
    const res = mockRes();
    await countryStatsWithFilter({ body: { network: "facebook" } }, res);
    const out = res.json.mock.calls[0][0];
    expect(out.type).toBe("agg");
    expect(out.total).toBe(100);
    expect(out.data).toEqual([
      expect.objectContaining({ country: "Afghanistan", count: 12, code: "AF" }),
    ]);
    expect(out.search_after).toEqual({ country: "UnknownLand" });
  });

  it("no-filter + search_after: includes after clause", async () => {
    searchAllInstancesSpy.mockResolvedValueOnce({ type: "agg", data: { hits: {}, aggregations: { countries_count: { buckets: [] } } } });
    const res = mockRes();
    await countryStatsWithFilter(
      { body: { network: "facebook", search_after: "US" } },
      res
    );
    const query = searchAllInstancesSpy.mock.calls[0][1];
    expect(query.aggs.countries_count.composite.after).toEqual({ country: "US" });
  });

  it("country only: match query, count response shape", async () => {
    searchAllInstancesSpy.mockResolvedValueOnce({ type: "count", data: 22 });
    const res = mockRes();
    await countryStatsWithFilter(
      { body: { network: "facebook", country: "Afghanistan" } },
      res
    );
    const [, query, , responseType] = searchAllInstancesSpy.mock.calls[0];
    expect(responseType).toBe("count");
    expect(query.query.bool.must[0].match["country_only.country"]).toBe("Afghanistan");
    expect(res.json.mock.calls[0][0]).toEqual({
      type: "count", total: 22, data: [], search_after: null,
    });
  });

  it("range only (regular network): yyyy-MM-dd HH:mm:ss format", async () => {
    searchAllInstancesSpy.mockResolvedValueOnce({ type: "agg", data: { hits: {}, aggregations: { countries_count: { buckets: [] } } } });
    const res = mockRes();
    await countryStatsWithFilter(
      { body: { network: "facebook", range: { from: "2025-01-01", to: "2025-01-31" } } },
      res
    );
    const query = searchAllInstancesSpy.mock.calls[0][1];
    expect(query.query.range["facebook_ad.last_seen"].gte).toBe("2025-01-01 00:00:00");
    expect(query.query.range["facebook_ad.last_seen"].format).toBe("yyyy-MM-dd HH:mm:ss");
  });

  it("range only + youtube: epoch_second format with dateToEpoch", async () => {
    searchAllInstancesSpy.mockResolvedValueOnce({ type: "agg", data: { hits: {}, aggregations: { countries_count: { buckets: [] } } } });
    const res = mockRes();
    await countryStatsWithFilter(
      { body: { network: "youtube", range: { from: "2025-01-01", to: "2025-01-31" } } },
      res
    );
    const query = searchAllInstancesSpy.mock.calls[0][1];
    expect(query.query.range["last_seen"].format).toBe("epoch_second");
    expect(typeof query.query.range["last_seen"].gte).toBe("number");
  });

  it("range only + search_after: includes after clause", async () => {
    searchAllInstancesSpy.mockResolvedValueOnce({ type: "agg", data: { hits: {}, aggregations: { countries_count: { buckets: [] } } } });
    const res = mockRes();
    await countryStatsWithFilter(
      {
        body: {
          network: "linkedin",
          range: { from: "2025-01-01", to: "2025-01-31" },
          search_after: "US",
        },
      },
      res
    );
    const query = searchAllInstancesSpy.mock.calls[0][1];
    expect(query.aggs.countries_count.composite.after).toEqual({ country: "US" });
  });

  it("country + range: combined match + range query", async () => {
    searchAllInstancesSpy.mockResolvedValueOnce({ type: "count", data: 9 });
    const res = mockRes();
    await countryStatsWithFilter(
      {
        body: {
          network: "facebook",
          country: "Afghanistan",
          range: { from: "2025-01-01", to: "2025-01-31" },
        },
      },
      res
    );
    const query = searchAllInstancesSpy.mock.calls[0][1];
    expect(query.query.bool.must).toHaveLength(2);
  });

  it("country + range + linkedin: combined match + epoch range", async () => {
    searchAllInstancesSpy.mockResolvedValueOnce({ type: "count", data: 0 });
    const res = mockRes();
    await countryStatsWithFilter(
      {
        body: {
          network: "linkedin",
          country: "Afghanistan",
          range: { from: "2025-01-01", to: "2025-01-31" },
        },
      },
      res
    );
    const query = searchAllInstancesSpy.mock.calls[0][1];
    expect(query.query.bool.must[1].range["last_seen"].format).toBe("epoch_second");
  });

  it("500 via outer catch when searchAllInstances rejects", async () => {
    searchAllInstancesSpy.mockRejectedValueOnce(new Error("es-down"));
    const res = mockRes();
    await countryStatsWithFilter({ body: { network: "facebook" } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
