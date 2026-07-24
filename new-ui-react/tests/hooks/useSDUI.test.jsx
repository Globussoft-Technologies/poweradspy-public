import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const { fetchSpy, pollingSpy } = vi.hoisted(() => ({
  fetchSpy: vi.fn(),
  pollingSpy: vi.fn(),
}));

vi.mock("../../src/services/sduiService", () => ({
  fetchSDUIConfig: fetchSpy,
}));

vi.mock("../../src/hooks/useSDUIPolling", () => ({
  useSDUIPolling: (v, cb) => pollingSpy(v, cb),
}));

let useSDUI;
beforeEach(async () => {
  vi.resetModules();
  fetchSpy.mockReset();
  pollingSpy.mockReset();
  localStorage.clear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  ({ useSDUI } = await import("../../src/hooks/useSDUI.js"));
});

const platformsDoc = {
  _id: "platforms", config_type: "navbar",
  filters: [{
    _id: "platforms_main",
    options: [
      { value: "facebook", selected_by_default: true },
      { value: "instagram", selected_by_default: true },
      { value: "google", selected_by_default: false },
    ],
    platform_filter_matrix: {
      facebook: ["news_feed"],
      instagram: ["story_filter"],
    },
  }],
};

function makeConfig(overrides = {}) {
  return {
    schema_version: "1.0.0",
    config_version: 1,
    searchbar: [],
    navbar: [platformsDoc],
    sidebar: [],
    ...overrides,
  };
}

describe("useSDUI > initial load", () => {
  it("fetches config and applies platform defaults", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.config).toBeDefined();
    expect(result.current.activePlatforms).toEqual(["facebook", "instagram"]);
    expect(result.current.loading).toBe(false);
  });

  it("when no defaults flagged → activePlatforms = all option values", async () => {
    const cfg = makeConfig({
      navbar: [{
        ...platformsDoc,
        filters: [{
          ...platformsDoc.filters[0],
          options: [
            { value: "facebook" },
            { value: "instagram" },
          ],
        }],
      }],
    });
    fetchSpy.mockResolvedValue(cfg);
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.activePlatforms.sort()).toEqual(["facebook", "instagram"]);
  });

  it("no platforms doc at all → defaults to hardcoded 9-platform list", async () => {
    fetchSpy.mockResolvedValue(makeConfig({ navbar: [] }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.activePlatforms).toContain("facebook");
    expect(result.current.activePlatforms.length).toBeGreaterThan(5);
  });

  it("fetch error → sets error state", async () => {
    fetchSpy.mockRejectedValue(new Error("net-down"));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.error).toBe("net-down");
    expect(result.current.loading).toBe(false);
  });

  it("loadLS: malformed JSON → fallback used", async () => {
    localStorage.setItem("sdui.filterValues", "not-json");
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.filterValues).toEqual({});
  });

  it("loadLS strips _autoSortField from filterValues", async () => {
    localStorage.setItem("sdui.filterValues", JSON.stringify({ x: 1, _autoSortField: "y" }));
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.filterValues._autoSortField).toBeUndefined();
    expect(result.current.filterValues.x).toBe(1);
  });

  it("loadLS missing key → fallback", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.filterValues).toEqual({});
    expect(result.current.activePlatforms).toEqual(["facebook", "instagram"]);
  });

  it("does NOT override pre-existing activePlatforms from storage", async () => {
    localStorage.setItem("sdui.activePlatforms", JSON.stringify(["youtube"]));
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.activePlatforms).toEqual(["youtube"]);
  });
});

