import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const configPath = require.resolve("../../../../src/config");

let mod;
beforeEach(() => {
  require.cache[configPath] = {
    id: configPath, filename: configPath, loaded: true,
    exports: { cdn: { baseUrl: "https://cdn.test/" } },
  };
  const sutPath = require.resolve("../../../../src/services/pinterest/helpers/paramParser");
  delete require.cache[sutPath];
  mod = require("../../../../src/services/pinterest/helpers/paramParser");
});

describe("services/pinterest/helpers/paramParser > normalizeValue", () => {
  it("'NA'/null/undefined → ''", () => {
    expect(mod.normalizeValue("NA")).toBe("");
    expect(mod.normalizeValue(null)).toBe("");
    expect(mod.normalizeValue(undefined)).toBe("");
  });
  it("trims strings", () => {
    expect(mod.normalizeValue("  x  ")).toBe("x");
  });
  it("non-string passes through", () => {
    expect(mod.normalizeValue(42)).toBe(42);
    expect(mod.normalizeValue([1])).toEqual([1]);
  });
});

describe("services/pinterest/helpers/paramParser > normalizeParams", () => {
  it("falsy/non-object → {}", () => {
    expect(mod.normalizeParams(null)).toEqual({});
    expect(mod.normalizeParams("s")).toEqual({});
  });
  it("normalizes each value", () => {
    expect(mod.normalizeParams({ a: "NA", b: " x " })).toEqual({ a: "", b: "x" });
  });
});

describe("services/pinterest/helpers/paramParser > ensureArray", () => {
  it("array unchanged", () => { expect(mod.ensureArray([1])).toEqual([1]); });
  it("empty values → []", () => {
    expect(mod.ensureArray("")).toEqual([]);
    expect(mod.ensureArray(null)).toEqual([]);
    expect(mod.ensureArray(undefined)).toEqual([]);
  });
  it("scalar wrapped", () => { expect(mod.ensureArray("x")).toEqual(["x"]); });
});

describe("services/pinterest/helpers/paramParser > parsePagination", () => {
  it("take > page_size, default 20", () => {
    expect(mod.parsePagination({ take: "10", page_size: "30" })).toEqual({ size: 10, from: 0 });
    expect(mod.parsePagination({ page_size: "30" })).toEqual({ size: 30, from: 0 });
    expect(mod.parsePagination({})).toEqual({ size: 20, from: 0 });
  });
  it("skip > page, multiplied by take", () => {
    expect(mod.parsePagination({ take: "10", skip: "3" })).toEqual({ size: 10, from: 30 });
    expect(mod.parsePagination({ take: "10", page: "2" })).toEqual({ size: 10, from: 20 });
  });
});

describe("services/pinterest/helpers/paramParser > parseSort — sortMap", () => {
  it("newest_sort → last_seen", () => {
    expect(mod.parseSort({ newest_sort: "desc" })).toEqual({ field: "pinterest_ad.last_seen", order: "desc" });
  });
  it("running_longest_sort → days_running asc", () => {
    expect(mod.parseSort({ running_longest_sort: "asc" })).toEqual({ field: "pinterest_ad.days_running", order: "asc" });
  });
  it("last_seen_sort → last_seen", () => {
    expect(mod.parseSort({ last_seen_sort: "desc" })).toEqual({ field: "pinterest_ad.last_seen", order: "desc" });
  });
  it("domain_sort → domain_registered_date", () => {
    expect(mod.parseSort({ domain_sort: "desc" })).toEqual({ field: "pinterest_ad_domains.domain_registered_date", order: "desc" });
  });
  it("ASC uppercase normalized", () => {
    expect(mod.parseSort({ newest_sort: "ASC" })).toEqual({ field: "pinterest_ad.last_seen", order: "asc" });
  });
  it("non-string sort skipped", () => {
    expect(mod.parseSort({ newest_sort: 1 })).toEqual({ field: "pinterest_ad.last_seen", order: "desc" });
  });
});

describe("services/pinterest/helpers/paramParser > parseSort — seen_btn_sort + order_column", () => {
  it("seen_btn_sort array → last_seen desc", () => {
    expect(mod.parseSort({ seen_btn_sort: [1, 2] })).toEqual({ field: "pinterest_ad.last_seen", order: "desc" });
  });
  it("seen_btn_sort non-array ignored", () => {
    expect(mod.parseSort({ seen_btn_sort: "x" })).toEqual({ field: "pinterest_ad.last_seen", order: "desc" });
  });
  it("order_column post_date asc", () => {
    expect(mod.parseSort({ order_column: "post_date", order_by: "asc" })).toEqual({ field: "pinterest_ad.post_date", order: "asc" });
  });
  it("order_column last_seen default desc", () => {
    expect(mod.parseSort({ order_column: "last_seen" })).toEqual({ field: "pinterest_ad.last_seen", order: "desc" });
  });
  it("order_column domain_date", () => {
    expect(mod.parseSort({ order_column: "domain_date" })).toEqual({ field: "pinterest_ad_domains.domain_registered_date", order: "desc" });
  });
  it("unknown order_column → default", () => {
    expect(mod.parseSort({ order_column: "weird" })).toEqual({ field: "pinterest_ad.last_seen", order: "desc" });
  });
});

