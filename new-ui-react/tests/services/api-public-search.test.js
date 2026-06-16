// Tests for publicSearchAds + guestSearchAds branch gaps in src/services/api.js.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/hooks/useAuth", () => ({
  getAuthToken: vi.fn(() => "tk"),
  clearSessionState: vi.fn(),
}));

let api;
beforeEach(async () => {
  vi.resetModules();
  globalThis.fetch = vi.fn();
  Object.defineProperty(window, "location", {
    writable: true, configurable: true,
    value: { ...window.location, pathname: "/dashboard", href: "" },
  });
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  api = await import("../../src/services/api.js");
});

describe("api > publicSearchAds", () => {
  it("happy path → maps ads, networks, meta", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ ad_id: 1, network: "facebook" }],
        meta: { networksWithData: ["facebook"], guestLimitReached: false },
      }),
    });
    const out = await api.publicSearchAds(0, "facebook");
    expect(out.ads.length).toBe(1);
    expect(out.availableNetworks).toEqual(["facebook"]);
    expect(out.noDataMessage).toBeNull();
    expect(out.guestLimitReached).toBe(false);
  });

  it("empty data → noDataMessage set, defaults applied", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
    });
    const out = await api.publicSearchAds();
    expect(out.ads).toEqual([]);
    expect(out.availableNetworks).toEqual([]);
    expect(out.noDataMessage).toBe("No ads found");
    expect(out.meta).toEqual({});
    expect(out.guestLimitReached).toBe(false);
  });

  it("guestLimitReached propagated from meta", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ ad_id: 2 }], meta: { guestLimitReached: true } }),
    });
    const out = await api.publicSearchAds(10, "all");
    expect(out.guestLimitReached).toBe(true);
  });

  it("non-ok with message → throws that message", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: false, status: 403,
      json: async () => ({ message: "blocked" }),
    });
    await expect(api.publicSearchAds()).rejects.toThrow("blocked");
  });

  it("non-ok with unparseable body → throws status-based message", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: false, status: 500,
      json: async () => { throw new Error("bad json"); },
    });
    await expect(api.publicSearchAds()).rejects.toThrow("Public search error: 500");
  });
});
