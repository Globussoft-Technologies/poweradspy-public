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
  const sutPath = require.resolve("../../../../src/services/native/helpers/paramParser");
  delete require.cache[sutPath];
  mod = require("../../../../src/services/native/helpers/paramParser");
});

describe("services/native/helpers/paramParser > normalizeValue/normalizeParams/ensureArray", () => {
  it("normalizeValue", () => {
    expect(mod.normalizeValue("NA")).toBe("");
    expect(mod.normalizeValue(null)).toBe("");
    expect(mod.normalizeValue(undefined)).toBe("");
    expect(mod.normalizeValue(" x ")).toBe("x");
    expect(mod.normalizeValue(42)).toBe(42);
  });
  it("normalizeParams", () => {
    expect(mod.normalizeParams(null)).toEqual({});
    expect(mod.normalizeParams("s")).toEqual({});
    expect(mod.normalizeParams({ a: "NA", b: " x " })).toEqual({ a: "", b: "x" });
  });
  it("ensureArray", () => {
    expect(mod.ensureArray([1])).toEqual([1]);
    expect(mod.ensureArray("")).toEqual([]);
    expect(mod.ensureArray(null)).toEqual([]);
    expect(mod.ensureArray(undefined)).toEqual([]);
    expect(mod.ensureArray("x")).toEqual(["x"]);
  });
});

describe("services/native/helpers/paramParser > parsePagination", () => {
  it("take > page_size, default 20", () => {
    expect(mod.parsePagination({ take: "10", page_size: "30" })).toEqual({ size: 10, from: 0 });
    expect(mod.parsePagination({ page_size: "30" })).toEqual({ size: 30, from: 0 });
    expect(mod.parsePagination({})).toEqual({ size: 20, from: 0 });
  });
  it("skip > page, take * page", () => {
    expect(mod.parsePagination({ take: "10", skip: "3" })).toEqual({ size: 10, from: 30 });
    expect(mod.parsePagination({ take: "10", page: "2" })).toEqual({ size: 10, from: 20 });
  });
});

describe("services/native/helpers/paramParser > parseSort", () => {
  it("sortMap entries (incl. asc/non-string)", () => {
    expect(mod.parseSort({ newest_sort: "desc" })).toEqual({ field: "native_ad.id", order: "desc" });
    expect(mod.parseSort({ running_longest_sort: "asc" })).toEqual({ field: "native_ad.days_running", order: "asc" });
    expect(mod.parseSort({ last_seen_sort: "desc" })).toEqual({ field: "native_ad.last_seen", order: "desc" });
    expect(mod.parseSort({ likes_sort: "ASC" })).toEqual({ field: "native_ad.likes", order: "asc" });
    expect(mod.parseSort({ comments_sort: "desc" })).toEqual({ field: "native_ad.comments", order: "desc" });
    expect(mod.parseSort({ domain_sort: "desc" })).toEqual({ field: "native_ad_domains.domain_registered_date", order: "desc" });
    expect(mod.parseSort({ newest_sort: 1 })).toEqual({ field: "native_ad.last_seen", order: "desc" });
  });
  it("seen_btn_sort array → last_seen desc", () => {
    expect(mod.parseSort({ seen_btn_sort: [1] })).toEqual({ field: "native_ad.last_seen", order: "desc" });
  });
  it("seen_btn_sort non-array ignored", () => {
    expect(mod.parseSort({ seen_btn_sort: "x" })).toEqual({ field: "native_ad.last_seen", order: "desc" });
  });
  it.each([
    ["post_date",   "native_ad.post_date"],
    ["last_seen",   "native_ad.last_seen"],
    ["likes",       "native_ad.likes"],
    ["comments",    "native_ad.comments"],
    ["domain_date", "native_ad_domains.domain_registered_date"],
  ])("order_column %s → %s", (oc, field) => {
    expect(mod.parseSort({ order_column: oc })).toEqual({ field, order: "desc" });
  });
  it("order_column asc respected", () => {
    expect(mod.parseSort({ order_column: "likes", order_by: "asc" })).toEqual({ field: "native_ad.likes", order: "asc" });
  });
  it("unknown order_column → default", () => {
    expect(mod.parseSort({ order_column: "weird" })).toEqual({ field: "native_ad.last_seen", order: "desc" });
  });
});

