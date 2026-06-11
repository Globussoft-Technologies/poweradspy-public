import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const Builder = require("../../../../src/services/linkedin/builders/LinkedinSearchQueryBuilder");

let b;
beforeEach(() => {
  b = new Builder();
  delete process.env.ES_PROFILE;
});

describe("Linkedin builder > construction + setters", () => {
  it("default index from env or fallback", () => {
    expect(b._indexName).toBe(process.env.LI_ELASTIC_INDEX || "linkedin_ads_data");
  });
  it("explicit index overrides", () => {
    expect(new Builder("custom")._indexName).toBe("custom");
  });
  it("from/size/sort/profile/ip", () => {
    expect(b.setFrom("3")._from).toBe(3);
    expect(b.setSize("5")._size).toBe(5);
    // Non-numeric size → parseInt(NaN) → falsy → fallback to 20 (line 78 right branch)
    expect(new Builder().setSize("bogus")._size).toBe(20);
    // Array setStatus → true branch of cond-expr (line 97)
    expect(b.setStatus(["1", "2"])._params.status).toEqual(["1", "2"]);
    // Non-array range setters → null fallback (lines 112, 113, 114)
    expect(b.setComments("x")._params.comments).toBeNull();
    expect(b.setImpressions("x")._params.impressions).toBeNull();
    expect(b.setPopularity("x")._params.popularity).toBeNull();
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
      "setGender", "setStatus", "setTargetKeyword", "setBuiltWith", "setTrack",
      "setSource", "setFunnel", "setAffiliate", "setMarketPlatform", "setLangDetect",
      "setCelebrity", "setImageObject", "setLogo",
    ]) {
      const builder = new Builder();
      builder[setter]("x");
      expect(Array.isArray(Object.values(builder._params)[0])).toBe(true);
    }
  });
  it("simple value setters", () => {
    b.setKeyword("k").setPostOwnerName("po").setUrl("u").setVerified("1")
      .setNotCountry("RU").setAdDetailId("id").setOcr("o").setHtmlContent("html");
    expect(b._params.keyword).toBe("k");
    expect(b._params.htmlContent).toBe("html");
  });
  it("setNeedle handles NA → empty", () => {
    expect(b.setNeedle("NA")._params.needle).toBe("");
    expect(b.setNeedle("x")._params.needle).toBe("x");
  });
  it("range setters non-array → null", () => {
    expect(b.setLikes("x")._params.likes).toBeNull();
    expect(b.setLikes([1, 10])._params.likes).toEqual([1, 10]);
  });
  it("date setters store object", () => {
    b.setLastSeen({ lower_date: "1", upper_date: "2" });
    b.setPostDate({}).setDomainDate({}).setLowerAgeSeen({});
    expect(b._params.lastSeen.lower_date).toBe("1");
  });
});

describe("Linkedin builder > build() defaults", () => {
  it("emits EXTRA_CONDITION filter + match_all when no params", () => {
    const out = b.build();
    expect(out.index).toBe(b._indexName);
    expect(out.body.query.bool.filter.length).toBeGreaterThanOrEqual(1);
    expect(out.body.sort[0]).toEqual({ last_seen: "desc" });
  });
  it("profile env enables body.profile", () => {
    process.env.ES_PROFILE = "true";
    delete process.env.NODE_ENV;
    expect(b.build().body.profile).toBe(true);
  });
});

