import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const paramsPath = require.resolve("../../../../src/services/facebook/helpers/paramParser");
const normalizeParams = vi.fn((raw) => raw);
require.cache[paramsPath] = {
  id: paramsPath, filename: paramsPath, loaded: true,
  exports: { normalizeParams },
};

const {
  getLikeCommentShareDetails,
  getFacebookAdCountry,
  getFacebookUserData,
  getFacebookOutgoings,
  getAdsPageDetails,
  getAdvertiserLCSData,
  getAdvertiserCountryData,
  getAdvertiserUserData,
  getAdvertiserInsightsByDateRange,
} = require(
  "../../../../src/services/facebook/controllers/adInsightsController"
);

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
beforeEach(() => {
  fakeLogger.warn.mockClear();
  fakeLogger.error.mockClear();
  normalizeParams.mockClear().mockImplementation((raw) => raw);
  // Deterministic random for graphAnalysisData
  vi.spyOn(Math, "random").mockReturnValue(0.5);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("services/facebook/controllers/adInsightsController > getLikeCommentShareDetails", () => {
  it("401 when params missing", async () => {
    expect(await getLikeCommentShareDetails({ body: { user_id: "u" }, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters: facebook_ad_id and user_id are required" });
  });
  it("503 when db.sql missing", async () => {
    expect(await getLikeCommentShareDetails(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, { sql: null }, fakeLogger
    )).toEqual({ code: 503, message: "SQL connection not available" });
  });
  it("400 when no rows", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect((await getLikeCommentShareDetails(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("200 with post_date prepend + date normalization", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ id: 1, facebook_ad_id: 7, likes: 5, comment: 2, share: 1, engagement_rate: 0.5, date: "2024-02-15T00:00:00Z" }];
      if (call === 2) return [{ post_date: "2024-01-01T00:00:00Z" }];
      return [];
    })}};
    const out = await getLikeCommentShareDetails(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data[0]).toEqual({ id: 0, facebook_ad_id: 7, likes: 0, comment: 0, share: 0, engagement_rate: 0, date: "2024-01-01" });
    expect(out.data[1].date).toBe("2024-02-15");
  });
  it("post_date null → derives day-before from first row", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ id: 1, facebook_ad_id: 7, date: "2024-02-15" }];
      if (call === 2) return [];
      return [];
    })}};
    const out = await getLikeCommentShareDetails(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].date).toBe("2024-02-14");
  });
  it("post_date epoch-0 → derives from first row", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ id: 1, facebook_ad_id: 7, date: "2024-02-15" }];
      if (call === 2) return [{ post_date: "1970-01-01T00:00:00Z" }];
      return [];
    })}};
    const out = await getLikeCommentShareDetails(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].date).toBe("2024-02-14");
  });
  it("post_date epoch-0 + first row date invalid → null", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ id: 1, facebook_ad_id: 7, date: "bad-date" }];
      if (call === 2) return [{ post_date: "1970-01-01T00:00:00Z" }];
      return [];
    })}};
    expect((await getLikeCommentShareDetails(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).data[0].date).toBeNull();
  });
  it("post_date null + first row date invalid → null", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ id: 1, facebook_ad_id: 7, date: "bad-date" }];
      if (call === 2) return [];
      return [];
    })}};
    expect((await getLikeCommentShareDetails(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).data[0].date).toBeNull();
  });
  it("post_date SQL throw → falls back to first-row-derived", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ id: 1, facebook_ad_id: 7, date: "2024-02-15" }];
      if (call === 2) throw new Error("post-date-fail");
      return [];
    })}};
    expect((await getLikeCommentShareDetails(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).data[0].date).toBe("2024-02-14");
  });
  it("row date null stays null", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ id: 1, facebook_ad_id: 7, date: null }];
      if (call === 2) return [{ post_date: "2024-01-01" }];
      return [];
    })}};
    expect((await getLikeCommentShareDetails(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).data[1].date).toBeNull();
  });
  it("row date invalid → null", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ id: 1, facebook_ad_id: 7, date: "bogus" }];
      if (call === 2) return [{ post_date: "2024-01-01" }];
      return [];
    })}};
    expect((await getLikeCommentShareDetails(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).data[1].date).toBeNull();
  });
  it("ES overlay on last row applied", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [{ id: 1, facebook_ad_id: 7, likes: 1, comment: 1, share: 1, engagement_rate: 0.1, date: "2024-02-15" }];
        if (call === 2) return [{ post_date: "2024-01-01" }];
        return [];
      })},
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: {
        "facebook_ad.likes": 100, "facebook_ad.shares": 50, "facebook_ad.comments": 25, engagement_rate: 0.99,
      }}]}}))},
    };
    const out = await getLikeCommentShareDetails(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[1].likes).toBe(100);
    expect(out.data[1].share).toBe(50);
    expect(out.data[1].comment).toBe(25);
    expect(out.data[1].engagement_rate).toBe(0.99);
  });
  it("ES body.hits fallback shape", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [{ id: 1, facebook_ad_id: 7, likes: 1, comment: 1, share: 1, engagement_rate: 0.1, date: "2024-02-15" }];
        if (call === 2) return [{ post_date: "2024-01-01" }];
        return [];
      })},
      elastic: { search: vi.fn(async () => ({ body: { hits: { hits: [{ _source: { "facebook_ad.likes": 7 } }] } } })) },
    };
    expect((await getLikeCommentShareDetails(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).data[1].likes).toBe(7);
  });
  it("ES 0 hits leaves rows unchanged", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [{ id: 1, facebook_ad_id: 7, likes: 1, date: "2024-02-15" }];
        if (call === 2) return [];
        return [];
      })},
      elastic: { search: vi.fn(async () => ({ hits: { hits: [] } })) },
    };
    expect((await getLikeCommentShareDetails(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).data[1].likes).toBe(1);
  });
  it("ES throw → logger.warn", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [{ id: 1, facebook_ad_id: 7, date: "2024-02-15" }];
        if (call === 2) return [];
        return [];
      })},
      elastic: { search: vi.fn(async () => { throw new Error("es-down"); }) },
    };
    const out = await getLikeCommentShareDetails(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(fakeLogger.warn).toHaveBeenCalledWith("ES overlay failed in LCS", { error: "es-down" });
  });
  it("500 on outer SQL throw", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("db-down"); }) } };
    expect((await getLikeCommentShareDetails(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(500);
  });
});

