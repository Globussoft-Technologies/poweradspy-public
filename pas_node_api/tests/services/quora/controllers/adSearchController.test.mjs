import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── Mock QuoraSearchQueryBuilder (`new`-invoked, fluent) ──────────────
const builderPath = require.resolve("../../../../src/services/quora/builders/QuoraSearchQueryBuilder");
const builderCalls = [];
function FakeBuilder(indexName) {
  builderCalls.push({ ctor: indexName, calls: [] });
  const self = this;
  const last = builderCalls[builderCalls.length - 1];
  const fluent = (name) => function (...args) { last.calls.push([name, args]); return self; };
  for (const k of [
    "setFrom","setSize","setSortField","setSortMethod","setIpBasedCountry","setStatus",
    "setKeyword","setPostOwnerName","setUrl","setAdCategory","setSubCategory","setCountry",
    "setState","setCity","setAdType","setCallToAction","setTags","setLangDetect","setAdPosition",
    "setGender","setLowerAgeSeen","setLastSeen","setPostDate","setDomainDate",
    "setBuiltWith","setTrack","setSource","setFunnel","setAffiliate","setMarketPlatform",
    "setOcr","setCelebrity","setImageObject","setLogo","setHtmlContent","setNeedle",
    "setAdDetailId","setNotCountry",
  ]) self[k] = fluent(k);
  self.build = vi.fn(() => ({ body: { from: 0, size: 20, query: { match_all: {} } } }));
}
require.cache[builderPath] = {
  id: builderPath, filename: builderPath, loaded: true, exports: FakeBuilder,
};

// ── Mock paramParser ──────────────────────────────────────────────────────
const paramsPath = require.resolve("../../../../src/services/quora/helpers/paramParser");
const normalizeParams = vi.fn((raw) => raw);
const ensureArray = vi.fn((v) => Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]));
const parsePagination = vi.fn(() => ({ size: 20, from: 0 }));
const parseSort = vi.fn(() => ({ field: "quora_ad.last_seen", order: "desc" }));
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

// ── Mock languageMap (real module has a process-wide cache — mock it so
// tests stay deterministic regardless of call order) ──────────────────────
const languageMapPath = require.resolve("../../../../src/utils/languageMap");
const getLanguageMap = vi.fn(async () => new Map());
const resolveLanguageName = vi.fn((map, code) => map.get(String(code).toUpperCase()) || code);
require.cache[languageMapPath] = {
  id: languageMapPath, filename: languageMapPath, loaded: true,
  exports: { getLanguageMap, resolveLanguageName },
};

const { searchAds } = require(
  "../../../../src/services/quora/controllers/adSearchController"
);

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

beforeEach(() => {
  builderCalls.length = 0;
  normalizeParams.mockClear().mockImplementation((raw) => raw);
  ensureArray.mockClear().mockImplementation((v) => Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]));
  parsePagination.mockClear().mockImplementation(() => ({ size: 20, from: 0 }));
  parseSort.mockClear().mockImplementation(() => ({ field: "quora_ad.last_seen", order: "desc" }));
  cleanAdsData.mockClear().mockImplementation((rows) => rows);
  buildQueryHash.mockClear().mockImplementation(() => "qhash");
  saveCursor.mockClear();
  getCursor.mockClear();
  getLanguageMap.mockClear().mockImplementation(async () => new Map());
  resolveLanguageName.mockClear().mockImplementation((map, code) => map.get(String(code).toUpperCase()) || code);
  fakeLogger.info.mockClear(); fakeLogger.warn.mockClear(); fakeLogger.error.mockClear();
});

