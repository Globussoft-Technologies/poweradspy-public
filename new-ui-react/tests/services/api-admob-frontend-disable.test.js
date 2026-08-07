import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/hooks/useAuth", () => ({
  getAuthToken: vi.fn(() => "tk"),
  markFiltersForExpiry: vi.fn(),
  disableEnvAuthFallback: vi.fn(),
}));

let api;

beforeEach(async () => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("VITE_ENABLE_ADMOB", "false");
  vi.stubEnv("VITE_PAS_API_BASE_URL", "http://localhost:3000");
  globalThis.fetch = vi.fn();
  Object.defineProperty(window, "location", {
    writable: true,
    configurable: true,
    value: { ...window.location, pathname: "/dashboard", href: "" },
  });
  api = await import("../../src/services/api.js");
});

describe("frontend AdMob disable gate", () => {
  it("removes admob from search payload networks", () => {
    const payload = api.buildSearchPayload({
      activePlatforms: ["facebook", "admob"],
      activePlatform: "facebook",
    });

    expect(payload.network).toEqual(["facebook"]);
  });

  it("filters admob ads and meta from fetchAds results", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { ad_id: 1, network: "facebook" },
          { ad_id: 2, network: "admob" },
        ],
        meta: {
          total: { facebook: 4, admob: 9 },
          networksWithData: ["facebook", "admob"],
        },
      }),
    });

    const result = await api.fetchAds({
      activePlatforms: ["facebook", "admob"],
      activePlatform: "facebook",
    });

    expect(result.ads).toHaveLength(1);
    expect(result.ads[0].network).toBe("facebook");
    expect(result.meta.total).toEqual({ facebook: 4 });
    expect(result.meta.networksWithData).toEqual(["facebook"]);
  });

  it("strips admob from AI quick-filter availability requests", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        availability: { preset_1: true },
        visiblePresetIds: ["preset_1"],
        totalPresets: 1,
      }),
    });

    await api.fetchAiQuickFilterAvailability({
      activePlatforms: ["facebook", "admob"],
      presets: [
        {
          id: "preset_1",
          payload: { network: ["facebook", "admob"] },
        },
      ],
    });

    const [, request] = globalThis.fetch.mock.calls[0];
    const body = JSON.parse(request.body);
    expect(body.activePlatforms).toEqual(["facebook"]);
    expect(body.presets[0].payload.network).toEqual(["facebook"]);
  });

  it("filters admob ads and meta from public search results", async () => {
    globalThis.fetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { ad_id: 1, network: "admob" },
          { ad_id: 2, network: "google" },
        ],
        meta: {
          total: { admob: 10, google: 2 },
          networksWithData: ["admob", "google"],
          guestLimitReached: false,
        },
      }),
    });

    const result = await api.publicSearchAds(0, "all");

    expect(result.ads).toHaveLength(1);
    expect(result.ads[0].network).toBe("google");
    expect(result.availableNetworks).toEqual(["google"]);
    expect(result.meta.total).toEqual({ google: 2 });
  });
});
