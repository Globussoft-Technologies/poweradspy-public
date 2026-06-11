import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const Builder = require("../../../../src/services/gdn/builders/SearchMixQueryBuilder");

let b;
beforeEach(() => {
  b = new Builder();
  delete process.env.ES_PROFILE;
});

describe("GDN builder > construction + setters", () => {
  it("default index from env or fallback", () => {
    expect(b._indexName).toBe(process.env.GDN_ELASTIC_INDEX || "gdn_search_mix");
  });
  it("explicit index overrides", () => {
    expect(new Builder("custom")._indexName).toBe("custom");
  });
  it("from/size/sort/profile setters", () => {
    expect(b.setFrom("3")._from).toBe(3);
    expect(b.setSize("5")._size).toBe(5);
    expect(b.setSortField("post_date")._sortField).toBe("post_date");
    expect(b.setSortMethod("asc")._sortMethod).toBe("asc");
    expect(new Builder().setSortMethod("invalid")._sortMethod).toBe("desc");
    expect(b.setProfile(true)._profile).toBe(true);
  });
  it("setFrom('bogus') → parseInt NaN falls back to 0 (line 87 || right operand)", () => {
    expect(b.setFrom("bogus")._from).toBe(0);
  });
  it("setSize('bogus') → parseInt NaN falls back to 20 (line 88 || right operand)", () => {
    expect(b.setSize("bogus")._size).toBe(20);
  });
  it("array-coercion setters", () => {
    for (const setter of [
      "setCountry", "setAdType", "setAdPosition", "setAdSubPosition", "setStatus",
      "setCallToAction", "setAdCategory", "setSubCategory", "setTags", "setTargetKeyword",
      "setBuiltWith", "setSource", "setFunnel", "setAffiliate", "setLangDetect",
      "setGender", "setCelebrity", "setLogo", "setImageObject", "setMarketPlatform",
    ]) {
      const builder = new Builder();
      builder[setter]("x");
      expect(Array.isArray(Object.values(builder._params)[0])).toBe(true);
    }
  });
  it("simple value setters", () => {
    b.setKeyword("k").setPostOwnerName("po").setUrl("u").setNotCountry("RU")
      .setOcr("o").setHtmlContent("h").setAdImageSize("300x250");
    expect(b._params.keyword).toBe("k");
    expect(b._params.adImageSize).toBe("300x250");
  });
  it("setNeedle handles NA → empty", () => {
    expect(b.setNeedle("NA")._params.needle).toBe("");
    expect(b.setNeedle("x")._params.needle).toBe("x");
  });
  it("date setters store objects", () => {
    b.setLastSeen({}).setPostDate({}).setDomainDate({}).setLowerAgeSeen({});
  });
});

describe("GDN builder > build() defaults", () => {
  it("emits EXTRA_CONDITION filter", () => {
    const out = b.build();
    expect(out.body.query.bool.filter.length).toBeGreaterThanOrEqual(1);
    expect(out.body.sort[0]).toEqual({ "gdn_ad.last_seen": "desc" });
    expect(out.body.sort[1]).toEqual({ "gdn_ad.id": "desc" });
  });
  it("profile env enables body.profile", () => {
    process.env.ES_PROFILE = "true";
    delete process.env.NODE_ENV;
    expect(b.build().body.profile).toBe(true);
  });
});

describe("GDN builder > clause generators (must)", () => {
  it("keyword non-quoted → phrase across fields", () => {
    b.setKeyword("foo");
    expect(b.build().body.query.bool.must.length).toBeGreaterThan(0);
  });
  it("keyword quoted → multi_match phrase + exactly fields", () => {
    b.setKeyword('"foo"');
    expect(b.build().body.query.bool.must.length).toBeGreaterThan(0);
  });
  it("postOwnerName non-quoted → bool.should with phrase+prefix", () => {
    b.setPostOwnerName("brand");
    expect(b.build().body.query.bool.must.length).toBeGreaterThan(0);
  });
  it("postOwnerName quoted", () => {
    b.setPostOwnerName('"BrandX"');
    expect(b.build().body.query.bool.must.length).toBeGreaterThan(0);
  });
  it("ocr quoted/non-quoted both", () => {
    expect(new Builder().setOcr("text").build().body.query.bool.must.length).toBeGreaterThan(0);
    expect(new Builder().setOcr('"text"').build().body.query.bool.must.length).toBeGreaterThan(0);
  });
  it("celebrity/imageObject/logo", () => {
    b.setCelebrity(["c"]).setImageObject(["o"]).setLogo(["l"]);
    expect(b.build().body.query.bool.must.length).toBeGreaterThanOrEqual(3);
  });
  it("htmlContent quoted/non-quoted both", () => {
    expect(new Builder().setHtmlContent("h").build().body.query.bool.must.length).toBeGreaterThan(0);
    expect(new Builder().setHtmlContent('"h"').build().body.query.bool.must.length).toBeGreaterThan(0);
  });
});

