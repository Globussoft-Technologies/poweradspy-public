import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── Mock TiktokSearchQueryBuilder ──────────────────────────────────────────
const builderPath = require.resolve("../../../../src/services/tiktok/builders/TiktokSearchQueryBuilder");
const builderCalls = [];
function FakeBuilder(indexName) {
  builderCalls.push({ ctor: indexName, calls: [] });
  const self = this;
  const last = builderCalls[builderCalls.length - 1];
  const fluent = (name) => function (...args) { last.calls.push([name, args]); return self; };
  for (const k of [
    "setFrom","setSize","setSortField","setSortMethod",
    "setKeyword","setAdvertiser","setDomain","setIndustry","setGender","setAge","setBudget",
    "setLanguage","setCountry",
    "setLikes","setComments","setShares","setPopularity","setImpression","setCtr",
    "setAdSeen","setPostDate",
  ]) self[k] = fluent(k);
  self.build = vi.fn(() => ({ body: { from: 0, size: 20, query: { match_all: {} } } }));
}
require.cache[builderPath] = {
  id: builderPath, filename: builderPath, loaded: true, exports: FakeBuilder,
};

// ── Mock paramParser ───────────────────────────────────────────────────────
const paramsPath = require.resolve("../../../../src/services/tiktok/helpers/paramParser");
const normalizeParams = vi.fn((raw) => raw);
const ensureArray = vi.fn((v) => Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]));
const parsePagination = vi.fn(() => ({ size: 20, from: 0 }));
const parseSort = vi.fn(() => ({ field: "updatedAt", order: "desc" }));
const cleanAdsData = vi.fn((rows) => rows);
require.cache[paramsPath] = {
  id: paramsPath, filename: paramsPath, loaded: true,
  exports: { normalizeParams, ensureArray, parsePagination, parseSort, cleanAdsData },
};

// ── Mock countries + languages ─────────────────────────────────────────────
const countriesPath = require.resolve("../../../../src/services/tiktok/helpers/countries");
require.cache[countriesPath] = {
  id: countriesPath, filename: countriesPath, loaded: true,
  exports: { COUNTRY_LABEL_TO_ISO: { "United States": "US", "India": "IN", "Brazil": "BR" } },
};
const langPath = require.resolve("../../../../src/services/tiktok/helpers/languages");
require.cache[langPath] = {
  id: langPath, filename: langPath, loaded: true,
  exports: { LANG_ISO_TO_ES: { es: "spanish", fr: "french" } },
};

const { searchAds } = require(
  "../../../../src/services/tiktok/controllers/adSearchController"
);

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

beforeEach(() => {
  builderCalls.length = 0;
  normalizeParams.mockClear().mockImplementation((raw) => raw);
  ensureArray.mockClear().mockImplementation((v) => Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]));
  parsePagination.mockClear().mockImplementation(() => ({ size: 20, from: 0 }));
  parseSort.mockClear().mockImplementation(() => ({ field: "updatedAt", order: "desc" }));
  cleanAdsData.mockClear().mockImplementation((rows) => rows);
  fakeLogger.info.mockClear(); fakeLogger.warn.mockClear(); fakeLogger.error.mockClear();
});

describe("services/tiktok/controllers/adSearchController > validation routing", () => {
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

  it("503 when db.elastic missing (regular search)", async () => {
    expect(await searchAds({ body: { user_id: "u" }, query: {} }, { elastic: null }, fakeLogger))
      .toEqual({ code: 503, message: "Elasticsearch connection not available" });
  });
});

describe("services/tiktok/controllers/adSearchController > searchFavoriteAds", () => {
  it("503 when sql missing", async () => {
    expect((await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, { sql: null }, fakeLogger)).code).toBe(503);
  });

  it("0 favorites → 'No favorite ads found'", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect(await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger))
      .toEqual({ code: 200, data: [], total: 0, message: "No favorite ads found" });
  });

  it("skip past last page returns 'No ads on this page'", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ ad_id: 1 }]) },
      elastic: { search: vi.fn() },
    };
    const out = await searchAds({ body: { user_id: "u", favorite: "true", skip: "5", take: "20" }, query: {} }, db, fakeLogger);
    expect(out.message).toBe("No ads on this page");
    expect(out.total).toBe(1);
  });

  it("503 when elastic missing for fetch", async () => {
    const db = { sql: { query: vi.fn(async () => [{ ad_id: 1 }]) }, elastic: null };
    expect((await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger)).code).toBe(503);
  });

  it("happy path fetches ads from ES", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ ad_id: 1 }, { ad_id: 2 }]) },
      elastic: { indexName: "tiktok_ads", search: vi.fn(async () => ({ hits: { hits: [{ _source: { sql_id: 1, ad_title: "Ad A" } }, { _source: { sql_id: 2 } }] } })) },
    };
    const out = await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data).toHaveLength(2);
    expect(out.total).toBe(2);
  });

  it("500 when SQL throws", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("sql-fail"); }) } };
    expect((await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger)).code).toBe(500);
    expect(fakeLogger.error).toHaveBeenCalled();
  });
});

