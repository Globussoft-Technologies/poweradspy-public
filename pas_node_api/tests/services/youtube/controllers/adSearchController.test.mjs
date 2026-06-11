import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── Mock SearchMixQueryBuilder ─────────────────────────────────────────────
const builderPath = require.resolve("../../../../src/services/youtube/builders/SearchMixQueryBuilder");
const builderCalls = [];
function FakeBuilder(indexName) {
  builderCalls.push({ ctor: indexName, calls: [] });
  const self = this;
  const last = builderCalls[builderCalls.length - 1];
  const fluent = (name) => function (...args) { last.calls.push([name, args]); return self; };
  for (const k of [
    "setFrom","setSize","setSortField","setSortMethod","setIpBasedCountry","setStatus",
    "setKeyword","setPostOwnerName","setUrl","setCallToAction","setAdCategory","setSubCategory","setCountry",
    "setAdType","setLangDetect","setAdPosition","setVerified","setDiscovererUserId",
    "setLowerAgeSeen","setLastSeen","setPostDate","setDomainDate",
    "setBuiltWith","setSource","setFunnel","setAffiliate","setMarketPlatform",
    "setLikes","setComments","setDislikes","setViews","setAdBudget",
    "setOcr","setCelebrity","setImageObject","setLogo",
    "setHtmlContent","setNeedle","setNotCountry","setAdDetailId",
  ]) self[k] = fluent(k);
  self.build = vi.fn(() => ({ body: { from: 0, size: 20, query: { match_all: {} } } }));
}
require.cache[builderPath] = {
  id: builderPath, filename: builderPath, loaded: true, exports: FakeBuilder,
};

// ── Mock paramParser ──────────────────────────────────────────────────────
const paramsPath = require.resolve("../../../../src/services/youtube/helpers/paramParser");
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
  "../../../../src/services/youtube/controllers/adSearchController"
);

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

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

describe("services/youtube/controllers/adSearchController > routing", () => {
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

describe("services/youtube/controllers/adSearchController > searchBugAds", () => {
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

describe("services/youtube/controllers/adSearchController > searchFavoriteAds", () => {
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
  it("enrichAndFilterRows drops IMAGE without PowerAdspy, keeps others", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [{ ad_id: 1 }, { ad_id: 2 }, { ad_id: 3 }];
        return [
          { id: 1, ad_id: 1, type: "IMAGE" },
          { id: 2, ad_id: 2, type: "IMAGE" },
          { id: 3, ad_id: 3, type: "TEXT" },
        ];
      })},
      elastic: {
        indexName: "youtube",
        search: vi.fn(async () => ({ hits: { hits: [
          { _source: { ad_id: 1, new_nas_image_url: "https://x/PowerAdspy/i.png" } },
          { _source: { ad_id: 2 } },
          { _source: { ad_id: 3 } },
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
  it("enrichAndFilterRows: ES returns body.hits shape (line 97 right operand)", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ ad_id: 1 }];
        return [{ ad_id: 1, type: "IMAGE" }];
      })},
      elastic: {
        indexName: "youtube",
        search: vi.fn(async () => ({
          body: { hits: { hits: [
            { _source: { ad_id: 1, new_nas_image_url: "https://x/PowerAdspy/img.png" } },
          ]}}
        })),
      },
    };
    const out = await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger);
    expect(out.data.map(d => d.ad_id)).toEqual([1]);
  });
  it("enrichAndFilterRows: ES throws → catch returns original rows (line 114)", async () => {
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
      elastic: { indexName: "youtube", search: vi.fn(async () => { throw new Error("es-down"); }) },
    };
    const out = await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger);
    expect(out.data.map(d => d.ad_id)).toEqual([1, 2]);
  });
});

