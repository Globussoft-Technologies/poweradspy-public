// Tests for fetchAds + fetchAdsForExport in src/services/api.js.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/hooks/useAuth", () => ({
  getAuthToken: vi.fn(() => "tk"),
  clearSessionState: vi.fn(),
}));

let api;
beforeEach(async () => {
  vi.resetModules();
  globalThis.fetch = vi.fn();
  localStorage.clear();
  Object.defineProperty(window, "location", {
    writable: true, configurable: true,
    value: { ...window.location, pathname: "/dashboard", href: "" },
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  api = await import("../../src/services/api.js");
});

describe("api > fetchAds happy path", () => {
  it("returns {ads, meta}", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ data: [{ ad_id: 1, network: "facebook" }], meta: { total: { facebook: 1 } } }),
    });
    const out = await api.fetchAds({});
    expect(out.ads.length).toBe(1);
    expect(out.meta).toEqual({ total: { facebook: 1 } });
  });
  it("meta missing → {}", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ data: [] }),
    });
    expect((await api.fetchAds()).meta).toEqual({});
  });
  it("uses POST + JSON body from buildSearchPayload", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ data: [] }) });
    await api.fetchAds({ searchIn: "keyword", searchQuery: "hi" });
    expect(globalThis.fetch.mock.calls[0][1].method).toBe("POST");
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.keyword).toBe("hi");
  });
});

describe("api > fetchAds frontend safety-net sort", () => {
  function makeRes(ads) {
    return { ok: true, status: 200, json: async () => ({ data: ads }) };
  }
  it("default sort: last_seen desc", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeRes([
      { ad_id: 1, last_seen: "2025-01-01" },
      { ad_id: 2, last_seen: "2026-01-01" },
    ]));
    const out = await api.fetchAds();
    expect(out.ads[0].id).toBe(2);
  });
  it("running_longest_sort → days_running", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeRes([
      { ad_id: 1, days_running: 5 },
      { ad_id: 2, days_running: 50 },
    ]));
    const out = await api.fetchAds({ sortBy: "running_longest" });
    expect(out.ads[0].id).toBe(2);
  });
  it("likes_sort → likes desc", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeRes([
      { ad_id: 1, likes: 5 }, { ad_id: 2, likes: 50 },
    ]));
    const out = await api.fetchAds({ sortBy: "likes" });
    expect(out.ads[0].id).toBe(2);
  });
  it("comments_sort", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeRes([
      { ad_id: 1, comment: 5 }, { ad_id: 2, comment: 50 },
    ]));
    const out = await api.fetchAds({ sortBy: "comments" });
    expect(out.ads[0].id).toBe(2);
  });
  it("shares_sort", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeRes([
      { ad_id: 1, share: 5 }, { ad_id: 2, share: 50 },
    ]));
    const out = await api.fetchAds({ sortBy: "shares" });
    expect(out.ads[0].id).toBe(2);
  });
  it("impression_sort", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeRes([
      { ad_id: 1, impression: 5 }, { ad_id: 2, impression: 50 },
    ]));
    const out = await api.fetchAds({ sortBy: "impressions" });
    expect(out.ads[0].id).toBe(2);
  });
  it("popularity_sort", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeRes([
      { ad_id: 1, popularity: 5 }, { ad_id: 2, popularity: 50 },
    ]));
    const out = await api.fetchAds({ sortBy: "popularity" });
    expect(out.ads[0].id).toBe(2);
  });
  it("adBudget_sort", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeRes([
      { ad_id: 1, ad_budget: 5 }, { ad_id: 2, ad_budget: 50 },
    ]));
    const out = await api.fetchAds({ sortBy: "ad_budget" });
    expect(out.ads[0].id).toBe(2);
  });
  it("last_seen_sort uses LastSeen branch", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeRes([
      { ad_id: 1, last_seen: "2025-01-01" },
      { ad_id: 2, last_seen: "2026-01-01" },
    ]));
    const out = await api.fetchAds({ sortBy: "last_seen" });
    expect(out.ads[0].id).toBe(2);
  });
  it("numeric date field — small numbers (seconds) → multiplied to ms", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeRes([
      { ad_id: 1, last_seen: 1700000000 },
      { ad_id: 2, last_seen: 1800000000 },
    ]));
    const out = await api.fetchAds();
    expect(out.ads[0].id).toBe(2);
  });
  it("invalid date string → 0 (loses to valid)", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeRes([
      { ad_id: 1, last_seen: "not-a-date" },
      { ad_id: 2, last_seen: "2026-01-01" },
    ]));
    const out = await api.fetchAds();
    expect(out.ads[0].id).toBe(2);
  });
  it("single-item array bypasses sort", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeRes([{ ad_id: 1 }]));
    const out = await api.fetchAds();
    expect(out.ads[0].id).toBe(1);
  });
  it("sortBy='lastseen' hits payload.last_seen_sort else-if (line 1229)", async () => {
    // 'lastseen' is in SORT_MAP → order_column='LastSeen' → payload.last_seen_sort='LastSeen_sort'.
    // It is NOT in SORT_BY_FIELD_MAP → first if misses → falls into 1229 else-if.
    globalThis.fetch.mockResolvedValueOnce(makeRes([
      { ad_id: 1, last_seen: "2025-01-01" },
      { ad_id: 2, last_seen: "2026-01-01" },
    ]));
    const out = await api.fetchAds({ sortBy: "lastseen" });
    expect(out.ads[0].id).toBe(2);
  });
  it("toNumRaw with object popularity (current key) uses .current (lines 1260-1263)", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeRes([
      { ad_id: 1, likes: { current: 10 } },
      { ad_id: 2, likes: { current: 100 } },
    ]));
    const out = await api.fetchAds({ sortBy: "likes" });
    expect(out.ads[0].id).toBe(2);
  });
  it("toNumRaw with empty-current object → null sorts last", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeRes([
      { ad_id: 1, likes: { current: null, score: null, value: null } },
      { ad_id: 2, likes: 50 },
    ]));
    const out = await api.fetchAds({ sortBy: "likes" });
    expect(out.ads[0].id).toBe(2);
  });
  it("toNumRaw with object NaN → null (line 1263 NaN branch)", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeRes([
      { ad_id: 1, likes: { current: "not-a-number" } },
      { ad_id: 2, likes: 50 },
    ]));
    const out = await api.fetchAds({ sortBy: "likes" });
    expect(out.ads[0].id).toBe(2);
  });
  it("cmpDesc both-null returns 0 (line 1251)", async () => {
    globalThis.fetch.mockResolvedValueOnce(makeRes([
      { ad_id: 1 }, { ad_id: 2 },
    ]));
    const out = await api.fetchAds({ sortBy: "likes" });
    // Both null → stable order preserved
    expect(out.ads.map(a => a.id)).toEqual([1, 2]);
  });
});

