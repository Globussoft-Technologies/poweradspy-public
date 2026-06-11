import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useBrowserHistoryState } from "../../src/hooks/useBrowserHistoryState.js";

let replaceSpy, pushSpy, addSpy, removeSpy;
const popHandlers = [];

beforeEach(() => {
  vi.useFakeTimers();
  replaceSpy = vi.spyOn(window.history, "replaceState").mockImplementation(() => {});
  pushSpy = vi.spyOn(window.history, "pushState").mockImplementation(() => {});
  popHandlers.length = 0;
  addSpy = vi.spyOn(window, "addEventListener").mockImplementation((evt, cb) => {
    if (evt === "popstate") popHandlers.push(cb);
  });
  removeSpy = vi.spyOn(window, "removeEventListener").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  replaceSpy.mockRestore();
  pushSpy.mockRestore();
  addSpy.mockRestore();
  removeSpy.mockRestore();
});

describe("hooks/useBrowserHistoryState", () => {
  it("on mount: schedules replaceState with the initial snapshot (debounced 250ms)", () => {
    renderHook(() => useBrowserHistoryState({ a: 1 }, vi.fn()));
    expect(replaceSpy).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(250); });
    expect(replaceSpy).toHaveBeenCalled();
  });
  it("subsequent snapshot change → pushState (not replaceState)", () => {
    const { rerender } = renderHook(({ snap }) => useBrowserHistoryState(snap, vi.fn()), {
      initialProps: { snap: { a: 1 } },
    });
    act(() => { vi.advanceTimersByTime(250); });
    rerender({ snap: { a: 2 } });
    act(() => { vi.advanceTimersByTime(250); });
    expect(pushSpy).toHaveBeenCalled();
  });
  it("identical snapshot (same JSON) → no extra history entry", () => {
    const { rerender } = renderHook(({ snap }) => useBrowserHistoryState(snap, vi.fn()), {
      initialProps: { snap: { a: 1 } },
    });
    act(() => { vi.advanceTimersByTime(250); });
    pushSpy.mockClear();
    rerender({ snap: { a: 1 } });
    act(() => { vi.advanceTimersByTime(250); });
    expect(pushSpy).not.toHaveBeenCalled();
  });
  it("debounced effect cleared on rapid changes", () => {
    const { rerender } = renderHook(({ snap }) => useBrowserHistoryState(snap, vi.fn()), {
      initialProps: { snap: { a: 1 } },
    });
    rerender({ snap: { a: 2 } });
    rerender({ snap: { a: 3 } });
    act(() => { vi.advanceTimersByTime(250); });
    // First effect was cancelled, last (a:3) fires
    expect(replaceSpy).toHaveBeenCalledTimes(1);
  });
  it("popstate with our tagged snapshot → calls onRestore", () => {
    const onRestore = vi.fn();
    renderHook(() => useBrowserHistoryState({ a: 1 }, onRestore));
    const tagged = { a: 9, __uiSnapshot: true };
    popHandlers[0]({ state: tagged });
    expect(onRestore).toHaveBeenCalledWith(tagged);
  });
  it("popstate with untagged state → onRestore NOT called", () => {
    const onRestore = vi.fn();
    renderHook(() => useBrowserHistoryState({ a: 1 }, onRestore));
    popHandlers[0]({ state: { x: 1 } });
    expect(onRestore).not.toHaveBeenCalled();
  });
  it("popstate with null state → onRestore NOT called", () => {
    const onRestore = vi.fn();
    renderHook(() => useBrowserHistoryState({ a: 1 }, onRestore));
    popHandlers[0]({ state: null });
    expect(onRestore).not.toHaveBeenCalled();
  });
  it("popstate with onRestore undefined → no throw (optional chain)", () => {
    renderHook(() => useBrowserHistoryState({ a: 1 }, undefined));
    expect(() => popHandlers[0]({ state: { __uiSnapshot: true } })).not.toThrow();
  });
  it("unmount removes the popstate listener", () => {
    const { unmount } = renderHook(() => useBrowserHistoryState({ a: 1 }, vi.fn()));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("popstate", expect.any(Function));
  });
});
