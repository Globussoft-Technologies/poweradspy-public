import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const paramsPath = require.resolve("../../../../src/services/quora/helpers/paramParser");
const normalizeParams = vi.fn((raw) => raw);
require.cache[paramsPath] = {
  id: paramsPath, filename: paramsPath, loaded: true,
  exports: { normalizeParams },
};

const {
  getQuoraAdCountry,
  getQuoraOutgoings,
  getQuoraUserData,
  getAdvertiserCountryData,
  getAdvertiserInsightsByDateRange,
} = require("../../../../src/services/quora/controllers/adInsightsController");

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
beforeEach(() => {
  fakeLogger.error.mockClear();
  fakeLogger.warn.mockClear();
  normalizeParams.mockClear().mockImplementation((raw) => raw);
});

describe("services/quora/controllers/adInsightsController > getQuoraAdCountry", () => {
  it("401 when quora_ad_id missing", async () => {
    expect(await getQuoraAdCountry({ body: { user_id: "u" }, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters: quora_ad_id and user_id are required" });
  });
  it("401 when user_id missing", async () => {
    expect(await getQuoraAdCountry({ body: { quora_ad_id: "1" }, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters: quora_ad_id and user_id are required" });
  });
  it("503 when db.elastic missing", async () => {
    expect(await getQuoraAdCountry(
      { body: { quora_ad_id: "1", user_id: "u" }, query: {} }, { elastic: null }, fakeLogger
    )).toEqual({ code: 503, message: "Elasticsearch connection not available" });
  });
  it("400 when no ES hits", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [] } })) } };
    expect(await getQuoraAdCountry(
      { body: { quora_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 400, message: "No data found." });
  });
  it("400 when ES hit has no country", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: {} }] } })) } };
    expect((await getQuoraAdCountry(
      { body: { quora_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("400 when countries is non-array", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { "quora_country_only.country": "germany" } }] } })) } };
    expect((await getQuoraAdCountry(
      { body: { quora_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("400 when countries is empty array", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { "quora_country_only.country": [] } }] } })) } };
    expect((await getQuoraAdCountry(
      { body: { quora_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("body.hits fallback shape", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ body: { hits: { hits: [{ _source: { "quora_country_only.country": ["germany"] } }] } } })) } };
    const out = await getQuoraAdCountry(
      { body: { quora_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data[0].country).toBe("Germany");
  });
  it("200 with capitalized + iso from SQL lookup", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ country: "Germany", iso: "DE" }]) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { "quora_country_only.country": ["germany"] } }] } })) },
    };
    const out = await getQuoraAdCountry(
      { body: { quora_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data[0]).toEqual({ country: "Germany", iso: "DE" });
  });
  it("falls back to original name when SQL lookup returns 0 rows", async () => {
    const db = {
      sql: { query: vi.fn(async () => []) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { "quora_country_only.country": ["xland"] } }] } })) },
    };
    const out = await getQuoraAdCountry(
      { body: { quora_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBe("Xland");
    expect(out.data[0].iso).toBeNull();
  });
  it("SQL throw inside per-country loop is silently swallowed", async () => {
    const db = {
      sql: { query: vi.fn(async () => { throw new Error("lookup-fail"); }) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { "quora_country_only.country": ["france"] } }] } })) },
    };
    const out = await getQuoraAdCountry(
      { body: { quora_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBe("France");
  });
  it("no db.sql skips ISO lookup", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { "quora_country_only.country": ["italy"] } }] } })) } };
    const out = await getQuoraAdCountry(
      { body: { quora_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBe("Italy");
    expect(out.data[0].iso).toBeNull();
  });
  it("Czechia + Russia + congo iso fixups", async () => {
    const db = {
      sql: { query: vi.fn(async () => []) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { "quora_country_only.country": ["Czechia", "Russia", "congo"] } }] } })) },
    };
    const out = await getQuoraAdCountry(
      { body: { quora_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].iso).toBe("CZ");
    expect(out.data[1].iso).toBe("RU");
    expect(out.data[2].iso).toBe("CD");
  });
  it("null country name preserved", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { "quora_country_only.country": [null] } }] } })) } };
    const out = await getQuoraAdCountry(
      { body: { quora_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBeNull();
  });
  it("500 on ES throw", async () => {
    const db = { elastic: { search: vi.fn(async () => { throw new Error("es-down"); }) } };
    const out = await getQuoraAdCountry(
      { body: { quora_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(500);
    expect(fakeLogger.error).toHaveBeenCalled();
  });
});

describe("services/quora/controllers/adInsightsController > getQuoraOutgoings", () => {
  it("401 when ad_id missing", async () => {
    expect(await getQuoraOutgoings({ body: {}, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters: ad_id is required" });
  });
  it("503 when db.sql missing", async () => {
    expect(await getQuoraOutgoings(
      { body: { ad_id: "1" }, query: {} }, { sql: null }, fakeLogger
    )).toEqual({ code: 503, message: "SQL connection not available" });
  });
  it("200 with rows", async () => {
    const db = { sql: { query: vi.fn(async () => [{ source_url: "a", redirect_url: "b", final_url: "c" }]) } };
    expect(await getQuoraOutgoings(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 200, data: [{ source_url: "a", redirect_url: "b", final_url: "c" }] });
  });
  it("400 when no rows", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect(await getQuoraOutgoings(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 400, data: [] });
  });
  it("401/[] on SQL throw", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("fail"); }) } };
    expect(await getQuoraOutgoings(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 401, data: [] });
  });
});

