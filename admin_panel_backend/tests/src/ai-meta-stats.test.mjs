import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Stub the DB and the cache in require.cache so the SUT picks them up — same approach the
// other src/* suites use. No real MySQL.
const dbConnPath = require.resolve("../../db-connections/connection");
const queryDatabaseSpy = vi.fn();
require.cache[dbConnPath] = {
  id: dbConnPath, filename: dbConnPath, loaded: true, exports: queryDatabaseSpy,
};

const cachePath = require.resolve("../../utils/cache");
const cacheStore = new Map();
const cacheStub = {
  get: vi.fn((k) => cacheStore.get(k)),
  set: vi.fn((k, v) => cacheStore.set(k, v)),
};
require.cache[cachePath] = {
  id: cachePath, filename: cachePath, loaded: true, exports: cacheStub,
};

const { dailyAiMetaStats, getNetworkAiMetaStats, AI_META_NETWORKS, NETWORK_KEYS } =
  require("../../src/ai-meta-stats");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

const RANGE = { from: "2026-07-31", to: "2026-07-31" };

beforeEach(() => {
  queryDatabaseSpy.mockReset();
  cacheStore.clear();
  cacheStub.get.mockClear();
  cacheStub.set.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("src/ai-meta-stats > config", () => {
  it("covers only the two platforms that have an ai_meta table", () => {
    expect(NETWORK_KEYS).toEqual(["facebook", "instagram"]);
    expect(AI_META_NETWORKS.facebook.table).toBe("facebook_ad_ai_meta");
    expect(AI_META_NETWORKS.instagram.table).toBe("instagram_ad_ai_meta");
    expect(AI_META_NETWORKS.facebook.db_id).toBe(0);
    expect(AI_META_NETWORKS.instagram.db_id).toBe(8);
  });
});

describe("src/ai-meta-stats > validation", () => {
  it("400 when range is missing", async () => {
    const res = mockRes();
    await dailyAiMetaStats({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toMatch(/Missing required field: range/);
  });

  it("400 when body is absent entirely", async () => {
    const res = mockRes();
    await dailyAiMetaStats({}, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("400 on a malformed or impossible date", async () => {
    const res = mockRes();
    await dailyAiMetaStats({ body: { range: { from: "31/07/2026", to: "2026-07-31" } } }, res);
    expect(res.json.mock.calls[0][0].error).toMatch(/must be YYYY-MM-DD/);

    const res2 = mockRes();
    await dailyAiMetaStats({ body: { range: { from: "2026-13-45", to: "2026-13-46" } } }, res2);
    expect(res2.json.mock.calls[0][0].error).toMatch(/valid dates/);
  });

  it("400 when from is after to", async () => {
    const res = mockRes();
    await dailyAiMetaStats({ body: { range: { from: "2026-07-31", to: "2026-07-01" } } }, res);
    expect(res.json.mock.calls[0][0].error).toMatch(/must not be after/);
  });

  it("400 on a bad networks list", async () => {
    const res = mockRes();
    await dailyAiMetaStats({ body: { range: RANGE, networks: [] } }, res);
    expect(res.json.mock.calls[0][0].error).toMatch(/non-empty array/);

    const res2 = mockRes();
    await dailyAiMetaStats({ body: { range: RANGE, networks: ["google"] } }, res2);
    expect(res2.json.mock.calls[0][0].error).toMatch(/Unsupported network\(s\): google/);
  });
});

describe("src/ai-meta-stats > aggregation", () => {
  it("returns per-day counts and totals for both platforms", async () => {
    queryDatabaseSpy.mockResolvedValue([
      { day: "2026-07-31", updated_count: 4, last_updated: "2026-07-31 05:34:43" },
      { day: "2026-07-29", updated_count: 1, last_updated: "2026-07-29 11:02:00" },
    ]);

    const res = mockRes();
    await dailyAiMetaStats({ body: { range: { from: "2026-07-29", to: "2026-07-31" } } }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.data.networks).toHaveLength(2);
    expect(queryDatabaseSpy).toHaveBeenCalledTimes(2); // one query per platform

    const fb = body.data.networks[0];
    expect(fb.network).toBe("facebook");
    expect(fb.bucket_column).toBe("updated_at");
    expect(fb.daily[0]).toEqual({
      date: "2026-07-31", updated_count: 4, last_updated: "2026-07-31 05:34:43",
    });
    expect(fb.totals).toEqual({ updated: 5, last_updated: "2026-07-31 05:34:43" });

    expect(body.data.summary).toEqual({ updated: 10, networks_ok: 2, networks_failed: 0 });
    expect(body.data.days).toBe(3);
    expect(body.data.generated_at).toEqual(expect.any(String));
  });

  it("reports nothing the table does not record — no failed/pending fields", async () => {
    queryDatabaseSpy.mockResolvedValue([
      { day: "2026-07-31", updated_count: 4, last_updated: "2026-07-31 05:34:43" },
    ]);
    const res = mockRes();
    await dailyAiMetaStats({ body: { range: RANGE } }, res);

    const body = res.json.mock.calls[0][0];
    const fb = body.data.networks[0];
    expect(Object.keys(fb.totals)).toEqual(["updated", "last_updated"]);
    expect(Object.keys(fb.daily[0])).toEqual(["date", "updated_count", "last_updated"]);
    expect(fb.failed).toBeUndefined();
    expect(fb.backlog).toBeUndefined();
    expect(body.data.summary.failed).toBeUndefined();
  });

  it("buckets on updated_at and binds the whole day, so 'today' means today up to now", async () => {
    queryDatabaseSpy.mockResolvedValue([]);
    const res = mockRes();
    await dailyAiMetaStats({ body: { range: RANGE, networks: ["facebook"] } }, res);

    const [db_id, index, sql, params] = queryDatabaseSpy.mock.calls[0];
    expect(db_id).toBe(0);
    expect(index).toBe(AI_META_NETWORKS.facebook.index);
    expect(sql).toMatch(/FROM `facebook_ad_ai_meta`/);
    expect(sql).toMatch(/DATE_FORMAT\(`updated_at`, '%Y-%m-%d'\) AS day/);
    expect(sql).toMatch(/COUNT\(\*\) AS updated_count/);
    expect(sql).toMatch(/GROUP BY day/);
    expect(params).toEqual(["2026-07-31 00:00:00", "2026-07-31 23:59:59"]);
  });

  it("filters to the requested platform", async () => {
    queryDatabaseSpy.mockResolvedValue([]);
    const res = mockRes();
    await dailyAiMetaStats({ body: { range: RANGE, networks: ["INSTAGRAM"] } }, res);
    const nets = res.json.mock.calls[0][0].data.networks.map((n) => n.network);
    expect(nets).toEqual(["instagram"]);
    expect(queryDatabaseSpy.mock.calls[0][2]).toMatch(/instagram_ad_ai_meta/);
  });

  it("a day with no rows in range yields zeroed totals, not NaN", async () => {
    queryDatabaseSpy.mockResolvedValue(undefined);
    const res = mockRes();
    await dailyAiMetaStats({ body: { range: RANGE } }, res);
    const fb = res.json.mock.calls[0][0].data.networks[0];
    expect(fb.daily).toEqual([]);
    expect(fb.totals).toEqual({ updated: 0, last_updated: null });
  });

  it("keeps last_updated null when the newest row has no stamp", async () => {
    queryDatabaseSpy.mockResolvedValue([{ day: "2026-07-31", updated_count: 2, last_updated: null }]);
    const res = mockRes();
    await dailyAiMetaStats({ body: { range: RANGE, networks: ["facebook"] } }, res);
    const fb = res.json.mock.calls[0][0].data.networks[0];
    expect(fb.daily[0].last_updated).toBeNull();
    expect(fb.totals.last_updated).toBeNull();
  });
});

describe("src/ai-meta-stats > resilience & caching", () => {
  it("one dead platform does not sink the other", async () => {
    queryDatabaseSpy.mockImplementation((db_id) =>
      db_id === 8
        ? Promise.reject(new Error("db-down"))
        : Promise.resolve([{ day: "2026-07-31", updated_count: 4, last_updated: "2026-07-31 05:34:43" }])
    );
    const res = mockRes();
    await dailyAiMetaStats({ body: { range: RANGE } }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    const ig = body.data.networks.find((n) => n.network === "instagram");
    expect(ig.error).toBe("db-down");
    expect(ig.totals).toEqual({ updated: 0, last_updated: null });
    expect(body.data.summary).toEqual({ updated: 4, networks_ok: 1, networks_failed: 1 });
  });

  it("500 when something outside the per-platform guard blows up", async () => {
    cacheStub.get.mockImplementationOnce(() => { throw new Error("cache exploded"); });
    const res = mockRes();
    await dailyAiMetaStats({ body: { range: RANGE } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ code: 500, error: "Internal Server Error" });
  });

  it("serves a repeat request from cache, keyed by range + platform selection", async () => {
    queryDatabaseSpy.mockResolvedValue([]);
    const res1 = mockRes();
    await dailyAiMetaStats({ body: { range: RANGE, networks: ["facebook"] } }, res1);
    const after = queryDatabaseSpy.mock.calls.length;

    const res2 = mockRes();
    await dailyAiMetaStats({ body: { range: RANGE, networks: ["facebook"] } }, res2);
    expect(queryDatabaseSpy.mock.calls.length).toBe(after);
    expect(res2.json.mock.calls[0][0]).toEqual(res1.json.mock.calls[0][0]);
    expect(cacheStub.set.mock.calls[0][0]).toBe("aiMetaStats-2026-07-31-2026-07-31-facebook");
  });
});

describe("src/ai-meta-stats > getNetworkAiMetaStats", () => {
  it("is exported for reuse and propagates errors to its caller", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([
      { day: "2026-07-31", updated_count: 3, last_updated: "2026-07-31 05:33:41" },
    ]);
    const out = await getNetworkAiMetaStats("instagram", RANGE);
    expect(out).toEqual({
      network: "instagram",
      label: "Instagram",
      table: "instagram_ad_ai_meta",
      bucket_column: "updated_at",
      daily: [{ date: "2026-07-31", updated_count: 3, last_updated: "2026-07-31 05:33:41" }],
      totals: { updated: 3, last_updated: "2026-07-31 05:33:41" },
      error: null,
    });

    queryDatabaseSpy.mockRejectedValueOnce(new Error("boom"));
    await expect(getNetworkAiMetaStats("facebook", RANGE)).rejects.toThrow("boom");
  });
});
