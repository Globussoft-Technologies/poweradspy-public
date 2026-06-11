import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const configPath = require.resolve("../../../../src/config");
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true,
  exports: { cdn: { baseUrl: "https://cdn.test/" } },
};

let mod;
beforeEach(() => {
  // Restore config in case a prior test mutated it.
  require.cache[configPath] = {
    id: configPath, filename: configPath, loaded: true,
    exports: { cdn: { baseUrl: "https://cdn.test/" } },
  };
  const sutPath = require.resolve("../../../../src/services/tiktok/helpers/paramParser");
  delete require.cache[sutPath];
  mod = require("../../../../src/services/tiktok/helpers/paramParser");
});

describe("services/tiktok/helpers/paramParser > normalizeValue", () => {
  it("'NA', null, undefined → ''", () => {
    expect(mod.normalizeValue("NA")).toBe("");
    expect(mod.normalizeValue(null)).toBe("");
    expect(mod.normalizeValue(undefined)).toBe("");
  });
  it("trims strings", () => {
    expect(mod.normalizeValue("  hello  ")).toBe("hello");
  });
  it("non-string passes through unchanged", () => {
    expect(mod.normalizeValue(42)).toBe(42);
    expect(mod.normalizeValue([1, 2])).toEqual([1, 2]);
    expect(mod.normalizeValue({ x: 1 })).toEqual({ x: 1 });
  });
});

describe("services/tiktok/helpers/paramParser > normalizeParams", () => {
  it("falsy/non-object → {}", () => {
    expect(mod.normalizeParams(null)).toEqual({});
    expect(mod.normalizeParams(undefined)).toEqual({});
    expect(mod.normalizeParams("not-an-object")).toEqual({});
    expect(mod.normalizeParams(42)).toEqual({});
  });
  it("normalizes each value in the body", () => {
    expect(mod.normalizeParams({ a: "NA", b: " x ", c: 5 })).toEqual({ a: "", b: "x", c: 5 });
  });
});

describe("services/tiktok/helpers/paramParser > ensureArray", () => {
  it("returns array unchanged", () => {
    expect(mod.ensureArray([1, 2])).toEqual([1, 2]);
  });
  it("'', null, undefined → []", () => {
    expect(mod.ensureArray("")).toEqual([]);
    expect(mod.ensureArray(null)).toEqual([]);
    expect(mod.ensureArray(undefined)).toEqual([]);
  });
  it("scalar → wrapped in array", () => {
    expect(mod.ensureArray("foo")).toEqual(["foo"]);
    expect(mod.ensureArray(7)).toEqual([7]);
  });
});

describe("services/tiktok/helpers/paramParser > parsePagination", () => {
  it("prefers limit > take > page_size, falls back to 20", () => {
    expect(mod.parsePagination({ limit: "5", take: "10", page_size: "30" })).toEqual({ size: 5, from: 0 });
    expect(mod.parsePagination({ take: "10", page_size: "30" })).toEqual({ size: 10, from: 0 });
    expect(mod.parsePagination({ page_size: "30" })).toEqual({ size: 30, from: 0 });
    expect(mod.parsePagination({})).toEqual({ size: 20, from: 0 });
  });
  it("uses skip > page for offset (multiplied by take)", () => {
    expect(mod.parsePagination({ limit: "10", skip: "3" })).toEqual({ size: 10, from: 30 });
    expect(mod.parsePagination({ limit: "10", page: "2" })).toEqual({ size: 10, from: 20 });
  });
});

describe("services/tiktok/helpers/paramParser > parseSort — standard flags", () => {
  it("popularity_sort", () => {
    expect(mod.parseSort({ popularity_sort: "popularity_sort" })).toEqual({ field: "popularity", order: "desc" });
  });
  it("newest_sort", () => {
    expect(mod.parseSort({ newest_sort: "newest_sort" })).toEqual({ field: "createdAt", order: "desc" });
  });
  it("last_seen_sort", () => {
    expect(mod.parseSort({ last_seen_sort: "LastSeen_sort" })).toEqual({ field: "updatedAt", order: "desc" });
  });
  it("running_longest_sort", () => {
    expect(mod.parseSort({ running_longest_sort: "running_longest_sort" })).toEqual({ field: "days_running", order: "desc" });
  });
  it("likes_sort", () => {
    expect(mod.parseSort({ likes_sort: "likes_sort" })).toEqual({ field: "likes", order: "desc" });
  });
  it("comments_sort", () => {
    expect(mod.parseSort({ comments_sort: "comments_sort" })).toEqual({ field: "comments", order: "desc" });
  });
  it("shares_sort", () => {
    expect(mod.parseSort({ shares_sort: "shares_sort" })).toEqual({ field: "shares", order: "desc" });
  });
  it("impression_sort", () => {
    expect(mod.parseSort({ impression_sort: "impression_sort" })).toEqual({ field: "impression", order: "desc" });
  });
  it("adBudget_sort", () => {
    expect(mod.parseSort({ adBudget_sort: "adBudget_sort" })).toEqual({ field: "budget", order: "desc" });
  });
});

