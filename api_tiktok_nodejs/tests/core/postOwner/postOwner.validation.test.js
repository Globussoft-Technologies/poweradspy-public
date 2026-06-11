import { describe, it, expect } from "vitest";
import PostOwnerValidation from "../../../core/postOwner/postOwner.validation.js";

describe("core/postOwner/postOwner.validation > createOwnerDetails", () => {
  it("accepts a valid payload", () => {
    const { error } = PostOwnerValidation.createOwnerDetails({
      post_owner: "Acme",
      ads_count: 12,
    });
    expect(error).toBeUndefined();
  });

  it("accepts an empty payload (all optional)", () => {
    const { error } = PostOwnerValidation.createOwnerDetails({});
    expect(error).toBeUndefined();
  });

  it("rejects ads_count as non-number", () => {
    const { error } = PostOwnerValidation.createOwnerDetails({
      ads_count: "twelve",
    });
    expect(error).toBeDefined();
  });
});

describe("core/postOwner/postOwner.validation > updateOwnerDetails", () => {
  it("accepts a valid payload", () => {
    const { error } = PostOwnerValidation.updateOwnerDetails({
      post_owner: "Beta",
      ads_count: 7,
    });
    expect(error).toBeUndefined();
  });

  it("accepts an empty payload", () => {
    const { error } = PostOwnerValidation.updateOwnerDetails({});
    expect(error).toBeUndefined();
  });

  it("rejects post_owner as non-string", () => {
    const { error } = PostOwnerValidation.updateOwnerDetails({ post_owner: 5 });
    expect(error).toBeDefined();
  });
});
