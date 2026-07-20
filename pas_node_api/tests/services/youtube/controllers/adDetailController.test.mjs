import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const paramsPath = require.resolve("../../../../src/services/youtube/helpers/paramParser");
const normalizeParams = vi.fn((raw) => raw);
const cleanAdsData = vi.fn((ads = []) => ads);
require.cache[paramsPath] = {
  id: paramsPath, filename: paramsPath, loaded: true,
  exports: { normalizeParams, cleanAdsData },
};

const langPath = require.resolve("../../../../src/utils/languageMap");
const getLanguageMap = vi.fn(async () => ({ en: "English", es: "Spanish" }));
const resolveLanguageName = vi.fn((map, iso) => map[iso] || "Unknown");
require.cache[langPath] = {
  id: langPath, filename: langPath, loaded: true,
  exports: { getLanguageMap, resolveLanguageName },
};

const { getAdDetails } = require(
  "../../../../src/services/youtube/controllers/adDetailController"
);

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
beforeEach(() => {
  fakeLogger.warn.mockClear();
  fakeLogger.error.mockClear();
  normalizeParams.mockClear().mockImplementation((raw) => raw);
  getLanguageMap.mockClear();
  resolveLanguageName.mockClear();
});

describe("services/youtube/controllers/adDetailController > validation", () => {
  it("401 when ad_id missing", async () => {
    const out = await getAdDetails({ body: {}, query: {} }, {}, fakeLogger);
    expect(out).toEqual({ code: 401, message: "Missing parameters: ad_id is required" });
  });

  it("503 when db.sql missing", async () => {
    const out = await getAdDetails(
      { body: { ad_id: "1" }, query: {} }, { sql: null }, fakeLogger
    );
    expect(out).toEqual({ code: 503, message: "SQL database connection not available" });
  });

  it("merges req.body and req.query for normalize input", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    await getAdDetails(
      { body: { ad_id: "1" }, query: { language: "es" } }, db, fakeLogger
    );
    expect(normalizeParams).toHaveBeenCalledWith({ ad_id: "1", language: "es" });
  });
});

describe("services/youtube/controllers/adDetailController > SQL paths", () => {
  it("404 when no rows", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect(await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger))
      .toEqual({ code: 404, message: "Ad not found", data: null });
  });

  it("404 when query returns null", async () => {
    const db = { sql: { query: vi.fn(async () => null) } };
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).code).toBe(404);
  });

  it("500 + logger.error on SQL throw", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("db-down"); }) } };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(500);
    expect(out.error).toBe("db-down");
    expect(fakeLogger.error).toHaveBeenCalled();
  });

  it("200 SQL-only happy path: ad_status=Active when last_seen recent", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ id: 1, last_seen: new Date().toISOString() }]) },
    };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data[0].ad_status).toBe("Active");
  });

  it("ad_status=Inactive when last_seen > 15 days ago", async () => {
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const db = { sql: { query: vi.fn(async () => [{ id: 1, last_seen: old }]) } };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.data[0].ad_status).toBe("Inactive");
  });

  it("ad_status=Inactive when last_seen falsy", async () => {
    const db = { sql: { query: vi.fn(async () => [{ id: 1, last_seen: null }]) } };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.data[0].ad_status).toBe("Inactive");
  });
});