describe("services/quora/controllers/adSearchController > validation routing", () => {
  it("400 when user_id missing", async () => {
    expect(await searchAds({ body: {}, query: {} }, {}, fakeLogger))
      .toEqual({ code: 400, message: "Missing params: user_id is required" });
  });

  it("routes to searchFavoriteAds when favorite='true'", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    const out = await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger);
    expect(out.message).toBe("No favorite ads found");
  });

  it("routes to searchHiddenAds when hiddenads='true'", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    const out = await searchAds({ body: { user_id: "u", hiddenads: "true" }, query: {} }, db, fakeLogger);
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

describe("services/quora/controllers/adSearchController > searchFavoriteAds", () => {
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
        indexName: "quora_search_mix",
        search: vi.fn(async () => ({
          hits: { hits: [
            { _source: { "quora_ad.id": 1, new_nas_image_url: "https://x/PowerAdspy/img.png" } },
            { _source: { "quora_ad.id": 2 } },
            { _source: { "quora_ad.id": 3 } },
          ]},
        })),
      },
    };
    const out = await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data.map(d => d.ad_id)).toEqual([1, 3]);
    expect(out.data[0].image_video_url).toBe("https://x/PowerAdspy/img.png");
  });

  it("enrichAndFilterRows: ES returns body.hits shape (line 62 right operand)", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ ad_id: 1 }];
        return [{ ad_id: 1, type: "IMAGE" }];
      })},
      elastic: {
        indexName: "quora_search_mix",
        search: vi.fn(async () => ({
          body: { hits: { hits: [
            { _source: { "quora_ad.id": 1, new_nas_image_url: "https://x/PowerAdspy/img.png" } },
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
  it("dedupeRows drops duplicate ad_id rows (line 47)", async () => {
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
      elastic: { indexName: "quora", search: vi.fn(async () => ({ hits: { hits: [] } })) },
    };
    const out = await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger);
    expect(out.data.map(d => d.ad_id)).toEqual([1, 2]);
  });
});

describe("services/quora/controllers/adSearchController > searchHiddenAds", () => {
  it("503 when sql missing", async () => {
    const out = await searchAds({ body: { user_id: "u", hiddenads: "true" }, query: {} }, { sql: null }, fakeLogger);
    expect(out.code).toBe(503);
  });

  it("returns 200/empty when no hidden rows", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect(await searchAds({ body: { user_id: "u", hiddenads: "true" }, query: {} }, db, fakeLogger))
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
    const out = await searchAds({ body: { user_id: "u", hiddenads: "true" }, query: {} }, db, fakeLogger);
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
    const out = await searchAds({ body: { user_id: "u", hiddenads: "true" }, query: {} }, db, fakeLogger);
    expect(out.data[0].hideType).toBe(2);
    expect(out.data[0].hiddenPostOwnerId).toBe(null);
  });

  it("hidden row missing ad_id is filtered out", async () => {
    const db = { sql: { query: vi.fn(async () => [{ post_owner_id: "po", type: 1 /* no ad_id */ }]) } };
    const out = await searchAds({ body: { user_id: "u", hiddenads: "true" }, query: {} }, db, fakeLogger);
    expect(out).toEqual({ code: 200, data: [], total: 0, message: "No hidden ads found" });
  });

  it("500 when SQL throws", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("sql-down"); }) } };
    const out = await searchAds({ body: { user_id: "u", hiddenads: "true" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(500);
  });
});

