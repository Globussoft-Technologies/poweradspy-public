import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const paramsPath = require.resolve("../../../../src/services/linkedin/helpers/paramParser");
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
  "../../../../src/services/linkedin/controllers/adDetailController"
);

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
beforeEach(() => {
  fakeLogger.warn.mockClear();
  fakeLogger.error.mockClear();
  normalizeParams.mockClear().mockImplementation((raw) => raw);
  getLanguageMap.mockClear();
  resolveLanguageName.mockClear();
});

describe("services/linkedin/controllers/adDetailController > validation + SQL paths", () => {
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
  it("404 / null / 500 paths", async () => {
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, { sql: { query: vi.fn(async () => []) } }, fakeLogger)).code).toBe(404);
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, { sql: { query: vi.fn(async () => null) } }, fakeLogger)).code).toBe(404);
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, { sql: { query: vi.fn(async () => { throw new Error("db-down"); }) } }, fakeLogger);
    expect(out.code).toBe(500);
    expect(out.error).toBe("db-down");
  });
  it("200 SQL-only happy path with ad_status Active/Inactive/falsy", async () => {
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, { sql: { query: vi.fn(async () => [{ id: 1, last_seen: new Date().toISOString() }]) } }, fakeLogger)).data[0].ad_status).toBe("Active");
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, { sql: { query: vi.fn(async () => [{ id: 1, last_seen: old }]) } }, fakeLogger)).data[0].ad_status).toBe("Inactive");
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, { sql: { query: vi.fn(async () => [{ id: 1, last_seen: null }]) } }, fakeLogger)).data[0].ad_status).toBe("Inactive");
  });
});

describe("services/linkedin/controllers/adDetailController > ES overlay", () => {
  function adRow() { return { id: 1, last_seen: new Date().toISOString() }; }

  it("applies full ES overlay incl. epoch domain_registration_date conversion", async () => {
    const hits = { hits: { hits: [{ _source: {
      "linkedin_translation.es": "Hola",
      image_brand: "brand",
      image_object: "obj",
      image_celebrity: "celeb",
      image_ocr: "ocr",
      source: "li-src",
      new_nas_image_url: "https://nas.x/img.png",
      "linkedin.category": "cat",
      "linkedin.subCategory": "sub",
      impression: 100,
      popularity: 50,
      domain_registration_date: 1577836800, // 2020-01-01 epoch
      duration: 99,
      ad_language: "es",
      redirect_urls: ["r1"],
    }}]}};
    const db = {
      sql: { query: vi.fn(async () => [adRow()]) },
      elastic: { search: vi.fn(async () => hits) },
    };
    const out = await getAdDetails(
      { body: { ad_id: "1", language: "es" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0]["linkedin_translation.es"]).toBe("Hola");
    expect(out.data[0].image_brand).toBe("brand");
    expect(out.data[0].image_object).toBe("obj");
    expect(out.data[0].image_celeb).toBe("celeb");
    expect(out.data[0].image_ocr).toBe("ocr");
    expect(out.data[0].source).toBe("li-src");
    expect(out.data[0].image_video_url).toBe("https://nas.x/img.png");
    expect(out.data[0].category).toBe("cat");
    expect(out.data[0].subCategory).toBe("sub");
    expect(out.data[0].impression).toBe(100);
    expect(out.data[0].popularity).toBe(50);
    expect(out.data[0].domain_registered_date).toBe("2020-01-01");
    expect(out.data[0].days_running).toBe(99);
    expect(out.data[0].language).toBe("Spanish");
    expect(out.data[0].market_platform_urls.redirect_urls).toEqual(["r1"]);
  });

  it("domain_registration_date non-numeric → passed through", async () => {
    const db = {
      sql: { query: vi.fn(async () => [adRow()]) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { domain_registration_date: "abc" } }] } })) },
    };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.data[0].domain_registered_date).toBe("abc");
  });

  it("domain_registration_date = 0 → passed through (falsy ts branch)", async () => {
    const db = {
      sql: { query: vi.fn(async () => [adRow()]) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { domain_registration_date: 0 } }] } })) },
    };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.data[0].domain_registered_date).toBe(0);
  });

  it("ES body.hits fallback", async () => {
    const db = {
      sql: { query: vi.fn(async () => [adRow()]) },
      elastic: { search: vi.fn(async () => ({ body: { hits: { hits: [{ _source: { source: "li" } }] } } })) },
    };
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).data[0].source).toBe("li");
  });

  it("ES with 0 hits leaves adData unchanged", async () => {
    const db = {
      sql: { query: vi.fn(async () => [adRow()]) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [] } })) },
    };
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).data[0].image_brand).toBeUndefined();
  });

  it("ES throws → logger.warn", async () => {
    const db = {
      sql: { query: vi.fn(async () => [adRow()]) },
      elastic: { search: vi.fn(async () => { throw new Error("es-down"); }) },
    };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(fakeLogger.warn).toHaveBeenCalledWith("ES overlay failed", { error: "es-down" });
  });

  it("language='en' default → no translation applied", async () => {
    const db = {
      sql: { query: vi.fn(async () => [adRow()]) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { "linkedin_translation.en": "ignored" } }] } })) },
    };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.data[0]["linkedin_translation.en"]).toBeUndefined();
  });

  it("language requested but key missing → branch skipped", async () => {
    const db = {
      sql: { query: vi.fn(async () => [adRow()]) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: {} }] } })) },
    };
    const out = await getAdDetails({ body: { ad_id: "1", language: "fr" }, query: {} }, db, fakeLogger);
    expect(out.data[0]["linkedin_translation.fr"]).toBeUndefined();
  });

  it("ES src without ad_language → resolveLanguageName not called", async () => {
    const db = {
      sql: { query: vi.fn(async () => [adRow()]) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: {} }] } })) },
    };
    await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(getLanguageMap).not.toHaveBeenCalled();
  });
});
