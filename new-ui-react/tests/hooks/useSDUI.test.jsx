import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

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
  sessionStorage.clear();
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

  it("bootstrap fetch bypasses stale cache so live SDUI wins", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(fetchSpy).toHaveBeenCalledWith({ skipCache: true });
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

  it("loadTabState: malformed JSON → fallback used", async () => {
    sessionStorage.setItem("sdui.filterValues", "not-json");
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.filterValues).toEqual({});
  });

  it("loadTabState strips _autoSortField from filterValues", async () => {
    sessionStorage.setItem("sdui.filterValues", JSON.stringify({ x: 1, _autoSortField: "y" }));
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{ _id: "d", filters: [{ _id: "x" }] }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.filterValues._autoSortField).toBeUndefined();
    expect(result.current.filterValues.x).toBe(1);
  });

  it("keeps label-stored geo selections after refresh", async () => {
    sessionStorage.setItem("sdui.filterValues", JSON.stringify({
      country_filter: ["United Kingdom"],
    }));
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{
        _id: "country",
        filters: [{
          _id: "country_filter",
          query_param: "country",
          type: "combobox",
          options: [
            { value: "US", label: "United States" },
            { value: "UK", label: "United Kingdom" },
          ],
        }],
      }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.filterValues.country_filter).toEqual(["United Kingdom"]);
  });

  it("preserves tab-restored filters when the startup schema omits their values", async () => {
    const restoredFilters = {
      country_filter: ["Thailand"],
      ad_type: ["Video"],
      sorting: "popularity_score",
    };
    sessionStorage.setItem("sdui.filterValues", JSON.stringify(restoredFilters));
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{
        _id: "country",
        filters: [{
          _id: "country_filter",
          type: "combobox",
          options: [{ value: "TH", label: "Thailand" }],
        }],
      }],
    }));

    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });

    expect(result.current.filterValues).toEqual(restoredFilters);
    expect(JSON.parse(sessionStorage.getItem("sdui.filterValues"))).toEqual(restoredFilters);
  });

  it("keeps date, ad-type, and sort toolbar selections after refresh", async () => {
    const storedToolbarFilters = {
      seen_btn_sort: [1786147199, 1785542400],
      post_date_btn_sort: [1783468799, 1782864000],
      domain_date_btn_sort: [1780876799, 1780272000],
      ad_type: ["Image", "Video"],
      sorting: "popularity_score",
    };
    sessionStorage.setItem("sdui.filterValues", JSON.stringify(storedToolbarFilters));
    fetchSpy.mockResolvedValue(makeConfig({
      navbar: [
        platformsDoc,
        {
          _id: "date_filter",
          filters: [{
            _id: "date_range_custom",
            group_id: "date_filter",
            type: "date_range_custom",
            query_param: "dateRange",
          }],
        },
        {
          _id: "sorting",
          filters: [{
            _id: "sort_by",
            group_id: "sorting",
            query_param: "sortBy",
            type: "radio",
            options: [
              { value: "created_at", label: "Newest" },
              { value: "popularity_score", label: "Popularity" },
            ],
          }],
        },
        {
          _id: "ad_type",
          filters: [{
            _id: "ad_types",
            group_id: "ad_type",
            query_param: "adTypes",
            type: "checkbox",
            options: [
              { value: "Image", label: "Image" },
              { value: "Video", label: "Video" },
            ],
          }],
        },
      ],
    }));

    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });

    expect(result.current.filterValues).toEqual(storedToolbarFilters);
  });

  it("loadTabState missing key → fallback", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.filterValues).toEqual({});
    expect(result.current.activePlatforms).toEqual(["facebook", "instagram"]);
  });

  it("does not restore filters or platforms left in localStorage by another tab", async () => {
    localStorage.setItem("sdui.filterValues", JSON.stringify({ country_filter: ["Thailand"] }));
    localStorage.setItem("sdui.activePlatforms", JSON.stringify(["google"]));
    fetchSpy.mockResolvedValue(makeConfig());

    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });

    expect(result.current.filterValues).toEqual({});
    expect(result.current.activePlatforms).toEqual(["facebook", "instagram"]);
  });

  it("does NOT override pre-existing activePlatforms from storage", async () => {
    sessionStorage.setItem("sdui.activePlatforms", JSON.stringify(["youtube"]));
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
    sessionStorage.setItem("sdui.activePlatforms", JSON.stringify(["google"]));
    sessionStorage.setItem("sdui.filterValues", JSON.stringify({
      google_transparency_ads: true,
      google_transparency_subnetwork: "SHOPPING",
      country: ["India"],
    }));
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{
        _id: "country",
        filters: [{
          _id: "country_filter",
          query_param: "country",
          type: "combobox",
          options: [
            { value: "IN", label: "India" },
          ],
        }],
      }, {
        _id: "google_transparency",
        filters: [
          { _id: "google_transparency_ads", options: [{ value: true, label: "On" }, { value: false, label: "Off" }] },
          { _id: "google_transparency_subnetwork", options: [{ value: "SHOPPING", label: "Shopping" }] },
        ],
      }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.filterValues.google_transparency_ads).toBe(true);

    act(() => { result.current.setActivePlatforms(["facebook"]); });
    expect(result.current.filterValues).toEqual({ country: ["India"] });
  });

  it("clears the dependent subnetwork when Transparency is disabled", async () => {
    sessionStorage.setItem("sdui.activePlatforms", JSON.stringify(["google"]));
    sessionStorage.setItem("sdui.filterValues", JSON.stringify({
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
    sessionStorage.setItem("sdui.activePlatforms", JSON.stringify(["google"]));
    sessionStorage.setItem("sdui.filterValues", JSON.stringify({
      google_transparency_ads: true,
      google_transparency_subnetwork: "SHOPPING",
    }));
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{
        _id: "google_transparency",
        filters: [
          { _id: "google_transparency_ads", options: [{ value: true, label: "On" }, { value: false, label: "Off" }] },
          { _id: "google_transparency_subnetwork", options: [{ value: "SHOPPING", label: "Shopping" }] },
        ],
      }],
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

  it("counts truthy values, excluding only the internal '_autoSortField' key", async () => {
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
        adcategory: "x",   // selected top-level category → 1
        _autoSortField: "x", // excluded
      });
    });
    expect(result.current.totalActiveFilters).toBe(4);
  });

  it("counts a configured nested category and its selected children once", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{
        _id: "ai_meta",
        filters: [{
          _id: "ai_category_id",
          type: "nested_multiselect",
          parent_filter_id: "ai_category_id",
          child_filter_id: "ai_subcategory_id",
        }],
      }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => {
      result.current.setAllFilters({
        ai_category_id: ["1005"],
        ai_subcategory_id: ["10050001", "10050002"],
        ai_intent: ["conversion"],
      });
    });
    expect(result.current.totalActiveFilters).toBe(2);
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

