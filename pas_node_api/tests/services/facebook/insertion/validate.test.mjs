import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { validateMetaAds, validateAdsLibrary } = require("../../../../src/services/facebook/insertion/validate");

const validMetaAd = {
  type: "IMAGE",
  category: "Tech",
  call_to_action: "Shop Now",
  image_video_url: "https://example.com/img.jpg",
  ad_position: "feed",
  likes: 10,
  comment: 2,
  share: 1,
  other_multimedia: [],
  destination_url: "https://example.com",
  initial_url: null,
  ad_title: "Title",
  news_feed_description: "Desc",
  ad_text: "Text",
  ad_url: "https://example.com/ad",
  post_owner: "Owner",
  post_owner_image: "https://example.com/owner.jpg",
  ad_id: "fb-1",
  platform: "facebook",
  version: "v1",
  post_date: "1690000000",
  first_seen: "1690000000",
  last_seen: "1690000000",
  city: "NYC",
  state: "NY",
  country: ["US", "CA"],
};

describe("services/facebook/insertion/validate > validateMetaAds", () => {
  it("passes a valid ad", () => {
    expect(validateMetaAds(validMetaAd)).toEqual({ code: 200 });
  });

  it("rejects stringified null for required fields", () => {
    const out = validateMetaAds({ ...validMetaAd, ad_id: "null", category: "NULL" });
    expect(out.code).toBe(400);
    expect(out.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("ad_id"),
        expect.stringContaining("category"),
      ])
    );
  });

  it("rejects empty string for required fields", () => {
    const out = validateMetaAds({ ...validMetaAd, ad_id: "", type: "" });
    expect(out.code).toBe(400);
  });

  it("strips null-like items from array fields while keeping real values", () => {
    const out = validateMetaAds({ ...validMetaAd, country: ["null", "US", "", "CA"] });
    expect(out).toEqual({ code: 200 });
  });

  it("rejects a country array that becomes empty after stripping null-likes", () => {
    const out = validateMetaAds({ ...validMetaAd, country: ["null", ""] });
    expect(out.code).toBe(400);
    expect(out.errors).toEqual(expect.arrayContaining([expect.stringContaining("country")]));
  });

  it("rejects stringified null for post_owner only; ad_url/destination_url/post_date may be null", () => {
    const out = validateMetaAds({
      ...validMetaAd,
      post_date: "null",
      post_owner: "null",
      ad_url: "null",
      destination_url: "null",
    });
    expect(out.code).toBe(400);
    expect(out.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("post_owner"),
      ])
    );
    expect(out.errors.some((e) => e.includes("post_date") || e.includes("ad_url") || e.includes("destination_url"))).toBe(false);
  });

  it("allows ad_url, destination_url and post_date to be null or omitted", () => {
    const { ad_url, destination_url, post_date, ...rest } = validMetaAd;
    expect(validateMetaAds({ ...rest, ad_url: null, destination_url: null, post_date: null })).toEqual({ code: 200 });
    expect(validateMetaAds(rest)).toEqual({ code: 200 });
  });

  it("rejects invalid URL for ad_url and accepts valid URLs", () => {
    const out = validateMetaAds({ ...validMetaAd, ad_url: "not-a-url" });
    expect(out.code).toBe(400);
    expect(out.errors).toEqual(expect.arrayContaining([expect.stringContaining("ad_url")]));

    expect(validateMetaAds({ ...validMetaAd, ad_url: "https://example.com/ad" })).toEqual({ code: 200 });
  });

  it("rejects non-epoch values for post_date, first_seen and last_seen", () => {
    const out = validateMetaAds({
      ...validMetaAd,
      post_date: "not-a-date",
      first_seen: "-1",
      last_seen: "123.45",
    });
    expect(out.code).toBe(400);
    expect(out.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("post_date"),
        expect.stringContaining("first_seen"),
        expect.stringContaining("last_seen"),
      ])
    );
  });

  it("rejects stringified null for first_seen, last_seen and country", () => {
    const out = validateMetaAds({
      ...validMetaAd,
      first_seen: "null",
      last_seen: "",
      country: ["null", ""],
    });
    expect(out.code).toBe(400);
    expect(out.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("first_seen"),
        expect.stringContaining("last_seen"),
        expect.stringContaining("country"),
      ])
    );
  });

  it("still allows nullable present text fields to be stringified null", () => {
    const out = validateMetaAds({
      ...validMetaAd,
      ad_title: "",
      news_feed_description: "NULL",
    });
    expect(out).toEqual({ code: 200 });
  });
});

describe("services/facebook/insertion/validate > validateAdsLibrary", () => {
  const validLib = {
    type: "VIDEO",
    ad_position: "feed",
    other_multimedia: [],
    destination_url: "https://example.com",
    initial_url: null,
    ad_title: "Title",
    news_feed_description: "Desc",
    ad_text: "Text",
    meta_ad_url: "https://example.com/ad",
    post_owner: "Owner",
    post_owner_image: null,
    ad_id: "lib-1",
    platform: "facebook",
    verified: "yes",
    call_to_action: "Shop Now",
    first_seen: "1690000000",
    last_seen: "1690000000",
    est_audience_size_low: null,
    est_audience_size_high: null,
    EUT: "",
    ad_run_platforms: ["FB", "IG"],
    currency: null,
    impressions_low: null,
    impressions_high: 1000,
    country: ["US"],
  };

  it("passes a valid library ad", () => {
    expect(validateAdsLibrary(validLib)).toEqual({ code: 200 });
  });

  it("rejects stringified null for required fields", () => {
    const out = validateAdsLibrary({ ...validLib, ad_id: "null", type: "Null" });
    expect(out.code).toBe(400);
  });

  it("strips null-like array items", () => {
    const out = validateAdsLibrary({ ...validLib, country: ["null", "US", ""] });
    expect(out).toEqual({ code: 200 });
  });
});
