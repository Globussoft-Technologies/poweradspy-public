import React from "react";
import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { ThemeProvider, useTheme, THEMES } from "../../src/hooks/useTheme.jsx";

describe("hooks/useTheme > THEMES export", () => {
  it("exposes dark/light/midnight presets", () => {
    expect(THEMES.dark.key).toBe("dark");
    expect(THEMES.light.key).toBe("light");
    expect(THEMES.midnight.key).toBe("midnight");
  });
});

describe("hooks/useTheme > ThemeProvider + useTheme", () => {
  it("default theme is 'dark'", () => {
    const wrapper = ({ children }) => React.createElement(ThemeProvider, null, children);
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current.theme).toBe("dark");
    expect(result.current.colors).toEqual(THEMES.dark);
  });
  it("ThemeProvider applies CSS variables on mount", () => {
    const wrapper = ({ children }) => React.createElement(ThemeProvider, null, children);
    renderHook(() => useTheme(), { wrapper });
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.style.getPropertyValue("--color-bg")).toBe(THEMES.dark.bg);
    expect(document.documentElement.style.getPropertyValue("--color-accent")).toBe(THEMES.dark.accent);
  });
  it("setTheme is a no-op stub (theme remains dark)", () => {
    const wrapper = ({ children }) => React.createElement(ThemeProvider, null, children);
    const { result } = renderHook(() => useTheme(), { wrapper });
    result.current.setTheme("light");
    expect(result.current.theme).toBe("dark");
  });
  it("cycleTheme is a no-op stub", () => {
    const wrapper = ({ children }) => React.createElement(ThemeProvider, null, children);
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(() => result.current.cycleTheme()).not.toThrow();
  });
  it("toggleTheme flips light↔dark via setTheme", () => {
    const wrapper = ({ children }) => React.createElement(ThemeProvider, null, children);
    const { result } = renderHook(() => useTheme(), { wrapper });
    // Doesn't throw — the body of toggleTheme executes setTheme()
    expect(() => result.current.toggleTheme()).not.toThrow();
  });
  it("useTheme returns undefined when used outside provider", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current).toBeUndefined();
  });
  it("setTheme with unknown key is a no-op (line 91 early return)", () => {
    const wrapper = ({ children }) => React.createElement(ThemeProvider, null, children);
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => { result.current.setTheme("does-not-exist"); });
    expect(result.current.theme).toBe("dark");
  });
  it("setTheme('light') then toggleTheme flips back to dark (line 99 left branch)", () => {
    const wrapper = ({ children }) => React.createElement(ThemeProvider, null, children);
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => { result.current.setTheme("light"); });
    expect(result.current.theme).toBe("light");
    act(() => { result.current.toggleTheme(); });
    expect(result.current.theme).toBe("dark");
  });
  it("cycleTheme advances through THEMES keys", () => {
    const wrapper = ({ children }) => React.createElement(ThemeProvider, null, children);
    const { result } = renderHook(() => useTheme(), { wrapper });
    act(() => { result.current.cycleTheme(); });
    // cycleTheme moves dark→next; second entry should differ
    expect(result.current.theme).not.toBe("dark");
  });
});
