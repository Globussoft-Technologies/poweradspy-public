import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const dbMgrPath = require.resolve("../../../../src/database/DatabaseManager");
const dbManager = { getSQL: vi.fn() };
require.cache[dbMgrPath] = {
  id: dbMgrPath, filename: dbMgrPath, loaded: true, exports: dbManager,
};

const loggerPath = require.resolve("../../../../src/logger");
const childLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { createChild: vi.fn(() => childLog) },
};

const configPath = require.resolve("../../../../src/config");
// Use a stable object the SUT can bind to once; mutate its inner fields per test.
const configExports = { dailyKeyword: { realTimeStore: "on", newPlanUser: ["69", "70"] } };
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true, exports: configExports,
};

const { dailyKeywordRequest, getPriorityRequests } = require(
  "../../../../src/services/common/controllers/dailyKeywordRequestController"
);

function mkRes() {
  const r = { statusCode: 200, body: null };
  r.status = vi.fn((c) => { r.statusCode = c; return r; });
  r.json = vi.fn((b) => { r.body = b; return r; });
  return r;
}

beforeEach(() => {
  dbManager.getSQL.mockReset();
  childLog.error.mockClear();
  configExports.dailyKeyword.realTimeStore = "on";
  configExports.dailyKeyword.newPlanUser = ["69", "70"];
});

describe("dailyKeywordRequestController > dailyKeywordRequest", () => {
  function baseReq(overrides = {}) {
    return {
      body: { keyword: "shoes", email: "a@b.com", user_id: "u1", user_name: "U", ads_count: 0, ...overrides },
      user: { userSubscriptionType: 69 },
    };
  }

  it("returns skip when realTimeStore=off", async () => {
    configExports.dailyKeyword.realTimeStore = "off";
    const res = mkRes();
    await dailyKeywordRequest(baseReq(), res);
    expect(res.body.data.status).toBe("skip");
    expect(res.body.message).toBe("store disabled");
  });

  it("returns skip when ads_count >= threshold", async () => {
    configExports.dailyKeyword.realTimeStore = "100";
    const res = mkRes();
    await dailyKeywordRequest(baseReq({ ads_count: 200 }), res);
    expect(res.body.message).toBe("ads count sufficient");
  });

  it("proceeds when ads_count < threshold", async () => {
    configExports.dailyKeyword.realTimeStore = "100";
    const sql = { query: vi.fn(async () => []) };
    dbManager.getSQL.mockReturnValue(sql);
    const res = mkRes();
    await dailyKeywordRequest(baseReq({ ads_count: 5 }), res);
    expect(res.body.message).toBe("keyword request saved");
  });

  it("returns skip when plan not eligible", async () => {
    configExports.dailyKeyword.newPlanUser = ["999"];
    const res = mkRes();
    await dailyKeywordRequest(baseReq(), res);
    expect(res.body.message).toBe("plan not eligible");
  });

  it("uses advertiser when keyword missing", async () => {
    const sql = { query: vi.fn(async () => []) };
    dbManager.getSQL.mockReturnValue(sql);
    const res = mkRes();
    await dailyKeywordRequest({
      body: { keyword: "", advertiser: "Nike", email: "a@b.com", user_id: "u" },
      user: { userSubscriptionType: 69 },
    }, res);
    expect(res.body.message).toBe("keyword request saved");
    expect(sql.query.mock.calls[0][1][2]).toBe("Nike"); // existing query uses searchTerm
  });

  it("uses domain when keyword + advertiser missing", async () => {
    const sql = { query: vi.fn(async () => []) };
    dbManager.getSQL.mockReturnValue(sql);
    const res = mkRes();
    await dailyKeywordRequest({
      body: { domain: "nike.com", email: "a@b.com", user_id: "u" },
      user: { userSubscriptionType: 69 },
    }, res);
    expect(res.body.message).toBe("keyword request saved");
  });

  it("returns 'no search term' when all empty/NA", async () => {
    const res = mkRes();
    await dailyKeywordRequest({
      body: { keyword: "NA", advertiser: "NA", domain: "NA", email: "a@b.com" },
      user: { userSubscriptionType: 69 },
    }, res);
    expect(res.body.message).toBe("no search term");
  });

  it("503 when no LinkedIn SQL", async () => {
    dbManager.getSQL.mockReturnValue(null);
    const res = mkRes();
    await dailyKeywordRequest(baseReq(), res);
    expect(res.statusCode).toBe(503);
  });

  it("returns existing when keyword already in DB", async () => {
    const sql = { query: vi.fn(async () => [{ id: 1 }]) };
    dbManager.getSQL.mockReturnValue(sql);
    const res = mkRes();
    await dailyKeywordRequest(baseReq(), res);
    expect(res.body.data.status).toBe("existing");
  });

  it("inserts country JSON when country present (non-NA)", async () => {
    const sql = { query: vi.fn(async () => []) };
    dbManager.getSQL.mockReturnValue(sql);
    const res = mkRes();
    await dailyKeywordRequest(baseReq({ country: ["US", "IN"] }), res);
    const insertParams = sql.query.mock.calls[1][1];
    expect(insertParams.at(-1)).toBe(JSON.stringify(["US", "IN"]));
  });

  it("country=NA → reqCountry null", async () => {
    const sql = { query: vi.fn(async () => []) };
    dbManager.getSQL.mockReturnValue(sql);
    const res = mkRes();
    await dailyKeywordRequest(baseReq({ country: "NA" }), res);
    const insertParams = sql.query.mock.calls[1][1];
    expect(insertParams.at(-1)).toBeNull();
  });

  it("uses req.user.name when present, otherwise body.user_name", async () => {
    const sql = { query: vi.fn(async () => []) };
    dbManager.getSQL.mockReturnValue(sql);
    const res = mkRes();
    await dailyKeywordRequest({
      body: { keyword: "k", email: "e", user_name: "BodyName" },
      user: { userSubscriptionType: 69, name: "UserName" },
    }, res);
    expect(sql.query.mock.calls[1][1][1]).toBe("UserName");
  });

  it("user_name defaults to empty string when missing both", async () => {
    const sql = { query: vi.fn(async () => []) };
    dbManager.getSQL.mockReturnValue(sql);
    const res = mkRes();
    await dailyKeywordRequest({
      body: { keyword: "k", email: "e" },
      user: { userSubscriptionType: 69 },
    }, res);
    expect(sql.query.mock.calls[1][1][1]).toBe("");
  });

  it("user_id falls back to body when req.user.id missing", async () => {
    const sql = { query: vi.fn(async () => []) };
    dbManager.getSQL.mockReturnValue(sql);
    const res = mkRes();
    await dailyKeywordRequest({
      body: { keyword: "k", email: "e", user_id: "bodyUser" },
      user: { userSubscriptionType: 69 },
    }, res);
    expect(sql.query.mock.calls[1][1][0]).toBe("bodyUser");
  });

  it("realTimeStore as whitespace 'On' → still on", async () => {
    configExports.dailyKeyword.realTimeStore = "  ON ";
    const sql = { query: vi.fn(async () => []) };
    dbManager.getSQL.mockReturnValue(sql);
    const res = mkRes();
    await dailyKeywordRequest(baseReq(), res);
    expect(res.body.message).toBe("keyword request saved");
  });

  it("500 on SQL throw", async () => {
    dbManager.getSQL.mockReturnValue({ query: vi.fn(async () => { throw new Error("db-down"); }) });
    const res = mkRes();
    await dailyKeywordRequest(baseReq(), res);
    expect(res.statusCode).toBe(500);
    expect(childLog.error).toHaveBeenCalled();
  });

  it("no req.user → userSubscriptionType becomes empty string → plan not eligible", async () => {
    const res = mkRes();
    await dailyKeywordRequest({ body: { keyword: "k" } }, res);
    expect(res.body.message).toBe("plan not eligible");
  });
});

