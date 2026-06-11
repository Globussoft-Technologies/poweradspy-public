import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Mock paramParser (pass-through normalize)
const paramsPath = require.resolve("../../../../src/services/google/helpers/paramParser");
const normalizeParams = vi.fn((raw) => raw);
require.cache[paramsPath] = {
  id: paramsPath, filename: paramsPath, loaded: true,
  exports: { normalizeParams },
};

const {
  getGoogleAdCountry,
  getGoogleOutgoings,
  getAdvertiserCountryData,
  getAdvertiserInsightsByDateRange,
} = require("../../../../src/services/google/controllers/adInsightsController");

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
beforeEach(() => {
  fakeLogger.error.mockClear();
  normalizeParams.mockClear().mockImplementation((raw) => raw);
});

describe("services/google/controllers/adInsightsController > getGoogleAdCountry", () => {
  it("401 when google_text_ad_id missing", async () => {
    expect(await getGoogleAdCountry({ body: { user_id: "u" }, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters: google_text_ad_id and user_id are required" });
  });
  it("401 when user_id missing", async () => {
    expect(await getGoogleAdCountry({ body: { google_text_ad_id: "1" }, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters: google_text_ad_id and user_id are required" });
  });
  it("503 when db.sql missing", async () => {
    expect(await getGoogleAdCountry(
      { body: { google_text_ad_id: "1", user_id: "u" }, query: {} }, { sql: null }, fakeLogger
    )).toEqual({ code: 503, message: "SQL connection not available" });
  });
  it("400 when no rows", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect(await getGoogleAdCountry(
      { body: { google_text_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 400, message: "No data found." });
  });
  it("400 when null rows", async () => {
    const db = { sql: { query: vi.fn(async () => null) } };
    expect((await getGoogleAdCountry(
      { body: { google_text_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("200 with capitalized country + iso fixup (Czechia → CZ)", async () => {
    const db = { sql: { query: vi.fn(async () => [
      { country: "germany", iso: "DE" },
      { country: "Czechia", iso: null },
      { country: "Russia", iso: "RU_OLD" },
      { country: "Democratic republic of the congo", iso: null },
    ])}};
    const out = await getGoogleAdCountry(
      { body: { google_text_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data[0]).toEqual({ country: "Germany", iso: "DE" });
    expect(out.data[1]).toEqual({ country: "Czechia", iso: "CZ" });
    expect(out.data[2]).toEqual({ country: "Russia", iso: "RU" });
    expect(out.data[3].iso).toBe("CD"); // congo + null iso
  });
  it("congo with iso='null' string still fixed to CD", async () => {
    const db = { sql: { query: vi.fn(async () => [{ country: "Congo", iso: "null" }]) } };
    const out = await getGoogleAdCountry(
      { body: { google_text_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].iso).toBe("CD");
  });
  it("South Sudan / South Korea / Syria / Tanzania iso fixups (lines 21-24)", async () => {
    const db = { sql: { query: vi.fn(async () => [
      { country: "South Sudan", iso: null },
      { country: "South Korea", iso: null },
      { country: "Syria", iso: null },
      { country: "Tanzania", iso: null },
    ])}};
    const out = await getGoogleAdCountry(
      { body: { google_text_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger,
    );
    expect(out.code).toBe(200);
    expect(out.data.find(d => d.country === "South Sudan").iso).toBe("SD");
    expect(out.data.find(d => d.country === "South Korea").iso).toBe("KP");
    expect(out.data.find(d => d.country === "Syria").iso).toBe("SY");
    expect(out.data.find(d => d.country === "Tanzania").iso).toBe("TZ");
  });
  it("congo with valid iso passes through", async () => {
    const db = { sql: { query: vi.fn(async () => [{ country: "Congo", iso: "CG" }]) } };
    const out = await getGoogleAdCountry(
      { body: { google_text_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].iso).toBe("CG");
  });
  it("null country preserved (not Title-cased)", async () => {
    const db = { sql: { query: vi.fn(async () => [{ country: null, iso: "XX" }]) } };
    const out = await getGoogleAdCountry(
      { body: { google_text_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBeNull();
  });
  it("500 on SQL throw", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("db-down"); }) } };
    const out = await getGoogleAdCountry(
      { body: { google_text_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(500);
    expect(fakeLogger.error).toHaveBeenCalled();
  });
});

describe("services/google/controllers/adInsightsController > getGoogleOutgoings", () => {
  it("401 when google_text_ad_id missing", async () => {
    expect(await getGoogleOutgoings({ body: {}, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters: ad_id is required" });
  });
  it("503 when db.sql missing", async () => {
    expect(await getGoogleOutgoings(
      { body: { ad_id: "1" }, query: {} }, { sql: null }, fakeLogger
    )).toEqual({ code: 503, message: "SQL connection not available" });
  });
  it("200 with URL rows", async () => {
    const db = { sql: { query: vi.fn(async () => [{ source_url: "a", redirect_url: "b", final_url: "c" }]) } };
    const out = await getGoogleOutgoings(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out).toEqual({ code: 200, data: [{ source_url: "a", redirect_url: "b", final_url: "c" }] });
  });
  it("400 when no rows", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect(await getGoogleOutgoings(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 400, data: [] });
  });
  it("401/[] on SQL throw", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("fail"); }) } };
    expect(await getGoogleOutgoings(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 401, data: [] });
    expect(fakeLogger.error).toHaveBeenCalled();
  });
});

describe("services/google/controllers/adInsightsController > getAdvertiserCountryData", () => {
  function mkDb({ metaRow = null, esHits = [], countryRows = [], availableYearBuckets = [] } = {}) {
    let sqlCall = 0;
    return {
      sql: { query: vi.fn(async (sql) => {
        sqlCall++;
        if (sqlCall === 1) return metaRow ? [metaRow] : [];
        // subsequent calls are batchCountryLookup
        return countryRows;
      })},
      elastic: {
        search: vi.fn(async (params) => {
          // fetchAvailableYears uses date_histogram aggs
          if (params.body.aggs?.years) {
            return { aggregations: { years: { buckets: availableYearBuckets } } };
          }
          return { hits: { hits: esHits } };
        }),
      },
    };
  }

  it("401 when google_text_ad_id missing", async () => {
    expect(await getAdvertiserCountryData({ body: {}, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing google_text_ad_id", data: null });
  });
  it("400 when no post_owner_name", async () => {
    const db = mkDb({ metaRow: null });
    expect(await getAdvertiserCountryData(
      { body: { google_text_ad_id: "1" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 400, message: "Advertiser not found", data: null });
  });
  it("400 when db.elastic missing even with valid meta", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "Brand", post_owner_id: 5 }]) },
      elastic: null,
    };
    expect((await getAdvertiserCountryData(
      { body: { google_text_ad_id: "1" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("200 'No data found for this year.' when ES returns no hits", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "Brand", post_owner_id: 5, last_seen: "2024-06-01" },
      esHits: [],
      availableYearBuckets: [
        { key_as_string: "2024" }, { key_as_string: "2023" }, { key_as_string: "1969" },
      ],
    });
    const out = await getAdvertiserCountryData(
      { body: { google_text_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.message).toBe("No data found for this year.");
    expect(out.available_years).toEqual([2024, 2023]); // 1969 filtered out
    expect(out.year).toBe(2024);
  });
  it("explicit p.year overrides ad_last_seen", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "Brand", post_owner_id: 5, last_seen: "2024-06-01" },
      esHits: [],
    });
    const out = await getAdvertiserCountryData(
      { body: { google_text_ad_id: "1", year: 2020 }, query: {} }, db, fakeLogger
    );
    expect(out.year).toBe(2020);
  });
  it("falls back to current year when no last_seen", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "Brand", post_owner_id: 5, last_seen: null },
      esHits: [],
    });
    const out = await getAdvertiserCountryData(
      { body: { google_text_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.year).toBe(new Date().getFullYear());
  });
  it("200 with aggregated country data (docvalue_fields shape)", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "Brand", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [
        { fields: { "id": [1], "country.keyword": ["germany", "Czechia"] } },
        { fields: { "id": [2], "country.keyword": ["germany"] } },
      ],
      countryRows: [
        { nicename: "germany", country: "Germany", iso: "DE" },
      ],
    });
    const out = await getAdvertiserCountryData(
      { body: { google_text_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data).toHaveLength(2);
    // Germany has 2 ads, so it sorts first
    expect(out.data[0].country).toBe("Germany");
    expect(out.data[0].ad_count).toBe(2);
  });
  it("supports _source shape (date-range variant)", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "Brand", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [
        { _source: { "id": 1, "country": "italy" } },
      ],
      countryRows: [],
    });
    const out = await getAdvertiserCountryData(
      { body: { google_text_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBe("Italy");
  });
  it("non-array country normalized to single-element array", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "Brand", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [{ fields: { "id": [1], "country.keyword": "japan" } }],
    });
    const out = await getAdvertiserCountryData(
      { body: { google_text_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBe("Japan");
  });
  it("hit missing adId is skipped", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "Brand", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [
        { fields: { "country.keyword": ["x"] } }, // no ad id
        { fields: { "id": [1], "country.keyword": ["spain"] } },
      ],
    });
    const out = await getAdvertiserCountryData(
      { body: { google_text_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data).toHaveLength(1);
    expect(out.data[0].country).toBe("Spain");
  });
  it("ES rejection → empty hits → 'No data found'", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "Brand", post_owner_id: 5, last_seen: "2024-01-01" }]) },
      elastic: { search: vi.fn(async () => { throw new Error("es-down"); }) },
    };
    const out = await getAdvertiserCountryData(
      { body: { google_text_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.message).toBe("No data found for this year.");
  });
  it("batchCountryLookup SQL throw → empty isoMap, country names used as-is", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "Brand", post_owner_id: 5, last_seen: "2024-01-01" }];
        throw new Error("lookup-fail");
      })},
      elastic: { search: vi.fn(async () => ({ hits: { hits: [
        { fields: { "id": [1], "country.keyword": ["france"] } }
      ]}}))},
    };
    const out = await getAdvertiserCountryData(
      { body: { google_text_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBe("France");
    expect(out.data[0].iso).toBeNull();
  });
  it("hit with no countries is skipped", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "Brand", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [
        { fields: { "id": [1] /* no country */ } },
        { fields: { "id": [2], "country.keyword": ["spain"] } },
      ],
    });
    const out = await getAdvertiserCountryData(
      { body: { google_text_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data).toHaveLength(1);
  });
  it("countryMap with falsy country entries skipped", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "Brand", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [
        { fields: { "id": [1], "country.keyword": ["", null, "germany"] } },
      ],
    });
    const out = await getAdvertiserCountryData(
      { body: { google_text_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data).toHaveLength(1);
    expect(out.data[0].country).toBe("Germany");
  });
  it("aggregateCountryData returns null when no country buckets produced", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "Brand", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [{ fields: { "id": [1] /* no country at all */ } }],
    });
    const out = await getAdvertiserCountryData(
      { body: { google_text_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data).toEqual([]);
  });
  it("ES returns body.hits shape → fallback fires (line 269 right operand)", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "Brand", post_owner_id: 5, last_seen: "2024-01-01" }];
        return [{ nicename: "germany", country: "Germany", iso: "DE" }];
      })},
      elastic: {
        search: vi.fn(async (params) => {
          if (params.body.aggs?.years) return { aggregations: { years: { buckets: [] } } };
          return { body: { hits: { hits: [
            { fields: { "id": [1], "country.keyword": ["germany"] } },
          ]}}};
        }),
      },
    };
    const out = await getAdvertiserCountryData(
      { body: { google_text_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data.map(d => d.country)).toContain("Germany");
  });
});

