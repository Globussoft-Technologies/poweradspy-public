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
  const sutPath = require.resolve("../../../../src/services/google/helpers/paramParser");
  delete require.cache[sutPath];
  mod = require("../../../../src/services/google/helpers/paramParser");
});

describe("services/google/helpers/paramParser > normalizeValue", () => {
  it("'NA'/null/undefined → ''", () => {
    expect(mod.normalizeValue("NA")).toBe("");
    expect(mod.normalizeValue(null)).toBe("");
    expect(mod.normalizeValue(undefined)).toBe("");
  });
  it("trims strings; non-string unchanged", () => {
    expect(mod.normalizeValue(" x ")).toBe("x");
    expect(mod.normalizeValue(42)).toBe(42);
  });
});

describe("services/google/helpers/paramParser > normalizeParams + ensureArray", () => {
  it("falsy/non-object → {}", () => {
    expect(mod.normalizeParams(null)).toEqual({});
    expect(mod.normalizeParams("s")).toEqual({});
  });
  it("normalizes each value", () => {
    expect(mod.normalizeParams({ a: "NA", b: " x " })).toEqual({ a: "", b: "x" });
  });
  it("ensureArray: array unchanged / empty → [] / scalar wrapped", () => {
    expect(mod.ensureArray([1])).toEqual([1]);
    expect(mod.ensureArray("")).toEqual([]);
    expect(mod.ensureArray(null)).toEqual([]);
    expect(mod.ensureArray(undefined)).toEqual([]);
    expect(mod.ensureArray("x")).toEqual(["x"]);
  });
});

