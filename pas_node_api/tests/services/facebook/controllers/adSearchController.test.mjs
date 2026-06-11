import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── Mock SearchMixQueryBuilder ─────────────────────────────────────────────
const builderPath = require.resolve("../../../../src/services/facebook/builders/SearchMixQueryBuilder");
const builderCalls = [];
function FakeBuilder(indexName) {
  builderCalls.push({ ctor: indexName, calls: [] });
  const self = this;
  const last = builderCalls[builderCalls.length - 1];
  const fluent = (name) => function (...args) { last.calls.push([name, args]); return self; };
  for (const k of [
    "setFrom","setSize","setSortField","setSortMethod","setIpBasedCountry","setStatus","setVerified",
    "setKeyword","setPostOwnerName","setUrl","setCallToAction","setAdCategory","setSubCategory",
    "setCountry","setState","setCity","setAdType","setTags","setLangDetect","setPlatform",
    "setAdPosition","setGender","setLowerAgeSeen","setLastSeen","setPostDate","setDomainDate","setPageCreation",
    "setBuiltWith","setTrack","setSource","setFunnel","setAffiliate","setMarketPlatform",
    "setLikes","setComments","setShares","setPopularity","setImpressions","setAdBudget",
    "setOcr","setCelebrity","setImageObject","setLogo","setHtml","setHtmlContent",
    "setNeedle","setNotCountry","setAdDetailId","setDiscovererUserId","setCommentdata","setMixdata",
  ]) self[k] = fluent(k);
  self.build = vi.fn(() => ({ body: { from: 0, size: 20, query: { match_all: {} } } }));
}
require.cache[builderPath] = {
  id: builderPath, filename: builderPath, loaded: true, exports: FakeBuilder,
};

// ── Mock paramParser ──────────────────────────────────────────────────────
const paramsPath = require.resolve("../../../../src/services/facebook/helpers/paramParser");
const normalizeParams = vi.fn((raw) => raw);
const ensureArray = vi.fn((v) => Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]));
const parsePagination = vi.fn(() => ({ size: 20, from: 0 }));
const parseSort = vi.fn(() => ({ field: "last_seen", order: "desc" }));
const cleanAdsData = vi.fn((rows) => rows);
require.cache[paramsPath] = {
  id: paramsPath, filename: paramsPath, loaded: true,
  exports: { normalizeParams, ensureArray, parsePagination, parseSort, cleanAdsData },
};

// ── Mock searchCursorCache ─────────────────────────────────────────────────
const cursorPath = require.resolve("../../../../src/utils/searchCursorCache");
const buildQueryHash = vi.fn(() => "qhash");
const saveCursor = vi.fn();
const getCursor = vi.fn();
require.cache[cursorPath] = {
  id: cursorPath, filename: cursorPath, loaded: true,
  exports: { SAFE_FROM: 9000, buildQueryHash, saveCursor, getCursor },
};

const { searchAds } = require(
  "../../../../src/services/facebook/controllers/adSearchController"
);

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };

beforeEach(() => {
  builderCalls.length = 0;
  normalizeParams.mockClear().mockImplementation((raw) => raw);
  ensureArray.mockClear().mockImplementation((v) => Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]));
  parsePagination.mockClear().mockImplementation(() => ({ size: 20, from: 0 }));
  parseSort.mockClear().mockImplementation(() => ({ field: "last_seen", order: "desc" }));
  cleanAdsData.mockClear().mockImplementation((rows) => rows);
  buildQueryHash.mockClear().mockImplementation(() => "qhash");
  saveCursor.mockClear();
  getCursor.mockClear();
  fakeLogger.info.mockClear(); fakeLogger.warn.mockClear(); fakeLogger.error.mockClear();
});

