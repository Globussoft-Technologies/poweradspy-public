import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchConfig, trackProductEvent } = vi.hoisted(() => ({
  fetchConfig: vi.fn(),
  trackProductEvent: vi.fn(),
}));

vi.mock("../../src/services/sduiService", () => ({
  fetchSDUIConfig: fetchConfig,
}));

vi.mock("../../src/hooks/useSDUIPolling", () => ({
  useSDUIPolling: vi.fn(),
}));

vi.mock("../../src/utils/googleAnalytics", async (importOriginal) => ({
  ...(await importOriginal()),
  trackProductEvent,
}));

import { useSDUI } from "../../src/hooks/useSDUI";

const config = {
  config_version: 1,
  searchbar: [],
  navbar: [{
    _id: "platforms",
    filters: [{
      _id: "platforms_main",
      options: [{ value: "facebook" }, { value: "instagram" }],
    }],
  }],
  sidebar: [{
    _id: "ai_meta",
    filters: [
      { _id: "ai_ad_type", label: "Ad Type" },
      { _id: "ai_intent", label: "Intent" },
      {
        _id: "ai_category_id",
        label: "Category",
        parent_filter_id: "ai_category_id",
        child_filter_id: "ai_subcategory_id",
        options: [{
          value: "1003",
          label: "Cannabis",
          children: [{ value: "10030005", label: "Cannabis Stocks" }],
        }],
      },
    ],
  }],
};

describe("useSDUI GA filter batching", () => {
  beforeEach(() => {
    sessionStorage.clear();
    fetchConfig.mockReset().mockResolvedValue(config);
    trackProductEvent.mockReset();
  });

  it("sends a Quick Filter event while All is selected", async () => {
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => result.current.setAnalyticsAllPlatformsSelected(true));

    act(() => result.current.setAllFilters(
      { ai_ad_type: ["ugc"] },
      { filterName: "quick_filter_tiktok_ugc", entryPoint: "quick_filters" },
    ));

    expect(trackProductEvent).toHaveBeenCalledWith("filter_applied", expect.objectContaining({
      filter_name: "all_quick_filter_tiktok_ugc",
      network: "all",
      network_scope: "all",
      entry_point: "quick_filters",
    }));
  });

  it("sends each newly applied AI Filter value", async () => {
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => result.current.setAnalyticsAllPlatformsSelected(true));

    act(() => result.current.setAllFilters(
      { ai_ad_type: ["testimonial", "ugc"], ai_intent: ["purchase"] },
      {
        changedFilterIds: ["ai_ad_type", "ai_intent"],
        entryPoint: "ai_filter_modal",
      },
    ));

    expect(trackProductEvent).toHaveBeenCalledTimes(3);
    expect(trackProductEvent).toHaveBeenCalledWith("filter_applied", expect.objectContaining({
      filter_name: "all_ai_ad_type_testimonial",
      filter_values: "testimonial",
      network: "all",
    }));
    expect(trackProductEvent).toHaveBeenCalledWith("filter_applied", expect.objectContaining({
      filter_name: "all_ai_intent_purchase",
      filter_values: "purchase",
      network: "all",
    }));
  });

  it("sends AI category and subcategory names instead of IDs", async () => {
    const { result } = renderHook(() => useSDUI());
    await act(async () => { await Promise.resolve(); });
    act(() => result.current.setAnalyticsAllPlatformsSelected(true));

    act(() => result.current.setAllFilters(
      { ai_category_id: ["1003"], ai_subcategory_id: ["10030005"] },
      {
        changedFilterIds: ["ai_category_id", "ai_subcategory_id"],
        entryPoint: "ai_filter_modal",
      },
    ));

    expect(trackProductEvent).toHaveBeenCalledWith("filter_applied", expect.objectContaining({
      filter_name: "all_category_cannabis",
      filter_values: "cannabis",
    }));
    expect(trackProductEvent).toHaveBeenCalledWith("filter_applied", expect.objectContaining({
      filter_name: "all_ai_subcategory_id_cannabis_stocks",
      filter_values: "cannabis_stocks",
    }));
  });
});
