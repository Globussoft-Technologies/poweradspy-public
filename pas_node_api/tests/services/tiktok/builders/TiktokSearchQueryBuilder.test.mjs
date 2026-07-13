import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const Builder = require("../../../../src/services/tiktok/builders/TiktokSearchQueryBuilder");

let b;
beforeEach(() => { b = new Builder("test_index"); delete process.env.ES_PROFILE; });

describe("TiktokSearchQueryBuilder > construction + setters", () => {
  it("default index from env when constructor arg missing", () => {
    const def = new Builder();
    expect(def._indexName).toBe(process.env.TT_ELASTIC_INDEX || "tiktok_ads");
  });
  it("setFrom/setSize coerce + default", () => {
    expect(b.setFrom("5")._from).toBe(5);
    expect(b.setFrom("bogus")._from).toBe(0);
    expect(b.setSize("50")._size).toBe(50);
    expect(b.setSize("bogus")._size).toBe(20);
  });
  it("setSortField + setSortMethod (validates asc/desc only)", () => {
    expect(b.setSortField("likes")._sortField).toBe("likes");
    expect(b.setSortMethod("asc")._sortMethod).toBe("asc");
    // invalid value is silently ignored — keeps last valid setting
    const b2 = new Builder();
    expect(b2.setSortMethod("invalid")._sortMethod).toBe("desc");
  });
  it("setProfile chains", () => {
    expect(b.setProfile(true)._profile).toBe(true);
  });
  it("array-coercion setters", () => {
    expect(b.setIndustry("x")._params.industry).toEqual(["x"]);
    expect(b.setCountry(["a", "b"])._params.country).toEqual(["a", "b"]);
    expect(b.setGender("m")._params.gender).toEqual(["m"]);
    expect(b.setAge(["18-24"])._params.age).toEqual(["18-24"]);
    expect(b.setBudget("Low")._params.budget).toEqual(["Low"]);
    expect(b.setLanguage("en")._params.language).toEqual(["en"]);
  });
  it("setCountry(string) / setAge(string) falsy branches of Array.isArray (lines 55, 57)", () => {
    // String input → Array.isArray(v) is false → wraps in [v]
    expect(b.setCountry("US")._params.country).toEqual(["US"]);
    expect(b.setAge("18-24")._params.age).toEqual(["18-24"]);
  });
  it("simple value setters", () => {
    b.setKeyword("k").setAdvertiser("a").setDomain("d");
    expect(b._params.keyword).toBe("k");
    b.setLikes({ min: 0 }).setComments({ min: 0 }).setShares({ min: 0 });
    b.setPopularity({ min: 0 }).setImpression({ min: 0 }).setCtr({ min: 0 });
    b.setAdSeen({ startDate: "x", endDate: "y" });
    b.setPostDate({ startDate: "x", endDate: "y" });
    b.setDomainDate({ startDate: "x", endDate: "y" });
    expect(b._params.adSeen.startDate).toBe("x");
  });
});

describe("TiktokSearchQueryBuilder > build() empty query", () => {
  it("returns match_all when no filters", () => {
    const out = b.build();
    expect(out.index).toBe("test_index");
    expect(out.body.query.bool.must[0]).toEqual({ match_all: {} });
    expect(out.body.from).toBe(0);
    expect(out.body.size).toBe(20);
    expect(out.body.aggs.total_ads.cardinality.field).toBe("sql_id");
    expect(out.body.collapse).toEqual({ field: "sql_id" });
  });
  it("profile=true triggers body.profile", () => {
    process.env.ES_PROFILE = "true";
    delete process.env.NODE_ENV;
    expect(b.build().body.profile).toBe(true);
  });
});

