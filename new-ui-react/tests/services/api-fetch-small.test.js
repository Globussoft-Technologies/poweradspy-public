// Tests for the small fetch-based exports of src/services/api.js.
// fetchGemini retry path skipped — undefined `delay()` source bug, see issue #246.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { getAuthTokenSpy, clearSessionSpy } = vi.hoisted(() => ({
  getAuthTokenSpy: vi.fn(() => "tk"),
  clearSessionSpy: vi.fn(),
}));

vi.mock("../../src/hooks/useAuth", () => ({
  getAuthToken: getAuthTokenSpy,
  markFiltersForExpiry: clearSessionSpy,
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

describe("api > fetchPlanAccess", () => {
  it("happy path returns .data", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ data: { planId: 1 } }),
    });
    expect(await api.fetchPlanAccess()).toEqual({ planId: 1 });
  });
  it("non-ok → null", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    expect(await api.fetchPlanAccess()).toBeNull();
  });
  it("missing data → null", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    expect(await api.fetchPlanAccess()).toBeNull();
  });
  it("network string appended", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: {} }) });
    await api.fetchPlanAccess("facebook");
    expect(globalThis.fetch.mock.calls[0][0]).toContain("?network=facebook");
  });
  it("network array joined", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: {} }) });
    await api.fetchPlanAccess(["facebook", "google"]);
    expect(globalThis.fetch.mock.calls[0][0]).toMatch(/network=facebook%2Cgoogle/);
  });
  it("'all' → no query string", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: {} }) });
    await api.fetchPlanAccess("all");
    expect(globalThis.fetch.mock.calls[0][0]).not.toContain("?network");
  });
  it("no token → Authorization omitted", async () => {
    getAuthTokenSpy.mockReturnValue("");
    vi.stubEnv("VITE_PAS_API_TOKEN", "");
    vi.resetModules();
    api = await import("../../src/services/api.js");
    globalThis.fetch = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: {} }) });
    await api.fetchPlanAccess();
    expect(globalThis.fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
    vi.unstubAllEnvs();
  });
});

describe("api > checkFor401 → handle401", () => {
  it("401 outside guest path → throws + redirects", async () => {
    globalThis.fetch.mockResolvedValueOnce({ status: 401, ok: false });
    await expect(api.fetchPlanAccess()).rejects.toThrow(/Unauthorized/);
    expect(window.location.href).toBe("http://localhost:3000/logout");
    expect(clearSessionSpy).toHaveBeenCalled();
    expect(localStorage.getItem("authToken")).toBeNull();
  });
  it("401 on /guest/ → silently ignored", async () => {
    Object.defineProperty(window, "location", {
      writable: true, configurable: true,
      value: { ...window.location, pathname: "/guest/abc", href: "" },
    });
    globalThis.fetch.mockResolvedValueOnce({ status: 401, ok: false, json: async () => ({}) });
    expect(await api.fetchPlanAccess()).toBeNull();
    expect(window.location.href).toBe("");
  });
  it("401 on /share/ → silently ignored", async () => {
    Object.defineProperty(window, "location", {
      writable: true, configurable: true,
      value: { ...window.location, pathname: "/share/xyz", href: "" },
    });
    globalThis.fetch.mockResolvedValueOnce({ status: 401, ok: false, json: async () => ({}) });
    expect(await api.fetchPlanAccess()).toBeNull();
  });
  it("401 on /guest-landing → silently ignored (line 18 third condition)", async () => {
    Object.defineProperty(window, "location", {
      writable: true, configurable: true,
      value: { ...window.location, pathname: "/guest-landing", href: "" },
    });
    globalThis.fetch.mockResolvedValueOnce({ status: 401, ok: false, json: async () => ({}) });
    expect(await api.fetchPlanAccess()).toBeNull();
    expect(window.location.href).toBe("");
  });
  it("_loggingOut guard prevents double redirect", async () => {
    globalThis.fetch
      .mockResolvedValueOnce({ status: 401, ok: false })
      .mockResolvedValueOnce({ status: 401, ok: false });
    await expect(api.fetchPlanAccess()).rejects.toThrow();
    const first = window.location.href;
    await expect(api.fetchPlanAccess()).rejects.toThrow();
    expect(window.location.href).toBe(first);
  });
});

