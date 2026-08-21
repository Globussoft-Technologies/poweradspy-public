import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  DEFAULT_NETWORKS,
  parseArgs,
  parseExpectedCounts,
  sourceMatchesOwner,
  discoverSqlAds,
  discoverEsHits,
  deleteEsDrivenAdsOneByOne,
} = require("../../scripts/delete-post-owner-ads");

describe("delete-post-owner-ads safety parsing", () => {
  it("defaults to dry-run across all 11 searchable networks", () => {
    const opts = parseArgs(["--post-owner", "TwinklingTree"]);
    expect(opts.apply).toBe(false);
    expect(opts.networks).toEqual(DEFAULT_NETWORKS);
    expect(opts.networks).toContain("tiktok");
  });

  it("parses a restricted network list and exact expected counts", () => {
    const opts = parseArgs([
      "--post-owner", "TwinklingTree",
      "--networks", "facebook,google",
      "--apply",
      "--confirm", "DELETE_POST_OWNER_ADS:TwinklingTree",
      "--expected-counts", "facebook=221,google=23",
      "--concurrency", "2",
    ]);
    expect(opts).toMatchObject({
      apply: true,
      networks: ["facebook", "google"],
      expectedCounts: { facebook: 221, google: 23 },
      concurrency: 2,
    });
  });

  it("accepts all networks without an extra Instagram flag", () => {
    const opts = parseArgs([
      "--post-owner", "Viral Home Finds",
      "--networks", "all",
    ]);
    expect(opts.networks).toContain("instagram");
    expect(opts.networks).toEqual(DEFAULT_NETWORKS);
  });

  it("rejects malformed or duplicate expected counts", () => {
    expect(() => parseExpectedCounts("facebook=abc")).toThrow();
    expect(() => parseExpectedCounts("facebook=1,facebook=2")).toThrow();
    expect(() => parseExpectedCounts("unknown=1")).toThrow();
  });

  it("rejects unknown arguments and unsafe concurrency", () => {
    expect(() => parseArgs(["--post-owner", "x", "--wat"])).toThrow("Unknown argument");
    expect(() => parseArgs(["--post-owner", "x", "--concurrency", "5"])).toThrow();
  });

  it("checks ES source owner with exact normalized matching", () => {
    const fields = ["facebook_ad_post_owners.post_owner_name"];
    expect(sourceMatchesOwner(
      { "facebook_ad_post_owners.post_owner_name": "  TWINKLINGTREE " },
      fields,
      "twinklingtree"
    )).toBe(true);
    expect(sourceMatchesOwner(
      { facebook_ad_post_owners: { post_owner_name: "TwinklingTree Store" } },
      fields,
      "twinklingtree"
    )).toBe(false);
  });

  it("derives Instagram SQL IDs from ES without querying its large SQL tables", async () => {
    const rows = await discoverSqlAds({
      query: async () => { throw new Error("must not query SQL"); },
    }, {
      esDrivenOneByOne: true,
      internalIdFields: ["instagram_ad.id"],
    }, [
      { _source: { "instagram_ad.id": 11 } },
      { _source: { "instagram_ad.id": 11 } },
      { _source: { "instagram_ad.id": 12 } },
    ]);
    expect(rows).toEqual([{ id: 11 }, { id: 12 }]);
  });

  it("uses Instagram Search API builder matches without base-owner filtering", async () => {
    class SearchBuilder {
      setFrom() { return this; }
      setSize() { return this; }
      setPostOwnerName(value) { this.owner = value; return this; }
      build() { return { body: { query: { api_owner: this.owner } } }; }
    }
    let query;
    const hit = {
      _id: "translated-hit",
      _source: {
        "instagram_ad.id": 91,
        "instagram_ad_post_owners.post_owner_name": "translated value",
      },
    };
    const result = await discoverEsHits({
      indexName: "instagram_search_mix",
      search: async (request) => {
        query = request.body.query;
        return { hits: { total: 1, hits: [hit] } };
      },
    }, {
      searchBuilder: SearchBuilder,
      ownerSourceFields: ["instagram_ad_post_owners.post_owner_name"],
      ownerQueryFields: ["instagram_ad_post_owners.post_owner_name"],
      internalIdFields: ["instagram_ad.id"],
    }, "Viral Home Finds", true);
    expect(query).toEqual({ api_owner: "Viral Home Finds" });
    expect(result).toEqual([hit]);
  });

  it("deletes each Instagram SQL ID before its exact ES document", async () => {
    const events = [];
    const spec = {
      internalIdFields: ["instagram_ad.id"],
      repository: {
        withTransaction: async (_sql, fn) => fn({ query: async (_q, p) => {
          events.push(`sql:${p[0]}`);
          return { affectedRows: 1 };
        } }),
        deleteAdCascade: async (tx, id) => tx.query("DELETE", [id]),
      },
    };
    const db = {
      sql: {},
      elastic: {
        indexName: "instagram_search_mix",
        esMajor: 6,
        client: { indices: { refresh: async () => events.push("refresh") } },
        bulk: async ({ body }) => {
          events.push(`es:${body[0].delete._id}`);
          return { items: [{ delete: { status: 200 } }] };
        },
      },
    };
    await deleteEsDrivenAdsOneByOne(spec, db, [
      { _id: "doc-1", _type: "doc", _source: { "instagram_ad.id": 11 } },
      { _id: "doc-2", _type: "doc", _source: { "instagram_ad.id": 12 } },
    ], "instagram", 1);
    expect(events).toEqual(["sql:11", "es:doc-1", "sql:12", "es:doc-2", "refresh"]);
  });
});
