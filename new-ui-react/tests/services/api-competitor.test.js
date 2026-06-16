// Tests for competitorFetch + CompetitorAPI methods in src/services/api.js.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAuthTokenSpy, clearSessionSpy } = vi.hoisted(() => ({
  getAuthTokenSpy: vi.fn(() => "tk"),
  clearSessionSpy: vi.fn(),
}));

vi.mock("../../src/hooks/useAuth", () => ({
  getAuthToken: getAuthTokenSpy,
  clearSessionState: clearSessionSpy,
}));

let api;
beforeEach(async () => {
  vi.resetModules();
  getAuthTokenSpy.mockReset().mockReturnValue("tk");
  clearSessionSpy.mockReset();
  globalThis.fetch = vi.fn();
  Object.defineProperty(window, "location", {
    writable: true, configurable: true,
    value: { ...window.location, pathname: "/dashboard", href: "" },
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  api = await import("../../src/services/api.js");
});

describe("competitorFetch", () => {
  it("sends Bearer token + JSON content type, returns parsed body", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ x: 1 }),
    });
    const out = await api.competitorFetch("/foo");
    expect(out).toEqual({ x: 1 });
    expect(globalThis.fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer tk");
    expect(globalThis.fetch.mock.calls[0][1].headers["Content-Type"]).toBe("application/json");
  });
  it("no token → no Authorization header", async () => {
    getAuthTokenSpy.mockReturnValue("");
    vi.stubEnv("VITE_PAS_API_TOKEN", "");
    vi.resetModules();
    api = await import("../../src/services/api.js");
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ x: 1 }),
    });
    await api.competitorFetch("/foo");
    expect(globalThis.fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
    vi.unstubAllEnvs();
  });
  it("merges custom headers from options", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    await api.competitorFetch("/foo", { headers: { "X-Custom": "yes" } });
    expect(globalThis.fetch.mock.calls[0][1].headers["X-Custom"]).toBe("yes");
  });
  it("body JSON parsing failure → data=null returned on success path", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => { throw new Error("bad-json"); },
    });
    expect(await api.competitorFetch("/foo")).toBeNull();
  });
  it("401 → triggers handle401 + throws", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: false, status: 401, json: async () => ({}),
    });
    await expect(api.competitorFetch("/foo")).rejects.toThrow(/Unauthorized/);
    expect(window.location.href).toBe("http://localhost:3000/logout");
  });
  it("non-ok non-401 → throws with path + status", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: false, status: 500, json: async () => ({}),
    });
    await expect(api.competitorFetch("/foo")).rejects.toThrow(/\/foo failed: 500/);
  });
  it("forwards method + body from options", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    await api.competitorFetch("/x", { method: "POST", body: JSON.stringify({ y: 1 }) });
    expect(globalThis.fetch.mock.calls[0][1].method).toBe("POST");
    expect(globalThis.fetch.mock.calls[0][1].body).toBe('{"y":1}');
  });
});

function mockFetchResponse(body) {
  globalThis.fetch.mockResolvedValueOnce({
    ok: true, status: 200, json: async () => body,
  });
}

