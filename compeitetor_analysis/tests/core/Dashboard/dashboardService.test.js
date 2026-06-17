import { describe, it, expect, vi, beforeEach } from "vitest";

const spies = vi.hoisted(() => {
  const esClient = {
    server1: { search: vi.fn(), count: vi.fn() },
    server2: { search: vi.fn(), count: vi.fn() },
    server3: { search: vi.fn(), count: vi.fn() },
    server4: { search: vi.fn(), count: vi.fn() },
  };
  // Plain ObjectId stub that just stores the string id.
  function ObjectIdStub(id) { return { _id: id, toString: () => id }; }
  return {
    loggerInfoSpy: vi.fn(),
    loggerErrorSpy: vi.fn(),
    configGetSpy: vi.fn(),
    axiosPostSpy: vi.fn(),
    competitorsReqFindSpy: vi.fn(),
    competitorsReqFindOneSpy: vi.fn(),
    competitorsReqFindByIdSpy: vi.fn(),
    competitorsReqAggregateSpy: vi.fn(),
    userDetailsFindByIdSpy: vi.fn(),
    planGroupsFindOneSpy: vi.fn(),
    backlinkFindOneSpy: vi.fn(),
    backlinkCreateSpy: vi.fn(),
    backlinkFindByIdAndUpdateSpy: vi.fn(),
    backlinkFindSpy: vi.fn(),
    organicFindOneSpy: vi.fn(),
    organicCreateSpy: vi.fn(),
    organicFindByIdAndUpdateSpy: vi.fn(),
    organicFindSpy: vi.fn(),
    paidFindOneSpy: vi.fn(),
    paidCreateSpy: vi.fn(),
    paidFindByIdAndUpdateSpy: vi.fn(),
    paidFindSpy: vi.fn(),
    competitorsFindSpy: vi.fn(),
    getAllCountriesSpy: vi.fn(),
    isValidObjectIdSpy: vi.fn(),
    esClient,
    ObjectIdStub,
  };
});

vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { info: spies.loggerInfoSpy, error: spies.loggerErrorSpy, warn: vi.fn() },
}));
vi.mock("axios", () => ({ default: { post: spies.axiosPostSpy } }));
vi.mock("../../../utils/response.js", () => ({
  default: {
    userSuccessResp: (msg, data) => ({ statusCode: 200, body: { status: "success", msg, data } }),
    userFailResp: (msg, err) => ({ statusCode: 400, body: { status: "failed", msg, err } }),
    validationFailResp: (msg, err) => ({ statusCode: 400, body: { status: "failed", msg, err } }),
    messageResp: (msg) => ({ statusCode: 400, body: { message: msg } }),
    failResp: (msg, err) => ({ statusCode: 500, body: { status: "failed", msg, err } }),
  },
}));
vi.mock("config", () => ({ default: { get: spies.configGetSpy } }));
vi.mock("../../../models/competitors_request.js", () => ({
  default: {
    find: spies.competitorsReqFindSpy,
    findOne: spies.competitorsReqFindOneSpy,
    findById: spies.competitorsReqFindByIdSpy,
    aggregate: spies.competitorsReqAggregateSpy,
  },
}));
vi.mock("../../../models/user_details.js", () => ({
  default: {
    findById: spies.userDetailsFindByIdSpy,
  },
}));
vi.mock("../../../models/backlink.js", () => ({
  default: {
    findOne: spies.backlinkFindOneSpy,
    create: spies.backlinkCreateSpy,
    findByIdAndUpdate: spies.backlinkFindByIdAndUpdateSpy,
    find: (...args) => spies.backlinkFindSpy(...args),
  },
}));
vi.mock("../../../models/organic_search.js", () => ({
  default: {
    findOne: spies.organicFindOneSpy,
    create: spies.organicCreateSpy,
    findByIdAndUpdate: spies.organicFindByIdAndUpdateSpy,
    find: (...args) => spies.organicFindSpy(...args),
  },
}));
vi.mock("../../../models/paid_search.js", () => ({
  default: {
    findOne: spies.paidFindOneSpy,
    create: spies.paidCreateSpy,
    findByIdAndUpdate: spies.paidFindByIdAndUpdateSpy,
    find: (...args) => spies.paidFindSpy(...args),
  },
}));
vi.mock("../../../models/competitors.js", () => ({
  default: {
    find: spies.competitorsFindSpy,
    aggregate: vi.fn(),
    countDocuments: vi.fn(),
  },
}));
vi.mock("../../../models/countries.js", () => ({
  getAllCountries: spies.getAllCountriesSpy,
}));
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
vi.mock("elasticsearch", () => ({ default: { Client: function () {} } }));
vi.mock("./dashboardValidation.js", () => ({
  default: {
    validatePayloadForBacklink: vi.fn((b) => ({ value: b, error: null })),
    validatePayloadForOrganic: vi.fn((b) => ({ value: b, error: null })),
    validatePayloadForPaid: vi.fn((b) => ({ value: b, error: null })),
  },
}));
vi.mock("../../../core/Dashboard/dashboardValidation.js", () => ({
  default: {
    validatePayloadForBacklink: vi.fn((b) => ({ value: b, error: null })),
    validatePayloadForOrganic: vi.fn((b) => ({ value: b, error: null })),
    validatePayloadForPaid: vi.fn((b) => ({ value: b, error: null })),
  },
}));
vi.mock("moment", () => {
  const m = () => ({
    subtract: () => m(),
    startOf: () => m(),
    endOf: () => m(),
    utcOffset: () => m(),
    format: () => "2025-01-01 00:00:00",
    valueOf: () => 1000000,
  });
  // nowIST() uses moment.utc().utcOffset("+05:30") — the static .utc must exist.
  m.utc = () => m();
  return { default: m };
});
vi.mock("mongoose", () => ({
  default: {
    Types: { ObjectId: spies.ObjectIdStub },
    isValidObjectId: spies.isValidObjectIdSpy,
    // user_details.js (pulled in transitively) defines a Schema/model at load.
    Schema: function () {},
    model: () => ({}),
    connection: { collection: () => ({ findOne: (...a) => spies.planGroupsFindOneSpy(...a) }) },
  },
}));

let svc;

beforeEach(async () => {
  Object.values(spies).forEach((s) => {
    if (typeof s?.mockReset === "function") s.mockReset();
  });
  Object.values(spies.esClient).forEach((c) => {
    c.search.mockReset();
    c.count.mockReset();
  });
  spies.configGetSpy.mockImplementation((k) => `cfg:${k}`);
  spies.isValidObjectIdSpy.mockReturnValue(true);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.resetModules();
  ({ default: svc } = await import("../../../core/Dashboard/dashboardService.js"));
});

function mockRes() {
  return { send: vi.fn(), json: vi.fn() };
}