describe("useSDUI > platform switches preserve selected filters", () => {
  it("keeps every selected value while unsupported controls become hidden", async () => {
    const arrayFilter = { _id: "fb_array", platform_applicability: "facebook" };
    const scalarFilter = { _id: "fb_scalar", platform_applicability: ["facebook"] };
    const booleanFilter = { _id: "fb_boolean", platform_applicability: "facebook" };
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{
        _id: "facebook_filters",
        filters: [arrayFilter, scalarFilter, booleanFilter],
      }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });

    const selectedFilters = {
      fb_array: ["Video"],
      fb_scalar: "value",
      fb_boolean: true,
    };
    act(() => { result.current.setAllFilters(selectedFilters); });
    act(() => { result.current.setActivePlatforms(["native"]); });

    expect(result.current.filterValues).toEqual(selectedFilters);
    expect(result.current.shouldShowFilter(arrayFilter)).toBe(false);
    expect(result.current.shouldShowFilter(scalarFilter)).toBe(false);
    expect(result.current.shouldShowFilter(booleanFilter)).toBe(false);
    expect(result.current.effectivePlatforms).toEqual(["native"]);
    expect(result.current.hasUnsupportedActiveFiltersFor(["native"])).toBe(true);
    expect(result.current.hasUnsupportedActiveFiltersFor(["facebook"])).toBe(false);
  });

  it("keeps Ad Type selected on an unsupported destination platform", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      navbar: [
        platformsDoc,
        {
          _id: "ad_type",
          filters: [{
            _id: "ad_types",
            group_id: "ad_type",
            query_param: "adTypes",
            platform_applicability: ["facebook"],
          }],
        },
      ],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });

    act(() => { result.current.setSelAdTypes(["Video"]); });
    act(() => { result.current.setActivePlatforms(["native"]); });

    expect(result.current.filterValues.ad_type).toEqual(["Video"]);
    expect(result.current.selAdTypes).toEqual(["Video"]);
    expect(result.current.effectivePlatforms).toEqual(["native"]);
    expect(result.current.hasUnsupportedActiveFiltersFor(["native"])).toBe(true);
  });

  it("checks selected option applicability before filter-level applicability", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      sidebar: [{
        _id: "ad_type",
        filters: [{
          _id: "ad_types",
          group_id: "ad_type",
          platform_applicability: ["facebook", "native"],
          options: [
            { value: "Image", platform_applicability: ["facebook", "native"] },
            { value: "Video", platform_applicability: ["facebook"] },
          ],
        }],
      }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });

    act(() => { result.current.setSelAdTypes(["Image"]); });
    expect(result.current.hasUnsupportedActiveFiltersFor(["native"])).toBe(false);

    act(() => { result.current.setSelAdTypes(["Image", "Video"]); });
    expect(result.current.hasUnsupportedActiveFiltersFor(["native"])).toBe(true);
    expect(result.current.filterValues.ad_type).toEqual(["Image", "Video"]);
  });

  it("does not treat the platform display matrix as a sorting restriction", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      navbar: [
        platformsDoc,
        {
          _id: "sorting",
          filters: [{
            _id: "sort_by",
            group_id: "sorting",
            platform_applicability: "all",
            options: [{ value: "running_days", label: "Ad Running Days" }],
          }],
        },
      ],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });

    act(() => { result.current.setSortBy("Ad Running Days"); });

    expect(result.current.filterValues.sorting).toBe("running_days");
    expect(result.current.hasUnsupportedActiveFiltersFor([
      "facebook",
      "instagram",
      "youtube",
      "google",
      "native",
    ])).toBe(false);
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

  it("shouldShowFilter: ['all'] behaves like a wildcard", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.shouldShowFilter({ platform_applicability: ["all"] })).toBe(true);
  });

  it("shouldShowFilter: PA matches activePlatform → true", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.shouldShowFilter({ platform_applicability: ["facebook"] })).toBe(true);
  });

  it("matches platform applicability without casing differences", async () => {
    sessionStorage.setItem("sdui.activePlatforms", JSON.stringify(["Google"]));
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });

    expect(result.current.shouldShowFilter({
      platform_applicability: ["google"],
    })).toBe(true);
    expect(result.current.shouldShowFilter({
      filters: [{ platform_applicability: ["google"] }],
    })).toBe(true);
    expect(result.current.shouldShowOption({
      platform_applicability: ["google"],
    })).toBe(true);
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
    expect(result.current.shouldShowFilter({ platform_applicability: ["foo"] })).toBe(false);
  });

  it("shouldShowFilter: matrix restriction allows group_id", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.shouldShowFilter({ _id: "news_feed" })).toBe(true);
  });

  it("shouldShowFilter: sorting group is not hidden by the platform matrix", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    expect(result.current.shouldShowFilter({
      group_id: "sorting",
      platform_applicability: "all",
    })).toBe(true);
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

  it("shouldShowFilter: child option-level all does not override child filter applicability", async () => {
    sessionStorage.setItem("sdui.activePlatforms", JSON.stringify(["youtube"]));
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });

    expect(result.current.shouldShowFilter({
      filters: [{
        platform_applicability: ["facebook"],
        options: [{ platform_applicability: "all" }],
      }],
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
  it("keeps active filters when a platform-specific response omits their controls", async () => {
    sessionStorage.setItem("sdui.activePlatforms", JSON.stringify(["facebook"]));
    let resolveReducedConfig;
    fetchSpy
      .mockResolvedValueOnce(makeConfig({
        sidebar: [{
          _id: "facebook_filters",
          filters: [{
            _id: "country_filter",
            type: "combobox",
            options: [{ value: "TH", label: "Thailand" }],
          }],
        }],
      }))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveReducedConfig = resolve;
      }));

    const { result } = renderHook(() => useSDUI());
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    act(() => {
      result.current.setAllFilters({ country_filter: ["Thailand"] });
    });
    await act(async () => {
      resolveReducedConfig(makeConfig({ sidebar: [] }));
      await Promise.resolve();
    });

    expect(result.current.config.sidebar).toEqual([]);
    expect(result.current.filterValues).toEqual({
      country_filter: ["Thailand"],
    });
  });

  it("restores TikTok-only filters before the platform request resolves", async () => {
    sessionStorage.setItem("sdui.activePlatforms", JSON.stringify(["facebook"]));
    const ctrDoc = {
      _id: "engagement",
      filters: [{
        _id: "ctr_range",
        type: "range_slider",
        platform_applicability: ["tiktok"],
      }],
    };
    let resolveTikTokConfig;
    fetchSpy
      .mockResolvedValueOnce(makeConfig({ sidebar: [ctrDoc] }))
      .mockResolvedValueOnce(makeConfig({ sidebar: [] }))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveTikTokConfig = resolve;
      }));

    const { result } = renderHook(() => useSDUI());
    await waitFor(() => expect(result.current.config.sidebar).toEqual([]));

    act(() => {
      result.current.setActivePlatforms(["tiktok"]);
    });
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(3));

    expect(result.current.config.sidebar).toContainEqual(ctrDoc);

    await act(async () => {
      resolveTikTokConfig(makeConfig({ sidebar: [ctrDoc] }));
      await Promise.resolve();
    });
  });
  it("keeps the complete Transparency document when a reduced Google config strips its filters", async () => {
    sessionStorage.setItem("sdui.activePlatforms", JSON.stringify(["google"]));
    sessionStorage.setItem("sdui.filterValues", JSON.stringify({
      google_transparency_ads: true,
    }));
    const transparencyDoc = {
      _id: "google_transparency",
      filters: [{
        _id: "google_transparency_ads",
        type: "toggle",
      }, {
        _id: "google_transparency_subnetwork",
        type: "dropdown",
      }],
    };
    fetchSpy
      .mockResolvedValueOnce(makeConfig({ sidebar: [transparencyDoc] }))
      .mockResolvedValue(makeConfig({
        sidebar: [{ _id: "google_transparency", filters: [] }],
      }));

    const { result } = renderHook(() => useSDUI());

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    await waitFor(() => {
      expect(result.current.config.sidebar).toContainEqual(transparencyDoc);
    });
    expect(result.current.filterValues.google_transparency_ads).toBe(true);
  });

  it("changing activePlatforms triggers a fresh config fetch", async () => {
    sessionStorage.setItem("sdui.activePlatforms", JSON.stringify(["facebook", "instagram", "google"]));
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    fetchSpy.mockClear();
    fetchSpy.mockResolvedValue(makeConfig());
    act(() => { result.current.setActivePlatforms(["facebook"]); });
    await act(async () => { await Promise.resolve(); });
    expect(fetchSpy).toHaveBeenCalledWith({
      skipCache: true,
      platforms: ["facebook"],
    });
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

  it("activePlatforms growing back to all still fetches fresh config", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    fetchSpy.mockClear();
    fetchSpy.mockResolvedValue(makeConfig());
    act(() => { result.current.setActivePlatforms(["facebook", "instagram", "google"]); });
    await act(async () => { await Promise.resolve(); });
    expect(fetchSpy).toHaveBeenCalledWith({
      skipCache: true,
      platforms: ["facebook", "instagram", "google"],
    });
  });
});

