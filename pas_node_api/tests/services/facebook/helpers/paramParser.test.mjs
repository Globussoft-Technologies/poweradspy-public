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
  const sutPath = require.resolve("../../../../src/services/facebook/helpers/paramParser");
  delete require.cache[sutPath];
  mod = require("../../../../src/services/facebook/helpers/paramParser");
});

describe("services/facebook/helpers/paramParser > normalizeValue/normalizeParams/ensureArray", () => {
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

describe("services/facebook/helpers/paramParser > parsePagination", () => {
  it("take > page_size, default 20; skip > page", () => {
    expect(mod.parsePagination({ take: "10", page_size: "30" })).toEqual({ size: 10, from: 0 });
    expect(mod.parsePagination({ page_size: "30" })).toEqual({ size: 30, from: 0 });
    expect(mod.parsePagination({})).toEqual({ size: 20, from: 0 });
    expect(mod.parsePagination({ take: "10", skip: "3" })).toEqual({ size: 10, from: 30 });
    expect(mod.parsePagination({ take: "10", page: "2" })).toEqual({ size: 10, from: 20 });
  });
});

describe("services/facebook/helpers/paramParser > parseSort", () => {
  it("sortMap entries", () => {
    expect(mod.parseSort({ newest_sort: "desc" })).toEqual({ field: "facebook_ad.last_seen", order: "desc" });
    expect(mod.parseSort({ running_longest_sort: "asc" })).toEqual({ field: "facebook_ad.days_running", order: "asc" });
    expect(mod.parseSort({ last_seen_sort: "desc" })).toEqual({ field: "facebook_ad.last_seen", order: "desc" });
    expect(mod.parseSort({ likes_sort: "desc" })).toEqual({ field: "facebook_ad.likes", order: "desc" });
    expect(mod.parseSort({ impression_sort: "DESC" })).toEqual({ field: "facebook_ad.impression", order: "desc" });
    expect(mod.parseSort({ popularity_sort: "ASC" })).toEqual({ field: "facebook_ad.popularity.current", order: "asc" });
    expect(mod.parseSort({ adBudget_sort: "desc" })).toEqual({ field: "facebook.averagebudget", order: "desc" });
    expect(mod.parseSort({ comments_sort: "desc" })).toEqual({ field: "facebook_ad.comments", order: "desc" });
    expect(mod.parseSort({ shares_sort: "desc" })).toEqual({ field: "facebook_ad.shares", order: "desc" });
    expect(mod.parseSort({ domain_sort: "desc" })).toEqual({ field: "facebook_ad_domains.domain_registered_date", order: "desc" });
  });
  it("non-string sort skipped", () => {
    expect(mod.parseSort({ newest_sort: 1 })).toEqual({ field: "facebook_ad.last_seen", order: "desc" });
  });
  it.each([
    ["post_date",  "facebook_ad.post_date"],
    ["last_seen",  "facebook_ad.last_seen"],
    ["likes",      "facebook_ad.likes"],
    ["comments",   "facebook_ad.comments"],
    ["shares",     "facebook_ad.shares"],
    ["impression", "facebook_ad.impression"],
    ["popularity", "facebook_ad.popularity.current"],
  ])("order_column %s → %s", (oc, field) => {
    expect(mod.parseSort({ order_column: oc })).toEqual({ field, order: "desc" });
  });
  it("order_column asc respected", () => {
    expect(mod.parseSort({ order_column: "likes", order_by: "asc" })).toEqual({ field: "facebook_ad.likes", order: "asc" });
  });
  it("unknown order_column → default", () => {
    expect(mod.parseSort({ order_column: "weird" })).toEqual({ field: "facebook_ad.last_seen", order: "desc" });
  });
});

describe("services/facebook/helpers/paramParser > cleanAdsData (incl. withCdn)", () => {
  function ad(extra) { return { id: 1, ad_id: 2, ...extra }; }
  it("drops invalid ads + default arg", () => {
    expect(mod.cleanAdsData([null, {}, { id: 1 }, { ad_id: 1 }, { id: 1, ad_id: 2 }])).toHaveLength(1);
    expect(mod.cleanAdsData()).toEqual([]);
  });
  it("parses JSON-shape strings; malformed kept; plain untouched", () => {
    const out = mod.cleanAdsData([ad({ m: '{"a":1}', l: '[1]', b: "{nope}", p: "plain" })]);
    expect(out[0].m).toEqual({ a: 1 });
    expect(out[0].l).toEqual([1]);
    expect(out[0].b).toBe("{nope}");
    expect(out[0].p).toBe("plain");
  });
  it("withCdn: empty/http unchanged", () => {
    expect(mod.cleanAdsData([ad({ post_owner_image: "" })])[0].post_owner_image).toBe("");
    expect(mod.cleanAdsData([ad({ post_owner_image: "https://x.com/p.png" })])[0].post_owner_image).toBe("https://x.com/p.png");
  });
  it("withCdn: strips PowerAdspy prefixes; paths missing/with leading slash", () => {
    expect(mod.cleanAdsData([ad({ post_owner_image: "PowerAdspy/n2/x.png" })])[0].post_owner_image).toBe("https://cdn.test/x.png");
    expect(mod.cleanAdsData([ad({ post_owner_image: "PowerAdspy-Dev/y.png" })])[0].post_owner_image).toBe("https://cdn.test/y.png");
    expect(mod.cleanAdsData([ad({ post_owner_image: "raw/x.png" })])[0].post_owner_image).toBe("https://cdn.test/raw/x.png");
    expect(mod.cleanAdsData([ad({ post_owner_image: "/abs/x.png" })])[0].post_owner_image).toBe("https://cdn.test/abs/x.png");
  });
  it("withCdn: non-string passes through", () => {
    expect(mod.cleanAdsData([ad({ post_owner_image: 42 })])[0].post_owner_image).toBe(42);
  });
  it("image_video_url CDN-prefixed", () => {
    expect(mod.cleanAdsData([ad({ image_video_url: "raw/v.mp4" })])[0].image_video_url).toBe("https://cdn.test/raw/v.mp4");
  });
  it("ad_image_video array mapped", () => {
    expect(mod.cleanAdsData([ad({ ad_image_video: ["a.png", "PowerAdspy/n2/b.png"] })])[0].ad_image_video)
      .toEqual(["https://cdn.test/a.png", "https://cdn.test/b.png"]);
  });
  it("ad_image_video string CDN-prefixed", () => {
    expect(mod.cleanAdsData([ad({ ad_image_video: "s.png" })])[0].ad_image_video).toBe("https://cdn.test/s.png");
  });
  it("ad_image_video empty string stays empty (else-if guard)", () => {
    expect(mod.cleanAdsData([ad({ ad_image_video: "" })])[0].ad_image_video).toBe("");
  });
  it("ad_image_video null ignored", () => {
    expect(mod.cleanAdsData([ad({ ad_image_video: null })])[0].ad_image_video).toBe(null);
  });
  it("URL with '||' separator → first reachable URL after cleaning (lines 119-125)", () => {
    expect(mod.cleanAdsData([ad({ post_owner_image: "PowerAdspy/n2/primary.png||PowerAdspy/n2/fallback.png" })])[0].post_owner_image)
      .toBe("https://cdn.test/primary.png");
  });
  it("URL with empty primary in '||' → falls back to second segment", () => {
    expect(mod.cleanAdsData([ad({ post_owner_image: "||PowerAdspy/n2/second.png" })])[0].post_owner_image)
      .toBe("https://cdn.test/second.png");
  });
  it("URL with only '||' (both empty) → '' (cleaned[0] falsy fallback)", () => {
    expect(mod.cleanAdsData([ad({ post_owner_image: "||" })])[0].post_owner_image).toBe("");
  });
});

describe("services/facebook/helpers/paramParser > empty CDN_BASE", () => {
  it("CDN_BASE='' → url unchanged", () => {
    require.cache[configPath] = {
      id: configPath, filename: configPath, loaded: true,
      exports: { cdn: { baseUrl: "" } },
    };
    const sutPath = require.resolve("../../../../src/services/facebook/helpers/paramParser");
    delete require.cache[sutPath];
    const noCdn = require("../../../../src/services/facebook/helpers/paramParser");
    expect(noCdn.cleanAdsData([{ id: 1, ad_id: 2, post_owner_image: "raw/x.png" }])[0].post_owner_image).toBe("raw/x.png");
  });
  it("config.cdn missing → fallback", () => {
    require.cache[configPath] = {
      id: configPath, filename: configPath, loaded: true,
      exports: {},
    };
    const sutPath = require.resolve("../../../../src/services/facebook/helpers/paramParser");
    delete require.cache[sutPath];
    const noCdn = require("../../../../src/services/facebook/helpers/paramParser");
    expect(noCdn.cleanAdsData([{ id: 1, ad_id: 2, post_owner_image: "raw/x.png" }])[0].post_owner_image).toBe("raw/x.png");
  });
});
