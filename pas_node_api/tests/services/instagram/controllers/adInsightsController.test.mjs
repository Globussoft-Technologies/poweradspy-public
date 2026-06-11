import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const paramsPath = require.resolve("../../../../src/services/instagram/helpers/paramParser");
const normalizeParams = vi.fn((raw) => raw);
require.cache[paramsPath] = {
  id: paramsPath, filename: paramsPath, loaded: true,
  exports: { normalizeParams },
};

const {
  getLikeCommentShareDetails,
  getInstagramAdCountry,
  getInstagramUserData,
  getRedirectOutgoingUrls,
  getAdsLibUserData,
  getAdvertiserLCSData,
  getAdvertiserCountryData,
  getAdvertiserInsightsByDateRange,
} = require("../../../../src/services/instagram/controllers/adInsightsController");

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
beforeEach(() => {
  fakeLogger.error.mockClear();
  normalizeParams.mockClear().mockImplementation((raw) => raw);
});

describe("services/instagram/controllers/adInsightsController > getLikeCommentShareDetails", () => {
  it("401 when params missing", async () => {
    expect(await getLikeCommentShareDetails({ body: { user_id: "u" }, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters: instagram_ad_id and user_id are required" });
  });
  it("503 when db.sql missing", async () => {
    expect(await getLikeCommentShareDetails(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, { sql: null }, fakeLogger
    )).toEqual({ code: 503, message: "SQL connection not available" });
  });
  it("400 when no rows", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect((await getLikeCommentShareDetails(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("400 when rows null", async () => {
    const db = { sql: { query: vi.fn(async () => null) } };
    expect((await getLikeCommentShareDetails(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("200 with date coerced to Number", async () => {
    const db = { sql: { query: vi.fn(async () => [{ id: 1, instagram_ad_id: 1, likes: 5, comment: 2, share: 1, date: "1706745600" }]) } };
    const out = await getLikeCommentShareDetails(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data[0].date).toBe(1706745600);
  });
  it("null date stays null", async () => {
    const db = { sql: { query: vi.fn(async () => [{ id: 1, date: null }]) } };
    const out = await getLikeCommentShareDetails(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].date).toBeNull();
  });
  it("500 on SQL throw", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("e"); }) } };
    expect((await getLikeCommentShareDetails(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(500);
  });
});

describe("services/instagram/controllers/adInsightsController > getInstagramAdCountry", () => {
  it("401 when params missing", async () => {
    expect(await getInstagramAdCountry({ body: { user_id: "u" }, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters: instagram_ad_id and user_id are required" });
  });
  it("503 when db.sql missing", async () => {
    expect(await getInstagramAdCountry(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, { sql: null }, fakeLogger
    )).toEqual({ code: 503, message: "SQL connection not available" });
  });
  it("400 when no rows", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect((await getInstagramAdCountry(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("400 when rows null", async () => {
    const db = { sql: { query: vi.fn(async () => null) } };
    expect((await getInstagramAdCountry(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("200 with iso lookup, dedup duplicates, title-case", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async (sql, params) => {
        call++;
        if (call === 1) return [{ country: "germany" }, { country: "germany" }, { country: "france" }];
        if (params[0] === "germany") return [{ country: "Germany", instagram_country_iso: "DE" }];
        if (params[0] === "france") return [{ country: "France", instagram_country_iso: "FR" }];
        return [];
      })},
    };
    const out = await getInstagramAdCountry(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data).toEqual([
      { country: "Germany", iso: "DE" },
      { country: "France", iso: "FR" },
    ]);
  });
  it("skips empty country names", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [{ country: null }, { country: "" }, { country: "spain" }];
        return [{ country: "Spain", instagram_country_iso: "ES" }];
      })},
    };
    const out = await getInstagramAdCountry(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data).toEqual([{ country: "Spain", iso: "ES" }]);
  });
  it("iso lookup throw silently skipped → iso null", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [{ country: "italy" }];
        throw new Error("iso-fail");
      })},
    };
    const out = await getInstagramAdCountry(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0]).toEqual({ country: "Italy", iso: null });
  });
  it("Czechia → CZ fixup", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [{ country: "Czechia" }];
        return [];
      })},
    };
    const out = await getInstagramAdCountry(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].iso).toBe("CZ");
  });
  it("Russia → RU fixup", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [{ country: "Russia" }];
        return [];
      })},
    };
    const out = await getInstagramAdCountry(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].iso).toBe("RU");
  });
  it("Congo with null iso → CD fixup", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [{ country: "Republic of Congo" }];
        return [];
      })},
    };
    const out = await getInstagramAdCountry(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].iso).toBe("CD");
  });
  it("Congo with 'null' string iso → CD fixup", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async (sql, params) => {
        call++;
        if (call === 1) return [{ country: "Republic of Congo" }];
        return [{ country: "Republic of Congo", instagram_country_iso: "null" }];
      })},
    };
    const out = await getInstagramAdCountry(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].iso).toBe("CD");
  });
  it("500 on outer SQL throw", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("db"); }) } };
    expect((await getInstagramAdCountry(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(500);
  });
});

