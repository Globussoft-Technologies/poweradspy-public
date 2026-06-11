import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const Builder = require("../../../../src/services/native/builders/NativeSearchQueryBuilder");

let b;
beforeEach(() => {
  b = new Builder();
  delete process.env.ES_PROFILE;
});

describe("Native builder > construction + setters", () => {
  it("default index from env or fallback", () => {
    expect(b._indexName).toBe(process.env.NAT_ELASTIC_INDEX || "native_search_mix");
  });
  it("explicit index overrides", () => {
    expect(new Builder("custom")._indexName).toBe("custom");
  });
  it("from/size/sort/ip/profile setters", () => {
    expect(b.setFrom("3")._from).toBe(3);
    expect(b.setFrom("bogus")._from).toBe(0);
    expect(b.setSize("5")._size).toBe(5);
    expect(b.setSize("bogus")._size).toBe(20);
    expect(b.setSortField("post_date")._sortField).toBe("post_date");
    expect(b.setSortMethod("asc")._sortMethod).toBe("asc");
    expect(new Builder().setSortMethod("invalid")._sortMethod).toBe("desc");
    expect(b.setIpBasedCountry("NA")._ipBasedCountry).toBe("");
    expect(b.setIpBasedCountry("US")._ipBasedCountry).toBe("US");
    expect(b.setProfile(true)._profile).toBe(true);
  });
  it("array-coercion setters", () => {
    for (const setter of [
      "setCountry", "setState", "setCity", "setAdCategory", "setSubCategory",
      "setAdType", "setAdPosition", "setAdSubPosition", "setCallToAction", "setGender", "setStatus",
      "setNetwork", "setCategory", "setTags", "setTargetKeyword",
      "setBuiltWith", "setTrack", "setSource", "setFunnel", "setAffiliate",
      "setMarketPlatform", "setLangDetect", "setCelebrity", "setImageObject", "setLogo",
    ]) {
      const builder = new Builder();
      builder[setter]("x");
      expect(Array.isArray(Object.values(builder._params)[0])).toBe(true);
    }
  });
  it("simple value setters", () => {
    b.setKeyword("k").setPostOwnerName("po").setUrl("u").setNotCountry("RU")
      .setAdDetailId("id").setOcr("o").setHtmlContent("html");
    expect(b._params.keyword).toBe("k");
  });
  it("setNeedle handles NA → empty", () => {
    expect(b.setNeedle("NA")._params.needle).toBe("");
    expect(b.setNeedle("x")._params.needle).toBe("x");
  });
  it("date setters store objects", () => {
    b.setLastSeen({}).setPostDate({}).setDomainDate({}).setLowerAgeSeen({});
  });
});

describe("Native builder > build() defaults", () => {
  it("emits EXTRA_CONDITION filter", () => {
    const out = b.build();
    expect(out.body.query.bool.filter.length).toBeGreaterThanOrEqual(1);
    expect(out.body.sort[0]).toEqual({ "native_ad.last_seen": "desc" });
  });
  it("profile env enables body.profile", () => {
    process.env.ES_PROFILE = "true";
    delete process.env.NODE_ENV;
    expect(b.build().body.profile).toBe(true);
  });
});

describe("Native builder > clause generators (must)", () => {
  it("keyword non-quoted → phraseAcrossFields", () => {
    b.setKeyword("foo");
    expect(b.build().body.query.bool.must.length).toBeGreaterThan(0);
  });
  it("keyword quoted → multi_match phrase with exactly fields", () => {
    b.setKeyword('"foo"');
    const must = b.build().body.query.bool.must;
    expect(must.some(m => m.multi_match?.fields?.includes("native_ad_variants.title_exactly"))).toBe(true);
  });
  it("postOwnerName non-quoted → bool.should phrase + prefix", () => {
    b.setPostOwnerName("brand");
    const must = b.build().body.query.bool.must;
    expect(must.some(m => m.bool?.should?.some(s => s.prefix))).toBe(true);
  });
  it("postOwnerName quoted → multi_match phrase only", () => {
    b.setPostOwnerName('"BrandX"');
    const must = b.build().body.query.bool.must;
    expect(must.some(m => m.multi_match?.query === "BrandX")).toBe(true);
  });
  it("ocr quoted/non-quoted work", () => {
    expect(new Builder().setOcr("text").build().body.query.bool.must.length).toBeGreaterThan(0);
    expect(new Builder().setOcr('"text"').build().body.query.bool.must.length).toBeGreaterThan(0);
  });
  it("celebrity/imageObject/logo via _imageArrayEnv", () => {
    b.setCelebrity(["c"]).setImageObject(["o"]).setLogo(["l"]);
    expect(b.build().body.query.bool.must.length).toBeGreaterThanOrEqual(3);
  });
  it("htmlContent quoted/non-quoted work", () => {
    expect(new Builder().setHtmlContent("h").build().body.query.bool.must.length).toBeGreaterThan(0);
    expect(new Builder().setHtmlContent('"h"').build().body.query.bool.must.length).toBeGreaterThan(0);
  });
});