describe("Linkedin builder > clause generators", () => {
  it("keyword non-quoted → phraseAcrossFields in must", () => {
    b.setKeyword("foo bar");
    expect(b.build().body.query.bool.must.length).toBeGreaterThan(0);
  });
  it("keyword quoted → multi_match phrase", () => {
    b.setKeyword('"foo bar"');
    const must = b.build().body.query.bool.must;
    expect(must.some(m => m.multi_match?.query === "foo bar")).toBe(true);
  });
  it("postOwnerName non-quoted → bool.should with phrase+prefix", () => {
    b.setPostOwnerName("brand");
    const must = b.build().body.query.bool.must;
    expect(must.some(m => m.bool?.should?.some(s => s.prefix?.post_owner === "brand"))).toBe(true);
  });
  it("postOwnerName quoted → multi_match phrase only", () => {
    b.setPostOwnerName('"BrandX"');
    const must = b.build().body.query.bool.must;
    expect(must.some(m => m.multi_match?.query === "BrandX")).toBe(true);
  });
  it("ocr quoted/non-quoted both work", () => {
    expect(new Builder().setOcr("text").build().body.query.bool.must.length).toBeGreaterThan(0);
    expect(new Builder().setOcr('"text"').build().body.query.bool.must.length).toBeGreaterThan(0);
  });
  it("celebrity/imageObject/logo multi-field match", () => {
    b.setCelebrity(["c"]).setImageObject(["o"]).setLogo(["l"]);
    expect(b.build().body.query.bool.must.length).toBeGreaterThanOrEqual(3);
  });
  it("htmlContent quoted/non-quoted both emit must", () => {
    expect(new Builder().setHtmlContent("h").build().body.query.bool.must.length).toBeGreaterThan(0);
    expect(new Builder().setHtmlContent('"h"').build().body.query.bool.must.length).toBeGreaterThan(0);
  });
  it("url with/without protocol → wildcard on hostname", () => {
    const out1 = new Builder().setUrl("https://example.com/x").build();
    expect(JSON.stringify(out1)).toContain("*example.com*");
    const out2 = new Builder().setUrl("bare/path").build();
    expect(JSON.stringify(out2)).toContain("*bare*");
  });
  it("url that fails new URL() → falls back to split('/')[0] (line 206 catch)", () => {
    const out = new Builder().setUrl("http://[invalid").build();
    expect(JSON.stringify(out)).toContain("*http:*");
  });
  it("country/state/city → multi-field match filters", () => {
    b.setCountry(["US"]).setState(["CA"]).setCity(["LA"]);
    expect(b.build().body.query.bool.filter.length).toBeGreaterThanOrEqual(4);
  });
  it("callToAction/type/adPosition/adSubPosition/gender filters", () => {
    b.setCallToAction(["BUY"]).setAdType(["IMG"]).setAdPosition(["A"]).setAdSubPosition(["B"]).setGender(["m"]);
    expect(b.build().body.query.bool.filter.length).toBeGreaterThanOrEqual(5);
  });
  it("adPosition with 4+ values skipped", () => {
    b.setAdPosition(["A", "B", "C", "D"]);
    const filter = b.build().body.query.bool.filter;
    expect(filter.some(f => JSON.stringify(f).includes("ad_position"))).toBe(false);
  });
  it("verified '0' kept, NA/empty/null skipped", () => {
    expect(new Builder().setVerified("0").build().body.query.bool.filter.some(f => f.term?.verified === "0")).toBe(true);
    const out = new Builder().setVerified("NA").build();
    expect(out.body.query.bool.filter.every(f => !f.term?.verified)).toBe(true);
    expect(new Builder().setVerified(null).build().body.query.bool.filter.every(f => !f.term?.verified)).toBe(true);
  });
  it("adCategory/subCategory term filters", () => {
    b.setAdCategory(["c"]).setSubCategory(["s"]);
    expect(b.build().body.query.bool.filter.length).toBeGreaterThanOrEqual(3);
  });
  it("lowerAgeSeen with both bounds → range", () => {
    b.setLowerAgeSeen({ lower_age: "18", upper_age: "30" });
    expect(b.build().body.query.bool.filter.some(f => f.range?.lower_age_seen)).toBe(true);
  });
  it("date ranges with both bounds", () => {
    b.setLastSeen({ lower_date: "1", upper_date: "2" })
      .setPostDate({ lower_date: "1", upper_date: "2" })
      .setDomainDate({ lower_date: "1", upper_date: "2" });
    expect(b.build().body.query.bool.filter.length).toBeGreaterThanOrEqual(4);
  });
  it("date ranges missing bound → skipped", () => {
    b.setLastSeen({ lower_date: "1" });
    expect(b.build().body.query.bool.filter.some(f => f.range?.last_seen)).toBe(false);
  });
  it("needle without ipBasedCountry → range emitted", () => {
    b.setNeedle("1");
    expect(JSON.stringify(b.build())).toContain('"lt":"1"');
  });
  it("needle with ipBasedCountry + from<10000 + no country → skipped", () => {
    b.setNeedle("1").setIpBasedCountry("US").setFrom("0");
    expect(JSON.stringify(b.build())).not.toContain('"lt":"1"');
  });
  it("needle with country present → emitted", () => {
    b.setNeedle("1").setIpBasedCountry("US").setCountry(["US"]).setFrom("0");
    expect(JSON.stringify(b.build())).toContain('"lt":"1"');
  });
  it("targetKeyword/builtWith/track/source/funnel/affiliate filters", () => {
    b.setTargetKeyword(["t"]).setBuiltWith(["bw"]).setTrack(["t"]).setSource(["s"]).setFunnel(["f"]).setAffiliate(["a"]);
    expect(b.build().body.query.bool.filter.length).toBeGreaterThanOrEqual(7);
  });
  it("marketPlatform → bool.should wildcards", () => {
    b.setMarketPlatform(["mp"]);
    expect(b.build().body.query.bool.filter.some(f =>
      f.bool?.should?.some(s => s.wildcard?.redirect_urls?.value === "*mp*"))).toBe(true);
  });
  it("langDetect → match filter", () => {
    b.setLangDetect(["en"]);
    expect(b.build().body.query.bool.filter.some(f => JSON.stringify(f).includes("ad_language"))).toBe(true);
  });
  it("range filters (likes/comments/impressions/popularity)", () => {
    b.setLikes([1, 10]).setComments([1, 5]).setImpressions([1, 100]).setPopularity([1, 50]);
    expect(b.build().body.query.bool.filter.length).toBeGreaterThanOrEqual(5);
  });
  it("range single-element array → skipped", () => {
    b.setLikes([1]);
    expect(b.build().body.query.bool.filter.some(f => f.range?.["reactions.likes"])).toBe(false);
  });
});

describe("Linkedin builder > must_not collectors", () => {
  it("notCountry → multi-field match", () => {
    b.setNotCountry("RU");
    expect(b.build().body.query.bool.must_not.length).toBeGreaterThanOrEqual(1);
  });
  it("adDetailId → term exclude", () => {
    b.setAdDetailId(42);
    expect(b.build().body.query.bool.must_not.some(m => m.term?.ad_id === "42")).toBe(true);
  });
});

describe("Linkedin builder > ip-based country boost", () => {
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

describe("Linkedin builder > SEARCH_SOURCE_FIELDS", () => {
  it("static class property", () => {
    expect(Builder.SEARCH_SOURCE_FIELDS).toContain("ad_id");
  });
});
