import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// SUT requires `../db-connections/connection`.
const dbConnPath = require.resolve("../../db-connections/connection");
const queryDatabaseSpy = vi.fn();
require.cache[dbConnPath] = {
  id: dbConnPath, filename: dbConnPath, loaded: true,
  exports: queryDatabaseSpy,
};

const { builtWithStatsWithFilter } = require("../../src/builtwith-analytics");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

let consoleErrSpy;
beforeEach(() => {
  queryDatabaseSpy.mockReset();
  consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("src/builtwith-analytics > builtWithStatsWithFilter", () => {
  it("400 when network missing or unknown", async () => {
    const res = mockRes();
    await builtWithStatsWithFilter({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "Please provide valid network" });

    const res2 = mockRes();
    await builtWithStatsWithFilter({ body: { network: "tiktok" } }, res2);
    expect(res2.status).toHaveBeenCalledWith(400);
  });

  it("no-filter aggregation (facebook): GROUP BY built_with using facebook_ad_id fk", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([
      { built_with: "Shopify", num: 80 },
      { built_with: "WordPress", num: 20 },
    ]);
    const res = mockRes();
    await builtWithStatsWithFilter({ body: { network: "facebook" } }, res);
    const [db_id, , sql, params] = queryDatabaseSpy.mock.calls[0];
    expect(db_id).toBe(0);
    expect(sql).toMatch(/SELECT built_with, COUNT\(facebook_ad_id\) AS num FROM facebook_ad_meta_data/);
    expect(sql).toMatch(/GROUP BY built_with ORDER BY num DESC/);
    expect(params).toEqual([]);
    const out = res.json.mock.calls[0][0];
    expect(out.type).toBe("agg");
    expect(out.data).toEqual([
      { e_commerce: "Shopify", count: 80 },
      { e_commerce: "WordPress", count: 20 },
    ]);
    expect(out.total).toEqual({ value: 100, relation: "eq" });
  });

  it("built_with only: COUNT query with WHERE built_with = ?", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 42 }]);
    const res = mockRes();
    await builtWithStatsWithFilter(
      { body: { network: "facebook", built_with: "Shopify" } },
      res,
    );
    const [, , sql, params] = queryDatabaseSpy.mock.calls[0];
    expect(sql).toMatch(/SELECT COUNT\(facebook_ad_id\) AS cnt FROM facebook_ad_meta_data WHERE built_with = \?/);
    expect(params).toEqual(["Shopify"]);
    expect(res.json.mock.calls[0][0]).toEqual({
      type: "count", total: 42, data: [], search_after: null,
    });
  });

  it("range only: adds built_with_date BETWEEN clause", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await builtWithStatsWithFilter(
      { body: { network: "facebook", range: { from: "2025-01-01", to: "2025-01-31" } } },
      res,
    );
    const [, , sql, params] = queryDatabaseSpy.mock.calls[0];
    expect(sql).toMatch(/WHERE built_with_date BETWEEN \? AND \?/);
    expect(params).toEqual(["2025-01-01 00:00:00", "2025-01-31 23:59:59"]);
  });

  it("built_with + range: combined WHERE clause", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 6 }]);
    const res = mockRes();
    await builtWithStatsWithFilter(
      {
        body: {
          network: "facebook",
          built_with: "Shopify",
          range: { from: "2025-01-01", to: "2025-01-31" },
        },
      },
      res,
    );
    const [, , sql, params] = queryDatabaseSpy.mock.calls[0];
    expect(sql).toMatch(/WHERE built_with = \? AND built_with_date BETWEEN \? AND \?/);
    expect(params).toEqual(["Shopify", "2025-01-01 00:00:00", "2025-01-31 23:59:59"]);
    expect(res.json.mock.calls[0][0].total).toBe(6);
  });

  it("linkedin uses linkedin_ad_built_with + linkedin_ad_id fk", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await builtWithStatsWithFilter({ body: { network: "linkedin" } }, res);
    const [db_id, , sql] = queryDatabaseSpy.mock.calls[0];
    expect(db_id).toBe(2);
    expect(sql).toMatch(/FROM linkedin_ad_built_with/);
    expect(sql).toMatch(/COUNT\(linkedin_ad_id\)/);
  });

  it("bing uses bing_text_ad_meta_data + bing_text_ad_id fk", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await builtWithStatsWithFilter({ body: { network: "bing" } }, res);
    const [db_id, , sql] = queryDatabaseSpy.mock.calls[0];
    expect(db_id).toBe(10);
    expect(sql).toMatch(/FROM bing_text_ad_meta_data/);
    expect(sql).toMatch(/COUNT\(bing_text_ad_id\)/);
  });

  it("generic network uses id fk", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await builtWithStatsWithFilter({ body: { network: "google" } }, res);
    const [, , sql] = queryDatabaseSpy.mock.calls[0];
    expect(sql).toMatch(/COUNT\(id\)/);
  });

  it("rows null → total 0 + empty data", async () => {
    queryDatabaseSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await builtWithStatsWithFilter({ body: { network: "facebook" } }, res);
    const out = res.json.mock.calls[0][0];
    expect(out.data).toEqual([]);
    expect(out.total.value).toBe(0);
  });

  it("built_with path: rows[0].cnt null → total 0", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: null }]);
    const res = mockRes();
    await builtWithStatsWithFilter({ body: { network: "facebook", built_with: "X" } }, res);
    expect(res.json.mock.calls[0][0].total).toBe(0);
  });

  it("built_with path: rows null → total 0", async () => {
    queryDatabaseSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await builtWithStatsWithFilter({ body: { network: "facebook", built_with: "X" } }, res);
    expect(res.json.mock.calls[0][0].total).toBe(0);
  });

  it("partial range (only `from`) → no BETWEEN clause", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await builtWithStatsWithFilter(
      { body: { network: "facebook", range: { from: "2025-01-01" } } },
      res,
    );
    const [, , sql] = queryDatabaseSpy.mock.calls[0];
    expect(sql).not.toMatch(/BETWEEN/);
  });

  it("500 via outer catch when queryDatabase rejects", async () => {
    queryDatabaseSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await builtWithStatsWithFilter({ body: { network: "facebook" } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(consoleErrSpy).toHaveBeenCalled();
  });
});
