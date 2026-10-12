import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { searchAds } = require("../../../../src/services/admob/controllers/adSearchController");

async function searchBody(input) {
  const search = vi.fn(async () => ({ hits: { hits: [], total: { value: 0 } } }));
  await searchAds(
    { body: input },
    { elastic: { indexName: "mob_search_mix", search } },
    { error: vi.fn() },
  );
  return search.mock.calls[0][0].body;
}

describe("admob search > keyword and advertiser lists", () => {
  it("a plain keyword gives one simple_query_string over the keyword fields", async () => {
    const body = await searchBody({ keyword: "flipkart" });
    expect(body.query.bool.must).toEqual([{
      simple_query_string: {
        query: "flipkart",
        fields: ["ad_title^3", "ad_text^2", "newsfeed_description", "post_owner^2", "ad_id", "destination_host"],
        default_operator: "and",
      },
    }]);
  });

  it("an AI Search keyword list ORs one simple_query_string per term", async () => {
    const body = await searchBody({ keyword: ["flipkart", "amazon", "canon"] });
    expect(body.query.bool.must[0].bool.should).toHaveLength(3);
    expect(body.query.bool.must[0].bool.minimum_should_match).toBe(1);
    expect(body.query.bool.must[0].bool.should.map((clause) => clause.simple_query_string.query))
      .toEqual(["flipkart", "amazon", "canon"]);
  });

  it("an advertiser list ORs one simple_query_string per name over post_owner", async () => {
    const body = await searchBody({ advertiser: ["Nike", "Adidas"] });
    expect(body.query.bool.must[0].bool.should).toHaveLength(2);
    expect(body.query.bool.must[0].bool.should.map((clause) => clause.simple_query_string.query))
      .toEqual(["Nike", "Adidas"]);
  });

  it("keyword and advertiser lists remain independent search clauses", async () => {
    const body = await searchBody({ keyword: ["canon"], advertiser: ["Nike", "Adidas"] });
    expect(body.query.bool.must).toHaveLength(2);
    expect(body.query.bool.must[0].simple_query_string.query).toBe("canon");
    expect(body.query.bool.must[1].bool.should).toHaveLength(2);
  });

  it("blank list entries give no clause", async () => {
    const body = await searchBody({ keyword: ["", "  "] });
    expect(body.query.bool.must).toEqual([]);
  });

  it("the NA placeholder is ignored", async () => {
    const body = await searchBody({ keyword: "NA" });
    expect(body.query.bool.must).toEqual([]);
  });

  it("exact advertiser lists use one terms filter", async () => {
    const body = await searchBody({ advertiser: ["Nike", "Adidas"], exact_search: 1 });
    expect(body.query.bool.filter).toContainEqual({
      terms: { "post_owner.keyword": ["nike", "adidas"] },
    });
  });
});
