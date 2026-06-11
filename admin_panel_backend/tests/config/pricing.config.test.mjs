import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { MODEL_PRICING } = require("../../config/pricing.config");

describe("config/pricing.config", () => {
  it("exports a MODEL_PRICING object", () => {
    expect(typeof MODEL_PRICING).toBe("object");
  });

  it("contains gpt-image-1.5 pricing (openai, 8 in / 32 out)", () => {
    expect(MODEL_PRICING["gpt-image-1.5"]).toEqual({
      provider: "openai",
      input_per_million: 8,
      output_per_million: 32,
    });
  });

  it("contains gemini-3-pro-image-preview pricing (google, 2 in / 120 out)", () => {
    expect(MODEL_PRICING["gemini-3-pro-image-preview"]).toEqual({
      provider: "google",
      input_per_million: 2,
      output_per_million: 120,
    });
  });

  it("contains imagen-4.0-generate-001 (google per_image 0.04)", () => {
    expect(MODEL_PRICING["imagen-4.0-generate-001"]).toEqual({
      provider: "google",
      per_image: 0.04,
    });
  });
});