describe("api > fetchImageAsDataUrl", () => {
  it("null URL → null", async () => {
    expect(await api.fetchImageAsDataUrl(null)).toBeNull();
  });
  it("happy: blob → data URL", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, status: 200, blob: async () => new Blob(["x"], { type: "image/png" }),
    });
    const out = await api.fetchImageAsDataUrl("http://x/img.png");
    expect(out.startsWith("data:image/png")).toBe(true);
  });
  it("non-ok → throws", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });
    await expect(api.fetchImageAsDataUrl("http://x/img.png")).rejects.toThrow(/image-proxy 500/);
  });
  it("FileReader error → rejects (line 121)", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, status: 200, blob: async () => new Blob(["x"]),
    });
    const OrigFR = global.FileReader;
    class FailingFR {
      readAsDataURL() { this.error = new Error("read fail"); this.onerror && this.onerror(); }
    }
    global.FileReader = FailingFR;
    await expect(api.fetchImageAsDataUrl("http://x/img.png")).rejects.toThrow("read fail");
    global.FileReader = OrigFR;
  });
  it("FileReader error with no .error → default message", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, status: 200, blob: async () => new Blob(["x"]),
    });
    const OrigFR = global.FileReader;
    class FailingFR {
      readAsDataURL() { this.onerror && this.onerror(); }
    }
    global.FileReader = FailingFR;
    await expect(api.fetchImageAsDataUrl("http://x/img.png")).rejects.toThrow("FileReader failed");
    global.FileReader = OrigFR;
  });
});

describe("api > hideAds", () => {
  it("uses platform route, returns json", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
    const out = await api.hideAds({ network: "instagram", adId: 1, type: 2 });
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/instagram/ads/hide_ads");
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body)).toMatchObject({ ad_id: 1, type: 2 });
    expect(out.ok).toBe(true);
  });
  it("unknown network → facebook", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    await api.hideAds({ network: "twitter", adId: 1, type: 2 });
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/facebook/ads/hide_ads");
  });
  it("undefined network → facebook", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    await api.hideAds({ adId: 1, type: 2 });
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/facebook/ads/hide_ads");
  });
  it("non-ok → throws", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(api.hideAds({ network: "facebook", adId: 1, type: 2 })).rejects.toThrow(/hide_ads failed/);
  });
});

describe("api > unHideAds", () => {
  it("happy returns json", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ ok: true }) });
    const out = await api.unHideAds({ network: "facebook", adId: 1, type: 2 });
    expect(out.ok).toBe(true);
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/un-hide");
  });
  it("unknown network → facebook", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    await api.unHideAds({ network: "twitter", adId: 1, type: 2 });
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/facebook/ads/un-hide");
  });
  it("undefined network → facebook (line 425 `|| 'facebook'`)", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    await api.unHideAds({ adId: 1, type: 2 });
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/facebook/ads/un-hide");
  });
  it("non-ok → throws", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(api.unHideAds({ network: "facebook", adId: 1, type: 2 })).rejects.toThrow(/un-hide failed/);
  });
});

describe("api > fetchHiddenAndFavourites", () => {
  it("happy returns three arrays", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ data: [1, 2], addata: [3], favorite: [4] }),
    });
    expect(await api.fetchHiddenAndFavourites("facebook")).toEqual({
      hiddenAdvertiserIds: [1, 2], hiddenAdIds: [3], favouriteAdIds: [4],
    });
  });
  it("missing fields default to []", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    expect(await api.fetchHiddenAndFavourites("facebook")).toEqual({
      hiddenAdvertiserIds: [], hiddenAdIds: [], favouriteAdIds: [],
    });
  });
  it("non-ok → empty arrays", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 500 });
    expect((await api.fetchHiddenAndFavourites("facebook")).hiddenAdvertiserIds).toEqual([]);
  });
  it("default network = facebook", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    await api.fetchHiddenAndFavourites();
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/facebook/ads/getHiddenPostOwners");
  });
  it("unknown network → facebook route (line 454)", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    await api.fetchHiddenAndFavourites("twitter");
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/facebook/ads/getHiddenPostOwners");
  });
  it("thrown error → empty arrays", async () => {
    globalThis.fetch.mockRejectedValueOnce(new Error("net"));
    expect((await api.fetchHiddenAndFavourites("facebook")).hiddenAdIds).toEqual([]);
  });
});