describe("TiktokSearchQueryBuilder > clause generators", () => {
  it("keyword → bool.should with 4 word-boundary regexps (must context)", () => {
    b.setKeyword("Foo");
    const out = b.build();
    const should = out.body.query.bool.must[0].bool.should;
    expect(should).toHaveLength(4);
    // Whole-word regexp (lowercased), not a `*foo*` substring wildcard.
    const value = "(.*[^a-z0-9])?foo([^a-z0-9].*)?";
    expect(should[0].regexp["ad_title.keyword"].value).toBe(value);
    expect(should.map(s => Object.keys(s.regexp)[0])).toEqual([
      "ad_title.keyword", "industry", "post_owner", "target_keywords",
    ]);
    // The regexp is anchored to the whole term (Lucene), so it matches "foo"
    // as a standalone word but not mid-word occurrences like "foobar"/"buffoo".
    const re = new RegExp("^" + value + "$");
    expect(re.test("the foo bar")).toBe(true);
    expect(re.test("foo")).toBe(true);
    expect(re.test("foobar")).toBe(false);
    expect(re.test("buffoon")).toBe(false);
  });

  it("keyword regexp escapes Lucene special chars", () => {
    b.setKeyword("c++");
    const value = b.build().body.query.bool.must[0].bool.should[0].regexp["ad_title.keyword"].value;
    expect(value).toBe("(.*[^a-z0-9])?c\\+\\+([^a-z0-9].*)?");
    // Still a valid, compilable pattern.
    expect(() => new RegExp("^" + value + "$")).not.toThrow();
  });
  it("advertiser → prefix in filter", () => {
    b.setAdvertiser("BrandX");
    const out = b.build();
    expect(out.body.query.bool.filter[0]).toEqual({ prefix: { post_owner: "brandx" } });
  });
  it("domain → wildcard with stripped protocol/path/TLD", () => {
    b.setDomain("https://www.example.com/path");
    const out = b.build();
    expect(out.body.query.bool.filter[0].wildcard.destination_url.value).toBe("*www.example*");
  });
  it("industry/country/budget/language → terms filter", () => {
    b.setIndustry(["a", "b"]).setCountry(["US"]).setBudget(["Low"]).setLanguage(["en"]);
    const filters = b.build().body.query.bool.filter;
    expect(filters.some(f => JSON.stringify(f).includes("industry"))).toBe(true);
    expect(filters.some(f => JSON.stringify(f).includes("countries"))).toBe(true);
    expect(filters.some(f => JSON.stringify(f).includes("budget"))).toBe(true);
    expect(filters.some(f => JSON.stringify(f).includes("language"))).toBe(true);
  });
  it("gender → bool.should with gender.gender_details.{x}", () => {
    b.setGender(["male"]);
    const f = b.build().body.query.bool.filter[0];
    expect(f.bool.should[0]).toEqual({ term: { "gender.gender_details.male": "1" } });
  });
  it("age 'Above 55' → maps to 55+ key", () => {
    b.setAge(["Above 55", "18-24"]);
    const f = b.build().body.query.bool.filter[0];
    expect(f.bool.should[0]).toEqual({ term: { "age.age_details.55+": "1" } });
    expect(f.bool.should[1]).toEqual({ term: { "age.age_details.18-24": "1" } });
  });
  it("range setters use defaults when missing", () => {
    b.setLikes({}); // no min/max → defaults [0, 10000000]
    const f = b.build().body.query.bool.filter[0];
    expect(f.range.likes.gte).toBe(0);
    expect(f.range.likes.lte).toBe(10000000);
  });
  it("range setters use provided min/max", () => {
    b.setLikes({ min: 5, max: 50 });
    expect(b.build().body.query.bool.filter[0].range.likes).toEqual({ gte: 5, lte: 50 });
  });
  it("ctr divides values by 100", () => {
    b.setCtr({ min: 5, max: 50 });
    expect(b.build().body.query.bool.filter[0].range.ctr).toEqual({ gte: 0.05, lte: 0.5 });
  });
  it("ctr without max falls back to 100000000", () => {
    b.setCtr({ min: 1 });
    expect(b.build().body.query.bool.filter[0].range.ctr.lte).toBe(100000000);
  });
  it("ctr no min defaults to 0", () => {
    b.setCtr({ max: 10 });
    expect(b.build().body.query.bool.filter[0].range.ctr.gte).toBe(0);
  });
  it("adSeen/postDate/domainDate range with start+end", () => {
    b.setAdSeen({ startDate: "2024-01-01", endDate: "2024-12-31" });
    expect(b.build().body.query.bool.filter[0].range.last_seen.gte).toBe("2024-01-01");
  });
  it("date range without start/end → null (skipped)", () => {
    b.setAdSeen({ startDate: "2024-01-01" }); // missing endDate
    const out = b.build();
    // no range clause emitted (the always-on video_cover existence gate is present)
    expect((out.body.query.bool.filter || []).some(f => f.range)).toBe(false);
  });
  it("empty-array filters skipped", () => {
    b.setIndustry([]).setCountry([]).setBudget([]).setLanguage([]).setGender([]).setAge([]);
    const out = b.build();
    expect(out.body.query.bool.must[0]).toEqual({ match_all: {} });
  });
  it("falsy single values skipped", () => {
    b.setAdvertiser("").setDomain(null).setKeyword(undefined);
    const out = b.build();
    expect(out.body.query.bool.must[0]).toEqual({ match_all: {} });
  });
});

describe("TiktokSearchQueryBuilder > SEARCH_SOURCE_FIELDS", () => {
  it("static class property", () => {
    expect(Builder.SEARCH_SOURCE_FIELDS).toContain("sql_id");
    expect(Builder.SEARCH_SOURCE_FIELDS).toContain("likes");
  });
});
