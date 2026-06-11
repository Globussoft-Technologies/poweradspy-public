import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── Mock LinkedinSearchQueryBuilder (`new`-invoked, fluent) ──────────────
const builderPath = require.resolve("../../../../src/services/linkedin/builders/LinkedinSearchQueryBuilder");
const builderCalls = [];
function FakeBuilder(indexName) {
  builderCalls.push({ ctor: indexName, calls: [] });
  const self = this;
  const last = builderCalls[builderCalls.length - 1];
  const fluent = (name) => function (...args) { last.calls.push([name, args]); return self; };
  for (const k of [
    "setFrom","setSize","setSortField","setSortMethod","setIpBasedCountry","setStatus","setVerified",
    "setKeyword","setPostOwnerName","setUrl","setCallToAction","setAdCategory","setSubCategory","setCountry",
    "setState","setCity","setAdType","setTargetKeyword","setLangDetect","setAdPosition","setAdSubPosition",
    "setGender","setLowerAgeSeen","setLastSeen","setPostDate","setDomainDate",
    "setBuiltWith","setTrack","setSource","setFunnel","setAffiliate","setMarketPlatform",
    "setLikes","setComments","setPopularity","setImpressions",
    "setOcr","setCelebrity","setImageObject","setLogo","setHtmlContent","setNeedle",
    "setAdDetailId","setNotCountry",
  ]) self[k] = fluent(k);
  self.build = vi.fn(() => ({ body: { from: 0, size: 20, query: { match_all: {} } } }));
}
require.cache[builderPath] = {
  id: builderPath, filename: builderPath, loaded: true, exports: FakeBuilder,
};

// ── Mock paramParser ──────────────────────────────────────────────────────
const paramsPath = require.resolve("../../../../src/services/linkedin/helpers/paramParser");
const normalizeParams = vi.fn((raw) => raw);
const ensureArray = vi.fn((v) => Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]));
const parsePagination = vi.fn(() => ({ size: 20, from: 0 }));
const parseSort = vi.fn(() => ({ field: "linkedin_ad.last_seen", order: "desc" }));
const cleanAdsData = vi.fn((rows) => rows);
require.cache[paramsPath] = {
  id: paramsPath, filename: paramsPath, loaded: true,
  exports: { normalizeParams, ensureArray, parsePagination, parseSort, cleanAdsData },
};

// ── Mock searchCursorCache ────────────────────────────────────────────────
const cursorPath = require.resolve("../../../../src/utils/searchCursorCache");
const buildQueryHash = vi.fn(() => "qhash");
const saveCursor = vi.fn();
const getCursor = vi.fn();
require.cache[cursorPath] = {
  id: cursorPath, filename: cursorPath, loaded: true,
  exports: { SAFE_FROM: 9000, buildQueryHash, saveCursor, getCursor },
};

const { searchAds } = require(
  "../../../../src/services/linkedin/controllers/adSearchController"
);

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

beforeEach(() => {
  builderCalls.length = 0;
  normalizeParams.mockClear().mockImplementation((raw) => raw);
  ensureArray.mockClear().mockImplementation((v) => Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]));
  parsePagination.mockClear().mockImplementation(() => ({ size: 20, from: 0 }));
  parseSort.mockClear().mockImplementation(() => ({ field: "linkedin_ad.last_seen", order: "desc" }));
  cleanAdsData.mockClear().mockImplementation((rows) => rows);
  buildQueryHash.mockClear().mockImplementation(() => "qhash");
  saveCursor.mockClear();
  getCursor.mockClear();
  fakeLogger.info.mockClear(); fakeLogger.warn.mockClear(); fakeLogger.error.mockClear();
});

