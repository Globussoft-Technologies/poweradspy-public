import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  findAllSpy, searchFilterSpy, getAdsCountSpy, getCountriesSpy,
  insertUserAdsCountSpy, loggerErrorSpy, titleCaseSpy,
} = vi.hoisted(() => ({
  findAllSpy: vi.fn(),
  searchFilterSpy: vi.fn(),
  getAdsCountSpy: vi.fn(),
  getCountriesSpy: vi.fn(),
  insertUserAdsCountSpy: vi.fn(),
  loggerErrorSpy: vi.fn(),
  titleCaseSpy: vi.fn((s) => s),
}));

vi.mock("title-case", () => ({ titleCase: titleCaseSpy }));

vi.mock("../../../utils/elasticSearch.js", () => ({
  searchFilterAds: searchFilterSpy,
  getAdsCount: getAdsCountSpy,
  getCountries: getCountriesSpy,
}));

vi.mock("../../../Sequelize_cli/models/index.js", () => ({
  default: {
    tiktok_ad_country_info: { findAll: findAllSpy },
  },
}));

vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { info: vi.fn(), error: loggerErrorSpy, warn: vi.fn() },
}));

vi.mock("../../../core/userAction/userActionAPI.service.js", () => ({
  default: { insertUserAdsCount: insertUserAdsCountSpy },
}));

// Use the real industries module so categories[].label values are real.
// titleCase is mocked to return the input unchanged so the category
// matching in the SUT stays predictable.

let svc;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [findAllSpy, searchFilterSpy, getAdsCountSpy, getCountriesSpy, insertUserAdsCountSpy, loggerErrorSpy])
    s.mockReset();
  titleCaseSpy.mockImplementation((s) => s);
  insertUserAdsCountSpy.mockResolvedValue({ code: 200 });
  ({ default: svc } = await import(
    "../../../core/dashboard/dashboard.service.js"
  ));
});