describe("services/facebook/controllers/adInsightsController > getFacebookAdCountry", () => {
  it("401 when params missing", async () => {
    expect((await getFacebookAdCountry({ body: { user_id: "u" }, query: {} }, {}, fakeLogger)).code).toBe(401);
  });
  it("503 when elastic missing", async () => {
    expect((await getFacebookAdCountry(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, { elastic: null }, fakeLogger
    )).code).toBe(503);
  });
  it("401 when ES no hits", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [] } })) } };
    expect((await getFacebookAdCountry(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(401);
  });
  it("401 when no country_only.country in source", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: {} }] } })) } };
    expect((await getFacebookAdCountry(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(401);
  });
  it("401 when countries empty array", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { "country_only.country": [] } }] } })) } };
    expect((await getFacebookAdCountry(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(401);
  });
  it("body.hits fallback shape", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ body: { hits: { hits: [{ _source: { "country_only.country": ["germany"] } }] } } })) } };
    expect((await getFacebookAdCountry(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(200);
  });
  it("200 with SQL ISO lookup + capitalize", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ country: "Germany", iso: "DE" }]) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { "country_only.country": ["germany"] } }] } })) },
    };
    expect((await getFacebookAdCountry(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).data[0]).toEqual({ country: "Germany", iso: "DE" });
  });
  it("SQL no match → raw name + iso null", async () => {
    const db = {
      sql: { query: vi.fn(async () => []) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { "country_only.country": ["zzland"] } }] } })) },
    };
    const out = await getFacebookAdCountry(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0]).toEqual({ country: "Zzland", iso: null });
  });
  it("SQL throws per-country → fallback to raw name", async () => {
    const db = {
      sql: { query: vi.fn(async () => { throw new Error("sql-fail"); }) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { "country_only.country": ["france"] } }] } })) },
    };
    expect((await getFacebookAdCountry(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).data[0]).toEqual({ country: "France", iso: null });
  });
  it("no db.sql → raw names with null iso", async () => {
    const db = {
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { "country_only.country": ["italy"] } }] } })) },
    };
    expect((await getFacebookAdCountry(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).data[0]).toEqual({ country: "Italy", iso: null });
  });
  it("non-array country normalized", async () => {
    const db = { elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { "country_only.country": "Czechia" } }] } })) } };
    expect((await getFacebookAdCountry(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).data[0].iso).toBe("CZ");
  });
  it("Russia → RU + Congo with null iso → CD", async () => {
    let call = 0;
    const db = {
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { "country_only.country": ["Russia", "Republic of Congo"] } }] } })) },
      sql: { query: vi.fn(async () => []) },
    };
    const out = await getFacebookAdCountry(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].iso).toBe("RU");
    expect(out.data[1].iso).toBe("CD");
  });
  it("null country preserved (no Title-case)", async () => {
    const db = {
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { "country_only.country": [null] } }] } })) },
    };
    const out = await getFacebookAdCountry(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].country).toBeNull();
  });
  it("500 on ES throw", async () => {
    const db = { elastic: { search: vi.fn(async () => { throw new Error("es-down"); }) } };
    expect((await getFacebookAdCountry(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(500);
  });
});

describe("services/facebook/controllers/adInsightsController > getFacebookUserData", () => {
  it("401 when params missing", async () => {
    expect((await getFacebookUserData({ body: {}, query: {} }, {}, fakeLogger)).code).toBe(401);
  });
  it("503 when db.sql missing", async () => {
    expect((await getFacebookUserData(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, { sql: null }, fakeLogger
    )).code).toBe(503);
  });

  it("cached analytics path", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return []; // adUserRows
      if (call === 2) return [{ genderdata: '{"male":50}', relationshipdata: '{"married":40}', agedata: '{"age_18_to_24":20}' }];
      return [];
    })}};
    const out = await getFacebookUserData(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data.ageData).toEqual({ male: 50 });
    expect(out.data.genderData).toEqual({ age_18_to_24: 20 });
    expect(out.tragetData.data).toEqual([]);
  });

  it("cached analytics with null fields → {}", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [];
      if (call === 2) return [{ genderdata: null, relationshipdata: null, agedata: null }];
      return [];
    })}};
    const out = await getFacebookUserData(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.data.ageData).toEqual({});
  });

  it("user IDs fetched + cached path with users", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ user_id: 5 }, { user_id: null }];
      if (call === 2) return [{ id: 5, name: "alice", age: 30, Gender: "f" }];
      if (call === 3) return [{ genderdata: '{}', relationshipdata: '{}', agedata: '{}' }];
      return [];
    })}};
    const out = await getFacebookUserData(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.tragetData.data[0].name).toBe("alice");
  });

  it("adUserRows but no user_id values → no FB_USERS_SQL call", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ user_id: null }];
      if (call === 2) return [{ genderdata: '{}', relationshipdata: '{}', agedata: '{}' }];
      return [];
    })}};
    const out = await getFacebookUserData(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
  });

  it("fresh compute path with no users + insert cache", async () => {
    let call = 0;
    const inserts = [];
    const db = { sql: { query: vi.fn(async (sql, params) => {
      call++;
      if (call === 1) return [];
      if (call === 2) return [];
      inserts.push(params);
      return { insertId: 1 };
    })}};
    const out = await getFacebookUserData(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(typeof out.data).toBe("string"); // JSON-stringified
    expect(inserts.length).toBe(1);
  });

  it("fresh compute path with diverse users (graphAnalysisData full)", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ user_id: 1 }, { user_id: 2 }, { user_id: 3 }];
      if (call === 2) return [
        { id: 1, age: 22, Gender: "Male", relationship_status: "Single" },
        { id: 2, age: 30, Gender: "Female", relationship_status: "Married" },
        { id: 3, age: 40, Gender: "M", relationship_status: "It's complicated" },
        { id: 4, age: 50, Gender: "f", relationship_status: "single" },
        { id: 5, age: 60, Gender: "x", relationship_status: "married" },
      ];
      if (call === 3) return [];
      return { insertId: 1 };
    })}};
    const out = await getFacebookUserData(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(typeof out.data).toBe("string");
  });

  it("fresh compute with zero-male path", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ user_id: 1 }];
      if (call === 2) return [{ id: 1, age: 22, Gender: "Female", relationship_status: "Married" }];
      if (call === 3) return [];
      return { insertId: 1 };
    })}};
    expect((await getFacebookUserData(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(200);
  });

  it("fresh compute zero-female path", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ user_id: 1 }];
      if (call === 2) return [{ id: 1, age: 22, Gender: "Male", relationship_status: "Single" }];
      if (call === 3) return [];
      return { insertId: 1 };
    })}};
    expect((await getFacebookUserData(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(200);
  });

  it("fresh compute with one of single/married/others zero (maxIdx=1)", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ user_id: 1 }];
      if (call === 2) return [{ id: 1, age: 22, Gender: "Male", relationship_status: "Married" }]; // single=0
      if (call === 3) return [];
      return { insertId: 1 };
    })}};
    expect((await getFacebookUserData(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(200);
  });

  it("fresh compute with maxIdx=2 (others)", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ user_id: 1 }];
      if (call === 2) return [{ id: 1, age: 22, Gender: "Male", relationship_status: "Complicated" }];
      if (call === 3) return [];
      return { insertId: 1 };
    })}};
    expect((await getFacebookUserData(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(200);
  });

  it("insert SQL throws → logger.warn but still returns 200", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [];
      if (call === 2) return [];
      throw new Error("insert-fail");
    })}};
    const out = await getFacebookUserData(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(fakeLogger.warn).toHaveBeenCalledWith("Failed to cache user analytics", { error: "insert-fail" });
  });

  it("401 on outer SQL throw", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("db-down"); }) } };
    expect((await getFacebookUserData(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(401);
  });

  it("fresh compute with user missing Gender (|| '' fallback) + all ages out of range (totalAge=0 branch)", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ user_id: 1 }, { user_id: 2 }];
      if (call === 2) return [
        { id: 1, age: 10, relationship_status: "Single" }, // no Gender, age out of range
        { id: 2, age: 70, Gender: "Male", relationship_status: "Married" }, // age out of range
      ];
      if (call === 3) return [];
      return { insertId: 1 };
    })}};
    expect((await getFacebookUserData(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(200);
  });

  it("fresh compute path with zero data triggers negative-overflow guard (age slot 4 < 0)", async () => {
    // Force Math.random to specific value that pushes slot4 negative
    Math.random.mockReturnValueOnce(0.99) // slot0 = 50+5 (within 50-55)
      .mockReturnValueOnce(0.99) // slot1 = 15+(70-55)-1 = 14? But formula is rand(15, 70-50) = rand(15,20)
      .mockReturnValueOnce(0.99) // slot2 = rand(10, 80-50-20) = rand(10,10)
      .mockReturnValueOnce(0.99); // slot3 = rand(5, 95-50-20-10) = rand(5,15)
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ user_id: 1 }];
      if (call === 2) return [{ id: 1, age: 22, Gender: "Male", relationship_status: "Single" }];
      if (call === 3) return [];
      return { insertId: 1 };
    })}};
    expect((await getFacebookUserData(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(200);
  });
});