describe("api > fetchGemini (no-retry only — see issue #246)", () => {
  it("returns text from candidates", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ candidates: [{ content: { parts: [{ text: "answer" }] } }] }),
    });
    expect(await api.fetchGemini("q")).toBe("answer");
  });
  it("returns undefined when candidates absent", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({}),
    });
    expect(await api.fetchGemini("q")).toBeUndefined();
  });
  it("429 → retries with exponential backoff, then 'Failed to connect' after max retries", async () => {
    vi.useFakeTimers();
    // Every call returns 429 so it exhausts all 5 retries (delay() is a real
    // backoff timer, so we drive it with fake timers instead of waiting ~31s).
    globalThis.fetch.mockResolvedValue({ ok: false, status: 429, json: async () => ({}) });
    const p = api.fetchGemini("q");
    p.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(p).rejects.toThrow(/Failed to connect to AI service/);
    globalThis.fetch.mockReset();
    vi.useRealTimers();
  });
  it("fetch rejection → retries via outer catch, then rethrows the original error", async () => {
    vi.useFakeTimers();
    globalThis.fetch.mockRejectedValue(new Error("net-down"));
    const p = api.fetchGemini("q");
    p.catch(() => {});
    await vi.runAllTimersAsync();
    await expect(p).rejects.toThrow(/net-down/);
    globalThis.fetch.mockReset();
    vi.useRealTimers();
  });
  it("retryCount=5 + 429 → 'Failed to connect to AI service' (line 506)", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: false, status: 429, json: async () => ({}),
    });
    // retryCount<5 is false, so retry skipped; goes straight to throw
    await expect(api.fetchGemini("q", 5)).rejects.toThrow(/Failed to connect to AI service/);
  });
  it("retryCount=5 + fetch rejects → outer catch rethrows (line 515)", async () => {
    globalThis.fetch.mockRejectedValueOnce(new Error("net-down-final"));
    await expect(api.fetchGemini("q", 5)).rejects.toThrow(/net-down-final/);
  });
});

describe("api > fetchLandingAd", () => {
  it("happy: returns {ads, meta}", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ data: [{ ad_id: 1 }, { ad_id: 2 }] }),
    });
    const out = await api.fetchLandingAd("facebook", "1");
    expect(out.ads.length).toBe(2);
    expect(out.meta.total).toBe(2);
  });
  it("missing data → empty ads", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) });
    const out = await api.fetchLandingAd("facebook", "1");
    expect(out.ads).toEqual([]);
  });
  it("non-ok → throws", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 404 });
    await expect(api.fetchLandingAd("facebook", "1")).rejects.toThrow(/Landing Ad/);
  });
});

describe("api > fetchUIConfig (deprecated)", () => {
  it("ok → parsed JSON", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ ui: {} }),
    });
    expect(await api.fetchUIConfig()).toEqual({ ui: {} });
  });
  it("non-ok → returns default config", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const out = await api.fetchUIConfig();
    expect(out).toHaveProperty("header");
    expect(out).toHaveProperty("sidebar_filters");
  });
  it("throws → returns default config", async () => {
    globalThis.fetch.mockRejectedValueOnce(new Error("net"));
    const out = await api.fetchUIConfig();
    expect(out).toHaveProperty("header");
  });
});

describe("api > fetchFilters (deprecated)", () => {
  it("ok → returns data.groups", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ groups: ["a"] }),
    });
    expect(await api.fetchFilters()).toEqual(["a"]);
  });
  it("non-ok → throws", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(api.fetchFilters()).rejects.toThrow(/Failed to fetch filters/);
  });
});

