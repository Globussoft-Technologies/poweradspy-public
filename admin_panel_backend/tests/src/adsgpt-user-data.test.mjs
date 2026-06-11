import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Replace require.cache for all collaborators BEFORE SUT load.
const mongoPath = require.resolve("../../mongo-db/connection");
const getCollection = vi.fn();
require.cache[mongoPath] = { id: mongoPath, filename: mongoPath, loaded: true, exports: { getCollection } };

const axiosPath = require.resolve("axios");
const axios = { get: vi.fn() };
require.cache[axiosPath] = { id: axiosPath, filename: axiosPath, loaded: true, exports: axios };

const respPath = require.resolve("../../utils/responseUtils");
const successResponse = vi.fn((res, data, message, status = 200) => res.status(status).json({ success: true, message, data }));
const errorResponse = vi.fn((res, message, status = 500) => res.status(status).json({ success: false, message }));
require.cache[respPath] = { id: respPath, filename: respPath, loaded: true, exports: { successResponse, errorResponse } };

const cachePath = require.resolve("../../utils/cache");
const cache = { get: vi.fn(), set: vi.fn() };
require.cache[cachePath] = { id: cachePath, filename: cachePath, loaded: true, exports: cache };

process.env.AMEMBER_BASE_API_URL = "http://amember.local";
process.env.AMEMBER_API_KEY = "k-123";

const {
  getUserIds,
  getUserInteractionData,
  getUsersStats,
  getUserUsageCost,
} = require("../../src/adsgpt-user-data");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

