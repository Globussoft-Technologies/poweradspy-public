import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { validateInsta, validateAdsLibrary } = require("../../../../src/services/instagram/insertion/validate");

const validInstaAd = {
  ad_id: "ig-1",
  ad_position: "feed",
  type: "IMAGE",
  ad_text: "Text",
  ad_url: "https://example.com/ad",
  post_owner: "owner",
  post_owner_image: "https://example.com/owner.jpg",
  ad_title: "Title",
  news_feed_description: "Desc",
  platform: "instagram",
  destination_url: "https://example.com",
  initial_url: null,
  likes: 10,
  comment: 2,
  share: 1,
  call_to_action: "Shop Now",
  image_video_url: "https://example.com/img.jpg",
  post_date: "1690000000",
  first_seen: "1690000000",
  last_seen: "1690000000",
  country: "US",
  state: "CA",
  city: "LA",
  lower_age: null,
  upper_age: null,
};

describe("services/instagram/insertion/validate > validateInsta", () => {
  it("passes a valid ad", () => {
    expect(validateInsta(validInstaAd)).toEqual({ code: 200 });
  });

  it("rejects stringified null for required fields", () => {
    const out = validateInsta({ ...validInstaAd, ad_id: "null", post_owner: "NULL" });
    expect(out.code).toBe(400);
    expect(out.errors).toEqual(
      expect.arrayContaining([
        expect.stringContaining("ad_id"),
        expect.stringContaining("post_owner"),
      ])
    );
  });

  it("rejects stringified null and empty string for post_owner, first_seen, last_seen and country; ad_url/destination_url/post_date may be null", () => {
    expect(validateInsta({ ...validInstaAd, post_date: "null" }).code).toBe(200);
    expect(validateInsta({ ...validInstaAd, post_date: "" }).code).toBe(200);
    expect(validateInsta({ ...validInstaAd, post_date: null }).code).toBe(200);

    expect(validateInsta({ ...validInstaAd, ad_url: "null" }).code).toBe(200);
    expect(validateInsta({ ...validInstaAd, destination_url: "null" }).code).toBe(200);
    expect(validateInsta({ ...validInstaAd, post_owner: "" }).code).toBe(400);

    expect(validateInsta({ ...validInstaAd, first_seen: "null" }).code).toBe(400);
    expect(validateInsta({ ...validInstaAd, last_seen: "" }).code).toBe(400);
    expect(validateInsta({ ...validInstaAd, country: "null" }).code).toBe(400);
  });

  it("rejects invalid URL for ad_url and accepts valid URLs", () => {
    expect(validateInsta({ ...validInstaAd, ad_url: "not-a-url" }).code).toBe(400);
    expect(validateInsta({ ...validInstaAd, ad_url: "https://instagram.com/p/x" })).toEqual({ code: 200 });
  });

  it("rejects non-epoch values for post_date, first_seen and last_seen", () => {
    const out = validateInsta({
      ...validInstaAd,
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

  it("allows nullable present fields to be stringified null", () => {
    const out = validateInsta({
      ...validInstaAd,
      ad_title: "null",
      news_feed_description: "",
      state: "NULL",
      city: null,
    });
    expect(out).toEqual({ code: 200 });
  });
});

describe("services/instagram/insertion/validate > validateAdsLibrary", () => {
  const validLib = {
    type: "IMAGE",
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
    ad_id: "ig-lib-1",
    platform: "instagram",
    verified: "yes",
    call_to_action: "Shop Now",
    first_seen: "1690000000",
    last_seen: "1690000000",
    est_audience_size_low: null,
    est_audience_size_high: null,
    EUT: "",
    ad_run_platforms: ["IG"],
    currency: null,
    impressions_low: null,
    impressions_high: 100,
    country: ["US"],
  };

  it("passes a valid library ad", () => {
    expect(validateAdsLibrary(validLib)).toEqual({ code: 200 });
  });

  it("strips null-like items from country array", () => {
    const out = validateAdsLibrary({ ...validLib, country: ["null", "US", ""] });
    expect(out).toEqual({ code: 200 });
  });

  it("rejects stringified null for required fields", () => {
    const out = validateAdsLibrary({ ...validLib, ad_id: "null", type: "Null" });
    expect(out.code).toBe(400);
  });
});