describe("services/linkedin/controllers/adSearchController > validation routing", () => {
  it("400 when user_id missing", async () => {
    expect(await searchAds({ body: {}, query: {} }, {}, fakeLogger))
      .toEqual({ code: 400, message: "Missing params: user_id is required" });
  });

  it("routes to searchFavoriteAds when favorite='true'", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    const out = await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger);
    expect(out.message).toBe("No favorite ads found");
  });

  it("routes to searchHiddenAds when hidden='true'", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    const out = await searchAds({ body: { user_id: "u", hidden: "true" }, query: {} }, db, fakeLogger);
    expect(out.message).toBe("No hidden ads found");
  });

  it("routes to searchHiddenAds when hidden='true'", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    const out = await searchAds({ body: { user_id: "u", hidden: "true" }, query: {} }, db, fakeLogger);
    expect(out.message).toBe("No hidden ads found");
  });

  it("503 when db.elastic missing (regular search)", async () => {
    const db = { elastic: null };
    expect(await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger))
      .toEqual({ code: 503, message: "Elasticsearch connection not available" });
  });
});

describe("services/linkedin/controllers/adSearchController > searchFavoriteAds", () => {
  it("503 when sql missing", async () => {
    const out = await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, { sql: null }, fakeLogger);
    expect(out.code).toBe(503);
  });

  it("returns 200 with []+'No favorite ads found' on empty", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    const out = await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger);
    expect(out).toEqual({ code: 200, data: [], total: 0, message: "No favorite ads found" });
  });

  it("happy path fetches details and returns ads", async () => {
    let call = 0;
    const rows = [{ ad_id: 1, type: "TEXT" }, { ad_id: 2, type: "TEXT" }];
    const db = {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [{ ad_id: 1 }, { ad_id: 2 }];
        return rows;
      })},
    };
    const out = await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data).toHaveLength(2);
    expect(out.total).toBe(2);
  });

  it("500 when SQL throws", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("sql-fail"); }) } };
    const out = await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(500);
    expect(fakeLogger.error).toHaveBeenCalled();
  });

  it("with db.elastic: enrichAndFilterRows drops IMAGE without PowerAdspy and keeps the rest", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [{ ad_id: 1 }, { ad_id: 2 }, { ad_id: 3 }];
        return [
          { ad_id: 1, type: "IMAGE" },
          { ad_id: 2, type: "IMAGE" },
          { ad_id: 3, type: "TEXT" },
        ];
      })},
      elastic: {
        indexName: "linkedin_search_mix",
        search: vi.fn(async () => ({
          hits: { hits: [
            { _id: "1", _source: { ad_id: 1, new_nas_image_url: "https://x/PowerAdspy/img.png" } },
            { _id: "2", _source: { ad_id: 2 } },
            { _id: "3", _source: { ad_id: 3 } },
          ]},
        })),
      },
    };
    const out = await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data.map(d => d.ad_id)).toEqual([1, 3]);
    expect(out.data[0].image_video_url).toBe("https://x/PowerAdspy/img.png");
  });
  it("enrichAndFilterRows: ES returns body.hits shape (line 92 right operand)", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ ad_id: 1 }];
        return [{ ad_id: 1, type: "IMAGE" }];
      })},
      elastic: {
        indexName: "linkedin_search_mix",
        search: vi.fn(async () => ({
          body: { hits: { hits: [
            { _id: "1", _source: { ad_id: 1, new_nas_image_url: "https://x/PowerAdspy/img.png" } },
          ]}}
        })),
      },
    };
    const out = await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger);
    expect(out.data.map(d => d.ad_id)).toEqual([1]);
  });

  it("enrich falls through gracefully when ES throws (returns unfiltered rows)", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [{ ad_id: 1 }];
        return [{ ad_id: 1, type: "TEXT" }];
      })},
      elastic: { search: vi.fn(async () => { throw new Error("es-down"); }) },
    };
    const out = await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data).toHaveLength(1);
  });
});