describe("services/tiktok/helpers/paramParser > parseSort — order_column path", () => {
  it("known order_column maps to ES field with desc default", () => {
    expect(mod.parseSort({ order_column: "likes" })).toEqual({ field: "likes", order: "desc" });
    expect(mod.parseSort({ order_column: "impressions" })).toEqual({ field: "impression", order: "desc" });
    expect(mod.parseSort({ order_column: "last_seen" })).toEqual({ field: "updatedAt", order: "desc" });
  });
  it("explicit order_by=asc → asc", () => {
    expect(mod.parseSort({ order_column: "popularity", order_by: "asc" })).toEqual({ field: "popularity", order: "asc" });
  });
  it("unknown order_column passes through as-is", () => {
    expect(mod.parseSort({ order_column: "weird_col" })).toEqual({ field: "weird_col", order: "desc" });
  });
  it("order_column 'NA' / 'post_date' / '' is ignored", () => {
    expect(mod.parseSort({ order_column: "NA" })).toEqual({ field: "updatedAt", order: "desc" });
    expect(mod.parseSort({ order_column: "post_date" })).toEqual({ field: "updatedAt", order: "desc" });
    expect(mod.parseSort({ order_column: "" })).toEqual({ field: "updatedAt", order: "desc" });
  });
});

describe("services/tiktok/helpers/paramParser > parseSort — TikTok-native sortBy", () => {
  it("Newest", () => { expect(mod.parseSort({ sortBy: "Newest" })).toEqual({ field: "createdAt", order: "desc" }); });
  it("LastSeen", () => { expect(mod.parseSort({ sortBy: "LastSeen" })).toEqual({ field: "updatedAt", order: "desc" }); });
  it("domain_date", () => { expect(mod.parseSort({ sortBy: "domain_date" })).toEqual({ field: "domain_registered_date", order: "desc" }); });
  it("days_running", () => { expect(mod.parseSort({ sortBy: "days_running" })).toEqual({ field: "days_running", order: "desc" }); });
  it("Impression", () => { expect(mod.parseSort({ sortBy: "Impression" })).toEqual({ field: "impression", order: "desc" }); });
  it("Popularity", () => { expect(mod.parseSort({ sortBy: "Popularity" })).toEqual({ field: "popularity", order: "desc" }); });
});

describe("services/tiktok/helpers/paramParser > parseSort — metric fallback", () => {
  it("array [min, max] for likes triggers metric sort", () => {
    expect(mod.parseSort({ likes: [10, 100] })).toEqual({ field: "likes", order: "desc" });
  });
  it("object { min } for shares triggers metric sort", () => {
    expect(mod.parseSort({ shares: { min: 5 } })).toEqual({ field: "shares", order: "desc" });
  });
  it("object { max } for comments triggers metric sort", () => {
    expect(mod.parseSort({ comments: { max: 50 } })).toEqual({ field: "comments", order: "desc" });
  });
  it("ctr / impression / popularity covered", () => {
    expect(mod.parseSort({ ctr: { min: 1 } })).toEqual({ field: "ctr", order: "desc" });
    expect(mod.parseSort({ impression: [1, 2] })).toEqual({ field: "impression", order: "desc" });
    expect(mod.parseSort({ popularity: { min: 1, max: 10 } })).toEqual({ field: "popularity", order: "desc" });
  });
  it("array with length != 2 is ignored (falls to default)", () => {
    expect(mod.parseSort({ likes: [10] })).toEqual({ field: "updatedAt", order: "desc" });
  });
  it("object with no min/max is ignored", () => {
    expect(mod.parseSort({ likes: { foo: "bar" } })).toEqual({ field: "updatedAt", order: "desc" });
  });
  it("object with empty-string min/max is ignored", () => {
    expect(mod.parseSort({ likes: { min: "", max: "" } })).toEqual({ field: "updatedAt", order: "desc" });
  });
  it("metric value is falsy (0, '', null) → skipped", () => {
    expect(mod.parseSort({ likes: 0, shares: null, comments: "" })).toEqual({ field: "updatedAt", order: "desc" });
  });
  it("ultimate fallback: no params → updatedAt/desc", () => {
    expect(mod.parseSort({})).toEqual({ field: "updatedAt", order: "desc" });
  });
});

