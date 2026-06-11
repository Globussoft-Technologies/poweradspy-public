import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const paramsPath = require.resolve("../../../../src/services/pinterest/helpers/paramParser");
const normalizeParams = vi.fn((raw) => raw);
const cleanAdsData = vi.fn((ads = []) => ads);
require.cache[paramsPath] = {
  id: paramsPath, filename: paramsPath, loaded: true,
  exports: { normalizeParams, cleanAdsData },
};

const { getAdDetails } = require(
  "../../../../src/services/pinterest/controllers/adDetailController"
);

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
beforeEach(() => {
  fakeLogger.warn.mockClear();
  fakeLogger.error.mockClear();
  normalizeParams.mockClear().mockImplementation((raw) => raw);
});

describe("services/pinterest/controllers/adDetailController > validation", () => {
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

describe("services/pinterest/controllers/adDetailController > SQL paths", () => {
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

  it("200 SQL-only happy path: ad_status=Active", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ id: 1, last_seen: new Date().toISOString() }]) },
    };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data[0].ad_status).toBe("Active");
  });

  it("ad_status=Inactive when last_seen > 15 days old", async () => {
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

describe("services/pinterest/controllers/adDetailController > ES overlay", () => {
  it("applies full ES overlay (all branches)", async () => {
    const adRow = { id: 1, last_seen: new Date().toISOString() };
    const hits = { hits: { hits: [{ _source: {
      "pinterest_translations.es": "Hola",
      "pinterest_ad_variants.image_brand_logo_exactly": "brand",
      "pinterest_ad_variants.image_object": "obj",
      "pinterest_ad_variants.image_celebrity_exactly": "celeb",
      "pinterest_ad_variants.image_ocr_exactly": "ocr",
      new_nas_image_url: "https://nas.x/p.png",
      "pinterest_ad_domains.domain_registered_date": "2020-01-01",
      "pinterest_ad.days_running": 42,
      "pinterest.category": "cat",
      "pinterest.subCategory": "sub",
      "pinterest_ad_url.url_destination": "dest",
      "pinterest_ad_outgoing_links.source_url": "src",
      "pinterest_ad_outgoing_links.redirect_url": "redir",
      "pinterest_ad_outgoing_links.final_url": "final",
      "pinterest_ad_url.url_redirects": "redirects",
      "pinterest_ad_meta_data.destination_url": "meta-dest",
    }}]}};
    const db = {
      sql: { query: vi.fn(async () => [adRow]) },
      elastic: { search: vi.fn(async () => hits) },
    };
    const out = await getAdDetails(
      { body: { ad_id: "1", language: "es" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0]["pinterest_translations.es"]).toBe("Hola");
    expect(out.data[0].imageBrand).toBe("brand");
    expect(out.data[0].imageObject).toBe("obj");
    expect(out.data[0].imageCeleb).toBe("celeb");
    expect(out.data[0].imageOcr).toBe("ocr");
    expect(out.data[0].image_url).toBe("https://nas.x/p.png");
    expect(out.data[0].domain_registered_date).toBe("2020-01-01");
    expect(out.data[0].days_running).toBe(42);
    expect(out.data[0].category).toBe("cat");
    expect(out.data[0].subCategory).toBe("sub");
    expect(out.data[0].market_platform_urls.source_url).toBe("src");
  });

  it("ES uses body.hits fallback", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ id: 1, last_seen: null }]) },
      elastic: { search: vi.fn(async () => ({ body: { hits: { hits: [{ _source: { "pinterest.category": "cat" } }] } } })) },
    };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.data[0].category).toBe("cat");
  });

  it("ES with 0 hits leaves adData unchanged", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ id: 1, last_seen: null }]) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [] } })) },
    };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data[0].imageBrand).toBeUndefined();
  });

  it("ES throws → logger.warn, falls through", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ id: 1, last_seen: null }]) },
      elastic: { search: vi.fn(async () => { throw new Error("es-down"); }) },
    };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(fakeLogger.warn).toHaveBeenCalledWith("ES overlay failed", { error: "es-down" });
  });

  it("language='en' default → no translations applied", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ id: 1, last_seen: null }]) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: { "pinterest_translations.en": "ignored" } }] } })) },
    };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.data[0]["pinterest_translations.en"]).toBeUndefined();
  });

  it("language requested but translation key missing → branch skipped", async () => {
    const db = {
      sql: { query: vi.fn(async () => [{ id: 1, last_seen: null }]) },
      elastic: { search: vi.fn(async () => ({ hits: { hits: [{ _source: {} }] } })) },
    };
    const out = await getAdDetails({ body: { ad_id: "1", language: "fr" }, query: {} }, db, fakeLogger);
    expect(out.data[0]["pinterest_translations.fr"]).toBeUndefined();
  });
});
