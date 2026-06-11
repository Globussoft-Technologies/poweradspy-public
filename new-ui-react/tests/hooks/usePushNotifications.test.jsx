import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const { getTokenSpy, onMessageSpy, getMessagingIfSupportedSpy, useAuthMock, isFirebaseConfiguredRef } = vi.hoisted(() => ({
  getTokenSpy: vi.fn(),
  onMessageSpy: vi.fn(),
  getMessagingIfSupportedSpy: vi.fn(),
  useAuthMock: { user: null },
  isFirebaseConfiguredRef: { current: true },
}));

vi.mock("firebase/messaging", () => ({
  getToken: getTokenSpy,
  onMessage: onMessageSpy,
}));

vi.mock("../../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: useAuthMock.user }),
}));

vi.mock("../../src/firebase/firebase", () => ({
  firebaseConfig: { apiKey: "x" },
  VAPID_KEY: "vk",
  get isFirebaseConfigured() { return isFirebaseConfiguredRef.current; },
  getMessagingIfSupported: getMessagingIfSupportedSpy,
}));

let usePushNotifications;
beforeEach(async () => {
  vi.resetModules();
  getTokenSpy.mockReset();
  onMessageSpy.mockReset();
  getMessagingIfSupportedSpy.mockReset();
  useAuthMock.user = null;
  isFirebaseConfiguredRef.current = true;
  localStorage.clear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});

  // Stub Notification global
  global.Notification = {
    permission: "default",
    requestPermission: vi.fn(async () => "granted"),
  };

  // Stub navigator.serviceWorker
  Object.defineProperty(navigator, "serviceWorker", {
    writable: true, configurable: true,
    value: {
      register: vi.fn(async () => ({})),
      ready: Promise.resolve({ showNotification: vi.fn() }),
    },
  });

  ({ usePushNotifications } = await import("../../src/hooks/usePushNotifications.js"));
});

describe("usePushNotifications > capability detection", () => {
  it("isSupported=true when SW+Notification+config all present", () => {
    const { result } = renderHook(() => usePushNotifications());
    expect(result.current.isSupported).toBe(true);
  });

  it("isSupported=false when firebase not configured", async () => {
    isFirebaseConfiguredRef.current = false;
    vi.resetModules();
    ({ usePushNotifications } = await import("../../src/hooks/usePushNotifications.js"));
    const { result } = renderHook(() => usePushNotifications());
    expect(result.current.isSupported).toBe(false);
  });

  it("permission reflects Notification.permission", () => {
    global.Notification.permission = "granted";
    const { result } = renderHook(() => usePushNotifications());
    expect(result.current.permission).toBe("granted");
  });
});

