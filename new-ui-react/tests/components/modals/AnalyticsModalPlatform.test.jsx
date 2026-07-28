import { describe, expect, it } from "vitest";
import {
  formatTransparencyCalendarDate,
  getAspectStyle,
  hasTransparencyDetailValue,
  mergeTransparencyDateContract,
  normalizePlatformSlug,
} from "../../../src/components/modals/AnalyticsModal.jsx";

describe("AnalyticsModal platform normalization", () => {
  it("accepts numeric platform 18 without calling string methods on it", () => {
    expect(normalizePlatformSlug(18)).toBe("google");
    expect(() => getAspectStyle(18, "FEED")).not.toThrow();
    expect(getAspectStyle(18, "FEED")).toEqual({});
  });

  it("preserves legacy string platforms", () => {
    expect(normalizePlatformSlug("Instagram")).toBe("instagram");
    expect(getAspectStyle("youtube", "feed")).toEqual({ aspectRatio: "16/9" });
  });

  it("keeps hydrated dates for a direct URL placeholder", () => {
    const hydrated = {
      firstSeenRaw: null,
      lastSeenRaw: "2026-07-27",
      postDateRaw: null,
    };

    expect(mergeTransparencyDateContract(
      hydrated,
      { id: "179596", network: "google", _fromUrl: true },
    )).toEqual(hydrated);
  });

  it("keeps explicit search-card nulls authoritative", () => {
    expect(mergeTransparencyDateContract(
      { firstSeenRaw: "2026-07-26", lastSeenRaw: "2026-07-27" },
      { firstSeenRaw: null, lastSeenRaw: "2026-07-27" },
    )).toMatchObject({
      firstSeenRaw: null,
      lastSeenRaw: "2026-07-27",
    });
  });

  it("keeps the reported Transparency calendar day across time zones", () => {
    expect(formatTransparencyCalendarDate("2026-07-27 00:00:00"))
      .toBe("27 Jul 2026");
    expect(formatTransparencyCalendarDate("2026-07-27T00:00:00Z"))
      .toBe("27 Jul 2026");
    expect(formatTransparencyCalendarDate(null)).toBe("--");
  });

  it("omits missing Transparency detail rows while preserving real values", () => {
    expect(hasTransparencyDetailValue(null)).toBe(false);
    expect(hasTransparencyDetailValue("--")).toBe(false);
    expect(hasTransparencyDetailValue("—")).toBe(false);
    expect(hasTransparencyDetailValue("N/A")).toBe(false);
    expect(hasTransparencyDetailValue("YOUTUBE")).toBe(true);
    expect(hasTransparencyDetailValue(0)).toBe(true);
  });
});
