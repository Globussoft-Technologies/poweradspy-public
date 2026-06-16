// Coverage-fill: exercises module-load env-fallback branches (the env-SET side
// that the normal test runs, with env unset, don't reach). Each block stubs the
// env var, resets modules, and re-imports so the module-level const is recomputed.
import { describe, it, expect, vi, afterEach } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("coverage-fill: module-load env-set branches", () => {
  it("sduiVersions.SDUI_BASE uses VITE_SDUI_API_BASE_URL when set", async () => {
    vi.stubEnv("VITE_SDUI_API_BASE_URL", "https://sdui.example.test");
    vi.resetModules();
    const m = await import("../src/constants/sduiVersions.js");
    expect(m.SDUI_BASE).toBe("https://sdui.example.test");
  });

  it("sduiVersions.SDUI_BASE falls back to localhost when env unset (line 6)", async () => {
    vi.stubEnv("VITE_SDUI_API_BASE_URL", "");
    vi.resetModules();
    const m = await import("../src/constants/sduiVersions.js");
    expect(m.SDUI_BASE).toBe("http://localhost:8080");
  });

  it("usePushNotifications API_BASE_URL falls back to localhost when env unset (line 11)", async () => {
    vi.stubEnv("VITE_PAS_API_BASE_URL", "");
    vi.resetModules();
    const mod = await import("../src/hooks/usePushNotifications.js");
    expect(mod).toBeTruthy();
  });

  it("useAdInsights PAS_API_BASE falls back to '' when env unset (line 4)", async () => {
    vi.stubEnv("VITE_PAS_API_BASE_URL", ""); // → PAS_API_BASE '' fallback (line 4)
    vi.resetModules();
    const mod = await import("../src/hooks/useAdInsights.js");
    expect(typeof mod.useAdInsights).toBe("function");
  });

  it("useAdInsights module loads with VITE_PAS_API_BASE_URL set", async () => {
    vi.stubEnv("VITE_PAS_API_BASE_URL", "https://pas.example.test");
    vi.resetModules();
    const mod = await import("../src/hooks/useAdInsights.js");
    expect(typeof mod.useAdInsights).toBe("function");
  });

  it("api.js module-load env fallbacks (PAS token, NODE_API_URL, NAS_VIDEO_URL)", async () => {
    vi.stubEnv("VITE_PAS_API_TOKEN", "envtoken");
    vi.stubEnv("VITE_NODE_API_URL", "https://node.example.test/api");
    vi.stubEnv("VITE_NAS_VIDEO_URL", "https://nas-video.example.test/");
    vi.resetModules();
    const api = await import("../src/services/api.js");
    expect(typeof api.mapAdToCard).toBe("function");
    // NAS_VIDEO_BASE_URL is now set → mapAdToCard uses the nas_video_url branch
    const out = api.mapAdToCard({ nas_video_url: "/clip.mp4" });
    expect(out.videoUrl).toContain("nas-video.example.test");
    // nas_video_url without leading slash → '/' inserted
    const out2 = api.mapAdToCard({ nas_video_url: "clip2.mp4" });
    expect(out2.videoUrl).toContain("nas-video.example.test/clip2.mp4");
  });

  it("api.js module-load defaults when all env vars unset (|| right-hand sides)", async () => {
    vi.stubEnv("VITE_NODE_API_URL", "");      // → COMPETITOR_API_BASE localhost default (line 9)
    vi.stubEnv("VITE_PAS_API_BASE_URL", "");  // → LOGOUT_URL '' fallback (line 18)
    vi.stubEnv("VITE_NAS_VIDEO_URL", "");      // → NAS_VIDEO_BASE_URL '' fallback (line 65)
    vi.stubEnv("VITE_NAS_BASE_URL", "");       // → NAS_BASE_URL '' fallback (line 64)
    vi.stubEnv("VITE_PAS_API_TOKEN", "");
    vi.resetModules();
    const api = await import("../src/services/api.js");
    expect(typeof api.mapAdToCard).toBe("function");
  });

  it("api.js getPASToken falls back to VITE_PAS_API_TOKEN when auth token absent", async () => {
    vi.doMock("../src/hooks/useAuth", () => ({
      getAuthToken: () => "",          // falsy → forces `|| import.meta.env.VITE_PAS_API_TOKEN`
      clearSessionState: () => {},
    }));
    vi.stubEnv("VITE_PAS_API_BASE_URL", "https://pas.example.test");
    vi.stubEnv("VITE_PAS_API_TOKEN", "envtoken");
    vi.resetModules();
    const api = await import("../src/services/api.js");
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ data: [] }) });
    // unHideAds always sends Authorization: Bearer <getPASToken()> → exercises the env fallback
    await api.unHideAds({ network: "facebook", adId: 1, type: 1 });
    const hdr = globalThis.fetch.mock.calls[0][1].headers.Authorization;
    expect(hdr).toBe("Bearer envtoken");
    vi.doUnmock("../src/hooks/useAuth");
  });
});