describe("services/youtube/controllers/adDetailController > ES overlay", () => {
  function makeDb(adRow, esHits, opts = {}) {
    let call = 0;
    return {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [adRow];
        return opts.countryRows || [];
      })},
      elastic: {
        indexName: "youtube_ads",
        search: vi.fn(async () => esHits),
      },
    };
  }

  it("applies full ES overlay (all branches active)", async () => {
    const adRow = { id: 1, last_seen: new Date().toISOString(), category: "old_cat" };
    const hits = { hits: { hits: [{ _source: {
      "youtube_translations.es": "Hola",
      image_brand: "brand",
      image_object: "obj",
      image_celebrity: "celeb",
      image_ocr: "ocr",
      source: "yt-src",
      new_nas_image_url: "https://nas.x/v.mp4",
      domain_registration_date: "2020-01-01",
      duration: 100,
      "youtube.category": "new_cat",
      "youtube.subCategory": "sub",
      funnel: "fnl",
      landing_urls: ["u1"],
      landing_text: "txt",
      "youtube.averageBudget": 10,
      "youtube.lowerBudget": 5,
      "youtube.upperBudget": 15,
      text_image_title: "title",
      ad_language: "es",
      redirect_urls: ["r1"],
    }}]}};
    const db = makeDb(adRow, hits);
    const out = await getAdDetails(
      { body: { ad_id: "1", language: "es" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0]["youtube_translations.es"]).toBe("Hola");
    expect(out.data[0].imageBrand).toBe("brand");
    expect(out.data[0].imageObject).toBe("obj");
    expect(out.data[0].imageCeleb).toBe("celeb");
    expect(out.data[0].imageOcr).toBe("ocr");
    expect(out.data[0].source).toBe("yt-src");
    expect(out.data[0].image_video_url).toBe("https://nas.x/v.mp4");
    expect(out.data[0].domain_registered_date).toBe("2020-01-01");
    expect(out.data[0].days_running).toBe(100);
    expect(out.data[0].category).toBe("new_cat");
    expect(out.data[0].subCategory).toBe("sub");
    expect(out.data[0].built_with_analytics_tracking).toBe("fnl");
    expect(out.data[0].landing_urls).toEqual(["u1"]);
    expect(out.data[0].landing_text).toBe("txt");
    expect(out.data[0].averageBudget).toBe(10);
    expect(out.data[0].ad_lowerBudget).toBe(5);
    expect(out.data[0].ad_upperBudget).toBe(15);
    expect(out.data[0].text_image_title).toBe("title");
    expect(out.data[0].language).toBe("Spanish");
    expect(out.data[0].market_platform_urls.redirect_urls).toEqual(["r1"]);
  });

  it("ES uses body.hits fallback when hits absent", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ id: 1, last_seen: null }]) },
      elastic: {
        indexName: "youtube_ads",
        search: vi.fn(async () => ({ body: { hits: { hits: [{ _source: { source: "yt" } }] } } })),
      },
    };
    const out = await getAdDetails(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].source).toBe("yt");
  });

  it("ES with 0 hits leaves adData unchanged", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ id: 1, last_seen: null }]) },
      elastic: { indexName: "youtube_ads", search: vi.fn(async () => ({ hits: { hits: [] } })) },
    };
    const out = await getAdDetails(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data[0].imageBrand).toBeUndefined();
  });

  it("ES throws → logger.warn, returns SQL-only response", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ id: 1, last_seen: null }]) },
      elastic: { indexName: "youtube_ads", search: vi.fn(async () => { throw new Error("es-down"); }) },
    };
    const out = await getAdDetails(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(fakeLogger.warn).toHaveBeenCalledWith(
      "ES overlay failed, continuing with SQL data only",
      { error: "es-down" }
    );
  });

  it("language='en' → no translations applied", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ id: 1, last_seen: null }]) },
      elastic: { indexName: "youtube_ads", search: vi.fn(async () => ({
        hits: { hits: [{ _source: { "youtube_translations.en": "ignored" } }] },
      }))},
    };
    const out = await getAdDetails(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0]["youtube_translations.en"]).toBeUndefined();
  });

  it("language requested but translation key missing → branch skipped", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ id: 1, last_seen: null }]) },
      elastic: { indexName: "youtube_ads", search: vi.fn(async () => ({
        hits: { hits: [{ _source: {} }] },
      }))},
    };
    const out = await getAdDetails(
      { body: { ad_id: "1", language: "fr" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0]["youtube_translations.fr"]).toBeUndefined();
  });

  it("partial budget (missing one of 3 keys) → averageBudget=null", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ id: 1, last_seen: null }]) },
      elastic: { indexName: "youtube_ads", search: vi.fn(async () => ({
        hits: { hits: [{ _source: { "youtube.averageBudget": 10 /* missing lower+upper */ } }] },
      }))},
    };
    const out = await getAdDetails(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].averageBudget).toBeNull();
  });

  it("ES src without ad_language → resolveLanguageName not called", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ id: 1, last_seen: null }]) },
      elastic: { indexName: "youtube_ads", search: vi.fn(async () => ({
        hits: { hits: [{ _source: {} }] },
      }))},
    };
    await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(getLanguageMap).not.toHaveBeenCalled();
  });

  // Language must be ES-only — must agree with the language FILTER, which only
  // ever matches ES `ad_language`. The stale `youtube_ad.language_id` join
  // (aliased `db_language` in AD_DETAIL_SQL) and ES's non-filterable
  // `localization_en.language_name` must never leak through as `language`.
  it("language: SQL db_language present but ES ad_language absent → null, not the SQL value", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ id: 1, last_seen: null, db_language: "English" }]) },
      elastic: { indexName: "youtube_ads", search: vi.fn(async () => ({
        hits: { hits: [{ _source: {} }] },
      }))},
    };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.data[0].language).toBeNull();
  });

  it("language: localization_en.language_name present but ES ad_language absent → still null", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ id: 1, last_seen: null, db_language: "English" }]) },
      elastic: { indexName: "youtube_ads", search: vi.fn(async () => ({
        hits: { hits: [{ _source: { localization_en: { language_name: "German" } } }] },
      }))},
    };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.data[0].language).toBeNull();
  });

  it("language: no ES hit at all (db unreachable path) → null, not the SQL db_language value", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ id: 1, last_seen: null, db_language: "English" }]) },
      elastic: null,
    };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.data[0].language).toBeNull();
  });

  it("category fallback: ES youtube.category missing but SQL had category", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ id: 1, category: "sql_cat", last_seen: null }]) },
      elastic: { indexName: "youtube_ads", search: vi.fn(async () => ({
        hits: { hits: [{ _source: {} }] },
      }))},
    };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.data[0].category).toBe("sql_cat");
  });

  it("category null fallback when both ES and SQL absent", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ id: 1, last_seen: null }]) },
      elastic: { indexName: "youtube_ads", search: vi.fn(async () => ({
        hits: { hits: [{ _source: {} }] },
      }))},
    };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.data[0].category).toBeNull();
  });
});

