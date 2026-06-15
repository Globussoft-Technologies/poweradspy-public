import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const dbConnPath = require.resolve("../../db-connections/connection");
const queryDatabaseSpy = vi.fn();
require.cache[dbConnPath] = {
  id: dbConnPath, filename: dbConnPath, loaded: true,
  exports: queryDatabaseSpy,
};

const { dynamicCountFilter } = require("../../src/dynamic-count-analytics");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

// collapse whitespace so multi-line SQL is easy to assert against
const norm = (s) => s.replace(/\s+/g, " ").trim();

let consoleErrSpy;
beforeEach(() => {
  queryDatabaseSpy.mockReset();
  consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("src/dynamic-count-analytics > dynamicCountFilter", () => {
  // ── validation ──────────────────────────────────────────────────────────
  it("400 when network missing", async () => {
    const res = mockRes();
    await dynamicCountFilter({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "Please provide a valid network" });
  });

  it("400 when network unknown", async () => {
    const res = mockRes();
    await dynamicCountFilter({ body: { network: "tiktok" } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("400 when dateField invalid", async () => {
    const res = mockRes();
    await dynamicCountFilter({ body: { network: "facebook", dateField: "bogus" } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/Invalid dateField/);
  });

  it("400 when groupBy invalid", async () => {
    const res = mockRes();
    await dynamicCountFilter({ body: { network: "facebook", groupBy: "country" } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/Invalid groupBy/);
  });

  it("400 when platform is non-integer junk", async () => {
    const res = mockRes();
    await dynamicCountFilter({ body: { network: "facebook", platform: "abc" } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/platform must be/);
  });

  // ── total branch ────────────────────────────────────────────────────────
  it("lifetime total: no filters → COUNT(DISTINCT) with no WHERE", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 42 }]);
    const res = mockRes();
    await dynamicCountFilter({ body: { network: "facebook" } }, res);
    const [db_id, , sql, params] = queryDatabaseSpy.mock.calls[0];
    expect(db_id).toBe(0);
    expect(norm(sql)).toBe("SELECT COUNT(DISTINCT a.id) AS cnt FROM facebook_ad a");
    expect(params).toEqual([]);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ code: 200, message: "success", data: { total: 42 } });
  });

  it("total + range uses 12am→12am window on default first_seen", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 5 }]);
    const res = mockRes();
    await dynamicCountFilter(
      { body: { network: "reddit", range: { from: "2025-01-01", to: "2025-01-31" } } }, res);
    const [, , sql, params] = queryDatabaseSpy.mock.calls[0];
    expect(norm(sql)).toBe(
      "SELECT COUNT(DISTINCT a.id) AS cnt FROM reddit_ad a WHERE a.first_seen >= ? AND a.first_seen < ?");
    expect(params).toEqual(["2025-01-01 00:00:00", "2025-02-01 00:00:00"]);
  });

  it("dateField=last_seen switches the date column", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 0 }]);
    const res = mockRes();
    await dynamicCountFilter(
      { body: { network: "reddit", dateField: "last_seen", range: { from: "2025-01-01", to: "2025-01-01" } } }, res);
    const [, , sql, params] = queryDatabaseSpy.mock.calls[0];
    expect(norm(sql)).toContain("WHERE a.last_seen >= ? AND a.last_seen < ?");
    expect(params).toEqual(["2025-01-01 00:00:00", "2025-01-02 00:00:00"]);
  });

  it("linkedin created_date maps to created_at", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 0 }]);
    const res = mockRes();
    await dynamicCountFilter(
      { body: { network: "linkedin", dateField: "created_date", range: { from: "2025-01-01", to: "2025-01-01" } } }, res);
    const [, , sql] = queryDatabaseSpy.mock.calls[0];
    expect(norm(sql)).toContain("WHERE a.created_at >= ? AND a.created_at < ?");
  });

  it("facebook platform filter uses main-table column", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 3 }]);
    const res = mockRes();
    await dynamicCountFilter({ body: { network: "facebook", platform: 3 } }, res);
    const [, , sql, params] = queryDatabaseSpy.mock.calls[0];
    expect(norm(sql)).toBe("SELECT COUNT(DISTINCT a.id) AS cnt FROM facebook_ad a WHERE a.platform IN (?)");
    expect(params).toEqual([3]);
  });

  it("non-facebook platform filter uses EXISTS on meta table; array of codes", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 7 }]);
    const res = mockRes();
    await dynamicCountFilter({ body: { network: "reddit", platform: [3, 10, 12] } }, res);
    const [, , sql, params] = queryDatabaseSpy.mock.calls[0];
    expect(norm(sql)).toBe(
      "SELECT COUNT(DISTINCT a.id) AS cnt FROM reddit_ad a WHERE EXISTS (SELECT 1 FROM reddit_ad_meta_data m WHERE m.reddit_ad_id = a.id AND m.platform IN (?, ?, ?))");
    expect(params).toEqual([3, 10, 12]);
  });

  it("range + platform: window params precede platform params", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 1 }]);
    const res = mockRes();
    await dynamicCountFilter(
      { body: { network: "reddit", range: { from: "2025-01-01", to: "2025-01-01" }, platform: 12 } }, res);
    const [, , , params] = queryDatabaseSpy.mock.calls[0];
    expect(params).toEqual(["2025-01-01 00:00:00", "2025-01-02 00:00:00", 12]);
  });

  // ── group-by branch ──────────────────────────────────────────────────────
  it("groupBy=source counts distinct ads per main-table column", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ bucket: "desktop", cnt: 9 }, { bucket: "android", cnt: 4 }]);
    const res = mockRes();
    await dynamicCountFilter({ body: { network: "reddit", groupBy: "source" } }, res);
    const [, , sql] = queryDatabaseSpy.mock.calls[0];
    expect(norm(sql)).toBe(
      "SELECT a.source AS bucket, COUNT(DISTINCT a.id) AS cnt FROM reddit_ad a GROUP BY a.source ORDER BY cnt DESC");
    expect(res.json.mock.calls[0][0].data).toEqual({
      total: 13, groupBy: "source",
      buckets: [{ key: "desktop", count: 9 }, { key: "android", count: 4 }],
    });
  });

  it("groupBy=platform on facebook groups the main-table column", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ bucket: 12, cnt: 7389 }]);
    const res = mockRes();
    await dynamicCountFilter({ body: { network: "facebook", groupBy: "platform" } }, res);
    const [, , sql] = queryDatabaseSpy.mock.calls[0];
    expect(norm(sql)).toBe(
      "SELECT a.platform AS bucket, COUNT(DISTINCT a.id) AS cnt FROM facebook_ad a GROUP BY a.platform ORDER BY cnt DESC");
  });

  it("groupBy=platform on non-facebook joins the meta table", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ bucket: 12, cnt: 100 }]);
    const res = mockRes();
    await dynamicCountFilter(
      { body: { network: "youtube", groupBy: "platform", range: { from: "2025-01-01", to: "2025-01-01" } } }, res);
    const [, , sql, params] = queryDatabaseSpy.mock.calls[0];
    expect(norm(sql)).toBe(
      "SELECT m.platform AS bucket, COUNT(DISTINCT a.id) AS cnt FROM youtube_ad a JOIN youtube_ad_meta_data m ON m.youtube_ad_id = a.id WHERE a.first_seen >= ? AND a.first_seen < ? AND m.platform IS NOT NULL GROUP BY m.platform ORDER BY cnt DESC");
    expect(params).toEqual(["2025-01-01 00:00:00", "2025-01-02 00:00:00"]);
  });

  it("groupBy=platform non-facebook + platform filter adds IN on the join", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ bucket: 3, cnt: 2 }]);
    const res = mockRes();
    await dynamicCountFilter({ body: { network: "youtube", groupBy: "platform", platform: [3, 15] } }, res);
    const [, , sql, params] = queryDatabaseSpy.mock.calls[0];
    expect(norm(sql)).toContain("WHERE m.platform IS NOT NULL AND m.platform IN (?, ?)");
    expect(params).toEqual([3, 15]);
  });

  // ── resilience ────────────────────────────────────────────────────────────
  it("rows null → total defaults to 0", async () => {
    queryDatabaseSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await dynamicCountFilter({ body: { network: "facebook" } }, res);
    expect(res.json.mock.calls[0][0].data).toEqual({ total: 0 });
  });

  it("500 when queryDatabase rejects", async () => {
    queryDatabaseSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await dynamicCountFilter({ body: { network: "facebook" } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(consoleErrSpy).toHaveBeenCalled();
  });
});