describe("services/native/helpers/paramParser > cleanAdsData", () => {
  function ad(post_owner_image) { return { id: 1, post_owner_image }; }
  it("filters by id, ad_id, or 'native_ad.id'", () => {
    const out = mod.cleanAdsData([
      null, {}, { id: 1 }, { ad_id: 2 }, { "native_ad.id": 3 },
    ]);
    expect(out).toHaveLength(3);
  });
  it("default arg → []", () => { expect(mod.cleanAdsData()).toEqual([]); });
  it("parses JSON-shape strings; malformed kept; plain untouched", () => {
    const out = mod.cleanAdsData([{ id: 1, m: '{"a":1}', l: '[1]', b: "{nope}", p: "plain" }]);
    expect(out[0].m).toEqual({ a: 1 });
    expect(out[0].l).toEqual([1]);
    expect(out[0].b).toBe("{nope}");
    expect(out[0].p).toBe("plain");
  });
  it("withCdn: empty/http unchanged", () => {
    expect(mod.cleanAdsData([ad("")])[0].post_owner_image).toBe("");
    expect(mod.cleanAdsData([ad("https://x.com/p.png")])[0].post_owner_image).toBe("https://x.com/p.png");
  });
  it("withCdn: strips PowerAdspy prefixes + paths", () => {
    expect(mod.cleanAdsData([ad("PowerAdspy/n2/x.png")])[0].post_owner_image).toBe("https://cdn.test/x.png");
    expect(mod.cleanAdsData([ad("PowerAdspy-Dev/y.png")])[0].post_owner_image).toBe("https://cdn.test/y.png");
    expect(mod.cleanAdsData([ad("raw/x.png")])[0].post_owner_image).toBe("https://cdn.test/raw/x.png");
    expect(mod.cleanAdsData([ad("/abs/x.png")])[0].post_owner_image).toBe("https://cdn.test/abs/x.png");
  });
  it("withCdn: non-string passes through", () => {
    expect(mod.cleanAdsData([ad(42)])[0].post_owner_image).toBe(42);
  });
  it("image_video_url CDN-prefixed", () => {
    expect(mod.cleanAdsData([{ id: 1, image_video_url: "raw/v.mp4" }])[0].image_video_url).toBe("https://cdn.test/raw/v.mp4");
  });
  it("URL with '||' separator → first reachable URL after cleaning (lines 97-101)", () => {
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

describe("services/native/helpers/paramParser > empty CDN_BASE", () => {
  it("CDN_BASE='' → url unchanged", () => {
    require.cache[configPath] = {
      id: configPath, filename: configPath, loaded: true,
      exports: { cdn: { baseUrl: "" } },
    };
    const sutPath = require.resolve("../../../../src/services/native/helpers/paramParser");
    delete require.cache[sutPath];
    const noCdn = require("../../../../src/services/native/helpers/paramParser");
    expect(noCdn.cleanAdsData([{ id: 1, post_owner_image: "raw/x.png" }])[0].post_owner_image).toBe("raw/x.png");
  });
  it("config.cdn missing → CDN_BASE='' fallback", () => {
    require.cache[configPath] = {
      id: configPath, filename: configPath, loaded: true,
      exports: {},
    };
    const sutPath = require.resolve("../../../../src/services/native/helpers/paramParser");
    delete require.cache[sutPath];
    const noCdn = require("../../../../src/services/native/helpers/paramParser");
    expect(noCdn.CDN_BASE).toBe("");
  });
});
