import { describe, it, expect } from "vitest";
import keywordNotificationValidation from "../../../core/keywordNotification/keywordNotification.validation.js";

describe("core/keywordNotification/keywordNotification.validation > createKeywords", () => {
  it("accepts a valid payload with all fields", () => {
    const { error } = keywordNotificationValidation.createKeywords({
      user_id: 1,
      name: "Sumit",
      keyword: "shoes",
      email: "s@x.io",
      duration: 1,
      type: 1,
      status: 1,
    });
    expect(error).toBeUndefined();
  });

  it("accepts minimal payload with only required fields (duration, type)", () => {
    const { error } = keywordNotificationValidation.createKeywords({
      duration: 2,
      type: 2,
    });
    expect(error).toBeUndefined();
  });

  it("rejects when duration is missing (required)", () => {
    const { error } = keywordNotificationValidation.createKeywords({ type: 1 });
    expect(error).toBeDefined();
    expect(error.message).toMatch(/duration/);
  });

  it("rejects when type is missing (required)", () => {
    const { error } = keywordNotificationValidation.createKeywords({ duration: 1 });
    expect(error).toBeDefined();
    expect(error.message).toMatch(/type/);
  });

  it("rejects duration not in [1,2,3]", () => {
    const { error } = keywordNotificationValidation.createKeywords({
      duration: 99,
      type: 1,
    });
    expect(error).toBeDefined();
  });

  it("rejects type not in [1,2]", () => {
    const { error } = keywordNotificationValidation.createKeywords({
      duration: 1,
      type: 9,
    });
    expect(error).toBeDefined();
  });
});