describe("services/tiktok/helpers/paramParser > withCdn", () => {
  it("returns url unchanged when empty/missing", () => {
    expect(mod.cleanAdsData([{ id: 1, video_cover: "" }])[0].video_cover).toBe("");
  });
  it("returns http(s) URLs unchanged", () => {
    expect(mod.cleanAdsData([{ id: 1, video_cover: "https://example.com/x.mp4" }])[0].video_cover)
      .toBe("https://example.com/x.mp4");
  });
  it("strips PowerAdspy/n2 and PowerAdspy-Dev path prefix", () => {
    expect(mod.cleanAdsData([{ id: 1, video_cover: "PowerAdspy/n2/foo.mp4" }])[0].video_cover)
      .toBe("https://cdn.test/foo.mp4");
    expect(mod.cleanAdsData([{ id: 1, video_cover: "PowerAdspy-Dev/bar.mp4" }])[0].video_cover)
      .toBe("https://cdn.test/bar.mp4");
  });
  it("prefixes paths missing leading slash", () => {
    expect(mod.cleanAdsData([{ id: 1, video_cover: "raw/clip.mp4" }])[0].video_cover)
      .toBe("https://cdn.test/raw/clip.mp4");
  });
  it("paths with leading slash are concatenated as-is", () => {
    expect(mod.cleanAdsData([{ id: 1, video_cover: "/abs/clip.mp4" }])[0].video_cover)
      .toBe("https://cdn.test/abs/clip.mp4");
  });
  it("non-string video_cover passes through", () => {
    expect(mod.cleanAdsData([{ id: 1, video_cover: 42 }])[0].video_cover).toBe(42);
  });
  it("URL with '||' separator → first reachable URL after cleaning (lines 98-103)", () => {
    expect(mod.cleanAdsData([{ id: 1, video_cover: "PowerAdspy/n2/primary.mp4||PowerAdspy/n2/fallback.mp4" }])[0].video_cover)
      .toBe("https://cdn.test/primary.mp4");
  });
  it("URL with empty primary in '||' → falls back to second segment", () => {
    expect(mod.cleanAdsData([{ id: 1, video_cover: "||PowerAdspy/n2/second.mp4" }])[0].video_cover)
      .toBe("https://cdn.test/second.mp4");
  });
  it("URL with only '||' (both empty) → '' (cleaned[0] falsy fallback)", () => {
    expect(mod.cleanAdsData([{ id: 1, video_cover: "||" }])[0].video_cover).toBe("");
  });
});

describe("services/tiktok/helpers/paramParser > withCdn — empty CDN_BASE branch", () => {
  it("returns url unchanged when CDN_BASE is empty", () => {
    const configPath = require.resolve("../../../../src/config");
    require.cache[configPath] = {
      id: configPath, filename: configPath, loaded: true,
      exports: { cdn: { baseUrl: "" } },
    };
    const sutPath = require.resolve("../../../../src/services/tiktok/helpers/paramParser");
    delete require.cache[sutPath];
    const noCdn = require("../../../../src/services/tiktok/helpers/paramParser");
    expect(noCdn.cleanAdsData([{ id: 1, video_cover: "PowerAdspy/n2/x.mp4" }])[0].video_cover)
      .toBe("PowerAdspy/n2/x.mp4");
    expect(noCdn.CDN_BASE).toBe("");
  });

  it("CDN_BASE falls back to '' when config.cdn missing entirely", () => {
    const configPath = require.resolve("../../../../src/config");
    require.cache[configPath] = {
      id: configPath, filename: configPath, loaded: true,
      exports: {},
    };
    const sutPath = require.resolve("../../../../src/services/tiktok/helpers/paramParser");
    delete require.cache[sutPath];
    const noCdn = require("../../../../src/services/tiktok/helpers/paramParser");
    expect(noCdn.CDN_BASE).toBe("");
  });
});

describe("services/tiktok/helpers/paramParser > cleanAdsData", () => {
  it("drops ads missing both sql_id and id", () => {
    const out = mod.cleanAdsData([
      { foo: "bar" },                  // dropped
      { sql_id: 7, foo: "ok" },        // kept
      { id: 9 },                        // kept
      null,                             // dropped
    ]);
    expect(out).toHaveLength(2);
  });
  it("default ads=[] when called with no arg", () => {
    expect(mod.cleanAdsData()).toEqual([]);
  });
  it("parses JSON-shaped string values", () => {
    const out = mod.cleanAdsData([{ id: 1, meta: '{"a":1}', list: '[1,2,3]' }]);
    expect(out[0].meta).toEqual({ a: 1 });
    expect(out[0].list).toEqual([1, 2, 3]);
  });
  it("leaves malformed JSON-shaped strings as-is (catch swallows)", () => {
    const out = mod.cleanAdsData([{ id: 1, broken: "{not-json}" }]);
    expect(out[0].broken).toBe("{not-json}");
  });
  it("converts CTR ratio (0–1) to percentage", () => {
    const out = mod.cleanAdsData([{ id: 1, ctr: 0.1234 }]);
    expect(out[0].ctr).toBe(12.34);
  });
  it("non-numeric CTR passes through", () => {
    const out = mod.cleanAdsData([{ id: 1, ctr: "high" }]);
    expect(out[0].ctr).toBe("high");
  });
  it("missing CTR not added", () => {
    const out = mod.cleanAdsData([{ id: 1 }]);
    expect("ctr" in out[0]).toBe(false);
  });
});

describe("services/tiktok/helpers/paramParser > CDN_BASE module export", () => {
  it("exports the resolved CDN_BASE (with trailing slash stripped)", () => {
    expect(mod.CDN_BASE).toBe("https://cdn.test");
  });
});