describe("services/facebook/controllers/adSearchController > routing", () => {
  it("400 when user_id missing", async () => {
    expect(await searchAds({ body: {}, query: {} }, {}, fakeLogger))
      .toEqual({ code: 400, message: "Missing params: user_id is required" });
  });
  it("favorite='true' routes to searchFavoriteAds", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect((await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger)).message).toBe("No favorite ads found");
  });
  it("hidden='true' routes to searchHiddenAds", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect((await searchAds({ body: { user_id: "u", hidden: "true" }, query: {} }, db, fakeLogger)).message).toBe("No hidden ads found");
  });
  it("503 when db.elastic missing (regular search)", async () => {
    expect(await searchAds({ body: { user_id: "u" }, query: {} }, { elastic: null }, fakeLogger))
      .toEqual({ code: 503, message: "Elasticsearch connection not available" });
  });
  it("bug='true' routes to searchBugAds", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect((await searchAds({ body: { user_id: "u", bug: "true" }, query: {} }, db, fakeLogger)).message).toBe("No bug-reported ads found");
  });
});

describe("services/facebook/controllers/adSearchController > searchBugAds", () => {
  it("503 when sql missing", async () => {
    expect((await searchAds({ body: { user_id: "u", bug: "true" }, query: {} }, { sql: null }, fakeLogger)).code).toBe(503);
  });
  it("no bug ads → 'No bug-reported ads found'", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect((await searchAds({ body: { user_id: "u", bug: "true" }, query: {} }, db, fakeLogger)).message).toBe("No bug-reported ads found");
  });
  it("skip past last page → 'No ads on this page'", async () => {
    const db = { sql: { query: vi.fn(async () => [{ ad_id: 1 }]) } };
    const out = await searchAds({ body: { user_id: "u", bug: "true", skip: "5", take: "20" }, query: {} }, db, fakeLogger);
    expect(out.message).toBe("No ads on this page");
  });
  it("happy path returns bug-reported ads", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [{ ad_id: 1 }];
        return [{ id: 1, ad_id: 1, bug_message: "broken", bug_email: "a@b.com" }];
      })},
    };
    const out = await searchAds({ body: { user_id: "u", bug: "true" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data).toHaveLength(1);
  });
  it("500 when SQL throws", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("sql-fail"); }) } };
    expect((await searchAds({ body: { user_id: "u", bug: "true" }, query: {} }, db, fakeLogger)).code).toBe(500);
  });
});

