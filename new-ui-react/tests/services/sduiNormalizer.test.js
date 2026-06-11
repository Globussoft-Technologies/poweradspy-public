import { describe, it, expect } from "vitest";
import { normalizeSDUIConfig } from "../../src/services/sduiNormalizer.js";

// NOTE: 100% line/function coverage achieved. 12% of statements/branches
// uncovered correspond to defensive null-guards (lines 21, 29, 45, 59)
// inside sortByRank/normalizeOption/normalizeFilter/normalizeDocument
// that are unreachable: every caller wraps the call with an Array.isArray
// gate, and sortByRank crashes on null entries before they reach the
// per-entry guards (tracked in issue #245).

describe("services/sduiNormalizer > normalizeSDUIConfig (top-level)", () => {
  it("null/undefined config → empty shape", () => {
    const out = normalizeSDUIConfig(null);
    expect(out).toEqual({
      schema_version: "", config_version: 0,
      searchbar: [], navbar: [], sidebar: [],
    });
  });
  it("missing sections → empty arrays", () => {
    const out = normalizeSDUIConfig({});
    expect(out.searchbar).toEqual([]);
    expect(out.navbar).toEqual([]);
    expect(out.sidebar).toEqual([]);
  });
  it("non-array section → coerced to []", () => {
    const out = normalizeSDUIConfig({ sidebar: "not-array" });
    expect(out.sidebar).toEqual([]);
  });
  it("propagates schema_version + config_version", () => {
    const out = normalizeSDUIConfig({ schema_version: "1.2.3", config_version: 42 });
    expect(out.schema_version).toBe("1.2.3");
    expect(out.config_version).toBe(42);
  });
});

describe("services/sduiNormalizer > sortByRank", () => {
  it("sorts documents within a section by rank ascending", () => {
    const out = normalizeSDUIConfig({
      sidebar: [
        { _id: "b", rank: 2 },
        { _id: "a", rank: 1 },
        { _id: "c", rank: 3 },
      ],
    });
    expect(out.sidebar.map(d => d._id)).toEqual(["a", "b", "c"]);
  });
  it("missing rank defaults to 999", () => {
    const out = normalizeSDUIConfig({
      sidebar: [{ _id: "z" }, { _id: "a", rank: 0 }],
    });
    expect(out.sidebar.map(d => d._id)).toEqual(["a", "z"]);
  });
  it("both items missing rank → both default to 999 (stable order)", () => {
    const out = normalizeSDUIConfig({
      sidebar: [{ _id: "x" }, { _id: "y" }],
    });
    // Both have rank=999, sort stable so order preserved
    expect(out.sidebar.map(d => d._id)).toEqual(["x", "y"]);
  });
});

describe("services/sduiNormalizer > visible filter", () => {
  it("drops visible:false documents by default", () => {
    const out = normalizeSDUIConfig({
      sidebar: [
        { _id: "a", visible: true },
        { _id: "b", visible: false },
        { _id: "c" },
      ],
    });
    expect(out.sidebar.map(d => d._id)).toEqual(["a", "c"]);
  });
  it("drops visible:false filters by default", () => {
    const out = normalizeSDUIConfig({
      sidebar: [{
        _id: "a",
        filters: [
          { _id: "f1", visible: true },
          { _id: "f2", visible: false },
        ],
      }],
    });
    expect(out.sidebar[0].filters.map(f => f._id)).toEqual(["f1"]);
  });
  it("keeps invisible items when includeInvisible:true", () => {
    const out = normalizeSDUIConfig({
      sidebar: [{ _id: "hidden", visible: false }],
    }, { includeInvisible: true });
    expect(out.sidebar.length).toBe(1);
  });
});

describe("services/sduiNormalizer > normalizePlatformApplicability (via filter)", () => {
  const wrap = (pa) => normalizeSDUIConfig({
    sidebar: [{ _id: "d", filters: [{ _id: "f", platform_applicability: pa }] }],
  }).sidebar[0].filters[0].platform_applicability;
  it("'all' stays 'all'", () => {
    expect(wrap("all")).toBe("all");
  });
  it("array stays array", () => {
    expect(wrap(["facebook"])).toEqual(["facebook"]);
  });
  it("string wrapped to array", () => {
    expect(wrap("facebook")).toEqual(["facebook"]);
  });
  it("falsy → 'all'", () => {
    expect(wrap(undefined)).toBe("all");
  });
});