describe("api > fetchAds error paths", () => {
  it("non-ok → throws", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(api.fetchAds()).rejects.toThrow(/Ads API error: 500/);
  });
  it("403 → throws with code/showSubscriptionModal/etc.", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: false, status: 403,
      json: async () => ({
        message: "Restricted",
        showSubscriptionModal: true,
        platformRestriction: true,
        restrictedFilters: ["age"],
        allowedPlatforms: ["facebook"],
      }),
    });
    await expect(api.fetchAds()).rejects.toMatchObject({
      message: "Restricted",
      code: 403,
      showSubscriptionModal: true,
      platformRestriction: true,
      restrictedFilters: ["age"],
      allowedPlatforms: ["facebook"],
    });
  });
  it("403 with missing fields → defaults", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: false, status: 403, json: async () => ({}),
    });
    await expect(api.fetchAds()).rejects.toMatchObject({
      message: "Access restricted by your plan.",
      code: 403,
      showSubscriptionModal: false,
      platformRestriction: false,
      restrictedFilters: [],
      allowedPlatforms: [],
    });
  });
  it("body code=401 → handle401 + throws", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ code: 401 }),
    });
    await expect(api.fetchAds()).rejects.toThrow(/Unauthorized/);
    expect(window.location.href).toBe("http://localhost:3000/logout");
  });
  it("body message contains 'token expired' → handle401 + throws", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ message: "Sorry, Token expired" }),
    });
    await expect(api.fetchAds()).rejects.toThrow(/Unauthorized/);
  });
});