describe("services/facebook/controllers/adSearchController > searchFavoriteAds", () => {
  it("503 when sql missing", async () => {
    expect((await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, { sql: null }, fakeLogger)).code).toBe(503);
  });
  it("no favorites → empty", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect(await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger))
      .toEqual({ code: 200, data: [], total: 0, message: "No favorite ads found" });
  });
  it("happy path returns ads", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [{ ad_id: 1 }];
        return [{ id: 1, ad_id: 1, type: "TEXT" }];
      })},
    };
    const out = await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data).toHaveLength(1);
  });
  it("enrichAndFilterRows drops IMAGE without NAS url, keeps non-IMAGE + IMAGE-with-url", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [{ ad_id: 1 }, { ad_id: 2 }, { ad_id: 3 }];
        return [
          { id: 1, ad_id: 1, type: "IMAGE" }, // has NAS → keep
          { id: 2, ad_id: 2, type: "IMAGE" }, // no NAS → drop
          { id: 3, ad_id: 3, type: "TEXT" },  // non-IMAGE → keep regardless
        ];
      })},
      elastic: {
        indexName: "facebook",
        search: vi.fn(async () => ({ hits: { hits: [
          { _source: { "facebook_ad.id": 1, new_nas_image_url: "https://x/i.png" } },
          { _source: { "facebook_ad.id": 2 } }, // missing nas url
          { _source: { "facebook_ad.id": 3 } },
        ]}})),
      },
    };
    const out = await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger);
    expect(out.data.map(d => d.ad_id)).toEqual([1, 3]);
  });
  it("500 when SQL throws", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("sql-fail"); }) } };
    expect((await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger)).code).toBe(500);
  });
  it("dedupeRows drops duplicate ad_id rows (line 76)", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [{ ad_id: 1 }, { ad_id: 2 }];
        return [
          { id: 1, ad_id: 1, type: "TEXT" },
          { id: 1, ad_id: 1, type: "TEXT" }, // duplicate ad_id
          { id: 2, ad_id: 2, type: "TEXT" },
        ];
      })},
      elastic: { indexName: "facebook", search: vi.fn(async () => ({ hits: { hits: [] } })) },
    };
    const out = await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger);
    expect(out.data.map(d => d.ad_id)).toEqual([1, 2]);
  });
  it("enrichAndFilterRows: ES returns body.hits shape (line 101 right operand)", async () => {
    // The favorite path skips the main search and only invokes ES via
    // enrichAndFilterRows. Have that single ES call return body.hits instead
    // of top-level hits → exercises line 101's `... || result.body?.hits`.
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ ad_id: 1 }];
        return [{ id: 1, ad_id: 1, type: "IMAGE" }];
      })},
      elastic: {
        indexName: "facebook",
        search: vi.fn(async () => ({
          body: { hits: { hits: [
            { _source: { "facebook_ad.id": 1, new_nas_image_url: "https://x/nas.png" } },
          ]}}
        })),
      },
    };
    const out = await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger);
    expect(out.data.map(d => d.ad_id)).toEqual([1]);
  });
  it("enrichAndFilterRows: ES throws → catch returns original rows (line 121)", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [{ ad_id: 1 }, { ad_id: 2 }];
        return [
          { id: 1, ad_id: 1, type: "IMAGE" },
          { id: 2, ad_id: 2, type: "TEXT" },
        ];
      })},
      elastic: { indexName: "facebook", search: vi.fn(async () => { throw new Error("es-down"); }) },
    };
    const out = await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger);
    expect(out.data.map(d => d.ad_id)).toEqual([1, 2]);
  });
});

describe("services/facebook/controllers/adSearchController > searchHiddenAds", () => {
  it("503 when sql missing", async () => {
    expect((await searchAds({ body: { user_id: "u", hidden: "true" }, query: {} }, { sql: null }, fakeLogger)).code).toBe(503);
  });
  it("no hidden → empty", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect(await searchAds({ body: { user_id: "u", hidden: "true" }, query: {} }, db, fakeLogger))
      .toEqual({ code: 200, data: [], total: 0, message: "No hidden ads found" });
  });
  it("rows without ad_id filtered out → empty", async () => {
    const db = { sql: { query: vi.fn(async () => [{ post_owner_id: "po", type: 1 }]) } };
    expect((await searchAds({ body: { user_id: "u", hidden: "true" }, query: {} }, db, fakeLogger)).total).toBe(0);
  });
  it("happy path attaches hideType + hiddenPostOwnerId", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [
          { ad_id: 1, post_owner_id: "po1", type: 1 },
          { ad_id: 2, post_owner_id: null, type: 2 },
        ];
        return [{ id: 1, ad_id: 1, type: "TEXT" }, { id: 2, ad_id: 2, type: "TEXT" }];
      })},
    };
    const out = await searchAds({ body: { user_id: "u", hidden: "true" }, query: {} }, db, fakeLogger);
    expect(out.data[0].hideType).toBe(1);
    expect(out.data[0].hiddenPostOwnerId).toBe("po1");
    expect(out.data[1].hideType).toBe(2);
  });
  it("ads without meta default to hideType=2", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [{ ad_id: 1, post_owner_id: null, type: 1 }];
        return [{ id: 99, ad_id: 99, type: "TEXT" }];
      })},
    };
    expect((await searchAds({ body: { user_id: "u", hidden: "true" }, query: {} }, db, fakeLogger)).data[0].hideType).toBe(2);
  });
  it("500 when SQL throws", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("sql-fail"); }) } };
    expect((await searchAds({ body: { user_id: "u", hidden: "true" }, query: {} }, db, fakeLogger)).code).toBe(500);
  });
});