describe("api > fetchNotifications + markNotificationsRead", () => {
  it("fetchNotifications happy → {data, meta}", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ data: [{ id: 1 }], meta: { unreadCount: 1 } }),
    });
    const out = await api.fetchNotifications();
    expect(out.data.length).toBe(1);
    expect(out.meta.unreadCount).toBe(1);
  });
  it("fetchNotifications missing fields default", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    const out = await api.fetchNotifications();
    expect(out).toEqual({ data: [], meta: { unreadCount: 0 } });
  });
  it("fetchNotifications non-ok → defaults", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const out = await api.fetchNotifications();
    expect(out.data).toEqual([]);
  });
  it("fetchNotifications error → defaults", async () => {
    globalThis.fetch.mockRejectedValueOnce(new Error("net"));
    const out = await api.fetchNotifications();
    expect(out.data).toEqual([]);
  });
  it("markNotificationsRead empty array → true (no fetch)", async () => {
    expect(await api.markNotificationsRead([])).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it("markNotificationsRead non-array → true", async () => {
    expect(await api.markNotificationsRead("not-array")).toBe(true);
  });
  it("markNotificationsRead happy → true (loops per id)", async () => {
    globalThis.fetch
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({ ok: true });
    expect(await api.markNotificationsRead([1, 2])).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });
  it("markNotificationsRead first non-ok → false (short-circuits)", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false });
    expect(await api.markNotificationsRead([1, 2])).toBe(false);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
  it("markNotificationsRead error → false", async () => {
    globalThis.fetch.mockRejectedValueOnce(new Error("net"));
    expect(await api.markNotificationsRead([1])).toBe(false);
  });
});

describe("api > saveKeywordSearch", () => {
  it("happy → json", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ ok: 1 }),
    });
    expect(await api.saveKeywordSearch({ value: "k", type: "keyword", network: "all", email: "e" })).toEqual({ ok: 1 });
  });
  it("non-ok → null", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 500 });
    expect(await api.saveKeywordSearch({ value: "k", type: "keyword", network: "all" })).toBeNull();
  });
  it("no token → returns null without fetching (line 2087)", async () => {
    getAuthTokenSpy.mockReturnValue("");
    vi.stubEnv("VITE_PAS_API_TOKEN", "");
    globalThis.fetch.mockClear();
    const out = await api.saveKeywordSearch({ value: "k", type: "keyword", network: "all" });
    expect(out).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

describe("api > createShareLink", () => {
  it("happy → {token, expiresAt}", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ token: "abc", expires_at: "2025-12-31" }),
    });
    const out = await api.createShareLink({ adId: 1, network: "facebook" });
    expect(out).toEqual({ token: "abc", expiresAt: "2025-12-31" });
  });
  it("non-ok with error body message → throws that message", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: false, status: 500, json: async () => ({ message: "specific" }),
    });
    await expect(api.createShareLink({ adId: 1, network: "facebook" })).rejects.toThrow("specific");
  });
  it("non-ok with parse failure → throws status-based message", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: false, status: 502, json: async () => { throw new Error("parse-fail"); },
    });
    await expect(api.createShareLink({ adId: 1, network: "facebook" })).rejects.toThrow(/Share link API error: 502/);
  });
});

describe("api > fetchSharedAd", () => {
  it("happy → {expired:false, ad, expiresAt}", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ ad: { ad_id: 1 }, network: "facebook", expires_at: "2025-12-31" }),
    });
    const out = await api.fetchSharedAd("tok");
    expect(out.expired).toBe(false);
    expect(out.ad).toBeDefined();
    expect(out.expiresAt).toBe("2025-12-31");
  });
  it("json.expired=true → {expired:true, ad:null, expiresAt:null}", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ expired: true }),
    });
    const out = await api.fetchSharedAd("tok");
    expect(out).toEqual({ expired: true, ad: null, expiresAt: null });
  });
  it("json.network absent → falls back to ad.network (line 1963 ||)", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ ad: { ad_id: 5, network: "instagram" }, expires_at: "2025-12-31" }),
    });
    const out = await api.fetchSharedAd("tok");
    expect(out.ad.id).toBe(5);
  });
  it("410 → throws with .expired+.status set", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 410 });
    await expect(api.fetchSharedAd("tok")).rejects.toMatchObject({ status: 410, expired: true });
  });
  it("non-ok non-410 → throws", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(api.fetchSharedAd("tok")).rejects.toThrow(/Shared ad API error/);
  });
});

