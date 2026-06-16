import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Mock logger (silence)
const loggerPath = require.resolve("../../utils/logger");
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
};

// Mock mongoose: connection.db + Types.ObjectId
const mongoosePath = require.resolve("mongoose");
let col;
const dbObj = { collection: vi.fn(() => col) };
const ObjectId = vi.fn(function (id) {
  if (id === "BAD") throw new Error("invalid ObjectId");
  this.id = id;
});
const mongooseMock = { connection: { db: dbObj }, Types: { ObjectId } };
require.cache[mongoosePath] = {
  id: mongoosePath, filename: mongoosePath, loaded: true, exports: mongooseMock,
};

const router = require("../../routes/competitor-email-details");

function getHandler(method, path) {
  const layer = router.stack.find((l) => l.route && l.route.path === path && l.route.methods[method]);
  return layer.route.stack[0].handle;
}
const getDetails = getHandler("get", "/get-email-details");
const updateStatus = getHandler("put", "/update-email-status/:requestId");

function aggQueue(...results) {
  const fn = vi.fn();
  results.forEach((r) => fn.mockReturnValueOnce({ toArray: () => Promise.resolve(r) }));
  fn.mockReturnValue({ toArray: () => Promise.resolve([]) });
  return fn;
}
function mockReq(query = {}, params = {}, body = {}) { return { query, params, body }; }
function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

beforeEach(() => {
  dbObj.collection.mockClear();
  ObjectId.mockClear();
});

describe("routes/competitor-email-details > registration", () => {
  it("exports an Express router with both routes", () => {
    expect(typeof router).toBe("function");
    expect(router.stack.filter((l) => l.route)).toHaveLength(2);
  });
});

