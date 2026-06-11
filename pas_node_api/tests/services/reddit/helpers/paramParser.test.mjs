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
  const sutPath = require.resolve("../../../../src/services/reddit/helpers/paramParser");
  delete require.cache[sutPath];
  mod = require("../../../../src/services/reddit/helpers/paramParser");
});

describe("services/reddit/helpers/paramParser > normalizeValue", () => {
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
  });
});

describe("services/reddit/helpers/paramParser > normalizeParams", () => {
  it("falsy/non-object → {}", () => {
    expect(mod.normalizeParams(null)).toEqual({});
    expect(mod.normalizeParams(undefined)).toEqual({});
    expect(mod.normalizeParams("string")).toEqual({});
  });
  it("normalizes each value in the body", () => {
    expect(mod.normalizeParams({ a: "NA", b: " x ", c: 5 })).toEqual({ a: "", b: "x", c: 5 });
  });
});

describe("services/reddit/helpers/paramParser > ensureArray", () => {
  it("array → same array", () => {
    expect(mod.ensureArray([1, 2])).toEqual([1, 2]);
  });
  it("empty/null/undefined → []", () => {
    expect(mod.ensureArray("")).toEqual([]);
    expect(mod.ensureArray(null)).toEqual([]);
    expect(mod.ensureArray(undefined)).toEqual([]);
  });
  it("scalar → wrapped in array", () => {
    expect(mod.ensureArray("a")).toEqual(["a"]);
    expect(mod.ensureArray(42)).toEqual([42]);
  });
});

describe("services/reddit/helpers/paramParser > parsePagination", () => {
  it("default: take=20, page=0 → size 20, from 0", () => {
    expect(mod.parsePagination({})).toEqual({ size: 20, from: 0 });
  });
  it("take + skip", () => {
    expect(mod.parsePagination({ take: 10, skip: 3 })).toEqual({ size: 10, from: 30 });
  });
  it("page_size + page fallback", () => {
    expect(mod.parsePagination({ page_size: 5, page: 4 })).toEqual({ size: 5, from: 20 });
  });
});

describe("services/reddit/helpers/paramParser > parseSort", () => {
  it("falls back to last_seen DESC when no sort params", () => {
    expect(mod.parseSort({})).toEqual({ field: "reddit_ad.last_seen", order: "desc" });
  });

  it("sortMap entry: likes_sort 'asc' → likes asc", () => {
    expect(mod.parseSort({ likes_sort: "asc" })).toEqual({ field: "reddit_ad.likes", order: "asc" });
  });

  it("sortMap entry: newest_sort 'desc' (any other string)", () => {
    expect(mod.parseSort({ newest_sort: "desc" })).toEqual({ field: "reddit_ad.id", order: "desc" });
  });

  it("seen_btn_sort array → last_seen DESC", () => {
    expect(mod.parseSort({ seen_btn_sort: ["x"] })).toEqual({ field: "reddit_ad.last_seen", order: "desc" });
  });

  it("order_column 'likes' + order_by 'asc' → mapped", () => {
    expect(mod.parseSort({ order_column: "likes", order_by: "asc" })).toEqual({ field: "reddit_ad.likes", order: "asc" });
  });

  it("order_column 'post_date' defaults to DESC when order_by missing", () => {
    expect(mod.parseSort({ order_column: "post_date" })).toEqual({ field: "reddit_ad.post_date", order: "desc" });
  });

  it("order_column unknown → falls through to default last_seen DESC", () => {
    expect(mod.parseSort({ order_column: "bogus" })).toEqual({ field: "reddit_ad.last_seen", order: "desc" });
  });
});

