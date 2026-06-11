import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const { fetchDashSpy, fetchSharedSpy } = vi.hoisted(() => ({
  fetchDashSpy: vi.fn(),
  fetchSharedSpy: vi.fn(),
}));

vi.mock("../../src/services/api", () => ({
  fetchDashboardState: fetchDashSpy,
  fetchSharedAd: fetchSharedSpy,
}));

let GuestProvider, useGuest;
function wrap(props) {
  return ({ children }) => React.createElement(GuestProvider, props, children);
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  fetchDashSpy.mockReset();
  fetchSharedSpy.mockReset();
  localStorage.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  Object.defineProperty(window, "location", {
    writable: true, configurable: true,
    value: { ...window.location, href: "", pathname: "/x" },
  });
  ({ GuestProvider, useGuest } = await import("../../src/hooks/useGuest.jsx"));
});
afterEach(() => { vi.useRealTimers(); });

describe("useGuest > outside provider", () => {
  it("returns null", () => {
    const { result } = renderHook(() => useGuest());
    expect(result.current).toBeNull();
  });
});

describe("useGuest > guestToken mode", () => {
  it("loads dashboard state on mount", async () => {
    fetchDashSpy.mockResolvedValue({ expired: false, uiState: { activeTab: "Newest" } });
    const { result } = renderHook(() => useGuest(), {
      wrapper: wrap({ guestToken: "gT" }),
    });
    await act(async () => { await Promise.resolve(); });
    expect(fetchDashSpy).toHaveBeenCalledWith("gT");
    expect(result.current.uiState).toEqual({ activeTab: "Newest" });
    expect(result.current.loading).toBe(false);
  });

  it("expired → redirects to LOGIN_URL", async () => {
    fetchDashSpy.mockResolvedValue({ expired: true });
    renderHook(() => useGuest(), { wrapper: wrap({ guestToken: "gT" }) });
    await act(async () => { await Promise.resolve(); });
    expect(window.location.href).toMatch(/poweradspy.com\/amember\/member|VITE_AMEMBER_LOGIN_URL/);
  });

  it("err.status=410 → redirect", async () => {
    fetchDashSpy.mockRejectedValue(Object.assign(new Error("gone"), { status: 410 }));
    renderHook(() => useGuest(), { wrapper: wrap({ guestToken: "gT" }) });
    await act(async () => { await Promise.resolve(); });
    expect(window.location.href).not.toBe("");
  });

  it("err.status=404 → redirect", async () => {
    fetchDashSpy.mockRejectedValue(Object.assign(new Error("not-found"), { status: 404 }));
    renderHook(() => useGuest(), { wrapper: wrap({ guestToken: "gT" }) });
    await act(async () => { await Promise.resolve(); });
    expect(window.location.href).not.toBe("");
  });

  it("network err (no status) → logs, no redirect, finally sets loading=false", async () => {
    fetchDashSpy.mockRejectedValue(new Error("net-down"));
    const { result } = renderHook(() => useGuest(), { wrapper: wrap({ guestToken: "gT" }) });
    await act(async () => { await Promise.resolve(); });
    expect(window.location.href).toBe("");
    expect(result.current.loading).toBe(false);
  });
});

describe("useGuest > shareToken mode", () => {
  it("loads single shared ad", async () => {
    fetchSharedSpy.mockResolvedValue({ expired: false, ad: { id: 1, network: "instagram" } });
    const { result } = renderHook(() => useGuest(), {
      wrapper: wrap({ shareToken: "sT" }),
    });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.sharedAds).toEqual([{ id: 1, network: "instagram" }]);
    expect(result.current.uiState.activePlatforms).toEqual(["instagram"]);
  });

  it("ad without network → defaults to 'facebook'", async () => {
    fetchSharedSpy.mockResolvedValue({ expired: false, ad: { id: 1 } });
    const { result } = renderHook(() => useGuest(), { wrapper: wrap({ shareToken: "sT" }) });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.uiState.activePlatforms).toEqual(["facebook"]);
  });

  it("result.ad missing → still defaults to facebook", async () => {
    fetchSharedSpy.mockResolvedValue({ expired: false });
    const { result } = renderHook(() => useGuest(), { wrapper: wrap({ shareToken: "sT" }) });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.uiState.activePlatforms).toEqual(["facebook"]);
  });

  it("expired → redirect", async () => {
    fetchSharedSpy.mockResolvedValue({ expired: true });
    renderHook(() => useGuest(), { wrapper: wrap({ shareToken: "sT" }) });
    await act(async () => { await Promise.resolve(); });
    expect(window.location.href).not.toBe("");
  });

  it("err.status=410 → redirect", async () => {
    fetchSharedSpy.mockRejectedValue(Object.assign(new Error("gone"), { status: 410 }));
    renderHook(() => useGuest(), { wrapper: wrap({ shareToken: "sT" }) });
    await act(async () => { await Promise.resolve(); });
    expect(window.location.href).not.toBe("");
  });

  it("err.status=404 → redirect", async () => {
    fetchSharedSpy.mockRejectedValue(Object.assign(new Error("nf"), { status: 404 }));
    renderHook(() => useGuest(), { wrapper: wrap({ shareToken: "sT" }) });
    await act(async () => { await Promise.resolve(); });
    expect(window.location.href).not.toBe("");
  });

  it("generic err (no status) → logged + loading false, no redirect", async () => {
    fetchSharedSpy.mockRejectedValue(new Error("net"));
    const { result } = renderHook(() => useGuest(), { wrapper: wrap({ shareToken: "sT" }) });
    await act(async () => { await Promise.resolve(); });
    expect(window.location.href).toBe("");
    expect(result.current.loading).toBe(false);
  });
});