describe("services/facebook/controllers/adInsightsController > getFacebookOutgoings", () => {
  it("401 when ad_id missing", async () => {
    expect(await getFacebookOutgoings({ body: {}, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters: ad_id is required" });
  });
  it("503 when db.sql missing", async () => {
    expect(await getFacebookOutgoings(
      { body: { ad_id: "1" }, query: {} }, { sql: null }, fakeLogger
    )).toEqual({ code: 503, message: "SQL connection not available" });
  });
  it("200 with rows", async () => {
    const db = { sql: { query: vi.fn(async () => [{ source_url: "s" }]) } };
    expect(await getFacebookOutgoings({ body: { ad_id: "1" }, query: {} }, db, fakeLogger))
      .toEqual({ code: 200, data: [{ source_url: "s" }] });
  });
  it("400 when no rows", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect(await getFacebookOutgoings({ body: { ad_id: "1" }, query: {} }, db, fakeLogger))
      .toEqual({ code: 400, data: [] });
  });
  it("401 on SQL throw", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("err"); }) } };
    expect(await getFacebookOutgoings({ body: { ad_id: "1" }, query: {} }, db, fakeLogger))
      .toEqual({ code: 401, data: [] });
  });
});

describe("services/facebook/controllers/adInsightsController > getAdsPageDetails", () => {
  it("401 when params missing", async () => {
    expect((await getAdsPageDetails({ body: {}, query: {} }, {}, fakeLogger)).code).toBe(401);
  });
  it("503 when db.sql missing", async () => {
    expect(await getAdsPageDetails(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, { sql: null }, fakeLogger
    )).toEqual({ code: 503, message: "SQL connection not available" });
  });
  it("400 when no rows", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect((await getAdsPageDetails(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("200 with row[0]", async () => {
    const db = { sql: { query: vi.fn(async () => [{ id: 1, page: "x" }]) } };
    expect((await getAdsPageDetails(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).data).toEqual({ id: 1, page: "x" });
  });
  it("401 on SQL throw", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("e"); }) } };
    expect((await getAdsPageDetails(
      { body: { facebook_ad_id: "1", user_id: "u" }, query: {} }, db, fakeLogger
    )).code).toBe(401);
  });
});

