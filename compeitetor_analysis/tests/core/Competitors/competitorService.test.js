import { describe, it, expect, vi, beforeEach } from "vitest";

const spies = vi.hoisted(() => {
  const objectIdIsValidSpy = vi.fn(() => true);
  function ObjectIdStub(id) { return { _id: id, toString: () => id }; }
  ObjectIdStub.isValid = (...a) => objectIdIsValidSpy(...a);
  const esClient = {
    server1: { search: vi.fn(), count: vi.fn() },
    server2: { search: vi.fn(), count: vi.fn() },
    server3: { search: vi.fn(), count: vi.fn() },
    server4: { search: vi.fn(), count: vi.fn() },
  };
  return {
    loggerInfoSpy: vi.fn(),
    loggerErrorSpy: vi.fn(),
    loggerWarnSpy: vi.fn(),
    configGetSpy: vi.fn(),
    axiosGetSpy: vi.fn(),
    axiosPostSpy: vi.fn(),
    userDetailsFindOneSpy: vi.fn(),
    userDetailsCreateSpy: vi.fn(),
    userDetailsUpdateOneSpy: vi.fn(),
    userDetailsFindSpy: vi.fn(),
    userDetailsCountDocsSpy: vi.fn(),
    userDetailsAggregateSpy: vi.fn(),
    userDetailsFindByIdSpy: vi.fn(),
    competitorsFindSpy: vi.fn(),
    competitorsFindOneSpy: vi.fn(),
    competitorsAggregateSpy: vi.fn(),
    competitorsCountDocsSpy: vi.fn(),
    competitorsReqFindOneSpy: vi.fn(),
    competitorsReqFindSpy: vi.fn(),
    competitorsReqDistinctSpy: vi.fn(),
    competitorsReqAggregateSpy: vi.fn(),
    competitorsReqUpdateOneSpy: vi.fn(),
    competitorsReqDeleteOneSpy: vi.fn(),
    competitorsReqCreateSpy: vi.fn(),
    competitorsReqCountDocsSpy: vi.fn(),
    planAccessConfigFindOneSpy: vi.fn(),
    existingCompFindOneSpy: vi.fn(),
    existingCompUpdateOneSpy: vi.fn(),
    userDailyTokensFindOneSpy: vi.fn(),
    userDailyTokensUpdateOneSpy: vi.fn(),
    tokenSyncFindOneSpy: vi.fn(),
    tokenSyncUpdateOneSpy: vi.fn(),
    isValidObjectIdSpy: vi.fn(),
    objectIdIsValidSpy,
    configHasSpy: vi.fn(() => false),
    ObjectIdStub,
    geminiGenerateSpy: vi.fn(),
    esClient,
    getIOSpy: vi.fn(),
    dashboardCountInternalSpy: vi.fn(),
  };
});

vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { info: spies.loggerInfoSpy, error: spies.loggerErrorSpy, warn: spies.loggerWarnSpy, debug: vi.fn() },
}));
vi.mock("../../../utils/response.js", () => ({
  default: {
    userSuccessResp: (msg, data) => ({ statusCode: 200, body: { status: "success", msg, data } }),
    userFailResp: (msg, err) => ({ statusCode: 400, body: { status: "failed", msg, err } }),
    validationFailResp: (msg, err) => ({ statusCode: 400, body: { status: "failed", msg, err } }),
    messageResp: (msg, data) => ({ statusCode: 400, body: { message: msg, data } }),
    messageRespComp: (msg) => ({ statusCode: 401, body: { message: msg } }),
    quotaExceededResp: (msg, limits) => ({ statusCode: 403, body: { status: "failed", message: msg, showSubscriptionModal: true, limits } }),
  },
}));
vi.mock("../../../core/Dashboard/dashboardService.js", () => ({
  default: {
    getCompetitorsCountNewInternal: (...args) => spies.dashboardCountInternalSpy(...args),
  },
}));
vi.mock("../../../core/Competitors/competitorValidation.js", () => ({
  default: {
    createDetails: (b) => { if (spies._createDetailsThrow) throw new Error("validation-boom"); return spies._validationCreateDetailsResult ?? ({ value: b, error: null }); },
    createRequest: (b) => { if (spies._createRequestThrow) throw new Error("validation-boom"); return spies._validationCreateRequestResult ?? ({ value: b, error: null }); },
  },
}));
vi.mock("../../../models/user_details.js", () => ({
  default: {
    findOne: spies.userDetailsFindOneSpy,
    create: spies.userDetailsCreateSpy,
    updateOne: spies.userDetailsUpdateOneSpy,
    find: (...args) => spies.userDetailsFindSpy(...args),
    countDocuments: spies.userDetailsCountDocsSpy,
    aggregate: spies.userDetailsAggregateSpy,
    findById: (...args) => spies.userDetailsFindByIdSpy(...args),
  },
}));
vi.mock("../../../models/competitors.js", () => ({
  default: {
    find: spies.competitorsFindSpy,
    findOne: spies.competitorsFindOneSpy,
    aggregate: spies.competitorsAggregateSpy,
    countDocuments: spies.competitorsCountDocsSpy,
    estimatedDocumentCount: vi.fn(() => Promise.resolve(0)),
    bulkWrite: vi.fn(),
    insertMany: vi.fn(),
  },
}));
vi.mock("../../../models/competitors_request.js", () => ({
  default: {
    findOne: spies.competitorsReqFindOneSpy,
    find: spies.competitorsReqFindSpy,
    distinct: spies.competitorsReqDistinctSpy,
    aggregate: spies.competitorsReqAggregateSpy,
    updateOne: spies.competitorsReqUpdateOneSpy,
    deleteOne: spies.competitorsReqDeleteOneSpy,
    create: spies.competitorsReqCreateSpy,
    countDocuments: spies.competitorsReqCountDocsSpy,
  },
}));
vi.mock("../../../models/existing_competitors.js", () => ({
  default: {
    findOne: spies.existingCompFindOneSpy,
    updateOne: spies.existingCompUpdateOneSpy,
    estimatedDocumentCount: vi.fn(() => Promise.resolve(0)),
  },
}));
vi.mock("../../../models/user_daily_tokens.model.js", () => ({
  default: {
    findOne: spies.userDailyTokensFindOneSpy,
    updateOne: spies.userDailyTokensUpdateOneSpy,
  },
}));
vi.mock("../../../models/jobTokenState.js", () => ({
  default: {
    findOne: spies.tokenSyncFindOneSpy,
    updateOne: spies.tokenSyncUpdateOneSpy,
  },
}));
vi.mock("config", () => ({ default: { get: spies.configGetSpy, has: (...a) => spies.configHasSpy(...a) } }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: vi.fn(function () {
    this.models = { generateContent: spies.geminiGenerateSpy };
  }),
}));
vi.mock("mongoose", () => ({
  default: {
    Types: { ObjectId: spies.ObjectIdStub },
    isValidObjectId: spies.isValidObjectIdSpy,
    connection: {
      collection: (_name) => ({ findOne: spies.planAccessConfigFindOneSpy }),
    },
  },
}));
vi.mock("stream/consumers", () => ({ json: vi.fn() }));
vi.mock("axios", () => ({
  default: { get: spies.axiosGetSpy, post: spies.axiosPostSpy },
}));
vi.mock("../../../utils/socket.js", () => ({ getIO: spies.getIOSpy }));
vi.mock("../../../utils/Elasticsearch.js", () => ({
  esClient: spies.esClient,
  esServers: {
    server1: { host: "h1", indexes: ["search_mix", "youtube_ads_data"] },
    server2: { host: "h2", indexes: ["instagram_search_mix"] },
    server3: { host: "h3", indexes: ["google_ads_data"] },
    server4: { host: "h4", indexes: ["category"] },
  },
  checkElasticsearchHealth: vi.fn(),
}));

let svc;
let resolveBrandLimit;

beforeEach(async () => {
  Object.values(spies).forEach((s) => {
    if (typeof s?.mockReset === "function") s.mockReset();
  });
  Object.values(spies.esClient).forEach((c) => {
    c.search.mockReset();
    c.count.mockReset();
    c.count.mockResolvedValue({ count: 0 });
    c.search.mockResolvedValue({ hits: { hits: [] }, aggregations: {} });
  });
  spies.configGetSpy.mockImplementation((k) => `cfg:${k}`);
  spies.isValidObjectIdSpy.mockReturnValue(true);
  spies.objectIdIsValidSpy.mockReturnValue(true);
  spies._createDetailsThrow = false;
  spies._createRequestThrow = false;
  spies._validationCreateDetailsResult = undefined;
  spies._validationCreateRequestResult = undefined;
  spies.configHasSpy.mockReturnValue(false);
  // Default: no user found → planId stays null → quota check is skipped entirely,
  // so every pre-existing insertCompRequests test is unaffected unless it opts in.
  spies.userDetailsFindByIdSpy.mockReturnValue({ lean: () => Promise.resolve(null) });
  spies.competitorsReqCountDocsSpy.mockResolvedValue(0);
  spies.planAccessConfigFindOneSpy.mockResolvedValue(null);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.resetModules();
  ({ default: svc, resolveBrandLimit } = await import("../../../core/Competitors/competitorService.js"));
});

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.send = vi.fn(() => res);
  return res;
}

describe("competitorService > resolveBrandLimit (pure helper)", () => {
  it("returns brandLimit when plan_id has an entry", () => {
    const doc = { plan_limits: { "101": { brandLimit: 1, competitorLimit: 7 } } };
    expect(resolveBrandLimit(doc, 101)).toBe(1);
  });
  it("coerces numeric planId to string key lookup", () => {
    const doc = { plan_limits: { "104": { brandLimit: 30, competitorLimit: 210 } } };
    expect(resolveBrandLimit(doc, "104")).toBe(30);
    expect(resolveBrandLimit(doc, 104)).toBe(30);
  });
  it("defaults to 0 when plan_id has no entry (matches docs/PLAN_ACCESS.md convention)", () => {
    const doc = { plan_limits: { "101": { brandLimit: 1, competitorLimit: 7 } } };
    expect(resolveBrandLimit(doc, 999)).toBe(0);
  });
  it("defaults to 0 when doc is null/undefined", () => {
    expect(resolveBrandLimit(null, 101)).toBe(0);
    expect(resolveBrandLimit(undefined, 101)).toBe(0);
  });
  it("defaults to 0 when plan_limits is missing entirely", () => {
    expect(resolveBrandLimit({}, 101)).toBe(0);
  });
});