describe("services/pinterest/helpers/paramParser > withCdn (via cleanAdsData)", () => {
  function ad(post_owner_image) { return { id: 1, ad_id: 2, post_owner_image }; }
  it("empty url passes through", () => {
    expect(mod.cleanAdsData([ad("")])[0].post_owner_image).toBe("");
  });
  it("http url unchanged", () => {
    expect(mod.cleanAdsData([ad("https://x.com/p.png")])[0].post_owner_image).toBe("https://x.com/p.png");
  });
  it("strips PowerAdspy prefixes", () => {
    expect(mod.cleanAdsData([ad("PowerAdspy/n2/x.png")])[0].post_owner_image).toBe("https://cdn.test/x.png");
    expect(mod.cleanAdsData([ad("PowerAdspy-Dev/y.png")])[0].post_owner_image).toBe("https://cdn.test/y.png");
  });
  it("paths missing leading slash get prefixed", () => {
    expect(mod.cleanAdsData([ad("raw/x.png")])[0].post_owner_image).toBe("https://cdn.test/raw/x.png");
  });
  it("paths with leading slash kept", () => {
    expect(mod.cleanAdsData([ad("/abs/x.png")])[0].post_owner_image).toBe("https://cdn.test/abs/x.png");
  });
  it("non-string passes through", () => {
    expect(mod.cleanAdsData([ad(42)])[0].post_owner_image).toBe(42);
  });
  it("image_video_url also goes through withCdn", () => {
    expect(mod.cleanAdsData([{ id: 1, ad_id: 2, image_video_url: "raw/v.mp4" }])[0].image_video_url).toBe("https://cdn.test/raw/v.mp4");
  });
  it("URL with '||' separator → first reachable URL after cleaning (lines 64-68)", () => {
    expect(mod.cleanAdsData([ad("PowerAdspy/n2/primary.png||PowerAdspy/n2/fallback.png")])[0].post_owner_image)
      .toBe("https://cdn.test/primary.png");
  });
  it("URL with empty primary in '||' → falls back to second segment", () => {
    expect(mod.cleanAdsData([ad("||PowerAdspy/n2/second.png")])[0].post_owner_image)
      .toBe("https://cdn.test/second.png");
  });
  it("URL with only '||' (both empty) → '' (cleaned[0] falsy fallback)", () => {
    expect(mod.cleanAdsData([ad("||")])[0].post_owner_image).toBe("");
  });
});

describe("services/pinterest/helpers/paramParser > empty CDN_BASE branches", () => {
  it("CDN_BASE empty → url unchanged", () => {
    require.cache[configPath] = {
      id: configPath, filename: configPath, loaded: true,
      exports: { cdn: { baseUrl: "" } },
    };
    const sutPath = require.resolve("../../../../src/services/pinterest/helpers/paramParser");
    delete require.cache[sutPath];
    const noCdn = require("../../../../src/services/pinterest/helpers/paramParser");
    expect(noCdn.cleanAdsData([{ id: 1, ad_id: 2, post_owner_image: "raw/x.png" }])[0].post_owner_image).toBe("raw/x.png");
  });
  it("config.cdn missing → CDN_BASE='' fallback", () => {
    require.cache[configPath] = {
      id: configPath, filename: configPath, loaded: true,
      exports: {},
    };
    const sutPath = require.resolve("../../../../src/services/pinterest/helpers/paramParser");
    delete require.cache[sutPath];
    const noCdn = require("../../../../src/services/pinterest/helpers/paramParser");
    expect(noCdn.CDN_BASE).toBe("");
  });
});

describe("services/pinterest/helpers/paramParser > cleanAdsData", () => {
  it("drops ads missing id or ad_id or null", () => {
    const out = mod.cleanAdsData([null, {}, { id: 1 }, { ad_id: 1 }, { id: 1, ad_id: 2 }]);
    expect(out).toHaveLength(1);
  });
  it("default arg → []", () => { expect(mod.cleanAdsData()).toEqual([]); });
  it("parses JSON-shape strings", () => {
    const out = mod.cleanAdsData([{ id: 1, ad_id: 2, m: '{"a":1}', l: '[1]' }]);
    expect(out[0].m).toEqual({ a: 1 });
    expect(out[0].l).toEqual([1]);
  });
  it("malformed JSON kept as string", () => {
    const out = mod.cleanAdsData([{ id: 1, ad_id: 2, b: "{not-json}" }]);
    expect(out[0].b).toBe("{not-json}");
  });
  it("non-JSON strings untouched", () => {
    const out = mod.cleanAdsData([{ id: 1, ad_id: 2, p: "plain" }]);
    expect(out[0].p).toBe("plain");
  });
});
