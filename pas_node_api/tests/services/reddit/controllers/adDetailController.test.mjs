import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Mock paramParser (normalize passes through)
const paramsPath = require.resolve("../../../../src/services/reddit/helpers/paramParser");
const normalizeParams = vi.fn((raw) => raw);
const cleanAdsData = vi.fn((ads = []) => ads);
require.cache[paramsPath] = {
  id: paramsPath, filename: paramsPath, loaded: true,
  exports: { normalizeParams, cleanAdsData },
};

// Mock languageMap
const langPath = require.resolve("../../../../src/utils/languageMap");
const getLanguageMap = vi.fn(async () => ({ en: "English", es: "Spanish" }));
const resolveLanguageName = vi.fn((map, iso) => map[iso] || "Unknown");
require.cache[langPath] = {
  id: langPath, filename: langPath, loaded: true,
  exports: { getLanguageMap, resolveLanguageName },
};

const { getAdDetails } = require(
  "../../../../src/services/reddit/controllers/adDetailController"
);

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
beforeEach(() => {
  fakeLogger.warn.mockClear();
  fakeLogger.error.mockClear();
  normalizeParams.mockClear().mockImplementation((raw) => raw);
  getLanguageMap.mockClear();
  resolveLanguageName.mockClear();
});

function mkDb({ sqlImpl = null, elastic = null } = {}) {
  return {
    sql: sqlImpl ? { query: vi.fn(sqlImpl) } : null,
    elastic,
  };
}

describe("services/reddit/controllers/adDetailController > getAdDetails — validation", () => {
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

  it("merges req.body and req.query into normalize", async () => {
    const out = await getAdDetails(
      { body: { ad_id: "1" }, query: { language: "es" } }, mkDb({ sqlImpl: async () => [] }), fakeLogger
    );
    expect(normalizeParams).toHaveBeenCalledWith({ ad_id: "1", language: "es" });
    expect(out.code).toBe(404);
  });
});

describe("services/reddit/controllers/adDetailController > getAdDetails — SQL paths", () => {
  it("404 when no rows", async () => {
    const out = await getAdDetails(
      { body: { ad_id: "1" }, query: {} }, mkDb({ sqlImpl: async () => [] }), fakeLogger
    );
    expect(out).toEqual({ code: 404, message: "Ad not found", data: null });
  });

  it("404 when query returns null", async () => {
    const out = await getAdDetails(
      { body: { ad_id: "1" }, query: {} }, mkDb({ sqlImpl: async () => null }), fakeLogger
    );
    expect(out.code).toBe(404);
  });

  it("500 + logger.error on SQL throw", async () => {
    const db = mkDb({ sqlImpl: async () => { throw new Error("db-down"); } });
    const out = await getAdDetails(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(500);
    expect(out.error).toBe("db-down");
    expect(fakeLogger.error).toHaveBeenCalled();
  });

  it("200 with ad data when SQL returns row, no ES", async () => {
    const db = mkDb({ sqlImpl: async () => [{ id: 1, last_seen: new Date().toISOString() }] });
    const out = await getAdDetails(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data[0].id).toBe(1);
    expect(out.data[0].ad_status).toBe("Active");
  });

  it("ad_status 'Inactive' when last_seen > 15 days old", async () => {
    const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const db = mkDb({ sqlImpl: async () => [{ id: 1, last_seen: oldDate }] });
    const out = await getAdDetails(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].ad_status).toBe("Inactive");
  });

  it("ad_status 'Inactive' when last_seen falsy", async () => {
    const db = mkDb({ sqlImpl: async () => [{ id: 1, last_seen: null }] });
    const out = await getAdDetails(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].ad_status).toBe("Inactive");
  });
});

