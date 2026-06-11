import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const { fetchVersionSpy, fetchConfigSpy } = vi.hoisted(() => ({
  fetchVersionSpy: vi.fn(),
  fetchConfigSpy: vi.fn(),
}));

vi.mock("../../src/services/sduiService.js", () => ({
  fetchSDUIConfigVersion: fetchVersionSpy,
  fetchSDUIConfig: fetchConfigSpy,
}));

let useSDUIPolling;
beforeEach(async () => {
  vi.useFakeTimers();
  fetchVersionSpy.mockReset();
  fetchConfigSpy.mockReset();
  ({ useSDUIPolling } = await import("../../src/hooks/useSDUIPolling.js"));
});
afterEach(() => { vi.useRealTimers(); });

describe("hooks/useSDUIPolling", () => {
  it("registers an interval and clears on unmount", () => {
    const setSpy = vi.spyOn(global, "setInterval");
    const clearSpy = vi.spyOn(global, "clearInterval");
    const { unmount } = renderHook(() => useSDUIPolling(0, vi.fn()));
    expect(setSpy).toHaveBeenCalled();
    unmount();
    expect(clearSpy).toHaveBeenCalled();
  });

  it("polling: version changed → fetch full config + invoke callback", async () => {
    fetchVersionSpy.mockResolvedValue({ config_version: 99 });
    fetchConfigSpy.mockResolvedValue({ schema_version: "1.0.0", config_version: 99 });
    const cb = vi.fn();
    renderHook(() => useSDUIPolling(0, cb));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchVersionSpy).toHaveBeenCalled();
    expect(fetchConfigSpy).toHaveBeenCalledWith({ skipCache: true });
    expect(cb).toHaveBeenCalled();
  });

  it("polling: version unchanged → no full fetch", async () => {
    fetchVersionSpy.mockResolvedValue({ config_version: 5 });
    const cb = vi.fn();
    renderHook(() => useSDUIPolling(5, cb));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchConfigSpy).not.toHaveBeenCalled();
    expect(cb).not.toHaveBeenCalled();
  });

  it("polling: version endpoint missing → fallback full fetch + callback when changed", async () => {
    fetchVersionSpy.mockResolvedValue(null);
    fetchConfigSpy.mockResolvedValue({ config_version: 9 });
    const cb = vi.fn();
    renderHook(() => useSDUIPolling(0, cb));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchConfigSpy).toHaveBeenCalled();
    expect(cb).toHaveBeenCalled();
  });

  it("polling: version endpoint returns non-numeric → fallback path", async () => {
    fetchVersionSpy.mockResolvedValue({ config_version: "not-a-number" });
    fetchConfigSpy.mockResolvedValue({ config_version: 9 });
    const cb = vi.fn();
    renderHook(() => useSDUIPolling(0, cb));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchConfigSpy).toHaveBeenCalled();
  });

  it("polling: fallback full fetch returns same version → no callback", async () => {
    fetchVersionSpy.mockResolvedValue(null);
    fetchConfigSpy.mockResolvedValue({ config_version: 5 });
    const cb = vi.fn();
    renderHook(() => useSDUIPolling(5, cb));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(cb).not.toHaveBeenCalled();
  });

  it("polling: fallback full fetch returns null → no callback", async () => {
    fetchVersionSpy.mockResolvedValue(null);
    fetchConfigSpy.mockResolvedValue(null);
    const cb = vi.fn();
    renderHook(() => useSDUIPolling(5, cb));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(cb).not.toHaveBeenCalled();
  });

  it("polling: fetchSDUIConfig returning falsy after version-change skips callback", async () => {
    fetchVersionSpy.mockResolvedValue({ config_version: 99 });
    fetchConfigSpy.mockResolvedValue(null);
    const cb = vi.fn();
    renderHook(() => useSDUIPolling(0, cb));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(cb).not.toHaveBeenCalled();
  });

  it("polling: thrown error is swallowed", async () => {
    fetchVersionSpy.mockRejectedValue(new Error("net-down"));
    const cb = vi.fn();
    renderHook(() => useSDUIPolling(0, cb));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(cb).not.toHaveBeenCalled();
  });

  it("currentConfigVersion change is reflected via ref (without re-creating interval)", async () => {
    fetchVersionSpy.mockResolvedValue({ config_version: 5 });
    const cb = vi.fn();
    const { rerender } = renderHook(({ v }) => useSDUIPolling(v, cb), {
      initialProps: { v: 0 },
    });
    rerender({ v: 5 });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetchConfigSpy).not.toHaveBeenCalled();
  });

  it("onConfigChanged change is reflected via ref", async () => {
    fetchVersionSpy.mockResolvedValue({ config_version: 99 });
    fetchConfigSpy.mockResolvedValue({ config_version: 99 });
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    const { rerender } = renderHook(({ cb }) => useSDUIPolling(0, cb), {
      initialProps: { cb: cb1 },
    });
    rerender({ cb: cb2 });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(cb2).toHaveBeenCalled();
    expect(cb1).not.toHaveBeenCalled();
  });
});