describe("services/linkedin/controllers/adSearchController > searchHiddenAds", () => {
  it("503 when sql missing", async () => {
    const out = await searchAds({ body: { user_id: "u", hidden: "true" }, query: {} }, { sql: null }, fakeLogger);
    expect(out.code).toBe(503);
  });

  it("returns 200/empty when no hidden rows", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect(await searchAds({ body: { user_id: "u", hidden: "true" }, query: {} }, db, fakeLogger))
      .toEqual({ code: 200, data: [], total: 0, message: "No hidden ads found" });
  });

  it("happy path tags rows with hideType + ad_type + hiddenPostOwnerId", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [
          { ad_id: 1, post_owner_id: "po1", type: 1 },
          { ad_id: 2, post_owner_id: null, type: 2 },
        ];
        return [{ ad_id: 1, type: "TEXT" }, { ad_id: 2, type: "TEXT" }];
      })},
    };
    const out = await searchAds({ body: { user_id: "u", hidden: "true" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data[0].hideType).toBe(1);
    expect(out.data[0].hiddenPostOwnerId).toBe("po1");
    expect(out.data[1].hideType).toBe(2);
    expect(out.data[1].hiddenPostOwnerId).toBe(null);
  });

  it("ads without meta default to hideType=2 + hiddenPostOwnerId=null", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [{ ad_id: 1, post_owner_id: null, type: 1 }];
        return [{ ad_id: 99, type: "TEXT" }]; // mismatched ad
      })},
    };
    const out = await searchAds({ body: { user_id: "u", hidden: "true" }, query: {} }, db, fakeLogger);
    expect(out.data[0].hideType).toBe(2);
    expect(out.data[0].hiddenPostOwnerId).toBe(null);
  });

  it("hidden row missing ad_id is filtered out", async () => {
    const db = { sql: { query: vi.fn(async () => [{ post_owner_id: "po", type: 1 /* no ad_id */ }]) } };
    const out = await searchAds({ body: { user_id: "u", hidden: "true" }, query: {} }, db, fakeLogger);
    expect(out).toEqual({ code: 200, data: [], total: 0, message: "No hidden ads found" });
  });

  it("500 when SQL throws", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("sql-down"); }) } };
    const out = await searchAds({ body: { user_id: "u", hidden: "true" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(500);
  });
});