describe("services/quora/controllers/adSearchController > regular searchAds", () => {
  function mkEsHits(hits) {
    return { hits: { hits, total: { value: hits.length } } };
  }

  it("happy path: ES hits → SQL enrich → cleanAdsData", async () => {
    const esHits = [
      { _source: { "quora_ad.id": 1, new_nas_image_url: "https://x/nas.png", "quora_ad.days_running": 7,
                   "quora_ad_url.url_destination": "ud",
                   "quora_ad_outgoing_links.source_url": "src" } },
    ];
    const db = {
      elastic: { indexName: "quora_search_mix", search: vi.fn(async () => mkEsHits(esHits)) },
      sql: { query: vi.fn(async () => [{ ad_id: 1, id: 1, type: "TEXT" }]) },
    };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.total).toBe(1);
    expect(out.data[0].image_video_url).toBe("https://x/nas.png");
    expect(out.data[0].days_running).toBe(7);
    expect(out.data[0].market_platform_urls.source_url).toBe("src");
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
      elastic: { search: vi.fn(async () => ({ body: { hits: { hits: [{ _source: { "quora_ad.id": 1 } }], total: 1 } } })) },
    };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.total).toBe(1);
  });

  it("SQL fetch failure falls back to ES sources", async () => {
    const esHits = [{ _id: "i-1", _source: { "quora_ad.id": 1, foo: "bar" } }];
    const db = {
      elastic: { search: vi.fn(async () => mkEsHits(esHits)) },
      sql: { query: vi.fn(async () => { throw new Error("sql-down"); }) },
    };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data[0].foo).toBe("bar");
    expect(fakeLogger.warn).toHaveBeenCalled();
  });

  it("no db.sql → uses ES sources directly", async () => {
    const esHits = [{ _source: { "quora_ad.id": 1, foo: "bar" } }];
    const db = { elastic: { search: vi.fn(async () => mkEsHits(esHits)) } };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.data[0].foo).toBe("bar");
  });

  // Language must be ES-only (the `language_id` join on quora_ad is empty for
  // API-ingested ads, so it can't be trusted) — must agree with the language
  // FILTER, which only ever matches ES `lang_detect`.
  it("language: ES lang_detect resolves the display language, ignoring any SQL languages join", async () => {
    const esHits = [{ _source: { "quora_ad.id": 1, lang_detect: "en" } }];
    const db = {
      elastic: { indexName: "quora_search_mix", search: vi.fn(async () => mkEsHits(esHits)) },
      sql: { query: vi.fn(async () => [{ ad_id: 1, id: 1, type: "TEXT", language: "French" }]) },
    };
    getLanguageMap.mockResolvedValueOnce(new Map([["EN", "English"]]));
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.data[0].language).toBe("English");
    expect(out.data[0].lang_detect).toBe("en");
  });

  it("language: no ES lang_detect → null, never the SQL languages join value", async () => {
    const esHits = [{ _source: { "quora_ad.id": 1 /* no lang_detect */ } }];
    const db = {
      elastic: { indexName: "quora_search_mix", search: vi.fn(async () => mkEsHits(esHits)) },
      sql: { query: vi.fn(async () => [{ ad_id: 1, id: 1, type: "TEXT", language: "French" }]) },
    };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.data[0].language).toBeNull();
  });

  it("language: langMap load failure → null, never the SQL languages join value", async () => {
    const esHits = [{ _source: { "quora_ad.id": 1, lang_detect: "en" } }];
    const db = {
      elastic: { indexName: "quora_search_mix", search: vi.fn(async () => mkEsHits(esHits)) },
      sql: { query: vi.fn(async () => [{ ad_id: 1, id: 1, type: "TEXT", language: "German" }]) },
    };
    getLanguageMap.mockRejectedValueOnce(new Error("sql down"));
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.data[0].language).toBeNull();
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
        type: "IMAGE", call_to_action: "Buy", tags: "tag1", lang: "en", ad_position: "FEED", gender: "M",
        lower_age: "18", upper_age: "65",
        seen_btn_sort: [1700000000, 1600000000],
        post_date_btn_sort: [1700000000, 1600000000],
        domain_date_btn_sort: [1700000000, 1600000000],
        ecommerce: "shopify", track: "ga", source: "src", funnel: "fn", affiliate: "aff", market_platform: "mp",
        ocr: "txt", image_celebrity: "c", image_object: "o", image_logo: "l",
        html_content: "html", needle: "n", similar_ad_id: "sim", not_country: "RU",
        ipBasedCountry: "US",
      },
      query: {},
    }, db, fakeLogger);
    const setterCalls = builderCalls[0].calls.map(c => c[0]);
    expect(setterCalls).toEqual(expect.arrayContaining([
      "setKeyword","setPostOwnerName","setUrl","setAdCategory","setSubCategory","setCountry",
      "setState","setCity","setAdType","setCallToAction","setTags","setLangDetect","setAdPosition",
      "setGender","setLowerAgeSeen","setLastSeen","setPostDate","setDomainDate",
      "setBuiltWith","setTrack","setSource","setFunnel","setAffiliate","setMarketPlatform",
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

  it("ES hit without quora_ad.id falls back to _id key", async () => {
    const esHits = [{ _id: "alt-id-7", _source: { /* no quora_ad.id */ foo: "bar" } }];
    const db = {
      elastic: { search: vi.fn(async () => ({ hits: { hits: esHits, total: { value: 1 } } })) },
      sql: { query: vi.fn(async () => [{ ad_id: "alt-id-7", id: 1, type: "TEXT" }]) },
    };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data).toHaveLength(1);
  });

  it("SQL row without matching ES hit returns row unchanged (esHit missing branch)", async () => {
    const esHits = [{ _source: { "quora_ad.id": 999 } }];
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
    const esHits = [{ _source: { "quora_ad.id": 1 /* no new_nas_image_url, no days_running */ } }];
    const db = {
      elastic: { search: vi.fn(async () => ({ hits: { hits: esHits, total: { value: 1 } } })) },
      sql: { query: vi.fn(async () => [{ ad_id: 1, type: "TEXT" }]) },
    };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.data[0].image_video_url).toBeUndefined();
  });
});
