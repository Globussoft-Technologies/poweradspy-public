import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const paramsPath = require.resolve("../../../../src/services/tiktok/helpers/paramParser");
const normalizeParams = vi.fn((raw) => raw);
const cleanAdsData = vi.fn((ads = []) => ads);
require.cache[paramsPath] = {
  id: paramsPath, filename: paramsPath, loaded: true,
  exports: { normalizeParams, cleanAdsData },
};

const indPath = require.resolve("../../../../src/services/tiktok/helpers/industries");
const mapIndustriesToCategories = vi.fn((industries) => industries.map(i => ({ category: i, items: [i] })));
require.cache[indPath] = {
  id: indPath, filename: indPath, loaded: true,
  exports: { mapIndustriesToCategories },
};

const {
  getLCS, getAnalytics, getIndustries,
  getAdvertiserLCSData, getAdvertiserCountryData, getAdvertiserInsightsByDateRange,
} = require("../../../../src/services/tiktok/controllers/adInsightsController");

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
beforeEach(() => {
  fakeLogger.error.mockClear();
  normalizeParams.mockClear().mockImplementation((raw) => raw);
  mapIndustriesToCategories.mockClear().mockImplementation((i) => i.map(x => ({ category: x, items: [x] })));
});

describe("services/tiktok/controllers/adInsightsController > getLCS", () => {
  it("401 when ad_id missing", async () => {
    expect(await getLCS({ body: { user_id: "u" }, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters: ad_id and user_id are required" });
  });
  it("401 when user_id missing", async () => {
    expect(await getLCS({ body: { ad_id: "1" }, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters: ad_id and user_id are required" });
  });
  it("503 when db.sql missing", async () => {
    expect(await getLCS(
      { body: { ad_id: "1", user_id: "u" }, query: {} }, { sql: null }, fakeLogger
    )).toEqual({ code: 503, message: "SQL connection not available" });
  });
  it("400 when no rows", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect(await getLCS(
      { body: { ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 400, message: "No ad found with ad_id", data: null });
  });
  it("200 with LCS data", async () => {
    const db = { sql: { query: vi.fn(async () => [
      { likes: 10, comments: 2, shares: 1, date: "2024-01-01" },
      { likes: 15, comments: 3, shares: 0, date: "2024-01-02" },
    ])}};
    const out = await getLCS(
      { body: { ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data).toHaveLength(2);
    expect(out.data[0]).toEqual({ likes: 10, comments: 2, shares: 1, date: "2024-01-01" });
  });
  it("500 on SQL throw", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("err"); }) } };
    expect((await getLCS({ body: { ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger)).code).toBe(500);
    expect(fakeLogger.error).toHaveBeenCalled();
  });
});

describe("services/tiktok/controllers/adInsightsController > getAnalytics", () => {
  it("401 when params missing", async () => {
    expect(await getAnalytics({ body: { user_id: "u" }, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters: ad_id and user_id are required" });
  });
  it("503 when elastic missing", async () => {
    expect(await getAnalytics(
      { body: { ad_id: "1", user_id: "u" }, query: {} }, { elastic: null }, fakeLogger
    )).toEqual({ code: 503, message: "Elasticsearch connection not available" });
  });
  it("400 when no hits", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [] } })) } };
    expect((await getAnalytics(
      { body: { ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("200 returns _source from ES hit", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { foo: "bar" } }] } })) } };
    expect((await getAnalytics(
      { body: { ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).data).toEqual({ foo: "bar" });
  });
  it("body.hits fallback shape", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ body: { hits: { hits: [{ _source: { x: 1 } }] } } })) } };
    expect((await getAnalytics(
      { body: { ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).data).toEqual({ x: 1 });
  });
  it("500 on ES throw", async () => {
    const db = { elastic: { search: vi.fn(async () => { throw new Error("es"); }) } };
    expect((await getAnalytics(
      { body: { ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(500);
  });
});

describe("services/tiktok/controllers/adInsightsController > getIndustries", () => {
  it("503 when elastic missing", async () => {
    expect(await getIndustries({}, { elastic: null }, fakeLogger))
      .toEqual({ code: 503, message: "Elasticsearch connection not available" });
  });
  it("200 maps industries via helper", async () => {
    const db = { elastic: { search: vi.fn(async () => ({
      aggregations: { industries: { buckets: [{ key: "tech" }, { key: "auto" }] } }
    }))}};
    const out = await getIndustries({}, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(mapIndustriesToCategories).toHaveBeenCalledWith(["tech", "auto"]);
    expect(out.data).toHaveLength(2);
  });
  it("body.aggregations fallback + empty buckets", async () => {
    const db = { elastic: { search: vi.fn(async () => ({
      body: { aggregations: {} }
    }))}};
    const out = await getIndustries({}, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data).toEqual([]);
  });
  it("500 on ES throw", async () => {
    const db = { elastic: { search: vi.fn(async () => { throw new Error("err"); }) } };
    expect((await getIndustries({}, db, fakeLogger)).code).toBe(500);
  });
});

describe("services/tiktok/controllers/adInsightsController > getAdvertiserLCSData", () => {
  function mkDb({ adHit = null, lcsHits = [], availableYearBuckets = [] } = {}) {
    return {
      elastic: { search: vi.fn(async (params) => {
        if (params.body.aggs?.years) {
          return { aggregations: { years: { buckets: availableYearBuckets } } };
        }
        if (params.body.size === 1) {
          return { hits: { hits: adHit ? [adHit] : [] } };
        }
        return { hits: { hits: lcsHits } };
      })},
    };
  }
  it("401 when tiktok_ad_id missing", async () => {
    expect(await getAdvertiserLCSData({ body: {}, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing tiktok_ad_id", data: null });
  });
  it("503 when elastic missing", async () => {
    expect((await getAdvertiserLCSData(
      { body: { tiktok_ad_id: "1" }, query: {} }, { elastic: null }, fakeLogger
    )).code).toBe(503);
  });
  it("400 when ad doc not found", async () => {
    const db = mkDb({ adHit: null });
    expect((await getAdvertiserLCSData(
      { body: { tiktok_ad_id: "1" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("400 when ad has no post_owner_id", async () => {
    const db = mkDb({ adHit: { _source: {} } });
    expect((await getAdvertiserLCSData(
      { body: { tiktok_ad_id: "1" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("body.hits fallback for ad doc lookup", async () => {
    const db = {
      elastic: { search: vi.fn(async (params) => {
        if (params.body.size === 1) return { body: { hits: { hits: [{ _source: { post_owner_id: 100, last_seen: "2024-06-01" } }] } } };
        if (params.body.aggs?.years) return { aggregations: { years: { buckets: [] } } };
        return { body: { hits: { hits: [] } } };
      })},
    };
    const out = await getAdvertiserLCSData(
      { body: { tiktok_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
  });
  it("200 'No data found for this year.' when ES LCS empty", async () => {
    const db = mkDb({
      adHit: { _source: { post_owner_id: 100, last_seen: "2024-06-01" } },
      lcsHits: [],
      availableYearBuckets: [{ key_as_string: "2024" }],
    });
    const out = await getAdvertiserLCSData(
      { body: { tiktok_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.message).toBe("No data found for this year.");
    expect(out.available_years).toEqual([2024]);
  });
  it("available_years sorted descending (line 160 comparator)", async () => {
    const db = mkDb({
      adHit: { _source: { post_owner_id: 100, last_seen: "2024-06-01" } },
      lcsHits: [],
      availableYearBuckets: [
        { key_as_string: "2021" },
        { key_as_string: "2024" },
        { key_as_string: "2022" },
        { key_as_string: "1969" },
      ],
    });
    const out = await getAdvertiserLCSData(
      { body: { tiktok_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.available_years).toEqual([2024, 2022, 2021]);
  });
  it("fetchAvailableYears catch branch: ES throws on years agg → available_years=[] (lines 161-162)", async () => {
    let callIdx = 0;
    const db = {
      sql: { query: vi.fn(async () => []) },
      elastic: { search: vi.fn(async (params) => {
        callIdx++;
        if (callIdx === 1) {
          // first call: fetch ad meta (single hit)
          return { hits: { hits: [{ _source: { post_owner_id: 100, last_seen: "2024-06-01" } }] } };
        }
        if (params.body.aggs?.years) {
          throw new Error("agg-failed");
        }
        return { hits: { hits: [] } };
      })},
    };
    const out = await getAdvertiserLCSData(
      { body: { tiktok_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.available_years).toEqual([]);
  });
  it("year override + invalid date last_seen fallback to current year", async () => {
    const db1 = mkDb({
      adHit: { _source: { post_owner_id: 100, last_seen: "2024-06-01" } },
      lcsHits: [],
    });
    expect((await getAdvertiserLCSData(
      { body: { tiktok_ad_id: "1", year: 2020 }, query: {} }, db1, fakeLogger
    )).year).toBe(2020);

    const db2 = mkDb({
      adHit: { _source: { post_owner_id: 100, last_seen: "invalid" } },
      lcsHits: [],
    });
    expect((await getAdvertiserLCSData(
      { body: { tiktok_ad_id: "1" }, query: {} }, db2, fakeLogger
    )).year).toBe(new Date().getFullYear());

    const db3 = mkDb({
      adHit: { _source: { post_owner_id: 100 /* no last_seen */ } },
      lcsHits: [],
    });
    expect((await getAdvertiserLCSData(
      { body: { tiktok_ad_id: "1" }, query: {} }, db3, fakeLogger
    )).year).toBe(new Date().getFullYear());
  });
  it("200 with monthly aggregation", async () => {
    const db = mkDb({
      adHit: { _source: { post_owner_id: 100, last_seen: "2024-06-01" } },
      lcsHits: [
        { _source: { sql_id: 1, last_seen: "2024-02-01", likes: 10, comments: 2, shares: 1 } },
        { _source: { sql_id: 2, last_seen: "2024-02-15", likes: 5, comments: 1, shares: 0 } },
        { _source: { sql_id: 3, last_seen: "2024-03-01", likes: 7, comments: 0, shares: 3 } },
      ],
    });
    const out = await getAdvertiserLCSData(
      { body: { tiktok_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data.feb_2024).toEqual({ ad_ids: [1, 2], total_ads: 2, likes: 15, comments: 3, shares: 1 });
    expect(out.data.mar_2024).toEqual({ ad_ids: [3], total_ads: 1, likes: 7, comments: 0, shares: 3 });
    expect(Object.keys(out.data)).toEqual(["feb_2024", "mar_2024"]); // sorted
  });
  it("hits with missing or invalid last_seen are skipped", async () => {
    const db = mkDb({
      adHit: { _source: { post_owner_id: 100, last_seen: "2024-01-01" } },
      lcsHits: [
        { _source: { sql_id: 1 /* no last_seen */ } },
        { _source: { sql_id: 2, last_seen: "garbage" } },
        { _source: { sql_id: 3, last_seen: "2024-04-01", likes: 1, comments: 0, shares: 0 } },
      ],
    });
    const out = await getAdvertiserLCSData(
      { body: { tiktok_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(Object.keys(out.data)).toEqual(["apr_2024"]);
  });
  it("falsy numeric LCS fields coerced to 0", async () => {
    const db = mkDb({
      adHit: { _source: { post_owner_id: 100, last_seen: "2024-01-01" } },
      lcsHits: [{ _source: { sql_id: 1, last_seen: "2024-01-01" /* no numeric fields */ } }],
    });
    const out = await getAdvertiserLCSData(
      { body: { tiktok_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data.jan_2024.likes).toBe(0);
    expect(out.data.jan_2024.comments).toBe(0);
    expect(out.data.jan_2024.shares).toBe(0);
  });
  it("sort spans multiple years", async () => {
    const db = mkDb({
      adHit: { _source: { post_owner_id: 100, last_seen: "2024-01-01" } },
      lcsHits: [
        { _source: { sql_id: 1, last_seen: "2024-03-01" } },
        { _source: { sql_id: 2, last_seen: "2023-12-01" } },
      ],
    });
    const out = await getAdvertiserLCSData(
      { body: { tiktok_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(Object.keys(out.data)).toEqual(["dec_2023", "mar_2024"]);
  });
  it("ES LCS query rejection → empty hits", async () => {
    let call = 0;
    const db = {
      elastic: { search: vi.fn(async (params) => {
        call++;
        if (params.body.size === 1) return { hits: { hits: [{ _source: { post_owner_id: 100, last_seen: "2024-01-01" } }] } };
        if (params.body.aggs?.years) return { aggregations: { years: { buckets: [] } } };
        throw new Error("es-down");
      })},
    };
    const out = await getAdvertiserLCSData(
      { body: { tiktok_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.message).toBe("No data found for this year.");
  });
});

describe("services/tiktok/controllers/adInsightsController > getAdvertiserCountryData", () => {
  function mkDb({ adHit = null, countryHits = [], availableYearBuckets = [] } = {}) {
    return {
      elastic: { search: vi.fn(async (params) => {
        if (params.body.aggs?.years) {
          return { aggregations: { years: { buckets: availableYearBuckets } } };
        }
        if (params.body.size === 1) {
          return { hits: { hits: adHit ? [adHit] : [] } };
        }
        return { hits: { hits: countryHits } };
      })},
    };
  }
  it("401 when tiktok_ad_id missing", async () => {
    expect((await getAdvertiserCountryData({ body: {}, query: {} }, {}, fakeLogger)).code).toBe(401);
  });
  it("503 when elastic missing", async () => {
    expect((await getAdvertiserCountryData(
      { body: { tiktok_ad_id: "1" }, query: {} }, { elastic: null }, fakeLogger
    )).code).toBe(503);
  });
  it("400 when ad not found / no post_owner_id", async () => {
    const db1 = mkDb({ adHit: null });
    expect((await getAdvertiserCountryData(
      { body: { tiktok_ad_id: "1" }, query: {} }, db1, fakeLogger
    )).code).toBe(400);
    const db2 = mkDb({ adHit: { _source: {} } });
    expect((await getAdvertiserCountryData(
      { body: { tiktok_ad_id: "1" }, query: {} }, db2, fakeLogger
    )).code).toBe(400);
  });
  it("200 'No data found for this year.' when ES empty", async () => {
    const db = mkDb({
      adHit: { _source: { post_owner_id: 100, last_seen: "2024-06-01" } },
      countryHits: [],
      availableYearBuckets: [{ key_as_string: "2024" }],
    });
    const out = await getAdvertiserCountryData(
      { body: { tiktok_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.message).toBe("No data found for this year.");
  });
  it("200 country aggregation (ISO arrays, upper-cased, sorted)", async () => {
    const db = mkDb({
      adHit: { _source: { post_owner_id: 100, last_seen: "2024-01-01" } },
      countryHits: [
        { _source: { sql_id: 1, countries: ["us", "in"] } },
        { _source: { sql_id: 2, countries: ["us"] } },
        { _source: { sql_id: 3, countries: ["in"] } },
      ],
    });
    const out = await getAdvertiserCountryData(
      { body: { tiktok_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0]).toEqual({ iso: "US", ad_ids: [1, 2], ad_count: 2 });
    expect(out.data[1]).toEqual({ iso: "IN", ad_ids: [1, 3], ad_count: 2 });
  });
  it("non-array countries normalized; falsy entries skipped", async () => {
    const db = mkDb({
      adHit: { _source: { post_owner_id: 100, last_seen: "2024-01-01" } },
      countryHits: [
        { _source: { sql_id: 1, countries: "us" } },
        { _source: { sql_id: 2, countries: ["", null, "in"] } },
      ],
    });
    const out = await getAdvertiserCountryData(
      { body: { tiktok_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    const isos = out.data.map(d => d.iso);
    expect(isos).toEqual(expect.arrayContaining(["US", "IN"]));
  });
  it("hits with no sql_id / no countries are skipped", async () => {
    const db = mkDb({
      adHit: { _source: { post_owner_id: 100, last_seen: "2024-01-01" } },
      countryHits: [
        { _source: { /* no sql_id */ countries: ["us"] } },
        { _source: { sql_id: 1 /* no countries */ } },
        { _source: { sql_id: 2, countries: ["fr"] } },
      ],
    });
    const out = await getAdvertiserCountryData(
      { body: { tiktok_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data).toHaveLength(1);
    expect(out.data[0].iso).toBe("FR");
  });
  it("200 'No country data found.' when all hits produce empty map", async () => {
    const db = mkDb({
      adHit: { _source: { post_owner_id: 100, last_seen: "2024-01-01" } },
      countryHits: [{ _source: { sql_id: 1 /* no countries */ } }],
    });
    const out = await getAdvertiserCountryData(
      { body: { tiktok_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.message).toBe("No country data found.");
    expect(out.data).toEqual([]);
  });
});

describe("services/tiktok/controllers/adInsightsController > getAdvertiserInsightsByDateRange", () => {
  it("400 when post_owner_id missing", async () => {
    expect((await getAdvertiserInsightsByDateRange(
      { body: {}, query: {} }, {}, fakeLogger
    )).code).toBe(400);
  });
  it("400 when from_date or to_date missing", async () => {
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5 }, query: {} }, {}, fakeLogger
    )).code).toBe(400);
  });
  it("503 when elastic missing", async () => {
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31" }, query: {} },
      { elastic: null }, fakeLogger
    )).code).toBe(503);
  });
  it("400 invalid date format", async () => {
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "01/01/2024", to_date: "12/31/2024" }, query: {} },
      { elastic: {} }, fakeLogger
    )).message).toContain("Invalid date format");
  });
  it("400 from_date > to_date", async () => {
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-12-31", to_date: "2024-01-01" }, query: {} },
      { elastic: {} }, fakeLogger
    )).message).toContain("before or equal to to_date");
  });
  it("400 invalid type", async () => {
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "weird" }, query: {} },
      { elastic: {} }, fakeLogger
    )).message).toContain("Invalid type");
  });
  it("country: 400 when ES empty", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [] } })) } };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31" }, query: {} },
      db, fakeLogger
    )).code).toBe(400);
  });
  it("country: 200 with data", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [
      { _source: { sql_id: 1, countries: ["us"] } },
    ]}}))}};
    const out = await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "country" }, query: {} },
      db, fakeLogger
    );
    expect(out.data[0].iso).toBe("US");
  });
  it("country: body.hits fallback", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ body: { hits: { hits: [
      { _source: { sql_id: 1, countries: ["fr"] } },
    ]}}}))}};
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31" }, query: {} },
      db, fakeLogger
    )).data[0].iso).toBe("FR");
  });
  it("country: 400 when countryMap empty after filter", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [
      { _source: { sql_id: 1 /* no countries */ } }
    ]}}))}};
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31" }, query: {} },
      db, fakeLogger
    )).code).toBe(400);
  });
  it("country: hits with non-array countries / falsy / no sql_id paths", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [
      { _source: { /* no sql_id */ countries: ["us"] } },
      { _source: { sql_id: 1, countries: "in" } },
      { _source: { sql_id: 2, countries: [null, "", "br"] } },
    ]}}))}};
    const out = await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31" }, query: {} },
      db, fakeLogger
    );
    const isos = out.data.map(d => d.iso);
    expect(isos).toEqual(expect.arrayContaining(["IN", "BR"]));
    expect(isos).not.toContain("US"); // first hit had no sql_id
  });
  it("lcs: 400 when ES empty", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [] } })) } };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "lcs" }, query: {} },
      db, fakeLogger
    )).code).toBe(400);
  });
  it("lcs: 200 with monthly buckets sorted", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [
      { _source: { sql_id: 1, last_seen: "2024-02-01", likes: 5, comments: 1, shares: 0 } },
      { _source: { sql_id: 2, last_seen: "2024-01-15", likes: 3, comments: 2, shares: 1 } },
    ]}}))}};
    const out = await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "lcs" }, query: {} },
      db, fakeLogger
    );
    expect(Object.keys(out.data)).toEqual(["jan_2024", "feb_2024"]);
    expect(out.data.feb_2024.likes).toBe(5);
  });
  it("lcs: body.hits fallback", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ body: { hits: { hits: [
      { _source: { sql_id: 1, last_seen: "2024-01-01", likes: 0, comments: 0, shares: 0 } }
    ]}}}))}};
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "lcs" }, query: {} },
      db, fakeLogger
    )).data.jan_2024).toBeDefined();
  });
  it("lcs: skips hits missing or invalid last_seen", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [
      { _source: { sql_id: 1 /* no last_seen */ } },
      { _source: { sql_id: 2, last_seen: "garbage" } },
      { _source: { sql_id: 3, last_seen: "2024-05-01" } },
    ]}}))}};
    const out = await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "lcs" }, query: {} },
      db, fakeLogger
    );
    expect(Object.keys(out.data)).toEqual(["may_2024"]);
  });
  it("lcs: sort spans years", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [
      { _source: { sql_id: 1, last_seen: "2024-03-01" } },
      { _source: { sql_id: 2, last_seen: "2023-12-01" } },
    ]}}))}};
    const out = await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2023-01-01", to_date: "2024-12-31", type: "lcs" }, query: {} },
      db, fakeLogger
    );
    expect(Object.keys(out.data)).toEqual(["dec_2023", "mar_2024"]);
  });
});
