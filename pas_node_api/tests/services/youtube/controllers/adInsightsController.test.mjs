import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const paramsPath = require.resolve("../../../../src/services/youtube/helpers/paramParser");
const normalizeParams = vi.fn((raw) => raw);
require.cache[paramsPath] = {
  id: paramsPath, filename: paramsPath, loaded: true,
  exports: { normalizeParams },
};

const {
  getLikeCommentShareDetails,
  getYoutubeAdCountry,
  getYoutubeOutgoings,
  getAdvertiserLCSData,
  getAdvertiserCountryData,
  getAdvertiserInsightsByDateRange,
} = require("../../../../src/services/youtube/controllers/adInsightsController");

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
beforeEach(() => {
  fakeLogger.error.mockClear();
  normalizeParams.mockClear().mockImplementation((raw) => raw);
});

describe("services/youtube/controllers/adInsightsController > getLikeCommentShareDetails", () => {
  it("401 when params missing", async () => {
    expect(await getLikeCommentShareDetails({ body: { user_id: "u" }, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters: youtube_ad_id and user_id are required" });
  });
  it("503 when db.sql missing", async () => {
    expect(await getLikeCommentShareDetails(
      { body: { youtube_ad_id: "1", user_id: "u" }, query: {} }, { sql: null }, fakeLogger
    )).toEqual({ code: 503, message: "SQL connection not available" });
  });
  it("400 when no rows", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect(await getLikeCommentShareDetails(
      { body: { youtube_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 400, message: "No data found.", data: null });
  });
  it("400 when rows null", async () => {
    const db = { sql: { query: vi.fn(async () => null) } };
    expect((await getLikeCommentShareDetails(
      { body: { youtube_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("200 with date coerced to Number", async () => {
    const db = { sql: { query: vi.fn(async () => [{ id: 1, youtube_ad_id: 1, likes: 5, dislike: 1, comment: 2, view: 100, date: "1706745600" }]) } };
    const out = await getLikeCommentShareDetails(
      { body: { youtube_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data[0].date).toBe(1706745600);
  });
  it("null date stays null", async () => {
    const db = { sql: { query: vi.fn(async () => [{ id: 1, youtube_ad_id: 1, likes: 5, dislike: 1, comment: 2, view: 100, date: null }]) } };
    const out = await getLikeCommentShareDetails(
      { body: { youtube_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].date).toBeNull();
  });
  it("500 on SQL throw", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("e"); }) } };
    expect((await getLikeCommentShareDetails(
      { body: { youtube_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(500);
  });
});

describe("services/youtube/controllers/adInsightsController > getYoutubeAdCountry", () => {
  it("401 when params missing", async () => {
    expect(await getYoutubeAdCountry({ body: { user_id: "u" }, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters: youtube_ad_id and user_id are required" });
  });
  it("503 when elastic missing", async () => {
    expect(await getYoutubeAdCountry(
      { body: { youtube_ad_id: "1", user_id: "u" }, query: {} }, { elastic: null }, fakeLogger
    )).toEqual({ code: 503, message: "Elasticsearch connection not available" });
  });
  it("400 when no ES hits", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [] } })) } };
    expect(await getYoutubeAdCountry(
      { body: { youtube_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 400, message: "No data found." });
  });
  it("400 when source has no countries", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: {} }] } })) } };
    expect((await getYoutubeAdCountry(
      { body: { youtube_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("400 when countries empty array", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { countries: [] } }] } })) } };
    expect((await getYoutubeAdCountry(
      { body: { youtube_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("400 when countries not array", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { countries: "germany" } }] } })) } };
    expect((await getYoutubeAdCountry(
      { body: { youtube_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("body.hits fallback shape", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ body: { hits: { hits: [{ _source: { countries: ["germany"] } }] } } })) } };
    const out = await getYoutubeAdCountry(
      { body: { youtube_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
  });
  it("200 with capitalized + iso from batch SQL lookup", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ nicename: "germany", country: "Germany", iso: "DE" }]) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { countries: ["germany"] } }] } })) },
    };
    const out = await getYoutubeAdCountry(
      { body: { youtube_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0]).toEqual({ country: "Germany", iso: "DE" });
  });
  it("Czechia → CZ fixup", async () => {
    const db = {
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { countries: ["Czechia"] } }] } })) },
    };
    const out = await getYoutubeAdCountry(
      { body: { youtube_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].iso).toBe("CZ");
  });
  it("Russia → RU fixup", async () => {
    const db = {
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { countries: ["Russia"] } }] } })) },
    };
    const out = await getYoutubeAdCountry(
      { body: { youtube_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].iso).toBe("RU");
  });
  it("Congo (null iso) → CD fixup", async () => {
    const db = {
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { countries: ["Republic of Congo"] } }] } })) },
    };
    const out = await getYoutubeAdCountry(
      { body: { youtube_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].iso).toBe("CD");
  });
  it("DR Congo → CD fixup", async () => {
    const db = {
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { countries: ["DR Congo"] } }] } })) },
    };
    const out = await getYoutubeAdCountry(
      { body: { youtube_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].iso).toBe("CD");
  });
  it("null country preserved (not Title-cased)", async () => {
    const db = {
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { countries: [null] } }] } })) },
    };
    const out = await getYoutubeAdCountry(
      { body: { youtube_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBeNull();
  });
  it("batchCountryLookup throw → empty isoMap", async () => {
    const db = {
      sql: { query: vi.fn(async () => { throw new Error("lookup-fail"); }) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { countries: ["france"] } }] } })) },
    };
    const out = await getYoutubeAdCountry(
      { body: { youtube_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBe("France");
    expect(out.data[0].iso).toBeNull();
  });
  it("500 on ES throw", async () => {
    const db = { elastic: { search: vi.fn(async () => { throw new Error("es"); }) } };
    expect((await getYoutubeAdCountry(
      { body: { youtube_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(500);
  });
});

describe("services/youtube/controllers/adInsightsController > getYoutubeOutgoings", () => {
  it("401 when ad_id missing", async () => {
    expect(await getYoutubeOutgoings({ body: {}, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters: ad_id is required" });
  });
  it("503 when db.sql missing", async () => {
    expect(await getYoutubeOutgoings(
      { body: { ad_id: "1" }, query: {} }, { sql: null }, fakeLogger
    )).toEqual({ code: 503, message: "SQL connection not available" });
  });
  it("200 with rows", async () => {
    const db = { sql: { query: vi.fn(async () => [{ source_url: "s", redirect_url: "r", final_url: "f" }]) } };
    expect(await getYoutubeOutgoings(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 200, data: [{ source_url: "s", redirect_url: "r", final_url: "f" }] });
  });
  it("400 when no rows", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect(await getYoutubeOutgoings(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 400, data: [] });
  });
  it("400 when rows null", async () => {
    const db = { sql: { query: vi.fn(async () => null) } };
    expect(await getYoutubeOutgoings(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 400, data: [] });
  });
  it("401 on SQL throw", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("err"); }) } };
    expect(await getYoutubeOutgoings(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 401, data: [] });
  });
});

describe("services/youtube/controllers/adInsightsController > getAdvertiserLCSData", () => {
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
  it("401 when youtube_ad_id missing", async () => {
    expect((await getAdvertiserLCSData({ body: {}, query: {} }, {}, fakeLogger)).code).toBe(401);
  });
  it("400 when no postOwnerName", async () => {
    expect((await getAdvertiserLCSData(
      { body: { youtube_ad_id: "1" }, query: {} }, mkDb({}), fakeLogger
    )).code).toBe(400);
  });
  it("400 when elastic missing", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B", post_owner_id: 5 }]) },
      elastic: null,
    };
    expect((await getAdvertiserLCSData(
      { body: { youtube_ad_id: "1" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("year override + null last_seen fallback", async () => {
    let db = mkDb({ metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-06-01" }, esHits: [] });
    expect((await getAdvertiserLCSData(
      { body: { youtube_ad_id: "1", year: 2020 }, query: {} }, db, fakeLogger
    )).year).toBe(2020);

    db = mkDb({ metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: null }, esHits: [] });
    expect((await getAdvertiserLCSData(
      { body: { youtube_ad_id: "1" }, query: {} }, db, fakeLogger
    )).year).toBe(new Date().getFullYear());
  });
  it("200 'No data found for this year.' when ES empty", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-06-01" },
      esHits: [],
      availableYearBuckets: [{ key_as_string: "2024" }, { key_as_string: "1969" }],
    });
    const out = await getAdvertiserLCSData(
      { body: { youtube_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.message).toBe("No data found for this year.");
    expect(out.available_years).toEqual([2024]);
  });
  it("available_years sorted descending (line 231 comparator)", async () => {
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
      { body: { youtube_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.available_years).toEqual([2024, 2022, 2021]);
  });
  it("200 with monthly aggregation + analytics map", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [
        { _source: { ad_id: 1, last_seen: "2024-02-01" } },
        { _source: { ad_id: 2, last_seen: 1706832000 } }, // unix s
        { _source: { ad_id: 3, last_seen: "2024-03-15T00:00:00Z" } },
      ],
      analyticsRows: [
        { youtube_ad_id: 1, total_likes: 10, total_dislikes: 2, total_comments: 3, total_views: 100 },
        { youtube_ad_id: 3, total_likes: 5, total_dislikes: 0, total_comments: 1, total_views: 50 },
      ],
    });
    const out = await getAdvertiserLCSData(
      { body: { youtube_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data.feb_2024.ad_ids).toEqual([1, 2]);
    expect(out.data.feb_2024.likes).toBe(10);
    expect(out.data.feb_2024.views).toBe(100);
    expect(out.data.mar_2024.likes).toBe(5);
    expect(out.data.mar_2024.dislikes).toBe(0);
  });
  it("ms timestamp branch in parseESDate", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [{ _source: { ad_id: 1, last_seen: 1706745600000 } }],
      analyticsRows: [],
    });
    const out = await getAdvertiserLCSData(
      { body: { youtube_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data.feb_2024).toBeDefined();
  });
  it("invalid date string in parseESDate → falls back to new Date()", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "not-a-date" },
      esHits: [],
    });
    const out = await getAdvertiserLCSData(
      { body: { youtube_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.year).toBe(new Date().getFullYear());
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
        { _source: { ad_id: 1, last_seen: "2024-03-01" } }
      ]}}}))},
    };
    const out = await getAdvertiserLCSData(
      { body: { youtube_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data.mar_2024.likes).toBe(0);
  });
  it("falsy analytics totals coerced to 0", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [{ _source: { ad_id: 1, last_seen: "2024-01-01" } }],
      analyticsRows: [{ youtube_ad_id: 1, total_likes: null, total_dislikes: null, total_comments: null, total_views: null }],
    });
    const out = await getAdvertiserLCSData(
      { body: { youtube_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data.jan_2024.likes).toBe(0);
    expect(out.data.jan_2024.views).toBe(0);
  });
  it("ES rejection → empty hits → 'No data found'", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }]) },
      elastic: { search: vi.fn(async () => { throw new Error("es-down"); }) },
    };
    expect((await getAdvertiserLCSData(
      { body: { youtube_ad_id: "1" }, query: {} }, db, fakeLogger
    )).message).toBe("No data found for this year.");
  });
  it("hits with missing adId / last_seen → aggregateLCSData returns null → data={}", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [{ _source: {} }],
    });
    const out = await getAdvertiserLCSData(
      { body: { youtube_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data).toEqual({});
  });
});

