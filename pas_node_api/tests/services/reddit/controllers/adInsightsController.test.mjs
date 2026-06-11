import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const paramsPath = require.resolve("../../../../src/services/reddit/helpers/paramParser");
const normalizeParams = vi.fn((raw) => raw);
require.cache[paramsPath] = {
  id: paramsPath, filename: paramsPath, loaded: true,
  exports: { normalizeParams },
};

const {
  getLikeCommentShareDetails,
  getRedditAdCountry,
  getRedirectOutgoingUrls,
  getAdvertiserLCSData,
  getAdvertiserCountryData,
  getAdvertiserInsightsByDateRange,
} = require("../../../../src/services/reddit/controllers/adInsightsController");

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
beforeEach(() => {
  fakeLogger.error.mockClear();
  normalizeParams.mockClear().mockImplementation((raw) => raw);
});

describe("services/reddit/controllers/adInsightsController > getLikeCommentShareDetails", () => {
  it("401 when params missing", async () => {
    expect(await getLikeCommentShareDetails({ body: { user_id: "u" }, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters: reddit_ad_id and user_id are required" });
  });
  it("503 when db.sql missing", async () => {
    expect(await getLikeCommentShareDetails(
      { body: { reddit_ad_id: "1", user_id: "u" }, query: {} }, { sql: null }, fakeLogger
    )).toEqual({ code: 503, message: "SQL connection not available" });
  });
  it("400 when no rows", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect(await getLikeCommentShareDetails(
      { body: { reddit_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 400, message: "No data found.", data: null });
  });
  it("200 with date coerced to Number", async () => {
    const db = { sql: { query: vi.fn(async () => [{ id: 1, reddit_ad_id: 1, likes: 5, comment: 2, share: 1, date: "1706745600" }]) } };
    const out = await getLikeCommentShareDetails(
      { body: { reddit_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data[0].date).toBe(1706745600);
  });
  it("null date stays null", async () => {
    const db = { sql: { query: vi.fn(async () => [{ id: 1, reddit_ad_id: 1, likes: 5, comment: 2, share: 1, date: null }]) } };
    const out = await getLikeCommentShareDetails(
      { body: { reddit_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].date).toBeNull();
  });
  it("500 on SQL throw", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("e"); }) } };
    expect((await getLikeCommentShareDetails(
      { body: { reddit_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(500);
  });
});

describe("services/reddit/controllers/adInsightsController > getRedditAdCountry", () => {
  it("401 when params missing", async () => {
    expect(await getRedditAdCountry({ body: { user_id: "u" }, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters: reddit_ad_id and user_id are required" });
  });
  it("503 when elastic missing", async () => {
    expect(await getRedditAdCountry(
      { body: { reddit_ad_id: "1", user_id: "u" }, query: {} }, { elastic: null }, fakeLogger
    )).toEqual({ code: 503, message: "Elasticsearch connection not available" });
  });
  it("400 when no ES hits", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [] } })) } };
    expect(await getRedditAdCountry(
      { body: { reddit_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 400, message: "No data found." });
  });
  it("400 when source has no country", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: {} }] } })) } };
    expect((await getRedditAdCountry(
      { body: { reddit_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("body.hits fallback shape", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ body: { hits: { hits: [{ _source: { "reddit_country_only.country": ["germany"] } }] } } })) } };
    const out = await getRedditAdCountry(
      { body: { reddit_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
  });
  it("200 with capitalized + iso from batch SQL lookup", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ nicename: "germany", country: "Germany", iso: "DE" }]) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { "reddit_country_only.country": ["germany"] } }] } })) },
    };
    const out = await getRedditAdCountry(
      { body: { reddit_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0]).toEqual({ country: "Germany", iso: "DE" });
  });
  it("non-array countries normalized + Czechia/Russia/Congo iso fixups", async () => {
    const db = {
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { "reddit_country_only.country": "Czechia" } }] } })) },
    };
    const out = await getRedditAdCountry(
      { body: { reddit_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].iso).toBe("CZ");
  });
  it("fixCountryIso: Russia → RU (line 48)", async () => {
    const db = {
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { "reddit_country_only.country": "Russia" } }] } })) },
    };
    const out = await getRedditAdCountry(
      { body: { reddit_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].iso).toBe("RU");
  });
  it("fixCountryIso: Congo with iso='null' → CD (line 49 string-null branch)", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ nicename: "democratic republic of the congo", country: "Democratic Republic Of The Congo", iso: "null" }]) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { "reddit_country_only.country": "democratic republic of the congo" } }] } })) },
    };
    const out = await getRedditAdCountry(
      { body: { reddit_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].iso).toBe("CD");
  });
  it("fixCountryIso: Congo with truthy non-null iso → original iso preserved", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ nicename: "congo", country: "Congo", iso: "CG" }]) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { "reddit_country_only.country": "congo" } }] } })) },
    };
    const out = await getRedditAdCountry(
      { body: { reddit_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].iso).toBe("CG");
  });
  it("null country preserved (not Title-cased)", async () => {
    const db = {
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { "reddit_country_only.country": [null] } }] } })) },
    };
    const out = await getRedditAdCountry(
      { body: { reddit_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBeNull();
  });
  it("batchCountryLookup throw → empty isoMap", async () => {
    const db = {
      sql: { query: vi.fn(async () => { throw new Error("lookup-fail"); }) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { "reddit_country_only.country": ["france"] } }] } })) },
    };
    const out = await getRedditAdCountry(
      { body: { reddit_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBe("France");
    expect(out.data[0].iso).toBeNull();
  });
  it("500 on ES throw", async () => {
    const db = { elastic: { search: vi.fn(async () => { throw new Error("es"); }) } };
    expect((await getRedditAdCountry(
      { body: { reddit_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(500);
  });
});

describe("services/reddit/controllers/adInsightsController > getRedirectOutgoingUrls", () => {
  it("401 when params missing", async () => {
    expect(await getRedirectOutgoingUrls({ body: {}, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters: reddit_ad_id and user_id are required" });
  });
  it("503 when db.sql missing", async () => {
    expect(await getRedirectOutgoingUrls(
      { body: { reddit_ad_id: "1", user_id: "u" }, query: {} }, { sql: null }, fakeLogger
    )).toEqual({ code: 503, message: "SQL connection not available" });
  });
  it("200 with rows", async () => {
    const db = { sql: { query: vi.fn(async () => [{ url: "u" }]) } };
    expect(await getRedirectOutgoingUrls(
      { body: { reddit_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 200, message: "Reddit_ad_url details.", data: [{ url: "u" }] });
  });
  it("400 when no rows", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect(await getRedirectOutgoingUrls(
      { body: { reddit_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 400, message: "Reddit_ad_url no data found.", data: null });
  });
  it("401/null on SQL throw", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("err"); }) } };
    expect(await getRedirectOutgoingUrls(
      { body: { reddit_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 401, data: null });
  });
});

describe("services/reddit/controllers/adInsightsController > getAdvertiserLCSData", () => {
  function mkDb({ metaRow = null, esHits = [], analyticsRows = [], availableYearBuckets = [] } = {}) {
    let sqlCall = 0;
    return {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return metaRow ? [metaRow] : [];
        return analyticsRows;
      })},
      elastic: { search: vi.fn(async (params) => {
        if (params.body.aggs?.years) {
          return { aggregations: { years: { buckets: availableYearBuckets } } };
        }
        return { hits: { hits: esHits } };
      })},
    };
  }
  it("401 when reddit_ad_id missing", async () => {
    expect((await getAdvertiserLCSData({ body: {}, query: {} }, {}, fakeLogger)).code).toBe(401);
  });
  it("400 when no postOwnerName", async () => {
    expect((await getAdvertiserLCSData(
      { body: { reddit_ad_id: "1" }, query: {} }, mkDb({}), fakeLogger
    )).code).toBe(400);
  });
  it("400 when elastic missing", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B", post_owner_id: 5 }]) },
      elastic: null,
    };
    expect((await getAdvertiserLCSData(
      { body: { reddit_ad_id: "1" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("year override + null last_seen fallback", async () => {
    let db = mkDb({ metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-06-01" }, esHits: [] });
    expect((await getAdvertiserLCSData(
      { body: { reddit_ad_id: "1", year: 2020 }, query: {} }, db, fakeLogger
    )).year).toBe(2020);

    db = mkDb({ metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: null }, esHits: [] });
    expect((await getAdvertiserLCSData(
      { body: { reddit_ad_id: "1" }, query: {} }, db, fakeLogger
    )).year).toBe(new Date().getFullYear());
  });
  it("200 'No data found for this year.' when ES empty", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-06-01" },
      esHits: [],
      availableYearBuckets: [{ key_as_string: "2024" }, { key_as_string: "1969" }],
    });
    const out = await getAdvertiserLCSData(
      { body: { reddit_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.message).toBe("No data found for this year.");
    expect(out.available_years).toEqual([2024]);
  });
  it("available_years sorted descending (line 205 comparator)", async () => {
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
    const out = await getAdvertiserLCSData(
      { body: { reddit_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.available_years).toEqual([2024, 2022, 2021]);
  });
  it("200 with monthly aggregation + analytics map", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [
        { _source: { "reddit_ad.id": 1, "reddit_ad.last_seen": "2024-02-01" } },
        { _source: { "reddit_ad.id": 2, "reddit_ad.last_seen": 1706832000 } }, // unix s, 2024-02-02
        { _source: { "reddit_ad.id": 3, "reddit_ad.last_seen": "2024-03-15T00:00:00Z" } },
      ],
      analyticsRows: [
        { reddit_ad_id: 1, total_likes: 10, total_comments: 2, total_shares: 1 },
        { reddit_ad_id: 3, total_likes: 5, total_comments: 0, total_shares: 1 },
      ],
    });
    const out = await getAdvertiserLCSData(
      { body: { reddit_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data.feb_2024.ad_ids).toEqual([1, 2]);
    expect(out.data.feb_2024.likes).toBe(10); // only ad 1 has analytics
    expect(out.data.mar_2024.likes).toBe(5);
  });
  it("ms timestamp branch in parseESDate", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [{ _source: { "reddit_ad.id": 1, "reddit_ad.last_seen": 1706745600000 } }], // ms = 2024-02-01
      analyticsRows: [],
    });
    const out = await getAdvertiserLCSData(
      { body: { reddit_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data.feb_2024).toBeDefined();
  });
  it("body.hits fallback + analyticsRows null", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }];
        return null;
      })},
      elastic: { search: vi.fn(async () => ({ body: { hits: { hits: [
        { _source: { "reddit_ad.id": 1, "reddit_ad.last_seen": "2024-03-01" } }
      ]}}}))},
    };
    const out = await getAdvertiserLCSData(
      { body: { reddit_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data.mar_2024.likes).toBe(0);
  });
  it("falsy analytics totals coerced to 0", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [{ _source: { "reddit_ad.id": 1, "reddit_ad.last_seen": "2024-01-01" } }],
      analyticsRows: [{ reddit_ad_id: 1, total_likes: null, total_comments: null, total_shares: null }],
    });
    const out = await getAdvertiserLCSData(
      { body: { reddit_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data.jan_2024.likes).toBe(0);
  });
  it("ES rejection → empty hits → 'No data found'", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }]) },
      elastic: { search: vi.fn(async () => { throw new Error("es-down"); }) },
    };
    expect((await getAdvertiserLCSData(
      { body: { reddit_ad_id: "1" }, query: {} }, db, fakeLogger
    )).message).toBe("No data found for this year.");
  });
  it("hits with missing adId / last_seen → aggregateLCSData returns null → data={}", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [{ _source: { /* no id, no last_seen */ } }],
    });
    const out = await getAdvertiserLCSData(
      { body: { reddit_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data).toEqual({});
  });
  it("parseESDate isNaN fallback: malformed string falls back to new Date() (line 155)", async () => {
    const now = new Date();
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [{ _source: { "reddit_ad.id": 1, "reddit_ad.last_seen": "not-a-real-date" } }],
    });
    const out = await getAdvertiserLCSData(
      { body: { reddit_ad_id: "1", year: now.getFullYear() }, query: {} }, db, fakeLogger
    );
    const key = `${["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"][now.getMonth()]}_${now.getFullYear()}`;
    expect(out.data[key]).toBeDefined();
    expect(out.data[key].ad_ids).toEqual([1]);
  });
});

