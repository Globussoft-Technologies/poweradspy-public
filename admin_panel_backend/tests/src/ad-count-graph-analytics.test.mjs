import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Mock queryDatabase
const dbConnPath = require.resolve("../../db-connections/connection");
const queryDatabaseSpy = vi.fn();
require.cache[dbConnPath] = {
  id: dbConnPath, filename: dbConnPath, loaded: true,
  exports: queryDatabaseSpy,
};

// Mock ioredis (sealed npm, called with `new`)
const ioredisPath = require.resolve("ioredis");
const redisGetSpy = vi.fn();
const redisSetSpy = vi.fn();
const RedisCtor = vi.fn(function (opts) {
  this.opts = opts;
  this.get = redisGetSpy;
  this.set = redisSetSpy;
});
require.cache[ioredisPath] = {
  id: ioredisPath, filename: ioredisPath, loaded: true,
  exports: RedisCtor,
};

const { adCountGraphFilter } = require("../../src/ad-count-graph-analytics");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

let consoleErrSpy;
beforeEach(() => {
  queryDatabaseSpy.mockReset();
  redisGetSpy.mockReset();
  redisSetSpy.mockReset().mockResolvedValue("OK");
  consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => consoleErrSpy.mockRestore());

describe("src/ad-count-graph-analytics > adCountGraphFilter", () => {
  it("400 when network missing", async () => {
    const res = mockRes();
    await adCountGraphFilter({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "Please provide valid network" });
  });

  it("400 when network not in DB_DATA", async () => {
    const res = mockRes();
    await adCountGraphFilter({ body: { network: "unknown" } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("cache MISS: queries 6 months, builds platforms map, sets cache, returns 200", async () => {
    redisGetSpy.mockResolvedValueOnce(null);
    queryDatabaseSpy.mockResolvedValueOnce([
      { platform: 13, month: 1, total_ads: 100 },
      { platform: 13, month: 2, total_ads: 200 },
      { platform: 15, month: 1, total_ads: 50 },
    ]);
    const res = mockRes();
    await adCountGraphFilter({ body: { network: "facebook" } }, res);
    // The 6-month SQL should have been issued
    expect(queryDatabaseSpy).toHaveBeenCalledTimes(1);
    const sql = queryDatabaseSpy.mock.calls[0][2];
    expect(sql).toMatch(/MONTH\(first_seen\) AS month/);
    expect(sql).toMatch(/FROM\s+facebook_ad/);
    // Redis SET with EX TTL
    expect(redisSetSpy).toHaveBeenCalledWith(
      "adCountGraph:facebook",
      expect.any(String),
      "EX",
      expect.any(Number)
    );
    expect(res.status).toHaveBeenCalledWith(200);
    const payload = res.json.mock.calls[0][0];
    expect(payload.code).toBe(200);
    expect(payload.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ platform: 13 }),
        expect.objectContaining({ platform: 15 }),
      ])
    );
  });

  it("cache MISS: handles empty queryDatabase result (no rows)", async () => {
    redisGetSpy.mockResolvedValueOnce(null);
    queryDatabaseSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await adCountGraphFilter({ body: { network: "youtube" } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json.mock.calls[0][0].data).toEqual([]);
  });

  it("cache HIT: queries current-month delta, patches last index, returns 200", async () => {
    const cached = [
      { platform: 13, data: [100, 200, 300, 400, 500, 600] },
      { platform: 15, data: [10, 20, 30, 40, 50, 60] },
    ];
    redisGetSpy.mockResolvedValueOnce(JSON.stringify(cached));
    queryDatabaseSpy.mockResolvedValueOnce([
      { platform: 13, total_ads: 999 },
      // platform 15 has no delta row -> stays 60
    ]);
    const res = mockRes();
    await adCountGraphFilter({ body: { network: "facebook" } }, res);
    expect(queryDatabaseSpy).toHaveBeenCalledTimes(1);
    const sql = queryDatabaseSpy.mock.calls[0][2];
    expect(sql).toMatch(/GROUP BY\s+platform/);
    expect(sql).not.toMatch(/MONTH\(/); // not the 6-month query
    expect(redisSetSpy).toHaveBeenCalled();
    const payload = res.json.mock.calls[0][0];
    // platform 13's last slot patched to 999; platform 15 unchanged
    const p13 = payload.data.find((p) => p.platform === 13);
    const p15 = payload.data.find((p) => p.platform === 15);
    expect(p13.data[5]).toBe(999);
    expect(p15.data[5]).toBe(60);
  });

  it("500 via outer catch when queryDatabase rejects", async () => {
    redisGetSpy.mockResolvedValueOnce(null);
    queryDatabaseSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await adCountGraphFilter({ body: { network: "facebook" } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal Server Error" });
  });

  it("500 via outer catch when redis.get rejects", async () => {
    redisGetSpy.mockRejectedValueOnce(new Error("redis-down"));
    const res = mockRes();
    await adCountGraphFilter({ body: { network: "facebook" } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("src/ad-count-graph-analytics > Redis client construction", () => {
  it("constructs Redis with host/port/username/password from env at module load", () => {
    expect(RedisCtor).toHaveBeenCalledTimes(1);
    const opts = RedisCtor.mock.calls[0][0];
    // env vars may be undefined in test env — assert the shape, not values
    expect(opts).toHaveProperty("host");
    expect(opts).toHaveProperty("port");
    expect(opts).toHaveProperty("username");
    expect(opts).toHaveProperty("password");
  });
});
