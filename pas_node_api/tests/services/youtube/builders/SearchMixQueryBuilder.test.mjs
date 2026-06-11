import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// config/networks is read at module load — pre-stub
const netPath = require.resolve("../../../../src/config/networks");
require.cache[netPath] = {
  id: netPath, filename: netPath, loaded: true,
  exports: { youtube: { database: { elastic: { index: "yt_test_idx" } } } },
};

const Builder = require("../../../../src/services/youtube/builders/SearchMixQueryBuilder");

let b;
beforeEach(() => {
  b = new Builder();
  delete process.env.ES_PROFILE;
});

describe("YouTube SearchMixQueryBuilder > construction + setters", () => {
  it("default index from config.networks", () => {
    expect(b._indexName).toBe("yt_test_idx");
  });
  it("explicit index overrides default", () => {
    expect(new Builder("custom")._indexName).toBe("custom");
  });
  it("setFrom/setSize/sort fields/sort method coerce", () => {
    expect(b.setFrom("9")._from).toBe(9);
    expect(b.setFrom("bogus")._from).toBe(0);
    expect(b.setSize("3")._size).toBe(3);
    expect(b.setSize("bogus")._size).toBe(20);
    expect(b.setSortField("likes")._sortField).toBe("likes");
    expect(b.setSortMethod("asc")._sortMethod).toBe("asc");
    expect(new Builder().setSortMethod("invalid")._sortMethod).toBe("desc");
  });
  it("setIpBasedCountry handles NA → empty", () => {
    expect(b.setIpBasedCountry("NA")._ipBasedCountry).toBe("");
    expect(b.setIpBasedCountry("US")._ipBasedCountry).toBe("US");
  });
  it("setProfile chains", () => {
    expect(b.setProfile(true)._profile).toBe(true);
  });
  it("array-coercion setters work", () => {
    expect(b.setCountry("US")._params.country).toEqual(["US"]);
    expect(b.setAdType(["A"])._params.type).toEqual(["A"]);
    expect(b.setAdPosition("FEED")._params.adPosition).toEqual(["FEED"]);
    expect(b.setStatus("1")._params.status).toEqual(["1"]);
    expect(b.setCallToAction("BUY")._params.callToAction).toEqual(["BUY"]);
    expect(b.setAdCategory("c")._params.adCategory).toEqual(["c"]);
    expect(b.setSubCategory("s")._params.subCategory).toEqual(["s"]);
    expect(b.setTags("t")._params.tags).toEqual(["t"]);
    expect(b.setBuiltWith("bw")._params.builtWith).toEqual(["bw"]);
    expect(b.setSource("src")._params.source).toEqual(["src"]);
    expect(b.setFunnel("f")._params.funnel).toEqual(["f"]);
    expect(b.setAffiliate("a")._params.affiliate).toEqual(["a"]);
    expect(b.setMarketPlatform("mp")._params.marketPlatform).toEqual(["mp"]);
    expect(b.setLangDetect("en")._params.langDetect).toEqual(["en"]);
    expect(b.setCelebrity("c")._params.celebrity).toEqual(["c"]);
    expect(b.setImageObject("o")._params.imageObject).toEqual(["o"]);
    expect(b.setLogo("l")._params.logo).toEqual(["l"]);
  });
  it("simple value setters", () => {
    b.setKeyword("kw").setPostOwnerName("po").setUrl("u").setVerified("1").setDiscovererUserId("d");
    b.setNotCountry("RU").setAdDetailId("a1");
    b.setNeedle("NA");
    expect(b._params.needle).toBe("");
    b.setNeedle("ndl");
    expect(b._params.needle).toBe("ndl");
    b.setOcr("o");
    b.setLastSeen({}).setPostDate({}).setDomainDate({}).setLowerAgeSeen({});
  });
  it("range setters with non-array → null", () => {
    expect(b.setLikes("x")._params.likes).toBeNull();
    expect(b.setLikes([1, 100])._params.likes).toEqual([1, 100]);
  });
  it("setAdType(string) → falsy branch of Array.isArray (line 62)", () => {
    expect(b.setAdType("IMAGE")._params.type).toEqual(["IMAGE"]);
  });
  it("setTags(array) → truthy branch of Array.isArray (line 68)", () => {
    expect(b.setTags(["t1", "t2"])._params.tags).toEqual(["t1", "t2"]);
  });
  it("setComments/setViews/setDislikes/setAdBudget non-array → null (lines 86-89 falsy)", () => {
    // setLikes is already covered via line-73 test. The other range setters
    // share the same Array.isArray ternary at lines 86-89 — exercise their
    // non-array (falsy) branches explicitly.
    expect(b.setComments("x")._params.comments).toBeNull();
    expect(b.setViews("x")._params.views).toBeNull();
    expect(b.setDislikes("x")._params.dislikes).toBeNull();
    expect(b.setAdBudget("x")._params.adBudget).toBeNull();
  });
});