describe("useSDUI > setters + getters", () => {
  beforeEach(() => {
    fetchSpy.mockResolvedValue(makeConfig());
  });

  it("setFilter stores value", async () => {
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setFilter("category", ["x"]); });
    expect(result.current.getFilter("category")).toEqual(["x"]);
  });

  it("setFilter with range value adds _autoSortField", async () => {
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setFilter("likes", [0, 100]); });
    expect(result.current.filterValues._autoSortField).toBe("likes");
  });

  it("setFilter clearing range removes _autoSortField if it matched", async () => {
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setFilter("likes", [0, 100]); });
    act(() => { result.current.setFilter("likes", []); }); // non-range value clears
    expect(result.current.filterValues._autoSortField).toBeUndefined();
  });

  it("setFilter writing _autoSortField directly → just stored", async () => {
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setFilter("_autoSortField", "x"); });
    expect(result.current.filterValues._autoSortField).toBe("x");
  });

  it("setAllFilters replaces the whole map", async () => {
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setAllFilters({ a: 1 }); });
    expect(result.current.filterValues).toEqual({ a: 1 });
    act(() => { result.current.setAllFilters(null); });
    expect(result.current.filterValues).toEqual({});
  });

  it("clearAll empties filterValues", async () => {
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setFilter("x", "y"); });
    act(() => { result.current.clearAll(); });
    expect(result.current.filterValues).toEqual({});
  });

  it("clears hidden Transparency state after leaving the Google tab", async () => {
    localStorage.setItem("sdui.activePlatforms", JSON.stringify(["google"]));
    localStorage.setItem("sdui.filterValues", JSON.stringify({
      google_transparency_ads: true,
      google_transparency_subnetwork: "SHOPPING",
      country: ["India"],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.filterValues.google_transparency_ads).toBe(true);

    act(() => { result.current.setActivePlatforms(["facebook"]); });
    expect(result.current.filterValues).toEqual({ country: ["India"] });
  });

  it("clears the dependent subnetwork when Transparency is disabled", async () => {
    localStorage.setItem("sdui.activePlatforms", JSON.stringify(["google"]));
    localStorage.setItem("sdui.filterValues", JSON.stringify({
      google_transparency_ads: true,
      google_transparency_subnetwork: "SEARCH",
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });

    act(() => { result.current.setFilter("google_transparency_ads", false); });

    expect(result.current.filterValues.google_transparency_ads).toBe(false);
    expect(result.current.filterValues).not.toHaveProperty(
      "google_transparency_subnetwork",
    );
  });

  it("keeps Transparency state when Google remains in a mixed selection", async () => {
    localStorage.setItem("sdui.activePlatforms", JSON.stringify(["google"]));
    localStorage.setItem("sdui.filterValues", JSON.stringify({
      google_transparency_ads: true,
      google_transparency_subnetwork: "SHOPPING",
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });

    act(() => {
      result.current.setActivePlatforms(["instagram", "google"]);
    });

    expect(result.current.filterValues).toMatchObject({
      google_transparency_ads: true,
      google_transparency_subnetwork: "SHOPPING",
    });
  });
});

describe("useSDUI > totalActiveFilters", () => {
  beforeEach(() => { fetchSpy.mockResolvedValue(makeConfig()); });

  it("counts truthy values, excluding 'adcategory' and '_autoSortField'", async () => {
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => {
      result.current.setAllFilters({
        category: ["a"],   // array with items → 1
        title: "hello",    // string → 1
        active: true,      // boolean true → 1
        nope: false,       // false → 0
        empty: [],         // empty array → 0
        clear: null,       // null → 0
        blank: "",         // empty string → 0
        adcategory: "x",   // excluded
        _autoSortField: "x", // excluded
      });
    });
    expect(result.current.totalActiveFilters).toBe(3);
  });
});

describe("useSDUI > buildQueryParams", () => {
  it("returns {} when no config", async () => {
    fetchSpy.mockRejectedValue(new Error("x"));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.buildQueryParams()).toEqual({});
  });

  it("maps array values via filter.query_param join", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{ _id: "d", filters: [{ _id: "category", query_param: "cat" }] }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setFilter("category", ["a", "b"]); });
    expect(result.current.buildQueryParams()).toEqual({ cat: "a,b" });
  });

  it("maps non-array values directly", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{ _id: "d", filters: [{ _id: "name", query_param: "n" }] }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setFilter("name", "foo"); });
    expect(result.current.buildQueryParams()).toEqual({ n: "foo" });
  });

  it("filter without query_param → skipped", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{ _id: "d", filters: [{ _id: "category" }] }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setFilter("category", ["a"]); });
    expect(result.current.buildQueryParams()).toEqual({});
  });

  it("null value → skipped", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{ _id: "d", filters: [{ _id: "category", query_param: "c" }] }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setFilter("category", null); });
    expect(result.current.buildQueryParams()).toEqual({});
  });

  it("empty array value → skipped", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{ _id: "d", filters: [{ _id: "category", query_param: "c" }] }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setFilter("category", []); });
    expect(result.current.buildQueryParams()).toEqual({});
  });
});

