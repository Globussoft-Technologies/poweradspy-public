import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const paramsPath = require.resolve("../../../../src/services/google/helpers/paramParser");
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
  "../../../../src/services/google/controllers/adDetailController"
);

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
beforeEach(() => {
  fakeLogger.warn.mockClear();
  fakeLogger.error.mockClear();
  normalizeParams.mockClear().mockImplementation((raw) => raw);
  getLanguageMap.mockClear();
  resolveLanguageName.mockClear();
});

describe("services/google/controllers/adDetailController > validation", () => {
  it("401 when ad_id missing", async () => {
    expect(await getAdDetails({ body: {}, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters: ad_id is required" });
  });

  it("503 when db.sql missing", async () => {
    expect(await getAdDetails({ body: { ad_id: "1" }, query: {} }, { sql: null }, fakeLogger))
      .toEqual({ code: 503, message: "SQL database connection not available" });
  });

  it("merges body + query into normalize", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    await getAdDetails({ body: { ad_id: "1" }, query: { language: "es" } }, db, fakeLogger);
    expect(normalizeParams).toHaveBeenCalledWith({ ad_id: "1", language: "es" });
  });
});

describe("services/google/controllers/adDetailController > SQL paths", () => {
  it("404 when no rows / null", async () => {
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, { sql: { query: vi.fn(async () => []) } }, fakeLogger)).code).toBe(404);
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, { sql: { query: vi.fn(async () => null) } }, fakeLogger)).code).toBe(404);
  });

  it("500 + logger.error on SQL throw", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("db-down"); }) } };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(500);
    expect(out.error).toBe("db-down");
    expect(fakeLogger.error).toHaveBeenCalled();
  });

  it("200 SQL-only happy path with ad_status Active/Inactive/falsy", async () => {
    const db1 = { sql: { query: vi.fn(async () => [{ id: 1, lastSeenOnDesktop: new Date().toISOString() }]) } };
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db1, fakeLogger)).data[0].ad_status).toBe("Active");

    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const db2 = { sql: { query: vi.fn(async () => [{ id: 1, lastSeenOnDesktop: old }]) } };
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db2, fakeLogger)).data[0].ad_status).toBe("Inactive");

    const db3 = { sql: { query: vi.fn(async () => [{ id: 1, lastSeenOnDesktop: null }]) } };
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db3, fakeLogger)).data[0].ad_status).toBe("Inactive");
  });
});

describe("services/google/controllers/adDetailController > ES overlay", () => {
  function adRow() { return { id: 1, lastSeenOnDesktop: new Date().toISOString() }; }

  it("applies full ES overlay", async () => {
    const hits = { hits: { hits: [{ _source: {
      "google_translation.es": "Hola",
      image_brand: "brand",
      image_object: "obj",
      image_celebrity: "celeb",
      image_ocr: "ocr",
      source: "g-src",
      new_nas_image_url: "https://nas.x/img.png",
      category: "cat",
      subCategory: "sub",
      ad_position: 1,
      days_running: 42,
      last_seen: "2024-01-15T12:00:00Z",
      domain_registered_date: "2020-01-01",
      lang_detect: "es",
      url_destination: "ud",
      source_url: "src",
      redirect_url: "redir",
      final_url: "final",
      url_redirects: "redirects",
      destination_url: "dest",
    }}]}};
    const db = {
      sql: { query: vi.fn(async () => [adRow()]) },
      elastic: { search: vi.fn(async () => hits) },
    };
    const out = await getAdDetails(
      { body: { ad_id: "1", language: "es" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0]["google_translation.es"]).toBe("Hola");
    expect(out.data[0].imageBrand).toBe("brand");
    expect(out.data[0].imageObject).toBe("obj");
    expect(out.data[0].imageCeleb).toBe("celeb");
    expect(out.data[0].imageOcr).toBe("ocr");
    expect(out.data[0].source).toBe("g-src");
    expect(out.data[0].image_url).toBe("https://nas.x/img.png");
    expect(out.data[0].category).toBe("cat");
    expect(out.data[0].subCategory).toBe("sub");
    expect(out.data[0].ad_position).toBe(1);
    expect(out.data[0].days_running).toBe(42);
    expect(out.data[0].last_seen).toBe("2024-01-15");
    expect(out.data[0].domain_registered_date).toBe("2020-01-01");
    expect(out.data[0].language).toBe("Spanish");
    expect(out.data[0].market_platform_urls.source_url).toBe("src");
  });

  it("ES body.hits fallback", async () => {
    const db = {
      sql: { query: vi.fn(async () => [adRow()]) },
      elastic: { search: vi.fn(async () => ({ body: { hits: { hits: [{ _source: { source: "g", last_seen: "2024-01-01T00:00:00Z" } }] } } })) },
    };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.data[0].source).toBe("g");
  });

  it("ES with 0 hits leaves adData unchanged", async () => {
    const db = {
      sql: { query: vi.fn(async () => [adRow()]) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [] } })) },
    };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.data[0].imageBrand).toBeUndefined();
  });

  it("ES throws → logger.warn, falls through", async () => {
    const db = {
      sql: { query: vi.fn(async () => [adRow()]) },
      elastic: { search: vi.fn(async () => { throw new Error("es-down"); }) },
    };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(fakeLogger.warn).toHaveBeenCalledWith("ES overlay failed", { error: "es-down" });
  });

  it("language='en' default → no translations applied", async () => {
    const db = {
      sql: { query: vi.fn(async () => [adRow()]) },
      elastic: { search: vi.fn(async () => ({
        hits: { hits: [{ _source: { "google_translation.en": "ignored", last_seen: "2024-01-01T00:00:00Z" } }] },
      }))},
    };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.data[0]["google_translation.en"]).toBeUndefined();
  });

  it("language requested but key missing → branch skipped", async () => {
    const db = {
      sql: { query: vi.fn(async () => [adRow()]) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { last_seen: "2024-01-01T00:00:00Z" } }] } })) },
    };
    const out = await getAdDetails({ body: { ad_id: "1", language: "fr" }, query: {} }, db, fakeLogger);
    expect(out.data[0]["google_translation.fr"]).toBeUndefined();
  });

  it("ES src without lang_detect → resolveLanguageName not called", async () => {
    const db = {
      sql: { query: vi.fn(async () => [adRow()]) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { last_seen: "2024-01-01T00:00:00Z" } }] } })) },
    };
    await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(getLanguageMap).not.toHaveBeenCalled();
  });
});