describe("services/facebook/controllers/adSearchController > regular searchAds", () => {
  function mkEsHits(hits, total = hits.length) {
    return { hits: { hits, total: { value: total } } };
  }

  it("happy path: ES hits + SQL enrich + market URL block", async () => {
    const esHits = [
      { _source: { ad_id: 1, new_nas_image_url: "https://x/nas.png",
                   "facebook_ad_url.url_destination": "ud",
                   "facebook_ad_outgoing_links.source_url": "src" } },
    ];
    const db = {
      elastic: { indexName: "facebook", search: vi.fn(async () => mkEsHits(esHits)) },
      sql: { query: vi.fn(async () => [{ id: 1, ad_id: 1, type: "TEXT" }]) },
    };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
  });

  it("0 hits → No ads found", async () => {
    const db = { elastic: { search: vi.fn(async () => mkEsHits([])) } };
    expect((await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger)).message).toBe("No ads found");
  });

  it("ES body.hits fallback + total as number", async () => {
    const db = {
      elastic: { search: vi.fn(async () => ({ body: { hits: { hits: [{ _source: { ad_id: 1 } }], total: 1 } } })) },
    };
    expect((await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger)).total).toBe(1);
  });

  it("SQL fetch failure → falls back to ES sources", async () => {
    const esHits = [{ _source: { ad_id: 1, foo: "bar" } }];
    const db = {
      elastic: { search: vi.fn(async () => mkEsHits(esHits)) },
      sql: { query: vi.fn(async () => { throw new Error("sql-fail"); }) },
    };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data[0].foo).toBe("bar");
    expect(fakeLogger.warn).toHaveBeenCalled();
  });

  it("no db.sql → uses ES sources directly", async () => {
    const esHits = [{ _source: { ad_id: 1, foo: "bar" } }];
    const db = { elastic: { search: vi.fn(async () => mkEsHits(esHits)) } };
    expect((await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger)).data[0].foo).toBe("bar");
  });

  it("deep page with cached cursor → search_after", async () => {
    parsePagination.mockReturnValue({ size: 20, from: 9000 });
    getCursor.mockReturnValue(["cv"]);
    const db = { elastic: { search: vi.fn(async () => mkEsHits([])) } };
    await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    const esParams = db.elastic.search.mock.calls[0][0];
    expect(esParams.body.search_after).toEqual(["cv"]);
    expect(esParams.body.from).toBeUndefined();
  });

  it("deep page without cached cursor → caps at SAFE_FROM-size", async () => {
    parsePagination.mockReturnValue({ size: 20, from: 9000 });
    getCursor.mockReturnValue(null);
    const db = { elastic: { search: vi.fn(async () => mkEsHits([])) } };
    await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(db.elastic.search.mock.calls[0][0].body.from).toBe(8980);
  });

  it("500 + logger.error when ES throws", async () => {
    const db = { elastic: { search: vi.fn(async () => { throw new Error("es-down"); }) } };
    expect((await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger)).code).toBe(500);
    expect(fakeLogger.error).toHaveBeenCalled();
  });

  it("invokes builder setters for full filter payload", async () => {
    const db = { elastic: { search: vi.fn(async () => mkEsHits([])) } };
    await searchAds({
      body: {
        user_id: "u",
        status: [1, 2],
        keyword: "k", advertiser: "a", domain: "d.com",
        call_to_action: "Buy", adcategory: "cat", subCategory: "sub", tags: "t",
        country: "US", state: "CA", city: "SF",
        type: "VIDEO", lang: "en", platform: "fb",
        ad_position: "FEED",
        verified: "1",
        discoverer_user_id: "u123",
        gender: "M",
        lower_age: "18", upper_age: "65",
        seen_btn_sort: [1700000000, 1600000000],
        post_date_btn_sort: [1700000000, 1600000000],
        domain_date_btn_sort: [1700000000, 1600000000],
        page_creation: { from: "2020-01-01", to: "2024-01-01" },
        ecommerce: "shopify", track: "ga", source: "src", funnel: "fn", affiliate: "aff", market_platform: "mp",
        likes: [10, 100], comments: [1, 50], shares: [0, 5],
        popularity: [1, 10], impressions: [10, 1000], adBudget: [1, 100],
        ocr: "txt", image_celebrity: "c", image_logo: "l", image_object: "o",
        html: "<div/>", html_content: "h", needle: "n", not_country: "RU",
        commentdata: "cd", mixdata: "md",
        adDetail_id: "ad-detail",
        ipBasedCountry: "US",
      },
      query: {},
    }, db, fakeLogger);
    const setters = builderCalls[0].calls.map(c => c[0]);
    expect(setters).toEqual(expect.arrayContaining([
      "setStatus","setVerified","setKeyword","setPostOwnerName","setUrl","setCallToAction",
      "setAdCategory","setSubCategory","setCountry","setState","setCity","setAdType","setTags",
      "setLangDetect","setPlatform","setAdPosition","setGender",
      "setLowerAgeSeen","setLastSeen","setPostDate","setDomainDate","setPageCreation",
      "setBuiltWith","setTrack","setSource","setFunnel","setAffiliate","setMarketPlatform",
      "setLikes","setComments","setShares","setPopularity","setImpressions","setAdBudget",
      "setOcr","setCelebrity","setLogo","setImageObject","setHtml","setHtmlContent",
      "setNeedle","setNotCountry","setAdDetailId","setDiscovererUserId","setCommentdata","setMixdata",
      "setIpBasedCountry",
    ]));
  });

  it("verified='0' is passed as numeric 0", async () => {
    const db = { elastic: { search: vi.fn(async () => mkEsHits([])) } };
    await searchAds({ body: { user_id: "u", verified: "0" }, query: {} }, db, fakeLogger);
    const v = builderCalls[0].calls.find(c => c[0] === "setVerified");
    expect(v[1][0]).toBe(0);
  });

  it("status: empty array does not call setStatus", async () => {
    const db = { elastic: { search: vi.fn(async () => mkEsHits([])) } };
    await searchAds({ body: { user_id: "u", status: [] }, query: {} }, db, fakeLogger);
    expect(builderCalls[0].calls.find(c => c[0] === "setStatus")).toBeUndefined();
  });

  it("ad_position with == 4 values skips setAdPosition", async () => {
    ensureArray.mockReturnValueOnce(["A", "B", "C", "D"]);
    const db = { elastic: { search: vi.fn(async () => mkEsHits([])) } };
    await searchAds({ body: { user_id: "u", ad_position: ["A","B","C","D"] }, query: {} }, db, fakeLogger);
    expect(builderCalls[0].calls.find(c => c[0] === "setAdPosition")).toBeUndefined();
  });

  it("ad_position empty skips setAdPosition", async () => {
    ensureArray.mockReturnValueOnce([]);
    const db = { elastic: { search: vi.fn(async () => mkEsHits([])) } };
    await searchAds({ body: { user_id: "u", ad_position: "" }, query: {} }, db, fakeLogger);
    expect(builderCalls[0].calls.find(c => c[0] === "setAdPosition")).toBeUndefined();
  });

  it("lower_age without upper_age does not call setLowerAgeSeen", async () => {
    const db = { elastic: { search: vi.fn(async () => mkEsHits([])) } };
    await searchAds({ body: { user_id: "u", lower_age: "18" }, query: {} }, db, fakeLogger);
    expect(builderCalls[0].calls.find(c => c[0] === "setLowerAgeSeen")).toBeUndefined();
  });

  it("non-array engagement filters skipped", async () => {
    const db = { elastic: { search: vi.fn(async () => mkEsHits([])) } };
    await searchAds({
      body: { user_id: "u", likes: "x", comments: 5, shares: { a: 1 }, popularity: "y", impressions: "z", adBudget: false },
      query: {},
    }, db, fakeLogger);
    expect(builderCalls[0].calls.find(c => c[0] === "setLikes")).toBeUndefined();
    expect(builderCalls[0].calls.find(c => c[0] === "setComments")).toBeUndefined();
    expect(builderCalls[0].calls.find(c => c[0] === "setShares")).toBeUndefined();
    expect(builderCalls[0].calls.find(c => c[0] === "setPopularity")).toBeUndefined();
    expect(builderCalls[0].calls.find(c => c[0] === "setImpressions")).toBeUndefined();
    expect(builderCalls[0].calls.find(c => c[0] === "setAdBudget")).toBeUndefined();
  });
});