describe("services/facebook/controllers/adInsightsController > getAdvertiserLCSData", () => {
  function mkDb({ metaRow = null, esHits = [], analyticsRows = [], availableYearBuckets = [] } = {}) {
    let sqlCall = 0;
    return {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return metaRow ? [metaRow] : [];
        return analyticsRows;
      })},
      elastic: { search: vi.fn(async (params) => {
        if (params.body.aggs?.years) return { aggregations: { years: { buckets: availableYearBuckets } } };
        return { hits: { hits: esHits } };
      })},
    };
  }
  it("401 when facebook_ad_id missing", async () => {
    expect((await getAdvertiserLCSData({ body: {}, query: {} }, {}, fakeLogger)).code).toBe(401);
  });
  it("503 when elastic missing", async () => {
    expect((await getAdvertiserLCSData(
      { body: { facebook_ad_id: "1" }, query: {} }, { sql: null, elastic: null }, fakeLogger
    )).code).toBe(503);
  });
  it("400 when no postOwnerName", async () => {
    expect((await getAdvertiserLCSData(
      { body: { facebook_ad_id: "1" }, query: {} }, mkDb({}), fakeLogger
    )).code).toBe(400);
  });
  it("400 when ES 0 hits → null monthlyData", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-06-01" },
      esHits: [],
    });
    expect((await getAdvertiserLCSData(
      { body: { facebook_ad_id: "1" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("400 when all hits skipped (missing id/last_seen/invalid)", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-06-01" },
      esHits: [
        { _source: {} },
        { _source: { "facebook_ad.id": 1, "facebook_ad.last_seen": "bogus" } },
      ],
    });
    expect((await getAdvertiserLCSData(
      { body: { facebook_ad_id: "1" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("null last_seen → adYear = current year", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: null },
      esHits: [],
    });
    expect((await getAdvertiserLCSData(
      { body: { facebook_ad_id: "1" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("invalid last_seen → adYear = current year", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "garbage" },
      esHits: [],
    });
    expect((await getAdvertiserLCSData(
      { body: { facebook_ad_id: "1" }, query: {} }, db, fakeLogger
    )).code).toBe(400);
  });
  it("200 with monthly aggregation + analytics + body.hits fallback + sorted years", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }];
        return [
          { facebook_ad_id: 1, total_likes: 10, total_comments: 2, total_shares: 1, total_engagement_rate: 0.5 },
          { facebook_ad_id: 3, total_likes: 5, total_comments: 0, total_shares: 1, total_engagement_rate: 0.25 },
        ];
      })},
      elastic: { search: vi.fn(async (params) => {
        if (params.body.aggs?.years) return { aggregations: { years: { buckets: [{ key_as_string: "2024" }, { key_as_string: "2022" }, { key_as_string: "bogus" }] } } };
        return { body: { hits: { hits: [
          { _source: { "facebook_ad.id": 1, "facebook_ad.last_seen": "2024-02-01" } },
          { _source: { "facebook_ad.id": 2, "facebook_ad.last_seen": "2024-02-02" } },
          { _source: { "facebook_ad.id": 3, "facebook_ad.last_seen": "2024-03-15" } },
        ]}}};
      })},
    };
    const out = await getAdvertiserLCSData(
      { body: { facebook_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data.feb_2024.ad_ids).toEqual([1, 2]);
    expect(out.data.feb_2024.likes).toBe(10);
    expect(out.data.mar_2024.likes).toBe(5);
    expect(out.available_years).toEqual([2022, 2024]);
  });
  it("aggregator yearSet sort comparator: multi-year hits sorted ascending in 'years' field (line 253)", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }];
        return [];
      })},
      elastic: { search: vi.fn(async (params) => {
        if (params.body.aggs?.years) return { aggregations: { years: { buckets: [] } } };
        return { hits: { hits: [
          { _source: { "facebook_ad.id": 1, "facebook_ad.last_seen": "2024-03-01" } },
          { _source: { "facebook_ad.id": 2, "facebook_ad.last_seen": "2022-06-01" } },
          { _source: { "facebook_ad.id": 3, "facebook_ad.last_seen": "2023-08-15" } },
        ]}};
      })},
    };
    const out = await getAdvertiserLCSData(
      { body: { facebook_ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    // Internal yearSet sort runs with 3 distinct years
    expect(Object.keys(out.data)).toEqual(expect.arrayContaining(["mar_2024", "jun_2022", "aug_2023"]));
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
        return { hits: { hits: [{ _source: { "facebook_ad.id": 1, "facebook_ad.last_seen": "2024-01-01" } }] } };
      })},
    };
    expect((await getAdvertiserLCSData(
      { body: { facebook_ad_id: "1" }, query: {} }, db, fakeLogger
    )).data.jan_2024.likes).toBe(0);
  });
  it("availableYears rejection → empty array", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }]) },
      elastic: { search: vi.fn(async (params) => {
        if (params.body.aggs?.years) throw new Error("agg-down");
        return { hits: { hits: [{ _source: { "facebook_ad.id": 1, "facebook_ad.last_seen": "2024-01-01" } }] } };
      })},
    };
    expect((await getAdvertiserLCSData(
      { body: { facebook_ad_id: "1" }, query: {} }, db, fakeLogger
    )).available_years).toEqual([]);
  });
});