describe("services/reddit/controllers/adDetailController > getAdDetails — ES overlay", () => {
  function adQueryImpl(rows = [{ id: 1, last_seen: new Date().toISOString() }]) {
    let call = 0;
    return async () => {
      call++;
      if (call === 1) return rows;
      return [];
    };
  }

  it("ES overlay attached when ES returns hits", async () => {
    const esHits = {
      hits: {
        hits: [{
          _source: {
            "reddit_translations.es": "Hola",
            "reddit_ad_variants.image_brand_logo": "brand.png",
            "reddit_ad_variants.image_object": "obj.png",
            "reddit_ad_variants.image_celebrity": "celeb.png",
            "reddit_ad_variants.image_ocr": "ocr.txt",
            "reddit_ad_meta_data.built_with": "bw",
            "reddit_ad_meta_data.built_with_analytics_tracking": "bwat",
            new_nas_image_url: "https://x/nas.png",
            "reddit.category": "cat",
            "reddit.subCategory": "subcat",
            "reddit_ad_domain.domain_registered_date": "2020-01-01",
            "reddit_ad.days_running": 42,
            lang_detect: "es",
            "reddit_ad_url.url_destination": "url-dest",
            "reddit_ad_outgoing_links.source_url": "src-url",
            "reddit_ad_outgoing_links.redirect_url": "redir",
            "reddit_ad_outgoing_links.final_url": "final",
            "reddit_ad_url.url_redirects": "redirects",
            "reddit_ad_meta_data.destination_url": "dest",
          },
        }],
      },
    };
    const db = {
      sql: { query: vi.fn(adQueryImpl()) },
      elastic: { search: vi.fn(async () => esHits) },
    };
    const out = await getAdDetails(
      { body: { ad_id: "1", language: "es" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data[0]["reddit_translations.es"]).toBe("Hola");
    expect(out.data[0].image_brand).toBe("brand.png");
    expect(out.data[0].image_object).toBe("obj.png");
    expect(out.data[0].image_celeb).toBe("celeb.png");
    expect(out.data[0].image_ocr).toBe("ocr.txt");
    expect(out.data[0].built_with).toBe("bw");
    expect(out.data[0].built_with_analytics_tracking).toBe("bwat");
    expect(out.data[0].image_url).toBe("https://x/nas.png");
    expect(out.data[0].category).toBe("cat");
    expect(out.data[0].subCategory).toBe("subcat");
    expect(out.data[0].domain_registered_date).toBe("2020-01-01");
    expect(out.data[0].days_running).toBe(42);
    expect(out.data[0].language).toBe("Spanish");
    expect(out.data[0].market_platform_urls.source_url).toBe("src-url");
  });

  it("ES uses body.hits fallback", async () => {
    const db = {
      sql: { query: vi.fn(adQueryImpl()) },
      elastic: { search: vi.fn(async () => ({ body: { hits: { hits: [{ _source: { "reddit.category": "cat" } }] } } })) },
    };
    const out = await getAdDetails(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0].category).toBe("cat");
  });

  it("ES with 0 hits leaves adData unchanged", async () => {
    const db = {
      sql: { query: vi.fn(adQueryImpl()) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [] } })) },
    };
    const out = await getAdDetails(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data[0].image_brand).toBeUndefined();
  });

  it("ES throws → logger.warn, falls through to SQL-only response", async () => {
    const db = {
      sql: { query: vi.fn(adQueryImpl()) },
      elastic: { search: vi.fn(async () => { throw new Error("es-fail"); }) },
    };
    const out = await getAdDetails(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(fakeLogger.warn).toHaveBeenCalledWith("ES overlay failed", { error: "es-fail" });
  });

  it("language='en' default → no translations key applied", async () => {
    const db = {
      sql: { query: vi.fn(adQueryImpl()) },
      elastic: { search: vi.fn(async () => ({
        hits: { hits: [{ _source: { "reddit_translations.en": "ignored" } }] },
      })) },
    };
    const out = await getAdDetails(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger  // no language → default 'en'
    );
    expect(out.data[0]["reddit_translations.en"]).toBeUndefined();
  });

  it("ES src without lang_detect → language unchanged", async () => {
    const db = {
      sql: { query: vi.fn(adQueryImpl()) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: {} }] } })) },
    };
    const out = await getAdDetails(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(getLanguageMap).not.toHaveBeenCalled();
  });

  it("language requested but translation key missing → branch skipped", async () => {
    const db = {
      sql: { query: vi.fn(adQueryImpl()) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: {} }] } })) },
    };
    const out = await getAdDetails(
      { body: { ad_id: "1", language: "es" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0]["reddit_translations.es"]).toBeUndefined();
  });
});

describe("services/reddit/controllers/adDetailController > getAdDetails — country resolution", () => {
  it("resolves single country code with single-pipe separator", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async (sql, params) => {
        call++;
        if (call === 1) return [{ id: 1, country_code: "US", last_seen: null }];
        if (params[0] === "US") return [{ name: "United States" }];
        return [];
      })},
    };
    const out = await getAdDetails(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.country).toEqual(["United States"]);
  });

  it("resolves multiple country codes with double-pipe separator and dedupes", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async (sql, params) => {
        call++;
        if (call === 1) return [{ id: 1, country_code: "US||IN||US", last_seen: null }];
        if (params[0] === "US") return [{ name: "United States" }];
        if (params[0] === "IN") return [{ name: "India" }];
        return [];
      })},
    };
    const out = await getAdDetails(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.country).toEqual(["United States", "India"]);
  });

  it("country lookup throw is silently swallowed", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async (sql) => {
        call++;
        if (call === 1) return [{ id: 1, country_code: "US", last_seen: null }];
        throw new Error("country-lookup-fail");
      })},
    };
    const out = await getAdDetails(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.country).toEqual([]);
  });

  it("country lookup returns no name → not added", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [{ id: 1, country_code: "US", last_seen: null }];
        return [];
      })},
    };
    const out = await getAdDetails(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.country).toEqual([]);
  });

  it("no country_code on ad → country=[]", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ id: 1, last_seen: null }]) },
    };
    const out = await getAdDetails(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.country).toEqual([]);
  });

  it("empty entries from split are filtered out", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async (sql, params) => {
        call++;
        if (call === 1) return [{ id: 1, country_code: "||US||", last_seen: null }];
        if (params[0] === "US") return [{ name: "United States" }];
        return [];
      })},
    };
    const out = await getAdDetails(
      { body: { ad_id: "1" }, query: {} }, db, fakeLogger
    );
    expect(out.country).toEqual(["United States"]);
  });
});