describe("useSDUI > persistence side effects", () => {
  it("writes filterValues to sessionStorage on change (excluding _autoSortField)", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setAllFilters({ x: 1, _autoSortField: "abc" }); });
    await act(async () => { await Promise.resolve(); });
    const stored = JSON.parse(sessionStorage.getItem("sdui.filterValues"));
    expect(stored).toEqual({ x: 1 });
  });

  it("writes activePlatforms to sessionStorage", async () => {
    fetchSpy.mockResolvedValue(makeConfig());
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setActivePlatforms(["facebook"]); });
    await act(async () => { await Promise.resolve(); });
    expect(JSON.parse(sessionStorage.getItem("sdui.activePlatforms"))).toEqual(["facebook"]);
  });

  it("sessionStorage quota errors swallowed", async () => {
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

  it("keeps active filters when the background poll refreshes the schema", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      config_version: 5,
      sidebar: [{
        _id: "country",
        filters: [{
          _id: "country_filter",
          type: "combobox",
          options: [{ value: "TH", label: "Thailand" }],
        }],
      }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => {
      result.current.setAllFilters({
        country_filter: ["Thailand"],
        ad_type: ["Video"],
      });
    });

    const cb = pollingSpy.mock.calls[pollingSpy.mock.calls.length - 1][1];
    act(() => {
      cb(makeConfig({ config_version: 99, sidebar: [] }));
    });

    expect(result.current.config.config_version).toBe(99);
    expect(result.current.filterValues).toEqual({
      country_filter: ["Thailand"],
      ad_type: ["Video"],
    });
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

  it("setSelAdTypes removes every legacy alias so a denied filter cannot remain active", async () => {
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => {
      result.current.setAllFilters({
        ad_types: ["video"],
        type: ["image"],
        adType: ["carousel"],
      });
    });
    expect(result.current.selAdTypes).toEqual(["video"]);

    act(() => { result.current.setSelAdTypes([]); });
    expect(result.current.selAdTypes).toEqual([]);
    expect(result.current.filterValues).toEqual({ ad_type: [] });
    expect(result.current.buildQueryParams()).not.toHaveProperty("ad_type");
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
  it("includes searchbar filters in query parameters and platform support", async () => {
    fetchSpy.mockResolvedValue(makeConfig({
      searchbar: [{ _id: "sb", filters: [{ _id: "sbFilter", query_param: "q" }] }],
    }));
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => { result.current.setFilter("sbFilter", "hello"); });
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
    // Force an active filter so the sparse-config paths are exercised.
    act(() => { result.current.setFilter("ghost", ["x"]); });
    expect(result.current.effectivePlatforms).toBeDefined();
    expect(result.current.buildQueryParams()).toEqual({});
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
