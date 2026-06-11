import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// The SUT calls `require('../db-connections/connection')` which exports a
// queryDatabase function. Pre-replace the module in require.cache before SUT loads.
const dbConnPath = require.resolve("../../db-connections/connection");
const queryDatabaseSpy = vi.fn();
require.cache[dbConnPath] = {
  id: dbConnPath, filename: dbConnPath, loaded: true,
  exports: queryDatabaseSpy,
};

const { adPositionFilter } = require("../../src/ad-position-analytics");

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

describe("src/ad-position-analytics > adPositionFilter", () => {
  it("400 when network missing or unknown", async () => {
    const res = mockRes();
    await adPositionFilter({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "Please provide valid network" });

    const res2 = mockRes();
    await adPositionFilter({ body: { network: "tiktok" } }, res2);
    expect(res2.status).toHaveBeenCalledWith(400);
  });

  it("no-filter aggregation: GROUP BY ad_position + ORDER BY num DESC", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([
      { ad_position: "feed", num: 100 },
      { ad_position: "sidebar", num: 50 },
    ]);
    const res = mockRes();
    await adPositionFilter({ body: { network: "facebook" } }, res);
    const [db_id, index, sql, params] = queryDatabaseSpy.mock.calls[0];
    expect(db_id).toBe(0);
    expect(sql).toMatch(/SELECT ad_position, COUNT\(id\) AS num FROM facebook_ad/);
    expect(sql).toMatch(/GROUP BY ad_position ORDER BY num DESC/);
    expect(params).toEqual([]);
    const out = res.json.mock.calls[0][0];
    expect(out.type).toBe("agg");
    expect(out.data).toEqual([
      { position: "feed", count: 100 },
      { position: "sidebar", count: 50 },
    ]);
    expect(out.total).toEqual({ value: 150, relation: "eq" });
  });

  it("position only: COUNT query with WHERE ad_position = ?", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 12 }]);
    const res = mockRes();
    await adPositionFilter(
      { body: { network: "facebook", position: "feed" } },
      res,
    );
    const [, , sql, params] = queryDatabaseSpy.mock.calls[0];
    expect(sql).toMatch(/SELECT COUNT\(id\) AS cnt FROM facebook_ad WHERE ad_position = \?/);
    expect(params).toEqual(["feed"]);
    expect(res.json.mock.calls[0][0]).toEqual({
      type: "count", total: 12, data: [], search_after: null,
    });
  });

  it("range only: adds BETWEEN ? AND ? to the aggregation SQL", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await adPositionFilter(
      { body: { network: "facebook", range: { from: "2025-01-01", to: "2025-01-31" } } },
      res,
    );
    const [, , sql, params] = queryDatabaseSpy.mock.calls[0];
    expect(sql).toMatch(/WHERE first_seen BETWEEN \? AND \?/);
    expect(params).toEqual(["2025-01-01 00:00:00", "2025-01-31 23:59:59"]);
  });

  it("position + range: COUNT with WHERE ad_position AND first_seen BETWEEN", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 6 }]);
    const res = mockRes();
    await adPositionFilter(
      {
        body: {
          network: "facebook",
          position: "feed",
          range: { from: "2025-01-01", to: "2025-01-31" },
        },
      },
      res,
    );
    const [, , sql, params] = queryDatabaseSpy.mock.calls[0];
    expect(sql).toMatch(/WHERE ad_position = \? AND first_seen BETWEEN \? AND \?/);
    expect(params).toEqual(["feed", "2025-01-01 00:00:00", "2025-01-31 23:59:59"]);
    expect(res.json.mock.calls[0][0].total).toBe(6);
  });

  it("position + range + linkedin: uses linkedin_ad table + db_id=2", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 0 }]);
    const res = mockRes();
    await adPositionFilter(
      {
        body: {
          network: "linkedin",
          position: "sidebar",
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
    await adPositionFilter({ body: { network: "facebook" } }, res);
    const out = res.json.mock.calls[0][0];
    expect(out.data).toEqual([]);
    expect(out.total.value).toBe(0);
  });

  it("position path: rows[0].cnt null → total 0", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: null }]);
    const res = mockRes();
    await adPositionFilter({ body: { network: "facebook", position: "feed" } }, res);
    expect(res.json.mock.calls[0][0].total).toBe(0);
  });

  it("position path: rows null → total 0", async () => {
    queryDatabaseSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await adPositionFilter({ body: { network: "facebook", position: "feed" } }, res);
    expect(res.json.mock.calls[0][0].total).toBe(0);
  });

  it("partial range (only `from`) treated as no range", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await adPositionFilter(
      { body: { network: "facebook", range: { from: "2025-01-01" } } },
      res,
    );
    const [, , sql] = queryDatabaseSpy.mock.calls[0];
    // hasRange=false (missing `to`) → no BETWEEN clause
    expect(sql).not.toMatch(/BETWEEN/);
  });

  it("500 via outer catch when queryDatabase rejects", async () => {
    queryDatabaseSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await adPositionFilter({ body: { network: "facebook" } }, res);
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
    await adPositionFilter({ body: { network } }, res);
    const [db_id, , sql] = queryDatabaseSpy.mock.calls[0];
    expect(db_id).toBe(expectedDbId);
    expect(sql).toContain(expectedTable);
  });
});
