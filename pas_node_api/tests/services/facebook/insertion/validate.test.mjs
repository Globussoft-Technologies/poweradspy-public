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

  it("accepts an array that becomes empty after stripping null-likes because country is only present", () => {
    const out = validateMetaAds({ ...validMetaAd, country: ["null", ""] });
    expect(out).toEqual({ code: 200 });
  });

  it("treats nullable fields with stringified null as valid", () => {
    const out = validateMetaAds({
      ...validMetaAd,
      post_date: "null",
      first_seen: "null",
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