describe("services/google/helpers/paramParser > parsePagination", () => {
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

describe("services/google/helpers/paramParser > parseSort", () => {
  it("sortMap entries fire (incl. asc normalization)", () => {
    expect(mod.parseSort({ newest_sort: "desc" })).toEqual({ field: "id", order: "desc" });
    expect(mod.parseSort({ running_longest_sort: "asc" })).toEqual({ field: "days_running", order: "asc" });
    expect(mod.parseSort({ last_seen_sort: "desc" })).toEqual({ field: "last_seen", order: "desc" });
    expect(mod.parseSort({ likes_sort: "DESC" })).toEqual({ field: "likes", order: "desc" });
    expect(mod.parseSort({ comments_sort: "ASC" })).toEqual({ field: "comments", order: "asc" });
    expect(mod.parseSort({ domain_sort: "desc" })).toEqual({ field: "domain_registered_date", order: "desc" });
  });
  it("non-string sort skipped", () => {
    expect(mod.parseSort({ newest_sort: 1 })).toEqual({ field: "last_seen", order: "desc" });
  });
  it("seen_btn_sort array → last_seen desc", () => {
    expect(mod.parseSort({ seen_btn_sort: [1] })).toEqual({ field: "last_seen", order: "desc" });
  });
  it("seen_btn_sort non-array ignored", () => {
    expect(mod.parseSort({ seen_btn_sort: "x" })).toEqual({ field: "last_seen", order: "desc" });
  });
  it.each([
    ["post_date", "post_date"],
    ["last_seen", "last_seen"],
    ["likes", "likes"],
    ["comments", "comments"],
    ["domain_date", "domain_registered_date"],
  ])("order_column %s → %s", (oc, field) => {
    expect(mod.parseSort({ order_column: oc })).toEqual({ field, order: "desc" });
  });
  it("order_column asc respected", () => {
    expect(mod.parseSort({ order_column: "likes", order_by: "asc" })).toEqual({ field: "likes", order: "asc" });
  });
  it("unknown order_column → default", () => {
    expect(mod.parseSort({ order_column: "weird" })).toEqual({ field: "last_seen", order: "desc" });
  });
});

describe("services/google/helpers/paramParser > country delivery filters", () => {
  it("normalizes RFC3339 country seen dates and a valid impression range", () => {
    expect(mod.parseCountryDeliveryFilters({
      country: ["Germany"],
      country_detail_code: "DE",
      country_first_seen: ["2025-12-12T00:00:00Z", "2025-12-20T23:59:59Z"],
      country_last_seen: ["2025-12-12T00:00:00Z", "2025-12-21T23:59:59Z"],
      times_shown: [0, 1000],
    })).toEqual({
      countries: ["Germany"],
      countryCodes: ["DE"],
      firstSeen: { gte: "2025-12-12", lte: "2025-12-20" },
      lastSeen: { gte: "2025-12-12", lte: "2025-12-21" },
      timesShown: { min: 0, max: 1000 },
    });
  });

  it("rejects reversed dates and invalid impression bounds", () => {
    expect(mod.parseCountryDeliveryFilters({
      country_first_seen: ["2025-12-20", "2025-12-12"],
      times_shown: [1000, 0],
    })).toBeNull();
  });
});

describe("services/google/helpers/paramParser > withCdn (via cleanAdsData)", () => {
  function ad(post_owner_image) { return { id: 1, ad_id: 2, post_owner_image }; }
  it("empty/http unchanged", () => {
    expect(mod.cleanAdsData([ad("")])[0].post_owner_image).toBe("");
    expect(mod.cleanAdsData([ad("https://x.com/p.png")])[0].post_owner_image).toBe("https://x.com/p.png");
  });
  it("strips PowerAdspy prefixes", () => {
    expect(mod.cleanAdsData([ad("PowerAdspy/n2/x.png")])[0].post_owner_image).toBe("https://cdn.test/x.png");
    expect(mod.cleanAdsData([ad("PowerAdspy-Dev/y.png")])[0].post_owner_image).toBe("https://cdn.test/y.png");
  });
  it("paths missing/with leading slash", () => {
    expect(mod.cleanAdsData([ad("raw/x.png")])[0].post_owner_image).toBe("https://cdn.test/raw/x.png");
    expect(mod.cleanAdsData([ad("/abs/x.png")])[0].post_owner_image).toBe("https://cdn.test/abs/x.png");
  });
  it("non-string passes through", () => {
    expect(mod.cleanAdsData([ad(42)])[0].post_owner_image).toBe(42);
  });
  it("image_video_url also CDN-prefixed", () => {
    expect(mod.cleanAdsData([{ id: 1, ad_id: 2, image_video_url: "raw/v.mp4" }])[0].image_video_url).toBe("https://cdn.test/raw/v.mp4");
  });
  it("URL with '||' separator → first reachable URL after cleaning (lines 63-69)", () => {
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

describe("services/google/helpers/paramParser > empty CDN_BASE", () => {
  it("CDN_BASE='' → url unchanged", () => {
    require.cache[configPath] = {
      id: configPath, filename: configPath, loaded: true,
      exports: { cdn: { baseUrl: "" } },
    };
    const sutPath = require.resolve("../../../../src/services/google/helpers/paramParser");
    delete require.cache[sutPath];
    const noCdn = require("../../../../src/services/google/helpers/paramParser");
    expect(noCdn.cleanAdsData([{ id: 1, ad_id: 2, post_owner_image: "raw/x.png" }])[0].post_owner_image).toBe("raw/x.png");
  });
  it("config.cdn missing → CDN_BASE='' fallback", () => {
    require.cache[configPath] = {
      id: configPath, filename: configPath, loaded: true,
      exports: {},
    };
    const sutPath = require.resolve("../../../../src/services/google/helpers/paramParser");
    delete require.cache[sutPath];
    const noCdn = require("../../../../src/services/google/helpers/paramParser");
    expect(noCdn.CDN_BASE).toBe("");
  });
});

describe("services/google/helpers/paramParser > cleanAdsData", () => {
  it("drops invalid ads", () => {
    expect(mod.cleanAdsData([null, {}, { id: 1 }, { ad_id: 1 }, { id: 1, ad_id: 2 }])).toHaveLength(1);
  });
  it("default arg → []", () => { expect(mod.cleanAdsData()).toEqual([]); });
  it("parses JSON-shape strings", () => {
    const out = mod.cleanAdsData([{ id: 1, ad_id: 2, m: '{"a":1}', l: '[1]' }]);
    expect(out[0].m).toEqual({ a: 1 });
    expect(out[0].l).toEqual([1]);
  });
  it("malformed JSON kept as string; plain strings untouched", () => {
    const out = mod.cleanAdsData([{ id: 1, ad_id: 2, b: "{nope}", p: "plain" }]);
    expect(out[0].b).toBe("{nope}");
    expect(out[0].p).toBe("plain");
  });
});