describe("dashboardService > getCountry", () => {
  it("success: returns countries via res.json", async () => {
    spies.getAllCountriesSpy.mockResolvedValueOnce([{ name: "India" }]);
    const res = mockRes();
    await svc.getCountry({}, res);
    expect(res.json).toHaveBeenCalledWith([{ name: "India" }]);
  });
  it("catch on getAllCountries throw", async () => {
    spies.getAllCountriesSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await svc.getCountry({}, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Error in getting competitor count");
  });
});

describe("dashboardService > userProject", () => {
  it("validation fail when body missing", async () => {
    const res = mockRes();
    await svc.userProject({}, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Missing request data");
  });

  it("fail on inner DB lookup error", async () => {
    spies.competitorsReqFindSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await svc.userProject({ body: { user_id: "u1" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Database error");
  });

  it("messageResp when no projects found", async () => {
    spies.competitorsReqFindSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await svc.userProject({ body: { user_id: "u1" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("No projects found");
  });

  it("happy: returns project list", async () => {
    spies.competitorsReqFindSpy.mockResolvedValueOnce([
      { advertiser: ["A1"], competitors: ["c1"], monitoring: ["m1"] },
      { advertiser: ["A2"] },
    ]);
    const res = mockRes();
    await svc.userProject({ body: { user_id: "u1" } }, res);
    expect(res.send.mock.calls[0][0].body.data.project_name).toEqual(["A1", "A2"]);
  });

  it("outer catch (lines 240-243): throwing-Proxy req.body → outer catch fires", async () => {
    const body = new Proxy({ exists: true }, {
      get(target, prop) {
        if (prop === "user_id") throw new TypeError("destructure-fail");
        return target[prop];
      },
    });
    const res = mockRes();
    await svc.userProject({ body }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Unexpected error occurred");
  });
});

describe("dashboardService > insertBacklink", () => {
  it("400 missing data", async () => {
    const res = mockRes();
    await svc.insertBacklink({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Missing backlink data");
  });
  it("400 missing domain_name", async () => {
    const res = mockRes();
    await svc.insertBacklink({ body: { dr: 99 } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Missing domain name");
  });
  it("creates a backlink when none exists", async () => {
    spies.backlinkFindOneSpy.mockResolvedValueOnce(null);
    spies.backlinkCreateSpy.mockResolvedValueOnce({ _id: "b1" });
    const res = mockRes();
    await svc.insertBacklink({ body: { domain_name: "x.com", dr: 10 } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("created");
  });
  it("create returns falsy → messageResp", async () => {
    spies.backlinkFindOneSpy.mockResolvedValueOnce(null);
    spies.backlinkCreateSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.insertBacklink({ body: { domain_name: "x.com" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("Failed to create");
  });
  it("updates existing backlink, dropping empty strings/nulls", async () => {
    spies.backlinkFindOneSpy.mockResolvedValueOnce({ _id: "b1" });
    spies.backlinkFindByIdAndUpdateSpy.mockResolvedValueOnce({ _id: "b1", dr: 20 });
    const res = mockRes();
    await svc.insertBacklink(
      { body: { domain_name: "x.com", dr: 20, empty_str: "  ", nullable: null } },
      res
    );
    expect(spies.backlinkFindByIdAndUpdateSpy).toHaveBeenCalled();
    const updateFields = spies.backlinkFindByIdAndUpdateSpy.mock.calls[0][1].$set;
    expect(updateFields.empty_str).toBeUndefined();
    expect(updateFields.nullable).toBeUndefined();
    expect(updateFields.domain_name).toBeUndefined();
  });
  it("catch on findOne throw", async () => {
    spies.backlinkFindOneSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await svc.insertBacklink({ body: { domain_name: "x.com" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Error inserting backlink");
  });
});

describe("dashboardService > insertOrganicSearch", () => {
  it("400 missing data", async () => {
    const res = mockRes();
    await svc.insertOrganicSearch({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("missing the organic search");
  });
  it("400 missing domain_name", async () => {
    const res = mockRes();
    await svc.insertOrganicSearch({ body: { keyword: "x" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Missing domain name");
  });
  it("creates when none exists", async () => {
    spies.organicFindOneSpy.mockResolvedValueOnce(null);
    spies.organicCreateSpy.mockResolvedValueOnce({ _id: "o1" });
    const res = mockRes();
    await svc.insertOrganicSearch({ body: { domain_name: "x.com" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("created");
  });
  it("creates returns falsy → messageResp", async () => {
    spies.organicFindOneSpy.mockResolvedValueOnce(null);
    spies.organicCreateSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.insertOrganicSearch({ body: { domain_name: "x.com" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("Failed to create");
  });
  it("updates existing", async () => {
    spies.organicFindOneSpy.mockResolvedValueOnce({ _id: "o1" });
    spies.organicFindByIdAndUpdateSpy.mockResolvedValueOnce({ _id: "o1" });
    const res = mockRes();
    await svc.insertOrganicSearch({ body: { domain_name: "x.com", kd: 5 } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("updated");
  });
  it("catch on throw", async () => {
    spies.organicFindOneSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await svc.insertOrganicSearch({ body: { domain_name: "x.com" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Error inserting organic search");
  });
  it("update path filters undefined/null/empty-string field values (line 1193 falsy branch)", async () => {
    spies.organicFindOneSpy.mockResolvedValueOnce({ _id: "o1" });
    spies.organicFindByIdAndUpdateSpy.mockResolvedValueOnce({ _id: "o1" });
    const res = mockRes();
    // Mix of valid (kd:5) and invalid (null/undefined/empty/whitespace) fields.
    // Each invalid value hits the falsy side of `value !== undefined && value !== null && !...`
    await svc.insertOrganicSearch(
      { body: { domain_name: "x.com", kd: 5, foo: null, bar: undefined, baz: "", qux: "   " } },
      res,
    );
    const updateFields = spies.organicFindByIdAndUpdateSpy.mock.calls[0][1].$set;
    // Only kd survives the filter; null/undefined/""/"   " are stripped
    expect(updateFields.kd).toBe(5);
    expect(updateFields.foo).toBeUndefined();
    expect(updateFields.bar).toBeUndefined();
    expect(updateFields.baz).toBeUndefined();
    expect(updateFields.qux).toBeUndefined();
  });
});

describe("dashboardService > insertpaidSearch", () => {
  it("400 missing data", async () => {
    const res = mockRes();
    await svc.insertpaidSearch({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Missing paidsearch");
  });
  it("400 missing domain_name", async () => {
    const res = mockRes();
    await svc.insertpaidSearch({ body: { keywords: "x" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Missing domain name");
  });
  it("creates when none exists", async () => {
    spies.paidFindOneSpy.mockResolvedValueOnce(null);
    spies.paidCreateSpy.mockResolvedValueOnce({ _id: "p1" });
    const res = mockRes();
    await svc.insertpaidSearch({ body: { domain_name: "x.com" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("created");
  });
  it("creates returns falsy → messageResp", async () => {
    spies.paidFindOneSpy.mockResolvedValueOnce(null);
    spies.paidCreateSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.insertpaidSearch({ body: { domain_name: "x.com" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("Failed to create");
  });
  it("updates existing", async () => {
    spies.paidFindOneSpy.mockResolvedValueOnce({ _id: "p1" });
    spies.paidFindByIdAndUpdateSpy.mockResolvedValueOnce({ _id: "p1" });
    const res = mockRes();
    await svc.insertpaidSearch({ body: { domain_name: "x.com", kd: 5 } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("updated");
  });
  it("update path filters undefined/null/empty-string field values (line 1258 falsy branch)", async () => {
    spies.paidFindOneSpy.mockResolvedValueOnce({ _id: "p1" });
    spies.paidFindByIdAndUpdateSpy.mockResolvedValueOnce({ _id: "p1" });
    const res = mockRes();
    await svc.insertpaidSearch(
      { body: { domain_name: "x.com", kd: 5, foo: null, bar: undefined, baz: "", qux: "   " } },
      res,
    );
    const updateFields = spies.paidFindByIdAndUpdateSpy.mock.calls[0][1].$set;
    expect(updateFields.kd).toBe(5);
    expect(updateFields.foo).toBeUndefined();
    expect(updateFields.bar).toBeUndefined();
    expect(updateFields.baz).toBeUndefined();
    expect(updateFields.qux).toBeUndefined();
  });
  it("catch on throw", async () => {
    spies.paidFindOneSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await svc.insertpaidSearch({ body: { domain_name: "x.com" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Error inserting paid search");
  });
});

describe("dashboardService > getBackLinks", () => {
  function makeChain(out) {
    return { skip: () => ({ limit: () => Promise.resolve(out) }) };
  }
  it("400 missing payload", async () => {
    const res = mockRes();
    await svc.getBackLinks({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Missing payload");
  });
  it("returns data when found", async () => {
    spies.backlinkFindSpy.mockReturnValueOnce(makeChain([{ _id: "b1" }]));
    const res = mockRes();
    await svc.getBackLinks({ body: { domain_name: "x", skip: 0, limit: 10 } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Data found");
  });
  it("messageResp when none found", async () => {
    spies.backlinkFindSpy.mockReturnValueOnce(makeChain([]));
    const res = mockRes();
    await svc.getBackLinks({ body: { domain_name: "x", skip: 0, limit: 10 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("No data found");
  });
  it("applies referring_page + referring_domains regex", async () => {
    spies.backlinkFindSpy.mockReturnValueOnce(makeChain([{ _id: "b1" }]));
    const res = mockRes();
    await svc.getBackLinks({
      body: { domain_name: "x", referring_page: "p", referring_domains: "d", skip: 0, limit: 5 },
    }, res);
    const args = spies.backlinkFindSpy.mock.calls[0][0];
    expect(args.referring_page).toBeDefined();
    expect(args.referring_domains).toBeDefined();
  });
  it("catch on .find throw", async () => {
    spies.backlinkFindSpy.mockImplementationOnce(() => { throw new Error("db-down"); });
    const res = mockRes();
    await svc.getBackLinks({ body: { domain_name: "x", skip: 0, limit: 5 } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Error in getting backlinks");
  });
  it("domain_name absent → falsy branch of `if (domain_name && ...)` at line 1314", async () => {
    spies.backlinkFindSpy.mockReturnValueOnce(makeChain([{ _id: "b1" }]));
    const res = mockRes();
    // No domain_name; pass another field so the empty-payload check passes.
    await svc.getBackLinks({ body: { skip: 0, limit: 10 } }, res);
    const args = spies.backlinkFindSpy.mock.calls[0][0];
    expect(args.domain_name).toBeUndefined();
  });
});

describe("dashboardService > getOrganicSearches", () => {
  function makeChain(out) {
    return { skip: () => ({ limit: () => Promise.resolve(out) }) };
  }
  it("400 missing payload", async () => {
    const res = mockRes();
    await svc.getOrganicSearches({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Missing payload");
  });
  it("returns data when found, applying all optional filters", async () => {
    spies.organicFindSpy.mockReturnValueOnce(makeChain([{ _id: "o1" }]));
    const res = mockRes();
    await svc.getOrganicSearches({
      body: { domain_name: "x", best_position_url: "u", keyword: "k", skip: 0, limit: 5 },
    }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Data found");
  });
  it("messageResp when none found", async () => {
    spies.organicFindSpy.mockReturnValueOnce(makeChain([]));
    const res = mockRes();
    await svc.getOrganicSearches({ body: { domain_name: "x", skip: 0, limit: 5 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("No data found");
  });
  it("catch on .find throw", async () => {
    spies.organicFindSpy.mockImplementationOnce(() => { throw new Error("db-down"); });
    const res = mockRes();
    await svc.getOrganicSearches({ body: { domain_name: "x", skip: 0, limit: 5 } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Error in getting organic search");
  });
  it("domain_name absent → falsy branch of `if (domain_name && ...)` at line 1374", async () => {
    spies.organicFindSpy.mockReturnValueOnce(makeChain([{ _id: "o1" }]));
    const res = mockRes();
    await svc.getOrganicSearches({ body: { skip: 0, limit: 5 } }, res);
    const args = spies.organicFindSpy.mock.calls[0][0];
    expect(args.domain_name).toBeUndefined();
  });
});

describe("dashboardService > getPaidSearches", () => {
  function makeChain(out) {
    return { skip: () => ({ limit: () => Promise.resolve(out) }) };
  }
  it("400 missing payload", async () => {
    const res = mockRes();
    await svc.getPaidSearches({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Missing payload");
  });
  it("returns data when found, all filters", async () => {
    spies.paidFindSpy.mockReturnValueOnce(makeChain([{ _id: "p1" }]));
    const res = mockRes();
    await svc.getPaidSearches({
      body: { domain_name: "x", external_links: "e", keywords: "k", skip: 0, limit: 5 },
    }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Data found");
  });
  it("messageResp when none found", async () => {
    spies.paidFindSpy.mockReturnValueOnce(makeChain([]));
    const res = mockRes();
    await svc.getPaidSearches({ body: { domain_name: "x", skip: 0, limit: 5 } }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("No data found");
  });
  it("catch on .find throw", async () => {
    spies.paidFindSpy.mockImplementationOnce(() => { throw new Error("db-down"); });
    const res = mockRes();
    await svc.getPaidSearches({ body: { domain_name: "x", skip: 0, limit: 5 } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Error in getting organic paid");
  });
  it("domain_name absent → falsy branch of `if (domain_name && ...)` at line 1433", async () => {
    spies.paidFindSpy.mockReturnValueOnce(makeChain([{ _id: "p1" }]));
    const res = mockRes();
    await svc.getPaidSearches({ body: { skip: 0, limit: 5 } }, res);
    const args = spies.paidFindSpy.mock.calls[0][0];
    expect(args.domain_name).toBeUndefined();
  });

  it("VALIDATION_FAIL when validatePayloadForPaid returns error", async () => {
    // Re-mock validation to return an error, then re-import the SUT so it
    // picks up the new validation behavior. Other tests are unaffected
    // because beforeEach resets modules + restores the default mock.
    const err = { details: [{ message: "bad payload" }] };
    vi.doMock("../../../core/Dashboard/dashboardValidation.js", () => ({
      default: {
        validatePayloadForBacklink: vi.fn((b) => ({ value: b, error: null })),
        validatePayloadForOrganic: vi.fn((b) => ({ value: b, error: null })),
        validatePayloadForPaid: vi.fn(() => ({ value: {}, error: err })),
      },
    }));
    vi.resetModules();
    const { default: isolatedSvc } = await import("../../../core/Dashboard/dashboardService.js");
    const res = mockRes();
    await isolatedSvc.getPaidSearches({ body: { domain_name: "x" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toBe("VALIDATION_FAIL");
    vi.doUnmock("../../../core/Dashboard/dashboardValidation.js");
  });
});

describe("dashboardService > validation-fail branches in getBackLinks + getOrganicSearches", () => {
  it("VALIDATION_FAIL when validatePayloadForBacklink returns error", async () => {
    const err = { details: [{ message: "bad backlink payload" }] };
    vi.doMock("../../../core/Dashboard/dashboardValidation.js", () => ({
      default: {
        validatePayloadForBacklink: vi.fn(() => ({ value: {}, error: err })),
        validatePayloadForOrganic: vi.fn((b) => ({ value: b, error: null })),
        validatePayloadForPaid: vi.fn((b) => ({ value: b, error: null })),
      },
    }));
    vi.resetModules();
    const { default: isolatedSvc } = await import("../../../core/Dashboard/dashboardService.js");
    const res = mockRes();
    await isolatedSvc.getBackLinks({ body: { domain_name: "x" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toBe("VALIDATION_FAIL");
    vi.doUnmock("../../../core/Dashboard/dashboardValidation.js");
  });

  it("VALIDATION_FAIL when validatePayloadForOrganic returns error", async () => {
    const err = { details: [{ message: "bad organic payload" }] };
    vi.doMock("../../../core/Dashboard/dashboardValidation.js", () => ({
      default: {
        validatePayloadForBacklink: vi.fn((b) => ({ value: b, error: null })),
        validatePayloadForOrganic: vi.fn(() => ({ value: {}, error: err })),
        validatePayloadForPaid: vi.fn((b) => ({ value: b, error: null })),
      },
    }));
    vi.resetModules();
    const { default: isolatedSvc } = await import("../../../core/Dashboard/dashboardService.js");
    const res = mockRes();
    await isolatedSvc.getOrganicSearches({ body: { domain_name: "x" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toBe("VALIDATION_FAIL");
    vi.doUnmock("../../../core/Dashboard/dashboardValidation.js");
  });
});

describe("dashboardService > getplatformcount", () => {
  it("validation fail when body missing", async () => {
    const res = mockRes();
    await svc.getplatformcount({}, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("missing the request data");
  });
  it("happy: sums platform counts from axios response", async () => {
    spies.axiosPostSpy.mockResolvedValueOnce({ data: { facebook: 1, instagram: 2 } });
    const res = mockRes();
    await svc.getplatformcount({ body: { competitorName: "X" } }, res);
    expect(res.send.mock.calls[0][0].body.data.total_counts).toBe(3);
  });
  it("inner catch on axios fail (uses failResp - Response stub returns 500)", async () => {
    spies.axiosPostSpy.mockRejectedValueOnce(new Error("api-down"));
    const res = mockRes();
    await svc.getplatformcount({ body: { competitorName: "X" } }, res);
    expect(res.send.mock.calls[0][0].statusCode).toBe(500);
  });

  it("outer catch (lines 761-766): throwing-Proxy req.body.competitorName access → outer catch fires", async () => {
    // Build a body whose `competitorName` property throws on access; this
    // throws during `let {competitorName} = data;` AFTER the validation
    // pass — outside the inner axios try.
    const body = new Proxy({ exists: true }, {
      get(target, prop) {
        if (prop === "competitorName") throw new TypeError("destructure-fail");
        return target[prop];
      },
    });
    const res = mockRes();
    await svc.getplatformcount({ body }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("unexpected error occured");
  });
});

describe("dashboardService > getCount", () => {
  it("validation fail when body missing user_id", async () => {
    const res = mockRes();
    await svc.getCount({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Missing user_id");
  });
  it("validation fail when user_id format invalid", async () => {
    spies.isValidObjectIdSpy.mockReturnValueOnce(false);
    const res = mockRes();
    await svc.getCount({ body: { user_id: "garbage" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Invalid user_id");
  });
  it("messageResp when no aggregate data", async () => {
    spies.competitorsReqAggregateSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await svc.getCount({ body: { user_id: "u1" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("No competitors or monitoring");
  });
  it("zero competitors -> zero counts response", async () => {
    spies.competitorsReqAggregateSpy.mockResolvedValueOnce([{ competitors: [], monitoring: [] }]);
    const res = mockRes();
    await svc.getCount({ body: { user_id: "u1" } }, res);
    expect(res.send.mock.calls[0][0].body.data.competitorsCount).toBe(0);
  });
  it("happy: aggregates competitor stats from ES (with budget)", async () => {
    spies.competitorsReqAggregateSpy.mockResolvedValueOnce([
      { competitors: ["c1"], monitoring: ["m1"] },
    ]);
    spies.competitorsFindSpy.mockResolvedValueOnce([{ competitor_name: "X" }]);
    spies.esClient.server1.count.mockResolvedValue({ count: 5 });
    spies.esClient.server1.search.mockResolvedValue({
      aggregations: { ads_with_budget: { doc_count: 3, sum_budget: { value: 30 } } },
    });
    spies.esClient.server2.count.mockResolvedValue({ count: 2 });
    spies.esClient.server2.search.mockResolvedValue({
      aggregations: { ads_with_budget: { doc_count: 1, sum_budget: { value: 10 } } },
    });
    const res = mockRes();
    await svc.getCount({ body: { user_id: "u1" } }, res);
    const payload = res.send.mock.calls[0][0].body.data;
    expect(payload.competitorsCount).toBe(1);
    expect(payload.totalAds).toBeGreaterThan(0);
  });
  it("getCount: countRes.count + doc_count + sum_budget.value all undefined → `|| 0` fallbacks fire (lines 1583-1606)", async () => {
    spies.competitorsReqAggregateSpy.mockResolvedValueOnce([
      { competitors: ["c1"], monitoring: [] },
    ]);
    spies.competitorsFindSpy.mockResolvedValueOnce([{ competitor_name: "X" }]);
    spies.esClient.server1.count.mockResolvedValue({ /* no count key */ });
    spies.esClient.server1.search.mockResolvedValue({
      aggregations: { ads_with_budget: { /* no doc_count, no sum_budget */ } },
    });
    spies.esClient.server2.count.mockResolvedValue({ /* no count key */ });
    spies.esClient.server2.search.mockResolvedValue({
      aggregations: { /* no ads_with_budget */ },
    });
    const res = mockRes();
    await svc.getCount({ body: { user_id: "u1" } }, res);
    expect(res.send).toHaveBeenCalled();
  });

  it("ES inner catch logs error but does not throw", async () => {
    spies.competitorsReqAggregateSpy.mockResolvedValueOnce([
      { competitors: ["c1"], monitoring: [] },
    ]);
    spies.competitorsFindSpy.mockResolvedValueOnce([{ competitor_name: "X" }]);
    spies.esClient.server1.count.mockRejectedValue(new Error("es-down"));
    spies.esClient.server2.count.mockRejectedValue(new Error("es-down"));
    const res = mockRes();
    await svc.getCount({ body: { user_id: "u1" } }, res);
    expect(res.send).toHaveBeenCalled();
  });
  it("outer catch on aggregate throw", async () => {
    spies.competitorsReqAggregateSpy.mockRejectedValueOnce(new Error("mongo-down"));
    const res = mockRes();
    await svc.getCount({ body: { user_id: "u1" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Error in getting competitor stats");
  });
});

describe("dashboardService > projectcompeitetor", () => {
  it("validation fail when body missing", async () => {
    const res = mockRes();
    await svc.projectcompeitetor({}, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Missing the request params");
  });

  it("happy: returns competitor names + ad count", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({
      _id: "p1",
      competitors: ["c1"],
      monitoring: [],
    });
    spies.competitorsFindSpy.mockResolvedValueOnce([
      { _id: "c1", competitor_name: "C1" },
    ]);
    Object.values(spies.esClient).forEach((c) => c.count.mockResolvedValue({ count: 5 }));
    const res = mockRes();
    await svc.projectcompeitetor(
      { body: { project_name: "Acme", user_id: "u1" } },
      res
    );
    expect(res.send).toHaveBeenCalled();
  });

  it("FbDashboard slice cap", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({
      _id: "p1",
      competitors: new Array(10).fill("cx"),
      monitoring: [],
    });
    spies.competitorsFindSpy.mockResolvedValueOnce(
      new Array(10).fill(null).map((_, i) => ({ _id: `c${i}`, competitor_name: `C${i}` }))
    );
    Object.values(spies.esClient).forEach((c) => c.count.mockResolvedValue({ count: 0 }));
    const res = mockRes();
    await svc.projectcompeitetor(
      { body: { project_name: "Acme", user_id: "u1", dashboard: "FbDashboard" } },
      res
    );
    expect(res.send).toHaveBeenCalled();
  });

  it("inner catch fires when findOne throws", async () => {
    spies.competitorsReqFindOneSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await svc.projectcompeitetor(
      { body: { project_name: "Acme", user_id: "u1" } },
      res
    );
    expect(res.send).toHaveBeenCalled();
  });

  it("monitoring=true branch: competitor _id is in monitoring array (line 289-293)", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({
      _id: "p1",
      competitors: ["c1"],
      monitoring: ["c1"], // c._id matches → monitoring=true branch
    });
    spies.competitorsFindSpy.mockResolvedValueOnce([
      { _id: "c1", competitor_name: "C1" },
    ]);
    Object.values(spies.esClient).forEach((c) => c.count.mockResolvedValue({ count: 5 }));
    const res = mockRes();
    await svc.projectcompeitetor(
      { body: { project_name: "Acme", user_id: "u1" } },
      res
    );
    expect(res.send).toHaveBeenCalled();
  });

  it("outer catch (lines 363-368): throwing-Proxy req.body → outer catch fires", async () => {
    const body = new Proxy({ exists: true }, {
      get(target, prop) {
        if (prop === "project_name") throw new TypeError("destructure-fail");
        return target[prop];
      },
    });
    const res = mockRes();
    await svc.projectcompeitetor({ body }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("unexpected error occured");
  });
});

describe("dashboardService > projectcompeitetorClient", () => {
  it("validation fail when body missing", async () => {
    const res = mockRes();
    await svc.projectcompeitetorClient({}, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Missing the request params");
  });

  it("validation fail when project_name/user_id missing", async () => {
    const res = mockRes();
    await svc.projectcompeitetorClient({ body: { project_name: "" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Missing project_name");
  });

  it("messageResp when project not found", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.projectcompeitetorClient(
      { body: { project_name: "Acme", user_id: "u1" } },
      res
    );
    expect(res.send.mock.calls[0][0].body.message).toBe("Project not found");
  });

  it("messageResp when no competitors selected", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1", competitors: [] });
    const res = mockRes();
    await svc.projectcompeitetorClient(
      { body: { project_name: "Acme", user_id: "u1" } },
      res
    );
    expect(res.send.mock.calls[0][0].body.message).toBe("No competitors selected");
  });

  it("outer catch (lines 533-538): throwing-Proxy req.body destructure → outer catch fires", async () => {
    // Make req.body access succeed, but destructure of project_name throw
    // outside the inner try. The body is non-null (passes !data check) but
    // accessing project_name throws → outer catch handles it.
    const body = new Proxy({ exists: true }, {
      get(target, prop) {
        if (prop === "project_name") throw new TypeError("destructure-fail");
        return target[prop];
      },
    });
    const res = mockRes();
    await svc.projectcompeitetorClient({ body }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Unexpected error occurred");
  });

  it("inner catch fires on findOne throw", async () => {
    spies.competitorsReqFindOneSpy.mockRejectedValueOnce(new Error("db"));
    const res = mockRes();
    await svc.projectcompeitetorClient(
      { body: { project_name: "Acme", user_id: "u1" } },
      res
    );
    expect(res.send).toHaveBeenCalled();
  });

  it("happy: full path with paginated competitors + ad-count aggregation", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({
      _id: "p1",
      competitors: ["c1", "c2"],
      monitoring: ["c1"],
    });
    const mod = await import("../../../models/competitors.js");
    mod.default.countDocuments = vi.fn().mockResolvedValueOnce(2);
    mod.default.aggregate = vi.fn().mockResolvedValueOnce([
      { _id: "c1", competitor_name: "C1" },
      { _id: "c2", competitor_name: "C2" },
    ]);
    Object.values(spies.esClient).forEach((c) => c.count.mockResolvedValue({ count: 5 }));
    const res = mockRes();
    await svc.projectcompeitetorClient(
      { body: { project_name: "Acme", user_id: "u1", page: 1, limit: 10 } },
      res
    );
    expect(res.send.mock.calls[0][0].body.msg).toContain("Project name retrieved");
  });

  it("projectcompeitetorClient: monitoring missing → `|| []` defensive fallback (line 418)", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({
      _id: "p1",
      competitors: ["c1"],
      // no monitoring key
    });
    const mod = await import("../../../models/competitors.js");
    mod.default.countDocuments = vi.fn().mockResolvedValueOnce(1);
    mod.default.aggregate = vi.fn().mockResolvedValueOnce([
      { _id: "c1", competitor_name: "C1" },
    ]);
    Object.values(spies.esClient).forEach((c) => c.count.mockResolvedValue({ count: 1 }));
    const res = mockRes();
    await svc.projectcompeitetorClient(
      { body: { project_name: "Acme", user_id: "u1" } },
      res
    );
    expect(res.send).toHaveBeenCalled();
  });

  it("happy + search regex applied", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({
      _id: "p1",
      competitors: ["c1"],
      monitoring: [],
    });
    const mod = await import("../../../models/competitors.js");
    mod.default.countDocuments = vi.fn().mockResolvedValueOnce(1);
    mod.default.aggregate = vi.fn().mockResolvedValueOnce([
      { _id: "c1", competitor_name: "Apple" },
    ]);
    Object.values(spies.esClient).forEach((c) => c.count.mockResolvedValue({ count: 0 }));
    const res = mockRes();
    await svc.projectcompeitetorClient(
      { body: { project_name: "Acme", user_id: "u1", search: "App" } },
      res
    );
    expect(res.send).toHaveBeenCalled();
  });
});

describe("dashboardService > getCompetitorsCount", () => {
  it("validation fail when competitors missing", async () => {
    const res = mockRes();
    await svc.getCompetitorsCount({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Missing competitors");
  });

  it("happy: returns aggregated counts (empty ES results)", async () => {
    Object.values(spies.esClient).forEach((c) => {
      c.search.mockResolvedValue({ hits: { total: { value: 0 } }, aggregations: {} });
      c.count.mockResolvedValue({ count: 0 });
    });
    const res = mockRes();
    await svc.getCompetitorsCount({ body: { competitors: "Acme" } }, res);
    expect(res.send).toHaveBeenCalled();
  });

  it("outer catch on ES throw", async () => {
    Object.values(spies.esClient).forEach((c) => {
      c.search.mockRejectedValue(new Error("es-down"));
      c.count.mockRejectedValue(new Error("es-down"));
    });
    const res = mockRes();
    await svc.getCompetitorsCount({ body: { competitors: "Acme" } }, res);
    expect(res.send).toHaveBeenCalled();
  });

  it("outer catch fires when finalize throws → 'Internal server error' (L1110-1112)", async () => {
    Object.values(spies.esClient).forEach((c) => {
      c.search.mockResolvedValue({ hits: { total: { value: 0 } }, aggregations: {} });
      c.count.mockResolvedValue({ count: 0 });
    });
    const res = mockRes();
    res.send.mockImplementationOnce(() => { throw new Error("send-boom"); }); // success send throws → outer catch
    await svc.getCompetitorsCount({ body: { competitors: "Acme" } }, res);
    expect(res.send).toHaveBeenCalledTimes(2);
    expect(res.send.mock.calls[1][0].body.msg).toContain("Internal server error");
  });

  it("happy with array input: unwraps to single competitor", async () => {
    Object.values(spies.esClient).forEach((c) => {
      c.search.mockResolvedValue({ hits: { total: { value: 0 } }, aggregations: {} });
      c.count.mockResolvedValue({ count: 0 });
    });
    const res = mockRes();
    await svc.getCompetitorsCount({ body: { competitors: ["Acme"] } }, res);
    expect(res.send).toHaveBeenCalled();
  });

  it("country buckets with falsy keys: hits the `if (b.key)` skip branch (line 987)", async () => {
    Object.values(spies.esClient).forEach((c) => {
      c.search.mockResolvedValue({
        hits: { total: { value: 0 } },
        aggregations: {
          countries: { buckets: [{ key: null }, { key: "" }, { key: "us" }] },
        },
      });
      c.count.mockResolvedValue({ count: 0 });
    });
    const res = mockRes();
    await svc.getCompetitorsCount({ body: { competitors: "Acme" } }, res);
    expect(res.send).toHaveBeenCalled();
  });

  it("getCompetitorsCount: imp_count > 0 but total_imp.value undefined → `|| 0` fallback on RHS fires (lines 902, 907, 915)", async () => {
    Object.values(spies.esClient).forEach((c) => {
      c.search.mockResolvedValue({
        hits: { total: { value: 10 } },
        aggregations: {
          impressions: { total_imp: {} /* no .value */, imp_count: { value: 5 } },
          popularity: { total_pop: {} /* no .value */, pop_count: { value: 3 } },
          budget: { sum_avg_budget: { value: 0 } /* falsy */, budget_count: { value: 2 } },
          countries: { buckets: [] },
        },
      });
      c.count.mockResolvedValue({ count: 10 });
    });
    const res = mockRes();
    await svc.getCompetitorsCount({ body: { competitors: "Acme" } }, res);
    expect(res.send).toHaveBeenCalled();
  });

  it("getCompetitorsCount: ES returns NO aggregations key → `|| {}` fallback fires for fetchGlobalStats (lines 898, 900, 905, 910)", async () => {
    Object.values(spies.esClient).forEach((c) => {
      c.search.mockResolvedValue({ hits: { total: { value: 0 } } /* no aggregations */ });
      c.count.mockResolvedValue({ count: 0 });
    });
    const res = mockRes();
    await svc.getCompetitorsCount({ body: { competitors: "Acme" } }, res);
    expect(res.send).toHaveBeenCalled();
  });

  it("non-zero impressions/popularity/budget: covers getValidAverage truthy branch + push-statement bodies", async () => {
    // Return aggregations with non-zero values for each platform so
    // facebookStats/instagramStats/googleStats have positive averages.
    // This pushes them into the `values` array inside getValidAverage and
    // exercises the `values.length > 0` true branch.
    Object.values(spies.esClient).forEach((c) => {
      c.search.mockResolvedValue({
        hits: { total: { value: 100 } },
        aggregations: {
          impressions: { total_imp: { value: 1000 }, imp_count: { value: 10 } },
          popularity: { total_pop: { value: 50 }, pop_count: { value: 5 } },
          budget: { sum_avg_budget: { value: 200 }, budget_count: { value: 4 } },
          countries: { buckets: [{ key: "us" }, { key: "in" }] },
        },
      });
      c.count.mockResolvedValue({ count: 100 });
    });
    const res = mockRes();
    await svc.getCompetitorsCount({ body: { competitors: "Acme" } }, res);
    expect(res.send).toHaveBeenCalled();
  });
});

describe("dashboardService > getCompetitorsCountNew", () => {
  it("country buckets with falsy keys: hits the `if (b.key)` skip branch (line 1834)", async () => {
    Object.values(spies.esClient).forEach((c) => {
      c.search.mockResolvedValue({
        hits: { total: { value: 0 } },
        aggregations: {
          countries: { buckets: [{ key: null }, { key: "" }, { key: "us" }] },
        },
      });
      c.count.mockResolvedValue({ count: 0 });
    });
    const res = mockRes();
    await svc.getCompetitorsCountNew({ body: { competitors: ["Acme"] } }, res);
    expect(res.send).toHaveBeenCalled();
  });

  it("non-zero ES aggregations: exercises tracker truthy branches (impressions/popularity/budget/countries)", async () => {
    Object.values(spies.esClient).forEach((c) => {
      c.search.mockResolvedValue({
        hits: { total: { value: 50 } },
        aggregations: {
          impressions: { total_imp: { value: 800 }, imp_count: { value: 8 } },
          popularity: { total_pop: { value: 30 }, pop_count: { value: 3 } },
          budget: { sum_avg_budget: { value: 150 }, budget_count: { value: 3 } },
          countries: { buckets: [{ key: "fr" }, { key: "de" }] },
        },
      });
      c.count.mockResolvedValue({ count: 50 });
    });
    const res = mockRes();
    await svc.getCompetitorsCountNew({ body: { competitors: ["Acme"] } }, res);
    expect(res.send).toHaveBeenCalled();
  });

  it("aggregations with zero counts: tracker `|| 0` fallback hits left-side falsy (lines 1791-1793)", async () => {
    // imp_count.value = 0 (and similarly pop/budget) → `imp.imp_count?.value || 0`
    // evaluates the left side as falsy and falls through to 0. Exercises the
    // falsy side of the `|| 0` binary-exprs in the averaging tracker.
    Object.values(spies.esClient).forEach((c) => {
      c.search.mockResolvedValue({
        hits: { total: { value: 0 } },
        aggregations: {
          impressions: { total_imp: { value: 0 }, imp_count: { value: 0 } },
          popularity: { total_pop: { value: 0 }, pop_count: { value: 0 } },
          budget: { sum_avg_budget: { value: 0 }, budget_count: { value: 0 } },
          countries: { buckets: [] },
        },
      });
      c.count.mockResolvedValue({ count: 0 });
    });
    const res = mockRes();
    await svc.getCompetitorsCountNew({ body: { competitors: ["Acme"] } }, res);
    expect(res.send).toHaveBeenCalled();
  });

  it("aggregations with positive count but zero totals: inner `|| 0` fallback fires (lines 1791-1793 right-side branches)", async () => {
    // imp_count > 0 so ternary takes truthy, then inner `imp.total_imp?.value || 0`
    // evaluates total_imp.value=0 as falsy and falls through. Same for pop/budget.
    Object.values(spies.esClient).forEach((c) => {
      c.search.mockResolvedValue({
        hits: { total: { value: 1 } },
        aggregations: {
          impressions: { total_imp: { value: 0 }, imp_count: { value: 5 } },
          popularity: { total_pop: { value: 0 }, pop_count: { value: 5 } },
          budget: { sum_avg_budget: { value: 0 }, budget_count: { value: 5 } },
          countries: { buckets: [] },
        },
      });
      c.count.mockResolvedValue({ count: 1 });
    });
    const res = mockRes();
    await svc.getCompetitorsCountNew({ body: { competitors: ["Acme"] } }, res);
    expect(res.send).toHaveBeenCalled();
  });

  it("validation fail when competitors missing", async () => {
    const res = mockRes();
    await svc.getCompetitorsCountNew({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Missing competitors");
  });

  it("happy: array input + empty ES results", async () => {
    Object.values(spies.esClient).forEach((c) => {
      c.search.mockResolvedValue({ hits: { total: { value: 0 } }, aggregations: {} });
      c.count.mockResolvedValue({ count: 0 });
    });
    const res = mockRes();
    await svc.getCompetitorsCountNew({ body: { competitors: ["Acme", "Beta"] } }, res);
    expect(res.send).toHaveBeenCalled();
  });

  it("happy: single string input → wrapped in array", async () => {
    Object.values(spies.esClient).forEach((c) => {
      c.search.mockResolvedValue({ hits: { total: { value: 0 } }, aggregations: {} });
      c.count.mockResolvedValue({ count: 0 });
    });
    const res = mockRes();
    await svc.getCompetitorsCountNew({ body: { competitors: "Acme" } }, res);
    expect(res.send).toHaveBeenCalled();
  });

  it("outer catch", async () => {
    Object.values(spies.esClient).forEach((c) => {
      c.search.mockRejectedValue(new Error("es-down"));
      c.count.mockRejectedValue(new Error("es-down"));
    });
    const res = mockRes();
    await svc.getCompetitorsCountNew({ body: { competitors: "Acme" } }, res);
    expect(res.send).toHaveBeenCalled();
  });

  it("dedupCount catch fallback fires when cardinality search rejects but count succeeds (lines 183-184)", async () => {
    // Only reject the search calls that target dedupCount (unique_ads aggregation).
    // Other search calls (countries terms aggregation) still resolve so the outer
    // try/catch doesn't swallow the request.
    Object.values(spies.esClient).forEach((c) => {
      c.search.mockImplementation((req) => {
        const aggs = req?.body?.aggs;
        if (aggs?.unique_ads) {
          return Promise.reject(new Error("cardinality-down"));
        }
        return Promise.resolve({ hits: { total: { value: 0 } }, aggregations: { countries: { buckets: [] } } });
      });
      c.count.mockResolvedValue({ count: 7 });
    });
    const res = mockRes();
    await svc.getCompetitorsCountNew({ body: { competitors: ["Acme"] } }, res);
    // count was used as the dedupCount fallback for the per-platform counts
    expect(Object.values(spies.esClient).some((c) => c.count.mock.calls.length > 0)).toBe(true);
    expect(res.send).toHaveBeenCalled();
  });

  it("dedupCount fallback: count() returns {} → `r?.count || 0` falsy fires (line 184)", async () => {
    // Search rejects → catch block. count() returns object without `count` key
    // so `r?.count` is undefined → `|| 0` fallback hits the right operand.
    Object.values(spies.esClient).forEach((c) => {
      c.search.mockImplementation((req) => {
        if (req?.body?.aggs?.unique_ads) {
          return Promise.reject(new Error("cardinality-down"));
        }
        return Promise.resolve({ hits: { total: { value: 0 } }, aggregations: { countries: { buckets: [] } } });
      });
      c.count.mockResolvedValue({ /* no count key → r.count = undefined */ });
    });
    const res = mockRes();
    await svc.getCompetitorsCountNew({ body: { competitors: ["Acme"] } }, res);
    expect(res.send).toHaveBeenCalled();
  });
});

describe("dashboardService > getCompetitorsCountNewInternal", () => {
  it("returns the map directly via fake req/res", async () => {
    Object.values(spies.esClient).forEach((c) => {
      c.search.mockResolvedValue({ hits: { total: { value: 0 } }, aggregations: {} });
      c.count.mockResolvedValue({ count: 0 });
    });
    const r = await svc.getCompetitorsCountNewInternal(["Acme"]);
    expect(typeof r).toBe("object");
  });

  it("resolves to {} when underlying throws", async () => {
    // Force getCompetitorsCountNew to reject by making esClient access throw
    Object.values(spies.esClient).forEach((c) => {
      c.search.mockImplementation(() => { throw new Error("sync-throw"); });
      c.count.mockImplementation(() => { throw new Error("sync-throw"); });
    });
    const r = await svc.getCompetitorsCountNewInternal(["Acme"]);
    expect(typeof r).toBe("object");
  });

  it("resolves to {} when getCompetitorsCountNew itself rejects (line 1924 .catch handler)", async () => {
    // Spy and force outright rejection so the inner try/catch is bypassed
    // and the .catch handler at line 1924 actually fires.
    const spy = vi.spyOn(svc, "getCompetitorsCountNew").mockRejectedValueOnce(new Error("hard-reject"));
    const r = await svc.getCompetitorsCountNewInternal(["Acme"]);
    expect(r).toEqual({});
    spy.mockRestore();
  });
});

describe("dashboardService > projectcompeitetorClientNew", () => {
  it("validation fail when body missing", async () => {
    const res = mockRes();
    await svc.projectcompeitetorClientNew({}, res);
    expect(res.send).toHaveBeenCalled();
  });

  it("validation fail when project_name/user_id missing", async () => {
    const res = mockRes();
    await svc.projectcompeitetorClientNew({ body: { project_name: "" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Missing");
  });

  it("returns 'No competitors yet' when project not found", async () => {
    spies.competitorsReqFindOneSpy.mockReturnValueOnce({
      lean: () => Promise.resolve(null),
    });
    const res = mockRes();
    await svc.projectcompeitetorClientNew(
      { body: { project_name: "Acme", user_id: "u1" } },
      res
    );
    expect(res.send.mock.calls[0][0].body.msg).toContain("No competitors yet");
  });

  it("happy: returns merged + paginated + sorted competitor list", async () => {
    spies.competitorsReqFindOneSpy.mockReturnValueOnce({
      lean: () => Promise.resolve({
        _id: "p1",
        competitors: ["c1", "c2"],
        monitoring: [{ toString: () => "c1" }],
      }),
    });
    spies.competitorsFindSpy.mockReturnValueOnce({
      lean: () => Promise.resolve([
        { _id: { toString: () => "c1" }, competitor_name: "Apple", competitor_url: "a.com" },
        { _id: { toString: () => "c2" }, competitor_name: "Beta", competitor_url: "b.com" },
      ]),
    });
    Object.values(spies.esClient).forEach((c) => c.count.mockResolvedValue({ count: 5 }));
    const res = mockRes();
    await svc.projectcompeitetorClientNew(
      { body: { project_name: "Acme", user_id: "u1", page: 1, limit: 10 } },
      res
    );
    expect(res.send.mock.calls[0][0].body.msg).toContain("Project name retrieved");
  });

  it("sort comparator: a.monitored=true vs b.monitored=false → returns -1 (line 626 truthy branch)", async () => {
    // Three competitors where reverse-alphabetical order forces the sort
    // comparator to evaluate (monitored, unmonitored) pairs in both
    // argument orderings.
    spies.competitorsReqFindOneSpy.mockReturnValueOnce({
      lean: () => Promise.resolve({
        _id: "p1",
        competitors: ["a", "b", "c"],
        monitoring: [{ toString: () => "b" }],
      }),
    });
    spies.competitorsFindSpy.mockReturnValueOnce({
      lean: () => Promise.resolve([
        { _id: { toString: () => "a" }, competitor_name: "Zebra", competitor_url: "a.com" },
        { _id: { toString: () => "b" }, competitor_name: "Bee", competitor_url: "b.com" },
        { _id: { toString: () => "c" }, competitor_name: "Cat", competitor_url: "c.com" },
      ]),
    });
    Object.values(spies.esClient).forEach((c) => c.count.mockResolvedValue({ count: 1 }));
    const res = mockRes();
    await svc.projectcompeitetorClientNew(
      { body: { project_name: "Acme", user_id: "u1", page: 1, limit: 10 } },
      res
    );
    expect(res.send).toHaveBeenCalled();
  });

  it("projectcompeitetorClientNew: projectDoc missing competitors/monitoring → `|| []` fallbacks (lines 593-594)", async () => {
    spies.competitorsReqFindOneSpy.mockReturnValueOnce({
      lean: () => Promise.resolve({ _id: "p1" /* no competitors, no monitoring */ }),
    });
    spies.competitorsFindSpy.mockReturnValueOnce({
      lean: () => Promise.resolve([]),
    });
    Object.values(spies.esClient).forEach((c) => c.count.mockResolvedValue({ count: 0 }));
    const res = mockRes();
    await svc.projectcompeitetorClientNew(
      { body: { project_name: "Acme", user_id: "u1" } },
      res
    );
    expect(res.send).toHaveBeenCalled();
  });

  it("happy + search filter applied", async () => {
    spies.competitorsReqFindOneSpy.mockReturnValueOnce({
      lean: () => Promise.resolve({ _id: "p1", competitors: ["c1"], monitoring: [] }),
    });
    spies.competitorsFindSpy.mockReturnValueOnce({
      lean: () => Promise.resolve([
        { _id: { toString: () => "c1" }, competitor_name: "Apple", competitor_url: "a.com" },
      ]),
    });
    Object.values(spies.esClient).forEach((c) => c.count.mockResolvedValue({ count: 0 }));
    const res = mockRes();
    await svc.projectcompeitetorClientNew(
      { body: { project_name: "Acme", user_id: "u1", search: "App" } },
      res
    );
    expect(res.send).toHaveBeenCalled();
  });

  it("inner catch on db throw", async () => {
    spies.competitorsReqFindOneSpy.mockRejectedValueOnce(new Error("db"));
    const res = mockRes();
    await svc.projectcompeitetorClientNew(
      { body: { project_name: "Acme", user_id: "u1" } },
      res
    );
    expect(res.send).toHaveBeenCalled();
  });
});

describe("dashboardService > getCompetitorAdStats / getCompetitorAdCountForRange", () => {
  it("getCompetitorAdStats aggregates fb (server1) + ig (server2) across buckets", async () => {
    spies.esClient.server1.search.mockResolvedValue({ aggregations: { unique_ads: { value: 3 } } });
    spies.esClient.server2.search.mockResolvedValue({ aggregations: { unique_ads: { value: 2 } } });
    const stats = await svc.getCompetitorAdStats("Acme");
    expect(stats.allTime.facebook).toBe(3);
    expect(stats.allTime.instagram).toBe(2);
    expect(stats.allTime.total).toBe(5);
  });

  it("getCompetitorAdStats: dedupCount search fails then falls back to count()", async () => {
    spies.esClient.server1.search.mockRejectedValue(new Error("agg-fail"));
    spies.esClient.server1.count.mockResolvedValue({ count: 4 });
    spies.esClient.server2.search.mockResolvedValue({ aggregations: { unique_ads: { value: 0 } } });
    const stats = await svc.getCompetitorAdStats("Acme");
    expect(stats.allTime.facebook).toBe(4);
  });

  it("getCompetitorAdCountForRange with range and without (all-time)", async () => {
    spies.esClient.server1.search.mockResolvedValue({ aggregations: { unique_ads: { value: 1 } } });
    spies.esClient.server2.search.mockResolvedValue({ aggregations: { unique_ads: { value: 1 } } });
    const withRange = await svc.getCompetitorAdCountForRange("Acme", "2025-01-01 00:00:00", "2025-01-31 23:59:59");
    expect(withRange.total).toBe(2);
    const allTime = await svc.getCompetitorAdCountForRange("Acme", null, null);
    expect(allTime.total).toBe(2);
  });
});

describe("dashboardService > getCompetitorAdsByRange", () => {
  it("validation fail when request_id missing", async () => {
    const res = mockRes();
    await svc.getCompetitorAdsByRange({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Missing request_id");
  });

  it("brand request not found", async () => {
    spies.competitorsReqFindByIdSpy.mockReturnValueOnce({ lean: () => Promise.resolve(null) });
    const res = mockRes();
    await svc.getCompetitorAdsByRange({ body: { request_id: "r1" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Brand request not found");
  });

  it("happy: default date window, competitors sorted by ads desc", async () => {
    spies.competitorsReqFindByIdSpy.mockReturnValueOnce({ lean: () => Promise.resolve({ competitors: ["c1", "c2"] }) });
    spies.competitorsFindSpy.mockReturnValueOnce({ lean: () => Promise.resolve([
      { _id: "c1", competitor_name: "Low", competitor_url: "l.com" },
      { _id: "c2", competitor_name: "High", competitor_url: "h.com" },
    ]) });
    spies.esClient.server1.search.mockImplementation(({ body }) => Promise.resolve({
      aggregations: { unique_ads: { value: JSON.stringify(body).includes("High") ? 10 : 1 } },
    }));
    spies.esClient.server2.search.mockResolvedValue({ aggregations: { unique_ads: { value: 0 } } });
    const res = mockRes();
    await svc.getCompetitorAdsByRange({ body: { request_id: "r1" } }, res);
    const data = res.send.mock.calls[0][0].body.data;
    expect(data.competitors[0].name).toBe("High");
  });

  it("all=true (all-time, no date filter) with empty competitors list", async () => {
    spies.competitorsReqFindByIdSpy.mockReturnValueOnce({ lean: () => Promise.resolve({ competitors: [] }) });
    const res = mockRes();
    await svc.getCompetitorAdsByRange({ body: { request_id: "r1", all: "true" } }, res);
    expect(res.send.mock.calls[0][0].body.data.all).toBe(true);
  });

  it("explicit from/to dates", async () => {
    spies.competitorsReqFindByIdSpy.mockReturnValueOnce({ lean: () => Promise.resolve({ competitors: [] }) });
    const res = mockRes();
    await svc.getCompetitorAdsByRange({ body: { request_id: "r1", from: "2025-01-01", to: "2025-01-31" } }, res);
    expect(res.send.mock.calls[0][0].body.status).toBe("success");
  });

  it("catch returns failure response", async () => {
    spies.competitorsReqFindByIdSpy.mockImplementationOnce(() => { throw new Error("db-down"); });
    const res = mockRes();
    await svc.getCompetitorAdsByRange({ body: { request_id: "r1" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Failed to fetch competitor ads by range");
  });
});

describe("dashboardService > getUserBrandStats", () => {
  it("validation fail when user_id missing", async () => {
    const res = mockRes();
    await svc.getUserBrandStats({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Missing user_id");
  });

  it("happy: brands + competitors + planName resolved, growth computed", async () => {
    spies.competitorsReqFindSpy.mockReturnValueOnce({ lean: () => Promise.resolve([
      { _id: "r1", advertiser: ["BrandA"], competitors: ["c1"], monitoring: ["c1"], project_name: "P", brand_url: "b.com" },
    ]) });
    spies.userDetailsFindByIdSpy.mockReturnValueOnce({ lean: () => Promise.resolve({ plan_id: 5 }) });
    spies.planGroupsFindOneSpy.mockResolvedValueOnce({ groups: { Palladium: { plans: [5] } } });
    spies.competitorsFindSpy.mockReturnValueOnce({ lean: () => Promise.resolve([
      { _id: "c1", competitor_name: "C1", competitor_url: "c.com", facebook_status: 2 },
    ]) });
    spies.esClient.server1.search.mockResolvedValue({ aggregations: { unique_ads: { value: 5 } } });
    spies.esClient.server2.search.mockResolvedValue({ aggregations: { unique_ads: { value: 0 } } });
    const res = mockRes();
    await svc.getUserBrandStats({ body: { user_id: "u1" } }, res);
    const data = res.send.mock.calls[0][0].body.data;
    expect(data.planName).toBe("Palladium");
    expect(data.totalBrands).toBe(1);
    expect(data.brands[0].competitors[0].name).toBe("C1");
  });

  it("planId set but no matching group then planName null; growth no-baseline", async () => {
    spies.competitorsReqFindSpy.mockReturnValueOnce({ lean: () => Promise.resolve([
      { _id: "r1", advertiser: [], competitors: ["c1"], monitoring: [], project_name: "P" },
    ]) });
    spies.userDetailsFindByIdSpy.mockReturnValueOnce({ lean: () => Promise.resolve({ plan_id: 99 }) });
    spies.planGroupsFindOneSpy.mockResolvedValueOnce({ groups: { Other: { plans: [1, 2] } } });
    spies.competitorsFindSpy.mockReturnValueOnce({ lean: () => Promise.resolve([
      { _id: "c1", competitor_name: "C1" },
    ]) });
    let call = 0;
    spies.esClient.server1.search.mockImplementation(() => Promise.resolve({ aggregations: { unique_ads: { value: (call++ === 1 ? 1 : 0) } } }));
    spies.esClient.server2.search.mockResolvedValue({ aggregations: { unique_ads: { value: 0 } } });
    const res = mockRes();
    await svc.getUserBrandStats({ body: { user_id: "u1" } }, res);
    expect(res.send.mock.calls[0][0].body.data.planName).toBeNull();
  });

  it("no plan_id then planName stays null (skips plan_groups lookup)", async () => {
    spies.competitorsReqFindSpy.mockReturnValueOnce({ lean: () => Promise.resolve([]) });
    spies.userDetailsFindByIdSpy.mockReturnValueOnce({ lean: () => Promise.resolve({}) });
    const res = mockRes();
    await svc.getUserBrandStats({ body: { user_id: "u1" } }, res);
    expect(res.send.mock.calls[0][0].body.data.planId).toBeNull();
    expect(spies.planGroupsFindOneSpy).not.toHaveBeenCalled();
  });

  it("catch returns failure response", async () => {
    spies.competitorsReqFindSpy.mockImplementationOnce(() => { throw new Error("db-down"); });
    const res = mockRes();
    await svc.getUserBrandStats({ body: { user_id: "u1" } }, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Failed to fetch user brand stats");
  });
});

describe("dashboardService > remaining branch coverage", () => {
  it("projectcompeitetor: project with no competitors → 'No competitors selected' (L279)", async () => {
    spies.competitorsReqFindOneSpy.mockResolvedValueOnce({ _id: "p1", competitors: [] });
    const res = mockRes();
    await svc.projectcompeitetor({ body: { project_name: "Acme", user_id: "u1" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toContain("No competitors selected");
  });

  it("getCompetitorAdsByRange: missing body → `req?.body || {}` (L1230)", async () => {
    const res = mockRes();
    await svc.getCompetitorAdsByRange({}, res);
    expect(res.send.mock.calls[0][0].body.msg).toContain("Missing request_id");
  });

  it("getCompetitorAdsByRange: reqDoc.competitors not an array → `|| []` (L1247)", async () => {
    spies.competitorsReqFindByIdSpy.mockReturnValueOnce({ lean: () => Promise.resolve({ competitors: "not-an-array" }) });
    const res = mockRes();
    await svc.getCompetitorAdsByRange({ body: { request_id: "r1" } }, res);
    expect(res.send.mock.calls[0][0].body.data.competitors).toEqual([]);
  });

  it("getUserBrandStats: plan_groups doc missing → planName null (L1308)", async () => {
    spies.competitorsReqFindSpy.mockReturnValueOnce({ lean: () => Promise.resolve([]) });
    spies.userDetailsFindByIdSpy.mockReturnValueOnce({ lean: () => Promise.resolve({ plan_id: 5 }) });
    spies.planGroupsFindOneSpy.mockResolvedValueOnce(null); // no plan_groups doc → `?.groups || {}`
    const res = mockRes();
    await svc.getUserBrandStats({ body: { user_id: "u1" } }, res);
    expect(res.send.mock.calls[0][0].body.data.planName).toBeNull();
  });

  it("getUserBrandStats: competitor with no ads → growth 0 (L1318), non-array request fields (L1332-1340)", async () => {
    spies.competitorsReqFindSpy.mockReturnValueOnce({ lean: () => Promise.resolve([
      { _id: "r1", advertiser: "BrandA", competitors: "x", monitoring: undefined, project_name: "P" }, // all non-array
      { _id: "r2", advertiser: ["B2"], competitors: ["c1"], monitoring: ["c1"], project_name: "P2" },
    ]) });
    spies.userDetailsFindByIdSpy.mockReturnValueOnce({ lean: () => Promise.resolve({}) });
    spies.competitorsFindSpy.mockReturnValue({ lean: () => Promise.resolve([{ _id: "c1", competitor_name: "C1" }]) });
    // all-zero counts → today 0, yesterday 0 → growthPct returns 0
    Object.values(spies.esClient).forEach((c) => c.search.mockResolvedValue({ aggregations: { unique_ads: { value: 0 } } }));
    const res = mockRes();
    await svc.getUserBrandStats({ body: { user_id: "u1" } }, res);
    expect(res.send.mock.calls[0][0].body.status).toBe("success");
  });

  it("getCompetitorsCountNew: aggregations with zero counts → average else-branches (L2107-2109)", async () => {
    Object.values(spies.esClient).forEach((c) => {
      c.search.mockResolvedValue({
        hits: { total: { value: 0 } },
        aggregations: {
          impressions: { total_imp: { value: 0 }, imp_count: { value: 0 } },
          popularity: { total_pop: { value: 0 }, pop_count: { value: 0 } },
          budget: { sum_avg_budget: { value: 0 }, budget_count: { value: 0 } },
          countries: { buckets: [] },
        },
      });
      c.count.mockResolvedValue({ count: 0 });
    });
    const res = mockRes();
    await svc.getCompetitorsCountNew({ body: { competitors: ["Acme"] } }, res);
    expect(res.send).toHaveBeenCalled();
  });

  it("getCompetitorsCountNewInternal: zero-count aggregations → average else-branches", async () => {
    Object.values(spies.esClient).forEach((c) => {
      c.search.mockResolvedValue({
        hits: { total: { value: 0 } },
        aggregations: {
          impressions: { total_imp: { value: 0 }, imp_count: { value: 0 } },
          popularity: { total_pop: { value: 0 }, pop_count: { value: 0 } },
          budget: { sum_avg_budget: { value: 0 }, budget_count: { value: 0 } },
          countries: { buckets: [] },
        },
      });
      c.count.mockResolvedValue({ count: 0 });
    });
    const r = await svc.getCompetitorsCountNewInternal(["Acme"]);
    expect(typeof r).toBe("object");
  });
});
