import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const paramsPath = require.resolve("../../../../src/services/linkedin/helpers/paramParser");
const normalizeParams = vi.fn((raw) => raw);
require.cache[paramsPath] = {
  id: paramsPath, filename: paramsPath, loaded: true,
  exports: { normalizeParams },
};

const {
  getLikeCommentFollowerCount,
  getLinkedinAdCountry,
  getLinkedinOutgoings,
  getAdvertiserLCSData,
  getAdvertiserCountryData,
  getAdvertiserInsightsByDateRange,
} = require("../../../../src/services/linkedin/controllers/adInsightsController");

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
beforeEach(() => {
  fakeLogger.error.mockClear();
  normalizeParams.mockClear().mockImplementation((raw) => raw);
});

describe("services/linkedin/controllers/adInsightsController > getLikeCommentFollowerCount", () => {
  it("401 when params missing", async () => {
    expect(await getLikeCommentFollowerCount({ body: { user_id: "u" }, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters: linkedin_ad_id and user_id are required" });
  });
  it("503 when db.sql missing", async () => {
    expect(await getLikeCommentFollowerCount(
      { body: { linkedin_ad_id: "1", user_id: "u" }, query: {} }, { sql: null }, fakeLogger
    )).toEqual({ code: 503, message: "SQL connection not available" });
  });
  it("400 when no analytics rows", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect(await getLikeCommentFollowerCount(
      { body: { linkedin_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 400, message: "No data found.", data: null });
  });
  it("200 with initial zero row + post_date from SQL", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [
        { linkedin_ad_id: 1, likes: 5, comments: 1, followers: 2, hits: 0, date: "2024-02-01", platform: "fb" },
        { linkedin_ad_id: 1, likes: 10, comments: 3, followers: 4, hits: 0, date: "2024-02-02", platform: "fb" },
      ];
      return [{ post_date: "2024-01-15" }];
    })}};
    const out = await getLikeCommentFollowerCount(
      { body: { linkedin_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data[0]).toEqual({
      id: 0, linkedin_ad_id: 1, likes: 0, comments: 0, followers: 0, date: "2024-01-15", platform: "fb",
    });
    expect(out.data[1].date).toBe("2024-02-01");
  });
  it("post_date <= 0 epoch → falls back to first row -1 day", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ linkedin_ad_id: 1, likes: 5, comments: 0, followers: 0, hits: 0, date: "2024-02-01", platform: "li" }];
      return [{ post_date: 0 }];
    })}};
    const out = await getLikeCommentFollowerCount(
      { body: { linkedin_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].date).toBe("2024-01-31");
  });
  it("post_date truthy but getTime() <= 0 (epoch string) → fallback first row -1 day (lines 47-49)", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ linkedin_ad_id: 1, likes: 5, comments: 0, followers: 0, hits: 0, date: "2024-02-01", platform: "li" }];
      return [{ post_date: "1970-01-01T00:00:00Z" }];
    })}};
    const out = await getLikeCommentFollowerCount(
      { body: { linkedin_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].date).toBe("2024-01-31");
  });
  it("post_date query throws → falls back to first row -1 day", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ linkedin_ad_id: 1, likes: 5, comments: 0, followers: 0, hits: 0, date: "2024-02-01", platform: "li" }];
      throw new Error("pd-fail");
    })}};
    const out = await getLikeCommentFollowerCount(
      { body: { linkedin_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].date).toBe("2024-01-31");
  });
  it("no post_date row → first row -1 day", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ linkedin_ad_id: 1, likes: 5, comments: 0, followers: 0, hits: 0, date: "2024-02-01", platform: "li" }];
      return [];
    })}};
    const out = await getLikeCommentFollowerCount(
      { body: { linkedin_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].date).toBe("2024-01-31");
  });
  it("subsequent rows' dates normalized to YYYY-MM-DD strings", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ linkedin_ad_id: 1, likes: 5, comments: 0, followers: 0, hits: 0, date: "2024-02-01T12:30:00Z", platform: "li" }];
      return [{ post_date: "2024-01-15" }];
    })}};
    const out = await getLikeCommentFollowerCount(
      { body: { linkedin_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[1].date).toBe("2024-02-01");
  });
  it("row with null date is left alone", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ linkedin_ad_id: 1, likes: 5, comments: 0, followers: 0, hits: 0, date: "2024-02-01", platform: "li" },
                              { linkedin_ad_id: 1, likes: 6, comments: 0, followers: 0, hits: 0, date: null, platform: "li" }];
      return [{ post_date: "2024-01-15" }];
    })}};
    const out = await getLikeCommentFollowerCount(
      { body: { linkedin_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[2].date).toBeNull();
  });
  it("500 on analytics SQL throw", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("err"); }) } };
    expect((await getLikeCommentFollowerCount(
      { body: { linkedin_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(500);
  });
});

describe("services/linkedin/controllers/adInsightsController > getLinkedinAdCountry", () => {
  it("401 when params missing", async () => {
    expect(await getLinkedinAdCountry({ body: {}, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters: linkedin_ad_id and user_id are required" });
  });
  it("503 when db.sql missing", async () => {
    expect(await getLinkedinAdCountry(
      { body: { linkedin_ad_id: "1", user_id: "u" }, query: {} }, { sql: null }, fakeLogger
    )).toEqual({ code: 503, message: "SQL connection not available" });
  });
  it("400 when no rows", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect(await getLinkedinAdCountry(
      { body: { linkedin_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 400, message: "No data found." });
  });
  it("200 with capitalized + iso fixup", async () => {
    const db = { sql: { query: vi.fn(async () => [
      { country: "germany", iso: "DE" },
      { country: "Czechia", iso: null },
      { country: "Russia", iso: "RU_OLD" },
      { country: "Congo", iso: "null" },
      { country: null, iso: null },
    ])}};
    const out = await getLinkedinAdCountry(
      { body: { linkedin_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0]).toEqual({ country: "Germany", iso: "DE" });
    expect(out.data[1].iso).toBe("CZ");
    expect(out.data[2].iso).toBe("RU");
    expect(out.data[3].iso).toBe("CD");
    expect(out.data[4].country).toBeNull();
  });
  it("500 on SQL throw", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("db"); }) } };
    expect((await getLinkedinAdCountry(
      { body: { linkedin_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(500);
  });
});

describe("services/linkedin/controllers/adInsightsController > getLinkedinOutgoings", () => {
  it("401 when linkedin_ad_id missing", async () => {
    expect(await getLinkedinOutgoings({ body: {}, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters: linkedin_ad_id is required" });
  });
  it("503 when db.sql missing", async () => {
    expect(await getLinkedinOutgoings(
      { body: { linkedin_ad_id: "1" }, query: {} }, { sql: null }, fakeLogger
    )).toEqual({ code: 503, message: "SQL connection not available" });
  });
  it("200 with rows", async () => {
    const db = { sql: { query: vi.fn(async () => [{ source_url: "a", redirect_url: "b", final_url: "c" }]) } };
    expect(await getLinkedinOutgoings(
      { body: { linkedin_ad_id: "1" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 200, data: [{ source_url: "a", redirect_url: "b", final_url: "c" }], message: "Urls found" });
  });
  it("400 when no rows", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect(await getLinkedinOutgoings(
      { body: { linkedin_ad_id: "1" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 400, data: null, message: "No urls found" });
  });
  it("401/[] on SQL throw", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("fail"); }) } };
    expect(await getLinkedinOutgoings(
      { body: { linkedin_ad_id: "1" }, query: {} }, db, fakeLogger
    )).toEqual({ code: 401, data: [] });
  });
});

describe("services/linkedin/controllers/adInsightsController > getAdvertiserLCSData", () => {
  it("401 when linkedin_ad_id missing", async () => {
    expect(await getAdvertiserLCSData({ body: {}, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing linkedin_ad_id", data: null });
  });
  it("400 when no postOwnerName", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect((await getAdvertiserLCSData(
      { body: { linkedin_ad_id: "1" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("400 when elastic missing", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B", post_owner_id: 5 }]) },
      elastic: null,
    };
    expect((await getAdvertiserLCSData(
      { body: { linkedin_ad_id: "1" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("400 when ES returns 0 hits", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B", post_owner_id: 5 }]) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [] } })) },
    };
    expect((await getAdvertiserLCSData(
      { body: { linkedin_ad_id: "1" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("400 when all hits have no last_seen / adId", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B", post_owner_id: 5 }]) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [
        { _id: "a1", _source: { /* no last_seen */ } },
        { _source: { last_seen: 1700000000 } /* no _id */ },
        { _id: "a2", _source: { last_seen: "garbage" } },
      ]}}))},
    };
    expect((await getAdvertiserLCSData(
      { body: { linkedin_ad_id: "1" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("200 with monthly buckets aggregated + analyticsMap", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B", post_owner_id: 5 }];
        return [
          { linkedin_ad_id: "a1", total_likes: 100, total_comments: 20, total_followers: 5 },
          { linkedin_ad_id: "a2", total_likes: 50, total_comments: 10, total_followers: 2 },
        ];
      })},
      elastic: { search: vi.fn(async () => ({ hits: { hits: [
        // Use epoch_second > 1e9 to trigger timestamp branch
        { _id: "a1", _source: { last_seen: 1706745600 } }, // 2024-02-01
        { _id: "a2", _source: { last_seen: 1706832000 } }, // 2024-02-02
      ]}}))},
    };
    const out = await getAdvertiserLCSData(
      { body: { linkedin_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data.feb_2024).toEqual({
      ad_ids: ["a1", "a2"], total_ads: 2, likes: 150, comments: 30, followers: 7,
    });
  });
  it("multi-month + multi-year sortedKeys comparator (lines 370-373)", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B", post_owner_id: 5 }];
        return [];
      })},
      elastic: { search: vi.fn(async () => ({ hits: { hits: [
        { _id: "a1", _source: { last_seen: "2024-03-01T00:00:00Z" } },
        { _id: "a2", _source: { last_seen: "2023-12-01T00:00:00Z" } },
        { _id: "a3", _source: { last_seen: "2024-01-15T00:00:00Z" } },
      ]}}))},
    };
    const out = await getAdvertiserLCSData(
      { body: { linkedin_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(Object.keys(out.data)).toEqual(["dec_2023", "jan_2024", "mar_2024"]);
  });
  it("body.hits fallback + ISO-string date path", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B", post_owner_id: 5 }];
        return [];
      })},
      elastic: { search: vi.fn(async () => ({ body: { hits: { hits: [
        { _id: "a1", _source: { last_seen: "2024-03-01T00:00:00Z" } },
      ]}}}))},
    };
    const out = await getAdvertiserLCSData(
      { body: { linkedin_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data.mar_2024).toBeDefined();
  });
  it("ad without analytics → zero totals", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B", post_owner_id: 5 }];
        return [];
      })},
      elastic: { search: vi.fn(async () => ({ hits: { hits: [
        { _id: "a1", _source: { last_seen: 1706745600 } },
      ]}}))},
    };
    const out = await getAdvertiserLCSData(
      { body: { linkedin_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data.feb_2024.likes).toBe(0);
  });
  it("analyticsRows null → empty analyticsMap", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B", post_owner_id: 5 }];
        return null;
      })},
      elastic: { search: vi.fn(async () => ({ hits: { hits: [
        { _id: "a1", _source: { last_seen: 1706745600 } },
      ]}}))},
    };
    const out = await getAdvertiserLCSData(
      { body: { linkedin_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data.feb_2024.likes).toBe(0);
  });
  it("falsy analytics numbers coerced to 0", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B", post_owner_id: 5 }];
        return [{ linkedin_ad_id: "a1", total_likes: null, total_comments: null, total_followers: null }];
      })},
      elastic: { search: vi.fn(async () => ({ hits: { hits: [
        { _id: "a1", _source: { last_seen: 1706745600 } },
      ]}}))},
    };
    const out = await getAdvertiserLCSData(
      { body: { linkedin_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data.feb_2024.likes).toBe(0);
  });
});

describe("services/linkedin/controllers/adInsightsController > getAdvertiserCountryData", () => {
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
  it("401 when linkedin_ad_id missing", async () => {
    expect((await getAdvertiserCountryData({ body: {}, query: {} }, {}, fakeLogger)).code).toBe(401);
  });
  it("400 when no postOwnerName", async () => {
    const db = mkDb({});
    expect((await getAdvertiserCountryData(
      { body: { linkedin_ad_id: "1" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("400 when elastic missing", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B", post_owner_id: 5 }]) },
      elastic: null,
    };
    expect((await getAdvertiserCountryData(
      { body: { linkedin_ad_id: "1" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("year override + Date instance + unix timestamp + ISO string + invalid → current-year fallback", async () => {
    // year override
    let db = mkDb({ metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: new Date("2024-06-01") }, esHits: [] });
    expect((await getAdvertiserCountryData(
      { body: { linkedin_ad_id: "1", year: 2020 }, query: {} }, db, fakeLogger
    )).year).toBe(2020);

    // Date instance
    db = mkDb({ metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: new Date("2023-06-01") }, esHits: [] });
    expect((await getAdvertiserCountryData(
      { body: { linkedin_ad_id: "1" }, query: {} }, db, fakeLogger
    )).year).toBe(2023);

    // unix timestamp
    db = mkDb({ metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: 1706745600 /* 2024-02-01 */ }, esHits: [] });
    expect((await getAdvertiserCountryData(
      { body: { linkedin_ad_id: "1" }, query: {} }, db, fakeLogger
    )).year).toBe(2024);

    // ISO string
    db = mkDb({ metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2022-06-01" }, esHits: [] });
    expect((await getAdvertiserCountryData(
      { body: { linkedin_ad_id: "1" }, query: {} }, db, fakeLogger
    )).year).toBe(2022);

    // invalid
    db = mkDb({ metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "garbage" }, esHits: [] });
    expect((await getAdvertiserCountryData(
      { body: { linkedin_ad_id: "1" }, query: {} }, db, fakeLogger
    )).year).toBe(new Date().getFullYear());

    // null
    db = mkDb({ metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: null }, esHits: [] });
    expect((await getAdvertiserCountryData(
      { body: { linkedin_ad_id: "1" }, query: {} }, db, fakeLogger
    )).year).toBe(new Date().getFullYear());
  });
  it("200 'No data found for this year.' when ES empty", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-06-01" },
      esHits: [],
      availableYearBuckets: [{ key_as_string: "2024" }, { key_as_string: "1969" }],
    });
    const out = await getAdvertiserCountryData(
      { body: { linkedin_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.message).toBe("No data found for this year.");
    expect(out.available_years).toEqual([2024]);
  });
  it("available_years sorted descending (line 209 comparator)", async () => {
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
      { body: { linkedin_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.available_years).toEqual([2024, 2022, 2021]);
  });
  it("200 with aggregated country data (uses _id for adId)", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [
        { _id: "a1", _source: { countries: ["germany"] } },
        { _id: "a2", _source: { countries: ["germany", "france"] } },
      ],
      countryRows: [{ nicename: "germany", country: "Germany", iso: "DE" }],
    });
    const out = await getAdvertiserCountryData(
      { body: { linkedin_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBe("Germany");
    expect(out.data[0].ad_count).toBe(2);
  });
  it("non-array countries normalized; falsy entries dropped", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [
        { _id: "a1", _source: { countries: "japan" } },
        { _id: "a2", _source: { countries: [null, "", "spain"] } },
      ],
    });
    const out = await getAdvertiserCountryData(
      { body: { linkedin_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    const names = out.data.map(d => d.country);
    expect(names).toEqual(expect.arrayContaining(["Japan", "Spain"]));
  });
  it("hit fallback to post_owner_id when _id missing", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [{ _source: { post_owner_id: 7, countries: ["italy"] } }],
    });
    const out = await getAdvertiserCountryData(
      { body: { linkedin_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBe("Italy");
  });
  it("hits without country / id are skipped", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [
        { _id: "a1", _source: { /* no countries */ } },
        { _source: { /* no id, no post_owner_id */ countries: ["x"] } },
      ],
    });
    const out = await getAdvertiserCountryData(
      { body: { linkedin_ad_id: "1" }, query: {} }, db, fakeLogger
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
        { _id: "a1", _source: { countries: ["france"] } },
      ]}}))},
    };
    const out = await getAdvertiserCountryData(
      { body: { linkedin_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBe("France");
    expect(out.data[0].iso).toBeNull();
  });
  it("ES rejection → empty hits → 'No data found'", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }]) },
      elastic: { search: vi.fn(async () => { throw new Error("es-down"); }) },
    };
    expect((await getAdvertiserCountryData(
      { body: { linkedin_ad_id: "1" }, query: {} }, db, fakeLogger
    )).message).toBe("No data found for this year.");
  });
  it("ES returns body.hits shape → fallback fires (line 455 right operand)", async () => {
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
          // LinkedIn aggregateCountryData uses hit._id + hit._source.countries;
          // wrap inside body.hits to flush the line-455 right operand.
          return { body: { hits: { hits: [
            { _id: "1", _source: { countries: ["germany"] } },
          ]}}};
        }),
      },
    };
    const out = await getAdvertiserCountryData(
      { body: { linkedin_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
  });
});

describe("services/linkedin/controllers/adInsightsController > getAdvertiserInsightsByDateRange", () => {
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
  it("country type: 200 with aggregated data", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B" }];
        return [];
      })},
      elastic: { search: vi.fn(async () => ({ hits: { hits: [
        { _id: "a1", _source: { countries: ["germany"] } }
      ]}}))},
    };
    const out = await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "country" }, query: {} },
      db, fakeLogger
    );
    expect(out.data[0].country).toBe("Germany");
  });
  it("country: body.hits fallback", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B" }];
        return [];
      })},
      elastic: { search: vi.fn(async () => ({ body: { hits: { hits: [
        { _id: "a1", _source: { countries: ["japan"] } }
      ]}}}))},
    };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31" }, query: {} },
      db, fakeLogger
    )).data[0].country).toBe("Japan");
  });
  it("country: aggregateCountryData null → data:[]", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B" }];
        return [];
      })},
      elastic: { search: vi.fn(async () => ({ hits: { hits: [
        { _id: "a1", _source: { /* no countries */ } }
      ]}}))},
    };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31" }, query: {} },
      db, fakeLogger
    )).data).toEqual([]);
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
});
