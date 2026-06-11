import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, render } from "@testing-library/react";

const { fetchPlanAccessSpy } = vi.hoisted(() => ({
  fetchPlanAccessSpy: vi.fn(),
}));

vi.mock("../../src/services/api", () => ({
  fetchPlanAccess: fetchPlanAccessSpy,
}));

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
  it("clears all auth data + cookies + redirects", async () => {
    vi.useFakeTimers();
    const token = makeJwt({ id: 1, exp: Math.floor(Date.now() / 1000) + 3600 });
    localStorage.setItem("authToken", token);
    localStorage.setItem("authUser", "{}");
    localStorage.setItem("persist:root", "x");
    localStorage.setItem("sdui.filterValues", "v");

    Object.defineProperty(window, "location", {
      writable: true, configurable: true,
      value: { ...window.location, href: "" },
    });

    const mod = await loadSut();
    const wrapper = ({ children }) => React.createElement(mod.AuthProvider, null, children);
    const { result } = renderHook(() => mod.useAuth(), { wrapper });
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.logout(); });

    expect(localStorage.getItem("authToken")).toBeNull();
    expect(localStorage.getItem("authUser")).toBeNull();
    expect(localStorage.getItem("persist:root")).toBeNull();
    expect(localStorage.getItem("sdui.filterValues")).toBeNull();
    expect(result.current.token).toBeNull();
    expect(result.current.user).toBeNull();

    act(() => { vi.advanceTimersByTime(60); });
    expect(window.location.href).toMatch(/\/logout$/);
    vi.useRealTimers();
  });
});

describe("useAuth > clearSessionState", () => {
  it("wipes specified localStorage keys + sessionStorage guestToDashboard", async () => {
    localStorage.setItem("sdui.filterValues", "x");
    localStorage.setItem("sdui_config_cache", "y");
    sessionStorage.setItem("guestToDashboard", "z");
    const mod = await loadSut();
    mod.clearSessionState();
    expect(localStorage.getItem("sdui.filterValues")).toBeNull();
    expect(localStorage.getItem("sdui_config_cache")).toBeNull();
    expect(sessionStorage.getItem("guestToDashboard")).toBeNull();
  });

  it("sessionStorage error path swallowed", async () => {
    const mod = await loadSut();
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation((k) => {
      if (k === "guestToDashboard") throw new Error("ss-fail");
    });
    expect(() => mod.clearSessionState()).not.toThrow();
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