describe("api > createDashboardShare", () => {
  it("happy → {token, expiresAt}", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ token: "x", expires_at: "y" }),
    });
    const out = await api.createDashboardShare({ uiState: {}, searchPayload: {} });
    expect(out).toEqual({ token: "x", expiresAt: "y" });
  });
  it("non-ok with message → throws message", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: false, status: 500, json: async () => ({ message: "m" }),
    });
    await expect(api.createDashboardShare({ uiState: {}, searchPayload: {} })).rejects.toThrow("m");
  });
  it("non-ok parse fail → throws status-based", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: false, status: 502, json: async () => { throw new Error("nope"); },
    });
    await expect(api.createDashboardShare({ uiState: {}, searchPayload: {} })).rejects.toThrow(/502/);
  });
});

describe("api > fetchDashboardState", () => {
  it("happy → {expired:false, uiState, expiresAt}", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ uiState: { a: 1 }, expires_at: "z" }),
    });
    expect(await api.fetchDashboardState("tok")).toEqual({
      expired: false, uiState: { a: 1 }, expiresAt: "z",
    });
  });
  it("json.expired → {expired:true}", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ expired: true }),
    });
    expect(await api.fetchDashboardState("tok")).toEqual({
      expired: true, uiState: null, expiresAt: null,
    });
  });
  it("410 → throws .status=410 .expired=true", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 410 });
    await expect(api.fetchDashboardState("tok")).rejects.toMatchObject({ status: 410, expired: true });
  });
  it("non-ok non-410 → throws with .status", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(api.fetchDashboardState("tok")).rejects.toMatchObject({ status: 500 });
  });
});

describe("api > guestSearchAds", () => {
  it("happy → returns mapped ads + meta", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({
        data: [{ ad_id: 1, network: "facebook" }],
        meta: { networksWithData: ["facebook"], guestLimitReached: false },
      }),
    });
    const out = await api.guestSearchAds("tok", 0);
    expect(out.ads.length).toBe(1);
    expect(out.availableNetworks).toEqual(["facebook"]);
    expect(out.noDataMessage).toBeNull();
  });
  it("empty data → noDataMessage set", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ data: [] }),
    });
    const out = await api.guestSearchAds("tok");
    expect(out.noDataMessage).toBe("No ads found");
    expect(out.guestLimitReached).toBe(false);
  });
  it("missing .meta → meta:{}", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [] }) });
    const out = await api.guestSearchAds("tok");
    expect(out.meta).toEqual({});
    expect(out.availableNetworks).toEqual([]);
  });
  it("guestLimitReached:true propagated (line 2046)", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ data: [{ ad_id: 1 }], meta: { guestLimitReached: true } }),
    });
    expect((await api.guestSearchAds("tok")).guestLimitReached).toBe(true);
  });
  it("json without data key → rawAds [] (line 2046 `|| []`)", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ meta: {} }) });
    const out = await api.guestSearchAds("tok");
    expect(out.ads).toEqual([]);
    expect(out.noDataMessage).toBe("No ads found");
  });
  it("non-ok with message → throws message", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: false, status: 500, json: async () => ({ message: "guest-fail" }),
    });
    await expect(api.guestSearchAds("tok")).rejects.toThrow("guest-fail");
  });
  it("non-ok parse fail → throws status-based", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: false, status: 502, json: async () => { throw new Error("nope"); },
    });
    await expect(api.guestSearchAds("tok")).rejects.toThrow(/Guest search error: 502/);
  });
});

