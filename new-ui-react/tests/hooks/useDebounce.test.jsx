import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebounce } from "../../src/hooks/useDebounce.js";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe("hooks/useDebounce", () => {
  it("returns the initial value immediately", () => {
    const { result } = renderHook(({ v }) => useDebounce(v, 100), {
      initialProps: { v: "a" },
    });
    expect(result.current).toBe("a");
  });
  it("does NOT update before the delay elapses", () => {
    const { result, rerender } = renderHook(({ v }) => useDebounce(v, 100), {
      initialProps: { v: "a" },
    });
    rerender({ v: "b" });
    act(() => { vi.advanceTimersByTime(50); });
    expect(result.current).toBe("a");
  });
  it("updates after delay elapses", () => {
    const { result, rerender } = renderHook(({ v }) => useDebounce(v, 100), {
      initialProps: { v: "a" },
    });
    rerender({ v: "b" });
    act(() => { vi.advanceTimersByTime(100); });
    expect(result.current).toBe("b");
  });
  it("cancels and restarts when value changes mid-delay", () => {
    const { result, rerender } = renderHook(({ v }) => useDebounce(v, 100), {
      initialProps: { v: "a" },
    });
    rerender({ v: "b" });
    act(() => { vi.advanceTimersByTime(50); });
    rerender({ v: "c" });
    act(() => { vi.advanceTimersByTime(50); });
    expect(result.current).toBe("a"); // still not updated
    act(() => { vi.advanceTimersByTime(50); });
    expect(result.current).toBe("c");
  });
  it("clears timeout on unmount", () => {
    const { rerender, unmount } = renderHook(({ v }) => useDebounce(v, 100), {
      initialProps: { v: "a" },
    });
    rerender({ v: "b" });
    unmount();
    // No throw if the timer fires after unmount
    expect(() => { vi.advanceTimersByTime(200); }).not.toThrow();
  });
});
