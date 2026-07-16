// Tests for the telemetry functions in src/services/api.js:
//   - trackUserActivity (internal; exercised via fetchAds with PAS_API_BASE set)
//   - trackProjectEvent (exported)
//   - trackEvent        (exported)
// These only do real work when VITE_PAS_API_BASE_URL is set, so we stub the env
// before importing and populate localStorage.authUser so getAuthUser() returns a user.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../src/hooks/useAuth", () => ({
  getAuthToken: vi.fn(() => "tk"),
  markFiltersForExpiry: vi.fn(),
}));

let api;
const PAS = "https://pas.example.test";

beforeEach(async () => {
  vi.resetModules();
  vi.stubEnv("VITE_PAS_API_BASE_URL", PAS);
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    text: async () => "ok",
    json: async () => ({ data: [], meta: { total: { facebook: 2, instagram: 3 } } }),
  });
  localStorage.clear();
  Object.defineProperty(window, "location", {
    writable: true, configurable: true,
    value: { ...window.location, pathname: "/dashboard", href: "" },
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  api = await import("../../src/services/api.js");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const setAuth = (u) => localStorage.setItem("authUser", JSON.stringify(u));

// Pull out the body string POSTed in the last fetch call.
const lastBody = () => {
  const calls = globalThis.fetch.mock.calls;
  return calls.length ? calls[calls.length - 1][1].body : "";
};

describe("trackUserActivity (via fetchAds, PAS set)", () => {
  it("no authUser → does not POST telemetry", async () => {
    await api.fetchAds({ searchIn: "keyword", searchQuery: "x" });
    // Only the search fetch happened; no telemetry POST to user-activity
    const hit = globalThis.fetch.mock.calls.some(([u]) => String(u).includes("user-activity"));
    expect(hit).toBe(false);
  });

  it("authUser present → POSTs telemetry with single-network payload", async () => {
    setAuth({ user_id: 7, email: "a@b.c", name: "Joe", userSubscriptionType: "pro" });
    await api.fetchAds({ searchIn: "keyword", searchQuery: "x", activePlatforms: ["facebook"] });
    const hit = globalThis.fetch.mock.calls.some(([u]) => String(u).includes("user-activity"));
    expect(hit).toBe(true);
  });

  it("isAllTab true → aggregates total across networks", async () => {
    setAuth({ user_id: 7, email: "a@b.c", name: "Joe" });
    await api.fetchAds({ searchIn: "keyword", searchQuery: "x", isAllTab: true, activePlatforms: ["all"] });
    const hit = globalThis.fetch.mock.calls.some(([u]) => String(u).includes("user-activity"));
    expect(hit).toBe(true);
  });

  it("multi-network array payload (isMulti branch)", async () => {
    setAuth({ user_id: 7, email: "a@b.c", name: "Joe" });
    await api.fetchAds({
      searchIn: "keyword", searchQuery: "x",
      activePlatforms: ["facebook", "instagram"],
    });
    const hit = globalThis.fetch.mock.calls.some(([u]) => String(u).includes("user-activity"));
    expect(hit).toBe(true);
  });

  it("single network but meta.total has an extra network → reduce skips it (970 false)", async () => {
    setAuth({ user_id: 7, email: "a@b.c", name: "Joe" });
    // beforeEach fetch mock returns meta.total {facebook, instagram}; querying only
    // facebook means the 'instagram' key is NOT in networkArr → the reduce `else`.
    await api.fetchAds({ searchIn: "keyword", searchQuery: "x", activePlatforms: ["facebook"] });
    const hit = globalThis.fetch.mock.calls.some(([u]) => String(u).includes("user-activity"));
    expect(hit).toBe(true);
  });

  it("meta.total with a zero/non-numeric count → Number(n)||0 right side (971)", async () => {
    setAuth({ user_id: 7, email: "a@b.c", name: "Joe" });
    globalThis.fetch.mockReset().mockResolvedValue({
      ok: true, status: 200, text: async () => "ok",
      json: async () => ({ data: [], meta: { total: { facebook: 0 } } }),
    });
    await api.fetchAds({ searchIn: "keyword", searchQuery: "x", activePlatforms: ["facebook"] });
    const hit = globalThis.fetch.mock.calls.some(([u]) => String(u).includes("user-activity"));
    expect(hit).toBe(true);
  });

  it("no token → telemetry POST omits Authorization header (1237 `: {}`)", async () => {
    vi.resetModules();
    vi.doMock("../../src/hooks/useAuth", () => ({
      getAuthToken: () => "",
      markFiltersForExpiry: () => {},
    }));
    vi.stubEnv("VITE_PAS_API_BASE_URL", PAS);
    vi.stubEnv("VITE_PAS_API_TOKEN", "");
    const m = await import("../../src/services/api.js");
    globalThis.fetch.mockClear();
    setAuth({ user_id: 7, email: "a@b.c", name: "Joe" });
    await m.fetchAds({ searchIn: "keyword", searchQuery: "x", activePlatforms: ["facebook"] });
    const call = globalThis.fetch.mock.calls.find(([u]) => String(u).includes("user-activity"));
    expect(call).toBeTruthy();
    expect((call[1].headers || {}).Authorization).toBeUndefined();
    vi.doUnmock("../../src/hooks/useAuth");
  });
});

describe("trackProjectEvent", () => {
  it("no PAS base → early return (no fetch)", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_PAS_API_BASE_URL", "");
    const m = await import("../../src/services/api.js");
    globalThis.fetch.mockClear();
    setAuth({ user_id: 1 });
    m.trackProjectEvent("create");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("no authUser → warns and returns", () => {
    globalThis.fetch.mockClear();
    api.trackProjectEvent("create");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("authUser present with full fields → POSTs with array + scalar fields", () => {
    globalThis.fetch.mockClear();
    setAuth({ user_id: 1, email: "a@b.c", name: "Joe", userSubscriptionType: "pro" });
    api.trackProjectEvent("create", {
      brand: "B", advertiser: "A", competitors: ["c1", "c2"],
      project_name: "P", dashboard_Advertisers: ["d1"], deleted_Advertisers: ["x1"],
      monitoring_status: "on", network: "facebook",
    });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, opts] = globalThis.fetch.mock.calls[0];
    expect(String(url)).toContain("user-activity-project");
    expect(opts.body).toContain("competitors=");
    expect(opts.body).toContain("competitor_platform=facebook");
  });

  it("authUser missing email/name → uses login/username fallbacks and 'NA'", () => {
    globalThis.fetch.mockClear();
    setAuth({ user_id: 1, login: "loginname" });
    api.trackProjectEvent("update", {});
    const body = lastBody();
    expect(body).toContain("name=loginname");
    expect(body).toContain("email=NA");
  });
  it("name falls back to username when no name/login (line 1249)", () => {
    globalThis.fetch.mockClear();
    setAuth({ user_id: 1, username: "uname" });
    api.trackProjectEvent("update", {});
    expect(lastBody()).toContain("name=uname");
  });
  it("name falls back to 'NA' when no name/login/username (line 1249)", () => {
    globalThis.fetch.mockClear();
    setAuth({ user_id: 1 });
    api.trackProjectEvent("update", {});
    expect(lastBody()).toContain("name=NA");
  });
  it("fetch rejection → swallowed by .catch (line 1284)", async () => {
    globalThis.fetch.mockReset().mockRejectedValue(new Error("net down"));
    setAuth({ user_id: 1, name: "Joe" });
    api.trackProjectEvent("create", { competitors: ["c1"] });
    // flush the fire-and-forget promise chain so the .catch runs
    await Promise.resolve();
    await Promise.resolve();
    expect(console.error).toHaveBeenCalled();
  });
  it("no token → omits Authorization header", async () => {
    vi.resetModules();
    vi.doMock("../../src/hooks/useAuth", () => ({
      getAuthToken: () => "", markFiltersForExpiry: () => {},
    }));
    vi.stubEnv("VITE_PAS_API_BASE_URL", PAS);
    vi.stubEnv("VITE_PAS_API_TOKEN", "");
    const m = await import("../../src/services/api.js");
    globalThis.fetch.mockClear();
    setAuth({ user_id: 1, name: "Joe" });
    m.trackProjectEvent("create", { competitors: ["c1"] });
    expect((globalThis.fetch.mock.calls[0][1].headers || {}).Authorization).toBeUndefined();
    vi.doUnmock("../../src/hooks/useAuth");
  });
});

describe("trackEvent", () => {
  it("no PAS base → early return", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_PAS_API_BASE_URL", "");
    const m = await import("../../src/services/api.js");
    globalThis.fetch.mockClear();
    m.trackEvent("hide");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("guest (no authUser) → user_id from fields or 'guest'", () => {
    globalThis.fetch.mockClear();
    api.trackEvent("hide", { network: "facebook", ad_id: 9, domain: "d.com" });
    const body = lastBody();
    expect(body).toContain("user_id=guest");
    expect(body).toContain("network=facebook");
  });

  it("authUser present + hidetype/unhidetype + extra fields forwarded", () => {
    globalThis.fetch.mockClear();
    setAuth({ user_id: 5, email: "a@b.c", userSubscriptionType: "pro" });
    api.trackEvent("hide", {
      network: "instagram", ad_id: 3, domain: "d.com",
      hidetype: "ht", unhidetype: "uh", username: "vansh", userType: "ignored",
    });
    const body = lastBody();
    expect(body).toContain("hidetype=ht");
    expect(body).toContain("unhidetype=uh");
    expect(body).toContain("username=vansh");
    expect(body).not.toContain("userType=ignored");
  });

  it("fields.user_id used when no authUser", () => {
    globalThis.fetch.mockClear();
    api.trackEvent("unhide", { user_id: 42 });
    expect(lastBody()).toContain("user_id=42");
  });
  it("no token → omits Authorization header (line 1316)", async () => {
    vi.resetModules();
    vi.doMock("../../src/hooks/useAuth", () => ({
      getAuthToken: () => "", markFiltersForExpiry: () => {},
    }));
    vi.stubEnv("VITE_PAS_API_BASE_URL", PAS);
    vi.stubEnv("VITE_PAS_API_TOKEN", "");
    const m = await import("../../src/services/api.js");
    globalThis.fetch.mockClear();
    m.trackEvent("hide", { network: "facebook" });
    expect((globalThis.fetch.mock.calls[0][1].headers || {}).Authorization).toBeUndefined();
    vi.doUnmock("../../src/hooks/useAuth");
  });
});

describe("trackUserActivity reachability via fetchAds", () => {
  it("array filter values appear as k[]= entries in telemetry body (1228)", async () => {
    setAuth({ user_id: 7, email: "a@b.c", name: "Joe" });
    // adcategory array + multi network → buildSearchPayload emits array payload values,
    // so trackUserActivity's formBody flatMap hits the Array.isArray(v) branch.
    await api.fetchAds({
      searchIn: "keyword", searchQuery: "x",
      activePlatforms: ["facebook", "instagram"],
      adcategory: ["Retail", "Tech"],
    });
    const call = globalThis.fetch.mock.calls.find(([u]) => String(u).includes("user-activity"));
    expect(call[1].body).toMatch(/\[\]=/);
  });

  it("PAS base unset → trackUserActivity early-returns (961 true branch)", async () => {
    vi.resetModules();
    vi.stubEnv("VITE_PAS_API_BASE_URL", "");
    const m = await import("../../src/services/api.js");
    globalThis.fetch.mockClear();
    globalThis.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) });
    setAuth({ user_id: 7, email: "a@b.c" });
    await m.fetchAds({ searchIn: "keyword", searchQuery: "x", activePlatforms: ["facebook"] });
    // no telemetry POST since PAS base is empty
    const hit = globalThis.fetch.mock.calls.some(([u]) => String(u).includes("user-activity"));
    expect(hit).toBe(false);
  });
});
