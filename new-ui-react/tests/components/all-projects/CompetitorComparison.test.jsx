import { describe, it, expect } from "vitest";
import {
  cleanTitle,
  extractHeadlines,
  extractImages,
} from "../../../src/components/all-projects/CompetitorComparison.jsx";

// Fixtures below are trimmed to the fields these helpers actually read, taken
// directly from the real /get-longest responses that reproduced two reported
// bugs:
// 1. "mira": Top Headlines showed a blank pill instead of "No heading found"
//    — one IMAGE ad's title_exactly was the scraped-junk string "||,||,"
//    (pure punctuation, no real words), which passed a plain truthy check.
// 2. Creative Style Examples showed the same creative image twice — the same
//    new_nas_image_url appeared on more than one ad variant with no dedup.

describe("cleanTitle", () => {
  it("rejects pure-punctuation junk like the real '||,||,' scrape artifact", () => {
    expect(cleanTitle("||,||,")).toBe("");
  });

  it("rejects zero-width/invisible-only content", () => {
    expect(cleanTitle("​‌‍﻿")).toBe("");
  });

  it("rejects whitespace-only content", () => {
    expect(cleanTitle("   ")).toBe("");
  });

  it("rejects null/undefined", () => {
    expect(cleanTitle(null)).toBe("");
    expect(cleanTitle(undefined)).toBe("");
  });

  it("keeps real titles untouched (including emoji + punctuation mixed with words)", () => {
    expect(cleanTitle("Chat with us")).toBe("Chat with us");
    expect(cleanTitle("JOIN CHANNEL! 📲")).toBe(
      "JOIN CHANNEL! 📲",
    );
  });

  it("strips invisible characters surrounding real text", () => {
    expect(cleanTitle("​Real Title​")).toBe("Real Title");
  });
});

describe("extractHeadlines", () => {
  it("mira regression: skips null title_exactly AND junk-punctuation title_exactly, falls back to empty when nothing else qualifies", () => {
    const miraLongestData = {
      facebook: {
        longestRunningAds: [
          // VIDEO type — not eligible regardless of title content
          { "facebook_ad.type": "VIDEO", "facebook_ad_variants.title_exactly": "Chat with us" },
          // IMAGE with null title — already correctly excluded pre-fix
          { "facebook_ad.type": "IMAGE", "facebook_ad_variants.title_exactly": null },
          // IMAGE with real scraped junk — the actual bug
          { "facebook_ad.type": "IMAGE", "facebook_ad_variants.title_exactly": "||,||," },
        ],
      },
      instagram: { longestRunningAds: [] },
      google: { longestRunningAds: [] },
    };
    expect(extractHeadlines(miraLongestData)).toEqual([]);
  });

  it("still surfaces a real IMAGE-ad title when one exists", () => {
    const dataWithRealTitle = {
      facebook: {
        longestRunningAds: [
          { "facebook_ad.type": "IMAGE", "facebook_ad_variants.title_exactly": "||,||," },
          { "facebook_ad.type": "IMAGE", "facebook_ad_variants.title_exactly": "JOIN CHANNEL!" },
        ],
      },
      instagram: { longestRunningAds: [] },
      google: { longestRunningAds: [] },
    };
    expect(extractHeadlines(dataWithRealTitle)).toEqual(["JOIN CHANNEL!"]);
  });

  it("borosil regression: no IMAGE-type ads at all (only ORGANIC SEARCH / TEXT) → empty, correctly falls back to 'No heading found'", () => {
    const borosilLongestData = {
      facebook: { longestRunningAds: [] },
      instagram: { longestRunningAds: [] },
      google: {
        longestRunningAds: [
          { type: "ORGANIC SEARCH", ad_title: "shop water bottles online" },
          { type: "TEXT", ad_title: "myborosil upto 50% off" },
        ],
      },
    };
    expect(extractHeadlines(borosilLongestData)).toEqual([]);
  });

  it("splits on '||' and takes the first part (existing Laravel-parity behavior)", () => {
    const data = {
      facebook: {
        longestRunningAds: [
          { "facebook_ad.type": "IMAGE", "facebook_ad_variants.title_exactly": "Real Headline || extra junk" },
        ],
      },
      instagram: { longestRunningAds: [] },
      google: { longestRunningAds: [] },
    };
    expect(extractHeadlines(data)).toEqual(["Real Headline"]);
  });
});

describe("extractImages", () => {
  it("duplicate-creative regression: the same new_nas_image_url on multiple ad variants counts once, not once-per-ad", () => {
    const dupImageData = {
      facebook: {
        longestRunningAds: [
          { "facebook_ad.type": "IMAGE", new_nas_image_url: "/a.jpg" },
          { "facebook_ad.type": "IMAGE", new_nas_image_url: "/a.jpg" }, // exact duplicate creative
          { "facebook_ad.type": "IMAGE", new_nas_image_url: "/b.jpg" },
        ],
      },
      instagram: { longestRunningAds: [] },
      google: { longestRunningAds: [] },
    };
    const result = extractImages(dupImageData);
    expect(result).toHaveLength(2);
    expect(new Set(result).size).toBe(2); // no duplicate URLs in the output
  });

  it("falls through to later platforms when an earlier platform's raw matches collapse to fewer than 5 unique images", () => {
    const data = {
      facebook: {
        longestRunningAds: [
          { "facebook_ad.type": "IMAGE", new_nas_image_url: "/a.jpg" },
          { "facebook_ad.type": "IMAGE", new_nas_image_url: "/a.jpg" },
          { "facebook_ad.type": "IMAGE", new_nas_image_url: "/a.jpg" },
        ],
      },
      instagram: {
        longestRunningAds: [
          { "instagram_ad.type": "IMAGE", new_nas_image_url: "/c.jpg" },
        ],
      },
      google: { longestRunningAds: [] },
    };
    const result = extractImages(data);
    // Pre-fix: facebook alone would have filled 3 raw (duplicate) slots and
    // instagram's unique /c.jpg would never even be fetched once >=1 "found".
    // Actually asserting the concrete unique set here:
    expect(result.some((url) => url.endsWith("/a.jpg"))).toBe(true);
    expect(result.some((url) => url.endsWith("/c.jpg"))).toBe(true);
    expect(new Set(result).size).toBe(result.length);
  });

  it("caps at 5 unique images even with more than 5 distinct candidates", () => {
    const data = {
      facebook: {
        longestRunningAds: Array.from({ length: 8 }, (_, i) => ({
          "facebook_ad.type": "IMAGE",
          new_nas_image_url: `/img-${i}.jpg`,
        })),
      },
      instagram: { longestRunningAds: [] },
      google: { longestRunningAds: [] },
    };
    const result = extractImages(data);
    expect(result).toHaveLength(5);
    expect(new Set(result).size).toBe(5);
  });

  it("skips non-IMAGE ads and ads with no image URL", () => {
    const data = {
      facebook: {
        longestRunningAds: [
          { "facebook_ad.type": "VIDEO", new_nas_image_url: "/should-not-appear.jpg" },
          { "facebook_ad.type": "IMAGE", new_nas_image_url: null },
          { "facebook_ad.type": "IMAGE", new_nas_image_url: "/real.jpg" },
        ],
      },
      instagram: { longestRunningAds: [] },
      google: { longestRunningAds: [] },
    };
    const result = extractImages(data);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain("/real.jpg");
  });
});
