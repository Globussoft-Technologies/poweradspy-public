// buildSearchPayload: AI Search keyword and advertiser lists are sent as arrays.
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/hooks/useAuth", () => ({
  getAuthToken: vi.fn(() => "tk"),
  markFiltersForExpiry: vi.fn(),
  disableEnvAuthFallback: vi.fn(),
}));

let buildSearchPayload;
beforeEach(async () => {
  vi.resetModules();
  globalThis.fetch = vi.fn();
  ({ buildSearchPayload } = await import("../../src/services/api.js"));
});

describe("buildSearchPayload > AI Search lists", () => {
  it("sends a keyword list as an array instead of one joined string", () => {
    const payload = buildSearchPayload({
      searchIn: "keyword",
      searchQuery: "flipkart, amazon, canon",
      searchTerms: ["flipkart", "amazon", "canon"],
    });

    expect(payload.keyword).toEqual(["flipkart", "amazon", "canon"]);
    expect(payload.advertiser).toBe("NA");
  });

  it("sends an advertiser list as an array", () => {
    const payload = buildSearchPayload({
      searchIn: "advertiser",
      searchQuery: "Nike, Adidas",
      searchTerms: ["Nike", "Adidas"],
    });

    expect(payload.advertiser).toEqual(["Nike", "Adidas"]);
    expect(payload.keyword).toBe("NA");
  });

  it("keeps a single keyword as a string when there is no list", () => {
    const payload = buildSearchPayload({
      searchIn: "keyword",
      searchQuery: "running shoes",
      searchTerms: null,
    });

    expect(payload.keyword).toBe("running shoes");
  });

  it("treats an empty list as no list", () => {
    const payload = buildSearchPayload({
      searchIn: "keyword",
      searchQuery: "running shoes",
      searchTerms: [],
    });

    expect(payload.keyword).toBe("running shoes");
  });
});