beforeEach(() => {
  getCollection.mockReset();
  axios.get.mockReset();
  cache.get.mockReset();
  cache.set.mockReset();
  successResponse.mockClear();
  errorResponse.mockClear();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("src/adsgpt-user-data > getUserIds", () => {
  it("serves cached data when present", async () => {
    cache.get.mockReturnValueOnce([{ user_id: "u1" }]);
    const res = mockRes();
    await getUserIds({}, res);
    expect(successResponse).toHaveBeenCalledWith(res, [{ user_id: "u1" }], "User list fetched (from cache)");
    expect(getCollection).not.toHaveBeenCalled();
  });

  it("fetches from mongo and caches when miss", async () => {
    cache.get.mockReturnValueOnce(undefined);
    const find = vi.fn().mockReturnValue({ toArray: vi.fn().mockResolvedValueOnce([{ user_id: "u2" }]) });
    getCollection.mockReturnValueOnce({ find });
    const res = mockRes();
    await getUserIds({}, res);
    expect(find).toHaveBeenCalledWith({}, expect.objectContaining({ projection: expect.any(Object) }));
    expect(cache.set).toHaveBeenCalledWith("user_ids", [{ user_id: "u2" }]);
    expect(successResponse).toHaveBeenCalledWith(res, [{ user_id: "u2" }], "User list fetched");
  });

  it("errorResponse on throw", async () => {
    cache.get.mockImplementationOnce(() => { throw new Error("boom"); });
    const res = mockRes();
    await getUserIds({}, res);
    expect(errorResponse).toHaveBeenCalledWith(res, "Failed to fetch users");
  });
});

describe("src/adsgpt-user-data > getUserInteractionData", () => {
  it("serves cached user data", async () => {
    cache.get.mockReturnValueOnce({ user_id: "u1" });
    const res = mockRes();
    await getUserInteractionData({ params: { userid: "u1" } }, res);
    expect(successResponse).toHaveBeenCalledWith(res, { user_id: "u1" }, "User data fetched (from cache)");
  });

  it("404 when user not found", async () => {
    cache.get.mockReturnValueOnce(undefined);
    getCollection.mockReturnValueOnce({ findOne: vi.fn().mockResolvedValueOnce(null) });
    const res = mockRes();
    await getUserInteractionData({ params: { userid: "u-missing" } }, res);
    expect(errorResponse).toHaveBeenCalledWith(res, "User not found", 404);
  });

  it("caches and returns fresh user", async () => {
    cache.get.mockReturnValueOnce(undefined);
    const findOne = vi.fn().mockResolvedValueOnce({ user_id: "u1" });
    getCollection.mockReturnValueOnce({ findOne });
    const res = mockRes();
    await getUserInteractionData({ params: { userid: "u1" } }, res);
    expect(findOne).toHaveBeenCalledWith({ user_id: "u1" });
    expect(cache.set).toHaveBeenCalledWith("user_u1", { user_id: "u1" });
    expect(successResponse).toHaveBeenCalledWith(res, { user_id: "u1" }, "User data fetched");
  });

  it("errorResponse 'Invalid user ID' on throw", async () => {
    cache.get.mockImplementationOnce(() => { throw new Error("bad"); });
    const res = mockRes();
    await getUserInteractionData({ params: { userid: "u1" } }, res);
    expect(errorResponse).toHaveBeenCalledWith(res, "Invalid user ID");
  });
});

describe("src/adsgpt-user-data > getUsersStats", () => {
  it("aggregates active/expired/total from amember", async () => {
    axios.get
      .mockResolvedValueOnce({ data: { _total: 10 } })
      .mockResolvedValueOnce({ data: { _total: 5 } })
      .mockResolvedValueOnce({ data: { _total: 15 } });
    const res = mockRes();
    await getUsersStats({}, res);
    expect(successResponse).toHaveBeenCalledWith(
      res,
      { activeUsers: 10, expiredUsers: 5, totalUsers: 15 },
      "User stats fetched"
    );
  });

  it("defaults _total to 0 when missing", async () => {
    axios.get
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({ data: {} })
      .mockResolvedValueOnce({ data: {} });
    const res = mockRes();
    await getUsersStats({}, res);
    expect(successResponse).toHaveBeenCalledWith(
      res,
      { activeUsers: 0, expiredUsers: 0, totalUsers: 0 },
      "User stats fetched"
    );
  });

  it("errorResponse 404 on axios failure", async () => {
    axios.get.mockRejectedValueOnce(new Error("amember-down"));
    const res = mockRes();
    await getUsersStats({}, res);
    expect(errorResponse).toHaveBeenCalledWith(res, "Error in amember api", 404);
  });
});

describe("src/adsgpt-user-data > getUserUsageCost", () => {
  function makeReq(overrides = {}) {
    return {
      params: { userid: "u1" },
      query: {},
      ...overrides,
    };
  }

  it("'No usage found' when user has no usages", async () => {
    getCollection.mockReturnValueOnce({ findOne: vi.fn().mockResolvedValueOnce(null) });
    const res = mockRes();
    await getUserUsageCost(makeReq(), res);
    expect(successResponse).toHaveBeenCalledWith(
      res,
      expect.objectContaining({ userId: "u1", total_input_tokens: 0, data: [] }),
      "No usage found"
    );
  });

  it("'No usage found' when usages array empty", async () => {
    getCollection.mockReturnValueOnce({ findOne: vi.fn().mockResolvedValueOnce({ usages: [] }) });
    const res = mockRes();
    await getUserUsageCost(makeReq(), res);
    expect(successResponse).toHaveBeenCalledWith(
      res,
      expect.objectContaining({ total_cost_usd: 0 }),
      "No usage found"
    );
  });

  it("no-group: sums tokens and computes cost via MODEL_PRICING (token and per_image)", async () => {
    getCollection.mockReturnValueOnce({
      findOne: vi.fn().mockResolvedValueOnce({
        usages: [
          { model: "gpt-image-1.5", input_tokens: 1_000_000, output_tokens: 1_000_000, createdAt: "2025-01-15" },
          { model: "imagen-4.0-generate-001", createdAt: "2025-01-15" }, // per_image, defaults
          { model: "unknown-model", input_tokens: 100, createdAt: "2025-01-15" }, // pricing warn
        ],
      }),
    });
    const res = mockRes();
    await getUserUsageCost(makeReq(), res);
    const payload = successResponse.mock.calls[0][1];
    // gpt: 1m*8/1m + 1m*32/1m = 40, plus imagen per_image 0.04 = 40.04
    expect(payload.total_cost_usd).toBeCloseTo(40.04, 2);
    expect(payload.total_input_tokens).toBe(1_000_100);
    expect(payload.total_output_tokens).toBe(1_000_000);
  });

  it("date range filter (from/to) excludes outside-range usages", async () => {
    getCollection.mockReturnValueOnce({
      findOne: vi.fn().mockResolvedValueOnce({
        usages: [
          { model: "gpt-image-1.5", input_tokens: 1_000_000, output_tokens: 0, createdAt: "2025-01-15" },
          { model: "gpt-image-1.5", input_tokens: 1_000_000, output_tokens: 0, createdAt: "2025-03-15" },
        ],
      }),
    });
    const res = mockRes();
    await getUserUsageCost(
      makeReq({ query: { from: "2025-02-01", to: "2025-04-01" } }),
      res
    );
    const payload = successResponse.mock.calls[0][1];
    expect(payload.total_input_tokens).toBe(1_000_000);
  });

  it("from-only / to-only branches both apply", async () => {
    getCollection.mockReturnValueOnce({
      findOne: vi.fn().mockResolvedValueOnce({
        usages: [
          { model: "gpt-image-1.5", input_tokens: 0, output_tokens: 0, createdAt: "2025-01-15" },
        ],
      }),
    });
    const res = mockRes();
    await getUserUsageCost(makeReq({ query: { from: "2025-01-01" } }), res);

    getCollection.mockReturnValueOnce({
      findOne: vi.fn().mockResolvedValueOnce({
        usages: [
          { model: "gpt-image-1.5", input_tokens: 0, output_tokens: 0, createdAt: "2025-01-15" },
        ],
      }),
    });
    const res2 = mockRes();
    await getUserUsageCost(makeReq({ query: { to: "2025-12-31" } }), res2);
    expect(successResponse).toHaveBeenCalledTimes(2);
  });

  it("groupBy=day produces daily buckets with cost", async () => {
    getCollection.mockReturnValueOnce({
      findOne: vi.fn().mockResolvedValueOnce({
        usages: [
          { model: "gpt-image-1.5", input_tokens: 1_000_000, output_tokens: 0, createdAt: "2025-01-15T12:00:00Z" },
          { model: "gpt-image-1.5", input_tokens: 1_000_000, output_tokens: 0, createdAt: "2025-01-15T15:00:00Z" },
        ],
      }),
    });
    const res = mockRes();
    await getUserUsageCost(makeReq({ query: { groupBy: "day" } }), res);
    const payload = successResponse.mock.calls[0][1];
    expect(payload.groupBy).toBe("day");
    expect(payload.data).toHaveLength(1);
    expect(payload.data[0].input_tokens).toBe(2_000_000);
  });

  it("groupBy=month buckets per year-month and exercises per_image + unknown-model branches", async () => {
    getCollection.mockReturnValueOnce({
      findOne: vi.fn().mockResolvedValueOnce({
        usages: [
          { model: "imagen-4.0-generate-001", createdAt: "2025-01-15T12:00:00Z" },
          { model: "imagen-4.0-generate-001", createdAt: "2025-02-15T12:00:00Z" },
          { model: "unknown-x", input_tokens: 50, createdAt: "2025-02-15T12:00:00Z" },
        ],
      }),
    });
    const res = mockRes();
    await getUserUsageCost(makeReq({ query: { groupBy: "month" } }), res);
    const payload = successResponse.mock.calls[0][1];
    expect(payload.data).toHaveLength(2);
    expect(payload.data.map((d) => d.date).sort()).toEqual(["2025-01", "2025-02"]);
  });

  it("errorResponse on unhandled aggregation throw", async () => {
    getCollection.mockImplementationOnce(() => { throw new Error("mongo-down"); });
    const res = mockRes();
    await getUserUsageCost(makeReq(), res);
    expect(errorResponse).toHaveBeenCalledWith(res, "Failed to fetch usage cost");
  });
});