describe("api > fetchAds trackUserActivity side effect", () => {
  it("fires user_activity POST when authUser present and skip=0", async () => {
    vi.stubEnv("VITE_USER_ACTIVITY_URL", "https://ua.example.com/");
    vi.resetModules();
    api = await import("../../src/services/api.js");
    localStorage.setItem("authUser", JSON.stringify({ user_id: 7, userSubscriptionType: "Pro" }));
    const responses = [
      { ok: true, status: 200, json: async () => ({ data: [], meta: { total: { facebook: 5 } } }) },
      { ok: true, status: 200, json: async () => ({}) }, // user_activity
    ];
    globalThis.fetch = vi.fn((url) => {
      if (url.includes("user-activity")) return Promise.resolve(responses[1]);
      return Promise.resolve(responses[0]);
    });
    await api.fetchAds({});
    expect(globalThis.fetch.mock.calls.some(c => c[0].includes("user_activity"))).toBe(true);
    vi.unstubAllEnvs();
  });
  it("skipped on paginated fetch (skip > 0)", async () => {
    vi.stubEnv("VITE_USER_ACTIVITY_URL", "https://ua.example.com/");
    vi.resetModules();
    api = await import("../../src/services/api.js");
    localStorage.setItem("authUser", JSON.stringify({ user_id: 7 }));
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ data: [] }),
    });
    await api.fetchAds({ skip: 20 });
    expect(globalThis.fetch.mock.calls.every(c => !c[0].includes("user_activity"))).toBe(true);
    vi.unstubAllEnvs();
  });
  it("fires trackUserActivity via the PAS API base (no USER_ACTIVITY_URL needed)", async () => {
    // The activity endpoint is now ${PAS_API_BASE}/api/v1/frontend_user_activity/user-activity,
    // so it no longer depends on VITE_USER_ACTIVITY_URL being set.
    localStorage.setItem("authUser", JSON.stringify({ user_id: 7 }));
    globalThis.fetch = vi.fn((url) => {
      if (url.includes("user-activity")) return Promise.resolve({ ok: true });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: [] }) });
    });
    await api.fetchAds({});
    expect(globalThis.fetch.mock.calls.some(c => c[0].includes("user-activity"))).toBe(true);
  });
  it("no authUser in localStorage → trackUserActivity skipped", async () => {
    vi.stubEnv("VITE_USER_ACTIVITY_URL", "https://ua.example.com/");
    vi.resetModules();
    api = await import("../../src/services/api.js");
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ data: [] }),
    });
    await api.fetchAds({});
    expect(globalThis.fetch.mock.calls.length).toBe(1);
    vi.unstubAllEnvs();
  });
  it("malformed authUser JSON → silently skipped", async () => {
    vi.stubEnv("VITE_USER_ACTIVITY_URL", "https://ua.example.com/");
    vi.resetModules();
    api = await import("../../src/services/api.js");
    localStorage.setItem("authUser", "not-json");
    globalThis.fetch = vi.fn().mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ data: [] }),
    });
    await api.fetchAds({});
    expect(globalThis.fetch.mock.calls.length).toBe(1);
    vi.unstubAllEnvs();
  });
  it("network as string used directly", async () => {
    vi.stubEnv("VITE_USER_ACTIVITY_URL", "https://ua.example.com/");
    vi.resetModules();
    api = await import("../../src/services/api.js");
    localStorage.setItem("authUser", JSON.stringify({ user_id: 7 }));
    let activityBody;
    globalThis.fetch = vi.fn((url, opts) => {
      if (url.includes("user-activity")) {
        activityBody = opts.body;
        return Promise.resolve({ ok: true });
      }
      return Promise.resolve({
        ok: true, status: 200, json: async () => ({ data: [], meta: {} }),
      });
    });
    await api.fetchAds({});
    expect(activityBody).toContain("network=facebook");
    vi.unstubAllEnvs();
  });
  // Cover network-specific branches in trackUserActivity (lines 1029-1136).
  // Each network selects a distinct extras shape with a distinguishing token.
  it.each([
    ["youtube", /network=Youtube/],
    ["google", /network=Google/],
    ["native", /platform=Native/],
    ["linkedin", /network=Linkedin/],
    ["pinterest", /network=Pinterest/],
    ["quora", /network=Quora/],
    ["reddit", /network=Reddit/],
    ["gdn", /network=GDN/],
    ["bogusnet", /network=bogusnet/], // else-branch
  ])(
    "network=%s → trackUserActivity routes to the matching extras branch",
    async (network, expected) => {
      vi.stubEnv("VITE_USER_ACTIVITY_URL", "https://ua.example.com/");
      vi.resetModules();
      api = await import("../../src/services/api.js");
      localStorage.setItem("authUser", JSON.stringify({ user_id: 7, email: "a@b.com", name: "A" }));
      let activityBody;
      globalThis.fetch = vi.fn((url, opts) => {
        if (url.includes("user-activity")) {
          activityBody = opts.body;
          return Promise.resolve({ ok: true });
        }
        return Promise.resolve({
          ok: true, status: 200, json: async () => ({ data: [], meta: {} }),
        });
      });
      await api.fetchAds({ activePlatforms: [network] });
      expect(activityBody).toMatch(expected);
      vi.unstubAllEnvs();
    },
  );
  it("user_activity POST failure swallowed", async () => {
    vi.stubEnv("VITE_USER_ACTIVITY_URL", "https://ua.example.com/");
    vi.resetModules();
    api = await import("../../src/services/api.js");
    localStorage.setItem("authUser", JSON.stringify({ user_id: 7 }));
    globalThis.fetch = vi.fn((url) => {
      if (url.includes("user-activity")) return Promise.reject(new Error("fail"));
      return Promise.resolve({
        ok: true, status: 200, json: async () => ({ data: [] }),
      });
    });
    await api.fetchAds({}); // does NOT throw
    vi.unstubAllEnvs();
  });
});

describe("api > fetchAdsForExport", () => {
  it("overrides take=100 + skip=0 in payload", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({ data: [{ ad_id: 1 }, { ad_id: 2 }] }),
    });
    const out = await api.fetchAdsForExport({ skip: 50 });
    const body = JSON.parse(globalThis.fetch.mock.calls[0][1].body);
    expect(body.take).toBe("100");
    expect(body.skip).toBe(0);
    expect(out.length).toBe(2);
  });
  it("non-ok → returns []", async () => {
    globalThis.fetch.mockResolvedValueOnce({ ok: false, status: 500 });
    expect(await api.fetchAdsForExport()).toEqual([]);
  });
  it("missing .data → []", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true, status: 200, json: async () => ({}),
    });
    expect(await api.fetchAdsForExport()).toEqual([]);
  });
});