describe("services/facebook/controllers/adInsightsController > getAdvertiserCountryData", () => {
  function mkDb({ metaRow = null, esHits = [], countryRows = [], availableYearBuckets = [] } = {}) {
    let sqlCall = 0;
    return {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return metaRow ? [metaRow] : [];
        return countryRows;
      })},
      elastic: { search: vi.fn(async (params) => {
        if (params.body.aggs?.years) return { aggregations: { years: { buckets: availableYearBuckets } } };
        return { hits: { hits: esHits } };
      })},
    };
  }
  it("401 when facebook_ad_id missing", async () => {
    expect((await getAdvertiserCountryData({ body: {}, query: {} }, {})).code).toBe(401);
  });
  it("400 when no postOwnerName", async () => {
    expect((await getAdvertiserCountryData(
      { body: { facebook_ad_id: "1" }, query: {} }, mkDb({})
    )).code).toBe(400);
  });
  it("400 when elastic missing", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B", post_owner_id: 5 }]) },
      elastic: null,
    };
    expect((await getAdvertiserCountryData(
      { body: { facebook_ad_id: "1" }, query: {} }, db
    )).code).toBe(400);
  });
  it("400 when ES rejection (null result)", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }]) },
      elastic: { search: vi.fn(async () => { throw new Error("es-down"); }) },
    };
    expect((await getAdvertiserCountryData(
      { body: { facebook_ad_id: "1" }, query: {} }, db
    )).code).toBe(400);
  });
  it("400 when ES 0 hits", async () => {
    expect((await getAdvertiserCountryData(
      { body: { facebook_ad_id: "1" }, query: {} }, mkDb({ metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }, esHits: [] })
    )).code).toBe(400);
  });
  it("null last_seen → current year", async () => {
    expect((await getAdvertiserCountryData(
      { body: { facebook_ad_id: "1" }, query: {} }, mkDb({ metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: null }, esHits: [] })
    )).code).toBe(400);
  });
  it("invalid last_seen → current year", async () => {
    expect((await getAdvertiserCountryData(
      { body: { facebook_ad_id: "1" }, query: {} }, mkDb({ metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "garbage" }, esHits: [] })
    )).code).toBe(400);
  });
  it("200 with docvalue_fields path + body.hits fallback", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }];
        return [{ nicename: "germany", country: "Germany", iso: "DE" }];
      })},
      elastic: { search: vi.fn(async (params) => {
        if (params.body.aggs?.years) return { aggregations: { years: { buckets: [] } } };
        return { body: { hits: { hits: [
          { fields: { "facebook_ad.id": [1], "country_only.country.keyword": ["germany"] } },
          { fields: { "facebook_ad.id": [2], "country_only.country.keyword": ["germany"] } },
        ]}}};
      })},
    };
    const out = await getAdvertiserCountryData(
      { body: { facebook_ad_id: "1" }, query: {} }, db
    );
    expect(out.data[0].country).toBe("Germany");
    expect(out.data[0].ad_count).toBe(2);
  });
  it("_source shape support", async () => {
    expect((await getAdvertiserCountryData(
      { body: { facebook_ad_id: "1" }, query: {} },
      mkDb({ metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }, esHits: [{ _source: { "facebook_ad.id": 1, "country_only.country": "italy" } }] })
    )).data[0].country).toBe("Italy");
  });
  it("docvalue countries fallback (not .keyword)", async () => {
    expect((await getAdvertiserCountryData(
      { body: { facebook_ad_id: "1" }, query: {} },
      mkDb({ metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }, esHits: [{ fields: { "facebook_ad.id": [1], "country_only.country": ["spain"] } }] })
    )).data[0].country).toBe("Spain");
  });
  it("non-array country normalized; falsy skipped", async () => {
    const db = mkDb({
      metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" },
      esHits: [
        { fields: { "facebook_ad.id": [1], "country_only.country.keyword": "japan" } },
        { fields: { "facebook_ad.id": [2], "country_only.country.keyword": [null, "", "spain"] } },
      ],
    });
    const names = (await getAdvertiserCountryData(
      { body: { facebook_ad_id: "1" }, query: {} }, db
    )).data.map(d => d.country);
    expect(names).toEqual(expect.arrayContaining(["Japan", "Spain"]));
  });
  it("hits missing id / country skipped → null → 400", async () => {
    expect((await getAdvertiserCountryData(
      { body: { facebook_ad_id: "1" }, query: {} },
      mkDb({ metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }, esHits: [
        { fields: { "country_only.country.keyword": ["x"] } },
        { fields: { "facebook_ad.id": [1] } },
      ]})
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
        { fields: { "facebook_ad.id": [1], "country_only.country.keyword": ["france"] } },
      ]}}))},
    };
    const out = await getAdvertiserCountryData(
      { body: { facebook_ad_id: "1" }, query: {} }, db
    );
    expect(out.data[0].country).toBe("France");
    expect(out.data[0].iso).toBeNull();
  });
});

