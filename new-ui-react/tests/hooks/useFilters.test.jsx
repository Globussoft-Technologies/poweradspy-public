import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useFilters } from "../../src/hooks/useFilters.js";

describe("hooks/useFilters > initial state", () => {
  it("returns expected defaults with totalActiveFilters=0", () => {
    const { result } = renderHook(() => useFilters());
    expect(result.current.selCategories).toEqual([]);
    expect(result.current.adSeen).toBe("Anytime");
    expect(result.current.postDate).toBe("Last 30 Days");
    expect(result.current.domainAge).toBe("All Ages");
    expect(result.current.likesRange).toEqual([0, 1000000]);
    expect(result.current.totalActiveFilters).toBe(0);
  });
});

describe("hooks/useFilters > setters update state + count", () => {
  it("each multi-select setter adds to the count", () => {
    const { result } = renderHook(() => useFilters());
    act(() => { result.current.setSelCategories(["Finance"]); });
    expect(result.current.totalActiveFilters).toBe(1);
    act(() => { result.current.setSelAdTypes(["Video"]); });
    expect(result.current.totalActiveFilters).toBe(2);
    act(() => { result.current.setSelCTAs(["Shop Now"]); });
    expect(result.current.totalActiveFilters).toBe(3);
    act(() => { result.current.setSelCountries(["US"]); });
    expect(result.current.totalActiveFilters).toBe(4);
    act(() => { result.current.setSelEcommerce(["Shopify"]); });
    expect(result.current.totalActiveFilters).toBe(5);
    act(() => { result.current.setSelFunnels(["ClickFunnels"]); });
    expect(result.current.totalActiveFilters).toBe(6);
    act(() => { result.current.setSelAffiliates(["ClickBank"]); });
    expect(result.current.totalActiveFilters).toBe(7);
  });
  it("single-select setters bump count only when non-default", () => {
    const { result } = renderHook(() => useFilters());
    act(() => { result.current.setAdSeen("Today"); });
    expect(result.current.totalActiveFilters).toBe(1);
    act(() => { result.current.setPostDate("Today"); });
    expect(result.current.totalActiveFilters).toBe(2);
    act(() => { result.current.setDomainAge("5+ Years"); });
    expect(result.current.totalActiveFilters).toBe(3);
  });
  it("range setters bump count when either bound differs from default", () => {
    const { result } = renderHook(() => useFilters());
    act(() => { result.current.setLikesRange([10, 1000000]); });
    expect(result.current.totalActiveFilters).toBe(1);
    act(() => { result.current.setSharesRange([0, 999]); });
    expect(result.current.totalActiveFilters).toBe(2);
    act(() => { result.current.setCommentsRange([1, 1000000]); });
    expect(result.current.totalActiveFilters).toBe(3);
    act(() => { result.current.setImpressionsRange([0, 50]); });
    expect(result.current.totalActiveFilters).toBe(4);
  });
  it("search/platform/sortBy do NOT bump active count", () => {
    const { result } = renderHook(() => useFilters());
    act(() => {
      result.current.setSearchQuery("foo");
      result.current.setActivePlatform("Facebook");
      result.current.setSortBy("Newest");
    });
    expect(result.current.totalActiveFilters).toBe(0);
    expect(result.current.searchQuery).toBe("foo");
    expect(result.current.activePlatform).toBe("Facebook");
    expect(result.current.sortBy).toBe("Newest");
  });
});

describe("hooks/useFilters > clearAll", () => {
  it("resets every filter back to defaults", () => {
    const { result } = renderHook(() => useFilters());
    act(() => {
      result.current.setSelCategories(["Finance"]);
      result.current.setSelAdTypes(["Video"]);
      result.current.setSelCTAs(["Shop"]);
      result.current.setSelCountries(["US"]);
      result.current.setSelEcommerce(["Shopify"]);
      result.current.setSelFunnels(["CF"]);
      result.current.setSelAffiliates(["CB"]);
      result.current.setAdSeen("Today");
      result.current.setPostDate("Today");
      result.current.setDomainAge("5+ Years");
      result.current.setLikesRange([10, 100]);
      result.current.setSharesRange([10, 100]);
      result.current.setCommentsRange([10, 100]);
      result.current.setImpressionsRange([10, 100]);
      result.current.setSearchQuery("foo");
      result.current.setActivePlatform("Facebook");
    });
    expect(result.current.totalActiveFilters).toBeGreaterThan(0);
    act(() => { result.current.clearAll(); });
    expect(result.current.selCategories).toEqual([]);
    expect(result.current.adSeen).toBe("Anytime");
    expect(result.current.postDate).toBe("Last 30 Days");
    expect(result.current.domainAge).toBe("All Ages");
    expect(result.current.likesRange).toEqual([0, 1000000]);
    expect(result.current.searchQuery).toBe("");
    expect(result.current.activePlatform).toBe("");
    expect(result.current.totalActiveFilters).toBe(0);
  });
});