describe("services/tiktok/controllers/adSearchController > searchHiddenAds", () => {
  it("503 when sql missing", async () => {
    expect((await searchAds({ body: { user_id: "u", hidden: "true" }, query: {} }, { sql: null }, fakeLogger)).code).toBe(503);
  });

  it("0 hidden → 'No hidden ads found'", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect(await searchAds({ body: { user_id: "u", hidden: "true" }, query: {} }, db, fakeLogger))
      .toEqual({ code: 200, data: [], total: 0, message: "No hidden ads found" });
  });

  it("rows without ad_id filtered out", async () => {
    const db = { sql: { query: vi.fn(async () => [{ post_owner_id: "po", type: 1 }]) } };
    expect((await searchAds({ body: { user_id: "u", hidden: "true" }, query: {} }, db, fakeLogger)).total).toBe(0);
  });

  it("skip past last page returns 'No ads on this page'", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ ad_id: 1, post_owner_id: "po", type: 1 }]) },
      elastic: { search: vi.fn() },
    };
    const out = await searchAds({ body: { user_id: "u", hidden: "true", skip: "5", take: "20" }, query: {} }, db, fakeLogger);
    expect(out.message).toBe("No ads on this page");
  });

  it("503 when elastic missing for fetch", async () => {
    const db = { sql: { query: vi.fn(async () => [{ ad_id: 1, type: 1 }]) }, elastic: null };
    expect((await searchAds({ body: { user_id: "u", hidden: "true" }, query: {} }, db, fakeLogger)).code).toBe(503);
  });

  it("happy path attaches hideType + ad_type + hiddenPostOwnerId from meta", async () => {
    const db = {
      sql: { query: vi.fn(async () => [
        { ad_id: 1, post_owner_id: "po1", type: 1 },
        { ad_id: 2, post_owner_id: null, type: 2 },
      ]) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [
        { _source: { sql_id: 1, ad_title: "A" } },
        { _source: { sql_id: 2, ad_title: "B" } },
      ]}}))},
    };
    const out = await searchAds({ body: { user_id: "u", hidden: "true" }, query: {} }, db, fakeLogger);
    expect(out.data[0].hideType).toBe(1);
    expect(out.data[0].hiddenPostOwnerId).toBe("po1");
    expect(out.data[1].hideType).toBe(2);
  });

  it("missing meta defaults to hideType=2, hiddenPostOwnerId=null", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ ad_id: 1, post_owner_id: null, type: 1 }]) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { sql_id: 99 } }] } })) },
    };
    const out = await searchAds({ body: { user_id: "u", hidden: "true" }, query: {} }, db, fakeLogger);
    expect(out.data[0].hideType).toBe(2);
    expect(out.data[0].hiddenPostOwnerId).toBe(null);
  });

  it("500 when SQL throws", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("sql-fail"); }) } };
    expect((await searchAds({ body: { user_id: "u", hidden: "true" }, query: {} }, db, fakeLogger)).code).toBe(500);
  });
});

