import { describe, it, expect } from "vitest";
import userRequestValidation from "../../../core/userRequest/userRequest.validation.js";

describe("core/userRequest/userRequest.validation > createUserRequest", () => {
  it("accepts a body with keywords", () => {
    const { error } = userRequestValidation.createUserRequest({
      user_id: 1,
      name: "Sumit",
      email: "s@x.io",
      keywords: "shoes",
      country: "IN",
      user_type: 1,
    });
    expect(error).toBeUndefined();
  });

  it("accepts a body with only advertiser (satisfies .or constraint)", () => {
    const { error } = userRequestValidation.createUserRequest({
      advertiser: "Nike",
    });
    expect(error).toBeUndefined();
  });

  it("accepts a body with only url (satisfies .or constraint)", () => {
    const { error } = userRequestValidation.createUserRequest({
      url: "https://nike.com/ad",
    });
    expect(error).toBeUndefined();
  });

  it("rejects a body with none of keywords/advertiser/url (.or constraint)", () => {
    const { error } = userRequestValidation.createUserRequest({
      user_id: 1,
      country: "IN",
    });
    expect(error).toBeDefined();
    expect(error.message).toMatch(/keywords|advertiser|url/);
  });

  it("treats empty-string keywords/advertiser/url as absent (.empty(''))", () => {
    const { error, value } = userRequestValidation.createUserRequest({
      keywords: "",
      advertiser: "Nike",
      url: "",
    });
    expect(error).toBeUndefined();
    expect(value.keywords).toBeUndefined();
    expect(value.url).toBeUndefined();
  });

  it("allows null in keywords/advertiser/url (.allow(null))", () => {
    const { error } = userRequestValidation.createUserRequest({
      keywords: null,
      advertiser: "AcmeCo",
      url: null,
    });
    expect(error).toBeUndefined();
  });
});

describe("core/userRequest/userRequest.validation > updateUserRequest", () => {
  it("accepts a body with keywords", () => {
    const { error } = userRequestValidation.updateUserRequest({
      user_id: 1,
      keywords: "boots",
      country: "US",
      user_type: 2,
    });
    expect(error).toBeUndefined();
  });

  it("rejects a body without keywords/advertiser/url", () => {
    const { error } = userRequestValidation.updateUserRequest({
      user_id: 1,
      country: "IN",
    });
    expect(error).toBeDefined();
  });

  it("allows null on keywords/advertiser/url for update too", () => {
    const { error } = userRequestValidation.updateUserRequest({
      keywords: null,
      url: "https://x",
    });
    expect(error).toBeUndefined();
  });
});
