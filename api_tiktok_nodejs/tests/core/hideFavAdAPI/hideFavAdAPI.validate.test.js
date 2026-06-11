import { describe, it, expect } from "vitest";
import hideFavAdsAPIValidation from "../../../core/hideFavAdAPI/hideFavAdAPI.validate.js";

describe("core/hideFavAdAPI/hideFavAdAPI.validate > createFavAdsAPI", () => {
  it("accepts a full valid payload", () => {
    const { error } = hideFavAdsAPIValidation.createFavAdsAPI({
      user_id: 1,
      ad_id: 2,
      post_owner_id: 3,
      type: 1,
      status: 1,
      platform: "tiktok",
      is_notified: "y",
      is_requested: "n",
      lcs_status: "ok",
    });
    expect(error).toBeUndefined();
  });

  it("accepts minimal payload with only required field (type)", () => {
    const { error } = hideFavAdsAPIValidation.createFavAdsAPI({ type: 2 });
    expect(error).toBeUndefined();
  });

  it("rejects when type is missing (required)", () => {
    const { error } = hideFavAdsAPIValidation.createFavAdsAPI({ user_id: 1 });
    expect(error).toBeDefined();
    expect(error.message).toMatch(/type/);
  });

  it("rejects type not in [1,2,3]", () => {
    const { error } = hideFavAdsAPIValidation.createFavAdsAPI({ type: 99 });
    expect(error).toBeDefined();
  });
});