describe("services/quora/controllers/adInsightsController > getQuoraUserData", () => {
  it("401 when params missing", async () => {
    expect(await getQuoraUserData({ body: { user_id: "u" }, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters" });
    expect(await getQuoraUserData({ body: { quora_ad_id: "1" }, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters" });
  });
  it("503 when db.sql missing", async () => {
    expect(await getQuoraUserData(
      { body: { quora_ad_id: "1", user_id: "u" }, query: {} }, { sql: null }, fakeLogger
    )).toEqual({ code: 503, message: "SQL connection not available" });
  });
  it("400 when no rows", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect(await getQuoraUserData(
      { body: { quora_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 400, message: "No data found.", data: null });
  });
  it("400 when null rows", async () => {
    const db = { sql: { query: vi.fn(async () => null) } };
    expect((await getQuoraUserData(
      { body: { quora_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("200 returns user rows", async () => {
    const db = { sql: { query: vi.fn(async () => [{ age: 25, name: "Alice", quora_id: "q1", current_country: "US", Gender: "F", relationship_status: "single" }]) } };
    const out = await getQuoraUserData(
      { body: { quora_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data).toHaveLength(1);
  });
  it("500 on SQL throw", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("user-fail"); }) } };
    const out = await getQuoraUserData(
      { body: { quora_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(500);
    expect(fakeLogger.error).toHaveBeenCalled();
  });
});

describe("services/quora/controllers/adInsightsController > getAdvertiserCountryData", () => {
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
  it("401 when quora_ad_id missing", async () => {
    expect(await getAdvertiserCountryData({ body: {}, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing quora_ad_id", data: null });
  });
  it("400 when post_owner_name absent", async () => {
    const db = mkDb({});
    expect((await getAdvertiserCountryData(
      { body: { quora_ad_id: "1" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("400 when db.elastic missing", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B", post_owner_id: 5 }]) },
      elastic: null,
    };
    expect((await getAdvertiserCountryData(
      { body: { quora_ad_id: "1" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("200 'No data found for this year.' when ES empty", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-06-01" },
      esHits: [],
      availableYearBuckets: [{ key_as_string: "2024" }, { key_as_string: "1969" }],
    });
    const out = await getAdvertiserCountryData(
      { body: { quora_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.message).toBe("No data found for this year.");
    expect(out.available_years).toEqual([2024]);
  });
  it("available_years sorted descending (line 193 comparator)", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-06-01" },
      esHits: [],
      availableYearBuckets: [
        { key_as_string: "2021" },
        { key_as_string: "2024" },
        { key_as_string: "2022" },
        { key_as_string: "1969" },
      ],
    });
    const out = await getAdvertiserCountryData(
      { body: { quora_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.available_years).toEqual([2024, 2022, 2021]);
  });
  it("batchCountryLookup throw → catch returns empty Map (line 261)", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }];
        throw new Error("country-lookup-fail");
      })},
      elastic: { search: vi.fn(async () => ({ hits: { hits: [
        { _source: { "quora_ad.id": 1, "quora_country_only.country": ["narnia"] } },
      ]}}))},
    };
    const out = await getAdvertiserCountryData(
      { body: { quora_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBe("Narnia");
    expect(out.data[0].iso).toBeNull();
  });
  it("year override + current year fallback", async () => {
    const db1 = mkDb({ metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-06-01" }, esHits: [] });
    expect((await getAdvertiserCountryData(
      { body: { quora_ad_id: "1", year: 2020 }, query: {} }, db1, fakeLogger
    )).year).toBe(2020);
    const db2 = mkDb({ metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: null }, esHits: [] });
    expect((await getAdvertiserCountryData(
      { body: { quora_ad_id: "1" }, query: {} }, db2, fakeLogger
    )).year).toBe(new Date().getFullYear());
  });
  it("200 with aggregated data (docvalue_fields)", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [
        { fields: { "quora_ad.id": [1], "quora_country_only.country.keyword": ["germany"] } },
        { fields: { "quora_ad.id": [2], "quora_country_only.country.keyword": ["germany"] } },
      ],
      countryRows: [{ nicename: "germany", country: "Germany", iso: "DE" }],
    });
    const out = await getAdvertiserCountryData(
      { body: { quora_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBe("Germany");
    expect(out.data[0].ad_count).toBe(2);
  });
  it("ES rejection → empty hits → 'No data found'", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }]) },
      elastic: { search: vi.fn(async () => { throw new Error("es-down"); }) },
    };
    expect((await getAdvertiserCountryData(
      { body: { quora_ad_id: "1" }, query: {} }, db, fakeLogger
    )).message).toBe("No data found for this year.");
  });
  it("ES returns body.hits shape → fallback fires (line 317 right operand)", async () => {
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
            { _source: { "quora_ad.id": 1, "quora_country_only.country": ["germany"] } },
          ]}}};
        }),
      },
    };
    const out = await getAdvertiserCountryData(
      { body: { quora_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data.map(d => d.country)).toContain("Germany");
  });
});

describe("services/quora/controllers/adInsightsController > getAdvertiserInsightsByDateRange", () => {
  it("401 when missing required params", async () => {
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5 }, query: {} }, {}, fakeLogger
    )).code).toBe(401);
  });
  it("400 when post_owner_name not found", async () => {
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
  it("country type: 400 when ES 0 hits", async () => {
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
        { _source: { "quora_ad.id": 1, "quora_country_only.country": "germany" } }
      ]}}))},
    };
    const out = await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "country" }, query: {} },
      db, fakeLogger
    );
    expect(out.data[0].country).toBe("Germany");
  });
  it("country type: ES body.hits fallback", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B" }];
        return [];
      })},
      elastic: { search: vi.fn(async () => ({ body: { hits: { hits: [
        { _source: { "quora_ad.id": 1, "quora_country_only.country": "japan" } }
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
    const out = await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "lcs" }, query: {} },
      db, fakeLogger
    );
    expect(out).toEqual({ code: 400, message: "Insight type 'lcs' not supported for this platform." });
  });
  it("country type: aggregateCountryData returns null → data:[]", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B" }];
        return [];
      })},
      elastic: { search: vi.fn(async () => ({ hits: { hits: [
        { _source: { "quora_ad.id": 1 /* no country */ } }
      ]}}))},
    };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31" }, query: {} },
      db, fakeLogger
    )).data).toEqual([]);
  });
});