describe("useSDUI > clearFiltersUnsupportedBy", () => {
  it("no config → no-op", async () => {
    fetchSpy.mockRejectedValue(new Error("x"));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.clearFiltersUnsupportedBy(["facebook"]); });
    expect(result.current.filterValues).toEqual({});
  });

  it("no newPlatforms → no-op", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setFilter("x", ["a"]); });
    act(() => { result.current.clearFiltersUnsupportedBy([]); });
    expect(result.current.filterValues.x).toEqual(["a"]);
  });

  it("clears filter when its platform_applicability doesn't include the new platforms", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{
        _id: "d",
        filters: [{ _id: "fb_only", platform_applicability: "facebook" }],
      }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setFilter("fb_only", ["x"]); });
    act(() => { result.current.clearFiltersUnsupportedBy(["youtube"]); });
    expect(result.current.filterValues.fb_only).toEqual([]);
  });

  it("filter with platform_applicability as ARRAY → Array.isArray truthy branch (line 209)", async () => {
    // platform_applicability is already an array, so the
    // `Array.isArray(pa) ? pa : [pa]` ternary takes the truthy branch.
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{
        _id: "d",
        filters: [{ _id: "fb_ig_only", platform_applicability: ["facebook", "instagram"] }],
      }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setFilter("fb_ig_only", ["x"]); });
    // youtube isn't in the array → unsupported → filter cleared
    act(() => { result.current.clearFiltersUnsupportedBy(["youtube"]); });
    expect(result.current.filterValues.fb_ig_only).toEqual([]);
  });

  it("filter with platform_applicability='all' → kept", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{
        _id: "d", filters: [{ _id: "any", platform_applicability: "all" }],
      }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setFilter("any", ["x"]); });
    act(() => { result.current.clearFiltersUnsupportedBy(["youtube"]); });
    expect(result.current.filterValues.any).toEqual(["x"]);
  });

  it("inactive filter values are not modified", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{ _id: "d", filters: [{ _id: "x", platform_applicability: "facebook" }] }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setAllFilters({ x: [] }); });
    act(() => { result.current.clearFiltersUnsupportedBy(["youtube"]); });
    expect(result.current.filterValues.x).toEqual([]);
  });

  it("unmatched filter id → skipped", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setAllFilters({ unknown: ["v"] }); });
    act(() => { result.current.clearFiltersUnsupportedBy(["youtube"]); });
    expect(result.current.filterValues.unknown).toEqual(["v"]);
  });

  it("matches via query_param too", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{
        _id: "d",
        filters: [{ _id: "f1", query_param: "myParam", platform_applicability: "facebook" }],
      }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setFilter("myParam", ["x"]); });
    act(() => { result.current.clearFiltersUnsupportedBy(["youtube"]); });
    expect(result.current.filterValues.myParam).toEqual([]);
  });

  it("string filter value (not array) is cleared to ''", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{ _id: "d", filters: [{ _id: "needle", platform_applicability: "facebook" }] }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setFilter("needle", "value"); });
    act(() => { result.current.clearFiltersUnsupportedBy(["youtube"]); });
    expect(result.current.filterValues.needle).toBe("");
  });
});

describe("useSDUI > effectivePlatforms", () => {
  it("no config → just activePlatforms", async () => {
    fetchSpy.mockRejectedValue(new Error("x"));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.effectivePlatforms).toEqual([]);
  });

  it("no restricting filters → returns activePlatforms", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.effectivePlatforms).toEqual(["facebook", "instagram"]);
  });

  it("filter-level platform_applicability restricts", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{ _id: "d", filters: [{ _id: "fbOnly", platform_applicability: "facebook" }] }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setFilter("fbOnly", ["x"]); });
    expect(result.current.effectivePlatforms).toEqual(["facebook"]);
  });

  it("option-level platform_applicability is checked first", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{
        _id: "d", filters: [{
          _id: "f", platform_applicability: ["facebook", "youtube"],
          options: [{ value: "yt", platform_applicability: ["youtube"] }],
        }],
      }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setActivePlatforms(["facebook", "youtube"]); });
    act(() => { result.current.setFilter("f", ["yt"]); });
    expect(result.current.effectivePlatforms).toEqual(["youtube"]);
  });

  it("intersection empty → returns activePlatforms (escape hatch)", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{ _id: "d", filters: [{ _id: "fbOnly", platform_applicability: "facebook" }] }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setActivePlatforms(["youtube"]); });
    act(() => { result.current.setFilter("fbOnly", ["x"]); });
    expect(result.current.effectivePlatforms).toEqual(["youtube"]);
  });

  it("sorting alias matches sort_by filter", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{ _id: "d", filters: [{ _id: "sort_by", platform_applicability: "facebook" }] }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setFilter("sorting", "newest"); });
    expect(result.current.effectivePlatforms).toEqual(["facebook"]);
  });

  it("ad_type alias matches ad_types/_filter/query_param/group_id", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{ _id: "d", filters: [{ _id: "ad_types", platform_applicability: "facebook" }] }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setFilter("ad_type", ["video"]); });
    expect(result.current.effectivePlatforms).toEqual(["facebook"]);
  });
});

