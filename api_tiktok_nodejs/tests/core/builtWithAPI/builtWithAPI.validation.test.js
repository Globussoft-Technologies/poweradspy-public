import { describe, it, expect } from "vitest";
import builtWithAPIValidation from "../../../core/builtWithAPI/builtWithAPI.validation.js";

describe("core/builtWithAPI/builtWithAPI.validation > createBuiltWith", () => {
  it("accepts a full valid payload", () => {
    const { error } = builtWithAPIValidation.createBuiltWith({
      id: "abc",
      affiliate_data: "x",
      status: "ok",
      built_with: "wordpress",
      built_with_cms: "wp",
      built_with_analytics_tracking: "ga",
    });
    expect(error).toBeUndefined();
  });

  it("allows null/empty optional fields", () => {
    const { error } = builtWithAPIValidation.createBuiltWith({
      id: "abc",
      affiliate_data: null,
      status: "",
      built_with: null,
      built_with_cms: "",
      built_with_analytics_tracking: null,
    });
    expect(error).toBeUndefined();
  });

  it("rejects an unknown field", () => {
    const { error } = builtWithAPIValidation.createBuiltWith({
      id: "abc",
      unknown_field: "nope",
    });
    expect(error).toBeDefined();
  });
});
