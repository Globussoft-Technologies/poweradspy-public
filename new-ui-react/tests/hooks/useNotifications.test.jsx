import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const { fetchSpy, markSpy, authUser } = vi.hoisted(() => ({
  fetchSpy: vi.fn(),
  markSpy: vi.fn(),
  authUser: { current: null },
}));

vi.mock("../../src/services/api", () => ({
  fetchNotifications: fetchSpy,
  markNotificationsRead: markSpy,
}));

vi.mock("../../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: authUser.current }),
}));

const LS_KEY = "shown_notifications";

let useNotifications;
beforeEach(async () => {
  vi.useFakeTimers();
  fetchSpy.mockReset();
  markSpy.mockReset();
  authUser.current = null;
  localStorage.clear();
  ({ useNotifications } = await import("../../src/hooks/useNotifications.js"));
});
afterEach(() => { vi.useRealTimers(); });

describe("hooks/useNotifications > no user", () => {
  it("returns empty state + no polling when user absent", () => {
    const { result } = renderHook(() => useNotifications());
    expect(result.current.notifications).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("logging out clears localStorage", () => {
    localStorage.setItem(LS_KEY, JSON.stringify([1, 2]));
    renderHook(() => useNotifications());
    expect(localStorage.getItem(LS_KEY)).toBeNull();
  });
});

describe("hooks/useNotifications > with user", () => {
  beforeEach(() => { authUser.current = { id: 1 }; });

  it("initial poll: fetches + sets state + sets fresh toasts", async () => {
    fetchSpy.mockResolvedValue({ data: [{ id: 1 }, { id: 2 }] });
    const { result } = renderHook(() => useNotifications());
    await act(async () => { await Promise.resolve(); });
    expect(fetchSpy).toHaveBeenCalled();
    expect(result.current.notifications.length).toBe(2);
    expect(result.current.unreadCount).toBe(2);
    expect(result.current.newNotifications.length).toBe(2);
    // Saved to LS
    expect(JSON.parse(localStorage.getItem(LS_KEY))).toEqual([1, 2]);
  });

  it("dedup: previously-shown ids excluded from fresh", async () => {
    localStorage.setItem(LS_KEY, JSON.stringify([1]));
    fetchSpy.mockResolvedValue({ data: [{ id: 1 }, { id: 2 }] });
    const { result } = renderHook(() => useNotifications());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.newNotifications.map(n => n.id)).toEqual([2]);
  });

  it("no fresh → newNotifications stays empty (else branch not taken)", async () => {
    localStorage.setItem(LS_KEY, JSON.stringify([1, 2]));
    fetchSpy.mockResolvedValue({ data: [{ id: 1 }, { id: 2 }] });
    const { result } = renderHook(() => useNotifications());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.newNotifications).toEqual([]);
  });

  it("getShownNotificationIds: malformed JSON → []", async () => {
    localStorage.setItem(LS_KEY, "not-json");
    fetchSpy.mockResolvedValue({ data: [{ id: 9 }] });
    const { result } = renderHook(() => useNotifications());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.newNotifications.map(n => n.id)).toEqual([9]);
  });

  it("saveShownNotificationIds: quota error swallowed", async () => {
    fetchSpy.mockResolvedValue({ data: [{ id: 1 }] });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    const { result } = renderHook(() => useNotifications());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.unreadCount).toBe(1);
    Storage.prototype.setItem.mockRestore?.();
  });

  it("missing .data → defaults to []", async () => {
    fetchSpy.mockResolvedValue({});
    const { result } = renderHook(() => useNotifications());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.notifications).toEqual([]);
  });

  it("fetch throws → silently swallowed", async () => {
    fetchSpy.mockRejectedValue(new Error("net-down"));
    const { result } = renderHook(() => useNotifications());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.notifications).toEqual([]);
    expect(result.current.loading).toBe(false);
  });

  it("polling: subsequent poll fires after POLL_INTERVAL", async () => {
    fetchSpy.mockResolvedValue({ data: [] });
    renderHook(() => useNotifications());
    await act(async () => { await Promise.resolve(); });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("unmount clears the interval", async () => {
    fetchSpy.mockResolvedValue({ data: [] });
    const clearSpy = vi.spyOn(global, "clearInterval");
    const { unmount } = renderHook(() => useNotifications());
    await act(async () => { await Promise.resolve(); });
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });

  it("markAllRead with empty notifications → no-op (early return)", async () => {
    fetchSpy.mockResolvedValue({ data: [] });
    const { result } = renderHook(() => useNotifications());
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await result.current.markAllRead(); });
    expect(markSpy).not.toHaveBeenCalled();
  });

  it("markAllRead success → clears state", async () => {
    fetchSpy.mockResolvedValue({ data: [{ id: 1 }, { id: 2 }] });
    markSpy.mockResolvedValue(true);
    const { result } = renderHook(() => useNotifications());
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await result.current.markAllRead(); });
    expect(markSpy).toHaveBeenCalledWith([1, 2]);
    expect(result.current.notifications).toEqual([]);
    expect(result.current.unreadCount).toBe(0);
  });

  it("markAllRead failure → state preserved", async () => {
    fetchSpy.mockResolvedValue({ data: [{ id: 1 }] });
    markSpy.mockResolvedValue(false);
    const { result } = renderHook(() => useNotifications());
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await result.current.markAllRead(); });
    expect(result.current.notifications.length).toBe(1);
  });

  it("markRead success → removes matching ids and decrements count", async () => {
    fetchSpy.mockResolvedValue({ data: [{ id: 1 }, { id: 2 }, { id: 3 }] });
    markSpy.mockResolvedValue(true);
    const { result } = renderHook(() => useNotifications());
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await result.current.markRead([1, 3]); });
    expect(result.current.notifications.map(n => n.id)).toEqual([2]);
    expect(result.current.unreadCount).toBe(1);
  });

  it("markRead success: count cannot go negative", async () => {
    fetchSpy.mockResolvedValue({ data: [{ id: 1 }] });
    markSpy.mockResolvedValue(true);
    const { result } = renderHook(() => useNotifications());
    await act(async () => { await Promise.resolve(); });
    // Mark 5 ids — count starts at 1; Math.max(0, 1-5) = 0
    await act(async () => { await result.current.markRead([1, 2, 3, 4, 5]); });
    expect(result.current.unreadCount).toBe(0);
  });

  it("markRead failure → state preserved", async () => {
    fetchSpy.mockResolvedValue({ data: [{ id: 1 }] });
    markSpy.mockResolvedValue(false);
    const { result } = renderHook(() => useNotifications());
    await act(async () => { await Promise.resolve(); });
    await act(async () => { await result.current.markRead([1]); });
    expect(result.current.notifications.length).toBe(1);
  });

  it("refresh = poll function exposed", async () => {
    fetchSpy.mockResolvedValue({ data: [] });
    const { result } = renderHook(() => useNotifications());
    await act(async () => { await Promise.resolve(); });
    fetchSpy.mockClear();
    await act(async () => { await result.current.refresh(); });
    expect(fetchSpy).toHaveBeenCalled();
  });
});

describe("hooks/useNotifications > user becomes null mid-session", () => {
  it("user→null → refresh hits poll early-return (line 39)", async () => {
    fetchSpy.mockResolvedValue({ data: [{ id: 1 }] });
    authUser.current = { id: 1 };
    const { result, rerender } = renderHook(() => useNotifications());
    await act(async () => { await Promise.resolve(); });
    fetchSpy.mockClear();
    // Flip user to null and rerender — new poll closure has user=null
    authUser.current = null;
    rerender();
    await act(async () => { await result.current.refresh(); });
    // poll short-circuits → no fetch
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
