import { describe, it, expect } from "vitest";
import adLocationValidation from "../../../core/adLocation/adLocation.validation.js";

describe("core/adLocation/adLocation.validation > createAdLocation", () => {
  it("accepts a full valid payload", () => {
    const { error } = adLocationValidation.createAdLocation({
      ad_id: "ad-1",
      countries: ["IN", "US"],
      state: "MH",
      city: "Mumbai",
    });
    expect(error).toBeUndefined();
  });

  it("accepts an empty payload (all optional)", () => {
    const { error } = adLocationValidation.createAdLocation({});
    expect(error).toBeUndefined();
  });

  it("rejects countries with a non-string item", () => {
    const { error } = adLocationValidation.createAdLocation({
      countries: [123],
    });
    expect(error).toBeDefined();
  });
});

describe("core/adLocation/adLocation.validation > updateAdLocation", () => {
  it("accepts a full valid payload", () => {
    const { error } = adLocationValidation.updateAdLocation({
      ad_id: "ad-2",
      countries: ["IN"],
      state: "KA",
      city: "Bangalore",
    });
    expect(error).toBeUndefined();
  });

  it("accepts an empty payload (all optional)", () => {
    const { error } = adLocationValidation.updateAdLocation({});
    expect(error).toBeUndefined();
  });

  it("rejects an unknown field", () => {
    const { error } = adLocationValidation.updateAdLocation({ unknown: "x" });
    expect(error).toBeDefined();
  });
});
