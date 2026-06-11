import { describe, it, expect } from "vitest";
import metaDataValidation from "../../../core/metaData/metaData.validation.js";

const fullValidPayload = {
  ad_id: "ad-1",
  video_url: "v",
  video_duration: "30s",
  video_cover: "cover.png",
  platform: 1,
  destination_url: "https://x",
  source: "src",
  cost: 9.99,
  ctr: 0.12,
  library_url: "lib",
  ad_paid_for: "Acme",
  audience: "all",
  interest: "tech",
  video_interection: "n",
  creator_interactions: "m",
  published_countries_count: 5,
  target_users: "users",
  top_clicks: "tc",
  objectives: ["awareness"],
  target_keywords: ["k1"],
  top_ctr: "tctr",
  ctr_graph: [{ second: 1, value: 0.5 }],
  top_cvr: "tcvr",
  cvr_graph: [{ second: 2, value: 0.7 }],
  clicks_graph: [{ second: 3, value: 1.2 }],
  top_conversion: "tconv",
  conversion_graph: [{ second: 4, value: 2.0 }],
  top_remains: "tr",
  remain_graph: [{ second: 5, value: 0.1 }],
  affiliate_status: "ok",
  affiliate_data: "x",
  built_with_status: "ok",
  built_with_data: "wp",
  built_with_analytics_tracking: "ga",
};

describe("core/metaData/metaData.validation > createMetaData", () => {
  it("accepts a full valid payload", () => {
    const { error } = metaDataValidation.createMetaData(fullValidPayload);
    expect(error).toBeUndefined();
  });

  it("accepts minimal payload with only required ad_id", () => {
    const { error } = metaDataValidation.createMetaData({ ad_id: "x" });
    expect(error).toBeUndefined();
  });

  it("rejects when ad_id missing", () => {
    const { error } = metaDataValidation.createMetaData({});
    expect(error).toBeDefined();
    expect(error.message).toMatch(/ad_id/);
  });

  it("rejects unknown fields", () => {
    const { error } = metaDataValidation.createMetaData({
      ad_id: "x",
      unknown: "nope",
    });
    expect(error).toBeDefined();
  });

  it("rejects platform as non-integer", () => {
    const { error } = metaDataValidation.createMetaData({
      ad_id: "x",
      platform: "tiktok",
    });
    expect(error).toBeDefined();
  });

  it("rejects ctr_graph items missing second/value shape", () => {
    const { error } = metaDataValidation.createMetaData({
      ad_id: "x",
      ctr_graph: [{ bad: 1 }],
    });
    expect(error).toBeDefined();
  });
});

describe("core/metaData/metaData.validation > updateMetaData", () => {
  it("accepts a full valid payload", () => {
    const { error } = metaDataValidation.updateMetaData(fullValidPayload);
    expect(error).toBeUndefined();
  });

  it("accepts minimal payload with only required ad_id", () => {
    const { error } = metaDataValidation.updateMetaData({ ad_id: "x" });
    expect(error).toBeUndefined();
  });

  it("rejects when ad_id missing", () => {
    const { error } = metaDataValidation.updateMetaData({});
    expect(error).toBeDefined();
  });

  it("rejects unknown fields", () => {
    const { error } = metaDataValidation.updateMetaData({
      ad_id: "x",
      unknown: "nope",
    });
    expect(error).toBeDefined();
  });

  it("rejects published_countries_count as non-integer", () => {
    const { error } = metaDataValidation.updateMetaData({
      ad_id: "x",
      published_countries_count: 1.5,
    });
    expect(error).toBeDefined();
  });
});
