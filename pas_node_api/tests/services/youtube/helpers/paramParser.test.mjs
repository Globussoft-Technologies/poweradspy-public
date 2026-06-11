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
  const sutPath = require.resolve("../../../../src/services/youtube/helpers/paramParser");
  delete require.cache[sutPath];
  mod = require("../../../../src/services/youtube/helpers/paramParser");
});

describe("services/youtube/helpers/paramParser > normalizeValue", () => {
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

describe("services/youtube/helpers/paramParser > normalizeParams", () => {
  it("falsy/non-object → {}", () => {
    expect(mod.normalizeParams(null)).toEqual({});
    expect(mod.normalizeParams(undefined)).toEqual({});
    expect(mod.normalizeParams("string")).toEqual({});
  });
  it("normalizes each value in the body", () => {
    expect(mod.normalizeParams({ a: "NA", b: " x ", c: 5 })).toEqual({ a: "", b: "x", c: 5 });
  });
});

describe("services/youtube/helpers/paramParser > ensureArray", () => {
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

describe("services/youtube/helpers/paramParser > parsePagination", () => {
  it("prefers take > page_size, falls back to 20", () => {
    expect(mod.parsePagination({ take: "10", page_size: "30" })).toEqual({ size: 10, from: 0 });
    expect(mod.parsePagination({ page_size: "30" })).toEqual({ size: 30, from: 0 });
    expect(mod.parsePagination({})).toEqual({ size: 20, from: 0 });
  });
  it("uses skip > page for offset (take * page)", () => {
    expect(mod.parsePagination({ take: "10", skip: "3" })).toEqual({ size: 10, from: 30 });
    expect(mod.parsePagination({ take: "10", page: "2" })).toEqual({ size: 10, from: 20 });
  });
});

describe("services/youtube/helpers/paramParser > parseSort — sortMap", () => {
  it("newest_sort → last_seen", () => {
    expect(mod.parseSort({ newest_sort: "desc" })).toEqual({ field: "last_seen", order: "desc" });
  });
  it("running_longest_sort → duration", () => {
    expect(mod.parseSort({ running_longest_sort: "asc" })).toEqual({ field: "duration", order: "asc" });
  });
  it("last_seen_sort → last_seen", () => {
    expect(mod.parseSort({ last_seen_sort: "desc" })).toEqual({ field: "last_seen", order: "desc" });
  });
  it("likes_sort → reactions.likes", () => {
    expect(mod.parseSort({ likes_sort: "desc" })).toEqual({ field: "reactions.likes", order: "desc" });
  });
  it("dislikes_sort → dislikes", () => {
    expect(mod.parseSort({ dislikes_sort: "desc" })).toEqual({ field: "dislikes", order: "desc" });
  });
  it("comments_sort → comments", () => {
    expect(mod.parseSort({ comments_sort: "desc" })).toEqual({ field: "comments", order: "desc" });
  });
  it("views_sort → views", () => {
    expect(mod.parseSort({ views_sort: "desc" })).toEqual({ field: "views", order: "desc" });
  });
  it("domain_sort → domain_registration_date", () => {
    expect(mod.parseSort({ domain_sort: "desc" })).toEqual({ field: "domain_registration_date", order: "desc" });
  });
  it("adBudget_sort → youtube.averageBudget", () => {
    expect(mod.parseSort({ adBudget_sort: "asc" })).toEqual({ field: "youtube.averageBudget", order: "asc" });
  });
  it("ASC case insensitive", () => {
    expect(mod.parseSort({ newest_sort: "ASC" })).toEqual({ field: "last_seen", order: "asc" });
  });
  it("non-string sort param skipped", () => {
    expect(mod.parseSort({ newest_sort: 123 })).toEqual({ field: "last_seen", order: "desc" });
  });
  it("'NA' sort param treated as empty by normalizeValue", () => {
    expect(mod.parseSort({ newest_sort: "NA" })).toEqual({ field: "last_seen", order: "desc" });
  });
});

describe("services/youtube/helpers/paramParser > parseSort — orderColumn path", () => {
  it("post_date order with default desc", () => {
    expect(mod.parseSort({ order_column: "post_date" })).toEqual({ field: "post_date", order: "desc" });
  });
  it("last_seen + asc", () => {
    expect(mod.parseSort({ order_column: "last_seen", order_by: "asc" })).toEqual({ field: "last_seen", order: "asc" });
  });
  it("days_running maps to duration", () => {
    expect(mod.parseSort({ order_column: "days_running" })).toEqual({ field: "duration", order: "desc" });
  });
  it("likes maps to reactions.likes", () => {
    expect(mod.parseSort({ order_column: "likes" })).toEqual({ field: "reactions.likes", order: "desc" });
  });
  it("dislikes/comments/views mapped", () => {
    expect(mod.parseSort({ order_column: "dislikes" })).toEqual({ field: "dislikes", order: "desc" });
    expect(mod.parseSort({ order_column: "comments" })).toEqual({ field: "comments", order: "desc" });
    expect(mod.parseSort({ order_column: "views" })).toEqual({ field: "views", order: "desc" });
  });
  it("unknown column falls through to default", () => {
    expect(mod.parseSort({ order_column: "unknown_col" })).toEqual({ field: "last_seen", order: "desc" });
  });
  it("default fallback when nothing matches", () => {
    expect(mod.parseSort({})).toEqual({ field: "last_seen", order: "desc" });
  });
});

describe("services/youtube/helpers/paramParser > withCdn (via cleanAdsData.post_owner_image)", () => {
  function makeAd(post_owner_image) {
    return { id: 1, ad_id: 2, post_owner_image };
  }
  it("returns url unchanged when empty/missing", () => {
    expect(mod.cleanAdsData([makeAd("")])[0].post_owner_image).toBe("");
  });
  it("returns http(s) URLs unchanged", () => {
    expect(mod.cleanAdsData([makeAd("https://example.com/x.png")])[0].post_owner_image)
      .toBe("https://example.com/x.png");
  });
  it("strips PowerAdspy/n2 and PowerAdspy-Dev prefixes", () => {
    expect(mod.cleanAdsData([makeAd("PowerAdspy/n2/foo.png")])[0].post_owner_image)
      .toBe("https://cdn.test/foo.png");
    expect(mod.cleanAdsData([makeAd("PowerAdspy-Dev/bar.png")])[0].post_owner_image)
      .toBe("https://cdn.test/bar.png");
  });
  it("prefixes paths missing leading slash", () => {
    expect(mod.cleanAdsData([makeAd("raw/clip.png")])[0].post_owner_image)
      .toBe("https://cdn.test/raw/clip.png");
  });
  it("paths with leading slash are concatenated as-is", () => {
    expect(mod.cleanAdsData([makeAd("/abs/clip.png")])[0].post_owner_image)
      .toBe("https://cdn.test/abs/clip.png");
  });
  it("non-string passes through", () => {
    expect(mod.cleanAdsData([makeAd(42)])[0].post_owner_image).toBe(42);
  });
  it("URL with '||' separator → first reachable URL after cleaning (lines 88-93)", () => {
    expect(mod.cleanAdsData([makeAd("PowerAdspy/n2/primary.png||PowerAdspy/n2/fallback.png")])[0].post_owner_image)
      .toBe("https://cdn.test/primary.png");
  });
  it("URL with empty primary in '||' → falls back to second segment (lines 88-93)", () => {
    expect(mod.cleanAdsData([makeAd("||PowerAdspy/n2/second.png")])[0].post_owner_image)
      .toBe("https://cdn.test/second.png");
  });
  it("URL with only '||' (both empty) → '' (lines 88-93, cleaned[0] falsy fallback)", () => {
    expect(mod.cleanAdsData([makeAd("||")])[0].post_owner_image).toBe("");
  });
});

describe("services/youtube/helpers/paramParser > withCdn — empty CDN_BASE", () => {
  it("returns url unchanged when CDN_BASE is empty", () => {
    require.cache[configPath] = {
      id: configPath, filename: configPath, loaded: true,
      exports: { cdn: { baseUrl: "" } },
    };
    const sutPath = require.resolve("../../../../src/services/youtube/helpers/paramParser");
    delete require.cache[sutPath];
    const noCdn = require("../../../../src/services/youtube/helpers/paramParser");
    expect(noCdn.cleanAdsData([{ id: 1, ad_id: 2, post_owner_image: "PowerAdspy/n2/x.png" }])[0].post_owner_image)
      .toBe("PowerAdspy/n2/x.png");
  });

  it("CDN_BASE falls back to '' when config.cdn missing entirely", () => {
    require.cache[configPath] = {
      id: configPath, filename: configPath, loaded: true,
      exports: {},
    };
    const sutPath = require.resolve("../../../../src/services/youtube/helpers/paramParser");
    delete require.cache[sutPath];
    const noCdn = require("../../../../src/services/youtube/helpers/paramParser");
    expect(noCdn.cleanAdsData([{ id: 1, ad_id: 2, post_owner_image: "raw/x.png" }])[0].post_owner_image)
      .toBe("raw/x.png");
  });
});

describe("services/youtube/helpers/paramParser > cleanAdsData", () => {
  it("drops ads missing id OR ad_id OR ad itself", () => {
    const out = mod.cleanAdsData([
      null,                              // dropped
      { foo: "bar" },                    // dropped
      { id: 1 },                          // dropped (no ad_id)
      { ad_id: 1 },                       // dropped (no id)
      { id: 1, ad_id: 2 },                // kept
    ]);
    expect(out).toHaveLength(1);
  });
  it("default ads=[] when called with no arg", () => {
    expect(mod.cleanAdsData()).toEqual([]);
  });
  it("parses JSON-shaped string values", () => {
    const out = mod.cleanAdsData([{ id: 1, ad_id: 2, meta: '{"a":1}', list: '[1,2,3]' }]);
    expect(out[0].meta).toEqual({ a: 1 });
    expect(out[0].list).toEqual([1, 2, 3]);
  });
  it("leaves malformed JSON-shaped strings as-is", () => {
    const out = mod.cleanAdsData([{ id: 1, ad_id: 2, broken: "{not-json}" }]);
    expect(out[0].broken).toBe("{not-json}");
  });
  it("non-JSON strings untouched", () => {
    const out = mod.cleanAdsData([{ id: 1, ad_id: 2, plain: "hello" }]);
    expect(out[0].plain).toBe("hello");
  });
  it("image_video_url is CDN-prefixed", () => {
    const out = mod.cleanAdsData([{ id: 1, ad_id: 2, image_video_url: "raw/v.mp4" }]);
    expect(out[0].image_video_url).toBe("https://cdn.test/raw/v.mp4");
  });
  it("ad_image_video array is mapped through withCdn", () => {
    const out = mod.cleanAdsData([{ id: 1, ad_id: 2, ad_image_video: ["a.png", "PowerAdspy/n2/b.png"] }]);
    expect(out[0].ad_image_video).toEqual(["https://cdn.test/a.png", "https://cdn.test/b.png"]);
  });
  it("ad_image_video as scalar string is CDN-prefixed", () => {
    const out = mod.cleanAdsData([{ id: 1, ad_id: 2, ad_image_video: "scalar.png" }]);
    expect(out[0].ad_image_video).toBe("https://cdn.test/scalar.png");
  });
  it("ad_image_video as empty string is left alone (else-if guard)", () => {
    const out = mod.cleanAdsData([{ id: 1, ad_id: 2, ad_image_video: "" }]);
    expect(out[0].ad_image_video).toBe("");
  });
  it("ad_image_video as null/undefined ignored", () => {
    const out = mod.cleanAdsData([{ id: 1, ad_id: 2, ad_image_video: null }]);
    expect(out[0].ad_image_video).toBe(null);
  });
  it("preserves non-image fields verbatim", () => {
    const out = mod.cleanAdsData([{ id: 1, ad_id: 2, title: "Hello", views: 100 }]);
    expect(out[0]).toMatchObject({ id: 1, ad_id: 2, title: "Hello", views: 100 });
  });
});