describe("services/google/controllers/adInsightsController > getAdvertiserInsightsByDateRange", () => {
  it("401 when missing required params", async () => {
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5 }, query: {} }, {}, fakeLogger
    )).code).toBe(401);
    expect((await getAdvertiserInsightsByDateRange(
      { body: { from_date: "2024-01-01", to_date: "2024-12-31" }, query: {} }, {}, fakeLogger
    )).code).toBe(401);
  });
  it("400 when post_owner_name lookup empty", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("400 when elastic missing", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "Brand" }]) },
      elastic: null,
    };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("country type: 400 when ES returns 0 hits", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "Brand" }]) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [] } })) },
    };
    const out = await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(400);
    expect(out.data).toEqual([]);
  });
  it("country type: 200 with aggregated data", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "Brand" }];
        return []; // batchCountryLookup returns empty
      })},
      elastic: { search: vi.fn(async () => ({ hits: { hits: [
        { _source: { "id": 1, "country": "germany" } }
      ]}}))},
    };
    const out = await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "country" }, query: {} },
      db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data[0].country).toBe("Germany");
  });
  it("country type: data null fallback to [] in response", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "Brand" }];
        return [];
      })},
      elastic: { search: vi.fn(async () => ({ hits: { hits: [
        { _source: { "id": 1 /* no country */ } }
      ]}}))},
    };
    const out = await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31" }, query: {} }, db, fakeLogger
    );
    expect(out.data).toEqual([]);
  });
  it("unsupported type → 400", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "Brand" }]) },
      elastic: { search: vi.fn() },
    };
    const out = await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "lcs" }, query: {} },
      db, fakeLogger
    );
    expect(out).toEqual({ code: 400, message: "Insight type 'lcs' not supported for this platform." });
  });
  it("body.hits fallback in ES result", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "Brand" }];
        return [];
      })},
      elastic: { search: vi.fn(async () => ({
        body: { hits: { hits: [{ _source: { "id": 1, "country": "japan" } }] } }
      }))},
    };
    const out = await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBe("Japan");
  });
});