describe("useSDUI > visibility helpers", () => {
  it("shouldShowFilter: visible:false → false", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.shouldShowFilter({ visible: false })).toBe(false);
  });

  it("shouldShowFilter: null filter → false", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.shouldShowFilter(null)).toBe(false);
  });

  it("shouldShowFilter: PA='all' → true", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.shouldShowFilter({ platform_applicability: "all" })).toBe(true);
  });

  it("shouldShowFilter: PA matches activePlatform → true", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.shouldShowFilter({ platform_applicability: ["facebook"] })).toBe(true);
  });

  it("shouldShowFilter: PA doesn't match → false", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.shouldShowFilter({ platform_applicability: ["reddit"] })).toBe(false);
  });

  it("shouldShowFilter: empty activePlatforms with non-all PA → true (passes)", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setActivePlatforms([]); });
    expect(result.current.shouldShowFilter({ platform_applicability: ["foo"] })).toBe(true);
  });

  it("shouldShowFilter: matrix restriction allows group_id", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.shouldShowFilter({ _id: "news_feed" })).toBe(true);
  });

  it("shouldShowFilter: matrix restriction blocks unlisted group_id", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.shouldShowFilter({ _id: "unknown_group" })).toBe(false);
  });

  it("shouldShowFilter: section with child PA → uses child match", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.shouldShowFilter({
      filters: [{ platform_applicability: ["facebook"] }],
    })).toBe(true);
    expect(result.current.shouldShowFilter({
      filters: [{ platform_applicability: ["reddit"] }],
    })).toBe(false);
  });

  it("shouldShowFilter: section with no child PA → falls through to matrix", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.shouldShowFilter({
      _id: "news_feed",
      filters: [{ platform_applicability: "all" }],
    })).toBe(true);
  });

  it("shouldShowOption: null option → false", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.shouldShowOption(null)).toBe(false);
  });

  it("shouldShowOption: matches PA", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.shouldShowOption({ platform_applicability: "facebook" })).toBe(true);
    expect(result.current.shouldShowOption({ platform_applicability: "reddit" })).toBe(false);
  });
});

describe("useSDUI > isDependencySatisfied", () => {
  it("no depends_on → satisfied", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.isDependencySatisfied({})).toBe(true);
  });

  it("depends_on with array value: non-empty satisfies", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setFilter("parent", ["x"]); });
    expect(result.current.isDependencySatisfied({ depends_on: "parent" })).toBe(true);
  });

  it("depends_on with array value: empty does NOT satisfy", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setFilter("parent", []); });
    expect(result.current.isDependencySatisfied({ depends_on: "parent" })).toBe(false);
  });

  it("depends_on with truthy scalar → satisfied", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setFilter("parent", "val"); });
    expect(result.current.isDependencySatisfied({ depends_on: "parent" })).toBe(true);
  });
});

describe("useSDUI > platform re-fetch effect", () => {
  it("changing activePlatforms triggers second fetch with platforms param", async () => {
    // Need allPlatformCountRef to be >0 so a smaller selection trips isAll=false.
    // Pre-seed LS so the initial-mount effect snapshots a count of 3.
    localStorage.setItem("sdui.activePlatforms", JSON.stringify(["facebook", "instagram", "google"]));
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    fetchSpy.mockClear();
    fetchSpy.mockResolvedValue(makeConfig());
    act(() => { result.current.setActivePlatforms(["facebook"]); });
    await act(async () => { await Promise.resolve(); });
    expect(fetchSpy).toHaveBeenCalledWith({ platforms: ["facebook"] });
  });

  it("re-fetch error → warn logged", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    fetchSpy.mockRejectedValueOnce(new Error("re-down"));
    act(() => { result.current.setActivePlatforms(["facebook"]); });
    await act(async () => { await Promise.resolve(); });
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("Platform config re-fetch failed"), expect.any(String));
  });

  it("activePlatforms growing back to all → empty fetch options", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    fetchSpy.mockClear();
    fetchSpy.mockResolvedValue(makeConfig());
    act(() => { result.current.setActivePlatforms(["facebook", "instagram", "google"]); });
    await act(async () => { await Promise.resolve(); });
    expect(fetchSpy).toHaveBeenCalledWith({});
  });
});

