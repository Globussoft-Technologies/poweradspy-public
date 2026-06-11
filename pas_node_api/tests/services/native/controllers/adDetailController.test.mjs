import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const paramsPath = require.resolve("../../../../src/services/native/helpers/paramParser");
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
  "../../../../src/services/native/controllers/adDetailController"
);

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
beforeEach(() => {
  fakeLogger.warn.mockClear();
  fakeLogger.error.mockClear();
  normalizeParams.mockClear().mockImplementation((raw) => raw);
  getLanguageMap.mockClear();
  resolveLanguageName.mockClear();
});

describe("services/native/controllers/adDetailController > validation + SQL paths", () => {
  it("401 when ad_id missing", async () => {
    expect(await getAdDetails({ body: {}, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters: ad_id is required" });
  });
  it("503 when db.sql missing", async () => {
    expect(await getAdDetails({ body: { ad_id: "1" }, query: {} }, { sql: null }, fakeLogger))
      .toEqual({ code: 503, message: "SQL database connection not available" });
  });
  it("merges body+query into normalize", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    await getAdDetails({ body: { ad_id: "1" }, query: { language: "es" } }, db, fakeLogger);
    expect(normalizeParams).toHaveBeenCalledWith({ ad_id: "1", language: "es" });
  });
  it("404 on empty/null rows", async () => {
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, { sql: { query: vi.fn(async () => []) } }, fakeLogger)).code).toBe(404);
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, { sql: { query: vi.fn(async () => null) } }, fakeLogger)).code).toBe(404);
  });
  it("500 on SQL throw", async () => {
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} },
      { sql: { query: vi.fn(async () => { throw new Error("db-down"); }) } }, fakeLogger);
    expect(out.code).toBe(500);
    expect(out.error).toBe("db-down");
    expect(fakeLogger.error).toHaveBeenCalled();
  });
  it("200 SQL-only with ad_status Active/Inactive/falsy", async () => {
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} },
      { sql: { query: vi.fn(async () => [{ id: 1, last_seen: new Date().toISOString() }]) } }, fakeLogger)).data[0].ad_status).toBe("Active");
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} },
      { sql: { query: vi.fn(async () => [{ id: 1, last_seen: old }]) } }, fakeLogger)).data[0].ad_status).toBe("Inactive");
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} },
      { sql: { query: vi.fn(async () => [{ id: 1, last_seen: null }]) } }, fakeLogger)).data[0].ad_status).toBe("Inactive");
  });
});