describe("services/youtube/controllers/adSearchController > searchHiddenAds", () => {
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

describe("services/youtube/controllers/adSearchController > regular searchAds", () => {
  function mkEsHits(hits, total = hits.length) {
    return { hits: { hits, total: { value: total } } };
  }

  it("happy path: ES hits + SQL enrich + market URL block", async () => {
    const esHits = [
      { _source: { ad_id: 1, new_nas_image_url: "https://x/nas.png",
                   "youtube_ad_url.url_destination": "ud",
                   "youtube_ad_outgoing_links.source_url": "src" } },
    ];
    const db = {
      elastic: { indexName: "youtube", search: vi.fn(async () => mkEsHits(esHits)) },
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
        call_to_action: "Buy", adcategory: "cat", subCategory: "sub",
        country: "US", type: "VIDEO", lang: "en",
        ad_position: "FEED",
        verified: "1",
        discoverer_user_id: "u123",
        lower_age: "18", upper_age: "65",
        seen_btn_sort: [1700000000, 1600000000],
        post_date_btn_sort: [1700000000, 1600000000],
        domain_date_btn_sort: [1700000000, 1600000000],
        ecommerce: "shopify", source: "src", funnel: "fn", affiliate: "aff", market_platform: "mp",
        likes: [10, 100], comments: [1, 50], dislikes: [0, 5], views: [10, 1000], adBudget: [1, 100],
        ocr: "txt", image_celebrity: "c", image_logo: "l", image_object: "o",
        html_content: "html", needle: "n", not_country: "RU",
        adDetail_id: "ad-detail",
        ipBasedCountry: "US",
      },
      query: {},
    }, db, fakeLogger);
    const setters = builderCalls[0].calls.map(c => c[0]);
    expect(setters).toEqual(expect.arrayContaining([
      "setStatus","setKeyword","setPostOwnerName","setUrl","setCallToAction",
      "setAdCategory","setSubCategory","setCountry","setAdType","setLangDetect",
      "setAdPosition","setVerified","setDiscovererUserId",
      "setLowerAgeSeen","setLastSeen","setPostDate","setDomainDate",
      "setBuiltWith","setSource","setFunnel","setAffiliate","setMarketPlatform",
      "setLikes","setComments","setDislikes","setViews","setAdBudget",
      "setOcr","setCelebrity","setLogo","setImageObject",
      "setNeedle","setNotCountry","setAdDetailId","setIpBasedCountry",
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

  it("view fallback maps to setViews when views absent", async () => {
    const db = { elastic: { search: vi.fn(async () => mkEsHits([])) } };
    await searchAds({ body: { user_id: "u", view: [10, 100] }, query: {} }, db, fakeLogger);
    expect(builderCalls[0].calls.find(c => c[0] === "setViews")).toBeDefined();
  });

  it("non-array engagement filters skipped", async () => {
    const db = { elastic: { search: vi.fn(async () => mkEsHits([])) } };
    await searchAds({
      body: { user_id: "u", likes: "x", comments: 5, dislikes: { a: 1 }, views: "y", adBudget: false },
      query: {},
    }, db, fakeLogger);
    expect(builderCalls[0].calls.find(c => c[0] === "setLikes")).toBeUndefined();
    expect(builderCalls[0].calls.find(c => c[0] === "setComments")).toBeUndefined();
    expect(builderCalls[0].calls.find(c => c[0] === "setDislikes")).toBeUndefined();
    expect(builderCalls[0].calls.find(c => c[0] === "setViews")).toBeUndefined();
    expect(builderCalls[0].calls.find(c => c[0] === "setAdBudget")).toBeUndefined();
  });
});

describe("services/youtube/controllers/adSearchController > ES overlay merge into SQL row", () => {
  function mkEsHits(hits) {
    return { hits: { hits, total: { value: hits.length } } };
  }

  it("VIDEO ad: thumbnail_url overlays image_video_url + all engagement fields merged (lines 388-406)", async () => {
    const esHits = [{
      _source: {
        ad_id: 1,
        ad_type: "VIDEO",
        thumbnail_url: "https://x/thumb.jpg",
        reactions: { likes: 111 },
        dislikes: 22, comments: 33, views: 4444, verified: true,
        countries: ["US", "IN"], duration: 30, call_to_action: "WATCH",
        text_image_title: "Watch Now",
        "youtube.lowerBudget": 10, "youtube.upperBudget": 100, "youtube.averageBudget": 55,
      },
    }];
    const db = {
      elastic: { indexName: "youtube_search_mix", search: vi.fn(async () => mkEsHits(esHits)) },
      sql: { query: vi.fn(async () => [{ id: 1, ad_id: 1, type: "VIDEO" }]) },
    };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data[0]).toEqual(expect.objectContaining({
      image_video_url: "https://x/thumb.jpg",
      likes: 111, dislikes: 22, comment: 33, view: 4444, verified: true,
      countries: ["US", "IN"], days_running: 30, call_to_action: "WATCH",
      text_image_title: "Watch Now",
      lowerBudget: 10, upperBudget: 100, averageBudget: 55,
    }));
  });

  it("non-VIDEO ad falls back to new_nas_image_url for image_video_url (line 390)", async () => {
    const esHits = [{
      _source: { ad_id: 2, ad_type: "DISPLAY", new_nas_image_url: "https://x/nas.png" },
    }];
    const db = {
      elastic: { indexName: "youtube_search_mix", search: vi.fn(async () => mkEsHits(esHits)) },
      sql: { query: vi.fn(async () => [{ id: 2, ad_id: 2, type: "DISPLAY" }]) },
    };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.data[0].image_video_url).toBe("https://x/nas.png");
  });

  it("SQL row with ad_id not in esMap → passes through unchanged (line 382)", async () => {
    const esHits = [{ _source: { ad_id: 99 } }];
    const db = {
      elastic: { indexName: "youtube_search_mix", search: vi.fn(async () => mkEsHits(esHits)) },
      sql: { query: vi.fn(async () => [{ id: 42, ad_id: 42, type: "VIDEO" }]) },
    };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.data[0]).toMatchObject({ id: 42, ad_id: 42, type: "VIDEO" });
    expect(out.data[0].likes).toBeUndefined();
  });
});
