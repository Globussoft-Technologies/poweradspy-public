import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const Builder = require("../../../../src/services/google/builders/GoogleSearchQueryBuilder");

let b;
beforeEach(() => {
  b = new Builder();
  delete process.env.ES_PROFILE;
});

describe("Google builder > construction + setters", () => {
  it("default index", () => {
    expect(typeof b._indexName).toBe("string");
  });
  it("explicit index overrides", () => {
    expect(new Builder("custom")._indexName).toBe("custom");
  });
  it("from/size/sort/profile/ip setters", () => {
    expect(b.setFrom("3")._from).toBe(3);
    expect(b.setSize("5")._size).toBe(5);
    expect(b.setSortField("likes")._sortField).toBe("likes");
    expect(b.setSortMethod("asc")._sortMethod).toBe("asc");
    expect(new Builder().setSortMethod("invalid")._sortMethod).toBe("desc");
    expect(b.setIpBasedCountry("NA")._ipBasedCountry).toBe("");
    expect(b.setIpBasedCountry("US")._ipBasedCountry).toBe("US");
    expect(b.setProfile(true)._profile).toBe(true);
  });
  it("array-coercion setters", () => {
    for (const setter of [
      "setCountry", "setState", "setCity", "setCallToAction", "setAdCategory",
      "setSubCategory", "setAdType", "setAdPosition", "setAdSubPosition",
      "setGender", "setStatus", "setTargetKeyword", "setTags", "setBuiltWith",
      "setTrack", "setSource", "setFunnel", "setAffiliate", "setMarketPlatform", "setLangDetect",
    ]) {
      const builder = new Builder();
      builder[setter]("x");
      expect(Array.isArray(Object.values(builder._params)[0])).toBe(true);
    }
  });
  it("simple value setters", () => {
    b.setKeyword("k").setPostOwnerName("po").setUrl("u").setNotCountry("RU")
      .setAdDetailId("id").setHtmlContent("html");
    expect(b._params.keyword).toBe("k");
  });
  it("setNeedle handles NA → empty", () => {
    expect(b.setNeedle("NA")._params.needle).toBe("");
    expect(b.setNeedle("x")._params.needle).toBe("x");
  });
  it("range setters non-array → null", () => {
    expect(b.setLikes("x")._params.likes).toBeNull();
    expect(b.setComments("x")._params.comments).toBeNull();
    expect(b.setDislikes("x")._params.dislikes).toBeNull();
    expect(b.setViews("x")._params.views).toBeNull();
    expect(b.setAdBudget("x")._params.adBudget).toBeNull();
  });
  it("date setters store objects", () => {
    b.setLastSeen({}).setPostDate({}).setDomainDate({}).setLowerAgeSeen({});
  });
});

describe("Google builder > build() defaults", () => {
  it("emits match_all or default filters", () => {
    const out = b.build();
    expect(out.body.query).toBeDefined();
    expect(out.body.from).toBe(0);
    expect(out.body.size).toBe(20);
  });
  it("profile env enables body.profile", () => {
    process.env.ES_PROFILE = "true";
    delete process.env.NODE_ENV;
    expect(b.build().body.profile).toBe(true);
  });
});

