import { describe, it, expect, vi, beforeEach } from "vitest";

const { searchSpy, countSpy, graphSpy, countriesSpy, loggerErrorSpy, loggerInfoSpy } =
  vi.hoisted(() => ({
    searchSpy: vi.fn(),
    countSpy: vi.fn(),
    graphSpy: vi.fn(),
    countriesSpy: vi.fn(),
    loggerErrorSpy: vi.fn(),
    loggerInfoSpy: vi.fn(),
  }));

vi.mock("../../../utils/elasticSearch.js", () => ({
  searchFilterAds: searchSpy,
  getAdsCountList: countSpy,
  getAdsCountGraphList: graphSpy,
  getAdsCountCountryList: countriesSpy,
}));

vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { info: loggerInfoSpy, error: loggerErrorSpy, warn: vi.fn() },
}));

let svc;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [searchSpy, countSpy, graphSpy, countriesSpy, loggerErrorSpy, loggerInfoSpy])
    s.mockReset();
  ({ default: svc } = await import(
    "../../../core/guestUser/guestUser.service.js"
  ));
});

function mockRes() {
  const res = {};
  res.send = vi.fn(() => res);
  return res;
}

describe("guestUser.service > guestUserSearchAds", () => {
  it("returns 'No ads found' when searchFilterAds returns empty", async () => {
    searchSpy.mockResolvedValueOnce([]);
    const res = mockRes();
    await svc.guestUserSearchAds({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("No ads found");
  });

  it("maps sortBy='Newest' -> sortOrder='createdAt'", async () => {
    searchSpy.mockResolvedValueOnce({ ads: [], totalAds: 0 });
    const res = mockRes();
    await svc.guestUserSearchAds({ body: { sortBy: "Newest" } }, res);
    expect(searchSpy.mock.calls[0][0].sortOrder).toBe("createdAt");
  });

  it("maps sortBy='LastSeen' -> sortOrder='updatedAt'", async () => {
    searchSpy.mockResolvedValueOnce({ ads: [], totalAds: 0 });
    const res = mockRes();
    await svc.guestUserSearchAds({ body: { sortBy: "LastSeen" } }, res);
    expect(searchSpy.mock.calls[0][0].sortOrder).toBe("updatedAt");
  });

  it("maps sortBy='domain_date' -> sortOrder='domain_registered_date'", async () => {
    searchSpy.mockResolvedValueOnce({ ads: [], totalAds: 0 });
    const res = mockRes();
    await svc.guestUserSearchAds({ body: { sortBy: "domain_date" } }, res);
    expect(searchSpy.mock.calls[0][0].sortOrder).toBe(
      "domain_registered_date"
    );
  });

  it("maps sortBy='days_running' -> sortOrder='days_running'", async () => {
    searchSpy.mockResolvedValueOnce({ ads: [], totalAds: 0 });
    const res = mockRes();
    await svc.guestUserSearchAds({ body: { sortBy: "days_running" } }, res);
    expect(searchSpy.mock.calls[0][0].sortOrder).toBe("days_running");
  });

  it("strips 'https://' prefix from domain (11 chars after offset 8)", async () => {
    searchSpy.mockResolvedValueOnce({ ads: [], totalAds: 0 });
    const res = mockRes();
    await svc.guestUserSearchAds(
      { body: { domain: "https://example.com/page" } },
      res
    );
    // substring(8, 19) of 'https://example.com/page' = 'example.com'
    expect(searchSpy.mock.calls[0][0].domain).toBe("example.com");
  });

  it("strips 'http://' prefix from domain (11 chars after offset 7)", async () => {
    searchSpy.mockResolvedValueOnce({ ads: [], totalAds: 0 });
    const res = mockRes();
    await svc.guestUserSearchAds(
      { body: { domain: "http://example.com/foo" } },
      res
    );
    // substring(7, 18) of 'http://example.com/foo' = 'example.com'
    expect(searchSpy.mock.calls[0][0].domain).toBe("example.com");
  });

  it("leaves bare domain unchanged (takes first 11 chars)", async () => {
    searchSpy.mockResolvedValueOnce({ ads: [], totalAds: 0 });
    const res = mockRes();
    await svc.guestUserSearchAds({ body: { domain: "example.com" } }, res);
    expect(searchSpy.mock.calls[0][0].domain).toBe("example.com");
  });

  it("returns searchFilterResp on success", async () => {
    searchSpy.mockResolvedValueOnce({ ads: [{ id: 1 }], totalAds: 1 });
    const res = mockRes();
    await svc.guestUserSearchAds({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Fetched ads successfully"
    );
  });

  it("catches error and returns 'Error fetching ads'", async () => {
    searchSpy.mockRejectedValueOnce(new Error("es-down"));
    const res = mockRes();
    await svc.guestUserSearchAds({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Error fetching ads");
  });
});

describe("guestUser.service > getAdsCount", () => {
  it("returns counts on success", async () => {
    countSpy.mockResolvedValueOnce({ total: 42 });
    const res = mockRes();
    await svc.getAdsCount({ body: { type: 1 } }, res);
    expect(countSpy).toHaveBeenCalledWith({ type: 1 });
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Ads count fetched successfully"
    );
  });

  it("catches error and returns 'Error fetching log file'", async () => {
    countSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.getAdsCount({ body: {} }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Error fetching log file");
  });
});

describe("guestUser.service > getAdsCountGraph", () => {
  it("returns graph for network='tiktok'", async () => {
    graphSpy.mockResolvedValueOnce([{ x: 1 }]);
    const res = mockRes();
    await svc.getAdsCountGraph({ body: { network: "tiktok" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Ads Grpah count fetched successfully"
    );
  });

  it("returns 'Not a Valid Network' for unknown network", async () => {
    const res = mockRes();
    await svc.getAdsCountGraph({ body: { network: "other" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Not a Valid Network");
  });

  it("catches error and returns 'Error Graph count'", async () => {
    graphSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.getAdsCountGraph({ body: { network: "tiktok" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Error Graph count ");
  });
});

describe("guestUser.service > getAdsCountCountries", () => {
  it("returns country count for network='tiktok'", async () => {
    countriesSpy.mockResolvedValueOnce([{ c: "IN" }]);
    const res = mockRes();
    await svc.getAdsCountCountries(
      { body: { network: "tiktok", range: "30d" } },
      res
    );
    expect(countriesSpy).toHaveBeenCalledWith("30d");
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Ads Grpah country count fetched successfully"
    );
  });

  it("returns 'Not a Valid Network' for unknown network", async () => {
    const res = mockRes();
    await svc.getAdsCountCountries({ body: { network: "other" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe("Not a Valid Network");
  });

  it("catches error and returns 'Error Graph country count'", async () => {
    countriesSpy.mockRejectedValueOnce(new Error("boom"));
    const res = mockRes();
    await svc.getAdsCountCountries({ body: { network: "tiktok" } }, res);
    expect(res.send.mock.calls[0][0].body.message).toBe(
      "Error Graph country count "
    );
  });
});