describe("services/youtube/controllers/adDetailController > country resolution", () => {
  function mkDbCC(countryCode, countryRows = []) {
    let call = 0;
    return {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [{ id: 1, country_code: countryCode, last_seen: null }];
        return countryRows;
      })},
    };
  }

  it("resolves single country code with single-pipe separator", async () => {
    const db = mkDbCC("US", [{ iso: "US", name: "United States" }]);
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.country).toEqual(["United States"]);
  });

  it("resolves multiple country codes with double-pipe separator and dedupes", async () => {
    const db = mkDbCC("US||IN||US", [
      { iso: "US", name: "United States" },
      { iso: "IN", name: "India" },
    ]);
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.country).toEqual(["United States", "India"]);
  });

  it("country lookup throw is silently swallowed", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ id: 1, country_code: "US", last_seen: null }];
      throw new Error("country-fail");
    })}};
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.country).toEqual([]);
  });

  it("country query returns null → empty array", async () => {
    const db = mkDbCC("US", null);
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.country).toEqual([]);
  });

  it("country rows with no name skipped + dedup of duplicate names", async () => {
    const db = mkDbCC("US||CA", [
      { iso: "US", name: "United States" },
      { iso: "CA" /* no name */ },
      { iso: "DUP", name: "United States" }, // duplicate name
    ]);
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.country).toEqual(["United States"]);
  });

  it("no country_code on ad → country=[]", async () => {
    const db = { sql: { query: vi.fn(async () => [{ id: 1, last_seen: null }]) } };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.country).toEqual([]);
  });

  it("empty entries from split are filtered out", async () => {
    const db = mkDbCC("||US||", [{ iso: "US", name: "United States" }]);
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.country).toEqual(["United States"]);
  });

  it("country_code with only-empty pipes → uniqueCodes empty → skip query", async () => {
    let queryCount = 0;
    const db = { sql: { query: vi.fn(async () => {
      queryCount++;
      if (queryCount === 1) return [{ id: 1, country_code: "||||", last_seen: null }];
      return [];
    })}};
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.country).toEqual([]);
    expect(queryCount).toBe(1); // country query was skipped
  });
});
