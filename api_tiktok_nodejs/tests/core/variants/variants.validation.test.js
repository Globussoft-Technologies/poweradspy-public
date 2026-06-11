import { describe, it, expect } from "vitest";
import variantsValidation from "../../../core/variants/variants.validation.js";

describe("core/variants/variants.validation > createVariants", () => {
  it("accepts a body with all optional fields plus the required ad_id", () => {
    const { error, value } = variantsValidation.createVariants({
      ad_id: "ad-1",
      ad_title: "Buy now",
      newsfeed_description: "Best deals",
      video_url_original: "https://x/a.mp4",
      video_url: "https://x/b.mp4",
    });
    expect(error).toBeUndefined();
    expect(value).toMatchObject({ ad_id: "ad-1" });
  });

  it("accepts a body with only the required ad_id", () => {
    const { error } = variantsValidation.createVariants({ ad_id: "ad-2" });
    expect(error).toBeUndefined();
  });

  it("rejects a body missing ad_id", () => {
    const { error } = variantsValidation.createVariants({ ad_title: "x" });
    expect(error).toBeDefined();
    expect(error.message).toMatch(/ad_id/);
  });

  it("rejects unknown fields (Joi default disallows them)", () => {
    const { error } = variantsValidation.createVariants({
      ad_id: "ad-3",
      extra_field: "nope",
    });
    expect(error).toBeDefined();
  });
});

describe("core/variants/variants.validation > updateVariants", () => {
  it("accepts a body with all optional fields plus the required ad_id", () => {
    const { error } = variantsValidation.updateVariants({
      ad_id: "ad-1",
      ad_title: "Updated title",
      newsfeed_description: "Updated desc",
      video_url_original: "https://x/c.mp4",
      video_url: "https://x/d.mp4",
    });
    expect(error).toBeUndefined();
  });

  it("rejects a body missing ad_id", () => {
    const { error } = variantsValidation.updateVariants({});
    expect(error).toBeDefined();
    expect(error.message).toMatch(/ad_id/);
  });
});
