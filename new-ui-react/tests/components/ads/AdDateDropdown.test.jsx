import { describe, expect, it } from "vitest";
import {
  QUICK_FILTERS,
  getQuickFilterForPreset,
  getQuickFilterForRange,
  getQuickFilterRange,
} from "../../../src/components/ads/AdDateDropdown";

const NOW = new Date(2026, 8, 24, 12, 0, 0);

describe("AdDateDropdown date presets", () => {
  it("exposes every Common Ads Search preset in the picker", () => {
    expect(QUICK_FILTERS.map(({ id }) => id)).toEqual([
      "all",
      "today",
      "yesterday",
      "last_7",
      "last_14",
      "last_30",
      "last_90",
      "this_month",
      "last_month",
      "this_year",
      "custom",
    ]);
  });

  it("maps canonical AI date presets back to picker options", () => {
    expect(getQuickFilterForPreset("last_14_days")).toBe("last_14");
    expect(getQuickFilterForPreset("last_90_days")).toBe("last_90");
    expect(getQuickFilterForPreset("this_month")).toBe("this_month");
    expect(getQuickFilterForPreset("last_month")).toBe("last_month");
    expect(getQuickFilterForPreset("this_year")).toBe("this_year");
  });

  it("builds and recognizes the previously missing ranges", () => {
    const expectedRanges = {
      last_14: [2026, 8, 11, 2026, 8, 24],
      last_90: [2026, 5, 27, 2026, 8, 24],
      this_month: [2026, 8, 1, 2026, 8, 24],
      last_month: [2026, 7, 1, 2026, 7, 31],
      this_year: [2026, 0, 1, 2026, 8, 24],
    };

    for (const [filterId, expected] of Object.entries(expectedRanges)) {
      const range = getQuickFilterRange(filterId, NOW);
      expect([
        range.from.getFullYear(),
        range.from.getMonth(),
        range.from.getDate(),
        range.to.getFullYear(),
        range.to.getMonth(),
        range.to.getDate(),
      ]).toEqual(expected);
      expect(getQuickFilterForRange(range, NOW)).toBe(filterId);
    }
  });
});