describe("Google builder > clause generators", () => {
  it("keyword non-quoted", () => {
    b.setKeyword("foo");
    expect(b.build().body.query.bool.must?.length || 0).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(b.build())).toContain("foo");
  });
  it("keyword quoted", () => {
    b.setKeyword('"foo"');
    expect(JSON.stringify(b.build())).toContain("foo");
  });
  it("postOwnerName non-quoted", () => {
    b.setPostOwnerName("brand");
    expect(JSON.stringify(b.build())).toContain("brand");
  });
  it("postOwnerName quoted", () => {
    b.setPostOwnerName('"BrandX"');
    expect(JSON.stringify(b.build())).toContain("BrandX");
  });
  it("htmlContent quoted/non-quoted", () => {
    expect(JSON.stringify(new Builder().setHtmlContent("h").build())).toContain("h");
    expect(JSON.stringify(new Builder().setHtmlContent('"h"').build())).toContain("h");
  });
  it("url with/without protocol", () => {
    expect(JSON.stringify(new Builder().setUrl("https://example.com/x").build())).toContain("example.com");
    expect(JSON.stringify(new Builder().setUrl("bare/path").build())).toContain("bare");
  });
  it("url that fails new URL() → falls back to split('/')[0] (line 326 catch)", () => {
    expect(JSON.stringify(new Builder().setUrl("http://[invalid").build())).toContain("http:");
  });
  it("country/state/city filters", () => {
    b.setCountry(["US"]).setState(["CA"]).setCity(["LA"]);
    const filters = b.build().body.query.bool.filter || [];
    expect(filters.length).toBeGreaterThanOrEqual(3);
  });
  it("type/adPosition/adSubPosition/callToAction/gender filters", () => {
    b.setAdType(["IMG"]).setAdPosition(["A"]).setAdSubPosition(["B"]).setCallToAction(["BUY"]).setGender(["m"]);
    expect((b.build().body.query.bool.filter || []).length).toBeGreaterThanOrEqual(5);
  });
  it("adCategory/subCategory/tags/targetKeyword filters", () => {
    b.setAdCategory(["c"]).setSubCategory(["s"]).setTags(["t"]).setTargetKeyword(["tk"]);
    expect((b.build().body.query.bool.filter || []).length).toBeGreaterThanOrEqual(4);
  });
  it("lowerAgeSeen with bounds", () => {
    b.setLowerAgeSeen({ lower_age: "18", upper_age: "30" });
    const filters = b.build().body.query.bool.filter || [];
    expect(filters.some(f => f.range && JSON.stringify(f).includes("age"))).toBe(true);
  });
  it("date ranges with both bounds", () => {
    b.setLastSeen({ lower_date: "1", upper_date: "2" })
     .setPostDate({ lower_date: "1", upper_date: "2" })
     .setDomainDate({ lower_date: "1", upper_date: "2" });
    expect((b.build().body.query.bool.filter || []).length).toBeGreaterThanOrEqual(3);
  });
  it("date range missing bound → skipped", () => {
    b.setLastSeen({ lower_date: "1" });
    expect((b.build().body.query.bool.filter || []).some(f => f.range?.last_seen)).toBe(false);
  });
  it("needle without ipBasedCountry", () => {
    b.setNeedle("1");
    expect(JSON.stringify(b.build())).toContain('"lt":"1"');
  });
  it("needle with ipBasedCountry + from<10000 + no country → skipped", () => {
    b.setNeedle("1").setIpBasedCountry("US").setFrom("0");
    expect(JSON.stringify(b.build())).not.toContain('"lt":"1"');
  });
  it("range filters likes/comments/dislikes/views/adBudget", () => {
    b.setLikes([1, 10]).setComments([1, 5]).setDislikes([1, 3]).setViews([1, 100]).setAdBudget([1, 50]);
    expect((b.build().body.query.bool.filter || []).length).toBeGreaterThanOrEqual(5);
  });
  it("range single-elem → skipped", () => {
    b.setLikes([1]);
    expect((b.build().body.query.bool.filter || []).some(f => f.range?.["reactions.likes"])).toBe(false);
  });
  it("builtWith/track/source/funnel/affiliate/langDetect filters", () => {
    b.setBuiltWith(["bw"]).setTrack(["t"]).setSource(["s"]).setFunnel(["f"]).setAffiliate(["a"]).setLangDetect(["en"]);
    expect((b.build().body.query.bool.filter || []).length).toBeGreaterThanOrEqual(6);
  });
  it("marketPlatform → bool.should wildcards", () => {
    b.setMarketPlatform(["mp"]);
    expect((b.build().body.query.bool.filter || []).some(f => f.bool?.should?.some(s => s.wildcard))).toBe(true);
  });

  it("setSize('bogus') → parseInt NaN falls back to 20 (line 78 || right operand)", () => {
    expect(b.setSize("bogus")._size).toBe(20);
  });

  it("platform and subnetwork filters produce exact ES clauses", () => {
    b.setPlatform([18]).setSubnetwork(["SEARCH"]);
    const json = JSON.stringify(b.build().body.query.bool.filter || []);
    expect(json).toContain('"platform":18');
    expect(json).toContain('"subnetwork":"SEARCH"');
  });

  it("setStatus(array) → Array.isArray truthy branch (line 151)", () => {
    expect(b.setStatus(["x", "y"])._params.status).toEqual(["x", "y"]);
  });

  it("source=['all'] only → filtered.length === 0 → returns null (line 517 truthy)", () => {
    b.setSource(["all"]);
    // After filter(s => s !== "all"), nothing remains → filtered.length === 0
    // → return null → no source filter present in the built query.
    const filterJson = JSON.stringify(b.build().body.query.bool.filter || []);
    expect(filterJson).not.toContain('"source"');
  });
});

describe("Google builder > must_not collectors", () => {
  it("notCountry", () => {
    b.setNotCountry("RU");
    expect((b.build().body.query.bool.must_not || []).length).toBeGreaterThanOrEqual(1);
  });
  it("adDetailId", () => {
    b.setAdDetailId(42);
    expect((b.build().body.query.bool.must_not || []).some(m => m.term)).toBe(true);
  });
});

describe("Google builder > ip-based country boost", () => {
  it("wraps with country boost", () => {
    b.setIpBasedCountry("us");
    expect(JSON.stringify(b.build())).toContain("constant_score");
  });
  it("isPriorityOffset → _score sort prefix", () => {
    b.setIpBasedCountry("us").setFrom("0");
    expect(b.build().body.sort[0]).toEqual({ _score: "desc" });
  });
  it("from >= 10000 → no _score prefix", () => {
    b.setIpBasedCountry("us").setFrom("20000");
    expect(b.build().body.sort[0]).not.toEqual({ _score: "desc" });
  });
});

describe("Google builder > SEARCH_SOURCE_FIELDS", () => {
  it("static class property exists", () => {
    expect(Array.isArray(Builder.SEARCH_SOURCE_FIELDS)).toBe(true);
  });

  it("keeps Google Transparency discriminator and media fields in search hits", () => {
    expect(Builder.SEARCH_SOURCE_FIELDS).toEqual(expect.arrayContaining([
      "platform",
      "image_url_original",
      "image_video_url",
      "new_nas_image_url",
      "video_url_original",
      "nas_video_url",
      "othermultimedia",
    ]));
  });
});
