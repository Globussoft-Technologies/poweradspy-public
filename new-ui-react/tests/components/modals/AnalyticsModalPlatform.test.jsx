import { describe, expect, it } from "vitest";
import {
  buildAiMetaScorecard,
  formatDomainValue,
  formatTransparencyCalendarDate,
  getAspectStyle,
  hasTransparencyDetailValue,
  mergeTransparencyDateContract,
  normalizePlatformSlug,
  resolveTransparencyContractValue,
} from "../../../src/components/modals/AnalyticsModal.jsx";

describe("AnalyticsModal platform normalization", () => {
  it("groups AI attributes and ROA explanations into the 1e scorecard", () => {
    const scorecard = buildAiMetaScorecard({
      offering: "luxury leather bags",
      ad_type: "promotional",
      offering_type: "both",
      offers: [{ type: "percentage_discount" }],
      intent: ["conversion", "awareness"],
      hook: "discount, urgency",
      colors: ["9aa0ae", "#FFFFFF", "invalid"],
      caption: "Purple bags on a tropical background.",
      roa: {
        intent: "The call to action indicates conversion intent.",
        hook: "The discount creates urgency.",
        offering_type: "The creative shows a physical product.",
        offering: "The copy names luxury bags.",
      },
    });

    expect(scorecard.attributes.map(({ label }) => label)).toEqual([
      "Offering",
      "Ad type",
      "Offering type",
      "Offer type",
      "Intent",
      "Hook",
      "Colors",
    ]);
    expect(scorecard.attributes.find(({ label }) => label === "Offering type")?.value)
      .toBe("Product & Service");
    expect(scorecard.attributes.find(({ label }) => label === "Colors")?.colors)
      .toEqual(["#9AA0AE", "#FFFFFF"]);
    expect(scorecard.caption).toBe("Purple bags on a tropical background.");
    expect(scorecard.evidence.map(({ label }) => label)).toEqual([
      "Intent reasoning",
      "Hook reasoning",
      "Offering type reasoning",
      "Offering reasoning",
    ]);
  });

  it("shows a dash instead of the domain sentinel value", () => {
    expect(formatDomainValue("(none)")).toBe("\u2014");
    expect(formatDomainValue(" (NONE) ")).toBe("\u2014");
    expect(formatDomainValue("(none)", "poweradspy.com")).toBe("poweradspy.com");
  });

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
      lastShownRaw: "2026-07-28",
      postDateRaw: null,
    };

    expect(mergeTransparencyDateContract(
      hydrated,
      { id: "179596", network: "google", _fromUrl: true },
    )).toEqual(hydrated);
  });

  it("keeps explicit search-card nulls authoritative", () => {
    expect(mergeTransparencyDateContract(
      {
        firstSeenRaw: "2026-07-26",
        lastSeenRaw: "2026-07-27",
        lastShownRaw: "2026-07-28",
      },
      { firstSeenRaw: null, lastSeenRaw: "2026-07-27", lastShownRaw: null },
    )).toMatchObject({
      firstSeenRaw: null,
      lastSeenRaw: "2026-07-27",
      lastShownRaw: null,
    });
  });

  it("keeps the reported Transparency calendar day across time zones", () => {
    expect(formatTransparencyCalendarDate("2026-07-27 00:00:00"))
      .toBe("27 Jul 2026");
    expect(formatTransparencyCalendarDate("2026-07-27T00:00:00Z"))
      .toBe("27 Jul 2026");
    expect(formatTransparencyCalendarDate(null)).toBe("--");
  });

  it("keeps an explicit null contract date instead of using a generated fallback", () => {
    expect(resolveTransparencyContractValue(
      { last_seen: "2026-07-27", last_shown: null },
      "last_shown",
      "2026-07-27",
    )).toBeNull();
    expect(resolveTransparencyContractValue(
      { last_seen: "2026-07-27" },
      "last_shown",
      "2026-07-28",
    )).toBe("2026-07-28");
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
