import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const Builder = require("../../../../src/services/chatgptads/builders/ChatgptSearchQueryBuilder");

const anyOf = (clauses) => ({ bool: { should: clauses, minimum_should_match: 1 } });

// The clause a keyword adds to `must`.
const keywordClause = (value) => {
  const builder = new Builder("idx");
  builder.setKeyword(value);
  return builder.must[0];
};

// The clause an advertiser adds: `must` when fuzzy, the filter after the status term when exact.
const advertiserClause = (value, exact = false) => {
  const builder = new Builder("idx");
  builder.setPostOwnerName(value, exact);
  return exact ? builder.filter[1] : builder.must[0];
};

describe("chatgptads builder > keyword", () => {
  it("a plain keyword keeps its single cross-fields clause", () => {
    expect(keywordClause("flipkart").bool.should[0].multi_match).toMatchObject({
      query: "flipkart",
      type: "cross_fields",
      operator: "and",
    });
  });

  it("a keyword list ORs the terms, each built exactly like a single keyword", () => {
    expect(keywordClause(["flipkart", "amazon", "canon"])).toEqual(
      anyOf([keywordClause("flipkart"), keywordClause("amazon"), keywordClause("canon")]),
    );
  });

  it("a one-item list gives the same clause as the plain string", () => {
    expect(keywordClause(["flipkart"])).toEqual(keywordClause("flipkart"));
  });

  it("numeric terms keep their ad id clause inside their own alternative", () => {
    expect(keywordClause(["12345", "amazon"])).toEqual(anyOf([keywordClause("12345"), keywordClause("amazon")]));
    expect(JSON.stringify(keywordClause("12345"))).toContain('"ad_id":"12345"');
  });

  it("an empty list adds no keyword clause", () => {
    const builder = new Builder("idx");
    builder.setKeyword(["", " "]);
    expect(builder.must).toEqual([]);
  });

  it("never sends the joined string", () => {
    expect(JSON.stringify(keywordClause(["flipkart", "amazon"]))).not.toContain("flipkart,amazon");
  });
});

describe("chatgptads builder > advertiser", () => {
  it("a fuzzy advertiser list ORs the names as match clauses", () => {
    expect(advertiserClause(["Nike", "Adidas"])).toEqual(anyOf([advertiserClause("Nike"), advertiserClause("Adidas")]));
  });

  it("an exact advertiser list ORs the exact names as filters", () => {
    expect(advertiserClause(["Nike", "Adidas"], true)).toEqual({
      terms: { "post_owner_name.kw": ["Nike", "Adidas"] },
    });
  });

  it("a one-item advertiser list gives the same clause as the plain name", () => {
    expect(advertiserClause(["Nike"])).toEqual(advertiserClause("Nike"));
  });

  it("an empty advertiser list adds no clause", () => {
    const builder = new Builder("idx");
    builder.setPostOwnerName(["", " "], true);
    expect(builder.filter).toEqual([{ term: { status: 1 } }]);
  });
});