describe("useGuest > no token at all", () => {
  it("uiState/sharedAds stay null; loading stays true (no fetch fired)", () => {
    const { result } = renderHook(() => useGuest(), { wrapper: wrap({}) });
    expect(result.current.uiState).toBeNull();
    expect(result.current.sharedAds).toBeNull();
    expect(result.current.loading).toBe(true);
  });
});

describe("useGuest > showGuestWarning", () => {
  it("isLoggedIn=true (real token) → no warning shown, returns false", () => {
    localStorage.setItem("authToken", "real-user-token");
    const { result } = renderHook(() => useGuest(), { wrapper: wrap({}) });
    let out;
    act(() => { out = result.current.showGuestWarning("Hi"); });
    expect(out).toBe(false);
    expect(result.current.toastMessage).toBeNull();
  });

  it("isLoggedIn=false → shows toast for 3s then clears", () => {
    const { result } = renderHook(() => useGuest(), { wrapper: wrap({}) });
    let out;
    act(() => { out = result.current.showGuestWarning("Login!"); });
    expect(out).toBe(true);
    expect(result.current.toastMessage).toBe("Login!");
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.toastMessage).toBeNull();
  });

  it("default message used when none provided", () => {
    const { result } = renderHook(() => useGuest(), { wrapper: wrap({}) });
    act(() => { result.current.showGuestWarning(); });
    expect(result.current.toastMessage).toMatch(/Please login/);
  });

  it("token matching env fallback → still considered guest", async () => {
    vi.stubEnv("VITE_PAS_API_TOKEN", "env-tok");
    localStorage.setItem("authToken", "env-tok");
    vi.resetModules();
    ({ GuestProvider, useGuest } = await import("../../src/hooks/useGuest.jsx"));
    const { result } = renderHook(() => useGuest(), { wrapper: wrap({}) });
    expect(result.current.isLoggedIn).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe("useGuest > redirectToDashboard", () => {
  it("stores state in sessionStorage and navigates to /", () => {
    const { result } = renderHook(() => useGuest(), { wrapper: wrap({}) });
    act(() => { result.current.redirectToDashboard({ x: 1 }); });
    expect(sessionStorage.getItem("guestToDashboard")).toBe(JSON.stringify({ x: 1 }));
    expect(window.location.href).toBe("/");
  });
  it("default empty state-overrides", () => {
    const { result } = renderHook(() => useGuest(), { wrapper: wrap({}) });
    act(() => { result.current.redirectToDashboard(); });
    expect(sessionStorage.getItem("guestToDashboard")).toBe("{}");
  });
});

describe("useGuest > VITE_AMEMBER_LOGIN_URL override", () => {
  it("uses env-supplied URL when set", async () => {
    vi.stubEnv("VITE_AMEMBER_LOGIN_URL", "https://custom.example/login");
    vi.resetModules();
    ({ GuestProvider, useGuest } = await import("../../src/hooks/useGuest.jsx"));
    fetchDashSpy.mockResolvedValue({ expired: true });
    renderHook(() => useGuest(), { wrapper: wrap({ guestToken: "x" }) });
    await act(async () => { await Promise.resolve(); });
    expect(window.location.href).toBe("https://custom.example/login");
    vi.unstubAllEnvs();
  });
});
