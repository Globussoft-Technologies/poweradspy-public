import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, render } from "@testing-library/react";

const { fetchPlanAccessSpy, fetchEntitlementsSpy, fetchOnboardingStatusSpy, trackEventSpy, dispatchSpy } = vi.hoisted(() => ({
  fetchPlanAccessSpy: vi.fn(),
  fetchEntitlementsSpy: vi.fn(),
  fetchOnboardingStatusSpy: vi.fn(),
  trackEventSpy: vi.fn(),
  dispatchSpy: vi.fn(),
}));

vi.mock("../../src/services/api", () => ({
  fetchPlanAccess: fetchPlanAccessSpy,
  fetchEntitlements: fetchEntitlementsSpy,
  fetchOnboardingStatus: fetchOnboardingStatusSpy,
  trackEvent: trackEventSpy,
}));

vi.mock("react-redux", async () => {
  const actual = await vi.importActual("react-redux");
  return {
    ...actual,
    useDispatch: () => dispatchSpy,
  };
});

// Helper: build a JWT with payload + optional expiration
function makeJwt(payload) {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload));
  return `${header}.${body}.sig`;
}

function setUrl(search) {
  Object.defineProperty(window, "location", {
    writable: true, configurable: true,
    value: {
      ...window.location, search,
      pathname: "/somepath",
      href: `http://x/somepath${search}`,
    },
  });
}

let useAuth, AuthProvider, clearSessionState, getAuthToken;

async function loadSut() {
  vi.resetModules();
  return await import("../../src/hooks/useAuth.jsx");
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  fetchPlanAccessSpy.mockReset().mockResolvedValue(null);
  fetchEntitlementsSpy.mockReset().mockResolvedValue(null);
  fetchOnboardingStatusSpy.mockReset().mockResolvedValue(null);
  dispatchSpy.mockReset();
  vi.stubEnv("VITE_PAS_API_TOKEN", "");
  setUrl("");
  vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
});