describe("services/reddit/controllers/adInsightsController > getAdvertiserCountryData", () => {
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
  it("401 when reddit_ad_id missing", async () => {
    expect((await getAdvertiserCountryData({ body: {}, query: {} }, {}, fakeLogger)).code).toBe(401);
  });
  it("400 when no postOwnerName", async () => {
    expect((await getAdvertiserCountryData(
      { body: { reddit_ad_id: "1" }, query: {} }, mkDb({}), fakeLogger
    )).code).toBe(400);
  });
  it("400 when elastic missing", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B", post_owner_id: 5 }]) },
      elastic: null,
    };
    expect((await getAdvertiserCountryData(
      { body: { reddit_ad_id: "1" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("200 'No data found for this year.' when ES empty", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-06-01" },
      esHits: [],
      availableYearBuckets: [{ key_as_string: "2024" }, { key_as_string: "1969" }],
    });
    const out = await getAdvertiserCountryData(
      { body: { reddit_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.message).toBe("No data found for this year.");
  });
  it("year override + null last_seen → current year", async () => {
    let db = mkDb({ metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-06-01" }, esHits: [] });
    expect((await getAdvertiserCountryData(
      { body: { reddit_ad_id: "1", year: 2020 }, query: {} }, db, fakeLogger
    )).year).toBe(2020);

    db = mkDb({ metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: null }, esHits: [] });
    expect((await getAdvertiserCountryData(
      { body: { reddit_ad_id: "1" }, query: {} }, db, fakeLogger
    )).year).toBe(new Date().getFullYear());
  });
  it("200 with aggregated country data (docvalue_fields)", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [
        { fields: { "reddit_ad.id": [1], "reddit_country_only.country.keyword": ["germany"] } },
        { fields: { "reddit_ad.id": [2], "reddit_country_only.country.keyword": ["germany"] } },
      ],
      countryRows: [{ nicename: "germany", country: "Germany", iso: "DE" }],
    });
    const out = await getAdvertiserCountryData(
      { body: { reddit_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBe("Germany");
    expect(out.data[0].ad_count).toBe(2);
  });
  it("_source shape support", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [{ _source: { "reddit_ad.id": 1, "reddit_country_only.country": "italy" } }],
    });
    const out = await getAdvertiserCountryData(
      { body: { reddit_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBe("Italy");
  });
  it("non-array country normalized; falsy skipped", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [
        { fields: { "reddit_ad.id": [1], "reddit_country_only.country.keyword": "japan" } },
        { fields: { "reddit_ad.id": [2], "reddit_country_only.country.keyword": [null, "", "spain"] } },
      ],
    });
    const out = await getAdvertiserCountryData(
      { body: { reddit_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    const names = out.data.map(d => d.country);
    expect(names).toEqual(expect.arrayContaining(["Japan", "Spain"]));
  });
  it("hits missing id / country skipped", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [
        { fields: { "reddit_country_only.country.keyword": ["x"] } }, // no id
        { fields: { "reddit_ad.id": [1] } }, // no country
        { fields: { "reddit_ad.id": [2], "reddit_country_only.country.keyword": ["fr"] } },
      ],
    });
    const out = await getAdvertiserCountryData(
      { body: { reddit_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data).toHaveLength(1);
  });
  it("ES returns body.hits shape → fallback fires (line 396 right operand)", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }];
        return [{ nicename: "japan", country: "Japan", iso: "JP" }];
      })},
      elastic: {
        search: vi.fn(async (params) => {
          if (params.body.aggs?.years) return { aggregations: { years: { buckets: [] } } };
          // body.hits shape (not top-level hits)
          return { body: { hits: { hits: [
            { fields: { "reddit_ad.id": [1], "reddit_country_only.country.keyword": ["japan"] } },
          ]}}};
        }),
      },
    };
    const out = await getAdvertiserCountryData(
      { body: { reddit_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data.map(d => d.country)).toContain("Japan");
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
        { fields: { "reddit_ad.id": [1], "reddit_country_only.country.keyword": ["france"] } },
      ]}}))},
    };
    const out = await getAdvertiserCountryData(
      { body: { reddit_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBe("France");
    expect(out.data[0].iso).toBeNull();
  });
  it("aggregateCountryData null → data:[]", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [{ fields: { "reddit_ad.id": [1] /* no countries */ } }],
    });
    const out = await getAdvertiserCountryData(
      { body: { reddit_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data).toEqual([]);
  });
  it("ES rejection → empty hits → 'No data found'", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }]) },
      elastic: { search: vi.fn(async () => { throw new Error("es-down"); }) },
    };
    expect((await getAdvertiserCountryData(
      { body: { reddit_ad_id: "1" }, query: {} }, db, fakeLogger
    )).message).toBe("No data found for this year.");
  });
  it("ES v8 body.hits.hits shape supported (line 469)", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }];
        return [{ nicename: "spain", country: "Spain", iso: "ES" }];
      })},
      elastic: { search: vi.fn(async () => ({ body: { hits: { hits: [
        { fields: { "reddit_ad.id": [1], "reddit_country_only.country.keyword": ["spain"] } },
      ]}}}))},
    };
    const out = await getAdvertiserCountryData(
      { body: { reddit_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBe("Spain");
    expect(out.data[0].iso).toBe("ES");
  });
  it("batchCountryLookup: sql.query returns null → empty isoMap (line 346 falsy rows)", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }];
        return null;
      })},
      elastic: { search: vi.fn(async () => ({ hits: { hits: [
        { fields: { "reddit_ad.id": [1], "reddit_country_only.country.keyword": ["mars"] } },
      ]}}))},
    };
    const out = await getAdvertiserCountryData(
      { body: { reddit_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBe("Mars");
    expect(out.data[0].iso).toBeNull();
  });
});