describe("CompetitorAPI > initializeCompetitorSession", () => {
  it("statusCode=201 → returns _id from body.data._id", async () => {
    mockFetchResponse({ statusCode: 201, body: { data: { _id: "mongo-id" } } });
    const out = await api.CompetitorAPI.initializeCompetitorSession({ email: "x@y.z" });
    expect(out).toBe("mongo-id");
  });
  it("statusCode=201 missing data._id → null", async () => {
    mockFetchResponse({ statusCode: 201, body: {} });
    expect(await api.CompetitorAPI.initializeCompetitorSession({ email: "x@y.z" })).toBeNull();
  });
  it("statusCode=401 → POST /create-comp-details, returns new _id", async () => {
    mockFetchResponse({ statusCode: 401 });
    mockFetchResponse({ statusCode: 200, body: { data: { _id: "new-id" } } });
    const out = await api.CompetitorAPI.initializeCompetitorSession({
      email: "x@y.z", user_id: 7, userSubscriptionType: "Pro", expiry_date: "2025-12-31", login: "user1",
    });
    expect(out).toBe("new-id");
    expect(globalThis.fetch.mock.calls[1][0]).toContain("/create-comp-details");
    const body = JSON.parse(globalThis.fetch.mock.calls[1][1].body);
    expect(body.amember_id).toBe(7);
    expect(body.plan_id).toBe("Pro");
  });
  it("401 → falls back to user.id if user_id missing", async () => {
    mockFetchResponse({ statusCode: 401 });
    mockFetchResponse({ statusCode: 200, body: { data: { _id: "new-id" } } });
    await api.CompetitorAPI.initializeCompetitorSession({ id: 99 });
    const body = JSON.parse(globalThis.fetch.mock.calls[1][1].body);
    expect(body.amember_id).toBe(99);
  });
  it("401 → expiry_date defaults to current ISO", async () => {
    mockFetchResponse({ statusCode: 401 });
    mockFetchResponse({ statusCode: 200, body: { data: { _id: "new-id" } } });
    await api.CompetitorAPI.initializeCompetitorSession({ email: "x" });
    const body = JSON.parse(globalThis.fetch.mock.calls[1][1].body);
    expect(body.plan_expiry_date).toMatch(/\d{4}-\d{2}-\d{2}/);
  });
  it("401 + missing data._id on create → null", async () => {
    mockFetchResponse({ statusCode: 401 });
    mockFetchResponse({ statusCode: 200 });
    expect(await api.CompetitorAPI.initializeCompetitorSession({ email: "x" })).toBeNull();
  });
  it("other statusCode → null", async () => {
    mockFetchResponse({ statusCode: 500 });
    expect(await api.CompetitorAPI.initializeCompetitorSession({ email: "x" })).toBeNull();
  });
  it("undefined user → email defaults to ''", async () => {
    mockFetchResponse({ statusCode: 201, body: { data: { _id: "id" } } });
    await api.CompetitorAPI.initializeCompetitorSession();
    expect(globalThis.fetch.mock.calls[0][0]).toContain("?email=");
  });
});

