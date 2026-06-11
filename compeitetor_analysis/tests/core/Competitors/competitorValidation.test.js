import { describe, it, expect } from "vitest";
import validator from "../../../core/Competitors/competitorValidation.js";

describe("core/Competitors/competitorValidation > createDetails", () => {
  it("accepts a valid payload", () => {
    const { error, value } = validator.createDetails({
      amember_id: 1,
      plan_id: 2,
      plan_expiry_date: "2026-12-31",
      userName: "alice",
      email: "a@b.com",
    });
    expect(error).toBeUndefined();
    expect(value.userName).toBe("alice");
  });

  it("rejects missing required fields", () => {
    const { error } = validator.createDetails({});
    expect(error).toBeDefined();
  });

  it("rejects bad email", () => {
    const { error } = validator.createDetails({
      amember_id: 1, plan_id: 2, plan_expiry_date: "2026-01-01",
      userName: "alice", email: "not-email",
    });
    expect(error).toBeDefined();
  });

  it("accepts optional company_name/url/phone_number when present", () => {
    const { error } = validator.createDetails({
      amember_id: 1, plan_id: 2, plan_expiry_date: "2026-01-01",
      userName: "alice", email: "a@b.com",
      company_name: "ACME", url: "https://acme.test", phone_number: "+1-555-1234",
    });
    expect(error).toBeUndefined();
  });
});

describe("core/Competitors/competitorValidation > createRequest", () => {
  it("accepts a valid payload", () => {
    const { error } = validator.createRequest({
      user_id: "0123456789abcdef01234567",
      brand_url: "https://example.com",
      advertiser: ["acme"],
      competitor_details: [{ competitor_name: "c1", competitor_url: "https://c1.test" }],
      country: ["US"],
      category: ["tech"],
    });
    expect(error).toBeUndefined();
  });

  it("rejects missing brand_url", () => {
    const { error } = validator.createRequest({
      user_id: "0123456789abcdef01234567",
      advertiser: ["acme"],
      competitor_details: [{ competitor_name: "c1", competitor_url: "https://c1.test" }],
      country: [],
      category: [],
    });
    expect(error).toBeDefined();
  });

  it("rejects empty advertiser array", () => {
    const { error } = validator.createRequest({
      user_id: "0123456789abcdef01234567",
      brand_url: "https://example.com",
      advertiser: [],
      competitor_details: [{ competitor_name: "c1", competitor_url: "https://c1.test" }],
      country: [],
      category: [],
    });
    expect(error).toBeDefined();
  });

  it("rejects invalid user_id format", () => {
    const { error } = validator.createRequest({
      user_id: "not-hex",
      brand_url: "https://example.com",
      advertiser: ["acme"],
      competitor_details: [{ competitor_name: "c1", competitor_url: "https://c1.test" }],
      country: [],
      category: [],
    });
    expect(error).toBeDefined();
  });
});