describe("services/reddit/controllers/adInsightsController > getAdvertiserInsightsByDateRange", () => {
  it("401 when missing required params", async () => {
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5 }, query: {} }, {}, fakeLogger
    )).code).toBe(401);
  });
  it("400 when postOwnerName absent", async () => {
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
        { _source: { "reddit_ad.id": 1, "reddit_country_only.country": "germany" } }
      ]}}))},
    };
    const out = await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "country" }, query: {} },
      db, fakeLogger
    );
    expect(out.data[0].country).toBe("Germany");
  });
  it("country type: body.hits fallback", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B" }];
        return [];
      })},
      elastic: { search: vi.fn(async () => ({ body: { hits: { hits: [
        { _source: { "reddit_ad.id": 1, "reddit_country_only.country": "japan" } }
      ]}}}))},
    };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31" }, query: {} },
      db, fakeLogger
    )).data[0].country).toBe("Japan");
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
        { _source: { "reddit_ad.id": 1 /* no country */ } }
      ]}}))},
    };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31" }, query: {} },
      db, fakeLogger
    )).data).toEqual([]);
  });
  it("lcs type: 400 when 0 hits", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B" }]) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [] } })) },
    };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "lcs" }, query: {} },
      db, fakeLogger
    )).code).toBe(400);
  });
  it("lcs type: 200 with monthly buckets", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B" }];
        return [{ reddit_ad_id: 1, total_likes: 5, total_comments: 1, total_shares: 0 }];
      })},
      elastic: { search: vi.fn(async () => ({ hits: { hits: [
        { _source: { "reddit_ad.id": 1, "reddit_ad.last_seen": "2024-05-01" } }
      ]}}))},
    };
    const out = await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "lcs" }, query: {} },
      db, fakeLogger
    );
    expect(out.data.may_2024.likes).toBe(5);
  });
  it("lcs: body.hits fallback", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B" }];
        return [];
      })},
      elastic: { search: vi.fn(async () => ({ body: { hits: { hits: [
        { _source: { "reddit_ad.id": 1, "reddit_ad.last_seen": "2024-06-01" } }
      ]}}}))},
    };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "lcs" }, query: {} },
      db, fakeLogger
    )).data.jun_2024).toBeDefined();
  });
  it("lcs: aggregateLCSData null → data:{}", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B" }];
        return [];
      })},
      elastic: { search: vi.fn(async () => ({ hits: { hits: [
        { _source: { /* no id or last_seen */ } }
      ]}}))},
    };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "lcs" }, query: {} },
      db, fakeLogger
    )).data).toEqual({});
  });
  it("unsupported type → 400", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B" }]) },
      elastic: { search: vi.fn() },
    };
    expect(await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "weird" }, query: {} },
      db, fakeLogger
    )).toEqual({ code: 400, message: "Insight type 'weird' not supported for this platform." });
  });
});