describe("services/native/controllers/adDetailController > ES overlay", () => {
  function adQueryImpl(rows = [{ id: 1, last_seen: new Date().toISOString() }]) {
    let call = 0;
    return async () => {
      call++;
      if (call === 1) return rows;
      return [];
    };
  }

  it("applies full ES overlay", async () => {
    const esHits = {
      hits: {
        hits: [{
          _source: {
            "native_translations.es": "Hola",
            "native_ad_variants.image_brand_logo_exactly": "brand.png",
            "native_ad_variants.image_object": "obj.png",
            "native_ad_variants.image_celebrity_exactly": "celeb.png",
            "native_ad_variants.image_ocr_exactly": "ocr.txt",
            new_nas_image_url: "https://x/nas.png",
            "native_ad_domains.domain_registered_date": "2020-01-01",
            "native_ad.days_running": 42,
            "native_ad.source": "native-src",
            "native_ad_meta_data.built_with_analytics_tracking": "bwat",
            "native.category": "cat",
            "native.subCategory": "subcat",
            lang_detect: "es",
            "native_ad_url.url_destination": "url-dest",
            "native_ad_outgoing_links.source_url": "src-url",
            "native_ad_outgoing_links.redirect_url": "redir",
            "native_ad_outgoing_links.final_url": "final",
            "native_ad_url.url_redirects": "redirects",
            "native_ad_meta_data.destination_url": "dest",
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
    expect(out.data[0]["native_translations.es"]).toBe("Hola");
    expect(out.data[0].imageBrand).toBe("brand.png");
    expect(out.data[0].imageObject).toBe("obj.png");
    expect(out.data[0].imageCeleb).toBe("celeb.png");
    expect(out.data[0].imageOcr).toBe("ocr.txt");
    expect(out.data[0].image_url).toBe("https://x/nas.png");
    expect(out.data[0].source).toBe("native-src");
    expect(out.data[0].built_with_analytics_tracking).toBe("bwat");
    expect(out.data[0].platform_network).toBe("Native");
    expect(out.data[0].category).toBe("cat");
    expect(out.data[0].subCategory).toBe("subcat");
    expect(out.data[0].domain_registered_date).toBe("2020-01-01");
    expect(out.data[0].days_running).toBe(42);
    expect(out.data[0].language).toBe("Spanish");
    expect(out.data[0].market_platform_urls.source_url).toBe("src-url");
  });

  it("ES body.hits fallback", async () => {
    const db = {
      sql: { query: vi.fn(adQueryImpl()) },
      elastic: { search: vi.fn(async () => ({ body: { hits: { hits: [{ _source: { "native.category": "cat" } }] } } })) },
    };
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).data[0].category).toBe("cat");
  });

  it("ES native_ad.nas_url is preferred over new_nas_image_url for image_url", async () => {
    const db = {
      sql: { query: vi.fn(adQueryImpl()) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: {
        "native_ad.nas_url": "https://nas-preferred.x/img.png",
        new_nas_image_url: "https://other.x/img.png",
      }}]}})) },
    };
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).data[0].image_url)
      .toBe("https://nas-preferred.x/img.png");
  });

  it("ES with 0 hits leaves adData unchanged", async () => {
    const db = {
      sql: { query: vi.fn(adQueryImpl()) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [] } })) },
    };
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).data[0].imageBrand).toBeUndefined();
  });

  it("ES throws → logger.warn", async () => {
    const db = {
      sql: { query: vi.fn(adQueryImpl()) },
      elastic: { search: vi.fn(async () => { throw new Error("es-down"); }) },
    };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(fakeLogger.warn).toHaveBeenCalledWith("ES overlay failed", { error: "es-down" });
  });

  it("language='en' → no translation applied", async () => {
    const db = {
      sql: { query: vi.fn(adQueryImpl()) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { "native_translations.en": "ignored" } }] } })) },
    };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.data[0]["native_translations.en"]).toBeUndefined();
  });

  it("ES src without lang_detect → resolveLanguageName not called", async () => {
    const db = {
      sql: { query: vi.fn(adQueryImpl()) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: {} }] } })) },
    };
    await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(getLanguageMap).not.toHaveBeenCalled();
  });

  it("language requested but key missing → branch skipped", async () => {
    const db = {
      sql: { query: vi.fn(adQueryImpl()) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: {} }] } })) },
    };
    const out = await getAdDetails({ body: { ad_id: "1", language: "es" }, query: {} }, db, fakeLogger);
    expect(out.data[0]["native_translations.es"]).toBeUndefined();
  });
});

describe("services/native/controllers/adDetailController > country resolution", () => {
  it("single code, single-pipe separator", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async (sql, params) => {
      call++;
      if (call === 1) return [{ id: 1, country_code: "US", last_seen: null }];
      if (params[0] === "US") return [{ name: "United States" }];
      return [];
    })}};
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).country).toEqual(["United States"]);
  });

  it("multiple codes, double-pipe + dedup", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async (sql, params) => {
      call++;
      if (call === 1) return [{ id: 1, country_code: "US||IN||US", last_seen: null }];
      if (params[0] === "US") return [{ name: "United States" }];
      if (params[0] === "IN") return [{ name: "India" }];
      return [];
    })}};
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).country).toEqual(["United States", "India"]);
  });

  it("country lookup throw is silently swallowed", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ id: 1, country_code: "US", last_seen: null }];
      throw new Error("country-fail");
    })}};
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).country).toEqual([]);
  });

  it("country lookup returns no name → not added", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ id: 1, country_code: "US", last_seen: null }];
      return [];
    })}};
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).country).toEqual([]);
  });

  it("no country_code → []", async () => {
    const db = { sql: { query: vi.fn(async () => [{ id: 1, last_seen: null }]) } };
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).country).toEqual([]);
  });

  it("empty entries from split filtered out", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async (sql, params) => {
      call++;
      if (call === 1) return [{ id: 1, country_code: "||US||", last_seen: null }];
      if (params[0] === "US") return [{ name: "United States" }];
      return [];
    })}};
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).country).toEqual(["United States"]);
  });
});