describe("GET /get-email-details", () => {
  it("full filters + text search + sort=username asc + networks mapping", async () => {
    const mainRows = [
      { user_id: 1, networks: [{ facebook_status: 1, instagram_status: 1, youtube_status: 1 }], email_status: 1 },
      { user_id: 2, networks: [], email_status: 0 },
      { user_id: 3 }, // no networks array
    ];
    const statsRows = [{ email_status: 1 }, { email_status: 0 }, { email_status: 1 }];
    col = { aggregate: aggQueue(mainRows, statsRows), updateOne: vi.fn() };
    const req = mockReq({
      page: "1", limit: "2", sort: "username", order: "asc",
      search: "acme", emailStatus: "1",
      startDate: "2025-01-01", endDate: "2025-01-31",
      startUpdatedDate: "2025-01-05", endUpdatedDate: "2025-01-20",
    });
    const res = mockRes();
    await getDetails(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const b = res.json.mock.calls[0][0].body.data;
    expect(b.data[0].networks).toEqual(["facebook", "instagram", "youtube"]);
    expect(b.totalCount).toBe(3);
    expect(b.totalEmailsSent).toBe(2);
    expect(b.totalEmailsPending).toBe(1);
    // first aggregate call pushes a $match (emailStatus + dates present)
    const pipeline = col.aggregate.mock.calls[0][0];
    expect(pipeline[0].$match.email_status).toBe(1);
  });

  it("sort=userid + order desc", async () => {
    col = { aggregate: aggQueue([], []), updateOne: vi.fn() };
    const res = mockRes();
    await getDetails(mockReq({ sort: "userid", order: "desc" }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("sort=date branch", async () => {
    col = { aggregate: aggQueue([], []), updateOne: vi.fn() };
    const res = mockRes();
    await getDetails(mockReq({ sort: "date" }), res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("unknown sort → default createdAtOriginal, no filters (matchStage empty → no $match)", async () => {
    col = { aggregate: aggQueue([], []), updateOne: vi.fn() };
    const res = mockRes();
    await getDetails(mockReq({ sort: "whatever" }), res);
    const pipeline = col.aggregate.mock.calls[0][0];
    // No $match as first stage (it's a $lookup) since no filters supplied
    expect(pipeline[0].$lookup).toBeDefined();
  });

  it("date-format search (DD-MM-YYYY) takes the date-regex branch", async () => {
    col = { aggregate: aggQueue([], []), updateOne: vi.fn() };
    const res = mockRes();
    await getDetails(mockReq({ search: "15-01-2025" }), res);
    // The search $match (last-ish stage) targets createdAt for date searches
    const pipeline = col.aggregate.mock.calls[0][0];
    const searchStage = pipeline.find((s) => s.$match && s.$match.createdAt && s.$match.createdAt.$regex);
    expect(searchStage).toBeDefined();
  });

  it("only updatedDate range (no createdAt range)", async () => {
    col = { aggregate: aggQueue([], []), updateOne: vi.fn() };
    const res = mockRes();
    await getDetails(mockReq({ startUpdatedDate: "2025-01-01" }), res);
    const pipeline = col.aggregate.mock.calls[0][0];
    expect(pipeline[0].$match.updatedAt).toBeDefined();
  });

  it("createdAt range with startDate only (endDate-absent branch)", async () => {
    col = { aggregate: aggQueue([], []), updateOne: vi.fn() };
    const res = mockRes();
    await getDetails(mockReq({ startDate: "2025-01-01" }), res);
    const m = col.aggregate.mock.calls[0][0][0].$match.createdAt;
    expect(m.$gte).toBeInstanceOf(Date);
    expect(m.$lte).toBeUndefined();
  });

  it("createdAt range with endDate only (startDate-absent branch)", async () => {
    col = { aggregate: aggQueue([], []), updateOne: vi.fn() };
    const res = mockRes();
    await getDetails(mockReq({ endDate: "2025-01-31" }), res);
    const m = col.aggregate.mock.calls[0][0][0].$match.createdAt;
    expect(m.$lte).toBeInstanceOf(Date);
    expect(m.$gte).toBeUndefined();
  });

  it("updatedAt range with endUpdatedDate only (startUpdated-absent branch)", async () => {
    col = { aggregate: aggQueue([], []), updateOne: vi.fn() };
    const res = mockRes();
    await getDetails(mockReq({ endUpdatedDate: "2025-01-31" }), res);
    const m = col.aggregate.mock.calls[0][0][0].$match.updatedAt;
    expect(m.$lte).toBeInstanceOf(Date);
    expect(m.$gte).toBeUndefined();
  });

  it("networks mapping: brand statuses not 1 → none pushed (status-false branches)", async () => {
    const mainRows = [
      { user_id: 1, networks: [{ facebook_status: 0, instagram_status: 0, youtube_status: 0 }] },
    ];
    col = { aggregate: aggQueue(mainRows, []), updateOne: vi.fn() };
    const res = mockRes();
    await getDetails(mockReq({}), res);
    expect(res.json.mock.calls[0][0].body.data.data[0].networks).toEqual([]);
  });

  it("error → 500", async () => {
    col = { aggregate: vi.fn(() => ({ toArray: () => Promise.reject(new Error("agg fail")) })), updateOne: vi.fn() };
    const res = mockRes();
    await getDetails(mockReq({}), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json.mock.calls[0][0].error).toBe("agg fail");
  });
});

describe("PUT /update-email-status/:requestId", () => {
  it("matchedCount > 0 → 200", async () => {
    col = { aggregate: aggQueue(), updateOne: vi.fn(() => Promise.resolve({ matchedCount: 1, modifiedCount: 1 })) };
    const res = mockRes();
    await updateStatus(mockReq({}, { requestId: "abc123" }, { email_status: 1 }), res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(ObjectId).toHaveBeenCalledWith("abc123");
  });

  it("matchedCount === 0 → 404", async () => {
    col = { aggregate: aggQueue(), updateOne: vi.fn(() => Promise.resolve({ matchedCount: 0 })) };
    const res = mockRes();
    await updateStatus(mockReq({}, { requestId: "nope" }, { email_status: 0 }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("invalid ObjectId → 500", async () => {
    col = { aggregate: aggQueue(), updateOne: vi.fn() };
    const res = mockRes();
    await updateStatus(mockReq({}, { requestId: "BAD" }, { email_status: 1 }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
