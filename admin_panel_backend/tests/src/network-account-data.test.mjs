import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const dbConnPath = require.resolve("../../db-connections/connection");
const queryDatabaseSpy = vi.fn();
require.cache[dbConnPath] = {
  id: dbConnPath, filename: dbConnPath, loaded: true,
  exports: queryDatabaseSpy,
};

// node-cache: provide instance with get/set so the module's `new NodeCache()` returns
// a controllable instance. The SUT instantiates at import time, so override the
// constructor to return a known object.
const cacheGet = vi.fn();
const cacheSet = vi.fn();
const nodeCachePath = require.resolve("node-cache");
require.cache[nodeCachePath] = {
  id: nodeCachePath, filename: nodeCachePath, loaded: true,
  exports: function NodeCache() {
    return { get: cacheGet, set: cacheSet };
  },
};

const { networkAccountDataWithFilter, currentCount } = require("../../src/network-account-data");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

beforeEach(() => {
  queryDatabaseSpy.mockReset();
  cacheGet.mockReset();
  cacheSet.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function commonScenarios(label, fn) {
  describe(label, () => {
    it("400 when network missing or unknown", async () => {
      const res = mockRes();
      await fn({ body: {} }, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ message: "Please provide valid network" });

      const res2 = mockRes();
      await fn({ body: { network: "tiktok" } }, res2);
      expect(res2.status).toHaveBeenCalledWith(400);
    });

    it("returns cached payload when present", async () => {
      cacheGet.mockReturnValueOnce([{ user_id: 1 }]);
      const res = mockRes();
      await fn({ body: { network: "facebook" } }, res);
      expect(res.json).toHaveBeenCalledWith({ code: 200, message: "success", data: [{ user_id: 1 }] });
      expect(queryDatabaseSpy).not.toHaveBeenCalled();
    });

    it("queries DB with date/name/country conditions, caches result", async () => {
      cacheGet.mockReturnValueOnce(undefined);
      queryDatabaseSpy.mockResolvedValueOnce([{ user_id: 2, ad_count: 7 }]);
      const res = mockRes();
      await fn(
        {
          body: {
            network: "facebook",
            fromDate: "2025-01-01 00:00:00",
            toDate: "2025-01-31 23:59:59",
            name: "alice",
            country: "US",
            limit: 5,
            skip: 0,
          },
        },
        res
      );
      const [dbId, index, sql] = queryDatabaseSpy.mock.calls[0];
      expect(dbId).toBe(0);
      expect(sql).toContain("BETWEEN '2025-01-01 00:00:00' AND '2025-01-31 23:59:59'");
      expect(sql).toContain("LIKE '%alice%'");
      expect(sql).toContain("= 'US'");
      expect(sql).toContain("LIMIT 5 OFFSET 0");
      expect(cacheSet).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith({ code: 200, message: "success", data: [{ user_id: 2, ad_count: 7 }] });
    });

    it("defaults dates when fromDate/toDate omitted (uses getTodayDate)", async () => {
      cacheGet.mockReturnValueOnce(undefined);
      queryDatabaseSpy.mockResolvedValueOnce([]);
      const res = mockRes();
      await fn({ body: { network: "instagram" } }, res);
      const sql = queryDatabaseSpy.mock.calls[0][2];
      expect(sql).toContain("BETWEEN '2000-01-01 00:00:00' AND '");
    });

    it("name without country: nameCondition appended with AND/WHERE", async () => {
      cacheGet.mockReturnValueOnce(undefined);
      queryDatabaseSpy.mockResolvedValueOnce([]);
      const res = mockRes();
      await fn({ body: { network: "facebook", name: "bob" } }, res);
      const sql = queryDatabaseSpy.mock.calls[0][2];
      expect(sql).toContain("LIKE '%bob%'");
    });

    it("country only branch: country condition emitted", async () => {
      cacheGet.mockReturnValueOnce(undefined);
      queryDatabaseSpy.mockResolvedValueOnce([]);
      const res = mockRes();
      await fn({ body: { network: "linkedin", country: "DE" } }, res);
      const sql = queryDatabaseSpy.mock.calls[0][2];
      expect(sql).toContain("= 'DE'");
    });

    it("500 on queryDatabase rejection", async () => {
      cacheGet.mockReturnValueOnce(undefined);
      queryDatabaseSpy.mockRejectedValueOnce(new Error("db-down"));
      const res = mockRes();
      await fn({ body: { network: "facebook" } }, res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
}

commonScenarios("src/network-account-data > networkAccountDataWithFilter", networkAccountDataWithFilter);
commonScenarios("src/network-account-data > currentCount", currentCount);
