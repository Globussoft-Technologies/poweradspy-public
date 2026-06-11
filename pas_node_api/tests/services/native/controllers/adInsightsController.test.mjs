import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const paramsPath = require.resolve("../../../../src/services/native/helpers/paramParser");
const normalizeParams = vi.fn((raw) => raw);
require.cache[paramsPath] = {
  id: paramsPath, filename: paramsPath, loaded: true,
  exports: { normalizeParams },
};

const {
  getNativeAdCountry,
  getTargetSite,
  getAdNetwork,
  getRedirect,
  getRedirectOutgoingUrls,
  getAdvertiserCountryData,
  getAdvertiserInsightsByDateRange,
} = require("../../../../src/services/native/controllers/adInsightsController");

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
beforeEach(() => {
  fakeLogger.error.mockClear();
  normalizeParams.mockClear().mockImplementation((raw) => raw);
});

describe("services/native/controllers/adInsightsController > getNativeAdCountry", () => {
  it("401 when native_ad_id missing", async () => {
    expect(await getNativeAdCountry({ body: { user_id: "u" }, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters: native_ad_id and user_id are required" });
  });
  it("401 when user_id missing", async () => {
    expect(await getNativeAdCountry({ body: { native_ad_id: "1" }, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters: native_ad_id and user_id are required" });
  });
  it("503 when db.sql missing", async () => {
    expect(await getNativeAdCountry(
      { body: { native_ad_id: "1", user_id: "u" }, query: {} }, { sql: null }, fakeLogger
    )).toEqual({ code: 503, message: "SQL connection not available" });
  });
  it("400 when no rows", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect(await getNativeAdCountry(
      { body: { native_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 400, message: "No data found." });
  });
  it("400 when null rows", async () => {
    const db = { sql: { query: vi.fn(async () => null) } };
    expect((await getNativeAdCountry(
      { body: { native_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("200 with capitalized country + count + iso fixup", async () => {
    const db = { sql: { query: vi.fn(async () => [
      { country: "germany", iso: "DE", count: 5 },
      { country: "Czechia", iso: null, count: 3 },
      { country: "Russia", iso: "RU_OLD", count: 2 },
      { country: "Democratic republic of the congo", iso: null, count: 1 },
    ])}};
    const out = await getNativeAdCountry(
      { body: { native_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data[0]).toEqual({ country: "Germany", iso: "DE", count: 5 });
    expect(out.data[1].iso).toBe("CZ");
    expect(out.data[2].iso).toBe("RU");
    expect(out.data[3].iso).toBe("CD");
  });
  it("congo with iso='null' string still fixed", async () => {
    const db = { sql: { query: vi.fn(async () => [{ country: "Congo", iso: "null", count: 1 }]) } };
    const out = await getNativeAdCountry(
      { body: { native_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].iso).toBe("CD");
  });
  it("congo with valid iso passes through", async () => {
    const db = { sql: { query: vi.fn(async () => [{ country: "Congo", iso: "CG", count: 1 }]) } };
    const out = await getNativeAdCountry(
      { body: { native_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].iso).toBe("CG");
  });
  it("null country preserved", async () => {
    const db = { sql: { query: vi.fn(async () => [{ country: null, iso: "XX", count: 1 }]) } };
    const out = await getNativeAdCountry(
      { body: { native_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBeNull();
  });
  it("500 on SQL throw", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("db-fail"); }) } };
    const out = await getNativeAdCountry(
      { body: { native_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(500);
    expect(fakeLogger.error).toHaveBeenCalled();
  });
});

describe("services/native/controllers/adInsightsController > getTargetSite", () => {
  it("400 when ad_id missing", async () => {
    expect(await getTargetSite({ body: {}, query: {} }, {}, fakeLogger))
      .toEqual({ code: 400, message: "No ad_id Recieved" });
  });
  it("503 when db.sql missing", async () => {
    expect(await getTargetSite(
      { body: { ad_id: "1" }, query: {} }, { sql: null }, fakeLogger
    )).toEqual({ code: 503, message: "SQL connection not available" });
  });
  it("400 when no rows", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect(await getTargetSite(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 400, message: "Ad_id not found" });
  });
  it("200 grouping counts by date", async () => {
    const db = { sql: { query: vi.fn(async () => [
      { date: "2024-01-01", count: 5 },
      { date: "2024-01-01", count: 3 },
      { date: "2024-01-02", count: 7 },
    ])}};
    const out = await getTargetSite(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data).toEqual(expect.arrayContaining([
      { date: "2024-01-01", count: 8 },
      { date: "2024-01-02", count: 7 },
    ]));
  });
  it("falsy count coerced to 0", async () => {
    const db = { sql: { query: vi.fn(async () => [{ date: "2024-01-01", count: null }]) } };
    const out = await getTargetSite(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].count).toBe(0);
  });
  it("401 on SQL throw", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("err"); }) } };
    expect((await getTargetSite(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    )).code).toBe(401);
  });
});

describe("services/native/controllers/adInsightsController > getAdNetwork", () => {
  it("401 when params missing", async () => {
    expect(await getAdNetwork({ body: {}, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters" });
  });
  it("503 when db.sql missing", async () => {
    expect(await getAdNetwork(
      { body: { native_ad_id: "1", user_id: "u" }, query: {} }, { sql: null }, fakeLogger
    )).toEqual({ code: 503, message: "SQL connection not available" });
  });
  it("400 when no rows", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect(await getAdNetwork(
      { body: { native_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 400, message: "No data found." });
  });
  it("200 with network rows", async () => {
    const db = { sql: { query: vi.fn(async () => [{ network: "Outbrain" }, { network: "Taboola" }]) } };
    const out = await getAdNetwork(
      { body: { native_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data).toHaveLength(2);
  });
  it("500 on SQL throw", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("err"); }) } };
    expect((await getAdNetwork(
      { body: { native_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(500);
  });
});

describe("services/native/controllers/adInsightsController > getRedirect", () => {
  it("401 when native_ad_id missing", async () => {
    expect(await getRedirect({ body: {}, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters: native_ad_id is required" });
  });
  it("503 when db.sql missing", async () => {
    expect(await getRedirect(
      { body: { native_ad_id: "1" }, query: {} }, { sql: null }, fakeLogger
    )).toEqual({ code: 503, message: "SQL connection not available" });
  });
  it("400 when no rows", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect(await getRedirect(
      { body: { native_ad_id: "1" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 400, message: "Redirect_url not found", data: [] });
  });
  it("200 with redirect rows", async () => {
    const db = { sql: { query: vi.fn(async () => [{ url: "u1", url_type: "T" }]) } };
    const out = await getRedirect(
      { body: { native_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data).toHaveLength(1);
  });
  it("401/[] on SQL throw", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("fail"); }) } };
    const out = await getRedirect(
      { body: { native_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(401);
    expect(out.data).toEqual([]);
  });
});

describe("services/native/controllers/adInsightsController > getRedirectOutgoingUrls", () => {
  it("401 when native_ad_id missing", async () => {
    expect(await getRedirectOutgoingUrls({ body: {}, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters" });
  });
  it("503 when db.sql missing", async () => {
    expect(await getRedirectOutgoingUrls(
      { body: { native_ad_id: "1" }, query: {} }, { sql: null }, fakeLogger
    )).toEqual({ code: 503, message: "SQL connection not available" });
  });
  it("400 when no rows", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect(await getRedirectOutgoingUrls(
      { body: { native_ad_id: "1" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 400, data: null, message: "No urls found" });
  });
  it("200 with rows", async () => {
    const db = { sql: { query: vi.fn(async () => [{ source_url: "s", redirect_url: "r", final_url: "f" }]) } };
    expect(await getRedirectOutgoingUrls(
      { body: { native_ad_id: "1" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 200, data: [{ source_url: "s", redirect_url: "r", final_url: "f" }], message: "Urls found" });
  });
  it("500 on SQL throw", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("err"); }) } };
    const out = await getRedirectOutgoingUrls(
      { body: { native_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(500);
    expect(out.data).toBeNull();
  });
});

describe("services/native/controllers/adInsightsController > getAdvertiserCountryData", () => {
  function mkDb({ metaRow = null, esHits = [], countryRows = [], availableYearBuckets = [] } = {}) {
    let sqlCall = 0;
    return {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return metaRow ? [metaRow] : [];
        return countryRows;
      })},
      elastic: { search: vi.fn(async (params) => {
        if (params.body.aggs?.years) {
          return { aggregations: { years: { buckets: availableYearBuckets } } };
        }
        return { hits: { hits: esHits } };
      })},
    };
  }
  it("401 when native_ad_id missing", async () => {
    expect(await getAdvertiserCountryData({ body: {}, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing native_ad_id", data: null });
  });
  it("400 when no post_owner_name", async () => {
    const db = mkDb({});
    expect((await getAdvertiserCountryData(
      { body: { native_ad_id: "1" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("400 when elastic missing", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B", post_owner_id: 5 }]) },
      elastic: null,
    };
    expect((await getAdvertiserCountryData(
      { body: { native_ad_id: "1" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("200 'No data found for this year.' when ES empty", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-06-01" },
      esHits: [],
      availableYearBuckets: [{ key_as_string: "2024" }, { key_as_string: "1969" }],
    });
    const out = await getAdvertiserCountryData(
      { body: { native_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.message).toBe("No data found for this year.");
    expect(out.available_years).toEqual([2024]);
  });
  it("available_years sorted descending (line 234 comparator)", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-06-01" },
      esHits: [],
      availableYearBuckets: [
        { key_as_string: "2021" }, { key_as_string: "2024" },
        { key_as_string: "2022" }, { key_as_string: "1969" },
      ],
    });
    const out = await getAdvertiserCountryData(
      { body: { native_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.available_years).toEqual([2024, 2022, 2021]);
  });
  it("countryEntries sort comparator: multi-country with different counts (line 276)", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [
        { fields: { "native_ad.id": [1], "native_country_only.country.keyword": ["france"] } },
        { fields: { "native_ad.id": [2], "native_country_only.country.keyword": ["france"] } },
        { fields: { "native_ad.id": [3], "native_country_only.country.keyword": ["france"] } },
        { fields: { "native_ad.id": [4], "native_country_only.country.keyword": ["spain"] } },
      ],
    });
    const out = await getAdvertiserCountryData(
      { body: { native_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBe("France");
    expect(out.data[0].ad_count).toBe(3);
    expect(out.data[1].country).toBe("Spain");
  });
  it("year override + current year fallback", async () => {
    const db1 = mkDb({ metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-06-01" }, esHits: [] });
    expect((await getAdvertiserCountryData(
      { body: { native_ad_id: "1", year: 2020 }, query: {} }, db1, fakeLogger
    )).year).toBe(2020);
    const db2 = mkDb({ metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: null }, esHits: [] });
    expect((await getAdvertiserCountryData(
      { body: { native_ad_id: "1" }, query: {} }, db2, fakeLogger
    )).year).toBe(new Date().getFullYear());
  });
  it("200 with aggregated data (docvalue_fields)", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [
        { fields: { "native_ad.id": [1], "native_country_only.country.keyword": ["germany"] } },
        { fields: { "native_ad.id": [2], "native_country_only.country.keyword": ["germany"] } },
      ],
      countryRows: [{ nicename: "germany", country: "Germany", iso: "DE" }],
    });
    const out = await getAdvertiserCountryData(
      { body: { native_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBe("Germany");
    expect(out.data[0].ad_count).toBe(2);
  });
  it("_source shape (date-range variant)", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [{ _source: { "native_ad.id": 1, "native_country_only.country": "italy" } }],
    });
    const out = await getAdvertiserCountryData(
      { body: { native_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBe("Italy");
  });
  it("non-array country normalized", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [{ fields: { "native_ad.id": [1], "native_country_only.country.keyword": "japan" } }],
    });
    const out = await getAdvertiserCountryData(
      { body: { native_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBe("Japan");
  });
  it("ES returns body.hits shape → fallback fires (line 364 right operand)", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }];
        return [{ nicename: "germany", country: "Germany", iso: "DE" }];
      })},
      elastic: {
        search: vi.fn(async (params) => {
          if (params.body.aggs?.years) return { aggregations: { years: { buckets: [] } } };
          return { body: { hits: { hits: [
            { fields: { "native_ad.id": [1], "native_country_only.country.keyword": ["germany"] } },
          ]}}};
        }),
      },
    };
    const out = await getAdvertiserCountryData(
      { body: { native_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data.map(d => d.country)).toContain("Germany");
  });

  it("hit missing adId skipped + falsy country skipped", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [
        { fields: { "native_country_only.country.keyword": ["x"] } }, // no id
        { fields: { "native_ad.id": [1], "native_country_only.country.keyword": ["", null, "spain"] } },
      ],
    });
    const out = await getAdvertiserCountryData(
      { body: { native_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data).toHaveLength(1);
    expect(out.data[0].country).toBe("Spain");
  });
  it("hit with no country skipped", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [{ fields: { "native_ad.id": [1] } }],
    });
    const out = await getAdvertiserCountryData(
      { body: { native_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data).toEqual([]);
  });
  it("batchCountryLookup throw → empty isoMap", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }];
        throw new Error("lookup-fail");
      })},
      elastic: { search: vi.fn(async () => ({ hits: { hits: [
        { fields: { "native_ad.id": [1], "native_country_only.country.keyword": ["france"] } }
      ]}}))},
    };
    const out = await getAdvertiserCountryData(
      { body: { native_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBe("France");
    expect(out.data[0].iso).toBeNull();
  });
  it("ES rejection → empty hits", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }]) },
      elastic: { search: vi.fn(async () => { throw new Error("es-down"); }) },
    };
    expect((await getAdvertiserCountryData(
      { body: { native_ad_id: "1" }, query: {} }, db, fakeLogger
    )).message).toBe("No data found for this year.");
  });
});

describe("services/native/controllers/adInsightsController > getAdvertiserInsightsByDateRange", () => {
  it("401 when missing params", async () => {
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5 }, query: {} }, {}, fakeLogger
    )).code).toBe(401);
  });
  it("400 when post_owner_name absent", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31" }, query: {} },
      db, fakeLogger
    )).code).toBe(400);
  });
  it("400 when elastic missing", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B" }]) },
      elastic: null,
    };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31" }, query: {} },
      db, fakeLogger
    )).code).toBe(400);
  });
  it("country type: 400 when 0 hits", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B" }]) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [] } })) },
    };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31" }, query: {} },
      db, fakeLogger
    )).code).toBe(400);
  });
  it("country type: 200 with data", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B" }];
        return [];
      })},
      elastic: { search: vi.fn(async () => ({ hits: { hits: [
        { _source: { "native_ad.id": 1, "native_country_only.country": "germany" } }
      ]}}))},
    };
    const out = await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "country" }, query: {} },
      db, fakeLogger
    );
    expect(out.data[0].country).toBe("Germany");
  });
  it("ES body.hits fallback", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B" }];
        return [];
      })},
      elastic: { search: vi.fn(async () => ({ body: { hits: { hits: [
        { _source: { "native_ad.id": 1, "native_country_only.country": "japan" } }
      ]}}}))},
    };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31" }, query: {} },
      db, fakeLogger
    )).data[0].country).toBe("Japan");
  });
  it("unsupported type → 400", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B" }]) },
      elastic: { search: vi.fn() },
    };
    expect(await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "lcs" }, query: {} },
      db, fakeLogger
    )).toEqual({ code: 400, message: "Insight type 'lcs' not supported for this platform." });
  });
  it("country type: aggregateCountryData null → data:[]", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B" }];
        return [];
      })},
      elastic: { search: vi.fn(async () => ({ hits: { hits: [
        { _source: { "native_ad.id": 1 /* no country */ } }
      ]}}))},
    };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31" }, query: {} },
      db, fakeLogger
    )).data).toEqual([]);
  });
});