describe("services/youtube/controllers/adInsightsController > getAdvertiserCountryData", () => {
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
  it("401 when youtube_ad_id missing", async () => {
    expect((await getAdvertiserCountryData({ body: {}, query: {} }, {}, fakeLogger)).code).toBe(401);
  });
  it("400 when no postOwnerName", async () => {
    expect((await getAdvertiserCountryData(
      { body: { youtube_ad_id: "1" }, query: {} }, mkDb({}), fakeLogger
    )).code).toBe(400);
  });
  it("400 when elastic missing", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B", post_owner_id: 5 }]) },
      elastic: null,
    };
    expect((await getAdvertiserCountryData(
      { body: { youtube_ad_id: "1" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("200 'No data found for this year.' when ES empty", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-06-01" },
      esHits: [],
      availableYearBuckets: [{ key_as_string: "2024" }, { key_as_string: "1969" }],
    });
    const out = await getAdvertiserCountryData(
      { body: { youtube_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.message).toBe("No data found for this year.");
  });
  it("year override + null last_seen → current year", async () => {
    let db = mkDb({ metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-06-01" }, esHits: [] });
    expect((await getAdvertiserCountryData(
      { body: { youtube_ad_id: "1", year: 2020 }, query: {} }, db, fakeLogger
    )).year).toBe(2020);

    db = mkDb({ metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: null }, esHits: [] });
    expect((await getAdvertiserCountryData(
      { body: { youtube_ad_id: "1" }, query: {} }, db, fakeLogger
    )).year).toBe(new Date().getFullYear());
  });
  it("200 with aggregated country data (docvalue_fields)", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [
        { fields: { ad_id: [1], "countries.keyword": ["germany"] } },
        { fields: { ad_id: [2], "countries.keyword": ["germany"] } },
      ],
      countryRows: [{ nicename: "germany", country: "Germany", iso: "DE" }],
    });
    const out = await getAdvertiserCountryData(
      { body: { youtube_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBe("Germany");
    expect(out.data[0].ad_count).toBe(2);
  });
  it("_source shape support", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [{ _source: { ad_id: 1, countries: "italy" } }],
    });
    const out = await getAdvertiserCountryData(
      { body: { youtube_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBe("Italy");
  });
  it("docvalue with countries fallback (not .keyword)", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [{ fields: { ad_id: [1], countries: ["spain"] } }],
    });
    const out = await getAdvertiserCountryData(
      { body: { youtube_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBe("Spain");
  });
  it("non-array country normalized; falsy skipped", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [
        { fields: { ad_id: [1], "countries.keyword": "japan" } },
        { fields: { ad_id: [2], "countries.keyword": [null, "", "spain"] } },
      ],
    });
    const out = await getAdvertiserCountryData(
      { body: { youtube_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    const names = out.data.map(d => d.country);
    expect(names).toEqual(expect.arrayContaining(["Japan", "Spain"]));
  });
  it("hits missing id / country skipped", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [
        { fields: { "countries.keyword": ["x"] } },
        { fields: { ad_id: [1] } },
        { fields: { ad_id: [2], "countries.keyword": ["fr"] } },
      ],
    });
    const out = await getAdvertiserCountryData(
      { body: { youtube_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data).toHaveLength(1);
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
        { fields: { ad_id: [1], "countries.keyword": ["france"] } },
      ]}}))},
    };
    const out = await getAdvertiserCountryData(
      { body: { youtube_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBe("France");
    expect(out.data[0].iso).toBeNull();
  });
  it("aggregateCountryData null → data:[]", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [{ fields: { ad_id: [1] } }],
    });
    const out = await getAdvertiserCountryData(
      { body: { youtube_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data).toEqual([]);
  });
  it("ES rejection → empty hits → 'No data found'", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }]) },
      elastic: { search: vi.fn(async () => { throw new Error("es-down"); }) },
    };
    expect((await getAdvertiserCountryData(
      { body: { youtube_ad_id: "1" }, query: {} }, db, fakeLogger
    )).message).toBe("No data found for this year.");
  });
  it("ES returns body.hits shape → fallback fires (line 502 right operand)", async () => {
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
            { _source: { id: 1, countries: ["germany"] } },
          ]}}};
        }),
      },
    };
    const out = await getAdvertiserCountryData(
      { body: { youtube_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
  });
});

describe("services/youtube/controllers/adInsightsController > getAdvertiserInsightsByDateRange", () => {
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
        { _source: { ad_id: 1, countries: "germany" } }
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
        { _source: { ad_id: 1, countries: "japan" } }
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
        { _source: { ad_id: 1 } }
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
        return [{ youtube_ad_id: 1, total_likes: 5, total_dislikes: 0, total_comments: 1, total_views: 10 }];
      })},
      elastic: { search: vi.fn(async () => ({ hits: { hits: [
        { _source: { ad_id: 1, last_seen: "2024-05-01" } }
      ]}}))},
    };
    const out = await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "lcs" }, query: {} },
      db, fakeLogger
    );
    expect(out.data.may_2024.likes).toBe(5);
    expect(out.data.may_2024.views).toBe(10);
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
        { _source: { ad_id: 1, last_seen: "2024-06-01" } }
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
        { _source: {} }
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
  it("500 on SQL throw", async () => {
    const db = {
      sql: { query: vi.fn(async () => { throw new Error("db-down"); }) },
    };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "country" }, query: {} },
      db, fakeLogger
    )).code).toBe(500);
  });
});
