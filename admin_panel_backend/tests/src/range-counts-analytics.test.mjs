import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const dbConnPath = require.resolve("../../db-connections/connection");
const queryDatabaseSpy = vi.fn();
require.cache[dbConnPath] = {
  id: dbConnPath, filename: dbConnPath, loaded: true,
  exports: queryDatabaseSpy,
};

const { rangeCountsFilter } = require("../../src/range-counts-analytics");

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

describe("src/range-counts-analytics > rangeCountsFilter", () => {
  it("400 when network missing", async () => {
    const res = mockRes();
    await rangeCountsFilter({ body: { range: { from: "2025-01-01", to: "2025-01-31" } } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "Please provide valid network and range" });
  });

  it("400 when network not in DB_DATA", async () => {
    const res = mockRes();
    await rangeCountsFilter({ body: { network: "tiktok", range: { from: "2025-01-01", to: "2025-01-31" } } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("400 when range missing", async () => {
    const res = mockRes();
    await rangeCountsFilter({ body: { network: "facebook" } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("400 when range.from missing", async () => {
    const res = mockRes();
    await rangeCountsFilter({ body: { network: "facebook", range: { to: "2025-01-31" } } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("400 when range.to missing", async () => {
    const res = mockRes();
    await rangeCountsFilter({ body: { network: "facebook", range: { from: "2025-01-01" } } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("facebook happy path: fires two parallel queries and returns counts", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 10 }]); // newCount
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 50 }]); // activeCount
    const res = mockRes();
    await rangeCountsFilter(
      { body: { network: "facebook", range: { from: "2025-01-01", to: "2025-01-31" } } },
      res,
    );
    expect(queryDatabaseSpy).toHaveBeenCalledTimes(2);
    const [db_id1, , sql1, params1] = queryDatabaseSpy.mock.calls[0];
    const [db_id2, , sql2, params2] = queryDatabaseSpy.mock.calls[1];
    expect(db_id1).toBe(0);
    expect(db_id2).toBe(0);
    expect(sql1).toMatch(/COUNT\(id\) AS cnt FROM facebook_ad WHERE first_seen BETWEEN \? AND \?/);
    expect(params1).toEqual(["2025-01-01 00:00:00", "2025-01-31 23:59:59"]);
    expect(sql2).toMatch(/COUNT\(id\) AS cnt FROM facebook_ad WHERE last_seen >= \?$/);
    expect(params2).toEqual(["2025-01-01 00:00:00"]);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      code: 200,
      message: "success",
      data: { newCount: 10, activeCount: 50 },
    });
  });

  it("gdn: activeCount query has extra `first_seen < to` clause (gdnQ3Quirk)", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 5 }]);
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 25 }]);
    const res = mockRes();
    await rangeCountsFilter(
      { body: { network: "gdn", range: { from: "2025-01-01", to: "2025-01-31" } } },
      res,
    );
    const [, , sql2, params2] = queryDatabaseSpy.mock.calls[1];
    expect(sql2).toMatch(/WHERE last_seen >= \? AND first_seen < \?$/);
    expect(params2).toEqual(["2025-01-01 00:00:00", "2025-01-31 23:59:59"]);
  });

  it("pinterest uses created_date as firstSeenCol", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 0 }]);
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 0 }]);
    const res = mockRes();
    await rangeCountsFilter(
      { body: { network: "pinterest", range: { from: "2025-01-01", to: "2025-01-31" } } },
      res,
    );
    const [, , sql1] = queryDatabaseSpy.mock.calls[0];
    expect(sql1).toMatch(/WHERE created_date BETWEEN/);
  });

  it("youtube uses created_date as firstSeenCol", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 0 }]);
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 0 }]);
    const res = mockRes();
    await rangeCountsFilter(
      { body: { network: "youtube", range: { from: "2025-01-01", to: "2025-01-31" } } },
      res,
    );
    const [, , sql1] = queryDatabaseSpy.mock.calls[0];
    expect(sql1).toMatch(/WHERE created_date BETWEEN/);
  });

  it("rows null or [{cnt:null}] → counts default to 0", async () => {
    queryDatabaseSpy.mockResolvedValueOnce(null);
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: null }]);
    const res = mockRes();
    await rangeCountsFilter(
      { body: { network: "facebook", range: { from: "2025-01-01", to: "2025-01-31" } } },
      res,
    );
    expect(res.json.mock.calls[0][0].data).toEqual({ newCount: 0, activeCount: 0 });
  });

  it("500 via outer catch when queryDatabase rejects", async () => {
    queryDatabaseSpy.mockRejectedValueOnce(new Error("db-down"));
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 0 }]);
    const res = mockRes();
    await rangeCountsFilter(
      { body: { network: "facebook", range: { from: "2025-01-01", to: "2025-01-31" } } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(consoleErrSpy).toHaveBeenCalled();
  });

  it.each([
    ["bing", 10, "bing_text_ad"],
    ["google", 9, "google_text_ad"],
    ["instagram", 8, "instagram_ad"],
    ["linkedin", 2, "linkedin_ad"],
    ["native", 3, "native_ad"],
    ["quora", 7, "quora_ad"],
    ["reddit", 4, "reddit_ad"],
  ])("network=%s routes to db_id=%d + table=%s", async (network, expectedDbId, expectedTable) => {
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 0 }]);
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 0 }]);
    const res = mockRes();
    await rangeCountsFilter(
      { body: { network, range: { from: "2025-01-01", to: "2025-01-31" } } },
      res,
    );
    const [db_id, , sql] = queryDatabaseSpy.mock.calls[0];
    expect(db_id).toBe(expectedDbId);
    expect(sql).toContain(expectedTable);
  });
});