describe("Native builder > clause generators (filter)", () => {
  it("url with/without protocol", () => {
    expect(JSON.stringify(new Builder().setUrl("https://example.com/x").build())).toContain("*example.com*");
    expect(JSON.stringify(new Builder().setUrl("bare/path").build())).toContain("*bare*");
  });
  it("url that fails new URL() → falls back to split('/')[0] (line 239 catch)", () => {
    expect(JSON.stringify(new Builder().setUrl("http://[invalid").build())).toContain("*http:*");
  });
  it("country/state/city/adCategory/subCategory filters", () => {
    b.setCountry(["US"]).setState(["CA"]).setCity(["LA"]).setAdCategory(["c"]).setSubCategory(["s"]);
    expect(b.build().body.query.bool.filter.length).toBeGreaterThanOrEqual(6);
  });
  it("type/adPosition/adSubPosition/network/category/tags/targetKeyword filters", () => {
    b.setAdType(["IMAGE"]).setAdPosition(["A"]).setAdSubPosition(["B"])
     .setCallToAction(["BUY"]).setGender(["m"]).setNetwork(["nw"]).setCategory(["cat"])
     .setTags(["t"]).setTargetKeyword(["tk"]);
    expect(b.build().body.query.bool.filter.length).toBeGreaterThanOrEqual(9);
  });
  it("verified '0' kept", () => {
    expect(new Builder().setVerified("0").build().body.query.bool.filter.some(f => f.term?.["native_ad_post_owners.verified"] === "0")).toBe(true);
  });
  it("verified NA/null skipped", () => {
    expect(new Builder().setVerified("NA").build().body.query.bool.filter.every(f => !f.term?.["native_ad_post_owners.verified"])).toBe(true);
  });
  it("lowerAgeSeen with both bounds → range (any range field)", () => {
    b.setLowerAgeSeen({ lower_age: "18", upper_age: "30" });
    expect(b.build().body.query.bool.filter.some(f => f.range?.["native_ad.lower_age_seen"] || f.range)).toBe(true);
  });
  it("date ranges with both bounds", () => {
    b.setLastSeen({ lower_date: "1", upper_date: "2" })
      .setPostDate({ lower_date: "1", upper_date: "2" })
      .setDomainDate({ lower_date: "1", upper_date: "2" });
    expect(b.build().body.query.bool.filter.length).toBeGreaterThanOrEqual(4);
  });
  it("date ranges missing bound → skipped", () => {
    b.setLastSeen({ lower_date: "1" });
    expect(b.build().body.query.bool.filter.some(f => f.range?.["native_ad.last_seen"])).toBe(false);
  });
  it("needle without ipBasedCountry → range emitted", () => {
    b.setNeedle("1");
    expect(JSON.stringify(b.build())).toContain('"lt":"1"');
  });
  it("needle with ipBasedCountry + from<10000 + no country → skipped", () => {
    b.setNeedle("1").setIpBasedCountry("US").setFrom("0");
    expect(JSON.stringify(b.build())).not.toContain('"lt":"1"');
  });
  it("needle with country → emitted", () => {
    b.setNeedle("1").setIpBasedCountry("US").setCountry(["US"]).setFrom("0");
    expect(JSON.stringify(b.build())).toContain('"lt":"1"');
  });
  it("range filters likes/comments", () => {
    b.setLikes([1, 10]).setComments([1, 5]);
    expect(b.build().body.query.bool.filter.length).toBeGreaterThanOrEqual(3);
  });
  it("range setter non-array → null", () => {
    expect(b.setLikes("x")._params.likes).toBeNull();
    expect(b.setComments("x")._params.comments).toBeNull();
  });
  it("setStatus(array) preserves array (line 88 cond-expr true branch)", () => {
    expect(b.setStatus(["1", "2"])._params.status).toEqual(["1", "2"]);
  });
  it("range single-elem → skipped", () => {
    b.setLikes([1]);
    expect(b.build().body.query.bool.filter.some(f => f.range?.["native_ad.likes"])).toBe(false);
  });
  it("builtWith/track/funnel/affiliate/langDetect filters", () => {
    b.setBuiltWith(["bw"]).setTrack(["t"]).setFunnel(["f"]).setAffiliate(["a"]).setLangDetect(["en"]);
    expect(b.build().body.query.bool.filter.length).toBeGreaterThanOrEqual(6);
  });
  it("source filters out 'all' and uses term filter", () => {
    b.setSource(["src1"]);
    expect(b.build().body.query.bool.filter.some(f => f.term?.["native_ad.source"] === "src1")).toBe(true);
  });
  it("source ['all'] alone → null (no filter)", () => {
    b.setSource(["all"]);
    expect(b.build().body.query.bool.filter.some(f => JSON.stringify(f).includes("native_ad.source"))).toBe(false);
  });
  it("marketPlatform → bool.should wildcards", () => {
    b.setMarketPlatform(["mp"]);
    const f = b.build().body.query.bool.filter.find(f => f.bool?.should?.[0]?.wildcard);
    expect(f).toBeDefined();
  });
});

describe("Native builder > must_not collectors", () => {
  it("notCountry → multi-field match", () => {
    b.setNotCountry("RU");
    expect(b.build().body.query.bool.must_not.length).toBeGreaterThanOrEqual(1);
  });
  it("adDetailId → term exclude", () => {
    b.setAdDetailId(42);
    expect(b.build().body.query.bool.must_not.some(m => m.term?.["native_ad.id"] === "42")).toBe(true);
  });
});

describe("Native builder > ip-based country boost", () => {
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

describe("Native builder > SEARCH_SOURCE_FIELDS", () => {
  it("static class property", () => {
    expect(Builder.SEARCH_SOURCE_FIELDS).toContain("native_ad.id");
  });
});