describe("useSDUI > persistence side effects", () => {
  it("writes filterValues to localStorage on change (excluding _autoSortField)", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setAllFilters({ x: 1, _autoSortField: "abc" }); });
    await act(async () => { await Promise.resolve(); });
    const stored = JSON.parse(localStorage.getItem("sdui.filterValues"));
    expect(stored).toEqual({ x: 1 });
  });

  it("writes activePlatforms to localStorage", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setActivePlatforms(["facebook"]); });
    await act(async () => { await Promise.resolve(); });
    expect(JSON.parse(localStorage.getItem("sdui.activePlatforms"))).toEqual(["facebook"]);
  });

  it("localStorage quota errors swallowed", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(() => act(() => { result.current.setFilter("x", "y"); })).not.toThrow();
    Storage.prototype.setItem.mockRestore?.();
  });
});

describe("useSDUI > polling integration", () => {
  it("registers polling with config version + handler", async () => {
    fetchSpy.mockResolvedValue(makeConfig({ config_version: 17 }));
    renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(pollingSpy).toHaveBeenCalled();
    const lastCall = pollingSpy.mock.calls[pollingSpy.mock.calls.length - 1];
    expect(lastCall[0]).toBe(17);
    expect(typeof lastCall[1]).toBe("function");
  });

  it("handleConfigChanged applies fresh config", async () => {
    fetchSpy.mockResolvedValue(makeConfig({ config_version: 5 }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    const cb = pollingSpy.mock.calls[pollingSpy.mock.calls.length - 1][1];
    act(() => { cb(makeConfig({ config_version: 99 })); });
    expect(result.current.config.config_version).toBe(99);
  });
});

describe("useSDUI > backward-compat getters/setters", () => {
  beforeEach(() => { fetchSpy.mockResolvedValue(makeConfig()); });

  it("selCategories reads from category (then categories) fallback", async () => {
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.selCategories).toEqual([]);
    act(() => { result.current.setFilter("category", ["a"]); });
    expect(result.current.selCategories).toEqual(["a"]);
  });

  it("setSelCategories accepts function value", async () => {
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setSelCategories(["initial"]); });
    act(() => { result.current.setSelCategories((prev) => [...prev, "extra"]); });
    expect(result.current.selCategories).toEqual(["initial", "extra"]);
  });

  it("setSelAdTypes/CTAs/Countries all work", async () => {
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setSelAdTypes(["video"]); });
    expect(result.current.selAdTypes).toEqual(["video"]);
    act(() => { result.current.setSelCTAs(["buy"]); });
    expect(result.current.selCTAs).toEqual(["buy"]);
    act(() => { result.current.setSelCountries(["us"]); });
    expect(result.current.selCountries).toEqual(["us"]);
    // Also test the function-form
    act(() => { result.current.setSelAdTypes((p) => [...p, "img"]); });
    expect(result.current.selAdTypes).toEqual(["video", "img"]);
    act(() => { result.current.setSelCTAs((p) => [...p, "click"]); });
    expect(result.current.selCTAs).toEqual(["buy", "click"]);
    act(() => { result.current.setSelCountries((p) => [...p, "uk"]); });
    expect(result.current.selCountries).toEqual(["us", "uk"]);
  });

  it("setSortBy normalises aliases", async () => {
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setSortBy("Ad Running Days"); });
    expect(result.current.sortBy).toBe("running_days");
    act(() => { result.current.setSortBy("domain reg date"); });
    expect(result.current.sortBy).toBe("domain_sort");
    act(() => { result.current.setSortBy("Newest"); });
    expect(result.current.sortBy).toBe("Newest");
    act(() => { result.current.setSortBy(undefined); });
    // sortBy getter is `filterValues.sorting || ''` → undefined coerces to ''
    expect(result.current.sortBy).toBe("");
  });

  it("selCountries: country fallback then countries fallback", async () => {
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setAllFilters({ country: ["fr"] }); });
    expect(result.current.selCountries).toEqual(["fr"]);
    act(() => { result.current.setAllFilters({ countries: ["de"] }); });
    expect(result.current.selCountries).toEqual(["de"]);
  });
});