describe("GDN builder > clause generators (filter)", () => {
  it("url with/without protocol", () => {
    expect(JSON.stringify(new Builder().setUrl("https://example.com/x").build())).toContain("*example.com*");
    expect(JSON.stringify(new Builder().setUrl("bare/path").build())).toContain("*bare*");
  });
  it("url that fails new URL() → falls back to split('/')[0] (line 247 catch)", () => {
    expect(JSON.stringify(new Builder().setUrl("http://[invalid").build())).toContain("*http:*");
  });
  it("country/type/adPosition/adSubPosition/callToAction/status filters", () => {
    b.setCountry(["US"]).setAdType(["IMG"]).setAdPosition(["A"]).setAdSubPosition(["B"])
     .setCallToAction(["BUY"]).setStatus(["1"]);
    expect(b.build().body.query.bool.filter.length).toBeGreaterThanOrEqual(7);
  });
  it("adCategory/subCategory/tags/targetKeyword/gender filters", () => {
    b.setAdCategory(["c"]).setSubCategory(["s"]).setTags(["t"]).setTargetKeyword(["tk"]).setGender(["m"]);
    expect(b.build().body.query.bool.filter.length).toBeGreaterThanOrEqual(6);
  });
  it("lowerAgeSeen range", () => {
    b.setLowerAgeSeen({ lower_age: "18", upper_age: "30" });
    expect(b.build().body.query.bool.filter.some(f => f.range && JSON.stringify(f).includes("lower_age_seen"))).toBe(true);
  });
  it("date ranges with both bounds", () => {
    b.setLastSeen({ lower_date: "1", upper_date: "2" })
     .setPostDate({ lower_date: "1", upper_date: "2" })
     .setDomainDate({ lower_date: "1", upper_date: "2" });
    expect(b.build().body.query.bool.filter.length).toBeGreaterThanOrEqual(4);
  });
  it("date ranges missing bound → skipped", () => {
    b.setLastSeen({ lower_date: "1" });
    expect(b.build().body.query.bool.filter.some(f => f.range?.["gdn_ad.last_seen"])).toBe(false);
  });
  it("needle → range", () => {
    b.setNeedle("1");
    expect(JSON.stringify(b.build())).toContain('"lt":"1"');
  });
  it("builtWith/source/funnel/affiliate/langDetect filters", () => {
    b.setBuiltWith(["bw"]).setSource(["s"]).setFunnel(["f"]).setAffiliate(["a"]).setLangDetect(["en"]);
    expect(b.build().body.query.bool.filter.length).toBeGreaterThanOrEqual(6);
  });
  it("source ['all'] → null", () => {
    b.setSource(["all"]);
    expect(b.build().body.query.bool.filter.some(f => JSON.stringify(f).includes("gdn_ad.source"))).toBe(false);
  });
  it("marketPlatform → bool.should wildcards across 7 fields", () => {
    b.setMarketPlatform(["mp"]);
    const f = b.build().body.query.bool.filter.find(f => f.bool?.should?.[0]?.wildcard);
    expect(f.bool.should.length).toBe(7);
  });
  it("adImageSize '300x250' → 2 range filters (width+height ± 50)", () => {
    b.setAdImageSize("300x250");
    const filter = b.build().body.query.bool.filter;
    expect(filter.some(f => f.range?.width?.gte === 250)).toBe(true);
    expect(filter.some(f => f.range?.height?.gte === 200)).toBe(true);
  });
  it("adImageSize without 'x' → no filter", () => {
    b.setAdImageSize("invalid");
    expect(b.build().body.query.bool.filter.some(f => f.range?.width)).toBe(false);
  });
  it("adImageSize zero dimension → no filter", () => {
    b.setAdImageSize("0x0");
    expect(b.build().body.query.bool.filter.some(f => f.range?.width)).toBe(false);
  });
  it("adImageSize non-string → no filter", () => {
    b._params.adImageSize = 123;
    expect(b.build().body.query.bool.filter.some(f => f.range?.width)).toBe(false);
  });
});

describe("GDN builder > must_not collectors", () => {
  it("notCountry → multi-field match", () => {
    b.setNotCountry("RU");
    expect(b.build().body.query.bool.must_not.length).toBeGreaterThanOrEqual(1);
  });
});

describe("GDN builder > SEARCH_SOURCE_FIELDS", () => {
  it("static class property", () => {
    expect(Builder.SEARCH_SOURCE_FIELDS).toContain("gdn_ad.id");
  });
});
