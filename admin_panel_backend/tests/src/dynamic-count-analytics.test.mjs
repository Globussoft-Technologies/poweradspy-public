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

const norm = (s) => s.replace(/\s+/g, " ").trim();
const RANGE = { from: "2025-01-01", to: "2025-01-31" };
const WIN = ["2025-01-01 00:00:00", "2025-02-01 00:00:00"]; // 12am→12am, exclusive next-midnight

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

  it("400 when network unknown (e.g. tiktok)", async () => {
    const res = mockRes();
    await dynamicCountFilter({ body: { network: "tiktok", range: RANGE } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("400 when metric invalid", async () => {
    const res = mockRes();
    await dynamicCountFilter({ body: { network: "facebook", metric: "bogus", range: RANGE } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/Invalid metric/);
  });

  it("400 when a windowed metric is missing range", async () => {
    const res = mockRes();
    await dynamicCountFilter({ body: { network: "facebook", metric: "new" } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/requires range/);
  });

  it("400 when platform is non-integer junk", async () => {
    const res = mockRes();
    await dynamicCountFilter({ body: { network: "youtube", metric: "platform", range: RANGE, platform: "abc" } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/platform must be/);
  });

  // ── range (default) → newCount + activeCount ──────────────────────────────
  it("range: two parallel queries, returns newCount + activeCount (default metric)", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 10 }]); // new
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 50 }]); // active
    const res = mockRes();
    await dynamicCountFilter({ body: { network: "facebook", range: RANGE } }, res);
    expect(queryDatabaseSpy).toHaveBeenCalledTimes(2);
    const [, , sqlNew, pNew] = queryDatabaseSpy.mock.calls[0];
    const [, , sqlAct, pAct] = queryDatabaseSpy.mock.calls[1];
    expect(norm(sqlNew)).toBe("SELECT COUNT(id) AS cnt FROM facebook_ad WHERE first_seen >= ? AND first_seen < ?");
    // active = ads whose last sighting falls in the window (last_seen bounded both ends)
    expect(norm(sqlAct)).toBe("SELECT COUNT(id) AS cnt FROM facebook_ad WHERE last_seen >= ? AND last_seen < ?");
    expect(pNew).toEqual(WIN);
    expect(pAct).toEqual(WIN);
    expect(res.json).toHaveBeenCalledWith({ code: 200, message: "success", data: { newCount: 10, activeCount: 50 } });
  });

  it("range: youtube 'new' uses created_date as firstSeen column", async () => {
    queryDatabaseSpy.mockResolvedValue([{ cnt: 0 }]);
    const res = mockRes();
    await dynamicCountFilter({ body: { network: "youtube", range: RANGE } }, res);
    const [, , sqlNew] = queryDatabaseSpy.mock.calls[0];
    expect(norm(sqlNew)).toBe("SELECT COUNT(id) AS cnt FROM youtube_ad WHERE created_date >= ? AND created_date < ?");
  });

  it("range: 'active' is a last_seen window for every network (incl. gdn & youtube — no per-network variant)", async () => {
    queryDatabaseSpy.mockResolvedValue([{ cnt: 0 }]);
    const resG = mockRes();
    await dynamicCountFilter({ body: { network: "gdn", range: RANGE } }, resG);
    const [, , sqlGdn, pGdn] = queryDatabaseSpy.mock.calls[1];
    expect(norm(sqlGdn)).toBe("SELECT COUNT(id) AS cnt FROM gdn_ad WHERE last_seen >= ? AND last_seen < ?");
    expect(pGdn).toEqual(WIN);

    queryDatabaseSpy.mockClear();
    const resY = mockRes();
    await dynamicCountFilter({ body: { network: "youtube", metric: "active", range: RANGE } }, resY);
    expect(norm(queryDatabaseSpy.mock.calls[0][2])).toBe(
      "SELECT COUNT(id) AS cnt FROM youtube_ad WHERE last_seen >= ? AND last_seen < ?");
  });

  // ── new / active singles ──────────────────────────────────────────────────
  it("metric=new returns a single total", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 5401 }]);
    const res = mockRes();
    await dynamicCountFilter({ body: { network: "youtube", metric: "new", range: RANGE } }, res);
    expect(queryDatabaseSpy).toHaveBeenCalledTimes(1);
    expect(res.json).toHaveBeenCalledWith({ code: 200, message: "success", data: { total: 5401 } });
  });

  it("metric=active returns a single total", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 9742 }]);
    const res = mockRes();
    await dynamicCountFilter({ body: { network: "youtube", metric: "active", range: RANGE } }, res);
    expect(res.json.mock.calls[0][0].data).toEqual({ total: 9742 });
  });

  it("metric=lifetime is rejected (lifetime is served from ES, not here)", async () => {
    const res = mockRes();
    await dynamicCountFilter({ body: { network: "youtube", metric: "lifetime", range: RANGE } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/Invalid metric/);
  });

  // ── platform (plugin cards / DS New Ads per Platform) ─────────────────────
  it("platform filter on non-facebook hits meta table + created_date, counts id", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 5401 }]);
    const res = mockRes();
    await dynamicCountFilter({ body: { network: "youtube", metric: "platform", range: RANGE, platform: 12 } }, res);
    const [, , sql, params] = queryDatabaseSpy.mock.calls[0];
    expect(norm(sql)).toBe(
      "SELECT COUNT(id) AS cnt FROM youtube_ad_meta_data WHERE created_date >= ? AND created_date < ? AND platform IN (?)");
    expect(params).toEqual([...WIN, 12]);
    expect(res.json.mock.calls[0][0].data).toEqual({ total: 5401 });
  });

  it("platform on facebook hits the main table (platform lives there)", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 3 }]);
    const res = mockRes();
    await dynamicCountFilter({ body: { network: "facebook", metric: "platform", range: RANGE, platform: [3, 10] } }, res);
    const [, , sql, params] = queryDatabaseSpy.mock.calls[0];
    expect(norm(sql)).toBe(
      "SELECT COUNT(id) AS cnt FROM facebook_ad WHERE created_date >= ? AND created_date < ? AND platform IN (?, ?)");
    expect(params).toEqual([...WIN, 3, 10]);
  });

  it("platform on bing/linkedin counts the FK column, not id", async () => {
    queryDatabaseSpy.mockResolvedValue([{ cnt: 0 }]);
    const resB = mockRes();
    await dynamicCountFilter({ body: { network: "bing", metric: "platform", range: RANGE, platform: 12 } }, resB);
    expect(norm(queryDatabaseSpy.mock.calls[0][2])).toContain("SELECT COUNT(bing_text_ad_id) AS cnt FROM bing_text_ad_meta_data");

    queryDatabaseSpy.mockClear();
    const resL = mockRes();
    await dynamicCountFilter({ body: { network: "linkedin", metric: "platform", range: RANGE, platform: 12 } }, resL);
    const sql = norm(queryDatabaseSpy.mock.calls[0][2]);
    expect(sql).toContain("SELECT COUNT(linkedin_ad_id) AS cnt FROM linkedin_ad_meta_data");
    expect(sql).toContain("created_at >= ? AND created_at < ?"); // linkedin uses created_at
  });

  it("platform without filter returns per-platform buckets + total", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([
      { platform: 12, cnt: 5401 }, { platform: 3, cnt: 100 },
    ]);
    const res = mockRes();
    await dynamicCountFilter({ body: { network: "youtube", metric: "platform", range: RANGE } }, res);
    const [, , sql] = queryDatabaseSpy.mock.calls[0];
    expect(norm(sql)).toBe(
      "SELECT platform, COUNT(id) AS cnt FROM youtube_ad_meta_data WHERE created_date >= ? AND created_date < ? GROUP BY platform ORDER BY cnt DESC");
    expect(res.json.mock.calls[0][0].data).toEqual({
      total: 5501,
      buckets: [{ platform: 12, count: 5401 }, { platform: 3, count: 100 }],
    });
  });

  // ── new + groupBy (DS New Ads based on Type / Position / Source) ──────────
  it("metric=new groupBy=type groups main table on first_seen, COUNT(id)", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ bucket: "VIDEO", cnt: 922 }, { bucket: "IMAGE", cnt: 4479 }]);
    const res = mockRes();
    await dynamicCountFilter({ body: { network: "youtube", metric: "new", range: RANGE, groupBy: "type" } }, res);
    const [, , sql, params] = queryDatabaseSpy.mock.calls[0];
    expect(norm(sql)).toBe(
      "SELECT type AS bucket, COUNT(id) AS cnt FROM youtube_ad WHERE first_seen >= ? AND first_seen < ? GROUP BY type ORDER BY cnt DESC");
    expect(params).toEqual(WIN); // first_seen even though youtube 'new' total uses created_date
    expect(res.json.mock.calls[0][0].data).toEqual({
      total: 5401, groupBy: "type",
      buckets: [{ key: "VIDEO", count: 922 }, { key: "IMAGE", count: 4479 }],
    });
  });

  it("metric=new groupBy=ad_position / source build the right column", async () => {
    queryDatabaseSpy.mockResolvedValue([{ bucket: "x", cnt: 1 }]);
    const resP = mockRes();
    await dynamicCountFilter({ body: { network: "facebook", metric: "new", range: RANGE, groupBy: "ad_position" } }, resP);
    expect(norm(queryDatabaseSpy.mock.calls[0][2])).toContain("SELECT ad_position AS bucket, COUNT(id) AS cnt FROM facebook_ad");
    queryDatabaseSpy.mockClear();
    const resS = mockRes();
    await dynamicCountFilter({ body: { network: "facebook", metric: "new", range: RANGE, groupBy: "source" } }, resS);
    expect(norm(queryDatabaseSpy.mock.calls[0][2])).toContain("SELECT source AS bucket, COUNT(id) AS cnt FROM facebook_ad");
  });

  it("400 on invalid groupBy", async () => {
    const res = mockRes();
    await dynamicCountFilter({ body: { network: "facebook", metric: "new", range: RANGE, groupBy: "country" } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/Invalid groupBy/);
  });

  // ── processed (DS Destination URLs / ScreenShot / Builtwith Processed) ─────
  it("metric=processed stage=builtwith counts meta table on built_with_date", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 0 }]);
    const res = mockRes();
    await dynamicCountFilter({ body: { network: "youtube", metric: "processed", range: RANGE, stage: "builtwith" } }, res);
    const [, , sql, params] = queryDatabaseSpy.mock.calls[0];
    expect(norm(sql)).toBe(
      "SELECT COUNT(id) AS cnt FROM youtube_ad_meta_data WHERE built_with_date >= ? AND built_with_date < ?");
    expect(params).toEqual(WIN);
    expect(res.json.mock.calls[0][0].data).toEqual({ total: 0 });
  });

  it("processed stages map to the right date columns", async () => {
    const stages = { destination: "white_lander_date", screenshot: "screenshot_date", builtwith: "built_with_date" };
    for (const [stage, dateCol] of Object.entries(stages)) {
      queryDatabaseSpy.mockReset().mockResolvedValueOnce([{ cnt: 0 }]);
      const res = mockRes();
      await dynamicCountFilter({ body: { network: "reddit", metric: "processed", range: RANGE, stage } }, res);
      expect(norm(queryDatabaseSpy.mock.calls[0][2])).toContain(`${dateCol} >= ? AND ${dateCol} < ?`);
    }
  });

  it("processed on facebook/bing count the FK, not id", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ cnt: 0 }]);
    const resF = mockRes();
    await dynamicCountFilter({ body: { network: "facebook", metric: "processed", range: RANGE, stage: "screenshot" } }, resF);
    expect(norm(queryDatabaseSpy.mock.calls[0][2])).toContain("SELECT COUNT(facebook_ad_id) AS cnt FROM facebook_ad_meta_data");
  });

  it("processed on linkedin routes each stage to its dedicated table, COUNT(fk)", async () => {
    const expected = {
      destination: "linkedin_ad_lander",
      screenshot: "linkedin_ad_meta_data",
      builtwith: "linkedin_ad_built_with",
    };
    for (const [stage, table] of Object.entries(expected)) {
      queryDatabaseSpy.mockReset().mockResolvedValueOnce([{ cnt: 0 }]);
      const res = mockRes();
      await dynamicCountFilter({ body: { network: "linkedin", metric: "processed", range: RANGE, stage } }, res);
      expect(norm(queryDatabaseSpy.mock.calls[0][2])).toBe(
        `SELECT COUNT(linkedin_ad_id) AS cnt FROM ${table} WHERE ${stage === "builtwith" ? "built_with_date" : stage === "screenshot" ? "screenshot_date" : "white_lander_date"} >= ? AND ${stage === "builtwith" ? "built_with_date" : stage === "screenshot" ? "screenshot_date" : "white_lander_date"} < ?`);
    }
  });

  it("400 when metric=processed has no/invalid stage", async () => {
    const res = mockRes();
    await dynamicCountFilter({ body: { network: "facebook", metric: "processed", range: RANGE } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toMatch(/requires stage/);
  });

  // ── resilience ────────────────────────────────────────────────────────────
  it("rows null → counts default to 0", async () => {
    queryDatabaseSpy.mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    const res = mockRes();
    await dynamicCountFilter({ body: { network: "facebook", range: RANGE } }, res);
    expect(res.json.mock.calls[0][0].data).toEqual({ newCount: 0, activeCount: 0 });
  });

  it("500 when queryDatabase rejects", async () => {
    queryDatabaseSpy.mockRejectedValue(new Error("db-down"));
    const res = mockRes();
    await dynamicCountFilter({ body: { network: "facebook", metric: "new", range: RANGE } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(consoleErrSpy).toHaveBeenCalled();
  });
});
