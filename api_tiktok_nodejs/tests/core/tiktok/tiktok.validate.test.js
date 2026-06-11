import { describe, it, expect } from "vitest";
import tiktokValidation from "../../../core/tiktok/tiktok.validate.js";

const minimalValid = {
  ad_id: "ad-1",
  video_url: "https://x/v.mp4",
  thumbnailVaild: "https://x/t.jpg",
  video_duration: 12.34,
  video_cover: "https://x/c.jpg",
  library_url: "https://x/lib",
  post_owner: "owner",
  destination_url: "https://x/dest",
  countries: ["IN", "US"],
  type: "VIDEO",
  platform: "TIKTOK",
  city: "Bangalore",
  state: "KA",
  tiktok_account_id: "tt-account-123",
};

describe("core/tiktok/tiktok.validate > createDetails", () => {
  it("accepts a minimal valid payload (just the required fields)", () => {
    const { error } = tiktokValidation.createDetails(minimalValid);
    expect(error).toBeUndefined();
  });

  it("accepts a payload with optional engagement + metadata fields populated", () => {
    const { error } = tiktokValidation.createDetails({
      ...minimalValid,
      ad_title: "Buy now",
      video_id: "vid-1",
      likes: 100,
      comments: 5,
      shares: 2,
      cost: 1.50,
      ctr: 0.12345,
      source: "ad-library",
      objectives: ["awareness"],
      target_keywords: ["shoes"],
      first_seen: new Date("2025-01-01"),
      last_seen: new Date("2025-01-10"),
      gender: { male: 0.6, female: 0.4 },
      age: { "18-24": 0.5 },
      country_users: { IN: 0.7 },
      ctr_graph: [{ x: 1, y: 0.1 }],
      cvr_graph: [{ x: 1, y: 0.05 }],
      clicks_graph: [{ x: 1, y: 10 }],
      conversion_graph: [{ x: 1, y: 1 }],
      remain_graph: [{ x: 1, y: 5 }],
      industry: "Retail",
      tiktok_account_name: "Acme",
      system_id: "sys-1",
    });
    expect(error).toBeUndefined();
  });

  it("treats empty strings as absent for .empty('') fields (likes, ad_title, etc.)", () => {
    const { error, value } = tiktokValidation.createDetails({
      ...minimalValid,
      ad_title: "",
      likes: "",
      ctr: "",
    });
    expect(error).toBeUndefined();
    expect(value.ad_title).toBeUndefined();
    expect(value.likes).toBeUndefined();
  });

  it("rejects when ad_id is missing", () => {
    const body = { ...minimalValid };
    delete body.ad_id;
    const { error } = tiktokValidation.createDetails(body);
    expect(error).toBeDefined();
    expect(error.message).toMatch(/ad_id/);
  });

  it("rejects when video_duration is not a number", () => {
    const { error } = tiktokValidation.createDetails({
      ...minimalValid,
      video_duration: "twelve",
    });
    expect(error).toBeDefined();
    expect(error.message).toMatch(/video_duration/);
  });

  it("rejects when countries is missing", () => {
    const body = { ...minimalValid };
    delete body.countries;
    const { error } = tiktokValidation.createDetails(body);
    expect(error).toBeDefined();
    expect(error.message).toMatch(/countries/);
  });

  it("rejects when tiktok_account_id is missing", () => {
    const body = { ...minimalValid };
    delete body.tiktok_account_id;
    const { error } = tiktokValidation.createDetails(body);
    expect(error).toBeDefined();
    expect(error.message).toMatch(/tiktok_account_id/);
  });
});
