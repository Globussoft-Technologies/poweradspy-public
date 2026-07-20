import { describe, it, expect } from "vitest";
import {
  getCountryInfo,
  getDisplayCountries,
} from "../../../src/components/all-projects/AllProjects.jsx";

// Regression for the real reported bug: the Top Country dropdown showed the
// same flag for Ireland/Lithuania/Malta/Romania/Slovakia (and any other
// country outside the ~30-entry hardcoded _map) because unmapped full names
// all fell through to the generic "un" placeholder flag.
describe("getCountryInfo", () => {
  it("resolves the exact countries from the reported bug to distinct ISO codes", () => {
    expect(getCountryInfo("ireland").f).toBe("ie");
    expect(getCountryInfo("lithuania").f).toBe("lt");
    expect(getCountryInfo("malta").f).toBe("mt");
    expect(getCountryInfo("romania").f).toBe("ro");
    expect(getCountryInfo("slovakia").f).toBe("sk");

    // Same assertion the other way: none of these should collapse to "un"
    // or to each other.
    const flags = ["ireland", "lithuania", "malta", "romania", "slovakia"].map(
      (c) => getCountryInfo(c).f,
    );
    expect(new Set(flags).size).toBe(flags.length);
    expect(flags).not.toContain("un");
  });

  it("is case-insensitive and trims whitespace, same as the small hardcoded map", () => {
    expect(getCountryInfo("Ireland").f).toBe("ie");
    expect(getCountryInfo("  Slovakia  ").f).toBe("sk");
  });

  it("still resolves countries covered by the small hardcoded _map (unchanged behavior)", () => {
    expect(getCountryInfo("united states")).toEqual({ f: "us", n: "United States" });
    expect(getCountryInfo("uk")).toEqual({ f: "gb", n: "United Kingdom" });
    expect(getCountryInfo("india")).toEqual({ f: "in", n: "India" });
  });

  it("still treats a bare 2-letter code as an ISO code directly (unchanged behavior)", () => {
    expect(getCountryInfo("jp")).toEqual({ f: "jp", n: "JP" });
  });

  it("falls back to 'un' only for genuinely unrecognized input", () => {
    expect(getCountryInfo("Not A Real Country").f).toBe("un");
  });

  it("handles null/empty input", () => {
    expect(getCountryInfo(null)).toEqual({ f: "un", n: "Unknown" });
    expect(getCountryInfo("")).toEqual({ f: "un", n: "Unknown" });
  });

  // Regression for the follow-up bug: ES stores "all" as a country value for
  // ads with no specific geo-targeting. It was first mistakenly rendered as a
  // bogus "un" flag, then over-corrected by filtering it out of the list
  // entirely — which left competitors whose ads are ALL untargeted with a
  // blank Top Country cell despite genuinely having ads. Neither is right:
  // "all" should be flagged so callers render it as "Global reach" (globe
  // icon), not as a fake country and not as nothing.
  it("flags 'all' as global reach instead of resolving it as a country", () => {
    expect(getCountryInfo("all")).toEqual({
      f: null,
      n: "Global reach",
      isGlobal: true,
    });
  });

  it("'all' handling is case-insensitive and trims whitespace", () => {
    expect(getCountryInfo("All").isGlobal).toBe(true);
    expect(getCountryInfo("  ALL  ").isGlobal).toBe(true);
  });

  it("does not flag countries that merely contain 'all' as a substring", () => {
    expect(getCountryInfo("Mallorca-not-a-real-country").isGlobal).toBeUndefined();
  });
});

describe("getDisplayCountries", () => {
  // Regression for the reported bug: "Global reach" showed up alongside real
  // countries ("India", "republic of india") instead of being suppressed
  // once genuine countries are present, and "India"/"republic of india" (the
  // same country under two different raw strings) were listed as two
  // separate entries instead of being collapsed into one.
  it("suppresses Global reach once at least one real country is present", () => {
    const result = getDisplayCountries(["all", "India", "republic of india"]);
    expect(result.some((c) => getCountryInfo(c).isGlobal)).toBe(false);
  });

  it("collapses duplicate raw strings that resolve to the same country", () => {
    const result = getDisplayCountries(["India", "republic of india"]);
    expect(result).toHaveLength(1);
  });

  it("the exact reported case: ['all', 'India', 'republic of india'] collapses to just India", () => {
    const result = getDisplayCountries(["all", "India", "republic of india"]);
    expect(result).toHaveLength(1);
    expect(getCountryInfo(result[0]).n).toBe("India");
  });

  it("keeps Global reach when it is the only entry", () => {
    const result = getDisplayCountries(["all"]);
    expect(result).toHaveLength(1);
    expect(getCountryInfo(result[0]).isGlobal).toBe(true);
  });

  it("keeps distinct real countries separate (no over-merging)", () => {
    const result = getDisplayCountries(["India", "United States", "Canada"]);
    expect(result).toHaveLength(3);
  });

  it("handles empty/non-array input", () => {
    expect(getDisplayCountries([])).toEqual([]);
    expect(getDisplayCountries(null)).toEqual([]);
    expect(getDisplayCountries(undefined)).toEqual([]);
  });

  it("does NOT merge two different unrecognized country strings just because both fall back to the generic 'un' flag", () => {
    const result = getDisplayCountries(["Wakanda", "Narnia"]);
    expect(result).toHaveLength(2);
  });

  it("filters out falsy entries (null/empty string) instead of rendering a bogus 'Unknown' row", () => {
    const result = getDisplayCountries(["India", null, "", "Canada"]);
    expect(result).toHaveLength(2);
  });
});