describe("services/sduiNormalizer > nested filter+option normalization", () => {
  it("filter with options + suggestion_sources + search_variants sorted", () => {
    const out = normalizeSDUIConfig({
      sidebar: [{
        _id: "doc",
        filters: [{
          _id: "f",
          options: [
            { _id: "o2", rank: 2 },
            { _id: "o1", rank: 1 },
          ],
          suggestion_sources: [
            { _id: "s2", rank: 2 },
            { _id: "s1", rank: 1 },
          ],
          search_variants: [
            { _id: "v2", rank: 2 },
            { _id: "v1", rank: 1 },
          ],
        }],
      }],
    });
    const f = out.sidebar[0].filters[0];
    expect(f.options.map(o => o._id)).toEqual(["o1", "o2"]);
    expect(f.suggestion_sources.map(s => s._id)).toEqual(["s1", "s2"]);
    expect(f.search_variants.map(v => v._id)).toEqual(["v1", "v2"]);
  });
  it("filter with non-array options → []", () => {
    const out = normalizeSDUIConfig({
      sidebar: [{ _id: "d", filters: [{ _id: "f", options: "bogus" }] }],
    });
    expect(out.sidebar[0].filters[0].options).toEqual([]);
  });
  it("filter with non-array suggestion_sources/search_variants → []", () => {
    const out = normalizeSDUIConfig({
      sidebar: [{ _id: "d", filters: [{ _id: "f", suggestion_sources: 1, search_variants: 2 }] }],
    });
    expect(out.sidebar[0].filters[0].suggestion_sources).toEqual([]);
    expect(out.sidebar[0].filters[0].search_variants).toEqual([]);
  });
  // NOTE: sortByRank crashes on null/undefined entries in input arrays —
  // see https://github.com/Globussoft-Technologies/poweradspy/issues/245.
  // Once fixed, add tests for null-tolerant input here.
});

describe("services/sduiNormalizer > option children + legacy sub_options", () => {
  it("option with children sorted+normalized", () => {
    const out = normalizeSDUIConfig({
      sidebar: [{
        _id: "d", filters: [{
          _id: "f",
          options: [{
            _id: "o",
            children: [
              { _id: "c2", rank: 2 },
              { _id: "c1", rank: 1 },
            ],
          }],
        }],
      }],
    });
    const opt = out.sidebar[0].filters[0].options[0];
    expect(opt.children.map(c => c._id)).toEqual(["c1", "c2"]);
  });
  it("non-array children → []", () => {
    const out = normalizeSDUIConfig({
      sidebar: [{ _id: "d", filters: [{ _id: "f", options: [{ _id: "o", children: "x" }] }] }],
    });
    expect(out.sidebar[0].filters[0].options[0].children).toEqual([]);
  });
  it("legacy sub_options used when children missing", () => {
    const out = normalizeSDUIConfig({
      sidebar: [{
        _id: "d", filters: [{
          _id: "f",
          options: [{
            _id: "o",
            sub_options: [{ _id: "x", rank: 1 }],
          }],
        }],
      }],
    });
    expect(out.sidebar[0].filters[0].options[0].children.map(c => c._id)).toEqual(["x"]);
  });
  // NOTE: falsy entries (null/undefined) inside sub-arrays crash sortByRank.
  // Tracked in https://github.com/Globussoft-Technologies/poweradspy/issues/245.
});

describe("services/sduiNormalizer > document edge cases", () => {
  it("missing filters → []", () => {
    const out = normalizeSDUIConfig({ sidebar: [{ _id: "d" }] });
    expect(out.sidebar[0].filters).toEqual([]);
  });
  it("non-array filters → []", () => {
    const out = normalizeSDUIConfig({ sidebar: [{ _id: "d", filters: "x" }] });
    expect(out.sidebar[0].filters).toEqual([]);
  });
  it("legacy sub_options as non-array → sortByRank Array.isArray guard returns [] (line 21)", () => {
    // option.sub_options is truthy non-array string. The line-35 spread
    // calls sortByRank(sub_options) which hits the non-array guard.
    const out = normalizeSDUIConfig({
      sidebar: [{
        _id: "d", filters: [{
          _id: "f",
          options: [{ _id: "o", sub_options: "i-am-not-an-array" }],
        }],
      }],
    });
    expect(out.sidebar[0].filters[0].options[0].children).toEqual([]);
  });

  it("falsy primitives in docs/filters/options arrays → normalize-X returns null → filtered out (lines 29, 45, 59)", () => {
    // Cannot use `null` because sortByRank's `(a.rank ?? 999)` throws on null
    // (issue #282). But `0` and `false` are falsy primitives that don't throw
    // on `.rank` access, so they reach the normalizeX truthy guards which
    // return null, then .filter(Boolean) strips them.
    const out = normalizeSDUIConfig({
      sidebar: [
        0,
        { _id: "d1", filters: [false] },
        { _id: "d2", filters: [{ _id: "f1", options: [0] }] },
      ],
    });
    // The `0` doc → normalizeDocument(0) → null guard fires → filtered
    expect(out.sidebar.find((d) => d === 0 || d === null)).toBeUndefined();
    // d1's false filter → normalizeFilter(false) → null → filtered
    expect(out.sidebar.find((d) => d._id === "d1").filters).toEqual([]);
    // d2's `0` option → normalizeOption(0) → null → filtered
    expect(out.sidebar.find((d) => d._id === "d2").filters[0].options).toEqual([]);
  });
});