describe("services/instagram/controllers/adInsightsController > getInstagramUserData", () => {
  it("401 when params missing", async () => {
    expect((await getInstagramUserData({ body: {}, query: {} }, {}, fakeLogger)).code).toBe(401);
  });
  it("503 when db.sql missing", async () => {
    expect(await getInstagramUserData(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, { sql: null }, fakeLogger
    )).toEqual({ code: 503, message: "SQL connection not available" });
  });
  it("201 when no ad-user rows", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect((await getInstagramUserData(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(201);
  });
  it("201 when ad-user rows have no user_id", async () => {
    const db = { sql: { query: vi.fn(async () => [{ user_id: null }, { user_id: 0 }]) } };
    expect((await getInstagramUserData(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(201);
  });
  it("400 when ig users empty", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ user_id: 5 }];
      return [];
    }) } };
    expect((await getInstagramUserData(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("200 with user rows", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ user_id: 5 }];
      return [{ id: 5, name: "alice" }];
    }) } };
    const out = await getInstagramUserData(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data).toEqual([{ id: 5, name: "alice" }]);
  });
  it("500 on SQL throw", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("e"); }) } };
    expect((await getInstagramUserData(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(500);
  });
});

describe("services/instagram/controllers/adInsightsController > getRedirectOutgoingUrls", () => {
  it("401 when params missing", async () => {
    expect(await getRedirectOutgoingUrls({ body: {}, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters: instagram_ad_id and user_id are required" });
  });
  it("503 when db.sql missing", async () => {
    expect(await getRedirectOutgoingUrls(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, { sql: null }, fakeLogger
    )).toEqual({ code: 503, message: "SQL connection not available" });
  });
  it("200 with rows", async () => {
    const db = { sql: { query: vi.fn(async () => [{ url_type: "click", url: "https://x" }]) } };
    expect(await getRedirectOutgoingUrls(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 200, message: "FacebookAd details.", data: [{ url_type: "click", url: "https://x" }] });
  });
  it("400 when no rows", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect((await getRedirectOutgoingUrls(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("401 on SQL throw", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("err"); }) } };
    expect((await getRedirectOutgoingUrls(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(401);
  });
});

describe("services/instagram/controllers/adInsightsController > getAdsLibUserData", () => {
  it("401 when params missing", async () => {
    expect((await getAdsLibUserData({ body: {}, query: {} }, {}, fakeLogger)).code).toBe(401);
  });
  it("503 when db.sql missing", async () => {
    expect(await getAdsLibUserData(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, { sql: null }, fakeLogger
    )).toEqual({ code: 503, message: "SQL connection not available" });
  });
  it("400 when no rows", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect((await getAdsLibUserData(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("200 with parsed gender/age JSON", async () => {
    const db = { sql: { query: vi.fn(async () => [{ gender_details: '{"male":50}', age_details: '{"18-24":30}' }]) } };
    const out = await getAdsLibUserData(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data).toEqual({ genderData: { male: 50 }, ageData: { "18-24": 30 } });
  });
  it("200 with null details → {}", async () => {
    const db = { sql: { query: vi.fn(async () => [{ gender_details: null, age_details: null }]) } };
    const out = await getAdsLibUserData(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data).toEqual({ genderData: {}, ageData: {} });
  });
  it("401 on JSON.parse throw", async () => {
    const db = { sql: { query: vi.fn(async () => [{ gender_details: 'not-json', age_details: '{}' }]) } };
    expect((await getAdsLibUserData(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(401);
  });
  it("401 on SQL throw", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("e"); }) } };
    expect((await getAdsLibUserData(
      { body: { instagram_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(401);
  });
});

describe("services/instagram/controllers/adInsightsController > getAdvertiserLCSData", () => {
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
  it("401 when instagram_ad_id missing", async () => {
    expect((await getAdvertiserLCSData({ body: {}, query: {} }, {}, fakeLogger)).code).toBe(401);
  });
  it("503 when elastic missing", async () => {
    expect((await getAdvertiserLCSData(
      { body: { instagram_ad_id: "1" }, query: {} }, { sql: null, elastic: null }, fakeLogger
    )).code).toBe(503);
  });
  it("400 when no postOwnerName", async () => {
    expect((await getAdvertiserLCSData(
      { body: { instagram_ad_id: "1" }, query: {} }, mkDb({}), fakeLogger
    )).code).toBe(400);
  });
  it("400 when ES returns 0 hits → null monthlyData", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-06-01" },
      esHits: [],
    });
    expect((await getAdvertiserLCSData(
      { body: { instagram_ad_id: "1" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("400 when all hits skipped → null monthlyData", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-06-01" },
      esHits: [{ _source: {} }],
    });
    expect((await getAdvertiserLCSData(
      { body: { instagram_ad_id: "1" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("400 when invalid date in hits → skipped", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-06-01" },
      esHits: [{ _source: { "instagram_ad.id": 1, "instagram_ad.last_seen": "not-a-date" } }],
    });
    expect((await getAdvertiserLCSData(
      { body: { instagram_ad_id: "1" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("null last_seen → adYear = current year", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: null },
      esHits: [],
    });
    expect((await getAdvertiserLCSData(
      { body: { instagram_ad_id: "1" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("invalid last_seen → adYear = current year", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "garbage" },
      esHits: [],
    });
    expect((await getAdvertiserLCSData(
      { body: { instagram_ad_id: "1" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("200 with monthly aggregation + analytics map + body.hits fallback", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }];
        return [
          { instagram_ad_id: 1, total_likes: 10, total_comments: 2, total_shares: 1 },
          { instagram_ad_id: 3, total_likes: 5, total_comments: 0, total_shares: 1 },
        ];
      })},
      elastic: { search: vi.fn(async (params) => {
        if (params.body.aggs?.years) {
          return { aggregations: { years: { buckets: [{ key_as_string: "2024" }] } } };
        }
        return { body: { hits: { hits: [
          { _source: { "instagram_ad.id": 1, "instagram_ad.last_seen": "2024-02-01" } },
          { _source: { "instagram_ad.id": 2, "instagram_ad.last_seen": "2024-02-02" } },
          { _source: { "instagram_ad.id": 3, "instagram_ad.last_seen": "2024-03-15" } },
        ]}}};
      })},
    };
    const out = await getAdvertiserLCSData(
      { body: { instagram_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data.feb_2024.ad_ids).toEqual([1, 2]);
    expect(out.data.feb_2024.likes).toBe(10);
    expect(out.data.mar_2024.likes).toBe(5);
    expect(out.available_years).toEqual([2024]);
  });
  it("falsy analytics totals coerced to 0; analyticsRows null", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }];
        return null;
      })},
      elastic: { search: vi.fn(async (params) => {
        if (params.body.aggs?.years) return { aggregations: { years: { buckets: [] } } };
        return { hits: { hits: [{ _source: { "instagram_ad.id": 1, "instagram_ad.last_seen": "2024-01-01" } }] } };
      })},
    };
    const out = await getAdvertiserLCSData(
      { body: { instagram_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data.jan_2024.likes).toBe(0);
  });
  it("availableYears with multiple buckets exercises sort comparator", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }];
        return [];
      })},
      elastic: { search: vi.fn(async (params) => {
        if (params.body.aggs?.years) {
          return { aggregations: { years: { buckets: [
            { key_as_string: "2024" },
            { key_as_string: "2022" },
            { key_as_string: "not-a-year" },
            { key_as_string: "2023" },
          ]}}};
        }
        return { hits: { hits: [{ _source: { "instagram_ad.id": 1, "instagram_ad.last_seen": "2024-01-01" } }] } };
      })},
    };
    const out = await getAdvertiserLCSData(
      { body: { instagram_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.available_years).toEqual([2022, 2023, 2024]);
  });
  it("availableYears rejection → empty array", async () => {
    let esCall = 0;
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }]) },
      elastic: { search: vi.fn(async (params) => {
        esCall++;
        if (params.body.aggs?.years) throw new Error("agg-down");
        return { hits: { hits: [{ _source: { "instagram_ad.id": 1, "instagram_ad.last_seen": "2024-01-01" } }] } };
      })},
    };
    const out = await getAdvertiserLCSData(
      { body: { instagram_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.available_years).toEqual([]);
  });
});

describe("services/instagram/controllers/adInsightsController > getAdvertiserCountryData", () => {
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
  it("401 when instagram_ad_id missing", async () => {
    expect((await getAdvertiserCountryData({ body: {}, query: {} }, {})).code).toBe(401);
  });
  it("400 when no postOwnerName", async () => {
    expect((await getAdvertiserCountryData(
      { body: { instagram_ad_id: "1" }, query: {} }, mkDb({})
    )).code).toBe(400);
  });
  it("400 when elastic missing", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B", post_owner_id: 5 }]) },
      elastic: null,
    };
    expect((await getAdvertiserCountryData(
      { body: { instagram_ad_id: "1" }, query: {} }, db
    )).code).toBe(400);
  });
  it("400 when ES rejection (null result)", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }]) },
      elastic: { search: vi.fn(async () => { throw new Error("es-down"); }) },
    };
    expect((await getAdvertiserCountryData(
      { body: { instagram_ad_id: "1" }, query: {} }, db
    )).code).toBe(400);
  });
  it("400 when ES 0 hits", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [],
    });
    expect((await getAdvertiserCountryData(
      { body: { instagram_ad_id: "1" }, query: {} }, db
    )).code).toBe(400);
  });
  it("null last_seen → adYear = current year", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: null },
      esHits: [],
    });
    expect((await getAdvertiserCountryData(
      { body: { instagram_ad_id: "1" }, query: {} }, db
    )).code).toBe(400);
  });
  it("invalid last_seen → adYear = current year", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "garbage" },
      esHits: [],
    });
    expect((await getAdvertiserCountryData(
      { body: { instagram_ad_id: "1" }, query: {} }, db
    )).code).toBe(400);
  });
  it("200 with aggregated country (docvalue_fields) + body.hits fallback", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }];
        return [{ nicename: "germany", country: "germany", iso: "DE" }];
      })},
      elastic: { search: vi.fn(async (params) => {
        if (params.body.aggs?.years) return { aggregations: { years: { buckets: [] } } };
        return { body: { hits: { hits: [
          { fields: { "instagram_ad.id": [1], "instagram_country_only.country.keyword": ["germany"] } },
          { fields: { "instagram_ad.id": [2], "instagram_country_only.country.keyword": ["germany"] } },
        ]}}};
      })},
    };
    const out = await getAdvertiserCountryData(
      { body: { instagram_ad_id: "1" }, query: {} }, db
    );
    expect(out.data[0].country).toBe("Germany");
    expect(out.data[0].ad_count).toBe(2);
  });
  it("_source shape support", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [{ _source: { "instagram_ad.id": 1, "instagram_country_only.country": "italy" } }],
    });
    const out = await getAdvertiserCountryData(
      { body: { instagram_ad_id: "1" }, query: {} }, db
    );
    expect(out.data[0].country).toBe("Italy");
  });
  it("docvalue countries fallback (not .keyword)", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [{ fields: { "instagram_ad.id": [1], "instagram_country_only.country": ["spain"] } }],
    });
    const out = await getAdvertiserCountryData(
      { body: { instagram_ad_id: "1" }, query: {} }, db
    );
    expect(out.data[0].country).toBe("Spain");
  });
  it("non-array country normalized; falsy skipped", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [
        { fields: { "instagram_ad.id": [1], "instagram_country_only.country.keyword": "japan" } },
        { fields: { "instagram_ad.id": [2], "instagram_country_only.country.keyword": [null, "", "spain"] } },
      ],
    });
    const out = await getAdvertiserCountryData(
      { body: { instagram_ad_id: "1" }, query: {} }, db
    );
    const names = out.data.map(d => d.country);
    expect(names).toEqual(expect.arrayContaining(["Japan", "Spain"]));
  });
  it("hits missing id / country skipped → null → 400", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [
        { fields: { "instagram_country_only.country.keyword": ["x"] } },
        { fields: { "instagram_ad.id": [1] } },
      ],
    });
    expect((await getAdvertiserCountryData(
      { body: { instagram_ad_id: "1" }, query: {} }, db
    )).code).toBe(400);
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
        { fields: { "instagram_ad.id": [1], "instagram_country_only.country.keyword": ["france"] } },
      ]}}))},
    };
    const out = await getAdvertiserCountryData(
      { body: { instagram_ad_id: "1" }, query: {} }, db
    );
    expect(out.data[0].country).toBe("France");
    expect(out.data[0].iso).toBeNull();
  });
});