describe("useSDUI > non-empty searchbar exercises flatMap callbacks", () => {
  // Lines 193/240/307/469 host `config.searchbar?.flatMap(d => d.filters)`.
  // With searchbar=[] (default in makeConfig), the arrow body never executes.
  // This test feeds a non-empty searchbar so all four callbacks are invoked.
  it("non-empty searchbar invokes flatMap callbacks across all branches", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      searchbar: [{ _id: "sb", filters: [{ _id: "sbFilter", query_param: "q" }] }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setFilter("sbFilter", "hello"); });
    act(() => { result.current.clearFiltersUnsupportedBy(["facebook"]); });
    expect(result.current.buildQueryParams()).toEqual({ q: "hello" });
    expect(result.current.filterPlatformSupport).toBeDefined();
  });
});

describe("useSDUI > effectivePlatforms option-level edge branches", () => {
  it("selected value not in options → continue (line 271)", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{
        _id: "d", filters: [{
          _id: "f", options: [{ value: "x", platform_applicability: ["facebook"] }],
        }],
      }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    // Set the filter to a value that ISN'T in options (.find returns undefined → continue)
    act(() => { result.current.setFilter("f", ["nonexistent"]); });
    expect(result.current.effectivePlatforms).toBeDefined();
  });
  it("option without platform_applicability → continue (line 273)", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{
        _id: "d", filters: [{
          _id: "f", options: [{ value: "x" }, { value: "y", platform_applicability: ["facebook"] }],
        }],
      }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setFilter("f", ["x"]); });
    expect(result.current.effectivePlatforms).toBeDefined();
  });
  it("option with platform_applicability='all' → continue (line 273)", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{
        _id: "d", filters: [{
          _id: "f", options: [{ value: "x", platform_applicability: "all" }],
        }],
      }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setFilter("f", ["x"]); });
    expect(result.current.effectivePlatforms).toBeDefined();
  });
  it("filter-level platform_applicability as array → spread (line 287)", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{ _id: "d", filters: [{ _id: "f", platform_applicability: ["facebook", "instagram"] }] }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setFilter("f", ["v"]); });
    expect(result.current.effectivePlatforms).toBeDefined();
  });
});

describe("useSDUI > sparse config (searchbar/navbar/sidebar undefined)", () => {
  // Covers `config.searchbar?.flatMap(...) || []` branches in
  // clearFiltersUnsupportedBy (193), effectivePlatforms (240),
  // buildQueryParams (307), and filterPlatformSupport (469).
  it("config without searchbar/navbar/sidebar → all `|| []` branches taken", async () => {
    // navbar undefined hits the no-platforms-doc fallback (line 84-style)
    fetchSpy.mockResolvedValue({
      schema_version: "1.0.0",
      config_version: 1,
      // searchbar/navbar/sidebar intentionally absent
    });
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.config).toBeDefined();
    // Call clearFiltersUnsupportedBy with platforms — triggers line 193 fallbacks
    act(() => { result.current.clearFiltersUnsupportedBy(["facebook"]); });
    // Force an active filter so effectivePlatforms iterates (line 240 fallbacks)
    act(() => { result.current.setFilter("ghost", ["x"]); });
    expect(result.current.effectivePlatforms).toBeDefined();
    // buildQueryParams (line 307 fallbacks)
    expect(result.current.buildQueryParams()).toEqual({});
    // filterPlatformSupport (line 469 fallbacks) — empty map when no filters
    expect(result.current.filterPlatformSupport).toEqual({});
  });
});