describe("services/linkedin/controllers/adSearchController > regular searchAds", () => {
  function mkEsHits(hits) {
    return { hits: { hits, total: { value: hits.length } } };
  }

  it("happy path: ES hits → SQL enrich (NAS, engagement, duration, popularity, market URLs)", async () => {
    const esHits = [
      { _id: "1", _source: {
        ad_id: 1, new_nas_image_url: "https://x/nas.png",
        duration: 99,
        reactions: { likes: 42 },
        comments: 5,
        impression: 1000,
        verified: 1,
        first_seen: "2024-01-01",
        popularity: { max: 100, current: 80 },
        redirect_urls: ["r1"],
      } },
    ];
    const db = {
      elastic: { indexName: "linkedin_search_mix", search: vi.fn(async () => mkEsHits(esHits)) },
      sql: { query: vi.fn(async () => [{ ad_id: 1, id: 1, type: "TEXT" }]) },
    };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.total).toBe(1);
    expect(out.data[0].image_video_url).toBe("https://x/nas.png");
    expect(out.data[0].days_running).toBe(99);
    expect(out.data[0].likes).toBe(42);
    expect(out.data[0].comments).toBe(5);
    expect(out.data[0].impression).toBe(1000);
    expect(out.data[0].verified).toBe(1);
    expect(out.data[0].first_seen).toBe("2024-01-01");
    expect(JSON.parse(out.data[0].popularity)).toEqual({ max: 100, current: 80 });
    expect(out.data[0].market_platform_urls.redirect_urls).toEqual(["r1"]);
  });

  it("0 hits → returns 'No ads found'", async () => {
    const db = {
      elastic: { search: vi.fn(async () => ({ hits: { hits: [], total: { value: 0 } } })) },
    };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.message).toBe("No ads found");
  });

  it("ES uses body.hits fallback + total as number", async () => {
    const db = {
      elastic: { search: vi.fn(async () => ({ body: { hits: { hits: [{ _id: "1", _source: { ad_id: 1 } }], total: 1 } } })) },
    };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.total).toBe(1);
  });

  it("SQL fetch failure falls back to ES sources", async () => {
    const esHits = [{ _id: "i-1", _source: { ad_id: 1, foo: "bar" } }];
    const db = {
      elastic: { search: vi.fn(async () => mkEsHits(esHits)) },
      sql: { query: vi.fn(async () => { throw new Error("sql-down"); }) },
    };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data[0].foo).toBe("bar");
    expect(fakeLogger.warn).toHaveBeenCalled();
  });

  it("hit without _id → falls back to _source.ad_id (lines 387, 405)", async () => {
    // Both adIds map (line 387) and esMap construction (line 405) use
    // `hit._id || hit._source['ad_id']`. Without _id, the right operand fires.
    const esHits = [{ _source: { ad_id: 7, foo: "no-id" } }];
    const db = {
      elastic: { indexName: "linkedin_search_mix", search: vi.fn(async () => mkEsHits(esHits)) },
      sql: { query: vi.fn(async () => [{ id: 7, ad_id: 7, type: "TEXT" }]) },
    };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data[0].ad_id).toBe(7);
  });

  it("dedupeRows drops duplicate ad_id rows (line 67)", async () => {
    const esHits = [{ _id: "1", _source: { ad_id: 1, foo: "a" } }];
    const db = {
      elastic: { indexName: "linkedin_search_mix", search: vi.fn(async () => mkEsHits(esHits)) },
      sql: { query: vi.fn(async () => [
        { id: 1, ad_id: 1, type: "TEXT" },
        { id: 1, ad_id: 1, type: "TEXT" }, // duplicate ad_id
      ]) },
    };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data).toHaveLength(1);
  });

  it("no db.sql → uses ES sources directly", async () => {
    const esHits = [{ _id: "1", _source: { ad_id: 1, foo: "bar" } }];
    const db = { elastic: { search: vi.fn(async () => mkEsHits(esHits)) } };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.data[0].foo).toBe("bar");
  });

  it("deep page (from >= SAFE_FROM): uses cached cursor → search_after", async () => {
    parsePagination.mockReturnValue({ size: 20, from: 9000 });
    getCursor.mockReturnValue(["cursor-val"]);
    const db = {
      elastic: { search: vi.fn(async () => ({ hits: { hits: [], total: { value: 50 } } })) },
    };
    await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    const esParams = db.elastic.search.mock.calls[0][0];
    expect(esParams.body.search_after).toEqual(["cursor-val"]);
    expect(esParams.body.from).toBeUndefined();
  });

  it("deep page (from >= SAFE_FROM) without cached cursor → caps at SAFE_FROM - size", async () => {
    parsePagination.mockReturnValue({ size: 20, from: 9000 });
    getCursor.mockReturnValue(null);
    const db = {
      elastic: { search: vi.fn(async () => ({ hits: { hits: [], total: { value: 50 } } })) },
    };
    await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(db.elastic.search.mock.calls[0][0].body.from).toBe(8980);
  });

  it("500 + logger.error when ES search throws", async () => {
    const db = { elastic: { search: vi.fn(async () => { throw new Error("es-down"); }) } };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(500);
    expect(fakeLogger.error).toHaveBeenCalled();
  });

  it("invokes builder setters for filter params", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [], total: { value: 0 } } })) } };
    await searchAds({
      body: {
        user_id: "u",
        keyword: "k", advertiser: "a", domain: "d.com",
        adcategory: "cat", subCategory: "sub", country: "US", state: "CA", city: "SF",
        type: "IMAGE", call_to_action: "Buy", target_keywords: "kw", lang: "en", ad_position: "FEED",
        ad_sub_position: "TOP", gender: "M", status: [1, 2], verified: "1",
        lower_age: "18", upper_age: "65",
        seen_btn_sort: [1700000000, 1600000000],
        post_date_btn_sort: [1700000000, 1600000000],
        domain_date_btn_sort: [1700000000, 1600000000],
        ecommerce: "shopify", track: "ga", source: "src", funnel: "fn", affiliate: "aff", market_platform: "mp",
        likes: [10, 100], comments: [1, 50], popularity: [1, 10], impressions: [10, 1000],
        ocr: "txt", image_celebrity: "c", image_object: "o", image_logo: "l",
        html_content: "html", needle: "n", adDetail_id: "ad-detail", not_country: "RU",
        ipBasedCountry: "US",
      },
      query: {},
    }, db, fakeLogger);
    const setterCalls = builderCalls[0].calls.map(c => c[0]);
    expect(setterCalls).toEqual(expect.arrayContaining([
      "setStatus","setVerified","setKeyword","setPostOwnerName","setUrl","setCallToAction",
      "setAdCategory","setSubCategory","setCountry","setState","setCity","setAdType",
      "setTargetKeyword","setLangDetect","setAdPosition","setAdSubPosition","setGender",
      "setLowerAgeSeen","setLastSeen","setPostDate","setDomainDate",
      "setBuiltWith","setTrack","setSource","setFunnel","setAffiliate","setMarketPlatform",
      "setLikes","setComments","setPopularity","setImpressions",
      "setOcr","setCelebrity","setImageObject","setLogo","setHtmlContent","setNeedle",
      "setAdDetailId","setNotCountry","setIpBasedCountry",
    ]));
  });

  it("similar_ad_id || adDetail_id branch uses adDetail_id fallback", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [], total: { value: 0 } } })) } };
    await searchAds({ body: { user_id: "u", adDetail_id: "fallback-id" }, query: {} }, db, fakeLogger);
    const adCall = builderCalls[0].calls.find(c => c[0] === "setAdDetailId");
    expect(adCall[1][0]).toBe("fallback-id");
  });

  it("empty ad_position skips setAdPosition (apArr.length=0 branch)", async () => {
    ensureArray.mockReturnValueOnce([]); // simulate empty ad_position
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [], total: { value: 0 } } })) } };
    await searchAds({ body: { user_id: "u", ad_position: "" }, query: {} }, db, fakeLogger);
    expect(builderCalls[0].calls.find(c => c[0] === "setAdPosition")).toBeUndefined();
  });

  it("lower_age without upper_age does not call setLowerAgeSeen", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [], total: { value: 0 } } })) } };
    await searchAds({ body: { user_id: "u", lower_age: "18" }, query: {} }, db, fakeLogger);
    expect(builderCalls[0].calls.find(c => c[0] === "setLowerAgeSeen")).toBeUndefined();
  });

  it("ES hit without ad_id falls back to _id key", async () => {
    const esHits = [{ _id: "alt-id-7", _source: { /* no ad_id */ foo: "bar" } }];
    const db = {
      elastic: { search: vi.fn(async () => ({ hits: { hits: esHits, total: { value: 1 } } })) },
      sql: { query: vi.fn(async () => [{ ad_id: "alt-id-7", id: 1, type: "TEXT" }]) },
    };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data).toHaveLength(1);
  });

  it("SQL row without matching ES hit returns row unchanged (esHit missing branch)", async () => {
    const esHits = [{ _id: "999", _source: { ad_id: 999 } }];
    const db = {
      elastic: { search: vi.fn(async () => ({ hits: { hits: esHits, total: { value: 1 } } })) },
      // SQL returns a row whose ad_id doesn't match any ES hit id
      sql: { query: vi.fn(async () => [{ ad_id: 1, type: "TEXT" }]) },
    };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data[0].ad_id).toBe(1);
  });

  it("ES src missing new_nas_image_url + days_running (false-side branches)", async () => {
    const esHits = [{ _id: "1", _source: { ad_id: 1 /* no new_nas_image_url, no days_running */ } }];
    const db = {
      elastic: { search: vi.fn(async () => ({ hits: { hits: esHits, total: { value: 1 } } })) },
      sql: { query: vi.fn(async () => [{ ad_id: 1, type: "TEXT" }]) },
    };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.data[0].image_video_url).toBeUndefined();
  });
});