describe("api > getAdvertiserInsightsByDateRange", () => {
  it("happy → returns json", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ data: { x: 1 } }),
    });
    const out = await api.getAdvertiserInsightsByDateRange({
      post_owner_id: 1, from_date: "2025-01-01", to_date: "2025-01-31",
      type: "lcs", network: "facebook",
    });
    expect(out).toEqual({ data: { x: 1 } });
  });
  it("default network = facebook", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({}),
    });
    await api.getAdvertiserInsightsByDateRange({});
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/facebook/ads/getAdvertiserInsightsByDateRange");
  });
  it("empty-string network → facebook via (network||'facebook') (line 1887)", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    await api.getAdvertiserInsightsByDateRange({ network: "" });
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/facebook/ads/");
  });
  it("unknown network → facebook route fallback (line 1887)", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    await api.getAdvertiserInsightsByDateRange({ network: "twitter" });
    expect(globalThis.fetch.mock.calls[0][0]).toContain("/facebook/ads/");
  });
  it("status=400 → returns the parsed body (not thrown)", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: false, status: 400, json: async () => ({ code: 400, message: "bad" }),
    });
    const out = await api.getAdvertiserInsightsByDateRange({});
    expect(out.code).toBe(400);
  });
  it("non-ok non-400 → throws", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: false, status: 500, json: async () => ({}),
    });
    await expect(api.getAdvertiserInsightsByDateRange({})).rejects.toThrow();
  });
});

describe("api > fetchFreshTikTokVideoUrl", () => {
  it("null URL → null", async () => {
    expect(await api.fetchFreshTikTokVideoUrl(null)).toBeNull();
  });
  it("happy → returns data.video_url", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({ data: { video_url: "fresh" } }),
    });
    expect(await api.fetchFreshTikTokVideoUrl("lib")).toBe("fresh");
  });
  it("missing data → null", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, json: async () => ({}),
    });
    expect(await api.fetchFreshTikTokVideoUrl("lib")).toBeNull();
  });
  it("non-ok → null", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 500 });
    expect(await api.fetchFreshTikTokVideoUrl("lib")).toBeNull();
  });
  it("error → null", async () => {
    globalThis.fetch.mockRejectedValueOnce(new Error("net"));
    expect(await api.fetchFreshTikTokVideoUrl("lib")).toBeNull();
  });
});

describe("api > no-token branch: Authorization header omitted when getPASToken() falsy", () => {
  beforeEach(() => {
    // getPASToken() = getAuthToken() || VITE_PAS_API_TOKEN; both falsy → no auth header
    getAuthTokenSpy.mockReturnValue("");
    vi.stubEnv("VITE_PAS_API_TOKEN", "");
  });
  afterEach(() => { vi.unstubAllEnvs(); });
  const noAuth = (callIdx = 0) => {
    const h = globalThis.fetch.mock.calls[callIdx][1].headers || {};
    expect(h.Authorization).toBeUndefined();
  };

  it("fetchImageAsDataUrl omits Authorization (line 113)", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, status: 200, blob: async () => new Blob(["x"]),
    });
    // FileReader in jsdom resolves; we only need the fetch headers asserted
    await api.fetchImageAsDataUrl("http://x/y.jpg").catch(() => {});
    noAuth();
  });

  it("fetchAds omits Authorization (lines 1316/1329)", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) });
    await api.fetchAds({});
    noAuth();
  });

  it("fetchAdsForExport omits Authorization (line 1493)", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) });
    await api.fetchAdsForExport({});
    noAuth();
  });

  it("fetchLandingAd omits Authorization (line 1515)", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) });
    await api.fetchLandingAd("facebook", 1);
    noAuth();
  });

  it("createShareLink omits Authorization (line 1915)", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { token: "t" } }) });
    await api.createShareLink({ adId: 1, network: "facebook" });
    noAuth();
  });

  it("createDashboardShare omits Authorization (line 1978)", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { token: "t" } }) });
    await api.createDashboardShare({ uiState: {}, searchPayload: {} });
    noAuth();
  });

  it("fetchFreshTikTokVideoUrl omits Authorization (line 2119)", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: { video_url: "v" } }) });
    await api.fetchFreshTikTokVideoUrl("lib");
    noAuth();
  });
});