describe("services/facebook/controllers/adSearchController > ES overlay merge into SQL row", () => {
  function mkEsHits(hits, total = hits.length) {
    return { hits: { hits, total: { value: total } } };
  }

  it("overlays nas_video_url, shares, comments, likes, verified, impression, days_running, call_to_action, popularity", async () => {
    // ES hit keyed by 'facebook_ad.id' (the key esMap.get(String(row.ad_id)) uses)
    const esHits = [{
      _source: {
        "facebook_ad.id": 1,
        new_nas_image_url: "https://cdn/nas.png",
        nas_video_url: "https://cdn/vid.mp4",
        "facebook_ad.shares": 11,
        "facebook_ad.comments": 22,
        "facebook_ad.likes": 33,
        "facebook_ad_post_owners.verified": true,
        "facebook_ad.impression": 444,
        "facebook_ad.days_running": 7,
        "facebook_call_to_actions.action": "SHOP_NOW",
        "facebook_ad.popularity": { current: 75, max: 100 },
      },
    }];
    const db = {
      elastic: { indexName: "facebook", search: vi.fn(async () => mkEsHits(esHits)) },
      sql: { query: vi.fn(async () => [{ id: 1, ad_id: 1, type: "TEXT" }]) },
    };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data[0]).toEqual(expect.objectContaining({
      image_video_url: "https://cdn/nas.png",
      nas_video_url: "https://cdn/vid.mp4",
      share: 11, comment: 22, likes: 33,
      verified: true, impression: 444, days_running: 7,
      call_to_action: "SHOP_NOW",
    }));
    const pop = JSON.parse(out.data[0].popularity);
    expect(pop).toEqual({ max: 100, current: 75 });
  });

  it("ES response with hits.hits missing → esHits defaults to [] (line 484)", async () => {
    // hits is the result.hits object but its .hits field is undefined
    // (only .total is present). The `(hits.hits || [])` fallback fires.
    const db = {
      elastic: { indexName: "facebook", search: vi.fn(async () => ({ hits: { total: { value: 0 } } })) },
      sql: { query: vi.fn() },
    };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.message).toBe("No ads found");
  });

  it("SQL row whose ad_id is not in esMap → returned as-is (line 525)", async () => {
    const esHits = [{ _source: { "facebook_ad.id": 99 } }];
    const db = {
      elastic: { indexName: "facebook", search: vi.fn(async () => mkEsHits(esHits)) },
      // SQL returns rows with ad_id=42, esMap has only 99 → row passes through unmodified
      sql: { query: vi.fn(async () => [{ id: 42, ad_id: 42, type: "TEXT" }]) },
    };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data[0]).toMatchObject({ id: 42, ad_id: 42, type: "TEXT" });
    // None of the ES overlay fields applied:
    expect(out.data[0].share).toBeUndefined();
    expect(out.data[0].image_video_url).toBeUndefined();
  });
});
