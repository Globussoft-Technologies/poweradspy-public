import { describe, it, expect } from "vitest";
import validator from "../../../core/Dashboard/dashboardValidation.js";

describe("core/Dashboard/dashboardValidation > validatePayloadForBacklink", () => {
  it("accepts valid payload", () => {
    const { error } = validator.validatePayloadForBacklink({
      domain_name: "x.com", skip: 0, limit: 10,
    });
    expect(error).toBeUndefined();
  });

  it("rejects missing required", () => {
    expect(validator.validatePayloadForBacklink({}).error).toBeDefined();
  });

  it("allows empty referring_page and referring_domains", () => {
    const { error } = validator.validatePayloadForBacklink({
      domain_name: "x.com", referring_page: "", referring_domains: null, skip: 0, limit: 5,
    });
    expect(error).toBeUndefined();
  });
});

describe("core/Dashboard/dashboardValidation > validatePayloadForOrganic", () => {
  it("accepts valid payload", () => {
    const { error } = validator.validatePayloadForOrganic({
      domain_name: "x.com", skip: 0, limit: 10,
    });
    expect(error).toBeUndefined();
  });
  it("rejects missing required", () => {
    expect(validator.validatePayloadForOrganic({}).error).toBeDefined();
  });
});

describe("core/Dashboard/dashboardValidation > validatePayloadForPaid", () => {
  it("accepts valid payload", () => {
    const { error } = validator.validatePayloadForPaid({
      domain_name: "x.com", skip: 0, limit: 10,
    });
    expect(error).toBeUndefined();
  });
  it("rejects missing required", () => {
    expect(validator.validatePayloadForPaid({}).error).toBeDefined();
  });
});