describe("YouTube SearchMixQueryBuilder > build() default", () => {
  it("emits displayable-media gate + empty ad_type must_not", () => {
    const out = b.build();
    expect(out.index).toBe("yt_test_idx");
    // The displayable-media gate is always applied as a filter clause (so the
    // old match_all fallback no longer fires). Confirm the VIDEO/DISCOVERY
    // branch — which requires thumbnail_url — is present.
    expect(
      out.body.query.bool.filter.some(f =>
        f.bool?.should?.some(s =>
          s.bool?.filter?.some(ff => ff.exists?.field === 'thumbnail_url')
        )
      )
    ).toBe(true);
    expect(out.body.query.bool.must_not.length).toBeGreaterThanOrEqual(1);
    expect(out.body.query.bool.must_not).toContainEqual({ term: { 'ad_type.keyword': '' } });
    expect(out.body.sort[0]).toEqual({ last_seen: "desc" });
    expect(out.body.sort[1]).toEqual({ ad_id: "desc" });
  });
  it("profile env enables body.profile", () => {
    process.env.ES_PROFILE = "true";
    delete process.env.NODE_ENV;
    expect(b.build().body.profile).toBe(true);
  });
});

describe("YouTube SearchMixQueryBuilder > clause generators", () => {
  it("keyword non-quoted → phrase across fields (must)", () => {
    b.setKeyword("foo");
    const out = b.build();
    expect(JSON.stringify(out)).toContain("phrase");
  });
  it("keyword quoted → multi_match phrase, strips quotes", () => {
    b.setKeyword('"hello world"');
    const must = b.build().body.query.bool.must;
    expect(must.some(m => m.multi_match?.query === "hello world")).toBe(true);
  });
  it("postOwnerName non-quoted → bool.should with phrase+prefix", () => {
    b.setPostOwnerName("brand");
    const must = b.build().body.query.bool.must;
    expect(must.some(m => m.bool?.should?.some(s => s.prefix?.post_owner === "brand"))).toBe(true);
  });
  it("postOwnerName quoted → multi_match phrase only", () => {
    b.setPostOwnerName('"Brand X"');
    const must = b.build().body.query.bool.must;
    expect(must.some(m => m.multi_match?.query === "Brand X")).toBe(true);
  });
  it("ocr quoted/non-quoted both work", () => {
    b.setOcr("text");
    expect(b.build().body.query.bool.must.length).toBeGreaterThan(0);
    const b2 = new Builder().setOcr('"phrase"');
    expect(b2.build().body.query.bool.must.length).toBeGreaterThan(0);
  });
  it("celebrity/imageObject/logo → multi-field match in must", () => {
    b.setCelebrity(["jeff"]).setImageObject(["car"]).setLogo(["nike"]);
    const must = b.build().body.query.bool.must;
    expect(must.length).toBeGreaterThanOrEqual(3);
  });
  it("url with protocol → wildcard on extracted hostname", () => {
    b.setUrl("https://example.com/path");
    const filters = b.build().body.query.bool.filter;
    expect(filters.some(f => f.wildcard?.ad_url === "*example.com*")).toBe(true);
  });
  it("url without protocol → wildcard on first path segment", () => {
    b.setUrl("bare-url");
    const filters = b.build().body.query.bool.filter;
    expect(filters.some(f => f.wildcard?.ad_url === "*bare-url*")).toBe(true);
  });
  it("url that fails new URL() → falls back to split('/')[0] (line 162 catch)", () => {
    b.setUrl("http://[invalid");
    const filters = b.build().body.query.bool.filter;
    expect(filters.some(f => f.wildcard?.ad_url === "*http:*")).toBe(true);
  });
  it("country (multi-field match)", () => {
    b.setCountry(["US", "IN"]);
    expect(b.build().body.query.bool.filter.length).toBeGreaterThan(0);
  });
  it("type, adPosition (skipped when 4), status, callToAction filters", () => {
    b.setAdType(["IMAGE"]).setAdPosition(["A", "B"]).setStatus(["1", "2"]).setCallToAction(["BUY"]);
    expect(b.build().body.query.bool.filter.length).toBeGreaterThanOrEqual(4);
  });
  it("adPosition with 4 values is skipped", () => {
    b.setAdPosition(["A", "B", "C", "D"]);
    const filters = b.build().body.query.bool.filter || [];
    expect(filters.some(f => JSON.stringify(f).includes("ad_position"))).toBe(false);
  });
  it("verified '0' → term verified=0", () => {
    b.setVerified("0");
    expect(b.build().body.query.bool.filter.some(f => f.term?.verified === "0")).toBe(true);
  });
  it("verified NA/empty/null → skipped", () => {
    b.setVerified("NA");
    let out = b.build();
    expect(out.body.query.bool.filter || []).toEqual(expect.not.arrayContaining([{ term: { verified: "NA" } }]));
    b = new Builder().setVerified(null);
    // filter still carries the always-on media gate, but no `verified` clause
    expect((b.build().body.query.bool.filter || []).some(f => f.term?.verified !== undefined)).toBe(false);
  });
  it("discovererUserId → term", () => {
    b.setDiscovererUserId("u");
    expect(b.build().body.query.bool.filter.some(f => f.term?.discoverer_user_id === "u")).toBe(true);
  });
  it("lowerAgeSeen with both bounds → range", () => {
    b.setLowerAgeSeen({ lower_age: "18", upper_age: "30" });
    expect(b.build().body.query.bool.filter.some(f => f.range?.lower_age_seen)).toBe(true);
  });
  it("date ranges with both bounds emit ranges", () => {
    b.setLastSeen({ lower_date: "1", upper_date: "2" });
    b.setPostDate({ lower_date: "1", upper_date: "2" });
    b.setDomainDate({ lower_date: "1", upper_date: "2" });
    const out = b.build();
    expect(out.body.query.bool.filter.length).toBeGreaterThanOrEqual(3);
  });
  it("date ranges missing bounds → skipped", () => {
    b.setLastSeen({ lower_date: "1" });
    // no last_seen range clause emitted (the always-on media gate may be present)
    expect((b.build().body.query.bool.filter || []).some(f => f.range?.last_seen)).toBe(false);
  });
  it("needle without ipBasedCountry → range emitted", () => {
    b.setNeedle("1700000000");
    expect(b.build().body.query.bool.filter.some(f => f.range?.last_seen?.lt === "1700000000")).toBe(true);
  });
  it("needle WITH ipBasedCountry + from<10000 + no country → SKIPPED", () => {
    b.setNeedle("1700000000").setIpBasedCountry("US").setFrom("0");
    const out = b.build();
    // The country boost wraps the query — assert no needle range deep inside
    expect(JSON.stringify(out)).not.toContain('"lt":"1700000000"');
  });
  it("needle with country present → not skipped", () => {
    b.setNeedle("1700000000").setIpBasedCountry("US").setCountry(["US"]).setFrom("0");
    const out = b.build();
    expect(JSON.stringify(out)).toContain('"lt":"1700000000"');
  });
  it("adCategory/subCategory terms", () => {
    b.setAdCategory(["c"]).setSubCategory(["s"]);
    expect(b.build().body.query.bool.filter.length).toBeGreaterThanOrEqual(2);
  });
  it("builtWith/source/funnel/affiliate/langDetect match filters", () => {
    b.setBuiltWith(["shopify"]).setSource(["src"]).setFunnel(["f"]).setAffiliate(["a"]).setLangDetect(["en"]);
    expect(b.build().body.query.bool.filter.length).toBeGreaterThanOrEqual(5);
  });
  it("marketPlatform → bool.should wildcards", () => {
    b.setMarketPlatform(["mp"]);
    expect(b.build().body.query.bool.filter.some(f =>
      f.bool?.should?.some(s => s.wildcard?.redirect_urls?.value === "*mp*"))).toBe(true);
  });
  it("range filters (likes/comments/views/dislikes/adBudget)", () => {
    b.setLikes([1, 100]).setComments([1, 50]).setViews([1, 500]).setDislikes([1, 10]).setAdBudget([1, 200]);
    expect(b.build().body.query.bool.filter.length).toBeGreaterThanOrEqual(5);
  });
  it("range filters single-element array → skipped", () => {
    b.setLikes([1]);
    const filters = b.build().body.query.bool.filter || [];
    expect(filters.some(f => f.range?.["reactions.likes"])).toBe(false);
  });
});