function mockRes() {
  const res = {};
  res.send = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

function fullBody(overrides = {}) {
  return {
    keyword: "", advertiser: "", domain: "",
    country: [], gender: [], age: [], language: [], budget: [], industry: [],
    ...overrides,
  };
}

const fakeUser = {
  user_id: 1, user_name: "u", user_email: "u@x", userSubscriptionType: { pro: true },
};

describe("dashboard.service > searchFilter", () => {
  it("short-circuits when insertUserAdsCount returns code=205", async () => {
    insertUserAdsCountSpy.mockResolvedValueOnce({ code: 205, message: "limit reached" });
    const res = mockRes();
    await svc.searchFilter({ body: fullBody(), user: fakeUser }, res);
    expect(res.send).toHaveBeenCalledWith({ code: 205, message: "limit reached" });
  });

  it("maps sortBy='Newest' -> sortOrder='createdAt'", async () => {
    findAllSpy.mockResolvedValueOnce([]);
    searchFilterSpy.mockResolvedValueOnce({ ads: [{ sql_id: 1 }], totalAds: 1 });
    const res = mockRes();
    await svc.searchFilter({ body: fullBody({ sortBy: "Newest" }), user: fakeUser }, res);
    expect(searchFilterSpy.mock.calls[0][0].sortOrder).toBe("createdAt");
  });

  it("maps sortBy='LastSeen' -> 'updatedAt'", async () => {
    findAllSpy.mockResolvedValueOnce([]);
    searchFilterSpy.mockResolvedValueOnce({ ads: [{ sql_id: 1 }], totalAds: 1 });
    const res = mockRes();
    await svc.searchFilter({ body: fullBody({ sortBy: "LastSeen" }), user: fakeUser }, res);
    expect(searchFilterSpy.mock.calls[0][0].sortOrder).toBe("updatedAt");
  });

  it("maps sortBy='domain_date' -> 'domain_registered_date'", async () => {
    findAllSpy.mockResolvedValueOnce([]);
    searchFilterSpy.mockResolvedValueOnce({ ads: [{ sql_id: 1 }], totalAds: 1 });
    const res = mockRes();
    await svc.searchFilter({ body: fullBody({ sortBy: "domain_date" }), user: fakeUser }, res);
    expect(searchFilterSpy.mock.calls[0][0].sortOrder).toBe(
      "domain_registered_date"
    );
  });

  it("maps sortBy='days_running' -> 'days_running'", async () => {
    findAllSpy.mockResolvedValueOnce([]);
    searchFilterSpy.mockResolvedValueOnce({ ads: [{ sql_id: 1 }], totalAds: 1 });
    const res = mockRes();
    await svc.searchFilter({ body: fullBody({ sortBy: "days_running" }), user: fakeUser }, res);
    expect(searchFilterSpy.mock.calls[0][0].sortOrder).toBe("days_running");
  });

  it("sortMetric with .min overrides sortOrder (last key wins: ctr)", async () => {
    findAllSpy.mockResolvedValueOnce([]);
    searchFilterSpy.mockResolvedValueOnce({ ads: [{ sql_id: 1 }], totalAds: 1 });
    const res = mockRes();
    await svc.searchFilter(
      {
        body: fullBody({
          likes: { min: 5 }, shares: { min: 5 },
          comments: { min: 5 }, impression: { min: 5 },
          popularity: { min: 5 }, ctr: { min: 5 },
        }),
        user: fakeUser,
      },
      res
    );
    expect(searchFilterSpy.mock.calls[0][0].sortOrder).toBe("ctr");
  });

  it("strips https?:// and trailing path/.tld from domain", async () => {
    findAllSpy.mockResolvedValueOnce([]);
    searchFilterSpy.mockResolvedValueOnce({ ads: [{ sql_id: 1 }], totalAds: 1 });
    const res = mockRes();
    await svc.searchFilter(
      { body: fullBody({ domain: "https://example.com/foo" }), user: fakeUser }, res
    );
    expect(searchFilterSpy.mock.calls[0][0].domain).toBe("example");
  });

  it("maps country names to iso codes via countryData findAll", async () => {
    findAllSpy.mockResolvedValueOnce([{ iso: "IN" }, { iso: "US" }]);
    searchFilterSpy.mockResolvedValueOnce({ ads: [{ sql_id: 1 }], totalAds: 1 });
    const res = mockRes();
    await svc.searchFilter(
      { body: fullBody({ country: ["INDIA", "USA"] }), user: fakeUser }, res
    );
    expect(searchFilterSpy.mock.calls[0][0].countryName).toEqual(["IN", "US"]);
  });

  it("returns 'Fetched ads successfully' on success (getAllAds=false branch — empty filters)", async () => {
    findAllSpy.mockResolvedValueOnce([]);
    searchFilterSpy.mockResolvedValueOnce({
      ads: [{ sql_id: 1 }, { sql_id: 1 }],
      totalAds: 99,
    });
    const res = mockRes();
    await svc.searchFilter({ body: fullBody(), user: fakeUser }, res);
    const payload = res.send.mock.calls[0][0];
    expect(payload.body.message).toBe("Fetched ads successfully");
    expect(payload.body.totalAds).toBe(99);
  });

  it("returns success via getAllAds=true branch when any filter set", async () => {
    findAllSpy.mockResolvedValueOnce([]);
    searchFilterSpy.mockResolvedValueOnce({
      ads: [{ sql_id: 1 }], totalAds: 5, searchFilterAds: 88,
    });
    const res = mockRes();
    await svc.searchFilter(
      { body: fullBody({ keyword: "shoes" }), user: fakeUser }, res
    );
    expect(res.send.mock.calls[0][0].body.totalAds).toBe(88);
  });

  it("catches error and returns 'Error fetching ads'", async () => {
    findAllSpy.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await svc.searchFilter({ body: fullBody(), user: fakeUser }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Error fetching ads");
  });

  it("returns 'No ads found' when searchFilterAds returns an empty array (length === 0)", async () => {
    findAllSpy.mockResolvedValueOnce([]);
    searchFilterSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await svc.searchFilter({ body: fullBody(), user: fakeUser }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("No ads found");
  });
});

describe("dashboard.service > getAllAds (boolean helper)", () => {
  it("returns false when no filters set", async () => {
    const out = await svc.getAllAds(fullBody());
    expect(out).toBe(false);
  });

  it("returns true when keyword set", async () => {
    expect(await svc.getAllAds(fullBody({ keyword: "x" }))).toBe(true);
  });

  it("returns true when country has items", async () => {
    expect(await svc.getAllAds(fullBody({ country: ["IN"] }))).toBe(true);
  });
});

describe("dashboard.service > getAdsCountDetails", () => {
  it("returns count from elasticSearch", async () => {
    getAdsCountSpy.mockResolvedValueOnce({ total: 99 });
    const res = mockRes();
    await svc.getAdsCountDetails({ body: { domain: "x", keyword: "y", advertiser: "z" } }, res);
    expect(getAdsCountSpy).toHaveBeenCalledWith({
      domain: "x", keyword: "y", advertiser: "z",
    });
    expect(res.json).toHaveBeenCalledWith({ total: 99 });
  });

  it("catches error and returns INTERNAL_ERROR", async () => {
    getAdsCountSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.getAdsCountDetails({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("INTERNAL_ERROR");
  });
});

describe("dashboard.service > getIndustries", () => {
  it("returns mapped categories when a known Education item matches", async () => {
    // 'Higher Education' is a real item in the Education[] array, so
    // the for-of finds Education's items.includes("Higher Education")
    // true and pushes it into the Education category's subcategories.
    getCountriesSpy.mockResolvedValueOnce([{ key: "Higher Education" }]);
    const res = mockRes();
    await svc.getIndustries({}, res);
    const payload = res.send.mock.calls[0][0];
    expect(payload.body.message).toBe("Fetched industries successfully");
    const education = payload.body.data.find((c) => c.label === "Education");
    expect(education.subcategories).toContain("Higher Education");
  });

  it("ignores industries that don't match any known subcategory", async () => {
    getCountriesSpy.mockResolvedValueOnce([{ key: "NonExistentIndustry" }]);
    const res = mockRes();
    await svc.getIndustries({}, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Fetched industries successfully"
    );
  });

  it("returns 'No industries found' when getCountries returns empty array", async () => {
    getCountriesSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await svc.getIndustries({}, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("No industries found");
  });

  it("returns 'No industries found' when getCountries returns null", async () => {
    getCountriesSpy.mockResolvedValueOnce(null);
    const res = mockRes();
    await svc.getIndustries({}, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("No industries found");
  });

  it("returns 'No industries found' when getCountries returns non-array", async () => {
    getCountriesSpy.mockResolvedValueOnce("not-array");
    const res = mockRes();
    await svc.getIndustries({}, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("No industries found");
  });

  it("catches error and returns 'Failed to fetch industries'", async () => {
    getCountriesSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.getIndustries({}, res);
    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Failed to fetch industries"
    );
  });
});
