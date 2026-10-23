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
  confirmPhrase,
  captureSearchApiQuery,
  classifyNasValue,
  nasRefsFromSource,
  deleteNasForNetwork,
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

describe("delete-post-owner-ads search-API + NAS", () => {
  it("keyword mode always matches like the search API and needs its own phrase", () => {
    const opts = parseArgs(["--keyword", "weight loss", "--exact-search"]);
    expect(opts).toMatchObject({ keyword: "weight loss", match: "search-api", exactSearch: true, skipNas: false });
    expect(confirmPhrase(opts)).toBe("DELETE_KEYWORD_ADS:weight loss");
    expect(() => parseArgs(["--keyword", "x", "--match", "exact-owner"])).toThrow();
    expect(() => parseArgs(["--keyword", "   "])).toThrow();
  });

  it("post-owner default stays exact-owner; search-api is opt-in", () => {
    expect(parseArgs(["--post-owner", "Nike"]).match).toBe("exact-owner");
    expect(parseArgs(["--post-owner", "Nike", "--match", "search-api"]).match).toBe("search-api");
    expect(confirmPhrase(parseArgs(["--post-owner", "Nike"]))).toBe("DELETE_POST_OWNER_ADS:Nike");
    expect(confirmPhrase(parseArgs(["--post-owner", "Nike", "--keyword", "shoes"]))).toBe("DELETE_SEARCH_ADS:Nike+shoes");
  });

  it("captures the exact query the search controller builds (without running it)", async () => {
    let seenParams;
    const searchAds = async (req, db) => {
      seenParams = req.body;
      await db.elastic.search({ index: "fb_idx", body: { query: { built: req.body.keyword, exact: req.body.exact_search } } });
      return { code: 200 };
    };
    const realSearch = () => { throw new Error("real ES must not be called"); };
    const q = await captureSearchApiQuery("facebook",
      { elastic: { indexName: "fb_idx", search: realSearch } },
      { keyword: "shoes", exactSearch: true },
      { searchAds });
    expect(q).toEqual({ index: "fb_idx", query: { built: "shoes", exact: 1 } });
    expect(seenParams).toMatchObject({ keyword: "shoes", exact_search: 1 });
  });

  it("only treats our own NAS bucket paths as deletable", () => {
    const base = "https://media.example.com";
    expect(classifyNasValue("/pas-prod/stream/fb/adImage/202610/1.webp", base, "pas-prod")).toEqual({ path: "/pas-prod/stream/fb/adImage/202610/1.webp" });
    expect(classifyNasValue(`${base}/pas-prod/stream/yt/video/2.mp4?x=1`, base, "pas-prod")).toEqual({ path: "/pas-prod/stream/yt/video/2.mp4" });
    expect(classifyNasValue("/pas-dev/stream/fb/a.jpg", base, "pas-prod")).toMatchObject({ skip: "other-bucket:pas-dev" });
    expect(classifyNasValue("https://scontent.fbcdn.net/x.jpg", base, "pas-prod")).toBeNull();
    expect(classifyNasValue("/DefaultImage.jpg", base, "pas-prod")).toBeNull();
    expect(classifyNasValue("/PowerAdspy/n2/old/3.jpg", base, "pas-prod")).toEqual({ path: "/PowerAdspy/n2/old/3.jpg" });
  });

  it("finds NAS refs in any field, incl. JSON carousel arrays and the owner image", () => {
    const refs = nasRefsFromSource({
      new_nas_image_url: "/pas-prod/stream/fb/adImage/1.webp",
      nas_video_url: "/pas-prod/stream/fb/adVideo/1.mp4",
      thumbnail_url: "/pas-prod/stream/fb/thumb/1.jpg",
      ad_image_video: JSON.stringify(["/pas-prod/stream/fb/c/1.jpg", "https://cdn.other/x.jpg"]),
      post_owners: { post_owner_image: "/pas-prod/stream/fb/owner/9.jpg" },
      title: "not a path",
    }, "https://media.example.com", "pas-prod");
    expect([...refs.keys()].sort()).toEqual([
      "/pas-prod/stream/fb/adImage/1.webp", "/pas-prod/stream/fb/adVideo/1.mp4", "/pas-prod/stream/fb/c/1.jpg",
      "/pas-prod/stream/fb/owner/9.jpg", "/pas-prod/stream/fb/thumb/1.jpg",
    ]);
  });

  it("deletes unreferenced files and logs every file it keeps, with the reason", async () => {
    const refs = new Map([
      ["/pas-prod/stream/a.jpg", null],
      ["/pas-prod/stream/shared.jpg", null],
      ["/pas-prod/stream/fail.jpg", null],
      ["/pas-dev/stream/b.jpg", "other-bucket:pas-dev"],
    ]);
    const deleted = [];
    const res = await deleteNasForNetwork("facebook", {}, refs, 2, {
      stillReferenced: async (_es, p) => p.includes("shared"),
      deleteFromNas: async (p) => { if (p.includes("fail")) return false; deleted.push(p); return true; },
    });
    expect(deleted).toEqual(["/pas-prod/stream/a.jpg"]);
    expect(res.deleted).toBe(1);
    expect(res.notDeleted.map((x) => x.reason).sort()).toEqual([
      "nas-delete-failed-or-not-configured", "other-bucket:pas-dev", "still-referenced-by-another-ad",
    ]);
  });
});