describe("YouTube SearchMixQueryBuilder > must_not collectors", () => {
  it("notCountry → adds must_not clause", () => {
    b.setNotCountry("RU");
    // After source change: default has 1 must_not + notCountry adds 1 more = ≥2
    expect(b.build().body.query.bool.must_not.length).toBeGreaterThanOrEqual(2);
  });
  it("adDetailId → term exclude", () => {
    b.setAdDetailId(123);
    expect(b.build().body.query.bool.must_not.some(m => m.term?.id === "123")).toBe(true);
  });
});

describe("YouTube SearchMixQueryBuilder > ip-based country boost", () => {
  it("wraps with country boost when ipBasedCountry set", () => {
    b.setIpBasedCountry("us");
    const out = b.build();
    // boost should appear in the inner should
    expect(JSON.stringify(out)).toContain("constant_score");
  });
  it("isPriorityOffset → adds _score sort prefix", () => {
    b.setIpBasedCountry("us").setFrom("0");
    const out = b.build();
    expect(out.body.sort[0]).toEqual({ _score: "desc" });
  });
  it("from >= 10000 → no _score sort prefix", () => {
    b.setIpBasedCountry("us").setFrom("20000");
    const out = b.build();
    expect(out.body.sort[0]).not.toEqual({ _score: "desc" });
  });
});

describe("YouTube SearchMixQueryBuilder > SEARCH_SOURCE_FIELDS", () => {
  it("includes core fields", () => {
    expect(Builder.SEARCH_SOURCE_FIELDS).toContain("ad_id");
    expect(Builder.SEARCH_SOURCE_FIELDS).toContain("countries");
  });
});