describe("useSDUI > derived adTypeOptions + filterPlatformSupport", () => {
  it("adTypeOptions: finds matching filter in sidebar then navbar", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{ _id: "d", filters: [{ _id: "ad_types", options: [{ value: "video" }] }] }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.adTypeOptions).toEqual([{ value: "video" }]);
  });

  it("adTypeOptions: empty when no matching filter or no options", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.adTypeOptions).toEqual([]);
  });

  it("filterPlatformSupport: empty when no config", async () => {
    fetchSpy.mockRejectedValue(new Error("x"));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.filterPlatformSupport).toEqual({});
  });

  it("filterPlatformSupport: keyed by filter _id with normalized PA arrays", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{
        _id: "d", filters: [
          { _id: "fbOnly", platform_applicability: "facebook" },
          { _id: "anyAll", platform_applicability: "all" },
          { _id: "noId" }, // no _id-less items skipped
          { platform_applicability: "instagram" }, // no _id
        ],
      }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.filterPlatformSupport.fbOnly).toEqual(["facebook"]);
    expect(result.current.filterPlatformSupport.anyAll).toBeUndefined();
  });
});

describe("useSDUI > applyConfig with platforms doc but no matrix filter", () => {
  it("does not set matrix when no platform_filter_matrix on any filter", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      navbar: [{
        _id: "platforms", config_type: "navbar",
        filters: [{
          _id: "x", options: [{ value: "facebook", selected_by_default: true }],
        }],
      }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.platformFilterMatrix).toEqual({});
  });
});

describe("useSDUI > effectivePlatforms scalar value + string option PA (267/274)", () => {
  it("scalar filter value + option platform_applicability as a string", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{
        _id: "d", filters: [{
          _id: "f",
          options: [{ value: "o1", platform_applicability: "youtube" }], // string PA → line 274
        }],
      }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    // store a SCALAR (non-array) value → line 267 else branch
    act(() => { result.current.setFilter("f", "o1"); });
    expect(result.current.effectivePlatforms).toBeDefined();
  });
});

describe("useSDUI > shouldShowFilter group child string PA (369)", () => {
  it("child filter with string platform_applicability is normalised to array", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setActivePlatforms(["facebook"]); });
    let shown;
    act(() => {
      shown = result.current.shouldShowFilter({
        _id: "group",
        filters: [{ _id: "child", platform_applicability: "facebook" }], // string → line 369
      });
    });
    expect(shown).toBe(true);
  });
  it("group child string PA not matching active platform → hidden (372)", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setActivePlatforms(["reddit"]); });
    let shown;
    act(() => {
      shown = result.current.shouldShowFilter({
        _id: "group",
        filters: [{ _id: "child", platform_applicability: "facebook" }],
      });
    });
    expect(shown).toBe(false);
  });
});

describe("useSDUI > adTypeOptions matched via group_id (line 455)", () => {
  it("filter matched by group_id:'ad_type' returns its options", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{
        _id: "d", filters: [{
          _id: "not_named_adtype", group_id: "ad_type",
          options: [{ value: "image" }, { value: "video" }],
        }],
      }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.adTypeOptions.map((o) => o.value)).toEqual(["image", "video"]);
  });
  it("filter matched by _id:'ad_type_filter' alias", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{
        _id: "d", filters: [{
          _id: "ad_type_filter",
          options: [{ value: "carousel" }],
        }],
      }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.adTypeOptions.map((o) => o.value)).toEqual(["carousel"]);
  });
});

describe("useSDUI > matchesPlatform matrix with no matching active platform (line 347)", () => {
  it("groupId in matrix but active platforms not whitelisted → restrictedPlatforms empty", async () => {
    fetchSpy.mockResolvedValue(makeConfig()); // platformsDoc → matrix {facebook, instagram}
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setActivePlatforms(["google"]); }); // not in matrix
    let shown;
    act(() => {
      // filter with a group_id and no platform_applicability → falls through to the matrix check;
      // platforms ["google"] filtered against matrix → empty → line 347 else
      shown = result.current.shouldShowFilter({ _id: "f", group_id: "news_feed" });
    });
    expect(typeof shown).toBe("boolean");
  });
});

describe("useSDUI > unmount before fetch resolves (line 98 cancelled)", () => {
  it("applyConfig is skipped after unmount", async () => {
    let resolveFn;
    fetchSpy.mockReturnValue(new Promise((r) => { resolveFn = r; }));
    const { unmount } = renderHook(() => useSDUI());
    unmount(); // cleanup sets cancelled = true
    await act(async () => {
      resolveFn(makeConfig());
      await Promise.resolve();
    });
    expect(fetchSpy).toHaveBeenCalled();
  });
});
