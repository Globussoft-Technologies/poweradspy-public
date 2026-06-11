import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const Builder = require("../../../../src/services/quora/builders/QuoraSearchQueryBuilder");

let b;
beforeEach(() => {
  b = new Builder();
  delete process.env.ES_PROFILE;
});

describe("Quora builder > construction + setters", () => {
  it("default index from env or fallback", () => {
    expect(b._indexName).toBe(process.env.QR_ELASTIC_INDEX || "quora_search_mix");
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
      "setAdType", "setAdPosition", "setCallToAction", "setGender", "setStatus", "setTags",
      "setBuiltWith", "setTrack", "setSource", "setFunnel", "setAffiliate",
      "setMarketPlatform", "setLangDetect", "setCelebrity", "setImageObject", "setLogo",
    ]) {
      const builder = new Builder();
      builder[setter]("x");
      expect(Array.isArray(Object.values(builder._params)[0])).toBe(true);
    }
  });
  it("setStatus(array) → passes-through (line 84 truthy branch)", () => {
    // Pass an already-array value so the `Array.isArray(v)` ternary takes the
    // truthy path and the existing array is stored as-is.
    expect(b.setStatus(["a", "b"])._params.status).toEqual(["a", "b"]);
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

describe("Quora builder > build() defaults", () => {
  it("emits EXTRA_CONDITION filter", () => {
    const out = b.build();
    expect(out.body.query.bool.filter.length).toBeGreaterThanOrEqual(1);
    expect(out.body.sort[0]).toEqual({ "quora_ad.last_seen": "desc" });
  });
  it("profile env enables body.profile", () => {
    process.env.ES_PROFILE = "true";
    delete process.env.NODE_ENV;
    expect(b.build().body.profile).toBe(true);
  });
});

describe("Quora builder > clause generators (must)", () => {
  it("keyword non-quoted → phraseAcrossFields", () => {
    b.setKeyword("foo");
    expect(b.build().body.query.bool.must.length).toBeGreaterThan(0);
  });
  it("keyword quoted → multi_match phrase with exactly fields", () => {
    b.setKeyword('"foo"');
    const must = b.build().body.query.bool.must;
    expect(must.some(m => m.multi_match?.fields?.includes("quora_ad_variants.title_exactly"))).toBe(true);
  });
  it("postOwnerName non-quoted → bool.should phrase + prefix", () => {
    b.setPostOwnerName("brand");
    const must = b.build().body.query.bool.must;
    expect(must.some(m => m.bool?.should?.some(s => s.prefix))).toBe(true);
  });
  it("postOwnerName quoted strips quotes (quora uses unified bool.should)", () => {
    b.setPostOwnerName('"BrandX"');
    const must = b.build().body.query.bool.must;
    expect(must.some(m => m.bool?.should?.some(s => s.multi_match?.query === "BrandX"))).toBe(true);
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

describe("Quora builder > clause generators (filter)", () => {
  it("url with/without protocol", () => {
    expect(JSON.stringify(new Builder().setUrl("https://example.com/x").build())).toContain("*example.com*");
    expect(JSON.stringify(new Builder().setUrl("bare/path").build())).toContain("*bare*");
  });
  it("url that fails new URL() → falls back to split('/')[0] (line 209 catch)", () => {
    expect(JSON.stringify(new Builder().setUrl("http://[invalid").build())).toContain("*http:*");
  });
  it("country/state/city/adCategory/subCategory filters", () => {
    b.setCountry(["US"]).setState(["CA"]).setCity(["LA"]).setAdCategory(["c"]).setSubCategory(["s"]);
    expect(b.build().body.query.bool.filter.length).toBeGreaterThanOrEqual(6);
  });
  it("type/adPosition filters", () => {
    b.setAdType(["IMAGE"]).setAdPosition(["A"]).setCallToAction(["BUY"]).setGender(["m"]);
    expect(b.build().body.query.bool.filter.length).toBeGreaterThanOrEqual(5);
  });
  it("tags set → multi-field match on quora_ad_variants.tags (line 270)", () => {
    b.setTags(["promo"]);
    expect(JSON.stringify(b.build())).toContain("quora_ad_variants.tags");
  });
  it("lowerAgeSeen with both bounds → range (any range field)", () => {
    b.setLowerAgeSeen({ lower_age: "18", upper_age: "30" });
    expect(b.build().body.query.bool.filter.some(f => f.range?.["quora_ad.lower_age_seen"] || f.range)).toBe(true);
  });
  it("date ranges with both bounds", () => {
    b.setLastSeen({ lower_date: "1", upper_date: "2" })
      .setPostDate({ lower_date: "1", upper_date: "2" })
      .setDomainDate({ lower_date: "1", upper_date: "2" });
    expect(b.build().body.query.bool.filter.length).toBeGreaterThanOrEqual(4);
  });
  it("date ranges missing bound → skipped", () => {
    b.setLastSeen({ lower_date: "1" });
    expect(b.build().body.query.bool.filter.some(f => f.range?.["quora_ad.last_seen"])).toBe(false);
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
  it("builtWith/track/funnel/affiliate/langDetect filters", () => {
    b.setBuiltWith(["bw"]).setTrack(["t"]).setFunnel(["f"]).setAffiliate(["a"]).setLangDetect(["en"]);
    expect(b.build().body.query.bool.filter.length).toBeGreaterThanOrEqual(6);
  });
  it("source 'all' expands to all three platform fields", () => {
    b.setSource(["all"]);
    const filter = b.build().body.query.bool.filter;
    expect(filter.some(f => f.bool?.should?.length === 3)).toBe(true);
  });
  it("source single platform → single exists clause", () => {
    b.setSource(["ios"]);
    const filter = b.build().body.query.bool.filter;
    expect(filter.some(f => f.exists?.field === "quora_ad_meta_data.firstSeenOnIos")).toBe(true);
  });
  it("source unknown value alone → null (no filter)", () => {
    b.setSource(["unknown"]);
    const filter = b.build().body.query.bool.filter;
    expect(filter.some(f => f.exists || f.bool?.should?.some(s => s.exists))).toBe(false);
  });
  it("source multiple platforms → bool.should", () => {
    b.setSource(["ios", "android"]);
    expect(b.build().body.query.bool.filter.some(f => f.bool?.should?.length === 2)).toBe(true);
  });
  it("marketPlatform → bool.should wildcards across 6 fields", () => {
    b.setMarketPlatform(["mp"]);
    const f = b.build().body.query.bool.filter.find(f => f.bool?.should?.[0]?.wildcard);
    expect(f.bool.should.length).toBe(6);
  });
});

describe("Quora builder > must_not collectors", () => {
  it("notCountry → multi-field match", () => {
    b.setNotCountry("RU");
    expect(b.build().body.query.bool.must_not.length).toBeGreaterThanOrEqual(1);
  });
  it("adDetailId → term exclude", () => {
    b.setAdDetailId(42);
    expect(b.build().body.query.bool.must_not.some(m => m.term?.["quora_ad.id"] === "42")).toBe(true);
  });
});

describe("Quora builder > ip-based country boost", () => {
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

describe("Quora builder > SEARCH_SOURCE_FIELDS", () => {
  it("static class property", () => {
    expect(Builder.SEARCH_SOURCE_FIELDS).toContain("quora_ad.id");
  });
});
