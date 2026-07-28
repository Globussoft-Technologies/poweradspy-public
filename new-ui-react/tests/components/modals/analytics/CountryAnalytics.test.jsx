import { describe, expect, it } from "vitest";
import { normalizeCountryIdentity } from "../../../../src/components/modals/analytics/CountryAnalytics.jsx";

describe("CountryAnalytics country labels", () => {
  it("resolves an ISO-only country value to its user-facing name", () => {
    expect(normalizeCountryIdentity("JP", null)).toEqual({
      iso: "JP",
      name: "Japan",
    });
  });

  it("keeps full country names and derives their ISO code", () => {
    expect(normalizeCountryIdentity("Germany", null)).toEqual({
      iso: "DE",
      name: "Germany",
    });
  });

  it("prefers the canonical name when both raw country and ISO are codes", () => {
    expect(normalizeCountryIdentity("US", "US")).toEqual({
      iso: "US",
      name: "United States",
    });
  });
});