describe("services/tiktok/controllers/adSearchController > regular searchAds", () => {
  function esHits(hits = [], total = hits.length, aggsTotal = null) {
    const result = { hits: { hits, total: { value: total } } };
    if (aggsTotal !== null) result.aggregations = { total_ads: { value: aggsTotal } };
    return result;
  }

  it("happy path: ES hits returned", async () => {
    const db = {
      elastic: { indexName: "tiktok_ads", search: vi.fn(async () => esHits([{ _source: { sql_id: 1, ad_title: "x" } }])) },
    };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data).toHaveLength(1);
    expect(out.total).toBe(1);
  });

  it("0 hits → 'No ads found'", async () => {
    const db = { elastic: { search: vi.fn(async () => esHits([])) } };
    expect((await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger)).message).toBe("No ads found");
  });

  it("aggregations.total_ads.value preferred over hits.total when present", async () => {
    const db = { elastic: { search: vi.fn(async () => esHits([{ _source: {} }], 1, 9999)) } };
    expect((await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger)).total).toBe(9999);
  });

  it("ES body.hits fallback + total as number", async () => {
    const db = {
      elastic: { search: vi.fn(async () => ({ body: { hits: { hits: [{ _source: {} }], total: 1 } } })) },
    };
    expect((await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger)).total).toBe(1);
  });

  it("500 + logger.error when ES throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = { elastic: { search: vi.fn(async () => { throw new Error("es-down"); }) } };
    expect((await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger)).code).toBe(500);
    expect(fakeLogger.error).toHaveBeenCalled();
  });

  it("invokes builder setters for all filter params", async () => {
    const db = { elastic: { search: vi.fn(async () => esHits([])) } };
    await searchAds({
      body: {
        user_id: "u",
        keyword: "k", advertiser: "a", domain: "d.com",
        industry: "apparel",
        gender: "M",
        age: "18-24",
        budget: "low",
        language: ["es", "fr"],
        country: ["United States", "US"],
        likes: [10, 100],
        comments: { min: 1, max: 50 },
        shares: { min: 0 },
        popularity: [1, 10],
        impressions: [1, 100],
        ctr: { min: 1 },
        seen_btn_sort: [1700000000, 1600000000],
        postDate: "custom", postStartDate: "01/01/2020", postEndDate: "31/12/2020",
      },
      query: {},
    }, db, fakeLogger);
    const setters = builderCalls[0].calls.map(c => c[0]);
    expect(setters).toEqual(expect.arrayContaining([
      "setKeyword","setAdvertiser","setDomain","setIndustry","setGender","setAge","setBudget",
      "setLanguage","setCountry","setLikes","setComments","setShares","setPopularity",
      "setImpression","setCtr","setAdSeen","setPostDate",
    ]));
  });

  it("hasUnsupportedFilters returns 200/[] for any active unsupported filter", async () => {
    // Currently TIKTOK_UNSUPPORTED_FILTERS is intentionally empty (per source comment).
    // So this should never short-circuit — hits the negative case.
    const db = { elastic: { search: vi.fn(async () => esHits([])) } };
    const out = await searchAds({ body: { user_id: "u", whatever: "x" }, query: {} }, db, fakeLogger);
    expect(out.message).toBe("No ads found");
  });

  it("adcategory fallback used when industry absent", async () => {
    const db = { elastic: { search: vi.fn(async () => esHits([])) } };
    await searchAds({ body: { user_id: "u", adcategory: "alt" }, query: {} }, db, fakeLogger);
    const ind = builderCalls[0].calls.find(c => c[0] === "setIndustry");
    expect(ind[1][0]).toEqual(["alt"]);
  });

  it("language='en' bare default is stripped", async () => {
    const db = { elastic: { search: vi.fn(async () => esHits([])) } };
    await searchAds({ body: { user_id: "u", language: "en" }, query: {} }, db, fakeLogger);
    expect(builderCalls[0].calls.find(c => c[0] === "setLanguage")).toBeUndefined();
  });

  it("language full names pass through to setLanguage", async () => {
    const db = { elastic: { search: vi.fn(async () => esHits([])) } };
    await searchAds({ body: { user_id: "u", language: ["spanish"] }, query: {} }, db, fakeLogger);
    const lang = builderCalls[0].calls.find(c => c[0] === "setLanguage");
    expect(lang[1][0]).toEqual(["spanish"]);
  });

  it("unknown ISO maps to null and is filtered out", async () => {
    const db = { elastic: { search: vi.fn(async () => esHits([])) } };
    await searchAds({ body: { user_id: "u", language: ["xx"] }, query: {} }, db, fakeLogger);
    expect(builderCalls[0].calls.find(c => c[0] === "setLanguage")).toBeUndefined();
  });

  it("falsy entries in language array are stripped pre-resolve (caller .filter at line 279)", async () => {
    const db = { elastic: { search: vi.fn(async () => esHits([])) } };
    await searchAds({ body: { user_id: "u", language: ["", null, "spanish"] }, query: {} }, db, fakeLogger);
    const lang = builderCalls[0].calls.find(c => c[0] === "setLanguage");
    expect(lang[1][0]).toEqual(["spanish"]);
  });

  it("country: ISO codes pass through unchanged", async () => {
    const db = { elastic: { search: vi.fn(async () => esHits([])) } };
    await searchAds({ body: { user_id: "u", country: ["US", "IN"] }, query: {} }, db, fakeLogger);
    const c = builderCalls[0].calls.find(c => c[0] === "setCountry");
    expect(c[1][0]).toEqual(["US", "IN"]);
  });

  it("country: DB-resolved labels (with nicename/name)", async () => {
    const db = {
      sql: { query: vi.fn(async () => [
        { iso: "US", nicename: "United States", name: "United States Of America" },
      ])},
      elastic: { search: vi.fn(async () => esHits([])) },
    };
    await searchAds({ body: { user_id: "u", country: ["United States"] }, query: {} }, db, fakeLogger);
    const c = builderCalls[0].calls.find(c => c[0] === "setCountry");
    expect(c[1][0]).toEqual(["US"]);
  });

  it("country: DB lookup falls back to COUNTRY_LABEL_TO_ISO map on partial misses", async () => {
    const db = {
      sql: { query: vi.fn(async () => [/* DB returns nothing */]) },
      elastic: { search: vi.fn(async () => esHits([])) },
    };
    await searchAds({ body: { user_id: "u", country: ["Brazil"] }, query: {} }, db, fakeLogger);
    const c = builderCalls[0].calls.find(c => c[0] === "setCountry");
    expect(c[1][0]).toEqual(["BR"]);
  });

  it("country: DB throws → falls back to static COUNTRY_LABEL_TO_ISO map", async () => {
    const db = {
      sql: { query: vi.fn(async () => { throw new Error("db-down"); }) },
      elastic: { search: vi.fn(async () => esHits([])) },
    };
    await searchAds({ body: { user_id: "u", country: ["United States"] }, query: {} }, db, fakeLogger);
    const c = builderCalls[0].calls.find(c => c[0] === "setCountry");
    expect(c[1][0]).toEqual(["US"]);
  });

  it("country: no db at all → uses static map only", async () => {
    const db = { elastic: { search: vi.fn(async () => esHits([])) } };
    await searchAds({ body: { user_id: "u", country: ["India"] }, query: {} }, db, fakeLogger);
    const c = builderCalls[0].calls.find(c => c[0] === "setCountry");
    expect(c[1][0]).toEqual(["IN"]);
  });

  it("country: empty + non-string entries are dropped", async () => {
    const db = { elastic: { search: vi.fn(async () => esHits([])) } };
    await searchAds({ body: { user_id: "u", country: ["", null, 42, "Unknown"] }, query: {} }, db, fakeLogger);
    // None of these match anything, so setCountry isn't called
    expect(builderCalls[0].calls.find(c => c[0] === "setCountry")).toBeUndefined();
  });

  it("country: unknown label that isn't in COUNTRY_LABEL_TO_ISO is dropped", async () => {
    const db = { elastic: { search: vi.fn(async () => esHits([])) } };
    await searchAds({ body: { user_id: "u", country: ["Atlantis"] }, query: {} }, db, fakeLogger);
    expect(builderCalls[0].calls.find(c => c[0] === "setCountry")).toBeUndefined();
  });

  it("adSeenStartDate/adSeenEndDate falls back when seen_btn_sort missing", async () => {
    const db = { elastic: { search: vi.fn(async () => esHits([])) } };
    await searchAds({
      body: { user_id: "u", adSeen: "custom", adSeenStartDate: "01/01/2020", adSeenEndDate: "31/12/2020" },
      query: {},
    }, db, fakeLogger);
    expect(builderCalls[0].calls.find(c => c[0] === "setAdSeen")).toBeDefined();
  });

  it("range filters with object {min} or {max} alone are accepted", async () => {
    const db = { elastic: { search: vi.fn(async () => esHits([])) } };
    await searchAds({ body: { user_id: "u", likes: { min: 5 } }, query: {} }, db, fakeLogger);
    expect(builderCalls[0].calls.find(c => c[0] === "setLikes")).toBeDefined();
  });

  it("range filter with both min and max empty → null (skipped)", async () => {
    const db = { elastic: { search: vi.fn(async () => esHits([])) } };
    await searchAds({ body: { user_id: "u", likes: { min: "", max: "" } }, query: {} }, db, fakeLogger);
    expect(builderCalls[0].calls.find(c => c[0] === "setLikes")).toBeUndefined();
  });

  it("range filter array of wrong length → null", async () => {
    const db = { elastic: { search: vi.fn(async () => esHits([])) } };
    await searchAds({ body: { user_id: "u", likes: [10] }, query: {} }, db, fakeLogger);
    expect(builderCalls[0].calls.find(c => c[0] === "setLikes")).toBeUndefined();
  });

  it("range filter false → null", async () => {
    const db = { elastic: { search: vi.fn(async () => esHits([])) } };
    await searchAds({ body: { user_id: "u", likes: false }, query: {} }, db, fakeLogger);
    expect(builderCalls[0].calls.find(c => c[0] === "setLikes")).toBeUndefined();
  });

  it("impression falls back to impressions key", async () => {
    const db = { elastic: { search: vi.fn(async () => esHits([])) } };
    await searchAds({ body: { user_id: "u", impressions: [1, 100] }, query: {} }, db, fakeLogger);
    expect(builderCalls[0].calls.find(c => c[0] === "setImpression")).toBeDefined();
  });
});