describe("usePushNotifications > setup effect (user present)", () => {
  beforeEach(() => { useAuthMock.user = { id: 1 }; });

  it("no user → skips SW setup", async () => {
    useAuthMock.user = null;
    renderHook(() => usePushNotifications());
    await act(async () => { await Promise.resolve(); });
    expect(navigator.serviceWorker.register).not.toHaveBeenCalled();
  });

  it("registers SW with config in query string", async () => {
    getMessagingIfSupportedSpy.mockResolvedValue(null);
    renderHook(() => usePushNotifications());
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    expect(navigator.serviceWorker.register).toHaveBeenCalled();
    const url = navigator.serviceWorker.register.mock.calls[0][0];
    expect(url).toMatch(/^\/firebase-messaging-sw\.js\?fb=/);
  });

  it("messaging unsupported → onMessage NOT subscribed", async () => {
    getMessagingIfSupportedSpy.mockResolvedValue(null);
    renderHook(() => usePushNotifications());
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    expect(onMessageSpy).not.toHaveBeenCalled();
  });

  it("messaging supported → onMessage subscribed; handler shows notification when permission granted", async () => {
    getMessagingIfSupportedSpy.mockResolvedValue({ kind: "messaging" });
    let messageHandler;
    onMessageSpy.mockImplementation((_, cb) => { messageHandler = cb; return () => {}; });
    global.Notification.permission = "granted";
    const showNotification = vi.fn();
    navigator.serviceWorker.ready = Promise.resolve({ showNotification });
    renderHook(() => usePushNotifications());
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });

    await act(async () => {
      await messageHandler({ data: { title: "Hi", body: "msg", icon: "ic", action_button: "/x" } });
    });
    expect(showNotification).toHaveBeenCalledWith("Hi", expect.objectContaining({
      body: "msg", icon: "ic", data: { link: "/x" },
    }));
  });

  it("foreground onMessage with denied permission → skip", async () => {
    getMessagingIfSupportedSpy.mockResolvedValue({ kind: "messaging" });
    let handler;
    onMessageSpy.mockImplementation((_, cb) => { handler = cb; return () => {}; });
    global.Notification.permission = "denied";
    const showNotification = vi.fn();
    navigator.serviceWorker.ready = Promise.resolve({ showNotification });
    renderHook(() => usePushNotifications());
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    await act(async () => { await handler({ data: {} }); });
    expect(showNotification).not.toHaveBeenCalled();
  });

  it("foreground onMessage with missing payload.data → defaults applied", async () => {
    getMessagingIfSupportedSpy.mockResolvedValue({ kind: "messaging" });
    let handler;
    onMessageSpy.mockImplementation((_, cb) => { handler = cb; return () => {}; });
    global.Notification.permission = "granted";
    const showNotification = vi.fn();
    navigator.serviceWorker.ready = Promise.resolve({ showNotification });
    renderHook(() => usePushNotifications());
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    await act(async () => { await handler({}); });
    expect(showNotification).toHaveBeenCalledWith("PowerAdSpy", expect.objectContaining({
      body: "", data: { link: "/" },
    }));
  });

  it("foreground onMessage: showNotification rejection → warn", async () => {
    getMessagingIfSupportedSpy.mockResolvedValue({ kind: "messaging" });
    let handler;
    onMessageSpy.mockImplementation((_, cb) => { handler = cb; return () => {}; });
    global.Notification.permission = "granted";
    navigator.serviceWorker.ready = Promise.reject(new Error("ready-fail"));
    renderHook(() => usePushNotifications());
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    await act(async () => { await handler({ data: {} }); });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("showNotification failed"), expect.any(Error));
  });

  it("auto re-register when permission granted on mount", async () => {
    global.Notification.permission = "granted";
    getMessagingIfSupportedSpy.mockResolvedValue({ kind: "messaging" });
    getTokenSpy.mockResolvedValue("fcm-fresh");
    localStorage.setItem("authToken", "tk");
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    onMessageSpy.mockImplementation(() => () => {});
    const { result } = renderHook(() => usePushNotifications());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(result.current.tokenRegistered).toBe(true);
  });

  it("auto re-register failure logs warn", async () => {
    global.Notification.permission = "granted";
    getMessagingIfSupportedSpy.mockResolvedValue({ kind: "messaging" });
    getTokenSpy.mockRejectedValue(new Error("token-fail"));
    onMessageSpy.mockImplementation(() => () => {});
    renderHook(() => usePushNotifications());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Auto re-register failed"), expect.any(String));
  });

  it("SW registration fails → error state set", async () => {
    navigator.serviceWorker.register.mockRejectedValueOnce(new Error("sw-fail"));
    const { result } = renderHook(() => usePushNotifications());
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(result.current.error).toBe("sw-fail");
  });

  it("unsubscribe called on unmount", async () => {
    getMessagingIfSupportedSpy.mockResolvedValue({ kind: "messaging" });
    const unsub = vi.fn();
    onMessageSpy.mockImplementation(() => unsub);
    const { unmount } = renderHook(() => usePushNotifications());
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    unmount();
    expect(unsub).toHaveBeenCalled();
  });
});

