import { describe, it, expect, vi, beforeEach } from "vitest";

const { initializeAppSpy, getMessagingSpy, isSupportedSpy } = vi.hoisted(() => ({
  initializeAppSpy: vi.fn(() => ({ name: "fake-app" })),
  getMessagingSpy: vi.fn(() => ({ kind: "messaging" })),
  isSupportedSpy: vi.fn(async () => true),
}));

vi.mock("firebase/app", () => ({
  initializeApp: initializeAppSpy,
}));
vi.mock("firebase/messaging", () => ({
  getMessaging: getMessagingSpy,
  isSupported: isSupportedSpy,
}));

async function loadSut() {
  vi.resetModules();
  return await import("../../src/firebase/firebase.js");
}

beforeEach(() => {
  initializeAppSpy.mockReset().mockReturnValue({ name: "fake-app" });
  getMessagingSpy.mockReset().mockReturnValue({ kind: "messaging" });
  isSupportedSpy.mockReset().mockResolvedValue(true);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("firebase/firebase > exports", () => {
  it("firebaseConfig pulls from env vars", async () => {
    vi.stubEnv("VITE_FIREBASE_API_KEY", "ak");
    vi.stubEnv("VITE_FIREBASE_AUTH_DOMAIN", "ad");
    vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "pid");
    vi.stubEnv("VITE_FIREBASE_MESSAGING_SENDER_ID", "sid");
    vi.stubEnv("VITE_FIREBASE_APP_ID", "appid");
    vi.stubEnv("VITE_FIREBASE_VAPID_KEY", "vk");
    const mod = await loadSut();
    expect(mod.firebaseConfig.apiKey).toBe("ak");
    expect(mod.VAPID_KEY).toBe("vk");
    expect(mod.isFirebaseConfigured).toBe(true);
    vi.unstubAllEnvs();
  });

  it("isFirebaseConfigured=false when any value missing", async () => {
    vi.stubEnv("VITE_FIREBASE_API_KEY", "");
    const mod = await loadSut();
    expect(mod.isFirebaseConfigured).toBe(false);
    vi.unstubAllEnvs();
  });

  it("isFirebaseConfigured=false when any value is REPLACE_WITH_ placeholder", async () => {
    vi.stubEnv("VITE_FIREBASE_API_KEY", "REPLACE_WITH_KEY");
    vi.stubEnv("VITE_FIREBASE_AUTH_DOMAIN", "ad");
    vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "pid");
    vi.stubEnv("VITE_FIREBASE_MESSAGING_SENDER_ID", "sid");
    vi.stubEnv("VITE_FIREBASE_APP_ID", "appid");
    vi.stubEnv("VITE_FIREBASE_VAPID_KEY", "vk");
    const mod = await loadSut();
    expect(mod.isFirebaseConfigured).toBe(false);
    vi.unstubAllEnvs();
  });

  it("isFirebaseConfigured=false when VAPID_KEY is placeholder", async () => {
    vi.stubEnv("VITE_FIREBASE_API_KEY", "ak");
    vi.stubEnv("VITE_FIREBASE_AUTH_DOMAIN", "ad");
    vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "pid");
    vi.stubEnv("VITE_FIREBASE_MESSAGING_SENDER_ID", "sid");
    vi.stubEnv("VITE_FIREBASE_APP_ID", "appid");
    vi.stubEnv("VITE_FIREBASE_VAPID_KEY", "REPLACE_WITH_VAPID");
    const mod = await loadSut();
    expect(mod.isFirebaseConfigured).toBe(false);
    vi.unstubAllEnvs();
  });
});

describe("firebase/firebase > getMessagingIfSupported", () => {
  function stubAllEnv() {
    vi.stubEnv("VITE_FIREBASE_API_KEY", "ak");
    vi.stubEnv("VITE_FIREBASE_AUTH_DOMAIN", "ad");
    vi.stubEnv("VITE_FIREBASE_PROJECT_ID", "pid");
    vi.stubEnv("VITE_FIREBASE_MESSAGING_SENDER_ID", "sid");
    vi.stubEnv("VITE_FIREBASE_APP_ID", "appid");
    vi.stubEnv("VITE_FIREBASE_VAPID_KEY", "vk");
  }

  it("returns null when not configured", async () => {
    vi.stubEnv("VITE_FIREBASE_API_KEY", "");
    const mod = await loadSut();
    const out = await mod.getMessagingIfSupported();
    expect(out).toBeNull();
    vi.unstubAllEnvs();
  });

  it("returns null when isSupported() false", async () => {
    stubAllEnv();
    isSupportedSpy.mockResolvedValueOnce(false);
    const mod = await loadSut();
    const out = await mod.getMessagingIfSupported();
    expect(out).toBeNull();
    vi.unstubAllEnvs();
  });

  it("returns messaging instance on happy path", async () => {
    stubAllEnv();
    const mod = await loadSut();
    const out = await mod.getMessagingIfSupported();
    expect(out).toEqual({ kind: "messaging" });
    expect(initializeAppSpy).toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it("memoizes app — second call reuses initialized app", async () => {
    stubAllEnv();
    const mod = await loadSut();
    initializeAppSpy.mockClear();
    await mod.getMessagingIfSupported();
    await mod.getMessagingIfSupported();
    expect(initializeAppSpy).toHaveBeenCalledTimes(1);
    vi.unstubAllEnvs();
  });

  it("catches thrown errors and returns null", async () => {
    stubAllEnv();
    isSupportedSpy.mockRejectedValueOnce(new Error("nope"));
    const mod = await loadSut();
    const out = await mod.getMessagingIfSupported();
    expect(out).toBeNull();
    vi.unstubAllEnvs();
  });

  it("catches errors with no message string", async () => {
    stubAllEnv();
    isSupportedSpy.mockRejectedValueOnce("string-error");
    const mod = await loadSut();
    const out = await mod.getMessagingIfSupported();
    expect(out).toBeNull();
    vi.unstubAllEnvs();
  });
});