describe("services/reddit/helpers/paramParser > withCdn (via cleanAdsData)", () => {
  it("returns input unchanged for falsy/non-string URLs", () => {
    // Exercise via cleanAdsData: ad with non-string image (e.g. number) passes through
    const out = mod.cleanAdsData([{ id: 1, ad_id: 1, image_video_url: 0 }]);
    expect(out[0].image_video_url).toBe(0);
  });

  it("strips PowerAdspy/n2 prefix and prepends CDN_BASE", () => {
    const out = mod.cleanAdsData([{ id: 1, ad_id: 1, image_video_url: "PowerAdspy/n2/x.png" }]);
    expect(out[0].image_video_url).toBe("https://cdn.test/x.png");
  });

  it("strips /PowerAdspy-Dev/ prefix and prepends CDN_BASE", () => {
    const out = mod.cleanAdsData([{ id: 1, ad_id: 1, image_video_url: "/PowerAdspy-Dev/y.png" }]);
    expect(out[0].image_video_url).toBe("https://cdn.test/y.png");
  });

  it("absolute http(s) URL passed through unchanged", () => {
    const out = mod.cleanAdsData([{ id: 1, ad_id: 1, image_video_url: "http://other/img" }]);
    expect(out[0].image_video_url).toBe("http://other/img");
  });

  it("URL without leading slash + no PowerAdspy prefix → gets '/' prepended (line 79 ternary false)", () => {
    const out = mod.cleanAdsData([{ id: 1, ad_id: 1, image_video_url: "plain.png" }]);
    expect(out[0].image_video_url).toBe("https://cdn.test/plain.png");
  });

  it("non-string truthy entry inside ad_image_video array → withCdn returns input (line 75 true)", () => {
    const obj = { not: "string" };
    const out = mod.cleanAdsData([{ id: 1, ad_id: 1, ad_image_video: [obj, "PowerAdspy/n2/y.png"] }]);
    expect(out[0].ad_image_video[0]).toBe(obj);
    expect(out[0].ad_image_video[1]).toBe("https://cdn.test/y.png");
  });

  it("falsy entries in ad_image_video array → withCdn early returns (line 74 true)", () => {
    const out = mod.cleanAdsData([{ id: 1, ad_id: 1, ad_image_video: [null, "", "PowerAdspy/n2/z.png"] }]);
    expect(out[0].ad_image_video[0]).toBeNull();
    expect(out[0].ad_image_video[1]).toBe("");
    expect(out[0].ad_image_video[2]).toBe("https://cdn.test/z.png");
  });

  it("URL with '||' separator → splits, cleans each, returns the first reachable URL (lines 83-88)", () => {
    const out = mod.cleanAdsData([{ id: 1, ad_id: 1, image_video_url: "PowerAdspy/n2/primary.png||PowerAdspy/n2/fallback.png" }]);
    expect(out[0].image_video_url).toBe("https://cdn.test/primary.png");
  });

  it("URL with '||' separator where first segment is empty → returns the second segment (lines 83-88, cleaned[0] || '')", () => {
    const out = mod.cleanAdsData([{ id: 1, ad_id: 1, image_video_url: "||PowerAdspy/n2/second.png" }]);
    expect(out[0].image_video_url).toBe("https://cdn.test/second.png");
  });

  it("URL with only '||' (both segments empty) → returns '' (lines 83-88, cleaned[0] falsy fallback)", () => {
    const out = mod.cleanAdsData([{ id: 1, ad_id: 1, image_video_url: "||" }]);
    expect(out[0].image_video_url).toBe("");
  });
});

describe("services/reddit/helpers/paramParser > cleanAdsData", () => {
  it("filters out items missing id or ad_id", () => {
    expect(mod.cleanAdsData([{ id: 1 }, { ad_id: 2 }, { id: 1, ad_id: 2 }])).toHaveLength(1);
  });

  it("parses JSON-shaped strings (object + array)", () => {
    const ads = [
      { id: 1, ad_id: 1, raw_obj: '{"a":1}', raw_arr: "[1,2,3]", non_json: "just text" },
    ];
    const out = mod.cleanAdsData(ads);
    expect(out[0].raw_obj).toEqual({ a: 1 });
    expect(out[0].raw_arr).toEqual([1, 2, 3]);
    expect(out[0].non_json).toBe("just text");
  });

  it("malformed JSON string is kept as-is (catch swallows)", () => {
    const out = mod.cleanAdsData([{ id: 1, ad_id: 1, raw_obj: "{bad json}" }]);
    expect(out[0].raw_obj).toBe("{bad json}");
  });

  it("post_owner_image gets CDN-prefixed", () => {
    const out = mod.cleanAdsData([{ id: 1, ad_id: 1, post_owner_image: "PowerAdspy/n2/o.png" }]);
    expect(out[0].post_owner_image).toBe("https://cdn.test/o.png");
  });

  it("ad_image_video array → all items CDN-prefixed via map", () => {
    const out = mod.cleanAdsData([{ id: 1, ad_id: 1, ad_image_video: ["PowerAdspy/n2/a.png", "PowerAdspy/n2/b.png"] }]);
    expect(out[0].ad_image_video).toEqual(["https://cdn.test/a.png", "https://cdn.test/b.png"]);
  });

  it("ad_image_video string → CDN-prefixed", () => {
    const out = mod.cleanAdsData([{ id: 1, ad_id: 1, ad_image_video: "PowerAdspy/n2/c.png" }]);
    expect(out[0].ad_image_video).toBe("https://cdn.test/c.png");
  });

  it("default arg empty array → []", () => {
    expect(mod.cleanAdsData()).toEqual([]);
  });
});

describe("services/reddit/helpers/paramParser > CDN_BASE", () => {
  it("trailing slash stripped", () => {
    expect(mod.CDN_BASE).toBe("https://cdn.test");
  });

  it("no config.cdn → empty string fallback", () => {
    require.cache[configPath].exports = {}; // remove cdn
    const sutPath = require.resolve("../../../../src/services/reddit/helpers/paramParser");
    delete require.cache[sutPath];
    const fresh = require("../../../../src/services/reddit/helpers/paramParser");
    expect(fresh.CDN_BASE).toBe("");
    // Restore
    require.cache[configPath].exports = { cdn: { baseUrl: "https://cdn.test/" } };
  });
});