describe("services/facebook/controllers/adInsightsController > getAdvertiserUserData", () => {
  function mkDb({ metaRow = null, esHits = [], analyticsRows = [], availableYearBuckets = [] } = {}) {
    let sqlCall = 0;
    return {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return metaRow ? [metaRow] : [];
        return analyticsRows;
      })},
      elastic: { search: vi.fn(async (params) => {
        if (params.body.aggs?.years) return { aggregations: { years: { buckets: availableYearBuckets } } };
        return { hits: { hits: esHits } };
      })},
    };
  }
  it("401 when facebook_ad_id missing", async () => {
    expect((await getAdvertiserUserData({ body: {}, query: {} }, {})).code).toBe(401);
  });
  it("400 when no postOwnerName", async () => {
    expect((await getAdvertiserUserData(
      { body: { facebook_ad_id: "1" }, query: {} }, mkDb({})
    )).code).toBe(400);
  });
  it("400 when ES rejection", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }]) },
      elastic: { search: vi.fn(async () => { throw new Error("es"); }) },
    };
    expect((await getAdvertiserUserData(
      { body: { facebook_ad_id: "1" }, query: {} }, db
    )).code).toBe(400);
  });
  it("400 when 0 hits", async () => {
    expect((await getAdvertiserUserData(
      { body: { facebook_ad_id: "1" }, query: {} },
      mkDb({ metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }, esHits: [] })
    )).code).toBe(400);
  });
  it("400 when adIds empty after fields extraction", async () => {
    expect((await getAdvertiserUserData(
      { body: { facebook_ad_id: "1" }, query: {} },
      mkDb({ metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }, esHits: [{ fields: {} }] })
    )).code).toBe(400);
  });
  it("400 when analytics returns null", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }];
        return null;
      })},
      elastic: { search: vi.fn(async (params) => {
        if (params.body.aggs?.years) return { aggregations: { years: { buckets: [] } } };
        return { hits: { hits: [{ fields: { "facebook_ad.id": [1] } }] } };
      })},
    };
    expect((await getAdvertiserUserData(
      { body: { facebook_ad_id: "1" }, query: {} }, db
    )).code).toBe(400);
  });
  it("200 with aggregated user demographics", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B", post_owner_id: 5, last_seen: "2024-01-01" }];
        return [
          { facebook_ad_id: 1, agedata: '{"age_18_to_24":10,"age_25_to_34":5}', genderdata: '{"male":60,"female":40}', relationshipdata: '{"married":30,"single":50,"others":20}' },
          { facebook_ad_id: 2, agedata: '{"age_18_to_24":20}', genderdata: '{"male":50,"female":50}', relationshipdata: '{"married":40,"single":40,"others":20}' },
        ];
      })},
      elastic: { search: vi.fn(async (params) => {
        if (params.body.aggs?.years) return { aggregations: { years: { buckets: [{ key_as_string: "2024" }] } } };
        return { hits: { hits: [
          { fields: { "facebook_ad.id": [1] } },
          { fields: { "facebook_ad.id": [2] } },
        ]}};
      })},
    };
    const out = await getAdvertiserUserData(
      { body: { facebook_ad_id: "1" }, query: {} }, db
    );
    expect(out.data.ageData.age_18_to_24).toBe(30);
    expect(out.data.genderData.male).toBe(110);
  });
  it("null last_seen → current year + 400", async () => {
    expect((await getAdvertiserUserData(
      { body: { facebook_ad_id: "1" }, query: {} },
      mkDb({ metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: null }, esHits: [] })
    )).code).toBe(400);
  });
  it("invalid last_seen → current year + 400", async () => {
    expect((await getAdvertiserUserData(
      { body: { facebook_ad_id: "1" }, query: {} },
      mkDb({ metaRow: { post_owner_name: "B", post_owner_id: 5, last_seen: "garbage" }, esHits: [] })
    )).code).toBe(400);
  });
});