describe("useAuth > bootstrapAuth", () => {
  it("URL ?token=... → stores token + cleans URL", async () => {
    const token = makeJwt({ id: 7, exp: Math.floor(Date.now() / 1000) + 3600 });
    setUrl(`?token=${token}`);
    ({ useAuth, AuthProvider } = await loadSut());
    expect(localStorage.getItem("authToken")).toBe(token);
    expect(window.history.replaceState).toHaveBeenCalledWith({}, "", "/somepath");
  });

  it("localStorage token used when no URL token", async () => {
    const token = makeJwt({ id: 9, exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem("authToken", token);
    const mod = await loadSut();
    const wrapper = ({ children }) => React.createElement(mod.AuthProvider, null, children);
    const { result } = renderHook(() => mod.useAuth(), { wrapper });
    expect(result.current.user.id).toBe(9);
    expect(result.current.isAuthenticated).toBe(true);
  });

  it("expired token → wiped, returns null state", async () => {
    const expired = makeJwt({ id: 1, exp: Math.floor(Date.now() / 1000) - 100 });
    localStorage.setItem("authToken", expired);
    const mod = await loadSut();
    expect(localStorage.getItem("authToken")).toBeNull();
    expect(localStorage.getItem("authUser")).toBeNull();
  });

  it("malformed token → wiped", async () => {
    localStorage.setItem("authToken", "not-a-jwt-at-all");
    await loadSut();
    expect(localStorage.getItem("authToken")).toBeNull();
  });

  it("no token anywhere → empty state", async () => {
    const mod = await loadSut();
    const wrapper = ({ children }) => React.createElement(mod.AuthProvider, null, children);
    const { result } = renderHook(() => mod.useAuth(), { wrapper });
    expect(result.current.token).toBeNull();
    expect(result.current.user).toBeNull();
    expect(result.current.isAuthenticated).toBe(false);
  });

  it("valid token writes authUser into localStorage", async () => {
    const token = makeJwt({ id: 42, exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem("authToken", token);
    await loadSut();
    const user = JSON.parse(localStorage.getItem("authUser"));
    expect(user.id).toBe(42);
  });

  it("token without exp → kept (no expiration check)", async () => {
    const token = makeJwt({ id: 42 }); // no exp
    localStorage.setItem("authToken", token);
    await loadSut();
    expect(localStorage.getItem("authToken")).toBe(token);
  });

  it("env VITE_PAS_API_TOKEN used when no URL token and no localStorage token", async () => {
    const envToken = makeJwt({ id: 11, exp: Math.floor(Date.now() / 1000) + 3600 });
    vi.stubEnv("VITE_PAS_API_TOKEN", envToken);
    const mod = await loadSut();
    expect(localStorage.getItem("authToken")).toBe(envToken);
    const wrapper = ({ children }) => React.createElement(mod.AuthProvider, null, children);
    const { result } = renderHook(() => mod.useAuth(), { wrapper });
    expect(result.current.user.id).toBe(11);
    vi.unstubAllEnvs();
  });

  it("logout lock blocks env fallback from auto-restoring a session", async () => {
    const envToken = makeJwt({ id: 99, exp: Math.floor(Date.now() / 1000) + 3600 });
    vi.stubEnv("VITE_PAS_API_TOKEN", envToken);
    localStorage.setItem("pas_disable_env_auth_fallback", envToken);
    const mod = await loadSut();
    expect(localStorage.getItem("authToken")).toBeNull();
    const wrapper = ({ children }) => React.createElement(mod.AuthProvider, null, children);
    const { result } = renderHook(() => mod.useAuth(), { wrapper });
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.token).toBeNull();
    vi.unstubAllEnvs();
  });
});

describe("useAuth > AuthProvider + useAuth", () => {
  it("throws when used outside provider", async () => {
    const mod = await loadSut();
    // Render hook without wrapper: should throw on first render
    expect(() => renderHook(() => mod.useAuth())).toThrow(/must be used within AuthProvider/);
  });

  it("fetchPlanAccess called once token is present", async () => {
    const token = makeJwt({ id: 1, exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem("authToken", token);
    fetchPlanAccessSpy.mockResolvedValueOnce({ filters: { country: { enabled: true } } });
    const mod = await loadSut();
    const wrapper = ({ children }) => React.createElement(mod.AuthProvider, null, children);
    const { result } = renderHook(() => mod.useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); });
    expect(fetchPlanAccessSpy).toHaveBeenCalled();
    expect(result.current.planAccess?.filters?.country?.enabled).toBe(true);
    expect(result.current.planAccessResolved).toBe(true);
  });

  it("keeps automatic plan-dependent work pending until both access requests settle", async () => {
    const token = makeJwt({ id: 1, exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem("authToken", token);
    let resolveLegacy;
    let resolveUnified;
    fetchPlanAccessSpy.mockReturnValueOnce(new Promise((resolve) => { resolveLegacy = resolve; }));
    fetchEntitlementsSpy.mockReturnValueOnce(new Promise((resolve) => { resolveUnified = resolve; }));
    const mod = await loadSut();
    const wrapper = ({ children }) => React.createElement(mod.AuthProvider, null, children);
    const { result } = renderHook(() => mod.useAuth(), { wrapper });

    expect(result.current.planAccessResolved).toBe(false);
    await act(async () => {
      resolveLegacy({ allowedPlatforms: ["facebook"] });
      resolveUnified({ capabilities: { "ads.search": { allowed: true, allowedNetworks: ["facebook"] } } });
      await Promise.resolve();
    });
    expect(result.current.planAccessResolved).toBe(true);
  });

  it("fetchPlanAccess error path swallowed (catch)", async () => {
    const token = makeJwt({ id: 1, exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem("authToken", token);
    fetchPlanAccessSpy.mockRejectedValueOnce(new Error("net"));
    const mod = await loadSut();
    const wrapper = ({ children }) => React.createElement(mod.AuthProvider, null, children);
    const { result } = renderHook(() => mod.useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.planAccess).toBeNull();
  });

  it("fetchPlanAccess returns null → planAccess stays null", async () => {
    const token = makeJwt({ id: 1, exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem("authToken", token);
    fetchPlanAccessSpy.mockResolvedValueOnce(null);
    const mod = await loadSut();
    const wrapper = ({ children }) => React.createElement(mod.AuthProvider, null, children);
    const { result } = renderHook(() => mod.useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.planAccess).toBeNull();
  });

  it("no token → fetchPlanAccess not called", async () => {
    const mod = await loadSut();
    const wrapper = ({ children }) => React.createElement(mod.AuthProvider, null, children);
    renderHook(() => mod.useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); });
    expect(fetchPlanAccessSpy).not.toHaveBeenCalled();
  });
});

describe("useAuth > isFilterRestricted", () => {
  it("uses the canonical AI Metadata capability for the AI Filters launcher", async () => {
    const token = makeJwt({ id: 1, exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem("authToken", token);
    fetchEntitlementsSpy.mockResolvedValueOnce({
      capabilities: { "legacy.ai_metadata_filters": { allowed: false } },
    });
    const mod = await loadSut();
    const wrapper = ({ children }) => React.createElement(mod.AuthProvider, null, children);
    const { result } = renderHook(() => mod.useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.isFilterRestricted("ai_meta")).toBe(true);
    expect(result.current.isFilterRestricted("ai_metadata_filters")).toBe(true);
  });

  it("keeps Sidebar Budget separate from the allowed Avg Ad Budget capability", async () => {
    const token = makeJwt({ id: 1, exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem("authToken", token);
    fetchPlanAccessSpy.mockResolvedValueOnce({
      filters: { ad_budget_sort: { enabled: true } },
    });
    fetchEntitlementsSpy.mockResolvedValueOnce({
      capabilities: {
        "legacy.sidebar_budget": { allowed: false },
        "sort.ad_budget": { allowed: true },
      },
    });
    const mod = await loadSut();
    const wrapper = ({ children }) => React.createElement(mod.AuthProvider, null, children);
    const { result } = renderHook(() => mod.useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.isFilterRestricted("sidebar_budget")).toBe(true);
    expect(result.current.isFilterRestricted("budget_filter")).toBe(true);
    expect(result.current.isFilterRestricted("avg_ad_budget")).toBe(false);
    expect(result.current.isFilterRestricted("ad_budget")).toBe(false);
    expect(result.current.isFilterRestricted("adBudget")).toBe(false);
  });

  it("uses the old shared budget rule only when unified entitlements are unavailable", async () => {
    const token = makeJwt({ id: 1, exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem("authToken", token);
    fetchPlanAccessSpy.mockResolvedValueOnce({
      filters: { ad_budget_sort: { enabled: false } },
    });
    const mod = await loadSut();
    const wrapper = ({ children }) => React.createElement(mod.AuthProvider, null, children);
    const { result } = renderHook(() => mod.useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); });

    expect(result.current.filterHasPlanEntry("budget_filter")).toBe(true);
    expect(result.current.isFilterRestricted("budget_filter")).toBe(true);
  });

  it("maps verified_filter to the enabled verified plan rule", async () => {
    const token = makeJwt({ id: 1, exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem("authToken", token);
    fetchPlanAccessSpy.mockResolvedValueOnce({
      filters: {
        verified: { enabled: true },
        engagement: { enabled: false },
      },
    });
    const mod = await loadSut();
    const wrapper = ({ children }) => React.createElement(mod.AuthProvider, null, children);
    const { result } = renderHook(() => mod.useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.filterHasPlanEntry("verified_filter")).toBe(true);
    expect(result.current.isFilterRestricted("verified_filter")).toBe(false);
  });

  it("no planAccess → not restricted", async () => {
    const mod = await loadSut();
    const wrapper = ({ children }) => React.createElement(mod.AuthProvider, null, children);
    const { result } = renderHook(() => mod.useAuth(), { wrapper });
    expect(result.current.isFilterRestricted("cta")).toBe(false);
  });

  it("planAccess filters with enabled:false → restricted", async () => {
    const token = makeJwt({ id: 1, exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem("authToken", token);
    fetchPlanAccessSpy.mockResolvedValueOnce({
      filters: { call_to_action: { enabled: false } },
    });
    const mod = await loadSut();
    const wrapper = ({ children }) => React.createElement(mod.AuthProvider, null, children);
    const { result } = renderHook(() => mod.useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.isFilterRestricted("cta")).toBe(true);
    expect(result.current.isFilterRestricted("cta_filter")).toBe(true);
  });

  it("planAccess filters with enabled:true → NOT restricted", async () => {
    const token = makeJwt({ id: 1, exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem("authToken", token);
    fetchPlanAccessSpy.mockResolvedValueOnce({
      filters: { country: { enabled: true } },
    });
    const mod = await loadSut();
    const wrapper = ({ children }) => React.createElement(mod.AuthProvider, null, children);
    const { result } = renderHook(() => mod.useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.isFilterRestricted("country")).toBe(false);
  });

  it("filter id not in mapping → uses raw id", async () => {
    const token = makeJwt({ id: 1, exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem("authToken", token);
    fetchPlanAccessSpy.mockResolvedValueOnce({
      filters: { my_custom_filter: { enabled: false } },
    });
    const mod = await loadSut();
    const wrapper = ({ children }) => React.createElement(mod.AuthProvider, null, children);
    const { result } = renderHook(() => mod.useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.isFilterRestricted("my_custom_filter")).toBe(true);
  });

  it("filter id absent from planAccess.filters map → not restricted", async () => {
    const token = makeJwt({ id: 1, exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem("authToken", token);
    fetchPlanAccessSpy.mockResolvedValueOnce({ filters: {} });
    const mod = await loadSut();
    const wrapper = ({ children }) => React.createElement(mod.AuthProvider, null, children);
    const { result } = renderHook(() => mod.useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.isFilterRestricted("country")).toBe(false);
  });
});

describe("useAuth > filterHasPlanEntry", () => {
  it("no planAccess → false", async () => {
    const mod = await loadSut();
    const wrapper = ({ children }) => React.createElement(mod.AuthProvider, null, children);
    const { result } = renderHook(() => mod.useAuth(), { wrapper });
    expect(result.current.filterHasPlanEntry("cta")).toBe(false);
  });

  it("planAccess has entry → true (even if disabled)", async () => {
    const token = makeJwt({ id: 1, exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem("authToken", token);
    fetchPlanAccessSpy.mockResolvedValueOnce({
      filters: { country: { enabled: false } },
    });
    const mod = await loadSut();
    const wrapper = ({ children }) => React.createElement(mod.AuthProvider, null, children);
    const { result } = renderHook(() => mod.useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.filterHasPlanEntry("country")).toBe(true);
  });

  it("no matching entry → false", async () => {
    const token = makeJwt({ id: 1, exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem("authToken", token);
    fetchPlanAccessSpy.mockResolvedValueOnce({ filters: { country: { enabled: true } } });
    const mod = await loadSut();
    const wrapper = ({ children }) => React.createElement(mod.AuthProvider, null, children);
    const { result } = renderHook(() => mod.useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.filterHasPlanEntry("nonexistent")).toBe(false);
  });
});

describe("useAuth > logout", () => {
  it("clears all local/session state and redirects immediately", async () => {
    const token = makeJwt({ id: 1, exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem("authToken", token);
    localStorage.setItem("authUser", "{}");
    localStorage.setItem("persist:root", "x");
    localStorage.setItem("sdui.filterValues", "v");
    localStorage.setItem("sdui.activePlatforms", JSON.stringify(["facebook", "instagram"]));
    localStorage.setItem("sdui_config_cache", "y");
    localStorage.setItem("pas_onboarding_dismissed_1", "1");
    sessionStorage.setItem("pendingSearch", "search");
    sessionStorage.setItem("unrelated-session-state", "value");

    Object.defineProperty(window, "location", {
      writable: true, configurable: true,
      value: { ...window.location, href: "" },
    });

    const mod = await loadSut();
    const wrapper = ({ children }) => React.createElement(mod.AuthProvider, null, children);
    const { result } = renderHook(() => mod.useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.logout(); });

    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(result.current.token).toBeNull();
    expect(result.current.user).toBeNull();

    expect(window.location.href).toMatch(/\/logout$/);
  });
});

describe("useAuth > cleanup helpers", () => {
  it("markFiltersForExpiry swallows sessionStorage errors", async () => {
    const mod = await loadSut();
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation((k) => {
      if (k === "guestToDashboard") throw new Error("ss-fail");
    });
    expect(() => mod.markFiltersForExpiry()).not.toThrow();
    Storage.prototype.removeItem.mockRestore?.();
  });
});

describe("useAuth > getAuthToken", () => {
  it("returns the token from localStorage", async () => {
    const token = makeJwt({ id: 1, exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem("authToken", token);
    const mod = await loadSut();
    expect(mod.getAuthToken()).toBe(token);
  });
  it("returns '' when no token", async () => {
    const mod = await loadSut();
    expect(mod.getAuthToken()).toBe("");
  });
});

describe("useAuth > onboarding dismiss behavior", () => {
  it("fresh login clears onboarding dismiss key for that user", async () => {
    const token = makeJwt({ id: 7, user_id: 7, exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem("pas_onboarding_dismissed_7", "1");
    setUrl(`?token=${token}`);
    await loadSut();
    expect(localStorage.getItem("pas_onboarding_dismissed_7")).toBeNull();
  });

  it("fresh login keeps onboarding dismiss key when user is already completed", async () => {
    const token = makeJwt({ id: 12, user_id: 12, needsOnboarding: false, exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem("pas_onboarding_dismissed_12", "1");
    setUrl(`?token=${token}`);
    await loadSut();
    expect(localStorage.getItem("pas_onboarding_dismissed_12")).toBe("1");
  });

  it("needsOnboarding true opens onboarding modal", async () => {
    const token = makeJwt({ id: 1, user_id: 1, needsOnboarding: true, exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem("authToken", token);
    fetchOnboardingStatusSpy.mockResolvedValueOnce({ needsOnboarding: true });
    const mod = await loadSut();
    const wrapper = ({ children }) => React.createElement(mod.AuthProvider, null, children);
    renderHook(() => mod.useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); });
    expect(dispatchSpy).toHaveBeenCalledWith({ payload: "isOnboardingModalOpen", type: "ui/openModal" });
  });

  it("dismissed onboarding skip suppresses modal even when JWT says true", async () => {
    const token = makeJwt({ id: 8, user_id: 8, needsOnboarding: true, exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem("authToken", token);
    localStorage.setItem("pas_onboarding_dismissed_8", "1");
    const mod = await loadSut();
    const wrapper = ({ children }) => React.createElement(mod.AuthProvider, null, children);
    renderHook(() => mod.useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); });
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("falls back to onboarding status when JWT lacks needsOnboarding", async () => {
    const token = makeJwt({ id: 9, user_id: 9, exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem("authToken", token);
    fetchOnboardingStatusSpy.mockResolvedValueOnce({ needsOnboarding: true });
    const mod = await loadSut();
    const wrapper = ({ children }) => React.createElement(mod.AuthProvider, null, children);
    renderHook(() => mod.useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(fetchOnboardingStatusSpy).toHaveBeenCalled();
    expect(dispatchSpy).toHaveBeenCalledWith({ payload: "isOnboardingModalOpen", type: "ui/openModal" });
  });

  it("dismissed onboarding skip suppresses fallback status modal too", async () => {
    const token = makeJwt({ id: 10, user_id: 10, exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem("authToken", token);
    localStorage.setItem("pas_onboarding_dismissed_10", "1");
    fetchOnboardingStatusSpy.mockResolvedValueOnce({ needsOnboarding: true });
    const mod = await loadSut();
    const wrapper = ({ children }) => React.createElement(mod.AuthProvider, null, children);
    renderHook(() => mod.useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(fetchOnboardingStatusSpy).not.toHaveBeenCalled();
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("completed users also lose onboarding state on full logout", async () => {
    const token = makeJwt({ id: 2, user_id: 2, needsOnboarding: false, exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem("authToken", token);
    localStorage.setItem("authUser", JSON.stringify({ id: 2, user_id: 2, needsOnboarding: false }));
    localStorage.setItem("pas_onboarding_dismissed_2", "1");

    Object.defineProperty(window, "location", {
      writable: true, configurable: true,
      value: { ...window.location, href: "" },
    });

    const mod = await loadSut();
    const wrapper = ({ children }) => React.createElement(mod.AuthProvider, null, children);
    const { result } = renderHook(() => mod.useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.logout(); });

    expect(localStorage.getItem("pas_onboarding_dismissed_2")).toBeNull();
  });
});

describe("useAuth > cross-tab sync", () => {
  it("storage logout from another tab clears the current tab auth state", async () => {
    const token = makeJwt({ id: 5, exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem("authToken", token);
    localStorage.setItem("authUser", JSON.stringify({ id: 5 }));

    const mod = await loadSut();
    const wrapper = ({ children }) => React.createElement(mod.AuthProvider, null, children);
    const { result } = renderHook(() => mod.useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.isAuthenticated).toBe(true);

    act(() => {
      localStorage.removeItem("authToken");
      localStorage.removeItem("authUser");
      window.dispatchEvent(new StorageEvent("storage", {
        key: "authToken",
        oldValue: token,
        newValue: null,
        storageArea: localStorage,
      }));
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.token).toBeNull();
    expect(result.current.user).toBeNull();
  });
});