describe("services/instagram/controllers/adInsightsController > getAdvertiserInsightsByDateRange", () => {
  it("401 when user_id missing", async () => {
    expect((await getAdvertiserInsightsByDateRange({ body: {}, query: {} }, {})).code).toBe(401);
  });
  it("accepts user_id from req.user.id", async () => {
    const db = {
      sql: { query: vi.fn(async () => []) },
      elastic: { search: vi.fn() },
    };
    const out = await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31" }, query: {}, user: { id: "u" } },
      db
    );
    expect(out.code).toBe(400);
  });
  it("400 when post_owner_id missing", async () => {
    expect((await getAdvertiserInsightsByDateRange(
      { body: { user_id: "u" }, query: {} }, {}
    )).code).toBe(400);
  });
  it("400 when from_date / to_date missing", async () => {
    expect((await getAdvertiserInsightsByDateRange(
      { body: { user_id: "u", post_owner_id: 5 }, query: {} }, {}
    )).code).toBe(400);
  });
  it("400 when type invalid", async () => {
    expect((await getAdvertiserInsightsByDateRange(
      { body: { user_id: "u", post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "weird" }, query: {} },
      {}
    )).code).toBe(400);
  });
  it("400 when date format invalid", async () => {
    expect((await getAdvertiserInsightsByDateRange(
      { body: { user_id: "u", post_owner_id: 5, from_date: "2024/01/01", to_date: "2024-12-31" }, query: {} },
      {}
    )).code).toBe(400);
  });
  it("400 when from_date > to_date", async () => {
    expect((await getAdvertiserInsightsByDateRange(
      { body: { user_id: "u", post_owner_id: 5, from_date: "2024-12-31", to_date: "2024-01-01" }, query: {} },
      {}
    )).code).toBe(400);
  });
  it("503 when elastic missing", async () => {
    expect((await getAdvertiserInsightsByDateRange(
      { body: { user_id: "u", post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31" }, query: {} },
      { sql: null, elastic: null }
    )).code).toBe(503);
  });
  it("400 when postOwnerName absent", async () => {
    const db = {
      sql: { query: vi.fn(async () => []) },
      elastic: { search: vi.fn() },
    };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { user_id: "u", post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31" }, query: {} },
      db
    )).code).toBe(400);
  });
  it("lcs type: 400 when 0 hits", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B" }]) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [] } })) },
    };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { user_id: "u", post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "lcs" }, query: {} },
      db
    )).code).toBe(400);
  });
  it("lcs type: 200 with monthly buckets", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B" }];
        return [{ instagram_ad_id: 1, total_likes: 5, total_comments: 1, total_shares: 0 }];
      })},
      elastic: { search: vi.fn(async () => ({ hits: { hits: [
        { _source: { "instagram_ad.id": 1, "instagram_ad.last_seen": "2024-05-01" } }
      ]}}))},
    };
    const out = await getAdvertiserInsightsByDateRange(
      { body: { user_id: "u", post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "lcs" }, query: {} },
      db
    );
    expect(out.data.may_2024.likes).toBe(5);
  });
  it("country type: 400 when 0 hits", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B" }]) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [] } })) },
    };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { user_id: "u", post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "country" }, query: {} },
      db
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
        { _source: { "instagram_ad.id": 1, "instagram_country_only.country": "germany" } }
      ]}}))},
    };
    const out = await getAdvertiserInsightsByDateRange(
      { body: { user_id: "u", post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "country" }, query: {} },
      db
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
        { _source: { "instagram_ad.id": 1, "instagram_country_only.country": "japan" } }
      ]}}}))},
    };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { user_id: "u", post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "country" }, query: {} },
      db
    )).data[0].country).toBe("Japan");
  });
  it("country type: aggregateCountryData null → 400", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B" }];
        return [];
      })},
      elastic: { search: vi.fn(async () => ({ hits: { hits: [
        { _source: { "instagram_ad.id": 1 } }
      ]}}))},
    };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { user_id: "u", post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "country" }, query: {} },
      db
    )).code).toBe(400);
  });
  it("default type 'lcs' when omitted", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B" }];
        return [];
      })},
      elastic: { search: vi.fn(async () => ({ hits: { hits: [
        { _source: { "instagram_ad.id": 1, "instagram_ad.last_seen": "2024-07-01" } }
      ]}}))},
    };
    const out = await getAdvertiserInsightsByDateRange(
      { body: { user_id: "u", post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31" }, query: {} },
      db
    );
    expect(out.data.jul_2024).toBeDefined();
  });
});