describe("CompetitorAPI > simple wrappers", () => {
  it("getDashboardProjects", async () => {
    mockFetchResponse({ ok: true });
    await api.CompetitorAPI.getDashboardProjects("mongo-id");
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/project-details");
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body).user_id).toBe("mongo-id");
  });
  it("getCompetitorCount", async () => {
    mockFetchResponse({ ok: true });
    await api.CompetitorAPI.getCompetitorCount("name");
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body).competitors).toEqual(["name"]);
  });
  it("getCompetitorCountNew", async () => {
    mockFetchResponse({ ok: true });
    await api.CompetitorAPI.getCompetitorCountNew(["a", "b"]);
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body).competitors).toEqual(["a", "b"]);
  });
  it("fetchKeywordsBasedOnWebsite", async () => {
    mockFetchResponse({ ok: true });
    await api.CompetitorAPI.fetchKeywordsBasedOnWebsite("x.com", "AdvName");
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/fetch-keywords-basedOnWebsite");
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({ webSiteUrl: "x.com", adv: "AdvName" });
  });
  it("checkCompetitorProcess", async () => {
    mockFetchResponse({ ok: true });
    await api.CompetitorAPI.checkCompetitorProcess("ref", ["k"], 10, "adv", "u1");
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ content_ref_id: "ref", keywords: ["k"], limit: 10, advertiser: "adv", user_id: "u1" });
  });
  it("getStoreProcessCompetitors", async () => {
    mockFetchResponse({ ok: true });
    await api.CompetitorAPI.getStoreProcessCompetitors("adv", "ref", "tgt", "u1");
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/get-store-process-competitors");
  });
  it("generateCompetitorsSearch with defaults", async () => {
    mockFetchResponse({ ok: true });
    await api.CompetitorAPI.generateCompetitorsSearch("proj", "u1");
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body).toMatchObject({ project_name: "proj", user_id: "u1", page: 1, limit: 10 });
  });
  it("generateCompetitorsSearch with explicit page/limit", async () => {
    mockFetchResponse({ ok: true });
    await api.CompetitorAPI.generateCompetitorsSearch("proj", "u1", 3, 25);
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.page).toBe(3);
    expect(body.limit).toBe(25);
  });
  it("updateMonitoringStatus", async () => {
    mockFetchResponse({ ok: true });
    await api.CompetitorAPI.updateMonitoringStatus({ foo: "bar" });
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/update-monitoring");
  });
  it("checkBrand", async () => {
    mockFetchResponse({ ok: true });
    await api.CompetitorAPI.checkBrand("BrandX", "u1");
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({ brand: "BrandX", user_id: "u1" });
  });
  it("getAdCount", async () => {
    mockFetchResponse({ ok: true });
    await api.CompetitorAPI.getAdCount(["AdvA"]);
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/get-ad-count");
  });
  it("getLCS", async () => {
    mockFetchResponse({ ok: true });
    await api.CompetitorAPI.getLCS(["AdvA"]);
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/get-lcs");
  });
  it("getAverageBudget includes optional dates when provided", async () => {
    mockFetchResponse({ ok: true });
    await api.CompetitorAPI.getAverageBudget(["A"], "2025-01-01", "2025-01-31");
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.startDate).toBe("2025-01-01");
    expect(body.endDate).toBe("2025-01-31");
  });
  it("getAverageBudget omits dates when null", async () => {
    mockFetchResponse({ ok: true });
    await api.CompetitorAPI.getAverageBudget(["A"]);
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.startDate).toBeUndefined();
    expect(body.endDate).toBeUndefined();
  });
  it("getFrequentData", async () => {
    mockFetchResponse({ ok: true });
    await api.CompetitorAPI.getFrequentData(["A"]);
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/get-frequent-data");
  });
  it("getEngagement", async () => {
    mockFetchResponse({ ok: true });
    await api.CompetitorAPI.getEngagement(["A"]);
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/get-engagement");
  });
  it("getTopLikes", async () => {
    mockFetchResponse({ ok: true });
    await api.CompetitorAPI.getTopLikes(["A"]);
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/get-top-likes");
  });
  it("getTopPopularity", async () => {
    mockFetchResponse({ ok: true });
    await api.CompetitorAPI.getTopPopularity(["A"]);
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/get-top-popularity");
  });
  it("getLongest", async () => {
    mockFetchResponse({ ok: true });
    await api.CompetitorAPI.getLongest(["A"]);
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/get-longest");
  });
  it("deleteProject", async () => {
    mockFetchResponse({ ok: true });
    await api.CompetitorAPI.deleteProject("u1", "adv");
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({ user_id: "u1", advertiser: "adv" });
  });
  it("addManualCompetitor", async () => {
    mockFetchResponse({ ok: true });
    await api.CompetitorAPI.addManualCompetitor({
      userId: "u1", advertiser: "adv", competitorName: "C", competitorUrl: "https://c.com",
    });
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body).toEqual({
      user_id: "u1", advertiser: "adv",
      competitor_name: "C", competitor_url: "https://c.com",
    });
  });
  it("listMembers", async () => {
    mockFetchResponse({ ok: true });
    await api.CompetitorAPI.listMembers("u1");
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/members/list");
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({ user_id: "u1" });
  });
  it("addMember", async () => {
    mockFetchResponse({ ok: true });
    await api.CompetitorAPI.addMember("u1", "Name", "e@x.com");
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/members/add");
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({ user_id: "u1", name: "Name", email: "e@x.com" });
  });
  it("updateMember spreads patch", async () => {
    mockFetchResponse({ ok: true });
    await api.CompetitorAPI.updateMember("u1", "m1", { name: "New" });
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/members/update");
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({ user_id: "u1", member_id: "m1", name: "New" });
  });
  it("deleteMember", async () => {
    mockFetchResponse({ ok: true });
    await api.CompetitorAPI.deleteMember("u1", "m1");
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/members/delete");
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({ user_id: "u1", member_id: "m1" });
  });
  it("getBrandCc", async () => {
    mockFetchResponse({ ok: true });
    await api.CompetitorAPI.getBrandCc("u1", "p1");
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/brand-cc/get");
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({ user_id: "u1", project_id: "p1" });
  });
  it("setBrandCc", async () => {
    mockFetchResponse({ ok: true });
    await api.CompetitorAPI.setBrandCc("u1", "p1", ["m1", "m2"]);
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/brand-cc/set");
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({ user_id: "u1", project_id: "p1", member_ids: ["m1", "m2"] });
  });
  it("renameAdvertiser (PATCH, wraps old name in array)", async () => {
    mockFetchResponse({ ok: true });
    await api.CompetitorAPI.renameAdvertiser("u1", "Old", "New");
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/update-advertiser");
    expect(globalThis.fetch.mock.calls[0][1].method).toBe("PATCH");
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toEqual({ user_id: "u1", advertiser: ["Old"], newadvertiser: "New" });
  });
  it("deleteCompetitor", async () => {
    mockFetchResponse({ ok: true });
    await api.CompetitorAPI.deleteCompetitor({ userId: "u1", advertiser: "adv", competitorId: "c1", competitorName: "C" });
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/delete-competitor");
  });
});

describe("api > default export", () => {
  it("includes a sampling of named exports", async () => {
    const def = api.default;
    expect(def.fetchPlanAccess).toBe(api.fetchPlanAccess);
    expect(def.hideAds).toBe(api.hideAds);
  });
});