describe("services/quora/controllers/adInsightsController > getAdvertiserCountryData docvalue_fields path", () => {
  it("aggregateCountryData walks hit.fields (docvalue_fields) when _source absent", async () => {
    const yearsAggResponse = { aggregations: { years: { buckets: [{ key_as_string: "2024" }] } } };
    const adsResponse = {
      hits: {
        hits: [
          { fields: { "quora_ad.id": [101], "quora_country_only.country.keyword": ["spain", "france"] } },
          { fields: { "quora_ad.id": [102], "quora_country_only.country": ["spain"] } },
          { fields: {} }, // adId missing → continue (line 209)
          { fields: { "quora_ad.id": [103], "quora_country_only.country.keyword": [null, "italy"] } },
          // null country in array → continue at line 218
        ],
      },
    };
    const db = {
      sql: { query: vi.fn()
        // 1st query: AD_META_SQL → returns post_owner_name
        .mockResolvedValueOnce([{ post_owner_name: "Acme", post_owner_id: 5, last_seen: "2024-06-01" }])
        // 2nd query: batchCountryLookup
        .mockResolvedValueOnce([
          { nicename: "spain", country: "Spain", iso: "ES" },
          { nicename: "france", country: "France", iso: "FR" },
          { nicename: "italy", country: "Italy", iso: "IT" },
        ])
      },
      elastic: {
        search: vi.fn()
          .mockResolvedValueOnce(yearsAggResponse) // available_years aggregation
          .mockResolvedValueOnce(adsResponse),     // ads w/ docvalue_fields
      },
    };
    const out = await getAdvertiserCountryData(
      { body: { quora_ad_id: "1", year: "2024" }, query: {} }, db, fakeLogger,
    );
    expect(out.code).toBe(200);
    expect(out.data.length).toBeGreaterThan(0);
    expect(out.data[0].country).toBe("Spain"); // 2 ads
  });

  it("year aggregation throws → fetchAvailableYears catch returns [] (line 194-195)", async () => {
    const db = {
      sql: { query: vi.fn().mockResolvedValueOnce([
        { post_owner_name: "Acme", post_owner_id: 5, last_seen: "2024-06-01" },
      ])},
      elastic: {
        search: vi.fn()
          .mockRejectedValueOnce(new Error("es-down")) // available_years throws
          .mockResolvedValueOnce({ hits: { hits: [] } }),
      },
    };
    const out = await getAdvertiserCountryData(
      { body: { quora_ad_id: "1", year: "2024" }, query: {} }, db, fakeLogger,
    );
    expect(out.available_years).toEqual([]);
  });
});