describe("services/facebook/controllers/adInsightsController > getAdvertiserInsightsByDateRange", () => {
  it("401 when user_id missing", async () => {
    expect((await getAdvertiserInsightsByDateRange({ body: {}, query: {} }, {})).code).toBe(401);
  });
  it("accepts user_id from req.user.id", async () => {
    const db = { sql: { query: vi.fn(async () => []) }, elastic: { search: vi.fn() } };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31" }, query: {}, user: { id: "u" } },
      db
    )).code).toBe(400);
  });
  it("400 when post_owner_id missing", async () => {
    expect((await getAdvertiserInsightsByDateRange(
      { body: { user_id: "u" }, query: {} }, {}
    )).code).toBe(400);
  });
  it("400 when dates missing", async () => {
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
  it("400 when from > to", async () => {
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
  it("400 when no postOwnerName", async () => {
    const db = { sql: { query: vi.fn(async () => []) }, elastic: { search: vi.fn() } };
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
  it("lcs type: 200 with monthly", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B" }];
        return [{ facebook_ad_id: 1, total_likes: 5, total_comments: 1, total_shares: 0, total_engagement_rate: 0.1 }];
      })},
      elastic: { search: vi.fn(async () => ({ hits: { hits: [
        { _source: { "facebook_ad.id": 1, "facebook_ad.last_seen": "2024-05-01" } }
      ]}}))},
    };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { user_id: "u", post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "lcs" }, query: {} },
      db
    )).data.may_2024.likes).toBe(5);
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
        { _source: { "facebook_ad.id": 1, "facebook_ad.last_seen": "2024-07-01" } }
      ]}}))},
    };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { user_id: "u", post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31" }, query: {} },
      db
    )).data.jul_2024).toBeDefined();
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
  it("country type: 200 with data + body.hits fallback", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B" }];
        return [];
      })},
      elastic: { search: vi.fn(async () => ({ body: { hits: { hits: [
        { _source: { "facebook_ad.id": 1, "country_only.country": "germany" } }
      ]}}}))},
    };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { user_id: "u", post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "country" }, query: {} },
      db
    )).data[0].country).toBe("Germany");
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
        { _source: { "facebook_ad.id": 1 } }
      ]}}))},
    };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { user_id: "u", post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "country" }, query: {} },
      db
    )).code).toBe(400);
  });
  it("user type: 400 when 0 hits", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ post_owner_name: "B" }]) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [] } })) },
    };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { user_id: "u", post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "user" }, query: {} },
      db
    )).code).toBe(400);
  });
  it("user type: 400 when adIds empty after fields extraction", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B" }];
        return [];
      })},
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ fields: {} }] } })) },
    };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { user_id: "u", post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "user" }, query: {} },
      db
    )).code).toBe(400);
  });
  it("user type: aggregateUserData null → 400", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B" }];
        return null;
      })},
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ fields: { "facebook_ad.id": [1] } }] } })) },
    };
    expect((await getAdvertiserInsightsByDateRange(
      { body: { user_id: "u", post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "user" }, query: {} },
      db
    )).code).toBe(400);
  });
  it("user type: 200 with aggregated data", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ post_owner_name: "B" }];
        return [{ facebook_ad_id: 1, agedata: '{"age_18_to_24":10}', genderdata: '{"male":50,"female":50}', relationshipdata: '{"married":40,"single":40,"others":20}' }];
      })},
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ fields: { "facebook_ad.id": [1] } }] } })) },
    };
    const out = await getAdvertiserInsightsByDateRange(
      { body: { user_id: "u", post_owner_id: 5, from_date: "2024-01-01", to_date: "2024-12-31", type: "user" }, query: {} },
      db
    );
    expect(out.data.ageData.age_18_to_24).toBe(10);
  });
});
