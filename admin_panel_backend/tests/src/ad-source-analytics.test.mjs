import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// SUT requires `../db-connections/connection` (queryDatabase fn).
// Pre-replace in require.cache so the SUT picks up our spy.
const dbConnPath = require.resolve("../../db-connections/connection");
const queryDatabaseSpy = vi.fn();
require.cache[dbConnPath] = {
  id: dbConnPath, filename: dbConnPath, loaded: true,
  exports: queryDatabaseSpy,
};

const { adSourceFilter } = require("../../src/ad-source-analytics");

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

describe("src/ad-source-analytics > adSourceFilter", () => {
  it("400 when network missing or unknown", async () => {
    const res = mockRes();
    await adSourceFilter({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "Please provide valid network" });

    const res2 = mockRes();
    await adSourceFilter({ body: { network: "tiktok" } }, res2);
    expect(res2.status).toHaveBeenCalledWith(400);
  });

  it("no-filter aggregation: GROUP BY source + ORDER BY num DESC", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([
      { source: "desktop", num: 100 },
      { source: "android", num: 30 },
    ]);
    const res = mockRes();
    await adSourceFilter({ body: { network: "facebook" } }, res);
    const [db_id, , sql, params] = queryDatabaseSpy.mock.calls[0];
    expect(db_id).toBe(0);
    expect(sql).toMatch(/SELECT source, COUNT\(id\) AS num FROM facebook_ad/);
    expect(sql).toMatch(/GROUP BY source ORDER BY num DESC/);
    expect(params).toEqual([]);
    const out = res.json.mock.calls[0][0];
    expect(out.type).toBe("agg");
    expect(out.data).toEqual([
      { source: "desktop", count: 100 },
      { source: "android", count: 30 },
    ]);
    expect(out.total).toEqual({ value: 130, relation: "eq" });
  });

  it("source only: COUNT query with WHERE source = ?", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 42 }]);
    const res = mockRes();
    await adSourceFilter(
      { body: { network: "facebook", source: "desktop" } },
      res,
    );
    const [, , sql, params] = queryDatabaseSpy.mock.calls[0];
    expect(sql).toMatch(/SELECT COUNT\(id\) AS cnt FROM facebook_ad WHERE source = \?/);
    expect(params).toEqual(["desktop"]);
    expect(res.json.mock.calls[0][0]).toEqual({
      type: "count", total: 42, data: [], search_after: null,
    });
  });

  it("range only: adds BETWEEN clause", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await adSourceFilter(
      { body: { network: "facebook", range: { from: "2025-01-01", to: "2025-01-31" } } },
      res,
    );
    const [, , sql, params] = queryDatabaseSpy.mock.calls[0];
    expect(sql).toMatch(/WHERE first_seen BETWEEN \? AND \?/);
    expect(params).toEqual(["2025-01-01 00:00:00", "2025-01-31 23:59:59"]);
  });

  it("source + range: combined WHERE clause", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 6 }]);
    const res = mockRes();
    await adSourceFilter(
      {
        body: {
          network: "facebook",
          source: "desktop",
          range: { from: "2025-01-01", to: "2025-01-31" },
        },
      },
      res,
    );
    const [, , sql, params] = queryDatabaseSpy.mock.calls[0];
    expect(sql).toMatch(/WHERE source = \? AND first_seen BETWEEN \? AND \?/);
    expect(params).toEqual(["desktop", "2025-01-01 00:00:00", "2025-01-31 23:59:59"]);
    expect(res.json.mock.calls[0][0].total).toBe(6);
  });

  it("source + range + linkedin: uses linkedin_ad table + db_id=2", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 0 }]);
    const res = mockRes();
    await adSourceFilter(
      {
        body: {
          network: "linkedin",
          source: "ios",
          range: { from: "2025-01-01", to: "2025-01-31" },
        },
      },
      res,
    );
    const [db_id, , sql] = queryDatabaseSpy.mock.calls[0];
    expect(db_id).toBe(2);
    expect(sql).toMatch(/FROM linkedin_ad/);
  });

  it("rows null → total 0 + empty data", async () => {
    queryDatabaseSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await adSourceFilter({ body: { network: "facebook" } }, res);
    const out = res.json.mock.calls[0][0];
    expect(out.data).toEqual([]);
    expect(out.total.value).toBe(0);
  });

  it("source path: rows[0].cnt null → total 0", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: null }]);
    const res = mockRes();
    await adSourceFilter({ body: { network: "facebook", source: "desktop" } }, res);
    expect(res.json.mock.calls[0][0].total).toBe(0);
  });

  it("source path: rows null → total 0", async () => {
    queryDatabaseSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await adSourceFilter({ body: { network: "facebook", source: "desktop" } }, res);
    expect(res.json.mock.calls[0][0].total).toBe(0);
  });

  it("partial range (only `from`) → no BETWEEN clause", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await adSourceFilter(
      { body: { network: "facebook", range: { from: "2025-01-01" } } },
      res,
    );
    const [, , sql] = queryDatabaseSpy.mock.calls[0];
    expect(sql).not.toMatch(/BETWEEN/);
  });

  it("500 via outer catch when queryDatabase rejects", async () => {
    queryDatabaseSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await adSourceFilter({ body: { network: "facebook" } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(consoleErrSpy).toHaveBeenCalled();
  });

  it.each([
    ["bing", 10, "bing_text_ad"],
    ["google", 9, "google_text_ad"],
    ["gdn", 5, "gdn_ad"],
    ["instagram", 8, "instagram_ad"],
    ["native", 3, "native_ad"],
    ["pinterest", 6, "pinterest_ad"],
    ["quora", 7, "quora_ad"],
    ["reddit", 4, "reddit_ad"],
    ["youtube", 1, "youtube_ad"],
  ])("network=%s routes to db_id=%d + table=%s", async (network, expectedDbId, expectedTable) => {
    queryDatabaseSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await adSourceFilter({ body: { network } }, res);
    const [db_id, , sql] = queryDatabaseSpy.mock.calls[0];
    expect(db_id).toBe(expectedDbId);
    expect(sql).toContain(expectedTable);
  });
});
