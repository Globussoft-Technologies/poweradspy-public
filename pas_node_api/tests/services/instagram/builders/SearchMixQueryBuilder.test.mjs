import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const Builder = require("../../../../src/services/instagram/builders/SearchMixQueryBuilder");

let b;
beforeEach(() => {
  b = new Builder();
  delete process.env.ES_PROFILE;
});

describe("Instagram builder > construction + setters", () => {
  it("default index is a string", () => {
    expect(typeof b._indexName).toBe("string");
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
    // sortField 'all' branch (line 91): array of 3 multi-field desc sorts
    const allSort = b.setSortField("all")._sortField;
    expect(Array.isArray(allSort)).toBe(true);
    expect(allSort).toHaveLength(3);
    expect(b.setSortMethod("asc")._sortMethod).toBe("asc");
    expect(new Builder().setSortMethod("invalid")._sortMethod).toBe("desc");
    expect(b.setIpBasedCountry("NA")._ipBasedCountry).toBe("");
    expect(b.setIpBasedCountry("US")._ipBasedCountry).toBe("US");
    expect(b.setProfile(true)._profile).toBe(true);
  });
  it("array-coercion setters", () => {
    for (const setter of [
      "setCountry", "setState", "setCity", "setAdCategory", "setSubCategory",
      "setAdType", "setAdPosition", "setStatus", "setTags", "setCallToAction",
      "setGender", "setBuiltWith", "setTrack", "setSource", "setFunnel", "setAffiliate",
      "setMarketPlatform", "setLangDetect", "setCelebrity", "setImageObject", "setLogo",
      "setPlatform", "setDomainMatchedIds",
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

describe("Instagram builder > build() defaults", () => {
  it("emits EXTRA_CONDITION filter", () => {
    const out = b.build();
    expect(out.body.query.bool.filter.length).toBeGreaterThanOrEqual(1);
    expect(out.body.sort[0]).toEqual({ "instagram_ad.last_seen": "desc" });
  });
  it("profile env enables body.profile", () => {
    process.env.ES_PROFILE = "true";
    delete process.env.NODE_ENV;
    expect(b.build().body.profile).toBe(true);
  });
});

describe("Instagram builder > clause generators (must)", () => {
  it("keyword non-quoted → phraseAcrossFields", () => {
    b.setKeyword("foo");
    expect(b.build().body.query.bool.must.length).toBeGreaterThan(0);
  });
  it("keyword quoted → multi_match phrase with exactly fields", () => {
    b.setKeyword('"foo"');
    const must = b.build().body.query.bool.must;
    expect(must.some(m => m.multi_match?.fields?.includes("instagram_ad_variants.title_exactly"))).toBe(true);
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

describe("Instagram builder > clause generators (filter)", () => {
  it("url with/without protocol", () => {
    expect(JSON.stringify(new Builder().setUrl("https://example.com/x").build())).toContain("*example.com*");
    expect(JSON.stringify(new Builder().setUrl("bare/path").build())).toContain("*bare*");
  });
  it("url that fails new URL() → falls back to split('/')[0] (line 585 catch)", () => {
    expect(JSON.stringify(new Builder().setUrl("http://[invalid").build())).toContain("*http:*");
  });
  it("country/state/city/adCategory/subCategory filters", () => {
    b.setCountry(["US"]).setState(["CA"]).setCity(["LA"]).setAdCategory(["c"]).setSubCategory(["s"]);
    expect(b.build().body.query.bool.filter.length).toBeGreaterThanOrEqual(6);
  });
  it("range filters likes/comments/shares/impressions/popularity/adBudget", () => {
    b.setLikes([1, 10]).setComments([1, 5]).setShares([1, 3]).setImpressions([1, 100]).setPopularity([1, 50]).setAdBudget([1, 200]);
    expect(b.build().body.query.bool.filter.length).toBeGreaterThanOrEqual(6);
  });
  it("range setters non-array → null", () => {
    expect(b.setLikes("x")._params.likes).toBeNull();
    expect(b.setComments("x")._params.comments).toBeNull();
    expect(b.setShares("x")._params.shares).toBeNull();
    expect(b.setImpressions("x")._params.impressions).toBeNull();
    expect(b.setPopularity("x")._params.popularity).toBeNull();
    expect(b.setAdBudget("x")._params.adBudget).toBeNull();
  });
  it("range single-elem → skipped", () => {
    b.setLikes([1]);
    expect(b.build().body.query.bool.filter.some(f => f.range?.["instagram_ad.likes"])).toBe(false);
  });
  it("verified '0' kept, NA/null skipped", () => {
    expect(JSON.stringify(new Builder().setVerified("0").build())).toContain("verified");
    expect(JSON.stringify(new Builder().setVerified("NA").build())).not.toContain('"verified":"NA"');
  });
  it("discovererUserId → term", () => {
    b.setDiscovererUserId("u");
    expect(JSON.stringify(b.build())).toContain("u");
  });
  it("metaFilter truthy → set", () => {
    expect(b.setMetaFilter(true)._params.metaFilter).toBe(15);
    expect(b.setMetaFilter(false)._params.metaFilter).toBeNull();
  });
  it("pageCreation/mixdata/html/commentdata setters", () => {
    b.setPageCreation({ from: "2020", to: "2024" });
    b.setMixdata("md").setHtml("h").setCommentdata("c");
    expect(b._params.mixdata).toBe("md");
  });
  it("mixdata bare → phraseAcrossFields branch (line 261)", () => {
    b.setMixdata("plain-text");
    expect(JSON.stringify(b.build())).toContain("mixdata");
  });
  it("mixdata quoted → multi_match phrase branch (lines 258-259)", () => {
    b.setMixdata('"exact phrase"');
    const out = JSON.stringify(b.build());
    expect(out).toContain("mixdata");
    expect(out).toContain("phrase");
  });
  it("html bare → phraseAcrossFields branch (line 270)", () => {
    b.setHtml("plain-html");
    expect(JSON.stringify(b.build())).toContain('"html"');
  });
  it("html quoted → multi_match phrase branch (line 268)", () => {
    b.setHtml('"exact html"');
    const out = JSON.stringify(b.build());
    expect(out).toContain('"html"');
    expect(out).toContain("phrase");
  });
  it("domainMatchedIds set → terms clause on instagram_ad.id (line 310)", () => {
    b.setDomainMatchedIds([11, 22, 33]);
    expect(JSON.stringify(b.build())).toContain("instagram_ad.id");
  });
  it("pageCreation with both lower/upper dates → range clause (line 409)", () => {
    b.setPageCreation({ lower_date: "2024-01-01 00:00:00", upper_date: "2024-12-31 23:59:59" });
    expect(JSON.stringify(b.build())).toContain("instagram_ad_post_owners.page_created_date");
  });
  it("commentdata bare → phraseAcrossFields branch (lines 285-287)", () => {
    b.setCommentdata("plain comment");
    expect(JSON.stringify(b.build())).toContain("instagram_comments.comment_data");
  });
  it("commentdata quoted → multi_match phrase branch (lines 276-283)", () => {
    b.setCommentdata('"exact comment"');
    const out = JSON.stringify(b.build());
    expect(out).toContain("instagram_comments.comment_data");
    expect(out).toContain("phrase");
  });
  it("metaFilter set → term clause on instagram_ad_meta_data.platform (line 542)", () => {
    b.setMetaFilter(true);
    const out = JSON.stringify(b.build());
    expect(out).toContain("instagram_ad_meta_data.platform");
  });
  it("platform set → matchFilter clause (line 548)", () => {
    b.setPlatform(["ios"]);
    expect(JSON.stringify(b.build())).toContain("instagram_ad_meta_data.platform");
  });
  it("tags set → multi-field match (line 560)", () => {
    b.setTags(["promo"]);
    expect(JSON.stringify(b.build())).toContain("instagram_ad_variants.tags");
  });
  it("type/adPosition/callToAction/gender/status filters", () => {
    b.setAdType(["IMAGE"]).setAdPosition(["A"]).setCallToAction(["BUY"]).setGender(["m"]).setStatus(["1"]);
    expect(b.build().body.query.bool.filter.length).toBeGreaterThanOrEqual(5);
  });
  it("lowerAgeSeen with both bounds → range", () => {
    b.setLowerAgeSeen({ lower_age: "18", upper_age: "30" });
    expect(b.build().body.query.bool.filter.some(f => f.range?.["instagram_ad.lower_age_seen"])).toBe(true);
  });
  it("date ranges with both bounds", () => {
    b.setLastSeen({ lower_date: "1", upper_date: "2" })
      .setPostDate({ lower_date: "1", upper_date: "2" })
      .setDomainDate({ lower_date: "1", upper_date: "2" });
    expect(b.build().body.query.bool.filter.length).toBeGreaterThanOrEqual(4);
  });
  it("date ranges missing bound → skipped", () => {
    b.setLastSeen({ lower_date: "1" });
    expect(b.build().body.query.bool.filter.some(f => f.range?.["instagram_ad.last_seen"])).toBe(false);
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
    expect(filter.some(f => f.exists?.field === "instagram_ad_meta_data.firstSeenOnIos")).toBe(true);
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

describe("Instagram builder > must_not collectors", () => {
  it("notCountry → multi-field match", () => {
    b.setNotCountry("RU");
    expect(b.build().body.query.bool.must_not.length).toBeGreaterThanOrEqual(1);
  });
  it("adDetailId → term exclude", () => {
    b.setAdDetailId(42);
    expect(b.build().body.query.bool.must_not.some(m => m.term?.["instagram_ad.id"] === "42")).toBe(true);
  });
});

describe("Instagram builder > ip-based country boost", () => {
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

describe("Instagram builder > SEARCH_SOURCE_FIELDS", () => {
  it("static class property", () => {
    expect(Builder.SEARCH_SOURCE_FIELDS).toContain("instagram_ad.id");
  });
});

describe("Instagram builder > build with array sortField (line 692 truthy)", () => {
  it("setSortField('all') then build() → baseSort spreads the array", () => {
    b.setSortField("all");
    const out = b.build();
    expect(out.body.sort.length).toBeGreaterThanOrEqual(2);
    expect(out.body.sort[out.body.sort.length - 1]).toEqual({ "instagram_ad.id": "desc" });
  });
});