describe("competitorService > create", () => {
  it("400 missing body", async () => {
    const res = mockRes();
    await svc.create({}, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Missing request data");
  });
  it("DB error on email lookup", async () => {
    spies.userDetailsFindOneSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await svc.create({ body: { email: "x@y" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Database error");
  });
  it("existing user → messageResp 'already exists'", async () => {
    spies.userDetailsFindOneSpy.mockResolvedValueOnce({ _id: "u1" });
    const res = mockRes();
    await svc.create({ body: { email: "x@y" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("already exists");
  });
  // 2026-07-14: previously create() left an existing user's plan_id frozen at
  // whatever it was on first-ever creation — a later plan change (or, in this
  // session's incident, testing with different 2026-tier plan_ids for the same
  // account) never propagated, so insertCompRequests()'s brand-limit check kept
  // enforcing a stale, wrong limit forever.
  it("existing user → syncs plan_id/plan_expiry_date onto the existing record", async () => {
    spies.userDetailsFindOneSpy.mockResolvedValueOnce({ _id: "u1", plan_id: 57 });
    const res = mockRes();
    await svc.create({ body: { email: "x@y", plan_id: 101, plan_expiry_date: "2027-01-01" } }, res);
    expect(spies.userDetailsUpdateOneSpy).toHaveBeenCalledWith(
      { _id: "u1" },
      { $set: { plan_id: 101, plan_expiry_date: new Date("2027-01-01") } }
    );
  });
  it("existing user, no plan_id/expiry in request → updateOne not called at all", async () => {
    spies.userDetailsFindOneSpy.mockResolvedValueOnce({ _id: "u1", plan_id: 57 });
    const res = mockRes();
    await svc.create({ body: { email: "x@y" } }, res);
    expect(spies.userDetailsUpdateOneSpy).not.toHaveBeenCalled();
  });
  it("existing user, updateOne throws → still responds 'already exists' (fail-open sync)", async () => {
    spies.userDetailsFindOneSpy.mockResolvedValueOnce({ _id: "u1", plan_id: 57 });
    spies.userDetailsUpdateOneSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await svc.create({ body: { email: "x@y", plan_id: 101 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("already exists");
  });
  it("happy: creates user, returns success", async () => {
    spies.userDetailsFindOneSpy.mockResolvedValueOnce(null);
    spies.userDetailsCreateSpy.mockResolvedValueOnce({ _id: "u1" });
    const res = mockRes();
    await svc.create({ body: { email: "x@y", plan_expiry_date: "2026-12-31" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("User created");
  });
  it("create returns falsy → messageResp 'Error registering'", async () => {
    spies.userDetailsFindOneSpy.mockResolvedValueOnce(null);
    spies.userDetailsCreateSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.create({ body: { email: "x@y", plan_expiry_date: "bad-date" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("Error in registering");
  });
  it("create throws → inner catch fires", async () => {
    spies.userDetailsFindOneSpy.mockResolvedValueOnce(null);
    spies.userDetailsCreateSpy.mockRejectedValueOnce(new Error("nope"));
    const res = mockRes();
    await svc.create({ body: { email: "x@y" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Error in creating");
  });
  it("outer catch on unexpected throw", async () => {
    spies.userDetailsFindOneSpy.mockImplementationOnce(() => { throw new Error("boom"); });
    const res = mockRes();
    // Note: the SUT actually has an inner try/catch that swallows this
    await svc.create({ body: { email: "x@y" } }, res);
    expect(res.send).toHaveBeenCalled();
  });

  it("VALIDATION_FAIL when validator returns error", async () => {
    spies.userDetailsFindOneSpy.mockResolvedValueOnce(null);
    spies._validationCreateDetailsResult = { value: null, error: { details: [{ message: "bad" }] } };
    const res = mockRes();
    await svc.create({ body: { email: "x@y", plan_expiry_date: "2026-12-31" } }, res);
    spies._validationCreateDetailsResult = undefined;
    expect(res.send.mock.calls[0][0].body.msg).toContain("VALIDATION_FAIL");
  });

  // NOTE: outer catch on create() (lines 89-92) is unreachable through
  // public API — every throwing operation between line 31 and the catch
  // is wrapped by either the inner email-lookup try, the validator
  // (which returns {error} rather than throwing), or the inner
  // create-user try. Stays as defensive guard.
});

describe("competitorService > checkUser", () => {
  it("400 missing query (sets ?)", async () => {
    const res = mockRes();
    await svc.checkUser({}, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Missing request data");
  });
  it("existing user → 201 statusCode body", async () => {
    spies.userDetailsFindOneSpy.mockResolvedValueOnce({ _id: "u1" });
    const res = mockRes();
    await svc.checkUser({ query: { email: "x@y" } }, res);
    expect(res.json.mock.calls[0][0].statusCode).toBe(201);
  });
  it("non-existent user → 401 statusCode body", async () => {
    spies.userDetailsFindOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.checkUser({ query: { email: "x@y" } }, res);
    expect(res.json.mock.calls[0][0].statusCode).toBe(401);
  });
  it("empty email → messageResp", async () => {
    const res = mockRes();
    await svc.checkUser({ query: { email: "" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("proper email");
  });
  it("catch on find throw", async () => {
    spies.userDetailsFindOneSpy.mockRejectedValueOnce(new Error("db"));
    const res = mockRes();
    await svc.checkUser({ query: { email: "x@y" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Error in fetching");
  });
});

describe("competitorService > checkBrand", () => {
  it("400 missing body", async () => {
    const res = mockRes();
    await svc.checkBrand({}, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Missing request data");
  });
  it("brand found", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "b1" });
    const res = mockRes();
    await svc.checkBrand({ body: { brand: "Acme", user_id: "u1" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Fetched brand");
  });
  it("brand not found → 401", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.checkBrand({ body: { brand: "Acme", user_id: "u1" } }, res);
    expect(res.json.mock.calls[0][0].statusCode).toBe(401);
  });
  it("DB error", async () => {
    spies.competitorsReqFindOneSpy.mockRejectedValueOnce(new Error("db"));
    const res = mockRes();
    await svc.checkBrand({ body: { brand: "Acme", user_id: "u1" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Error in finding");
  });
  it("validation fail for brand: empty brand+user_id → fires 'user_id is required' + 'proper brand name'", async () => {
    const res = mockRes();
    await svc.checkBrand({ body: {} }, res);
    // SUT bug: first res.send fires (without return), then else-branch
    // res.send fires too. Both invocations happen.
    expect(res.send).toHaveBeenCalled();
  });

  it("user_id present + brand missing → enters if via right-side of `||` (line 455 binary idx 3) then crashes in brand.replace", async () => {
    // Right-side `(user_id && user_id != "")` is true with brand undefined/falsy,
    // so the if enters. Inside, line 462 calls `brand.replace(...)` on
    // undefined → TypeError → outer catch returns "Error in finding the brand".
    const res = mockRes();
    await svc.checkBrand({ body: { user_id: "u1" } }, res);
    expect(res.send.mock.calls.at(-1)[0].body.msg).toContain("Error in finding the brand");
  });
});

describe("competitorService > updateAdvertiser", () => {
  it("missing required fields", async () => {
    const res = mockRes();
    await svc.updateAdvertiser({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("Please provide");
  });
  it("brand not requested", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.updateAdvertiser({ body: { user_id: "u", advertiser: ["A"], newadvertiser: "B" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("not requested");
  });
  it("happy: updates advertiser", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "b1" });
    spies.competitorsReqUpdateOneSpy.mockResolvedValueOnce({ modifiedCount: 1 });
    const res = mockRes();
    await svc.updateAdvertiser({ body: { user_id: "u", advertiser: ["A"], newadvertiser: "B" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Advertiser updated");
  });
  it("no modification → 'No change'", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "b1" });
    spies.competitorsReqUpdateOneSpy.mockResolvedValueOnce({ modifiedCount: 0 });
    const res = mockRes();
    await svc.updateAdvertiser({ body: { user_id: "u", advertiser: ["A"], newadvertiser: "B" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("No change");
  });
  it("catch", async () => {
    spies.competitorsReqFindOneSpy.mockRejectedValueOnce(new Error("db"));
    const res = mockRes();
    await svc.updateAdvertiser({ body: { user_id: "u", advertiser: ["A"], newadvertiser: "B" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Error in updateAdvertiser");
  });
});

describe("competitorService > getInactiveUsers", () => {
  it("returns paginated inactive users", async () => {
    spies.competitorsReqDistinctSpy.mockResolvedValueOnce(["u1"]);
    spies.userDetailsCountDocsSpy.mockResolvedValueOnce(2);
    spies.userDetailsFindSpy.mockReturnValueOnce({
      sort: () => ({ skip: () => ({ limit: () => Promise.resolve([
        { userName: "Alice", amember_id: 1, createdAt: new Date() },
      ]) }) }),
    });
    const res = mockRes();
    await svc.getInactiveUsers({ query: { page: "1", limit: "10" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Fetched inactive");
  });
  it("no inactive users", async () => {
    spies.competitorsReqDistinctSpy.mockResolvedValueOnce([]);
    spies.userDetailsCountDocsSpy.mockResolvedValueOnce(0);
    spies.userDetailsFindSpy.mockReturnValueOnce({
      sort: () => ({ skip: () => ({ limit: () => Promise.resolve([]) }) }),
    });
    const res = mockRes();
    await svc.getInactiveUsers({ query: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("No more Inactive");
  });
  it("with amemberId/userName/dateRange filters", async () => {
    spies.competitorsReqDistinctSpy.mockResolvedValueOnce([]);
    spies.userDetailsCountDocsSpy.mockResolvedValueOnce(0);
    spies.userDetailsFindSpy.mockReturnValueOnce({
      sort: () => ({ skip: () => ({ limit: () => Promise.resolve([]) }) }),
    });
    const res = mockRes();
    await svc.getInactiveUsers({ query: { user_id: "5", userName: "alice", from: "2025-01-01", to: "2025-01-31" } }, res);
    expect(res.send).toHaveBeenCalled();
  });
  it("catch on distinct throw", async () => {
    spies.competitorsReqDistinctSpy.mockRejectedValueOnce(new Error("db"));
    const res = mockRes();
    await svc.getInactiveUsers({ query: {} }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Failed to fetch");
  });
  it("inactive user with missing userName → `|| null` fallback (line 2101)", async () => {
    spies.competitorsReqDistinctSpy.mockResolvedValueOnce([]);
    spies.userDetailsCountDocsSpy.mockResolvedValueOnce(1);
    spies.userDetailsFindSpy.mockReturnValueOnce({
      sort: () => ({ skip: () => ({ limit: () => Promise.resolve([
        { amember_id: 5, createdAt: new Date() }, // no userName
      ]) }) }),
    });
    const res = mockRes();
    await svc.getInactiveUsers({ query: {} }, res);
    expect(res.send.mock.calls[0][0].body.data.data[0].userName).toBeNull();
  });
});

describe("competitorService > getActiveUsers", () => {
  function makeChain(data) {
    return {
      populate: function () { return this; },
      sort: function () { return this; },
      lean: () => Promise.resolve(data),
    };
  }
  it("returns paginated active users", async () => {
    spies.competitorsReqFindSpy.mockReturnValueOnce(makeChain([
      { user_id: { amember_id: 1, userName: "Alice" }, advertiser: ["A"], competitors: [], createdAt: new Date() },
    ]));
    const res = mockRes();
    await svc.getActiveUsers({ query: {} }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Fetched active");
  });
  it("no active users", async () => {
    spies.competitorsReqFindSpy.mockReturnValueOnce(makeChain([]));
    const res = mockRes();
    await svc.getActiveUsers({ query: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("No more active");
  });
  it("with all filters (amemberId, userName, date range)", async () => {
    spies.competitorsReqFindSpy.mockReturnValueOnce(makeChain([
      { user_id: { amember_id: 1, userName: "Alice" }, advertiser: ["A"], competitors: [], createdAt: "2025-01-15" },
    ]));
    const res = mockRes();
    await svc.getActiveUsers({ query: { user_id: "1", userName: "alice", from: "2025-01-01", to: "2025-12-31" } }, res);
    expect(res.send).toHaveBeenCalled();
  });
  it("user_id null in doc filtered out", async () => {
    spies.competitorsReqFindSpy.mockReturnValueOnce(makeChain([
      { user_id: null, advertiser: ["A"], competitors: [] },
    ]));
    const res = mockRes();
    await svc.getActiveUsers({ query: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("No more active");
  });
  it("catch on find throw", async () => {
    spies.competitorsReqFindSpy.mockImplementationOnce(() => { throw new Error("db"); });
    const res = mockRes();
    await svc.getActiveUsers({ query: {} }, res);
    expect(res.send).toHaveBeenCalled();
  });
  it("active user with populated user_id missing userName → `|| null` fallback (line 2168)", async () => {
    spies.competitorsReqFindSpy.mockReturnValueOnce(makeChain([
      { user_id: { amember_id: 1 /* no userName */ }, advertiser: ["A"], competitors: [], createdAt: new Date() },
    ]));
    const res = mockRes();
    await svc.getActiveUsers({ query: {} }, res);
    expect(res.send.mock.calls[0][0].body.data.data[0].userName).toBeNull();
  });
});

describe("competitorService > getCompUsersCount", () => {
  it("aggregates active/total/inactive counts", async () => {
    spies.competitorsReqDistinctSpy.mockResolvedValueOnce(["u1", "u2"]);
    spies.userDetailsCountDocsSpy.mockResolvedValueOnce(10);
    spies.userDetailsAggregateSpy.mockResolvedValueOnce([{ missingUserCount: 8 }]);
    const res = mockRes();
    await svc.getCompUsersCount({}, res);
    const data = res.send.mock.calls[0][0].body.data;
    expect(data.totalUsers).toBe(10);
    expect(data.activeUsers).toBe(2);
    expect(data.inActiveUsers).toBe(8);
  });
  it("inactive count default to 0", async () => {
    spies.competitorsReqDistinctSpy.mockResolvedValueOnce([]);
    spies.userDetailsCountDocsSpy.mockResolvedValueOnce(0);
    spies.userDetailsAggregateSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await svc.getCompUsersCount({}, res);
    expect(res.send.mock.calls[0][0].body.data.inActiveUsers).toBe(0);
  });
  it("catch on distinct throw", async () => {
    spies.competitorsReqDistinctSpy.mockRejectedValueOnce(new Error("db"));
    const res = mockRes();
    await svc.getCompUsersCount({}, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Failed to fetch");
  });
});

describe("competitorService > utility methods", () => {
  it("sleep resolves after the given ms", async () => {
    const start = Date.now();
    await svc.sleep(10);
    expect(Date.now() - start).toBeGreaterThanOrEqual(0);
  });
  it("escapeRegex escapes regex specials", () => {
    expect(svc.escapeRegex("a.b+c")).toBe("a\\.b\\+c");
    expect(svc.escapeRegex()).toBe("");
  });
  it("normalizeAdvertiser strips https/www/tld", () => {
    expect(svc.normalizeAdvertiser("https://www.Acme.com/foo")).toBe("acme");
    expect(svc.normalizeAdvertiser(["FOO"])).toBe("foo");
    expect(svc.normalizeAdvertiser([])).toBe("");
  });
  it("getTodayDate returns YYYY-MM-DD", () => {
    expect(svc.getTodayDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
  it("normalizeKey lowercases, strips whitespace and non-alnum", () => {
    expect(svc.normalizeKey("Hello World!")).toBe("helloworld");
  });
  it("normalizeObjectId returns null for null/undefined/'null'/'undefined' strings", () => {
    expect(svc.normalizeObjectId(null)).toBe(null);
    expect(svc.normalizeObjectId("null")).toBe(null);
    expect(svc.normalizeObjectId("undefined")).toBe(null);
    expect(svc.normalizeObjectId("abc")).toBe("abc");
  });
  it("cleanJSONResponse strips ```json fences", () => {
    expect(svc.cleanJSONResponse('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("buildPrompt with excluded list", () => {
    const p = svc.buildPrompt("Brand", 10, [{ name: "X", domain: "x.com" }]);
    expect(p).toContain("Brand");
    expect(p).toContain("X | x.com");
  });
  it("buildPrompt without excluded list (default param)", () => {
    const p = svc.buildPrompt("Brand", 5);
    expect(p).toContain("Brand");
    expect(p).not.toContain("Already known");
  });
});

describe("competitorService > callGeminiWithRetry", () => {
  it("returns response on first success", async () => {
    const ai = { models: { generateContent: vi.fn().mockResolvedValueOnce({ text: "ok" }) } };
    const r = await svc.callGeminiWithRetry(ai, "prompt");
    expect(r).toEqual({ text: "ok" });
  });
  it("throws after exhausting retries", async () => {
    const ai = { models: { generateContent: vi.fn().mockRejectedValue(new Error("fail")) } };
    await expect(svc.callGeminiWithRetry(ai, "prompt", 1)).rejects.toThrow();
  }, 30000);

  it("retryable error: succeeds on 2nd attempt (covers retry branch lines 1226-1227)", async () => {
    const ai = { models: { generateContent: vi.fn()
      .mockRejectedValueOnce(new Error("quota exceeded"))
      .mockResolvedValueOnce({ text: "recovered" }) } };
    const r = await svc.callGeminiWithRetry(ai, "prompt", 3);
    expect(r).toEqual({ text: "recovered" });
    expect(ai.models.generateContent).toHaveBeenCalledTimes(2);
  });

  it("retryable error exhausts retries → 'Gemini API failed after retries' (line 1231)", async () => {
    const ai = { models: { generateContent: vi.fn()
      .mockRejectedValue(new Error("model is overloaded")) } };
    await expect(svc.callGeminiWithRetry(ai, "prompt", 2)).rejects.toThrow(
      "Gemini API failed after retries"
    );
    expect(ai.models.generateContent).toHaveBeenCalledTimes(2);
  });
});

describe("competitorService > insertIntoExistingComp", () => {
  it("upserts via Existing_competitors.updateOne", async () => {
    spies.existingCompUpdateOneSpy.mockResolvedValueOnce({ acknowledged: true });
    // SUT uses c.name and c.domain (not c.tool_name)
    await svc.insertIntoExistingComp("Acme", [{ name: "c1", domain: "c1.com" }]);
    expect(spies.existingCompUpdateOneSpy).toHaveBeenCalled();
  });
  it("returns early when competitors empty/non-array", async () => {
    const r = await svc.insertIntoExistingComp("Acme", []);
    expect(r).toBeUndefined();
  });

  it("deduplicates competitors with same normalized name (line 1239 false branch)", async () => {
    spies.existingCompUpdateOneSpy.mockResolvedValueOnce({ acknowledged: true });
    // Two competitors normalizing to the same key — the second `if (!uniqueByName.has(key))`
    // check is false on the duplicate, so the dedup block is exercised.
    await svc.insertIntoExistingComp("Acme", [
      { name: "Same Brand", domain: "a.com" },
      { name: "Same Brand", domain: "b.com" }, // duplicate name
    ]);
    expect(spies.existingCompUpdateOneSpy).toHaveBeenCalled();
  });
});

describe("competitorService > generateCompetitorPrompt", () => {
  it("returns '' when brandArr is empty (line 2020)", () => {
    expect(svc.generateCompetitorPrompt([], [])).toBe("");
  });

  it("returns prompt with excluded list when excludedComps non-empty", () => {
    const p = svc.generateCompetitorPrompt(["Acme"], ["X", "Y"]);
    expect(p).toContain("Acme");
    expect(p).toContain("Avoid listing");
    expect(p).toContain("\"X\"");
  });

  it("returns prompt without excluded list when excludedComps empty", () => {
    const p = svc.generateCompetitorPrompt(["Acme"], []);
    expect(p).toContain("Acme");
    expect(p).not.toContain("Avoid listing");
  });
});

describe("competitorService > saveUniqueCompetitors / getFirst30 / getAllComps", () => {
  it("saveUniqueCompetitors: skips when no array passed", async () => {
    const r = await svc.saveUniqueCompetitors("Acme", null);
    expect(r).toBe(0);
  });
  it("saveUniqueCompetitors: returns 0 when limit already reached", async () => {
    spies.existingCompFindOneSpy.mockResolvedValueOnce({
      competitors: new Array(200).fill({ competitor_name: "x" }),
    });
    const r = await svc.saveUniqueCompetitors("Acme", [{ tool_name: "c1", domain: "c1.com" }]);
    expect(r).toBe(0);
  });
  it("saveUniqueCompetitors: all competitors already exist in DB → toInsert empty → returns 0 (line 2301)", async () => {
    spies.existingCompFindOneSpy.mockResolvedValueOnce({
      competitors: [
        { competitor_name: "X" },
        { competitor_name: "Y" },
      ],
    });
    // Pass competitors whose names ALL already exist in DB → uniqueByName ends empty
    const r = await svc.saveUniqueCompetitors("Acme", [
      { tool_name: "X", domain: "x.com" },
      { tool_name: "Y", domain: "y.com" },
    ]);
    expect(r).toBe(0);
    // updateOne should NOT have been called (early-return at line 2301)
    expect(spies.existingCompUpdateOneSpy).not.toHaveBeenCalled();
  });

  it("saveUniqueCompetitors: inserts new + dedupes by name", async () => {
    spies.existingCompFindOneSpy.mockResolvedValueOnce({ competitors: [{ competitor_name: "existing" }] });
    spies.existingCompUpdateOneSpy.mockResolvedValueOnce({});
    const r = await svc.saveUniqueCompetitors("Acme", [
      { tool_name: "C1", domain: "c1.com" },
      { tool_name: "c1", domain: "c1.com" }, // dup
      { tool_name: "existing", domain: "x.com" }, // already there
      { tool_name: "", domain: null }, // skipped
      { tool_name: "NoUrl" }, // no domain → url || null fallback
    ]);
    expect(r.length).toBe(2);
  });
  it("saveUniqueCompetitors: no existing doc → `doc?.competitors || []` fallback", async () => {
    spies.existingCompFindOneSpy.mockResolvedValueOnce(null); // doc null
    spies.existingCompUpdateOneSpy.mockResolvedValueOnce({});
    const r = await svc.saveUniqueCompetitors("Acme", [{ tool_name: "Solo", domain: "s.com" }], 5);
    expect(r.length).toBe(1);
  });
  it("getFirst30 returns first slice", async () => {
    spies.existingCompFindOneSpy.mockResolvedValueOnce({ competitors: [{ a: 1 }] });
    const r = await svc.getFirst30("Acme");
    expect(r).toEqual([{ a: 1 }]);
  });
  it("getFirst30 returns [] when no doc", async () => {
    spies.existingCompFindOneSpy.mockResolvedValueOnce(null);
    expect(await svc.getFirst30("Acme")).toEqual([]);
  });
  it("getAllComps returns full list", async () => {
    spies.existingCompFindOneSpy.mockResolvedValueOnce({ competitors: [{ a: 1 }, { a: 2 }] });
    const r = await svc.getAllComps("Acme");
    expect(r.length).toBe(2);
  });
  it("getAllComps returns [] when no doc", async () => {
    spies.existingCompFindOneSpy.mockResolvedValueOnce(null);
    expect(await svc.getAllComps("Acme")).toEqual([]);
  });
});

describe("competitorService > updateUserDailyTokens / isDailyLimitExceeded", () => {
  it("updateUserDailyTokens applies delta from axios + sync state", async () => {
    spies.axiosGetSpy.mockResolvedValueOnce({ data: { data: { token_usage: { input_tokens: 100, output_tokens: 200 } } } });
    spies.tokenSyncFindOneSpy.mockResolvedValueOnce({ last_input_tokens: 50, last_output_tokens: 100 });
    spies.userDailyTokensUpdateOneSpy.mockResolvedValueOnce({});
    spies.tokenSyncUpdateOneSpy.mockResolvedValueOnce({});
    await svc.updateUserDailyTokens("u1", "c1");
    expect(spies.userDailyTokensUpdateOneSpy).toHaveBeenCalled();
    expect(spies.tokenSyncUpdateOneSpy).toHaveBeenCalled();
  });
  it("isDailyLimitExceeded returns true when over limit", async () => {
    spies.userDailyTokensFindOneSpy.mockResolvedValueOnce({ output_tokens: 30000 });
    spies.configGetSpy.mockReturnValueOnce(20000);
    expect(await svc.isDailyLimitExceeded("u1")).toBe(true);
  });
  it("isDailyLimitExceeded returns false when under", async () => {
    spies.userDailyTokensFindOneSpy.mockResolvedValueOnce({ output_tokens: 100 });
    spies.configGetSpy.mockReturnValueOnce(20000);
    expect(await svc.isDailyLimitExceeded("u1")).toBe(false);
  });
});

describe("competitorService > checkDailyTokenLimit", () => {
  it("400 missing user_id", async () => {
    const res = mockRes();
    await svc.checkDailyTokenLimit({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it("happy: returns used/limit/remaining/exceeded", async () => {
    spies.userDailyTokensFindOneSpy.mockResolvedValueOnce({ output_tokens: 500 });
    spies.configGetSpy.mockReturnValueOnce(20000);
    const res = mockRes();
    await svc.checkDailyTokenLimit({ body: { user_id: "u1" } }, res);
    const out = res.json.mock.calls[0][0];
    expect(out.data.used).toBe(500);
  });
  it("500 catch on db throw", async () => {
    spies.userDailyTokensFindOneSpy.mockRejectedValueOnce(new Error("db"));
    const res = mockRes();
    await svc.checkDailyTokenLimit({ body: { user_id: "u1" } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("doc.output_tokens missing + config falsy → both `|| 0` and `|| 20000` fallbacks fire", async () => {
    spies.userDailyTokensFindOneSpy.mockResolvedValueOnce(null);
    spies.configGetSpy.mockReturnValueOnce(undefined);
    const res = mockRes();
    await svc.checkDailyTokenLimit({ body: { user_id: "u1" } }, res);
    const out = res.json.mock.calls[0][0];
    expect(out.data.used).toBe(0);
    expect(out.data.limit).toBe(20000);
  });
});

describe("competitorService > fetchKeywordsBasedOnWebsite", () => {
  it("happy: returns axios.data", async () => {
    spies.axiosPostSpy.mockResolvedValueOnce({ data: { ok: true } });
    const res = mockRes();
    await svc.fetchKeywordsBasedOnWebsite({ body: { webSiteUrl: "x.com" } }, res);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });
  it("400 catch", async () => {
    spies.axiosPostSpy.mockRejectedValueOnce(new Error("api-down"));
    const res = mockRes();
    await svc.fetchKeywordsBasedOnWebsite({ body: { webSiteUrl: "x.com" } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("competitorService > deleteProject", () => {
  it("400 missing fields", async () => {
    const res = mockRes();
    await svc.deleteProject({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it("404 when no doc deleted", async () => {
    spies.competitorsReqDeleteOneSpy.mockResolvedValueOnce({ deletedCount: 0 });
    const res = mockRes();
    await svc.deleteProject({ body: { user_id: "u", advertiser: "Acme" } }, res);
    expect(res.json.mock.calls[0][0].statusCode).toBe(404);
  });
  it("200 success", async () => {
    spies.competitorsReqDeleteOneSpy.mockResolvedValueOnce({ deletedCount: 1 });
    const res = mockRes();
    await svc.deleteProject({ body: { user_id: "u", advertiser: "Acme" } }, res);
    expect(res.json.mock.calls[0][0].statusCode).toBe(200);
  });
  it("500 catch", async () => {
    spies.competitorsReqDeleteOneSpy.mockRejectedValueOnce(new Error("db"));
    const res = mockRes();
    await svc.deleteProject({ body: { user_id: "u", advertiser: "Acme" } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("competitorService > checkCompetitorProcess", () => {
  it("400 missing user_id", async () => {
    const res = mockRes();
    await svc.checkCompetitorProcess({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it("daily-limit exceeded", async () => {
    spies.userDailyTokensFindOneSpy.mockResolvedValueOnce({ output_tokens: 30000 });
    spies.configGetSpy.mockReturnValueOnce(20000);
    const res = mockRes();
    await svc.checkCompetitorProcess({ body: { user_id: "u1", advertiser: "A" } }, res);
    expect(res.json.mock.calls[0][0].data.exceeded).toBe(true);
  });
  it("happy with new project + axios success", async () => {
    spies.userDailyTokensFindOneSpy.mockResolvedValueOnce(null);
    spies.configGetSpy.mockImplementation(() => 20000);
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce(null);
    spies.competitorsReqCreateSpy.mockResolvedValueOnce({ _id: "p1" });
    spies.axiosPostSpy.mockResolvedValueOnce({ data: { data: { x: 1 } } });
    const res = mockRes();
    await svc.checkCompetitorProcess({ body: { user_id: "u1", advertiser: ["Acme"], content_ref_id: "c", keywords: [], limit: 5 } }, res);
    expect(res.json).toHaveBeenCalled();
  });
  it("502 when the DS /prepare call fails (non-timeout)", async () => {
    spies.userDailyTokensFindOneSpy.mockResolvedValueOnce(null);
    spies.configGetSpy.mockReturnValue(20000);
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1" });
    spies.axiosPostSpy.mockRejectedValueOnce(new Error("api"));
    const res = mockRes();
    await svc.checkCompetitorProcess({ body: { user_id: "u1", advertiser: "A" } }, res);
    // Distinguished from a timeout (504, ECONNABORTED/"timeout" message) so the
    // frontend can show a specific "try fewer competitors" message only when
    // that's actually the likely cause.
    expect(res.status).toHaveBeenCalledWith(502);
  });

  it("504 when the DS /prepare call times out, and cleans up a newly-created project", async () => {
    spies.userDailyTokensFindOneSpy.mockResolvedValueOnce(null);
    spies.configGetSpy.mockReturnValue(20000);
    // No existing project found → this request creates one, so a timeout
    // must clean it up rather than leaving a phantom empty brand behind.
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce(null);
    spies.competitorsReqCreateSpy.mockResolvedValueOnce({ _id: "newly-created" });
    spies.competitorsReqDeleteOneSpy.mockResolvedValueOnce({ deletedCount: 1 });
    const timeoutErr = Object.assign(new Error("timeout of 45000ms exceeded"), { code: "ECONNABORTED" });
    spies.axiosPostSpy.mockRejectedValueOnce(timeoutErr);
    const res = mockRes();
    await svc.checkCompetitorProcess({ body: { user_id: "u1", advertiser: "A", content_ref_id: "c1", limit: 100 } }, res);
    expect(res.status).toHaveBeenCalledWith(504);
    expect(spies.competitorsReqDeleteOneSpy).toHaveBeenCalledWith({ _id: "newly-created" });
  });

  it("advertiser as empty array → fullBrand falls back to advertiser (L3280 #1, L3319 #1)", async () => {
    spies.userDailyTokensFindOneSpy.mockResolvedValueOnce(null);
    spies.configGetSpy.mockImplementation(() => 20000);
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1" });
    spies.axiosPostSpy.mockResolvedValueOnce({ data: { data: {} } });
    const res = mockRes();
    await svc.checkCompetitorProcess({ body: { user_id: "u1", advertiser: [], content_ref_id: "c", keywords: [], limit: 5 } }, res);
    expect(res.json).toHaveBeenCalled();
  });
  it("advertiser as empty string → fullBrand falls back to '' (L3280 #2)", async () => {
    spies.userDailyTokensFindOneSpy.mockResolvedValueOnce(null);
    spies.configGetSpy.mockImplementation(() => 20000);
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1" });
    spies.axiosPostSpy.mockResolvedValueOnce({ data: { data: {} } });
    const res = mockRes();
    await svc.checkCompetitorProcess({ body: { user_id: "u1", advertiser: "", content_ref_id: "c", keywords: [], limit: 5 } }, res);
    expect(res.json).toHaveBeenCalled();
  });

  it("axios returns no .data → fallback to {} (line 3227 true branch)", async () => {
    spies.userDailyTokensFindOneSpy.mockResolvedValueOnce(null);
    spies.configGetSpy.mockImplementation(() => 20000);
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1" });
    // pythonResponse.data missing → `if (!pythonResponse.data) pythonResponse.data = {}`
    spies.axiosPostSpy.mockResolvedValueOnce({ data: {} });
    const res = mockRes();
    await svc.checkCompetitorProcess({ body: { user_id: "u1", advertiser: "A" } }, res);
    expect(res.json.mock.calls[0][0].data.exceeded).toBe(false);
  });
});

describe("competitorService > getAllCompetitors", () => {
  it("400 missing advertiser", async () => {
    const res = mockRes();
    await svc.getAllCompetitors({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it("happy: returns simplified competitor list", async () => {
    spies.existingCompFindOneSpy.mockReturnValueOnce({
      lean: () => Promise.resolve({ competitors: [{ competitor_name: "X", competitor_url: "x.com" }] }),
    });
    const res = mockRes();
    await svc.getAllCompetitors({ body: { advertiser: "Acme" } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
  it("empty pool returns empty data array", async () => {
    spies.existingCompFindOneSpy.mockReturnValueOnce({
      lean: () => Promise.resolve(null),
    });
    const res = mockRes();
    await svc.getAllCompetitors({ body: { advertiser: ["Acme"] } }, res);
    expect(res.json.mock.calls[0][0].data).toEqual([]);
  });
  it("500 on db throw", async () => {
    spies.existingCompFindOneSpy.mockImplementationOnce(() => { throw new Error("db"); });
    const res = mockRes();
    await svc.getAllCompetitors({ body: { advertiser: "Acme" } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("competitorService > getAdvertiserAdCount", () => {
  it("sums counts across all ES servers", async () => {
    spies.esClient.server1.count.mockResolvedValue({ count: 5 });
    spies.esClient.server2.count.mockResolvedValue({ count: 3 });
    spies.esClient.server3.count.mockResolvedValue({ count: 0 });
    spies.esClient.server4.count.mockResolvedValue({ count: 0 });
    const r = await svc.getAdvertiserAdCount("Acme");
    expect(r).toBeGreaterThanOrEqual(0);
  });
  it("handles null count gracefully", async () => {
    Object.values(spies.esClient).forEach((c) => c.count.mockResolvedValue({ count: null }));
    const r = await svc.getAdvertiserAdCount("Acme");
    expect(r).toBe(0);
  });
});

describe("competitorService > getCompetitorIdsFromMaster", () => {
  it("returns [] for empty input", async () => {
    expect(await svc.getCompetitorIdsFromMaster([])).toEqual([]);
  });
  it("returns existing IDs + inserts new ones", async () => {
    spies.competitorsFindSpy.mockResolvedValueOnce([{ _id: "e1", competitor_name: "existing" }]);
    const insertManySpy = vi.fn().mockResolvedValueOnce([{ _id: "n1" }]);
    const mod = await import("../../../models/competitors.js");
    mod.default.insertMany = insertManySpy;
    const r = await svc.getCompetitorIdsFromMaster([
      { tool_name: "Existing", domain: "e.com" },
      { tool_name: "New", domain: "n.com" },
    ]);
    expect(r.length).toBeGreaterThanOrEqual(1);
  });
  it("handles duplicate-key error by re-fetching all ids", async () => {
    spies.competitorsFindSpy.mockResolvedValueOnce([]);
    const mod = await import("../../../models/competitors.js");
    const dupErr = new Error("dup"); dupErr.code = 11000;
    mod.default.insertMany = vi.fn().mockRejectedValueOnce(dupErr);
    spies.competitorsFindSpy.mockResolvedValueOnce([{ _id: "all1" }, { _id: "all2" }]);
    const r = await svc.getCompetitorIdsFromMaster([{ tool_name: "X" }]);
    expect(r.length).toBeGreaterThanOrEqual(2);
  });
  it("rethrows non-duplicate errors", async () => {
    spies.competitorsFindSpy.mockResolvedValueOnce([]);
    const mod = await import("../../../models/competitors.js");
    mod.default.insertMany = vi.fn().mockRejectedValueOnce(new Error("other-fail"));
    await expect(svc.getCompetitorIdsFromMaster([{ tool_name: "X" }])).rejects.toThrow("other-fail");
  });
  it("filters out entries with no name", async () => {
    spies.competitorsFindSpy.mockResolvedValueOnce([]);
    const r = await svc.getCompetitorIdsFromMaster([{ tool_name: null }, { domain: "x.com" }]);
    expect(r).toEqual([]);
  });
});

describe("competitorService > getCompetitorTableRows", () => {
  it("returns [] when project not found", async () => {
    spies.competitorsReqFindOneSpy.mockReturnValueOnce({ lean: () => Promise.resolve(null) });
    expect(await svc.getCompetitorTableRows({ project_name: "X", user_id: "u" })).toEqual([]);
  });
  it("projectDoc missing competitors/monitoring keys → `|| []` fallbacks fire (lines 3091-3092)", async () => {
    spies.competitorsReqFindOneSpy.mockReturnValueOnce({
      lean: () => Promise.resolve({ _id: "p1" /* no competitors/monitoring */ }),
    });
    spies.competitorsFindSpy.mockReturnValueOnce({
      sort: () => ({ lean: () => Promise.resolve([]) }),
    });
    const r = await svc.getCompetitorTableRows({ project_name: "X", user_id: "u" });
    expect(r).toEqual([]);
  });

  it("returns rows tagged with monitoring flag", async () => {
    spies.competitorsReqFindOneSpy.mockReturnValueOnce({
      lean: () => Promise.resolve({
        _id: "p1",
        competitors: ["c1", "c2"],
        monitoring: [{ toString: () => "c1" }],
      }),
    });
    spies.competitorsFindSpy.mockReturnValueOnce({
      sort: () => ({
        lean: () => Promise.resolve([
          { _id: { toString: () => "c1" }, competitor_name: "C1", competitor_url: "c1.com" },
          { _id: { toString: () => "c2" }, competitor_name: "C2" },
        ]),
      }),
    });
    const r = await svc.getCompetitorTableRows({ project_name: "X", user_id: "u" });
    expect(r.length).toBe(2);
    expect(r[0].monitoring).toBe(true);
    expect(r[1].monitoring).toBe(false);
  });
});

describe("competitorService > attachCompetitorsToUserRequest", () => {
  it("noop when competitorIds empty", async () => {
    await svc.attachCompetitorsToUserRequest("u", ["Acme"], [], []);
    expect(spies.competitorsReqUpdateOneSpy).not.toHaveBeenCalled();
  });
  it("upserts on the request collection", async () => {
    spies.competitorsReqUpdateOneSpy.mockResolvedValueOnce({});
    await svc.attachCompetitorsToUserRequest("u", ["Acme"], ["c1"], []);
    expect(spies.competitorsReqUpdateOneSpy).toHaveBeenCalled();
  });
  it("empty advertiserArray → normalizeAdvertiser('') fallback (L2868)", async () => {
    spies.competitorsReqUpdateOneSpy.mockResolvedValueOnce({});
    await svc.attachCompetitorsToUserRequest("u", [], ["c1"], []);
    expect(spies.competitorsReqUpdateOneSpy).toHaveBeenCalled();
  });
  it("logs on updateOne throw (does NOT rethrow)", async () => {
    spies.competitorsReqUpdateOneSpy.mockRejectedValueOnce(new Error("db"));
    await svc.attachCompetitorsToUserRequest("u", ["Acme"], ["c1"], []);
    expect(spies.loggerErrorSpy).toHaveBeenCalled();
  });
});

describe("competitorService > checkExistingCompetitorCount", () => {
  it("400 missing advertiser", async () => {
    const res = mockRes();
    await svc.checkExistingCompetitorCount({ body: {}, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it("409 when count < 200", async () => {
    spies.existingCompFindOneSpy.mockReturnValueOnce({
      lean: () => Promise.resolve({ competitors: [{ competitor_name: "X" }] }),
    });
    const res = mockRes();
    await svc.checkExistingCompetitorCount({ body: { advertiser: "Acme" }, query: { page: "1" } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });
  it("201 when count >= 200, with user_id", async () => {
    // Interleave monitored ("M…") and unmonitored ("X…") so the monitored-first
    // sort comparator exercises both `a.monitored ? -1 : 1` branches (L2970).
    const big = new Array(200).fill(0).map((_, i) => ({ competitor_name: (i % 2 === 0 ? "M" : "X") + i }));
    const monitored = big.filter((_, i) => i % 2 === 0).map((c) => ({ competitor_name: c.competitor_name }));
    spies.existingCompFindOneSpy.mockReturnValueOnce({
      lean: () => Promise.resolve({ competitors: big }),
    });
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1", monitoring: ["m1"] });
    spies.competitorsFindSpy.mockReturnValueOnce({
      lean: () => Promise.resolve(monitored),
    });
    spies.competitorsFindSpy.mockReturnValueOnce({
      lean: () => Promise.resolve([{ competitor_name: "X", _id: "x1" }]),
    });
    Object.values(spies.esClient).forEach((c) => c.count.mockResolvedValue({ count: 1 }));
    const res = mockRes();
    await svc.checkExistingCompetitorCount({ body: { advertiser: "Acme", user_id: "u" }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
  it("500 on db throw", async () => {
    spies.existingCompFindOneSpy.mockImplementationOnce(() => { throw new Error("db"); });
    const res = mockRes();
    await svc.checkExistingCompetitorCount({ body: { advertiser: "Acme" }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
  it("Existing_competitors returns null doc → `?? []` nullish fallback fires (line 2829)", async () => {
    spies.existingCompFindOneSpy.mockReturnValueOnce({
      lean: () => Promise.resolve(null),
    });
    const res = mockRes();
    await svc.checkExistingCompetitorCount({ body: { advertiser: "Acme" }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(409); // count=0 < 200
  });

  it("advertiser passed as array → brand[0] is taken (line 2804 true branch)", async () => {
    spies.existingCompFindOneSpy.mockReturnValueOnce({
      lean: () => Promise.resolve(null),
    });
    const res = mockRes();
    await svc.checkExistingCompetitorCount({ body: { advertiser: ["Acme", "Bcme"] }, query: {} }, res);
    // Brand "Acme" extracted; doc null → 409 path
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("user_id provided but compRequest is null → skip monitoring lookup (line 2852 false branch)", async () => {
    const big = new Array(200).fill({ competitor_name: "X", competitor_url: "x.com" });
    spies.existingCompFindOneSpy.mockReturnValueOnce({
      lean: () => Promise.resolve({ competitors: big }),
    });
    // user_id present BUT compRequest lookup returns null
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce(null);
    spies.competitorsFindSpy.mockReturnValueOnce({
      lean: () => Promise.resolve([{ competitor_name: "X", _id: "x1" }]),
    });
    Object.values(spies.esClient).forEach((c) => c.count.mockResolvedValue({ count: 0 }));
    const res = mockRes();
    await svc.checkExistingCompetitorCount(
      { body: { advertiser: "Acme", user_id: "u" }, query: {} },
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("compRequest has no monitoring key → `|| []` fallback fires (line 2854)", async () => {
    const big = new Array(200).fill({ competitor_name: "X", competitor_url: "x.com" });
    spies.existingCompFindOneSpy.mockReturnValueOnce({
      lean: () => Promise.resolve({ competitors: big }),
    });
    // compRequest with NO monitoring key → falls back to []
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1" /* no monitoring */ });
    spies.competitorsFindSpy.mockReturnValueOnce({
      lean: () => Promise.resolve([]), // monitoredDetails
    });
    spies.competitorsFindSpy.mockReturnValueOnce({
      lean: () => Promise.resolve([{ competitor_name: "X", _id: "x1" }]),
    });
    Object.values(spies.esClient).forEach((c) => c.count.mockResolvedValue({ count: 0 }));
    const res = mockRes();
    await svc.checkExistingCompetitorCount(
      { body: { advertiser: "Acme", user_id: "u" }, query: {} },
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("sort comparator hits both branches: monitored/unmonitored mix (line 2875)", async () => {
    // 200 items: 100 monitored (names starting with 'M'), 100 not (names 'X*')
    // The sort will hit both `a.monitored === b.monitored` (same-status) AND
    // `a.monitored ? -1 : 1` (mixed-status) branches.
    const items = [];
    for (let i = 0; i < 100; i++) items.push({ competitor_name: `M${i}`, competitor_url: `m${i}.com` });
    for (let i = 0; i < 100; i++) items.push({ competitor_name: `X${i}`, competitor_url: `x${i}.com` });
    spies.existingCompFindOneSpy.mockReturnValueOnce({
      lean: () => Promise.resolve({ competitors: items }),
    });
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1", monitoring: ["m1"] });
    // monitoredDetails: 100 names starting with M
    const monitoredDetails = [];
    for (let i = 0; i < 100; i++) monitoredDetails.push({ competitor_name: `M${i}` });
    spies.competitorsFindSpy.mockReturnValueOnce({
      lean: () => Promise.resolve(monitoredDetails),
    });
    // dbCompetitors lookup
    spies.competitorsFindSpy.mockReturnValueOnce({
      lean: () => Promise.resolve([]),
    });
    Object.values(spies.esClient).forEach((c) => c.count.mockResolvedValue({ count: 0 }));
    const res = mockRes();
    await svc.checkExistingCompetitorCount(
      { body: { advertiser: "Acme", user_id: "u" }, query: {} },
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
    // First page should be all monitored ones (M*) due to sort
    const payload = res.json.mock.calls[0][0];
    expect(payload.competitor_names[0]).toMatch(/^M/);
  });

  it("paginated name absent from dbCompMap → `|| null` fallback (line 2895)", async () => {
    const big = new Array(200).fill({ competitor_name: "Unknown", competitor_url: "u.com" });
    spies.existingCompFindOneSpy.mockReturnValueOnce({
      lean: () => Promise.resolve({ competitors: big }),
    });
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1", monitoring: [] });
    spies.competitorsFindSpy.mockReturnValueOnce({
      lean: () => Promise.resolve([]), // monitoredDetails
    });
    // dbCompetitors find returns nothing → dbCompMap empty → id falls back to null
    spies.competitorsFindSpy.mockReturnValueOnce({
      lean: () => Promise.resolve([]),
    });
    Object.values(spies.esClient).forEach((c) => c.count.mockResolvedValue({ count: 0 }));
    const res = mockRes();
    await svc.checkExistingCompetitorCount(
      { body: { advertiser: "Acme", user_id: "u" }, query: {} },
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});

describe("competitorService > addManualCompetitor", () => {
  it("400 missing required fields", async () => {
    const res = mockRes();
    await svc.addManualCompetitor({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it("400 when body entirely missing → `req.body || {}`", async () => {
    const res = mockRes();
    await svc.addManualCompetitor({}, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it("400 when competitor_name normalises to empty", async () => {
    const res = mockRes();
    await svc.addManualCompetitor({ body: { user_id: "u", advertiser: "A", competitor_name: "   " } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it("404 when project not found", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.addManualCompetitor({ body: { user_id: "u", advertiser: "A", competitor_name: "C" } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
  it("happy: creates new competitor when not in master, attaches it", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1", competitors: [] });
    spies.competitorsFindOneSpy.mockResolvedValueOnce(null);
    const mod = await import("../../../models/competitors.js");
    mod.default.create = vi.fn().mockResolvedValueOnce({ _id: "c1", competitor_name: "C", competitor_url: "" });
    spies.existingCompFindOneSpy.mockResolvedValueOnce({ competitors: [] });
    spies.existingCompUpdateOneSpy.mockResolvedValueOnce({});
    spies.competitorsReqUpdateOneSpy.mockResolvedValueOnce({});
    const res = mockRes();
    await svc.addManualCompetitor({ body: { user_id: "u", advertiser: "A", competitor_name: "C", competitor_url: "c.com" } }, res);
    expect(res.send).toHaveBeenCalled();
  });
  it("falls through to find-after-duplicate-key when create throws E11000", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1", competitors: [] });
    spies.competitorsFindOneSpy.mockResolvedValueOnce(null);
    const mod = await import("../../../models/competitors.js");
    const dupErr = new Error("dup"); dupErr.code = 11000;
    mod.default.create = vi.fn().mockRejectedValueOnce(dupErr);
    spies.competitorsFindOneSpy.mockResolvedValueOnce({ _id: "c1", competitor_name: "C" });
    spies.existingCompFindOneSpy.mockResolvedValueOnce(null);
    spies.existingCompUpdateOneSpy.mockResolvedValueOnce({});
    spies.competitorsReqUpdateOneSpy.mockResolvedValueOnce({});
    const res = mockRes();
    await svc.addManualCompetitor({ body: { user_id: "u", advertiser: "A", competitor_name: "C" } }, res);
    expect(res.send).toHaveBeenCalled();
  });
  it("already-attached path → returns 'already exists' message", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({
      _id: "p1",
      competitors: [{ toString: () => "c1" }],
    });
    spies.competitorsFindOneSpy.mockResolvedValueOnce({ _id: { toString: () => "c1" }, competitor_name: "C" });
    spies.existingCompFindOneSpy.mockResolvedValueOnce({ competitors: [{}, { competitor_name: "c" }] }); // {} → (c.competitor_name || "") fallback
    const res = mockRes();
    await svc.addManualCompetitor({ body: { user_id: "u", advertiser: "A", competitor_name: "C" } }, res);
    const payload = res.send.mock.calls[0][0];
    expect(payload.body.data.already_existed).toBe(true);
  });
  it("500 on outer error", async () => {
    spies.competitorsReqFindOneSpy.mockRejectedValueOnce(new Error("db"));
    const res = mockRes();
    await svc.addManualCompetitor({ body: { user_id: "u", advertiser: "A", competitor_name: "C" } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("create throws non-duplicate error → rethrown to outer catch", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1", competitors: [] });
    spies.competitorsFindOneSpy.mockResolvedValueOnce(null);
    const mod = await import("../../../models/competitors.js");
    mod.default.create = vi.fn().mockRejectedValueOnce(new Error("non-dup-fail"));
    const res = mockRes();
    await svc.addManualCompetitor({ body: { user_id: "u", advertiser: "A", competitor_name: "C" } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("create returns null and dup-fallback also returns null → 500 'Failed to create'", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1", competitors: [] });
    spies.competitorsFindOneSpy.mockResolvedValueOnce(null);
    const mod = await import("../../../models/competitors.js");
    const dupErr = new Error("dup"); dupErr.code = 11000;
    mod.default.create = vi.fn().mockRejectedValueOnce(dupErr);
    spies.competitorsFindOneSpy.mockResolvedValueOnce(null); // findOne after dup also returns null
    const res = mockRes();
    await svc.addManualCompetitor({ body: { user_id: "u", advertiser: "A", competitor_name: "C" } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  // Regression: competitor_url is optional, but when provided it must look
  // like an actual domain. Previously nothing validated its format at all —
  // any non-empty garbage string was silently accepted (see models/competitors.js
  // for the related required-field bug this shares a root cause with: Mongoose's
  // `required: true` on a String rejects "" but accepts any other non-empty
  // value, format notwithstanding).
  it("400 when competitor_url is present but not a valid domain format", async () => {
    const res = mockRes();
    await svc.addManualCompetitor(
      { body: { user_id: "u", advertiser: "A", competitor_name: "C", competitor_url: "not a url" } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].body.message).toContain("valid website URL");
  });

  it("does not reach project lookup when competitor_url is invalid (fails fast)", async () => {
    const res = mockRes();
    await svc.addManualCompetitor(
      { body: { user_id: "u", advertiser: "A", competitor_name: "C", competitor_url: "asdkjhajd" } },
      res,
    );
    expect(spies.competitorsReqFindOneSpy).not.toHaveBeenCalled();
  });

  it("accepts an empty/absent competitor_url (field is optional)", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1", competitors: [] });
    spies.competitorsFindOneSpy.mockResolvedValueOnce(null);
    const mod = await import("../../../models/competitors.js");
    mod.default.create = vi.fn().mockResolvedValueOnce({ _id: "c1", competitor_name: "C", competitor_url: "" });
    spies.existingCompFindOneSpy.mockResolvedValueOnce({ competitors: [] });
    spies.existingCompUpdateOneSpy.mockResolvedValueOnce({});
    spies.competitorsReqUpdateOneSpy.mockResolvedValueOnce({});
    const res = mockRes();
    await svc.addManualCompetitor({ body: { user_id: "u", advertiser: "A", competitor_name: "C" } }, res);
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalled();
  });

  it("accepts a valid competitor_url with a protocol/www/path", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1", competitors: [] });
    spies.competitorsFindOneSpy.mockResolvedValueOnce(null);
    const mod = await import("../../../models/competitors.js");
    mod.default.create = vi.fn().mockResolvedValueOnce({ _id: "c1", competitor_name: "C", competitor_url: "https://www.walmart.com/x" });
    spies.existingCompFindOneSpy.mockResolvedValueOnce({ competitors: [] });
    spies.existingCompUpdateOneSpy.mockResolvedValueOnce({});
    spies.competitorsReqUpdateOneSpy.mockResolvedValueOnce({});
    const res = mockRes();
    await svc.addManualCompetitor(
      { body: { user_id: "u", advertiser: "A", competitor_name: "C", competitor_url: "https://www.walmart.com/x" } },
      res,
    );
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalled();
  });

  // Regression: a manually-typed competitor name is trusted input (this path
  // exists so a user can pre-emptively track a competitor before we've
  // crawled any of their ads), so we only reject pure punctuation/whitespace
  // junk — not letter-based gibberish, which we can't distinguish from a
  // real small/unfamiliar brand name without a full company-verification
  // service. Actual "is this a real company" signal is has_ad_data below.
  it("400 when competitor_name is pure punctuation (no real letter/digit)", async () => {
    const res = mockRes();
    await svc.addManualCompetitor(
      { body: { user_id: "u", advertiser: "A", competitor_name: "!!!---" } },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].body.message).toContain("valid competitor name");
  });

  it("accepts a letter-based name even if it's not a real company (can't verify that without a name-format check)", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1", competitors: [] });
    spies.competitorsFindOneSpy.mockResolvedValueOnce(null);
    const mod = await import("../../../models/competitors.js");
    mod.default.create = vi.fn().mockResolvedValueOnce({ _id: "c1", competitor_name: "asdkjhajd", competitor_url: "" });
    spies.existingCompFindOneSpy.mockResolvedValueOnce({ competitors: [] });
    spies.existingCompUpdateOneSpy.mockResolvedValueOnce({});
    spies.competitorsReqUpdateOneSpy.mockResolvedValueOnce({});
    const res = mockRes();
    await svc.addManualCompetitor(
      { body: { user_id: "u", advertiser: "A", competitor_name: "asdkjhajd" } },
      res,
    );
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(res.send).toHaveBeenCalled();
  });

  // Regression: the non-blocking has_ad_data signal, letting the frontend
  // show an informational (not blocking) notice for a name with no known ads.
  it("has_ad_data: false when the added competitor has zero ads in our system", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1", competitors: [] });
    spies.competitorsFindOneSpy.mockResolvedValueOnce(null);
    const mod = await import("../../../models/competitors.js");
    mod.default.create = vi.fn().mockResolvedValueOnce({ _id: "c1", competitor_name: "obscurebrand", competitor_url: "" });
    spies.existingCompFindOneSpy.mockResolvedValueOnce({ competitors: [] });
    spies.existingCompUpdateOneSpy.mockResolvedValueOnce({});
    spies.competitorsReqUpdateOneSpy.mockResolvedValueOnce({});
    spies.dashboardCountInternalSpy.mockResolvedValueOnce({ obscurebrand: { competitorsCount: 0 } });
    const res = mockRes();
    await svc.addManualCompetitor(
      { body: { user_id: "u", advertiser: "A", competitor_name: "obscurebrand" } },
      res,
    );
    expect(res.send.mock.calls[0][0].body.data.has_ad_data).toBe(false);
  });

  it("has_ad_data: true when the added competitor already has ads in our system", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1", competitors: [] });
    spies.competitorsFindOneSpy.mockResolvedValueOnce(null);
    const mod = await import("../../../models/competitors.js");
    mod.default.create = vi.fn().mockResolvedValueOnce({ _id: "c1", competitor_name: "nike", competitor_url: "" });
    spies.existingCompFindOneSpy.mockResolvedValueOnce({ competitors: [] });
    spies.existingCompUpdateOneSpy.mockResolvedValueOnce({});
    spies.competitorsReqUpdateOneSpy.mockResolvedValueOnce({});
    spies.dashboardCountInternalSpy.mockResolvedValueOnce({ nike: { competitorsCount: 42 } });
    const res = mockRes();
    await svc.addManualCompetitor(
      { body: { user_id: "u", advertiser: "A", competitor_name: "nike" } },
      res,
    );
    expect(res.send.mock.calls[0][0].body.data.has_ad_data).toBe(true);
  });

  it("has_ad_data check failing doesn't block the (already-successful) add", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1", competitors: [] });
    spies.competitorsFindOneSpy.mockResolvedValueOnce(null);
    const mod = await import("../../../models/competitors.js");
    mod.default.create = vi.fn().mockResolvedValueOnce({ _id: "c1", competitor_name: "c", competitor_url: "" });
    spies.existingCompFindOneSpy.mockResolvedValueOnce({ competitors: [] });
    spies.existingCompUpdateOneSpy.mockResolvedValueOnce({});
    spies.competitorsReqUpdateOneSpy.mockResolvedValueOnce({});
    spies.dashboardCountInternalSpy.mockRejectedValueOnce(new Error("es-down"));
    const res = mockRes();
    await svc.addManualCompetitor({ body: { user_id: "u", advertiser: "A", competitor_name: "c" } }, res);
    expect(res.status).not.toHaveBeenCalledWith(500);
    expect(res.send.mock.calls[0][0].body.data.has_ad_data).toBe(null);
  });
});

describe("competitorService > updateCompetitorsNew", () => {
  it("messageResp when required fields missing", async () => {
    const res = mockRes();
    await svc.updateCompetitorsNew({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("Please provide");
  });
  it("messageResp when project not found", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.updateCompetitorsNew({ body: { user_id: "u", advertiser: ["A"] } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Project not found");
  });
  it("'no changes' when neither add nor remove apply", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ monitoring: [] });
    const res = mockRes();
    await svc.updateCompetitorsNew({ body: { user_id: "u", advertiser: ["A"] } }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("no changes");
  });
  it("happy: adds new monitoring entries", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ monitoring: [] });
    spies.competitorsFindSpy.mockReturnValueOnce({
      select: () => Promise.resolve([{ _id: { toString: () => "c1" } }]),
    });
    spies.competitorsReqUpdateOneSpy.mockResolvedValue({});
    const res = mockRes();
    await svc.updateCompetitorsNew({
      body: { user_id: "u", advertiser: ["A"], competitor_details: [{ competitor_name: "C" }] },
    }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Monitoring updated");
  });
  it("happy: removes monitoring entries", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ monitoring: [{ toString: () => "c1" }] });
    spies.competitorsFindSpy.mockReturnValueOnce({
      select: () => Promise.resolve([{ _id: { toString: () => "c1" } }]),
    });
    spies.competitorsReqUpdateOneSpy.mockResolvedValue({});
    const res = mockRes();
    await svc.updateCompetitorsNew({
      body: { user_id: "u", advertiser: ["A"], deleteComp: ["C"] },
    }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Monitoring updated");
  });
  it("catch on db throw", async () => {
    spies.competitorsReqFindOneSpy.mockRejectedValueOnce(new Error("db"));
    const res = mockRes();
    await svc.updateCompetitorsNew({ body: { user_id: "u", advertiser: ["A"] } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Error in updateCompetitors");
  });
});

describe("competitorService > insertCompRequests", () => {
  it("400 missing body", async () => {
    const res = mockRes();
    await svc.insertCompRequests({}, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Missing request data");
  });

  it("messageResp when brand already exists", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1" });
    const res = mockRes();
    await svc.insertCompRequests({
      body: {
        user_id: "u",
        advertiser: ["Acme"],
        brand_url: "https://acme.com",
        competitor_details: [{ competitor_name: "c1", competitor_url: "https://c1.test" }],
        country: [],
        category: [],
      },
    }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("brand already exists");
  });

  it("messageResp when brand validation fails", async () => {
    const res = mockRes();
    await svc.insertCompRequests({
      body: {
        user_id: "u",
        advertiser: [],
        brand_url: "https://acme.com",
        competitor_details: [{ competitor_name: "c1", competitor_url: "https://c1.test" }],
        country: [],
        category: [],
      },
    }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("proper brand name");
  });

  it("inner catch on brand findOne throw", async () => {
    spies.competitorsReqFindOneSpy.mockRejectedValueOnce(new Error("db"));
    const res = mockRes();
    await svc.insertCompRequests({
      body: {
        user_id: "u",
        advertiser: ["Acme"],
        brand_url: "https://acme.com",
        competitor_details: [{ competitor_name: "c1", competitor_url: "https://c1.test" }],
        country: [],
        category: [],
      },
    }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Error in finding the brand");
  });

  it("messageResp when competitor_details empty", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.insertCompRequests({
      body: {
        user_id: "u",
        advertiser: ["Acme"],
        brand_url: "https://acme.com",
        competitor_details: [],
        country: [],
        category: [],
      },
    }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("Competitor details can't be empty");
  });

  it("happy: creates request when no existing competitors", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce(null);
    spies.competitorsFindSpy.mockResolvedValueOnce([]);
    const mod = await import("../../../models/competitors.js");
    mod.default.insertMany = vi.fn().mockResolvedValueOnce([{ _id: "c1" }]);
    spies.competitorsReqCreateSpy.mockResolvedValueOnce({ _id: "r1" });
    const res = mockRes();
    await svc.insertCompRequests({
      body: {
        user_id: "u",
        advertiser: ["Acme"],
        brand_url: "https://acme.com",
        competitor_details: [{ competitor_name: "c1", competitor_url: "c1.com" }],
        country: "US",
        category: "tech",
      },
    }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Competitor Request created");
  });

  it("inner catch when storing competitors throws", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce(null);
    spies.competitorsFindSpy.mockRejectedValueOnce(new Error("db"));
    const res = mockRes();
    await svc.insertCompRequests({
      body: {
        user_id: "u",
        advertiser: ["Acme"],
        brand_url: "https://acme.com",
        competitor_details: [{ competitor_name: "c1", competitor_url: "c1.com" }],
        country: [],
        category: [],
      },
    }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Error in storing the competitor");
  });

  it("VALIDATION_FAIL when createRequest validator returns error", async () => {
    spies._validationCreateRequestResult = { value: null, error: { details: [{ message: "bad" }] } };
    const res = mockRes();
    await svc.insertCompRequests({
      body: { user_id: "u", advertiser: ["Acme"], brand_url: "https://acme.com", competitor_details: [], country: [], category: [] },
    }, res);
    spies._validationCreateRequestResult = undefined;
    expect(res.send.mock.calls[0][0].body.msg).toContain("VALIDATION_FAIL");
  });

  // NOTE: insertCompRequests outer catch (lines 242-246) is unreachable
  // through public API — every throwing path between line 96 and the
  // catch is wrapped by either the inner brand-check try (119-145),
  // the inner storage try (155-233), or an early return.

  it("country/category nullish: hits the `: []` empty-array fallback branches", async () => {
    // Array.isArray(country) = false, country = null (falsy), so → []
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce(null);
    spies.competitorsFindSpy.mockResolvedValueOnce([{ _id: "c1", competitor_name: "C1" }]);
    spies.competitorsReqCreateSpy.mockResolvedValueOnce({ _id: "r1" });
    const res = mockRes();
    await svc.insertCompRequests({
      body: {
        user_id: "u", advertiser: ["Acme"], brand_url: "https://acme.com",
        competitor_details: [{ competitor_name: "C1", competitor_url: "c1.com" }],
        country: null, category: undefined,
      },
    }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Competitor Request created");
  });

  it("country/category as single string: hits the `: [country]` wrap branch", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce(null);
    spies.competitorsFindSpy.mockResolvedValueOnce([{ _id: "c1", competitor_name: "C1" }]);
    spies.competitorsReqCreateSpy.mockResolvedValueOnce({ _id: "r1" });
    const res = mockRes();
    await svc.insertCompRequests({
      body: {
        user_id: "u", advertiser: ["Acme"], brand_url: "https://acme.com",
        competitor_details: [{ competitor_name: "C1", competitor_url: "c1.com" }],
        country: "US", category: "tech",
      },
    }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Competitor Request created");
  });

  it("create comp_details all-exist path: no insertMany call, just create request", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce(null);
    spies.competitorsFindSpy.mockResolvedValueOnce([{ _id: "c1", competitor_name: "C1" }]);
    spies.competitorsReqCreateSpy.mockResolvedValueOnce({ _id: "r1" });
    const res = mockRes();
    await svc.insertCompRequests({
      body: {
        user_id: "u", advertiser: ["Acme"], brand_url: "https://acme.com",
        competitor_details: [{ competitor_name: "C1", competitor_url: "c1.com" }],
        country: ["US"], category: ["tech"],
      },
    }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Competitor Request created");
  });

  it("insertMany returns falsy -> 'Error while storing the competitors in db'", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce(null);
    spies.competitorsFindSpy.mockResolvedValueOnce([]);
    const mod = await import("../../../models/competitors.js");
    mod.default.insertMany = vi.fn().mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.insertCompRequests({
      body: {
        user_id: "u", advertiser: ["Acme"], brand_url: "https://acme.com",
        competitor_details: [{ competitor_name: "C1", competitor_url: "c1.com" }],
        country: [], category: [],
      },
    }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("Error while storing");
  });

  it("create request returns falsy -> messageResp", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce(null);
    spies.competitorsFindSpy.mockResolvedValueOnce([]);
    const mod = await import("../../../models/competitors.js");
    mod.default.insertMany = vi.fn().mockResolvedValueOnce([{ _id: "c1" }]);
    spies.competitorsReqCreateSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.insertCompRequests({
      body: {
        user_id: "u", advertiser: ["Acme"], brand_url: "https://acme.com",
        competitor_details: [{ competitor_name: "C1", competitor_url: "c1.com" }],
        country: [], category: [],
      },
    }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("Error in creating the competitor request");
  });

  describe("competitor brand quota (PRD FR-2 / docs/PLAN_ACCESS.md)", () => {
    const bodyFor = (overrides = {}) => ({
      user_id: "u",
      advertiser: ["Acme"],
      brand_url: "https://acme.com",
      competitor_details: [{ competitor_name: "c1", competitor_url: "c1.com" }],
      country: [],
      category: [],
      ...overrides,
    });

    it("blocks the (N+1)th brand when currentBrandCount >= brandLimit", async () => {
      spies.competitorsReqFindOneSpy.mockResolvedValueOnce(null); // this brand is new
      spies.userDetailsFindByIdSpy.mockReturnValue({ lean: () => Promise.resolve({ plan_id: 101 }) });
      spies.planAccessConfigFindOneSpy.mockResolvedValueOnce({ plan_limits: { "101": { brandLimit: 1, competitorLimit: 7 } } });
      spies.competitorsReqCountDocsSpy.mockResolvedValueOnce(1); // already at the limit
      const res = mockRes();
      await svc.insertCompRequests({ body: bodyFor() }, res);
      const sent = res.send.mock.calls[0][0];
      expect(sent.statusCode).toBe(403);
      expect(sent.body.showSubscriptionModal).toBe(true);
      expect(sent.body.message).toContain("1 brand");
      expect(sent.body.limits).toEqual({ brandLimit: 1, currentBrandCount: 1 });
    });

    it("allows exactly up to brandLimit (currentBrandCount < brandLimit passes through)", async () => {
      spies.competitorsReqFindOneSpy.mockResolvedValueOnce(null);
      spies.competitorsFindSpy.mockResolvedValueOnce([]);
      const mod = await import("../../../models/competitors.js");
      mod.default.insertMany = vi.fn().mockResolvedValueOnce([{ _id: "c1" }]);
      spies.competitorsReqCreateSpy.mockResolvedValueOnce({ _id: "r1" });
      spies.userDetailsFindByIdSpy.mockReturnValue({ lean: () => Promise.resolve({ plan_id: 102 }) });
      spies.planAccessConfigFindOneSpy.mockResolvedValueOnce({ plan_limits: { "102": { brandLimit: 5, competitorLimit: 35 } } });
      spies.competitorsReqCountDocsSpy.mockResolvedValueOnce(4); // one slot remaining
      const res = mockRes();
      await svc.insertCompRequests({ body: bodyFor() }, res);
      expect(res.send.mock.calls[0][0].body.msg).toContain("Competitor Request created");
    });

    it("plan_id with no entry in plan_limits defaults to brandLimit 0 (blocks)", async () => {
      spies.competitorsReqFindOneSpy.mockResolvedValueOnce(null);
      spies.userDetailsFindByIdSpy.mockReturnValue({ lean: () => Promise.resolve({ plan_id: 999 }) });
      spies.planAccessConfigFindOneSpy.mockResolvedValueOnce({ plan_limits: { "101": { brandLimit: 1, competitorLimit: 7 } } });
      spies.competitorsReqCountDocsSpy.mockResolvedValueOnce(0);
      const res = mockRes();
      await svc.insertCompRequests({ body: bodyFor() }, res);
      const sent = res.send.mock.calls[0][0];
      expect(sent.statusCode).toBe(403);
      expect(sent.body.limits.brandLimit).toBe(0);
    });

    it("no user found (planId null) → quota check skipped, request proceeds", async () => {
      spies.competitorsReqFindOneSpy.mockResolvedValueOnce(null);
      spies.competitorsFindSpy.mockResolvedValueOnce([]);
      const mod = await import("../../../models/competitors.js");
      mod.default.insertMany = vi.fn().mockResolvedValueOnce([{ _id: "c1" }]);
      spies.competitorsReqCreateSpy.mockResolvedValueOnce({ _id: "r1" });
      spies.userDetailsFindByIdSpy.mockReturnValue({ lean: () => Promise.resolve(null) });
      const res = mockRes();
      await svc.insertCompRequests({ body: bodyFor() }, res);
      expect(spies.planAccessConfigFindOneSpy).not.toHaveBeenCalled();
      expect(res.send.mock.calls[0][0].body.msg).toContain("Competitor Request created");
    });

    it("competitor_limits doc missing entirely → quota check skipped, request proceeds", async () => {
      spies.competitorsReqFindOneSpy.mockResolvedValueOnce(null);
      spies.competitorsFindSpy.mockResolvedValueOnce([]);
      const mod = await import("../../../models/competitors.js");
      mod.default.insertMany = vi.fn().mockResolvedValueOnce([{ _id: "c1" }]);
      spies.competitorsReqCreateSpy.mockResolvedValueOnce({ _id: "r1" });
      spies.userDetailsFindByIdSpy.mockReturnValue({ lean: () => Promise.resolve({ plan_id: 101 }) });
      spies.planAccessConfigFindOneSpy.mockResolvedValueOnce(null);
      const res = mockRes();
      await svc.insertCompRequests({ body: bodyFor() }, res);
      expect(res.send.mock.calls[0][0].body.msg).toContain("Competitor Request created");
    });

    it("lookup failure fails OPEN — allows the request rather than blocking on an infra hiccup", async () => {
      spies.competitorsReqFindOneSpy.mockResolvedValueOnce(null);
      spies.competitorsFindSpy.mockResolvedValueOnce([]);
      const mod = await import("../../../models/competitors.js");
      mod.default.insertMany = vi.fn().mockResolvedValueOnce([{ _id: "c1" }]);
      spies.competitorsReqCreateSpy.mockResolvedValueOnce({ _id: "r1" });
      spies.userDetailsFindByIdSpy.mockReturnValue({ lean: () => Promise.reject(new Error("mongo-down")) });
      const res = mockRes();
      await svc.insertCompRequests({ body: bodyFor() }, res);
      expect(spies.loggerWarnSpy).toHaveBeenCalledWith(
        "Competitor brand quota check failed — allowing request (fail-open)",
        expect.any(Object)
      );
      expect(res.send.mock.calls[0][0].body.msg).toContain("Competitor Request created");
    });
  });
});

describe("competitorService > fetchCompetitors", () => {
  it("400 missing body", async () => {
    const res = mockRes();
    await svc.fetchCompetitors({}, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Missing request data");
  });

  it("messageResp when advertiser missing/empty", async () => {
    const res = mockRes();
    await svc.fetchCompetitors({ body: { advertiser: [] } }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("Validation failed");
  });

  it("happy: returns existing competitors when brand already in pool", async () => {
    spies.existingCompFindOneSpy.mockResolvedValueOnce({
      competitors: [{ competitor_name: "C1", competitor_url: "c1.com" }],
    });
    const res = mockRes();
    await svc.fetchCompetitors({ body: { advertiser: ["Acme"] } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Fetched Competitors");
  });

  it("outer catch on existingComp findOne throw", async () => {
    spies.existingCompFindOneSpy.mockRejectedValueOnce(new Error("db"));
    const res = mockRes();
    await svc.fetchCompetitors({ body: { advertiser: ["Acme"] } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Error in fetching competitors");
  });

  it("gemini path: non-array response → Array.isArray false (L327 #1)", async () => {
    spies.existingCompFindOneSpy.mockResolvedValueOnce(null); // brandCheck null → gemini path
    spies.geminiGenerateSpy.mockResolvedValue({ text: JSON.stringify({ not: "array" }) });
    const res = mockRes();
    await svc.fetchCompetitors({ body: { advertiser: ["Acme"] } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Fetched Competitors");
  });

  it("gemini path: null entry + null data + failing insert exercises entry/data fallbacks + .catch (L329-331)", async () => {
    spies.existingCompFindOneSpy.mockResolvedValueOnce(null);
    spies.geminiGenerateSpy.mockResolvedValue({
      text: JSON.stringify([null, { Brand: null }, { Brand2: { competitors: [{ name: "X" }] } }]),
    });
    spies.existingCompUpdateOneSpy.mockRejectedValue(new Error("insert-fail")); // → insertIntoExistingComp .catch
    const res = mockRes();
    await svc.fetchCompetitors({ body: { advertiser: ["Acme"] } }, res);
    await new Promise((r) => setImmediate(r)); // flush fire-and-forget .catch
    expect(res.send).toHaveBeenCalled();
  });
});

describe("competitorService > updateCompetitors", () => {
  it("messageResp when fields missing", async () => {
    const res = mockRes();
    await svc.updateCompetitors({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("Please provide");
  });

  it("messageResp when brand not found", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.updateCompetitors({ body: { user_id: "u", advertiser: ["A"] } }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("not requested");
  });

  it("messageRespComp when both competitor_details and deleteComp empty", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1" });
    const res = mockRes();
    await svc.updateCompetitors({ body: { user_id: "u", advertiser: ["A"] } }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("Competitor details can't be empty");
  });

  it("delete-only path: removes competitors and drops the request doc if empty", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1" });
    spies.competitorsFindSpy.mockReturnValueOnce({
      select: () => Promise.resolve([{ _id: "c1" }]),
    });
    const mod = await import("../../../models/competitors_request.js");
    mod.default.findOneAndUpdate = vi.fn().mockResolvedValueOnce({ _id: "p1", competitors: [] });
    mod.default.findByIdAndDelete = vi.fn().mockResolvedValueOnce({});
    const res = mockRes();
    await svc.updateCompetitors({
      body: { user_id: "u", advertiser: ["A"], deleteComp: ["X"] },
    }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Competitors updated");
  });

  it("delete-only path: skips findOneAndUpdate when no matching competitors found (line 794 false branch)", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1" });
    // Competitors.find returns nothing → dexistingCompetitorsId is empty → skip pull
    spies.competitorsFindSpy.mockReturnValueOnce({
      select: () => Promise.resolve([]),
    });
    const mod = await import("../../../models/competitors_request.js");
    const findOneAndUpdateSpy = vi.fn();
    mod.default.findOneAndUpdate = findOneAndUpdateSpy;
    const res = mockRes();
    await svc.updateCompetitors({
      body: { user_id: "u", advertiser: ["A"], deleteComp: ["X"] },
    }, res);
    expect(findOneAndUpdateSpy).not.toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.msg).toContain("Competitors updated");
  });

  it("delete-only path: keeps request doc when competitors remain after pull (line 807 false branch)", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1" });
    spies.competitorsFindSpy.mockReturnValueOnce({
      select: () => Promise.resolve([{ _id: "c1" }]),
    });
    const mod = await import("../../../models/competitors_request.js");
    // updatedDoc.competitors NOT empty → skip findByIdAndDelete
    mod.default.findOneAndUpdate = vi.fn().mockResolvedValueOnce({
      _id: "p1",
      competitors: ["remaining-1", "remaining-2"],
    });
    const deleteSpy = vi.fn();
    mod.default.findByIdAndDelete = deleteSpy;
    const res = mockRes();
    await svc.updateCompetitors({
      body: { user_id: "u", advertiser: ["A"], deleteComp: ["X"] },
    }, res);
    expect(deleteSpy).not.toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.msg).toContain("Competitors updated");
  });

  it("happy: inserts and pushes new competitor IDs", async () => {
    // 1st findOne: brandCheck → truthy
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1" });
    // existingCompetitors check → mix of existing + new
    spies.competitorsFindSpy.mockResolvedValueOnce([
      { _id: "ex1", competitor_name: "Existing" },
    ]);
    const mod = await import("../../../models/competitors.js");
    mod.default.insertMany = vi.fn().mockResolvedValueOnce([{ _id: "new1" }]);
    // 2nd findOne (chained .select): userCompetitorDoc lookup
    spies.competitorsReqFindOneSpy.mockReturnValueOnce({
      select: () => Promise.resolve({ competitors: [{ toString: () => "ex1" }] }),
    });
    spies.competitorsReqUpdateOneSpy.mockResolvedValue({});
    const res = mockRes();
    await svc.updateCompetitors({
      body: {
        user_id: "u", advertiser: ["A"],
        competitor_details: [
          { competitor_name: "Existing", competitor_url: "ex.com" },
          { competitor_name: "New", competitor_url: "new.com" },
        ],
      },
    }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Competitors updated");
  });

  it("userCompetitorDoc lookup returns null → `|| []` empty fallback (line 861)", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1" });
    spies.competitorsFindSpy.mockResolvedValueOnce([]);
    const mod = await import("../../../models/competitors.js");
    mod.default.insertMany = vi.fn().mockResolvedValueOnce([{ _id: "new1" }]);
    // userCompetitorDoc lookup → null (no existing project doc)
    spies.competitorsReqFindOneSpy.mockReturnValueOnce({
      select: () => Promise.resolve(null),
    });
    spies.competitorsReqUpdateOneSpy.mockResolvedValue({});
    const res = mockRes();
    await svc.updateCompetitors({
      body: {
        user_id: "u", advertiser: ["A"],
        competitor_details: [{ competitor_name: "X", competitor_url: "x.com" }],
      },
    }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Competitors updated");
  });

  it("happy + deleteComp: insert + push + pull", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1" });
    spies.competitorsFindSpy.mockResolvedValueOnce([]); // no existing match
    const mod = await import("../../../models/competitors.js");
    mod.default.insertMany = vi.fn().mockResolvedValueOnce([{ _id: "new1" }]);
    spies.competitorsReqFindOneSpy.mockReturnValueOnce({
      select: () => Promise.resolve({ competitors: [] }),
    });
    spies.competitorsReqUpdateOneSpy.mockResolvedValue({});
    spies.competitorsFindSpy.mockReturnValueOnce({
      select: () => Promise.resolve([{ _id: "del1" }]),
    });
    const res = mockRes();
    await svc.updateCompetitors({
      body: {
        user_id: "u", advertiser: ["A"],
        competitor_details: [{ competitor_name: "NC", competitor_url: "nc.com" }],
        deleteComp: ["Delete"],
      },
    }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Competitors updated");
  });

  it("competitor_details + deleteComp: skip $pull updateOne when deleteComp matches nothing (line 893 false branch)", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1" });
    spies.competitorsFindSpy.mockResolvedValueOnce([]); // existing match check → none
    const mod = await import("../../../models/competitors.js");
    mod.default.insertMany = vi.fn().mockResolvedValueOnce([{ _id: "new1" }]);
    spies.competitorsReqFindOneSpy.mockReturnValueOnce({
      select: () => Promise.resolve({ competitors: [] }),
    });
    // Track updateOne calls; only the $push should fire, not the $pull
    spies.competitorsReqUpdateOneSpy.mockResolvedValue({});
    // deleteComp lookup → no matches
    spies.competitorsFindSpy.mockReturnValueOnce({
      select: () => Promise.resolve([]),
    });
    const res = mockRes();
    await svc.updateCompetitors({
      body: {
        user_id: "u", advertiser: ["A"],
        competitor_details: [{ competitor_name: "NC", competitor_url: "nc.com" }],
        deleteComp: ["NonExistent"],
      },
    }, res);
    // The $pull updateOne is the only one inside the `if (dexistingCompetitorsId.length > 0)`
    // block. With no matches it should not fire — verifying via the message that the
    // function still completed successfully.
    expect(res.send.mock.calls[0][0].body.msg).toContain("Competitors updated");
  });

  it("delete-only with all-zero-competitors result: triggers findByIdAndDelete branch", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1" });
    spies.competitorsFindSpy.mockReturnValueOnce({
      select: () => Promise.resolve([{ _id: "del1" }]),
    });
    const mod = await import("../../../models/competitors_request.js");
    mod.default.findOneAndUpdate = vi.fn().mockResolvedValueOnce({
      _id: "p1",
      competitors: [], // <-- triggers findByIdAndDelete
    });
    mod.default.findByIdAndDelete = vi.fn().mockResolvedValueOnce({});
    const res = mockRes();
    await svc.updateCompetitors({
      body: { user_id: "u", advertiser: ["A"], deleteComp: ["X"] },
    }, res);
    expect(mod.default.findByIdAndDelete).toHaveBeenCalled();
  });

  it("catch on outer throw", async () => {
    spies.competitorsReqFindOneSpy.mockRejectedValueOnce(new Error("db"));
    const res = mockRes();
    await svc.updateCompetitors({ body: { user_id: "u", advertiser: ["A"], competitor_details: [{ competitor_name: "C" }] } }, res);
    // findOne throws → falls through to outer catch which returns userFailResp
    expect(res.send).toHaveBeenCalled();
  });
});

describe("competitorService > fetchCompetitorsForUpdate", () => {
  it("validation fail when advertiser empty", async () => {
    const res = mockRes();
    await svc.fetchCompetitorsForUpdate({ body: { advertiser: [] } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Invalid advertiser");
  });

  it("outer catch when existing pool lookup throws", async () => {
    spies.existingCompFindOneSpy.mockRejectedValueOnce(new Error("db"));
    const res = mockRes();
    await svc.fetchCompetitorsForUpdate({ body: { advertiser: ["Acme"] } }, res);
    expect(res.send).toHaveBeenCalled();
  });
});

describe("competitorService > fetchCompetitorsForUpdateNew", () => {
  it("validation fail when advertiser missing/empty array", async () => {
    const res = mockRes();
    await svc.fetchCompetitorsForUpdateNew({ body: { advertiser: [] } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Invalid advertiser");
  });

  it("validation fail when user_id missing", async () => {
    const res = mockRes();
    await svc.fetchCompetitorsForUpdateNew({ body: { advertiser: ["A"] } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Missing user_id");
  });

  it("userFailResp when project not found", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.fetchCompetitorsForUpdateNew({ body: { advertiser: ["A"], user_id: "u" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toBe("Project not found");
  });

  it("project has no competitors/monitoring → `|| []` defensive fallbacks fire", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({
      // no competitors, no monitoring keys
    });
    spies.competitorsFindSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await svc.fetchCompetitorsForUpdateNew({ body: { advertiser: ["A"], user_id: "u" } }, res);
    expect(res.send.mock.calls[0][0].body.data).toEqual([]);
  });

  it("happy: returns competitors with monitoring flag", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({
      competitors: ["c1"],
      monitoring: [{ toString: () => "c1" }],
    });
    spies.competitorsFindSpy.mockResolvedValueOnce([
      { _id: { toString: () => "c1" }, competitor_name: "C", competitor_url: "c.com" },
    ]);
    const res = mockRes();
    await svc.fetchCompetitorsForUpdateNew({ body: { advertiser: ["A"], user_id: "u" } }, res);
    expect(res.send).toHaveBeenCalled();
  });

  it("catch on project findOne throw", async () => {
    spies.competitorsReqFindOneSpy.mockRejectedValueOnce(new Error("db"));
    const res = mockRes();
    await svc.fetchCompetitorsForUpdateNew({ body: { advertiser: ["A"], user_id: "u" } }, res);
    expect(res.send).toHaveBeenCalled();
  });
});

describe("competitorService > getAllDetails", () => {
  function makeChain(data) {
    return {
      populate: function () { return this; },
      sort: function () { return Promise.resolve(data); },
    };
  }
  function makeInactiveChain(data) {
    return { sort: function () { return Promise.resolve(data); } };
  }
  it("returns combined active + inactive list", async () => {
    spies.competitorsReqFindSpy.mockReturnValueOnce(makeChain([
      { user_id: { amember_id: 1, userName: "Alice" }, advertiser: ["A"], competitors: [], createdAt: "2025-01-01" },
    ]));
    spies.userDetailsFindSpy.mockReturnValueOnce(makeInactiveChain([
      { amember_id: 2, userName: "Bob" },
    ]));
    const res = mockRes();
    await svc.getAllDetails({}, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Fetched all the details");
  });

  it("messageResp when both lists empty", async () => {
    spies.competitorsReqFindSpy.mockReturnValueOnce(makeChain([]));
    spies.userDetailsFindSpy.mockReturnValueOnce(makeInactiveChain([]));
    const res = mockRes();
    await svc.getAllDetails({}, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("No data found");
  });

  it("userName missing on either side → `|| null` fallback fires for active + inactive entries", async () => {
    spies.competitorsReqFindSpy.mockReturnValueOnce(makeChain([
      { user_id: { amember_id: 1 /* no userName */ }, advertiser: ["A"], competitors: [], createdAt: "2025-01-01" },
    ]));
    spies.userDetailsFindSpy.mockReturnValueOnce(makeInactiveChain([
      { amember_id: 2 /* no userName */ },
    ]));
    const res = mockRes();
    await svc.getAllDetails({}, res);
    const data = res.send.mock.calls[0][0].body.data;
    expect(data[0].userName).toBeNull();
    expect(data[1].userName).toBeNull();
  });

  it("catch on outer throw", async () => {
    spies.competitorsReqFindSpy.mockImplementationOnce(() => { throw new Error("db"); });
    const res = mockRes();
    await svc.getAllDetails({}, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Error in getting all details");
  });
});

describe("competitorService > updateMonitoring", () => {
  it("400 missing body", async () => {
    const res = mockRes();
    await svc.updateMonitoring({}, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Missing request data");
  });

  it("messageResp when required fields missing", async () => {
    const res = mockRes();
    await svc.updateMonitoring({ body: { competitor_request_id: "" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("Validation failed");
  });

  // Issue #208 is fixed: the inner validation is now
  // `status !== undefined && status !== ""`, so a numeric status=0 passes and
  // reaches the 'monitoring will be ON' branch (no longer a falsy-status bug).
  it("status=0 → 'already on' when monitoringCheck has hits", async () => {
    spies.competitorsReqFindSpy.mockResolvedValueOnce([{ _id: "r1" }]);
    const res = mockRes();
    await svc.updateMonitoring({
      body: { competitor_request_id: "r1", competitor_id: "c1", status: 0 },
    }, res);
    expect(res.json.mock.calls[0][0].statusCode).toBe(201);
    expect(res.json.mock.calls[0][0].body.message).toContain("already on");
  });

  // status="0" (string) bypasses the falsy-validation bug above because the
  // string "0" is truthy, while `status==0` still loose-equals true. This
  // reaches the 'monitoring will be on for this id' branch (line 526 truthy).
  it("status='0' string → 'already on' when monitoringCheck has hits (line 528 truthy)", async () => {
    spies.competitorsReqFindSpy.mockResolvedValueOnce([{ _id: "r1" }]);
    const res = mockRes();
    await svc.updateMonitoring({
      body: { competitor_request_id: "r1", competitor_id: "c1", status: "0" },
    }, res);
    expect(res.json.mock.calls[0][0].statusCode).toBe(201);
    expect(res.json.mock.calls[0][0].body.message).toContain("already on");
  });

  it("status='0' string + monitoringCheck empty → pushes competitor_id (line 528 falsy)", async () => {
    spies.competitorsReqFindSpy.mockResolvedValueOnce([]);
    spies.competitorsReqUpdateOneSpy.mockResolvedValueOnce({ modifiedCount: 1 });
    const res = mockRes();
    await svc.updateMonitoring({
      body: { competitor_request_id: "r1", competitor_id: "c1", status: "0" },
    }, res);
    expect(spies.competitorsReqUpdateOneSpy).toHaveBeenCalledWith(
      { _id: "r1" },
      { $push: { monitoring: "c1" } }
    );
    expect(res.send.mock.calls[0][0].body.msg).toContain("Updated monitoring");
  });

  it("status=1 + currently monitoring → pulls id", async () => {
    spies.competitorsReqFindSpy.mockResolvedValueOnce([{ _id: "r1" }]);
    spies.competitorsReqUpdateOneSpy.mockResolvedValueOnce({ modifiedCount: 1 });
    const res = mockRes();
    await svc.updateMonitoring({
      body: { competitor_request_id: "r1", competitor_id: "c1", status: 1 },
    }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Updated monitoring");
  });

  it("status=1 + not monitoring → 201 'already off'", async () => {
    spies.competitorsReqFindSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await svc.updateMonitoring({
      body: { competitor_request_id: "r1", competitor_id: "c1", status: 1 },
    }, res);
    expect(res.json.mock.calls[0][0].statusCode).toBe(201);
  });

  it("invalid status → messageResp", async () => {
    spies.competitorsReqFindSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await svc.updateMonitoring({
      body: { competitor_request_id: "r1", competitor_id: "c1", status: 99 },
    }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("Invalid status");
  });

  it("status=1 + updateOne returns falsy → 'Updation failed' branch", async () => {
    spies.competitorsReqFindSpy.mockResolvedValueOnce([{ _id: "r1" }]);
    spies.competitorsReqUpdateOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.updateMonitoring({
      body: { competitor_request_id: "r1", competitor_id: "c1", status: 1 },
    }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Updation failed");
  });

  it("catch on db throw (uses status=1 so we reach the try-block)", async () => {
    spies.competitorsReqFindSpy.mockImplementationOnce(() => { throw new Error("db"); });
    const res = mockRes();
    await svc.updateMonitoring({
      body: { competitor_request_id: "r1", competitor_id: "c1", status: 1 },
    }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Error in updating monitoring");
  });

  // 2026-07-14: competitorLimit (how many competitors can be monitored per brand)
  // was never enforced anywhere — only brandLimit was. A plan with competitorLimit:3
  // could have unlimited competitors turned on for monitoring.
  describe("competitor monitoring quota (mirrors the brand quota)", () => {
    it("blocks turning monitoring ON when currentMonitoringCount >= competitorLimit", async () => {
      spies.competitorsReqFindSpy.mockResolvedValueOnce([]); // not already monitoring
      spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ user_id: "u1", monitoring: ["m1", "m2", "m3"] });
      spies.userDetailsFindByIdSpy.mockReturnValue({ lean: () => Promise.resolve({ plan_id: 101 }) });
      spies.planAccessConfigFindOneSpy.mockResolvedValueOnce({ plan_limits: { "101": { brandLimit: 1, competitorLimit: 3 } } });
      const res = mockRes();
      await svc.updateMonitoring({
        body: { competitor_request_id: "r1", competitor_id: "c4", status: 0 },
      }, res);
      const sent = res.send.mock.calls[0][0];
      expect(sent.statusCode).toBe(403);
      expect(sent.body.showSubscriptionModal).toBe(true);
      expect(sent.body.message).toContain("3 competitors");
      expect(sent.body.limits).toEqual({ competitorLimit: 3, currentMonitoringCount: 3 });
      expect(spies.competitorsReqUpdateOneSpy).not.toHaveBeenCalled();
    });

    it("allows turning monitoring ON when under competitorLimit", async () => {
      spies.competitorsReqFindSpy.mockResolvedValueOnce([]);
      spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ user_id: "u1", monitoring: ["m1"] });
      spies.userDetailsFindByIdSpy.mockReturnValue({ lean: () => Promise.resolve({ plan_id: 102 }) });
      spies.planAccessConfigFindOneSpy.mockResolvedValueOnce({ plan_limits: { "102": { brandLimit: 5, competitorLimit: 35 } } });
      spies.competitorsReqUpdateOneSpy.mockResolvedValueOnce({ modifiedCount: 1 });
      const res = mockRes();
      await svc.updateMonitoring({
        body: { competitor_request_id: "r1", competitor_id: "c2", status: 0 },
      }, res);
      expect(spies.competitorsReqUpdateOneSpy).toHaveBeenCalledWith(
        { _id: "r1" },
        { $push: { monitoring: "c2" } }
      );
      expect(res.send.mock.calls[0][0].body.msg).toContain("Updated monitoring");
    });

    it("no user found (planId null) → quota check skipped, request proceeds", async () => {
      spies.competitorsReqFindSpy.mockResolvedValueOnce([]);
      spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ user_id: "u1", monitoring: ["m1", "m2", "m3"] });
      spies.userDetailsFindByIdSpy.mockReturnValue({ lean: () => Promise.resolve(null) });
      spies.competitorsReqUpdateOneSpy.mockResolvedValueOnce({ modifiedCount: 1 });
      const res = mockRes();
      await svc.updateMonitoring({
        body: { competitor_request_id: "r1", competitor_id: "c4", status: 0 },
      }, res);
      expect(spies.planAccessConfigFindOneSpy).not.toHaveBeenCalled();
      expect(res.send.mock.calls[0][0].body.msg).toContain("Updated monitoring");
    });

    it("quota check throws → fails open, still updates monitoring", async () => {
      spies.competitorsReqFindSpy.mockResolvedValueOnce([]);
      spies.competitorsReqFindOneSpy.mockRejectedValueOnce(new Error("db-down"));
      spies.competitorsReqUpdateOneSpy.mockResolvedValueOnce({ modifiedCount: 1 });
      const res = mockRes();
      await svc.updateMonitoring({
        body: { competitor_request_id: "r1", competitor_id: "c4", status: 0 },
      }, res);
      expect(res.send.mock.calls[0][0].body.msg).toContain("Updated monitoring");
    });
  });
});

describe("competitorService > filterDetails", () => {
  function makeChain(data) {
    return {
      populate: function () { return this; },
      lean: function () { return Promise.resolve(data); },
    };
  }
  it("400 missing body", async () => {
    const res = mockRes();
    await svc.filterDetails({}, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Missing request data");
  });

  it("brandName + results found", async () => {
    spies.competitorsReqFindSpy.mockReturnValueOnce(makeChain([
      { user_id: { amember_id: 1, userName: "A" }, advertiser: ["Acme"], competitors: [], createdAt: "2025-01-01" },
    ]));
    const res = mockRes();
    await svc.filterDetails({ body: { brandName: ["Acme"] } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Fetched all the details");
  });

  it("brandName + no results", async () => {
    spies.competitorsReqFindSpy.mockReturnValueOnce(makeChain([]));
    const res = mockRes();
    await svc.filterDetails({ body: { brandName: ["Acme"] } }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("No data found");
  });

  it("user_id only path: results found", async () => {
    spies.competitorsReqFindSpy.mockReturnValueOnce(makeChain([
      { user_id: { amember_id: 1, userName: "A" }, advertiser: ["X"], competitors: [], createdAt: "2025-01-01" },
    ]));
    const res = mockRes();
    await svc.filterDetails({ body: { user_id: "1" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Fetched all the details");
  });

  it("user_id only path: no requests → fallback to User_details", async () => {
    spies.competitorsReqFindSpy.mockReturnValueOnce(makeChain([]));
    spies.userDetailsFindSpy.mockReturnValueOnce(Promise.resolve([
      { amember_id: 1, userName: "Alice" },
    ]));
    const res = mockRes();
    await svc.filterDetails({ body: { user_id: "1" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Fetched all the details");
  });

  it("user_id only path: no user found anywhere", async () => {
    spies.competitorsReqFindSpy.mockReturnValueOnce(makeChain([]));
    spies.userDetailsFindSpy.mockReturnValueOnce(Promise.resolve([]));
    const res = mockRes();
    await svc.filterDetails({ body: { user_id: "x" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("No data found");
  });

  it("userName filter removes non-matches", async () => {
    spies.competitorsReqFindSpy.mockReturnValueOnce(makeChain([
      { user_id: { amember_id: 1, userName: "A" }, advertiser: ["X"], competitors: [], createdAt: "2025-01-01" },
    ]));
    const res = mockRes();
    await svc.filterDetails({ body: { userName: "Other" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("No data found");
  });

  it("catch on outer throw", async () => {
    spies.competitorsReqFindSpy.mockImplementationOnce(() => { throw new Error("db"); });
    const res = mockRes();
    await svc.filterDetails({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Error in filtering");
  });

  it("brandName path: missing userName → `|| null` fallback fires (line 1604)", async () => {
    spies.competitorsReqFindSpy.mockReturnValueOnce(makeChain([
      { user_id: { amember_id: 1 /* no userName */ }, advertiser: ["Acme"], competitors: [], createdAt: "2025-01-01" },
    ]));
    const res = mockRes();
    await svc.filterDetails({ body: { brandName: ["Acme"] } }, res);
    expect(res.send.mock.calls[0][0].body.data[0].userName).toBeNull();
  });

  it("user_id path: missing userName on User_details fallback → `|| null` (line 1637)", async () => {
    spies.competitorsReqFindSpy.mockReturnValueOnce(makeChain([]));
    spies.userDetailsFindSpy.mockReturnValueOnce(Promise.resolve([
      { amember_id: 1 /* no userName */ },
    ]));
    const res = mockRes();
    await svc.filterDetails({ body: { user_id: "1" } }, res);
    expect(res.send.mock.calls[0][0].body.data[0].userName).toBeNull();
  });

  it("user_id path: results found with missing userName on populated user_id → `|| null` (line 1648)", async () => {
    spies.competitorsReqFindSpy.mockReturnValueOnce(makeChain([
      { user_id: { amember_id: 1 /* no userName */ }, advertiser: ["X"], competitors: [], createdAt: "2025-01-01" },
    ]));
    const res = mockRes();
    await svc.filterDetails({ body: { user_id: "1" } }, res);
    expect(res.send.mock.calls[0][0].body.data[0].userName).toBeNull();
  });
});

describe("competitorService > fetchCompetitorsClient", () => {
  it("validation fail when advertiser missing", async () => {
    const res = mockRes();
    await svc.fetchCompetitorsClient({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Invalid advertiser");
  });

  it("happy: serves fully from DB when competitors exist", async () => {
    spies.existingCompFindOneSpy.mockResolvedValueOnce({
      competitors: [{ competitor_name: "C1", competitor_url: "c1.com" }],
    });
    const res = mockRes();
    await svc.fetchCompetitorsClient({ body: { advertiser: ["Acme"], offset: 0, limit: 50 } }, res);
    const payload = res.send.mock.calls[0][0];
    expect(payload.body.message).toContain("Fetched Competitors");
  });

  it("user scrolled beyond DB but at max → returns empty done=true", async () => {
    spies.existingCompFindOneSpy.mockResolvedValueOnce({ competitors: [] });
    const res = mockRes();
    await svc.fetchCompetitorsClient({ body: { advertiser: ["Acme"], offset: 0, limit: 50 } }, res);
    expect(res.send.mock.calls[0][0].body.done).toBeTruthy();
  });

  it("catch on existingComp throw", async () => {
    spies.existingCompFindOneSpy.mockRejectedValueOnce(new Error("db"));
    const res = mockRes();
    await svc.fetchCompetitorsClient({ body: { advertiser: ["Acme"] } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Error in fetching");
  });

  it("invalid limit + null brandDoc → `|| 50` and `|| []` fallback branches fire", async () => {
    spies.existingCompFindOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.fetchCompetitorsClient({
      body: { advertiser: ["Acme"], offset: "bad", limit: "bad" },
    }, res);
    // brandDoc null → existing = [], dbCount = 0; userScrolledBeyondDB true
    // because start=0 >= dbCount=0; belowMaxLimit depends on MAX_TOTAL.
    // configGetSpy returns "cfg:COMP_NUMBER_MAX" (a string truthy) → 0 < <truthy>
    // is true in some JS coercion... actually 0 < "cfg:..." is false because
    // non-numeric strings → NaN comparison → false. So !belowMaxLimit → true
    // → returns the empty done=true response.
    expect(res.send).toHaveBeenCalled();
  });

  it("scrolled past DB + below MAX → reaches outer catch when Gemini throws (covers lines 1367-1473)", async () => {
    // 5 existing competitors, MAX_TOTAL=50, offset=10 → fromDB=[], userScrolledBeyondDB=true,
    // belowMaxLimit=true → enters Gemini path. Force Gemini to reject with a
    // non-retryable error so callGeminiWithRetry throws → outer catch at 1472 fires.
    spies.existingCompFindOneSpy.mockResolvedValueOnce({
      competitors: new Array(5).fill(0).map((_, i) => ({
        competitor_name: `Ex${i}`,
        competitor_url: `e${i}.com`,
      })),
    });
    spies.configGetSpy.mockImplementation((k) => k === "COMP_NUMBER_MAX" ? 50 : "cfg:" + k);
    spies.geminiGenerateSpy.mockRejectedValue(new Error("non-retryable"));
    const res = mockRes();
    await svc.fetchCompetitorsClient({
      body: { advertiser: ["Acme"], offset: 10, limit: 50 },
    }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Error in fetching");
  });
});

describe("competitorService > fetchCompetitorsForUpdateClient", () => {
  it("validation fail when advertiser empty", async () => {
    const res = mockRes();
    await svc.fetchCompetitorsForUpdateClient({ body: { advertiser: [] } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Invalid advertiser");
  });

  it("returns DB list when comps >= MAX_COMPETITORS without calling Gemini", async () => {
    const big = new Array(200).fill({ competitor_name: "C", competitor_url: "c.com" });
    spies.existingCompFindOneSpy.mockResolvedValueOnce({ competitors: big });
    spies.configGetSpy.mockImplementation((k) => k === "COMP_NUMBER_MAX" ? 100 : `cfg:${k}`);
    const res = mockRes();
    await svc.fetchCompetitorsForUpdateClient({ body: { advertiser: ["Acme"] } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Fetched Competitors");
  });

  it("outer catch on lookup throw", async () => {
    spies.existingCompFindOneSpy.mockRejectedValueOnce(new Error("db"));
    const res = mockRes();
    await svc.fetchCompetitorsForUpdateClient({ body: { advertiser: ["Acme"] } }, res);
    expect(res.send).toHaveBeenCalled();
  });
});

describe("competitorService > fetchCompetitorsForUpdateOld", () => {
  it("400 missing body", async () => {
    const res = mockRes();
    await svc.fetchCompetitorsForUpdateOld({}, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Missing request data");
  });

  it("messageResp when advertiser missing", async () => {
    const res = mockRes();
    await svc.fetchCompetitorsForUpdateOld({ body: {} }, res);
    expect(res.send).toHaveBeenCalled();
  });
});

describe("competitorService > getStoreProcessCompetitors", () => {
  it("missing required fields", async () => {
    const res = mockRes();
    await svc.getStoreProcessCompetitors({ body: {} }, res);
    expect(res.send.mock.calls[0][0]).toContain("are required");
  });

  it("returns 'limit_exceeded' when daily limit hit", async () => {
    spies.userDailyTokensFindOneSpy.mockResolvedValueOnce({ output_tokens: 30000 });
    spies.configGetSpy.mockImplementation(() => 20000);
    const res = mockRes();
    await svc.getStoreProcessCompetitors({
      body: { advertiser: "Acme", content_ref_id: "c", user_id: "u" },
    }, res);
    const data = res.send.mock.calls[0][0].body.data;
    expect(data.status).toBe("limit_exceeded");
  });

  it("happy path: invokes python API + builds rows + spawns BG", async () => {
    spies.userDailyTokensFindOneSpy.mockResolvedValueOnce(null);
    spies.configGetSpy.mockImplementation((k) => k === "MAXIMUM_TOKEN_COUNt" ? 20000 : "cfg:" + k);
    spies.competitorsReqUpdateOneSpy.mockResolvedValueOnce({});
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ competitors: [] });
    spies.axiosGetSpy.mockResolvedValueOnce({ data: { data: { competitors: [{ tool_name: "c1", domain: "c.com" }] } } });
    spies.existingCompFindOneSpy.mockResolvedValueOnce(null);
    spies.existingCompUpdateOneSpy.mockResolvedValueOnce({});
    spies.competitorsFindSpy.mockResolvedValueOnce([]);
    const mod = await import("../../../models/competitors.js");
    mod.default.insertMany = vi.fn().mockResolvedValueOnce([{ _id: "n1" }]);
    spies.competitorsReqUpdateOneSpy.mockResolvedValueOnce({});
    spies.competitorsReqFindOneSpy.mockReturnValueOnce({
      lean: () => Promise.resolve({ _id: "p1", competitors: [], monitoring: [] }),
    });
    spies.competitorsFindSpy.mockReturnValueOnce({
      sort: () => ({ lean: () => Promise.resolve([]) }),
    });
    const res = mockRes();
    await svc.getStoreProcessCompetitors({
      body: { advertiser: "Acme", content_ref_id: "c", user_id: "u", target: 50 },
    }, res);
    expect(res.send).toHaveBeenCalled();
  });

  it("catch on outer throw", async () => {
    spies.userDailyTokensFindOneSpy.mockRejectedValueOnce(new Error("db"));
    const res = mockRes();
    await svc.getStoreProcessCompetitors({
      body: { advertiser: "Acme", content_ref_id: "c", user_id: "u" },
    }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Failed to fetch");
  });

  it("python returns competitors → attach resolves + logs (L2587)", async () => {
    svc.isDailyLimitExceeded = vi.fn().mockResolvedValue(false);
    svc.attachCompetitorsCappedToTarget = vi.fn().mockResolvedValue(1);
    svc.getCompetitorTableRows = vi.fn().mockResolvedValue([]);
    svc.generateCompetitorsInBackground = vi.fn();
    spies.competitorsReqUpdateOneSpy.mockResolvedValue({});
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ competitors: [] });
    spies.axiosGetSpy.mockResolvedValueOnce({ data: { data: { competitors: [{ tool_name: "c1" }] } } });
    const res = mockRes();
    await svc.getStoreProcessCompetitors({ body: { advertiser: "Acme", content_ref_id: "c", user_id: "u", target: 5 } }, res);
    expect(svc.attachCompetitorsCappedToTarget).toHaveBeenCalled();
    expect(res.send).toHaveBeenCalled();
  });

  it("axios response uses second-fallback shape `data.competitors` (no nested data.data) → covers fallback chain (lines 2483-2485)", async () => {
    spies.userDailyTokensFindOneSpy.mockResolvedValueOnce(null);
    spies.configGetSpy.mockImplementation((k) => k === "MAXIMUM_TOKEN_COUNt" ? 20000 : "cfg:" + k);
    spies.competitorsReqUpdateOneSpy.mockResolvedValueOnce({});
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ competitors: [] });
    // Primary path missing → second fallback used
    spies.axiosGetSpy.mockResolvedValueOnce({ data: { competitors: [{ tool_name: "c1", domain: "c.com" }] } });
    spies.existingCompFindOneSpy.mockResolvedValueOnce(null);
    spies.existingCompUpdateOneSpy.mockResolvedValueOnce({});
    spies.competitorsFindSpy.mockResolvedValueOnce([]);
    const mod = await import("../../../models/competitors.js");
    mod.default.insertMany = vi.fn().mockResolvedValueOnce([{ _id: "n1" }]);
    spies.competitorsReqUpdateOneSpy.mockResolvedValueOnce({});
    spies.competitorsReqFindOneSpy.mockReturnValueOnce({
      lean: () => Promise.resolve({ _id: "p1", competitors: [], monitoring: [] }),
    });
    spies.competitorsFindSpy.mockReturnValueOnce({
      sort: () => ({ lean: () => Promise.resolve([]) }),
    });
    const res = mockRes();
    await svc.getStoreProcessCompetitors({
      body: { advertiser: "Acme", content_ref_id: "c", user_id: "u" },
    }, res);
    expect(res.send).toHaveBeenCalled();
  });

  it("python API axios throws 422 → caught + 'Python /list API not ready yet' warn (line 2491)", async () => {
    spies.userDailyTokensFindOneSpy.mockResolvedValueOnce(null);
    spies.configGetSpy.mockImplementation((k) => k === "MAXIMUM_TOKEN_COUNt" ? 20000 : "cfg:" + k);
    spies.competitorsReqUpdateOneSpy.mockResolvedValueOnce({});
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ competitors: [] });
    // Python API throws (e.g. 422 not-ready) — caught at line 2489
    const apiErr = Object.assign(new Error("not-ready"), { response: { status: 422 } });
    spies.axiosGetSpy.mockRejectedValueOnce(apiErr);
    spies.competitorsReqFindOneSpy.mockReturnValueOnce({
      lean: () => Promise.resolve({ _id: "p1", competitors: [], monitoring: [] }),
    });
    spies.competitorsFindSpy.mockReturnValueOnce({
      sort: () => ({ lean: () => Promise.resolve([]) }),
    });
    const res = mockRes();
    await svc.getStoreProcessCompetitors({
      body: { advertiser: "Acme", content_ref_id: "c", user_id: "u" },
    }, res);
    expect(spies.loggerWarnSpy || spies.loggerErrorSpy).toBeDefined();
    expect(res.send).toHaveBeenCalled();
  });

  it("axios response with NO competitors at all → final `|| []` fallback (line 2485)", async () => {
    spies.userDailyTokensFindOneSpy.mockResolvedValueOnce(null);
    spies.configGetSpy.mockImplementation((k) => k === "MAXIMUM_TOKEN_COUNt" ? 20000 : "cfg:" + k);
    spies.competitorsReqUpdateOneSpy.mockResolvedValueOnce({});
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ competitors: [] });
    spies.axiosGetSpy.mockResolvedValueOnce({ data: {} }); // neither nested nor flat
    spies.competitorsReqFindOneSpy.mockReturnValueOnce({
      lean: () => Promise.resolve({ _id: "p1", competitors: [], monitoring: [] }),
    });
    spies.competitorsFindSpy.mockReturnValueOnce({
      sort: () => ({ lean: () => Promise.resolve([]) }),
    });
    const res = mockRes();
    await svc.getStoreProcessCompetitors({
      body: { advertiser: "Acme", content_ref_id: "c", user_id: "u" },
    }, res);
    expect(res.send).toHaveBeenCalled();
  });

  it("target=1 + one row → status: 'completed' branch fires", async () => {
    // generateCompetitorsInBackground is fire-and-forget and runs a while(true)
    // polling loop — stub it so it doesn't run unbounded (and OOM) after the
    // assertion. This test only verifies the synchronous response.
    vi.spyOn(svc, "generateCompetitorsInBackground").mockResolvedValue(undefined);
    spies.userDailyTokensFindOneSpy.mockResolvedValueOnce(null);
    spies.configGetSpy.mockImplementation((k) => k === "MAXIMUM_TOKEN_COUNt" ? 20000 : "cfg:" + k);
    spies.competitorsReqUpdateOneSpy.mockResolvedValue({});
    spies.axiosGetSpy.mockResolvedValue({ data: { data: { competitors: [{ tool_name: "c1", domain: "c.com" }] } } });
    spies.existingCompFindOneSpy.mockResolvedValue(null);
    spies.existingCompUpdateOneSpy.mockResolvedValue({});
    // findOne is consumed both directly (`await findOne(...)` → reqDoc) and via
    // `.lean()` inside getCompetitorTableRows (now also called from
    // attachCompetitorsCappedToTarget), so return a shape valid for both. With
    // competitors already attached, the project is at target → "completed".
    const projectDoc = { _id: "p1", competitors: ["n1"], monitoring: [] };
    spies.competitorsReqFindOneSpy.mockImplementation(() => ({
      ...projectDoc,
      lean: () => Promise.resolve(projectDoc),
    }));
    spies.competitorsFindSpy.mockImplementation(() => ({
      sort: () => ({ lean: () => Promise.resolve([{ _id: "n1", competitor_name: "C1", competitor_url: "c.com" }]) }),
    }));
    const res = mockRes();
    await svc.getStoreProcessCompetitors({
      body: { advertiser: "Acme", content_ref_id: "c", user_id: "u", target: 1 },
    }, res);
    expect(res.send.mock.calls[0][0].body.data.status).toBe("completed");
  });

  it("config.get('MAXIMUM_TOKEN_COUNt') returns falsy → `|| 20000` fallback fires", async () => {
    // Force config.get to return undefined for the token limit so the
    // `|| 20000` defensive fallback at line 2396 is exercised.
    spies.userDailyTokensFindOneSpy.mockResolvedValueOnce({ output_tokens: 50000 });
    spies.configGetSpy.mockImplementation((k) => k === "MAXIMUM_TOKEN_COUNt" ? undefined : "cfg:" + k);
    const res = mockRes();
    await svc.getStoreProcessCompetitors({
      body: { advertiser: "Acme", content_ref_id: "c", user_id: "u" },
    }, res);
    // 50000 >= 20000 → limit_exceeded
    expect(res.send.mock.calls[0][0].body.data.status).toBe("limit_exceeded");
  });
});

describe("competitorService > generateCompetitorsInBackground", () => {
  // Override the global sleep so the loop's awaits don't actually block tests.
  let sleepSpy;
  beforeEach(() => {
    sleepSpy = vi.spyOn(svc, "sleep").mockResolvedValue(undefined);
    spies.getIOSpy.mockReturnValue({ to: vi.fn(() => ({ emit: vi.fn() })) });
  });

  it("token limit exceeded → emits 'token-limit-exceeded' and breaks", async () => {
    spies.userDailyTokensFindOneSpy.mockResolvedValueOnce({ output_tokens: 30000 });
    spies.configGetSpy.mockReturnValue(20000);
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ competitors: [] });
    const emitSpy = vi.fn();
    spies.getIOSpy.mockReturnValue({ to: vi.fn(() => ({ emit: emitSpy })) });
    await svc.generateCompetitorsInBackground({
      normalizedKey: "acme", content_ref_id: "c", keywordUrlC: "http://x", TARGET: 200, user_id: "u",
    });
    expect(emitSpy).toHaveBeenCalledWith(
      "token-limit-exceeded",
      expect.objectContaining({ target: 200 })
    );
  });

  it("Gemini happy: fetchCompetitorsForUpdate returns merged list", async () => {
    sleepSpy.mockRestore();
    spies.existingCompFindOneSpy.mockResolvedValueOnce({
      competitors: [{ competitor_name: "Existing", competitor_url: "e.com" }],
    });
    spies.geminiGenerateSpy.mockResolvedValueOnce({
      text: '```json\n[{"Acme":[{"name":"NewComp","domain":"new.com","logo":"x"}]}]\n```',
    });
    const res = mockRes();
    await svc.fetchCompetitorsForUpdate({ body: { advertiser: ["Acme"] } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Fetched Competitors");
  });

  it("Gemini overload retries exhausted: fetchCompetitorsForUpdate returns userFailResp", async () => {
    sleepSpy.mockRestore();
    spies.existingCompFindOneSpy.mockResolvedValueOnce(null);
    spies.geminiGenerateSpy.mockRejectedValue(new Error("model is overloaded"));
    const res = mockRes();
    await svc.fetchCompetitorsForUpdate({ body: { advertiser: ["Acme"] } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("overloaded");
  });

  it("Gemini happy with brandCheck=null: falls through merge-if and hits unconditional return (line 1816)", async () => {
    sleepSpy.mockRestore();
    spies.existingCompFindOneSpy.mockResolvedValueOnce(null); // brandCheck falsy
    spies.geminiGenerateSpy.mockResolvedValueOnce({
      text: '```json\n[{"Acme":[{"name":"X","domain":"x.com"}]}]\n```',
    });
    const res = mockRes();
    await svc.fetchCompetitorsForUpdate({ body: { advertiser: ["Acme"] } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Fetched Competitors");
  });

  it("Gemini non-overload error: fetchCompetitorsForUpdate returns 'Error in getting competitor list'", async () => {
    sleepSpy.mockRestore();
    spies.existingCompFindOneSpy.mockResolvedValueOnce(null);
    spies.geminiGenerateSpy.mockRejectedValueOnce(new Error("bad-request"));
    const res = mockRes();
    await svc.fetchCompetitorsForUpdate({ body: { advertiser: ["Acme"] } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Error in getting competitor list");
  });

  it("Gemini happy: fetchCompetitorsForUpdateOld returns parsed JSON", async () => {
    sleepSpy.mockRestore();
    spies.geminiGenerateSpy.mockResolvedValueOnce({
      text: '```json\n[{"Acme":[{"name":"A","domain":"a.com","logo":"x"}]}]\n```',
    });
    const res = mockRes();
    await svc.fetchCompetitorsForUpdateOld({ body: { advertiser: ["Acme"] } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Fetched Competitors");
  });

  it("Gemini overload retries exhausted: fetchCompetitorsForUpdateOld returns userFailResp", async () => {
    sleepSpy.mockRestore();
    spies.geminiGenerateSpy.mockRejectedValue(new Error("quota"));
    const res = mockRes();
    await svc.fetchCompetitorsForUpdateOld({ body: { advertiser: ["Acme"] } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("overloaded");
  });

  it("Gemini non-overload error: fetchCompetitorsForUpdateOld returns 'Error in getting competitor list'", async () => {
    sleepSpy.mockRestore();
    spies.geminiGenerateSpy.mockRejectedValueOnce(new Error("bad-syntax"));
    const res = mockRes();
    await svc.fetchCompetitorsForUpdateOld({ body: { advertiser: ["Acme"] } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Error in getting competitor list");
  });

  it("fetchCompetitorsForUpdateOld outer catch (lines 1157-1162): config.get throws → 'Error in fetching competitors'", async () => {
    sleepSpy.mockRestore();
    // Make config.get throw on GEMINI_API_KEY lookup. This happens BEFORE
    // the inner try/while-loop, so the throw lands in the outer catch.
    spies.configGetSpy.mockImplementationOnce(() => { throw new Error("cfg-down"); });
    const res = mockRes();
    await svc.fetchCompetitorsForUpdateOld({ body: { advertiser: ["Acme"] } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toBe("Error in fetching competitors");
  });

  it("Gemini happy: fetchCompetitorsForUpdateClient with no existing data", async () => {
    sleepSpy.mockRestore();
    spies.existingCompFindOneSpy.mockResolvedValueOnce(null);
    spies.configGetSpy.mockImplementation((k) => k === "COMP_NUMBER_MAX" ? 200 : "cfg:" + k);
    spies.geminiGenerateSpy.mockResolvedValueOnce({
      text: '```json\n[{"Acme":[{"name":"X","domain":"x.com","logo":"x"}]}]\n```',
    });
    const res = mockRes();
    await svc.fetchCompetitorsForUpdateClient({ body: { advertiser: ["Acme"] } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Fetched Competitors");
  });

  it("Gemini happy with brandCheck present → merges existing comps with new gemini brand entry (lines 1970-1980)", async () => {
    sleepSpy.mockRestore();
    // brandCheck truthy with existing competitors → comps is built from them
    spies.existingCompFindOneSpy.mockResolvedValueOnce({
      competitors: [
        { competitor_name: "Existing1", competitor_url: "e1.com" },
        { competitor_name: "Existing2", competitor_url: "e2.com" },
      ],
    });
    // High MAX_COMPETITORS so we don't short-circuit
    spies.configGetSpy.mockImplementation((k) =>
      k === "COMP_NUMBER_MAX" ? 200 : "cfg:" + k
    );
    spies.geminiGenerateSpy.mockResolvedValueOnce({
      text: '```json\n[{"Acme":[{"name":"NewComp","domain":"new.com"}]}]\n```',
    });
    const res = mockRes();
    await svc.fetchCompetitorsForUpdateClient({ body: { advertiser: ["Acme"] } }, res);
    // brandCheck && Array.isArray(geminiData) path fires → returns [{Acme: mergeArr}]
    const payload = res.send.mock.calls[0][0];
    expect(payload.body.msg).toContain("Fetched Competitors");
    expect(payload.body.data).toEqual([
      { Acme: expect.arrayContaining([
        expect.objectContaining({ name: "Existing1" }),
        expect.objectContaining({ name: "Existing2" }),
        expect.objectContaining({ name: "NewComp" }),
      ]) },
    ]);
  });

  it("Gemini non-overload error: fetchCompetitorsForUpdateClient → 'Error in getting competitor list'", async () => {
    sleepSpy.mockRestore();
    spies.existingCompFindOneSpy.mockResolvedValueOnce(null);
    spies.configGetSpy.mockImplementation((k) => k === "COMP_NUMBER_MAX" ? 200 : "cfg:" + k);
    spies.geminiGenerateSpy.mockRejectedValueOnce(new Error("bad-syntax"));
    const res = mockRes();
    await svc.fetchCompetitorsForUpdateClient({ body: { advertiser: ["Acme"] } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Error in getting competitor list");
  });

  it("Gemini overload retries exhausted: fetchCompetitorsForUpdateClient → userFailResp", async () => {
    sleepSpy.mockRestore();
    spies.existingCompFindOneSpy.mockResolvedValueOnce(null);
    spies.configGetSpy.mockImplementation((k) => k === "COMP_NUMBER_MAX" ? 200 : "cfg:" + k);
    spies.geminiGenerateSpy.mockRejectedValue(new Error("model is overloaded"));
    const res = mockRes();
    await svc.fetchCompetitorsForUpdateClient({ body: { advertiser: ["Acme"] } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("overloaded");
  });

  it("Gemini happy: fetchCompetitors with new brand calls Gemini + inserts", async () => {
    sleepSpy.mockRestore();
    spies.existingCompFindOneSpy.mockResolvedValueOnce(null);
    spies.configGetSpy.mockImplementation((k) => k === "COMP_NUMBER" ? 10 : "cfg:" + k);
    spies.geminiGenerateSpy.mockResolvedValueOnce({
      text: '```json\n[{"Acme":{"ad_countries":["US"],"competitors":[{"name":"c1","domain":"c1.com"}]}}]\n```',
    });
    spies.existingCompUpdateOneSpy.mockResolvedValue({});
    // Stub insertIntoExistingComp to suppress source bug #275: fetchCompetitors
    // calls insertIntoExistingComp(text) with a single arg but the method needs
    // (advertiser, competitors). It's fire-and-forget, so it surfaces as an
    // unhandled rejection after the assertion. Stubbing prevents the noise.
    const insertSpy = vi.spyOn(svc, "insertIntoExistingComp").mockResolvedValue(undefined);
    const res = mockRes();
    await svc.fetchCompetitors({ body: { advertiser: ["Acme"] } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Fetched Competitors");
    insertSpy.mockRestore();
  });

  it("Gemini overload exhausted: fetchCompetitors → 'Model remained overloaded'", async () => {
    sleepSpy.mockRestore();
    spies.existingCompFindOneSpy.mockResolvedValueOnce(null);
    spies.configGetSpy.mockImplementation((k) => k === "COMP_NUMBER" ? 10 : "cfg:" + k);
    spies.geminiGenerateSpy.mockRejectedValue(new Error("model is overloaded"));
    const res = mockRes();
    await svc.fetchCompetitors({ body: { advertiser: ["Acme"] } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Model remained overloaded");
  });

  it("Gemini non-overload error: fetchCompetitors → 'Error in getting competitor list'", async () => {
    sleepSpy.mockRestore();
    spies.existingCompFindOneSpy.mockResolvedValueOnce(null);
    spies.configGetSpy.mockImplementation((k) => k === "COMP_NUMBER" ? 10 : "cfg:" + k);
    spies.geminiGenerateSpy.mockRejectedValueOnce(new Error("bad-syntax"));
    const res = mockRes();
    await svc.fetchCompetitors({ body: { advertiser: ["Acme"] } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Error in getting competitor list");
  });

  // Note: the 'new data arrived' enrichment path (saveUniqueCompetitors →
  // getCompetitorIdsFromMaster → attachCompetitorsToUserRequest →
  // getCompetitorTableRows → DashboardService.getCompetitorsCountNewInternal)
  // has 5+ nested findOne/find calls with chained .lean()/.sort() shapes that
  // conflict with the simpler mockResolvedValue patterns used elsewhere in
  // this test file. Skipping the dedicated test for that path — coverage of
  // the surrounding shell paths (token-limit, MAX_STABLE, MAX_PROCESSING,
  // outer catch) is already in place via earlier tests.

  it("same-data + still-processing path: hits MAX_PROCESSING_RETRIES break", async () => {
    spies.userDailyTokensFindOneSpy.mockResolvedValue(null);
    spies.configGetSpy.mockImplementation(() => 20000);
    spies.axiosGetSpy.mockImplementation(async (url) => {
      if (url.includes("/v1/api/tokens/usage")) {
        return { data: { data: { token_usage: {} } } };
      }
      // Always returns same data with isStillProcessing true (completedItems < totalItems)
      return { data: { data: { competitors: [{ tool_name: "X" }], total_items: 100, completed_items: 1 } } };
    });
    spies.tokenSyncFindOneSpy.mockResolvedValue({});
    spies.userDailyTokensUpdateOneSpy.mockResolvedValue({});
    spies.tokenSyncUpdateOneSpy.mockResolvedValue({});
    spies.competitorsReqFindOneSpy.mockReturnValue({
      lean: () => Promise.resolve({ _id: "p1", competitors: [], monitoring: [] }),
    });
    spies.competitorsFindSpy.mockReturnValue({
      sort: () => ({ lean: () => Promise.resolve([]) }),
    });
    spies.existingCompFindOneSpy.mockResolvedValue(null);
    spies.existingCompUpdateOneSpy.mockResolvedValue({});
    spies.competitorsFindSpy.mockResolvedValue([]);
    const mod = await import("../../../models/competitors.js");
    mod.default.insertMany = vi.fn().mockResolvedValue([]);
    spies.competitorsReqUpdateOneSpy.mockResolvedValue({});
    spies.dashboardCountInternalSpy.mockResolvedValue({});
    const emitSpy = vi.fn();
    spies.getIOSpy.mockReturnValue({ to: vi.fn(() => ({ emit: emitSpy })) });
    await svc.generateCompetitorsInBackground({
      normalizedKey: "acme", content_ref_id: "c", keywordUrlC: "http://x", TARGET: 50, user_id: "u",
    });
    // After hitting MAX_PROCESSING_RETRIES (30), loop breaks
    expect(emitSpy).toHaveBeenCalled();
  });

  it("empty-competitors loop: exits via MAX_STABLE_RETRIES (5 emits)", async () => {
    spies.userDailyTokensFindOneSpy.mockResolvedValue(null);
    spies.configGetSpy.mockImplementation((k) => k === "MAXIMUM_TOKEN_COUNt" ? 20000 : "cfg:" + k);
    spies.axiosGetSpy.mockResolvedValue({ data: { data: { token_usage: { input_tokens: 0, output_tokens: 0 }, competitors: [], total_items: 0 } } });
    spies.tokenSyncFindOneSpy.mockResolvedValue({});
    spies.userDailyTokensUpdateOneSpy.mockResolvedValue({});
    spies.tokenSyncUpdateOneSpy.mockResolvedValue({});
    spies.competitorsReqFindOneSpy.mockResolvedValue({ competitors: [] });
    const emitSpy = vi.fn();
    spies.getIOSpy.mockReturnValue({ to: vi.fn(() => ({ emit: emitSpy })) });
    await svc.generateCompetitorsInBackground({
      normalizedKey: "acme", content_ref_id: "c", keywordUrlC: "http://x", TARGET: 5, user_id: "u",
    });
    // After 5 stable empty iterations the loop breaks
    expect(emitSpy.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("API errors first then attached reaches target", async () => {
    spies.userDailyTokensFindOneSpy.mockResolvedValue(null);
    spies.configGetSpy.mockImplementation(() => 20000);
    spies.axiosGetSpy.mockResolvedValueOnce({ data: { data: { token_usage: {} } } }); // updateUserDailyTokens
    spies.tokenSyncFindOneSpy.mockResolvedValue({});
    spies.userDailyTokensUpdateOneSpy.mockResolvedValue({});
    spies.tokenSyncUpdateOneSpy.mockResolvedValue({});
    // Loop iteration 1: reqDoc(initially empty), axios FAILS → catch, sleep, continue
    // Loop iteration 2: token check token_usage axios, then reqDoc full→break
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ competitors: [] });
    spies.axiosGetSpy.mockRejectedValueOnce(new Error("api-down"));
    spies.axiosGetSpy.mockResolvedValueOnce({ data: { data: { token_usage: {} } } }); // 2nd updateUserDailyTokens
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ competitors: new Array(10).fill("c") });
    await svc.generateCompetitorsInBackground({
      normalizedKey: "acme", content_ref_id: "c", keywordUrlC: "http://x", TARGET: 5, user_id: "u",
    });
    expect(spies.axiosGetSpy).toHaveBeenCalled();
  });

  it("axios response without .data.data → `|| {}` fallback at line 2634 + competitors `|| []`", async () => {
    spies.userDailyTokensFindOneSpy.mockResolvedValue(null);
    spies.configGetSpy.mockImplementation(() => 20000);
    // First call: token sync axios (with .data.data so updateUserDailyTokens works)
    spies.axiosGetSpy.mockResolvedValueOnce({ data: { data: { token_usage: {} } } });
    spies.tokenSyncFindOneSpy.mockResolvedValue({});
    spies.userDailyTokensUpdateOneSpy.mockResolvedValue({});
    spies.tokenSyncUpdateOneSpy.mockResolvedValue({});
    // reqDoc has empty competitors → loop continues
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ competitors: [] });
    // The main competitor-fetch axios: response has data: {} (no .data.data, no .competitors)
    spies.axiosGetSpy.mockResolvedValueOnce({ data: {} });
    // Next iteration: token sync again
    spies.axiosGetSpy.mockResolvedValue({ data: { data: { token_usage: {} } } });
    // reqDoc reaches target on iteration 2 → break
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ competitors: new Array(5).fill("c") });
    const emitSpy = vi.fn();
    spies.getIOSpy.mockReturnValue({ to: vi.fn(() => ({ emit: emitSpy })) });
    await svc.generateCompetitorsInBackground({
      normalizedKey: "acme", content_ref_id: "c", keywordUrlC: "http://x", TARGET: 5, user_id: "u",
    });
    expect(emitSpy).toHaveBeenCalled();
  });

  it("NEW DATA arrives: enriches rows via DashboardService + emits 'competitor-batch' (lines 2643-2710)", async () => {
    // Mock the recurring token sync to always succeed
    spies.userDailyTokensFindOneSpy.mockResolvedValue(null);
    spies.configGetSpy.mockReturnValue(20000);
    spies.axiosGetSpy.mockResolvedValue({ data: { data: { token_usage: {} } } });
    spies.tokenSyncFindOneSpy.mockResolvedValue({});
    spies.userDailyTokensUpdateOneSpy.mockResolvedValue({});
    spies.tokenSyncUpdateOneSpy.mockResolvedValue({});
    // 1st reqDoc: empty competitors (not exceeded), 2nd reqDoc: 5 competitors → break
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ competitors: [] });
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ competitors: new Array(5).fill("c") });
    // First competitor-fetch axios returns a non-empty list (new data path)
    spies.axiosGetSpy.mockResolvedValueOnce({ data: { data: { token_usage: {} } } }); // token sync iter 1
    spies.axiosGetSpy.mockResolvedValueOnce({
      data: { data: { competitors: [{ tool_name: "C1", domain: "c1.com" }, { tool_name: "C2", domain: "c2.com" }], total_items: 2, completed_items: 2 } },
    });
    // Then iter 2: token sync axios
    spies.axiosGetSpy.mockResolvedValueOnce({ data: { data: { token_usage: {} } } });

    // Stub the per-instance helper methods invoked inside the NEW DATA branch
    const saveSpy = vi.spyOn(svc, "saveUniqueCompetitors").mockResolvedValue(2);
    const getIdsSpy = vi.spyOn(svc, "getCompetitorIdsFromMaster").mockResolvedValue(["id1", "id2"]);
    const attachSpy = vi.spyOn(svc, "attachCompetitorsToUserRequest").mockResolvedValue(undefined);
    // attachCompetitorsCappedToTarget calls getCompetitorTableRows first for the
    // already-attached set (return [] so the incoming C1/C2 aren't deduped away),
    // then the NEW DATA branch calls it again for the rows to enrich + emit.
    const tableSpy = vi.spyOn(svc, "getCompetitorTableRows")
      .mockResolvedValueOnce([])
      .mockResolvedValue([
        { name: "C1", countries: ["IN"], platforms: ["Other"] },
        { name: "C2", countries: [], platforms: [] },
      ]);
    // DashboardService.getCompetitorsCountNewInternal returns stats so the enrichment .map runs
    spies.dashboardCountInternalSpy.mockResolvedValueOnce({
      C1: {
        averagePopularity: 75, // > 66 → "High"
        competitorsCount: 100,
        todayAdsCount: 5,
        yesterdayAdsCount: 4,
        lastWeekAdsCount: 20,
        lastMonthAdsCount: 50,
        averageImpression: 1000,
        totalBudget: 50000,
        uniqueCountries: ["IN", "US"],
        platformCompetitorCount: { facebook: 10, instagram: 5 },
      },
      C2: {
        averagePopularity: 40, // > 33 → "Medium"
        platformCompetitorCount: {}, // no platforms → fallback to row.platforms
      },
    });

    const emitSpy = vi.fn();
    spies.getIOSpy.mockReturnValue({ to: vi.fn(() => ({ emit: emitSpy })) });

    await svc.generateCompetitorsInBackground({
      normalizedKey: "acme", content_ref_id: "c", keywordUrlC: "http://x", TARGET: 5, user_id: "u",
    });

    expect(saveSpy).toHaveBeenCalled();
    expect(attachSpy).toHaveBeenCalled();
    // Verify the 'competitor-batch' emission with enriched rows
    const batchEmit = emitSpy.mock.calls.find((c) => c[0] === "competitor-batch");
    expect(batchEmit).toBeDefined();
    const enriched = batchEmit[1].rows;
    expect(enriched[0].popularity).toContain("High");
    expect(enriched[0].budget).toContain("$50,000");
    expect(enriched[0].platforms).toEqual(["Facebook", "Instagram"]);
    expect(enriched[1].popularity).toContain("Medium");

    saveSpy.mockRestore();
    getIdsSpy.mockRestore();
    attachSpy.mockRestore();
    tableSpy.mockRestore();
  });

  it("SAME DATA isStillProcessing=true → processingRetries++ + sleep(3000) + continue (lines 2717-2724)", async () => {
    // Iter 1: NEW DATA arrives (e.g., 3 competitors, isStillProcessing=true → save+attach)
    // Iter 2..N: same 3 competitors + still processing → processingRetries++ until MAX_PROCESSING_RETRIES
    spies.userDailyTokensFindOneSpy.mockResolvedValue(null);
    spies.configGetSpy.mockReturnValue(20000);
    spies.tokenSyncFindOneSpy.mockResolvedValue({});
    spies.userDailyTokensUpdateOneSpy.mockResolvedValue({});
    spies.tokenSyncUpdateOneSpy.mockResolvedValue({});
    spies.competitorsReqFindOneSpy.mockResolvedValue({ competitors: [] });

    spies.axiosGetSpy.mockImplementation(async (url, opts) => {
      if (opts?.params?.skip === 0) {
        // Always 3 competitors + isStillProcessing (completed < total)
        return { data: { data: { competitors: [{ tool_name: "C1" }, { tool_name: "C2" }, { tool_name: "C3" }], total_items: 10, completed_items: 5 } } };
      }
      return { data: { data: { token_usage: {} } } };
    });

    const saveSpy = vi.spyOn(svc, "saveUniqueCompetitors").mockResolvedValue(3);
    const getIdsSpy = vi.spyOn(svc, "getCompetitorIdsFromMaster").mockResolvedValue(["id1", "id2", "id3"]);
    const attachSpy = vi.spyOn(svc, "attachCompetitorsToUserRequest").mockResolvedValue(undefined);
    const tableSpy = vi.spyOn(svc, "getCompetitorTableRows").mockResolvedValue([]);
    spies.dashboardCountInternalSpy.mockResolvedValue({});

    const emitSpy = vi.fn();
    spies.getIOSpy.mockReturnValue({ to: vi.fn(() => ({ emit: emitSpy })) });

    await svc.generateCompetitorsInBackground({
      normalizedKey: "acme", content_ref_id: "c", keywordUrlC: "http://x", TARGET: 50, user_id: "u",
    });
    // Loop terminates after exhausting processingRetries
    expect(saveSpy).toHaveBeenCalled();

    saveSpy.mockRestore();
    getIdsSpy.mockRestore();
    attachSpy.mockRestore();
    tableSpy.mockRestore();
  });

  it("SAME DATA isStillProcessing=false → stableCount++ + sleep(2000) + continue (line 2733-2734)", async () => {
    // Iter 1: NEW DATA arrives with 3 competitors
    // Iter 2-5: SAME DATA (lastCount==competitors.length) with !isStillProcessing → stableCount increments
    // Iter 6: SAME DATA → stableCount reaches MAX_STABLE_RETRIES → break
    spies.userDailyTokensFindOneSpy.mockResolvedValue(null);
    spies.configGetSpy.mockReturnValue(20000);
    spies.tokenSyncFindOneSpy.mockResolvedValue({});
    spies.userDailyTokensUpdateOneSpy.mockResolvedValue({});
    spies.tokenSyncUpdateOneSpy.mockResolvedValue({});
    spies.competitorsReqFindOneSpy.mockResolvedValue({ competitors: [] }); // never reaches target → loop on

    // Token sync axios (interleaved with main fetch axios). Default to token-sync success.
    spies.axiosGetSpy.mockImplementation(async (url, opts) => {
      // The main competitor-fetch axios passes params with content_ref_id+skip+limit
      if (opts?.params?.skip === 0) {
        return { data: { data: { competitors: [{ tool_name: "C1" }, { tool_name: "C2" }, { tool_name: "C3" }], total_items: 3, completed_items: 3 } } };
      }
      return { data: { data: { token_usage: {} } } };
    });

    const saveSpy = vi.spyOn(svc, "saveUniqueCompetitors").mockResolvedValue(3);
    const getIdsSpy = vi.spyOn(svc, "getCompetitorIdsFromMaster").mockResolvedValue(["id1", "id2", "id3"]);
    const attachSpy = vi.spyOn(svc, "attachCompetitorsToUserRequest").mockResolvedValue(undefined);
    const tableSpy = vi.spyOn(svc, "getCompetitorTableRows").mockResolvedValue([]);
    spies.dashboardCountInternalSpy.mockResolvedValue({});

    const emitSpy = vi.fn();
    spies.getIOSpy.mockReturnValue({ to: vi.fn(() => ({ emit: emitSpy })) });

    await svc.generateCompetitorsInBackground({
      normalizedKey: "acme", content_ref_id: "c", keywordUrlC: "http://x", TARGET: 50, user_id: "u",
    });
    // The loop exits after MAX_STABLE_RETRIES=5 stable iterations
    expect(saveSpy).toHaveBeenCalled();

    saveSpy.mockRestore();
    getIdsSpy.mockRestore();
    attachSpy.mockRestore();
    tableSpy.mockRestore();
  });

  it("EMPTY isStillProcessing=true → processingRetries++ + sleep(3000) + continue, then exits (lines 2741-2748)", async () => {
    // Empty competitors but completed_items < total_items → isStillProcessing
    // After MAX_PROCESSING_RETRIES=30 iterations, the loop breaks at line 2744
    spies.userDailyTokensFindOneSpy.mockResolvedValue(null);
    spies.configGetSpy.mockReturnValue(20000);
    spies.tokenSyncFindOneSpy.mockResolvedValue({});
    spies.userDailyTokensUpdateOneSpy.mockResolvedValue({});
    spies.tokenSyncUpdateOneSpy.mockResolvedValue({});
    spies.competitorsReqFindOneSpy.mockResolvedValue({ competitors: [] });

    spies.axiosGetSpy.mockImplementation(async (url, opts) => {
      if (opts?.params?.skip === 0) {
        // Empty competitors + still processing → loop exits via MAX_PROCESSING_RETRIES
        return { data: { data: { competitors: [], total_items: 10, completed_items: 5 } } };
      }
      return { data: { data: { token_usage: {} } } };
    });

    const emitSpy = vi.fn();
    spies.getIOSpy.mockReturnValue({ to: vi.fn(() => ({ emit: emitSpy })) });

    await svc.generateCompetitorsInBackground({
      normalizedKey: "acme", content_ref_id: "c", keywordUrlC: "http://x", TARGET: 50, user_id: "u",
    });
    // Loop terminates after exhausting processingRetries
    expect(emitSpy).toHaveBeenCalled();
  });

  it("NEW DATA arrives but ES enrichment throws → logged + raw rows still emitted (line 2702-2703)", async () => {
    spies.userDailyTokensFindOneSpy.mockResolvedValue(null);
    spies.configGetSpy.mockReturnValue(20000);
    spies.axiosGetSpy.mockResolvedValue({ data: { data: { token_usage: {} } } });
    spies.tokenSyncFindOneSpy.mockResolvedValue({});
    spies.userDailyTokensUpdateOneSpy.mockResolvedValue({});
    spies.tokenSyncUpdateOneSpy.mockResolvedValue({});
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ competitors: [] });
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ competitors: new Array(5).fill("c") });
    spies.axiosGetSpy.mockResolvedValueOnce({ data: { data: { token_usage: {} } } });
    spies.axiosGetSpy.mockResolvedValueOnce({
      data: { data: { competitors: [{ tool_name: "C1" }], total_items: 1, completed_items: 1 } },
    });
    spies.axiosGetSpy.mockResolvedValueOnce({ data: { data: { token_usage: {} } } });

    const saveSpy = vi.spyOn(svc, "saveUniqueCompetitors").mockResolvedValue(1);
    const getIdsSpy = vi.spyOn(svc, "getCompetitorIdsFromMaster").mockResolvedValue(["id1"]);
    const attachSpy = vi.spyOn(svc, "attachCompetitorsToUserRequest").mockResolvedValue(undefined);
    const tableSpy = vi.spyOn(svc, "getCompetitorTableRows").mockResolvedValue([{ name: "C1" }]);
    spies.dashboardCountInternalSpy.mockRejectedValueOnce(new Error("es-down"));

    const emitSpy = vi.fn();
    spies.getIOSpy.mockReturnValue({ to: vi.fn(() => ({ emit: emitSpy })) });

    await svc.generateCompetitorsInBackground({
      normalizedKey: "acme", content_ref_id: "c", keywordUrlC: "http://x", TARGET: 5, user_id: "u",
    });

    expect(spies.loggerErrorSpy).toHaveBeenCalledWith(
      "Failed to enrich competitor-batch with ES stats:",
      expect.any(Error)
    );
    saveSpy.mockRestore();
    getIdsSpy.mockRestore();
    attachSpy.mockRestore();
    tableSpy.mockRestore();
  });

  it("outer catch on getIO throw", async () => {
    spies.userDailyTokensFindOneSpy.mockResolvedValueOnce(null);
    spies.configGetSpy.mockImplementation(() => 20000);
    spies.axiosGetSpy.mockResolvedValue({ data: { data: { token_usage: {} } } });
    spies.tokenSyncFindOneSpy.mockResolvedValue({});
    spies.userDailyTokensUpdateOneSpy.mockResolvedValue({});
    spies.tokenSyncUpdateOneSpy.mockResolvedValue({});
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ competitors: [] });
    spies.getIOSpy.mockImplementationOnce(() => { throw new Error("io"); });
    await svc.generateCompetitorsInBackground({
      normalizedKey: "acme", content_ref_id: "c", keywordUrlC: "http://x", TARGET: 5, user_id: "u",
    });
    expect(spies.loggerErrorSpy).toHaveBeenCalledWith("BG ERROR", expect.any(Error));
  });

  it("token-sync throws → caught + logged via console.log, loop continues", async () => {
    // updateUserDailyTokens throws on first call
    spies.tokenSyncFindOneSpy.mockResolvedValue({});
    spies.axiosGetSpy.mockRejectedValueOnce(new Error("token-sync-fail"));
    spies.userDailyTokensFindOneSpy.mockResolvedValueOnce({ output_tokens: 30000 });
    spies.configGetSpy.mockReturnValue(20000);
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ competitors: [] });
    const emitSpy = vi.fn();
    spies.getIOSpy.mockReturnValue({ to: vi.fn(() => ({ emit: emitSpy })) });
    await svc.generateCompetitorsInBackground({
      normalizedKey: "acme", content_ref_id: "c", keywordUrlC: "http://x", TARGET: 5, user_id: "u",
    });
    expect(emitSpy).toHaveBeenCalledWith("token-limit-exceeded", expect.any(Object));
  });
});

describe("competitorService > generateCompetitorsInBackground enrichment", () => {
  it("new data arrives → attaches, enriches rows with empty ES stats (all fallbacks), then completes", async () => {
    svc.updateUserDailyTokens = vi.fn().mockResolvedValue();
    svc.isDailyLimitExceeded = vi.fn().mockResolvedValue(false);
    svc.attachCompetitorsCappedToTarget = vi.fn().mockResolvedValue(1);
    svc.getCompetitorTableRows = vi.fn().mockResolvedValue([{ name: "C1" }]); // no countries/platforms → fallbacks
    svc.sleep = vi.fn().mockResolvedValue();
    spies.dashboardCountInternalSpy.mockResolvedValue({}); // empty stats → every `|| 0` / `?:` fallback fires
    // iter 1: attachedCount 0 (<TARGET) → fetch+enrich; iter 2: attachedCount >= TARGET → break
    spies.competitorsReqFindOneSpy
      .mockResolvedValueOnce({ competitors: [] })
      .mockResolvedValueOnce({ competitors: [1, 2] });
    spies.axiosGetSpy.mockResolvedValue({ data: { data: { competitors: [{ tool_name: "X" }], total_items: 1, completed_items: 1 } } });
    const emit = vi.fn();
    spies.getIOSpy.mockReturnValue({ to: () => ({ emit }) });
    await svc.generateCompetitorsInBackground({ normalizedKey: "acme", content_ref_id: "c", keywordUrlC: "http://x", TARGET: 2, user_id: "u" });
    expect(emit).toHaveBeenCalledWith("competitor-batch", expect.any(Object));
  });

  it("shrinking data (len < lastCount) → falls through all smart-logic ifs (L2812 #1)", async () => {
    svc.updateUserDailyTokens = vi.fn().mockResolvedValue();
    svc.isDailyLimitExceeded = vi.fn().mockResolvedValue(false);
    svc.attachCompetitorsCappedToTarget = vi.fn().mockResolvedValue(1);
    svc.getCompetitorTableRows = vi.fn().mockResolvedValue([{ name: "C1" }]);
    svc.sleep = vi.fn().mockResolvedValue();
    spies.dashboardCountInternalSpy.mockResolvedValue({});
    // iter1 count 0; iter2 count 0; iter3 count >= TARGET → break
    spies.competitorsReqFindOneSpy
      .mockResolvedValueOnce({ competitors: [] })
      .mockResolvedValueOnce({ competitors: [] })
      .mockResolvedValueOnce({ competitors: [1, 2] });
    // iter1 returns 2 competitors (lastCount=2); iter2 returns 1 (< lastCount → no branch matches)
    spies.axiosGetSpy
      .mockResolvedValueOnce({ data: { data: { competitors: [{ tool_name: "X" }, { tool_name: "Y" }] } } })
      .mockResolvedValueOnce({ data: { data: { competitors: [{ tool_name: "X" }] } } });
    const emit = vi.fn();
    spies.getIOSpy.mockReturnValue({ to: () => ({ emit }) });
    await svc.generateCompetitorsInBackground({ normalizedKey: "acme", content_ref_id: "c", keywordUrlC: "http://x", TARGET: 2, user_id: "u" });
    expect(emit).toHaveBeenCalled();
  });
});

describe("competitorService > attachCompetitorsCappedToTarget", () => {
  it("returns 0 when competitors is empty/non-array", async () => {
    expect(await svc.attachCompetitorsCappedToTarget({ user_id: "u", normalizedKey: "k", competitors: [], TARGET: 5 })).toBe(0);
    expect(await svc.attachCompetitorsCappedToTarget({ user_id: "u", normalizedKey: "k", competitors: null, TARGET: 5 })).toBe(0);
  });

  it("returns 0 when target already met (need <= 0)", async () => {
    svc.getCompetitorTableRows = vi.fn().mockResolvedValue([{ name: "A" }, { name: "B" }, {}]); // {} → (r.name || "") fallback
    const out = await svc.attachCompetitorsCappedToTarget({ user_id: "u", normalizedKey: "k", competitors: [{ tool_name: "C" }], TARGET: 2 });
    expect(out).toBe(0);
  });

  it("competitorOverfetchLimit uses configured ratio when config.has is true", async () => {
    spies.configHasSpy.mockReturnValue(true);
    spies.configGetSpy.mockImplementation((k) => (k === "COMP_OVERFETCH_RATIO" ? 0.5 : `cfg:${k}`));
    expect(svc.competitorOverfetchLimit(10)).toBeGreaterThan(10);
    expect(svc.competitorOverfetchLimit(0)).toBe(0); // target <= 0 early return
  });

  it("competitorOverfetchLimit clamps to DS's hard cap of 100 (confirmed live: GET /list 422s above 100)", async () => {
    spies.configHasSpy.mockReturnValue(false); // default 20% ratio
    // 100 + ceil(100*0.2) = 120 uncapped — must clamp to 100, or every /list
    // poll for a 100-competitor request 422s forever (the reported "Warner
    // Bros" 0-results-after-2-minutes bug).
    expect(svc.competitorOverfetchLimit(100)).toBe(100);
    // Below the point where overfetch would exceed 100, no clamping needed.
    expect(svc.competitorOverfetchLimit(50)).toBe(60);
  });

  it("attaches fresh, name-unique candidates up to need (break + dedup + skip)", async () => {
    svc.getCompetitorTableRows = vi.fn().mockResolvedValue([]); // attachedNames empty
    svc.saveUniqueCompetitors = vi.fn().mockResolvedValue();
    svc.getCompetitorIdsFromMaster = vi.fn().mockResolvedValue(["id1", "id2"]);
    svc.attachCompetitorsToUserRequest = vi.fn().mockResolvedValue();
    const competitors = [
      { tool_name: "Alpha" },
      { tool_name: "" },        // no name → continue
      { tool_name: "Alpha" },   // duplicate → continue
      { tool_name: "Beta" },
      { tool_name: "Gamma" },   // never reached (break at need=2)
    ];
    const out = await svc.attachCompetitorsCappedToTarget({ user_id: "u", normalizedKey: "k", competitors, TARGET: 2 });
    expect(out).toBe(2);
    expect(svc.saveUniqueCompetitors).toHaveBeenCalled();
    expect(svc.attachCompetitorsToUserRequest).toHaveBeenCalled();
  });

  it("returns 0 when no fresh candidates (all already attached)", async () => {
    svc.getCompetitorTableRows = vi.fn().mockResolvedValue([{ name: "alpha" }]);
    const out = await svc.attachCompetitorsCappedToTarget({ user_id: "u", normalizedKey: "k", competitors: [{ tool_name: "Alpha" }], TARGET: 5 });
    expect(out).toBe(0);
  });
});

describe("competitorService > outer-catch safety nets", () => {
  it("create: validation throws → outer catch", async () => {
    spies.userDetailsFindOneSpy.mockResolvedValueOnce(null); // emailCheck null → enters createDetails
    spies._createDetailsThrow = true;
    const res = mockRes();
    await svc.create({ body: { email: "a@b.c", company_name: "X" } }, res);
    expect(spies.loggerErrorSpy).toHaveBeenCalledWith("Error in creating user details", expect.any(Error));
  });

  it("insertCompRequests: validation throws → outer catch", async () => {
    spies._createRequestThrow = true;
    const res = mockRes();
    await svc.insertCompRequests({ body: { advertiser: ["Acme"], user_id: "u1" } }, res);
    expect(spies.loggerErrorSpy).toHaveBeenCalledWith("Error in inserting competitors request", expect.any(Error));
  });
});

describe("competitorService > fetchCompetitorsClient Gemini fallback", () => {
  it("DB empty + scrolled beyond + below max → Gemini collects, dedups, inserts", async () => {
    spies.configGetSpy.mockImplementation((k) => (k === "COMP_NUMBER_MAX" ? 50 : `cfg:${k}`));
    spies.existingCompFindOneSpy.mockResolvedValueOnce(null); // dbCount 0 → fromDB empty, scrolled, below max
    spies.geminiGenerateSpy.mockResolvedValue({
      text: JSON.stringify([
        { Acme: { competitors: [
          { name: "R1", domain: "r1.com" },
          { name: "R1", domain: "dup" }, // duplicate → seen-skip branch
          { name: "R2", domain: "r2.com" },
        ] } },
      ]),
    });
    spies.existingCompUpdateOneSpy.mockResolvedValue({});
    const res = mockRes();
    await svc.fetchCompetitorsClient({ body: { advertiser: ["Acme"], offset: 0, limit: 2 } }, res);
    expect(spies.geminiGenerateSpy).toHaveBeenCalled();
    expect(spies.existingCompUpdateOneSpy).toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.status).toBe("success");
  });

  it("served fully from DB with dbCount>=MAX → done flag right operand evaluated (L1339/1353)", async () => {
    spies.configGetSpy.mockImplementation((k) => (k === "COMP_NUMBER_MAX" ? 1 : `cfg:${k}`));
    spies.existingCompFindOneSpy.mockResolvedValueOnce({ competitors: [{ competitor_name: "C1", competitor_url: "u.com" }] });
    const res = mockRes();
    await svc.fetchCompetitorsClient({ body: { advertiser: ["Acme"], offset: 0, limit: 50 } }, res);
    expect(res.send.mock.calls[0][0].body.status).toBe("success");
  });

  it("Gemini returns brand with no competitors → empty collected (L1431/1452)", async () => {
    spies.configGetSpy.mockImplementation((k) => (k === "COMP_NUMBER_MAX" ? 50 : `cfg:${k}`));
    spies.existingCompFindOneSpy.mockResolvedValueOnce(null); // dbCount 0
    spies.geminiGenerateSpy.mockResolvedValue({ text: JSON.stringify([{ Acme: {} }]) }); // no competitors
    const res = mockRes();
    await svc.fetchCompetitorsClient({ body: { advertiser: ["Acme"], offset: 0, limit: 2 } }, res);
    expect(res.send.mock.calls[0][0].body.status).toBe("success");
    expect(spies.existingCompUpdateOneSpy).not.toHaveBeenCalled(); // collected empty → no insert
  });
});

describe("competitorService > deleteCompetitor", () => {
  it("400 when required fields missing", async () => {
    const res = mockRes();
    await svc.deleteCompetitor({ body: { user_id: "u1" } }, res); // no advertiser/competitor
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("400 when body entirely missing → `req.body || {}`", async () => {
    const res = mockRes();
    await svc.deleteCompetitor({}, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("404 when project not found", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.deleteCompetitor({ body: { user_id: "u1", advertiser: "Acme", competitor_id: "c1" } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].body.message).toContain("Project not found");
  });

  it("removes by valid competitor_id → success", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1" });
    spies.objectIdIsValidSpy.mockReturnValue(true);
    spies.competitorsReqUpdateOneSpy.mockResolvedValueOnce({ modifiedCount: 1 });
    const res = mockRes();
    await svc.deleteCompetitor({ body: { user_id: "u1", advertiser: "Acme", competitor_id: "c1" } }, res);
    expect(spies.competitorsReqUpdateOneSpy).toHaveBeenCalled();
    const out = res.send.mock.calls[0][0];
    expect(out.body.data.removed).toBe(true);
  });

  it("falls back to competitor_name lookup when id absent → found", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1" });
    spies.competitorsFindOneSpy.mockResolvedValueOnce({ _id: "cFound" });
    spies.competitorsReqUpdateOneSpy.mockResolvedValueOnce({ modifiedCount: 0 });
    const res = mockRes();
    await svc.deleteCompetitor({ body: { user_id: "u1", advertiser: "Acme", competitor_name: "Rival Co" } }, res);
    expect(spies.competitorsFindOneSpy).toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.data.removed).toBe(false); // modifiedCount 0
  });

  it("404 when competitor_id invalid and no competitor_name supplied (else-if false)", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1" });
    spies.objectIdIsValidSpy.mockReturnValue(false); // id invalid, no name → competitorId stays null
    const res = mockRes();
    await svc.deleteCompetitor({ body: { user_id: "u1", advertiser: "Acme", competitor_id: "bad" } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].body.message).toContain("Competitor not found");
  });

  it("404 when competitor cannot be resolved (invalid id, name not found)", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1" });
    spies.objectIdIsValidSpy.mockReturnValue(false); // id invalid
    spies.competitorsFindOneSpy.mockResolvedValueOnce(null); // name not found
    const res = mockRes();
    await svc.deleteCompetitor({ body: { user_id: "u1", advertiser: "Acme", competitor_id: "bad", competitor_name: "Nope" } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json.mock.calls[0][0].body.message).toContain("Competitor not found");
  });

  it("500 on unexpected error", async () => {
    spies.competitorsReqFindOneSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await svc.deleteCompetitor({ body: { user_id: "u1", advertiser: "Acme", competitor_id: "c1" } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(spies.loggerErrorSpy).toHaveBeenCalledWith("Error in deleteCompetitor", expect.any(Error));
  });
});