describe("dailyKeywordRequestController > getPriorityRequests", () => {
  it("503 when no SQL", async () => {
    dbManager.getSQL.mockReturnValue(null);
    const res = mkRes();
    await getPriorityRequests({ params: { platform: "facebook", limit: "10" } }, res);
    expect(res.statusCode).toBe(503);
  });

  it("404 when no rows found", async () => {
    dbManager.getSQL.mockReturnValue({ query: vi.fn(async () => []) });
    const res = mkRes();
    await getPriorityRequests({ params: { platform: "facebook", limit: "10" } }, res);
    expect(res.body.code).toBe(404);
  });

  it("200 happy path → updates rows and returns data", async () => {
    let call = 0;
    const sql = { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ id: 1 }, { id: 2 }];
      return { affectedRows: 2 };
    })};
    dbManager.getSQL.mockReturnValue(sql);
    const res = mkRes();
    await getPriorityRequests({ params: { platform: "facebook", limit: "5" } }, res);
    expect(res.body.code).toBe(200);
    expect(res.body.data).toHaveLength(2);
  });

  it("400 when update affects 0 rows", async () => {
    let call = 0;
    const sql = { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ id: 1 }];
      return { affectedRows: 0 };
    })};
    dbManager.getSQL.mockReturnValue(sql);
    const res = mkRes();
    await getPriorityRequests({ params: { platform: "facebook", limit: "5" } }, res);
    expect(res.body.code).toBe(400);
  });

  it("default limit=10 when invalid", async () => {
    const sql = { query: vi.fn(async () => []) };
    dbManager.getSQL.mockReturnValue(sql);
    await getPriorityRequests({ params: { platform: "facebook", limit: "garbage" } }, mkRes());
    expect(sql.query.mock.calls[0][0]).toContain("LIMIT 10");
  });

  it("500 on SQL throw", async () => {
    dbManager.getSQL.mockReturnValue({ query: vi.fn(async () => { throw new Error("e"); }) });
    const res = mkRes();
    await getPriorityRequests({ params: { platform: "facebook", limit: "5" } }, res);
    expect(res.statusCode).toBe(500);
  });
});

describe("dailyKeywordRequestController > config + ads_count fallbacks", () => {
  it("realTimeStore undefined → falls back to 'on' (line 16 right operand)", async () => {
    configExports.dailyKeyword.realTimeStore = undefined;
    const res = mkRes();
    // realTimeStore === 'on' branch is taken, so the function proceeds
    // past the off-gate and threshold checks into the SQL flow.
    dbManager.getSQL.mockReturnValue({ query: vi.fn(async () => ({ insertId: 1 })) });
    await dailyKeywordRequest({
      body: { keyword: "x", email: "a@b", user_id: "u1", user_name: "U", ads_count: 0 },
      user: { userSubscriptionType: 69 },
    }, res);
    // 'on' default reached → SQL was invoked
    expect(dbManager.getSQL).toHaveBeenCalled();
  });

  it("ads_count null → Number(null ?? 0) → 0 (line 22 ?? right operand)", async () => {
    configExports.dailyKeyword.realTimeStore = "100";
    const res = mkRes();
    await dailyKeywordRequest({
      body: { keyword: "x", email: "a@b", user_id: "u1", user_name: "U", ads_count: null },
      user: { userSubscriptionType: 69 },
    }, res);
    // ads_count null → ?? falls to 0 → count=0 < threshold=100 → does NOT skip
    expect(res.body.message).not.toBe("ads count sufficient");
  });
});
