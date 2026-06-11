import { describe, it, expect } from "vitest";

// Mock lucide-react so this doesn't need react renderer for icon refs
vi.mock("lucide-react", () => ({
  Facebook: () => null, Instagram: () => null, Youtube: () => null, Linkedin: () => null,
  Search: () => null, Globe: () => null, MessageSquare: () => null, Heart: () => null, Play: () => null,
}));

const {
  PLATFORMS, AD_CATEGORIES, SORT_TABS, FILTER_OPTIONS, SEARCH_IN_OPTIONS,
  ENGAGEMENT_RULES, getVisibleMetrics, AD_TYPE_BADGES, PLATFORM_ACCENT, getStarRating,
} = await import("../../src/constants/index.js");

describe("constants/index > static export shapes", () => {
  it("PLATFORMS has the 9 expected ids", () => {
    expect(PLATFORMS.map(p => p.id)).toEqual([
      "Facebook", "Instagram", "YouTube", "LinkedIn",
      "Google", "Native", "Reddit", "Pinterest", "TikTok",
    ]);
  });
  it("AD_CATEGORIES includes 'all'", () => {
    expect(AD_CATEGORIES.some(c => c.id === "all")).toBe(true);
  });
  it("SORT_TABS is the expected 4-tab list", () => {
    expect(SORT_TABS).toEqual(["Newest", "Popular", "Running Longest", "Oldest"]);
  });
  it("FILTER_OPTIONS has all keys", () => {
    const expectedKeys = [
      "categories", "adTypes", "ctas", "countries", "ecommerce",
      "funnels", "affiliates", "adSeen", "postDate", "domainAge",
    ];
    for (const k of expectedKeys) expect(FILTER_OPTIONS[k]).toBeDefined();
  });
  it("SEARCH_IN_OPTIONS = 4 entries", () => {
    expect(SEARCH_IN_OPTIONS.length).toBe(4);
  });
  it("AD_TYPE_BADGES has expected badge keys", () => {
    expect(AD_TYPE_BADGES.video.label).toBe("Video");
    expect(AD_TYPE_BADGES.carousel.label).toBe("Carousel");
  });
  it("PLATFORM_ACCENT lists nine platforms", () => {
    expect(Object.keys(PLATFORM_ACCENT).length).toBe(9);
  });
  it("ENGAGEMENT_RULES has facebook/instagram/youtube/google/gdn", () => {
    expect(ENGAGEMENT_RULES.facebook).toBeDefined();
    expect(ENGAGEMENT_RULES.instagram).toBeDefined();
    expect(ENGAGEMENT_RULES.youtube).toBeDefined();
    expect(ENGAGEMENT_RULES.google).toBeDefined();
    expect(ENGAGEMENT_RULES.gdn).toBeDefined();
  });
});

describe("constants/index > getVisibleMetrics", () => {
  it("unknown platform → fallback {like,share,comment,view}", () => {
    expect(getVisibleMetrics("twitter", "feed")).toEqual({
      like: true, share: true, comment: true, view: true,
    });
  });
  it("null platform → fallback", () => {
    expect(getVisibleMetrics(null, "feed").like).toBe(true);
  });
  it("exact position match on facebook 'news feed'", () => {
    const m = getVisibleMetrics("facebook", "news feed");
    expect(m.like).toBe(true);
    expect(m.ad_budget).toBe(true);
  });
  it("partial position match: 'instagram main feed' matches 'feed'? no — instagram has no 'feed' key", () => {
    // instagram only has 'image' / 'stories' / '_default'. 'feed' doesn't match,
    // so partial loop scans 'image' and 'stories' — none match, falls to _default
    const m = getVisibleMetrics("instagram", "feed");
    expect(m).toEqual(ENGAGEMENT_RULES.instagram._default);
  });
  it("partial position match: 'video' inside 'main video' for youtube", () => {
    const m = getVisibleMetrics("youtube", "main video");
    expect(m.like).toBe(true);
    expect(m.view).toBe(true);
  });
  it("google has no rules → falls back to _default || {} → {}", () => {
    expect(getVisibleMetrics("google", "anything")).toEqual({});
  });
  it("null position → empty match; _default returned if exists, else {}", () => {
    expect(getVisibleMetrics("facebook", null).like).toBe(true);
  });
  it("null adType (3rd arg) — still works", () => {
    expect(getVisibleMetrics("facebook", "news feed", null).like).toBe(true);
  });
  it("uppercase platform/position is lowercased", () => {
    const m = getVisibleMetrics("FACEBOOK", "NEWS FEED");
    expect(m.like).toBe(true);
  });
});

describe("constants/index > getStarRating", () => {
  it("0 → 0.5", () => expect(getStarRating(0)).toBe(0.5));
  it("non-numeric → 0.5", () => expect(getStarRating("bogus")).toBe(0.5));
  it("null → 0.5", () => expect(getStarRating(null)).toBe(0.5));
  it("10 → 1.0", () => expect(getStarRating(10)).toBe(1.0));
  it("33.34 → 1.0 (edge)", () => expect(getStarRating(33.34)).toBe(1.0));
  it("33.40 → 1.5", () => expect(getStarRating(33.40)).toBe(1.5));
  it("33.56 → 2.0", () => expect(getStarRating(33.56)).toBe(2.0));
  it("34.23 → 2.5", () => expect(getStarRating(34.23)).toBe(2.5));
  it("36.47 → 3.0", () => expect(getStarRating(36.47)).toBe(3.0));
  it("43.03 → 3.5", () => expect(getStarRating(43.03)).toBe(3.5));
  it("54.45 → 4.0", () => expect(getStarRating(54.45)).toBe(4.0));
  it("63.51 → 4.5", () => expect(getStarRating(63.51)).toBe(4.5));
  it("100 → 5.0", () => expect(getStarRating(100)).toBe(5.0));
});
