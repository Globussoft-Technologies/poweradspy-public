import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Stub db-connections/connection (default export is a queryDatabase fn)
const dbConnPath = require.resolve("../../db-connections/connection");
const queryDatabaseSpy = vi.fn();
require.cache[dbConnPath] = {
  id: dbConnPath, filename: dbConnPath, loaded: true,
  exports: queryDatabaseSpy,
};

const { adCountFilter } = require("../../src/ad-count-analytics");

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

describe("src/ad-count-analytics > adCountFilter", () => {
  it("400 when network missing", async () => {
    const res = mockRes();
    await adCountFilter({ body: { platform: "13", range: { from: "2025-01-01", to: "2025-01-31" } } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "Please provide valid network details" });
  });

  it("400 when network not in DB_DATA", async () => {
    const res = mockRes();
    await adCountFilter({ body: { network: "unknown", platform: "13", range: { from: "2025-01-01", to: "2025-01-31" } } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("400 when platform missing", async () => {
    const res = mockRes();
    await adCountFilter({ body: { network: "facebook", range: { from: "2025-01-01", to: "2025-01-31" } } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("400 when range missing", async () => {
    const res = mockRes();
    await adCountFilter({ body: { network: "facebook", platform: "13" } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("happy path: builds SQL with table/createdAt for the network and returns 200 with data", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([{ platform: 13, total_ads: 42 }]);
    const res = mockRes();
    await adCountFilter(
      {
        body: {
          network: "facebook",
          platform: "13",
          range: { from: "2025-01-01", to: "2025-01-31" },
        },
      },
      res
    );
    expect(queryDatabaseSpy).toHaveBeenCalledTimes(1);
    const [dbId, index, query] = queryDatabaseSpy.mock.calls[0];
    expect(dbId).toBe(0); // facebook
    expect(query).toMatch(/FROM facebook_ad/);
    expect(query).toMatch(/WHERE created_date BETWEEN/);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      code: 200,
      message: "success",
      data: [{ platform: 13, total_ads: 42 }],
    });
  });

  it("works for the youtube network (different tableName / createdAt)", async () => {
    queryDatabaseSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await adCountFilter(
      {
        body: {
          network: "youtube",
          platform: "5",
          range: { from: "2025-01-01", to: "2025-01-31" },
        },
      },
      res
    );
    const query = queryDatabaseSpy.mock.calls[0][2];
    expect(query).toMatch(/FROM youtube_ad_meta_data/);
    expect(query).toMatch(/WHERE created_date BETWEEN/);
  });

  it("500 via outer catch when queryDatabase rejects", async () => {
    queryDatabaseSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await adCountFilter(
      {
        body: {
          network: "facebook",
          platform: "13",
          range: { from: "2025-01-01", to: "2025-01-31" },
        },
      },
      res
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal Server Error" });
    expect(consoleErrSpy).toHaveBeenCalled();
  });
});