describe("usePushNotifications > requestPermissionAndRegister", () => {
  beforeEach(() => { useAuthMock.user = { id: 1 }; });

  it("returns false when not supported", async () => {
    isFirebaseConfiguredRef.current = false;
    vi.resetModules();
    ({ usePushNotifications } = await import("../../src/hooks/usePushNotifications.js"));
    const { result } = renderHook(() => usePushNotifications());
    let out;
    await act(async () => { out = await result.current.requestPermissionAndRegister(); });
    expect(out).toBe(false);
    expect(result.current.error).toMatch(/not supported/);
  });

  it("returns false when no user", async () => {
    useAuthMock.user = null;
    const { result } = renderHook(() => usePushNotifications());
    let out;
    await act(async () => { out = await result.current.requestPermissionAndRegister(); });
    expect(out).toBe(false);
    expect(result.current.error).toMatch(/not logged in/);
  });

  it("returns false when permission denied", async () => {
    global.Notification.requestPermission = vi.fn(async () => "denied");
    const { result } = renderHook(() => usePushNotifications());
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    let out;
    await act(async () => { out = await result.current.requestPermissionAndRegister(); });
    expect(out).toBe(false);
  });

  it("happy path: getFCMToken + registerTokenWithBackend → tokenRegistered=true", async () => {
    global.Notification.requestPermission = vi.fn(async () => "granted");
    getMessagingIfSupportedSpy.mockResolvedValue({ kind: "messaging" });
    getTokenSpy.mockResolvedValue("fcm-xyz");
    localStorage.setItem("authToken", "tk");
    globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    const { result } = renderHook(() => usePushNotifications());
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    let out;
    await act(async () => { out = await result.current.requestPermissionAndRegister(); });
    expect(out).toBe(true);
    expect(result.current.tokenRegistered).toBe(true);
    expect(localStorage.getItem("fcmToken")).toBe("fcm-xyz");
  });

  it("getFCMToken: messaging unsupported → throws", async () => {
    global.Notification.requestPermission = vi.fn(async () => "granted");
    getMessagingIfSupportedSpy.mockResolvedValue(null);
    const { result } = renderHook(() => usePushNotifications());
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    let out;
    await act(async () => { out = await result.current.requestPermissionAndRegister(); });
    expect(out).toBe(false);
    expect(result.current.error).toMatch(/not available/);
  });

  it("getFCMToken: getToken returns null → throws via outer 'Failed to get FCM token'", async () => {
    global.Notification.requestPermission = vi.fn(async () => "granted");
    getMessagingIfSupportedSpy.mockResolvedValue({ kind: "messaging" });
    getTokenSpy.mockResolvedValue(null);
    const { result } = renderHook(() => usePushNotifications());
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    let out;
    await act(async () => { out = await result.current.requestPermissionAndRegister(); });
    expect(out).toBe(false);
  });

  it("registerTokenWithBackend: no auth token → throws", async () => {
    global.Notification.requestPermission = vi.fn(async () => "granted");
    getMessagingIfSupportedSpy.mockResolvedValue({ kind: "messaging" });
    getTokenSpy.mockResolvedValue("fcm-x");
    localStorage.removeItem("authToken");
    const { result } = renderHook(() => usePushNotifications());
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    let out;
    await act(async () => { out = await result.current.requestPermissionAndRegister(); });
    expect(out).toBe(false);
    expect(result.current.error).toMatch(/Auth token not found/);
  });

  it("registerTokenWithBackend: non-OK response → throws errorData.message", async () => {
    global.Notification.requestPermission = vi.fn(async () => "granted");
    getMessagingIfSupportedSpy.mockResolvedValue({ kind: "messaging" });
    getTokenSpy.mockResolvedValue("fcm-x");
    localStorage.setItem("authToken", "tk");
    globalThis.fetch = vi.fn(async () => ({
      ok: false, status: 500, json: async () => ({ message: "backend-broke" }),
    }));
    const { result } = renderHook(() => usePushNotifications());
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    let out;
    await act(async () => { out = await result.current.requestPermissionAndRegister(); });
    expect(out).toBe(false);
    expect(result.current.error).toBe("backend-broke");
  });

  it("registerTokenWithBackend: non-OK with no message → uses HTTP status", async () => {
    global.Notification.requestPermission = vi.fn(async () => "granted");
    getMessagingIfSupportedSpy.mockResolvedValue({ kind: "messaging" });
    getTokenSpy.mockResolvedValue("fcm-x");
    localStorage.setItem("authToken", "tk");
    globalThis.fetch = vi.fn(async () => ({
      ok: false, status: 502, json: async () => ({}),
    }));
    const { result } = renderHook(() => usePushNotifications());
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    let out;
    await act(async () => { out = await result.current.requestPermissionAndRegister(); });
    expect(result.current.error).toMatch(/HTTP 502/);
  });

  it("registerTokenWithBackend: uses user.user_id when id absent", async () => {
    useAuthMock.user = { user_id: 99 };
    global.Notification.requestPermission = vi.fn(async () => "granted");
    getMessagingIfSupportedSpy.mockResolvedValue({ kind: "messaging" });
    getTokenSpy.mockResolvedValue("fcm-x");
    localStorage.setItem("authToken", "tk");
    let capturedBody;
    globalThis.fetch = vi.fn(async (_, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({}) };
    });
    const { result } = renderHook(() => usePushNotifications());
    await act(async () => { await new Promise((r) => setTimeout(r, 5)); });
    await act(async () => { await result.current.requestPermissionAndRegister(); });
    expect(capturedBody.userId).toBe(99);
  });
});
