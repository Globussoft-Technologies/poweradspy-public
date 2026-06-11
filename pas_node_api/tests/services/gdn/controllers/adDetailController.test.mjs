import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const paramsPath = require.resolve("../../../../src/services/gdn/helpers/paramParser");
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
  "../../../../src/services/gdn/controllers/adDetailController"
);

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

let fetchSpy;
beforeEach(() => {
  fakeLogger.warn.mockClear();
  fakeLogger.error.mockClear();
  normalizeParams.mockClear().mockImplementation((raw) => raw);
  getLanguageMap.mockClear();
  resolveLanguageName.mockClear();
  delete process.env.API_URL_BUILTWITH;
  fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
    json: async () => ({ code: 200 }),
  });
});
afterEach(() => { fetchSpy.mockRestore(); });

function mkDb({ adRow = null, urlRows = [], elastic = null, urlThrows = false } = {}) {
  let call = 0;
  return {
    sql: { query: vi.fn(async (sql) => {
      call++;
      if (call === 1) return adRow == null ? [] : [adRow];
      if (urlThrows) throw new Error("url-fail");
      return urlRows;
    })},
    elastic,
  };
}

describe("services/gdn/controllers/adDetailController > validation + SQL paths", () => {
  it("401 when ad_id missing", async () => {
    expect(await getAdDetails({ body: {}, query: {} }, {}, fakeLogger))
      .toEqual({ code: 401, message: "Missing parameters: ad_id is required" });
  });
  it("503 when db.sql missing", async () => {
    expect(await getAdDetails({ body: { ad_id: "1" }, query: {} }, { sql: null }, fakeLogger))
      .toEqual({ code: 503, message: "SQL database connection not available" });
  });
  it("merges body+query into normalize", async () => {
    const db = mkDb({});
    await getAdDetails({ body: { ad_id: "1" }, query: { language: "es" } }, db, fakeLogger);
    expect(normalizeParams).toHaveBeenCalledWith({ ad_id: "1", language: "es" });
  });
  it("404 when no rows", async () => {
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, mkDb({}), fakeLogger)).code).toBe(404);
  });
  it("404 when query returns null", async () => {
    const db = { sql: { query: vi.fn(async () => null) } };
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).code).toBe(404);
  });
  it("500 on initial SQL throw", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("db-down"); }) } };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(500);
    expect(out.error).toBe("db-down");
    expect(fakeLogger.error).toHaveBeenCalled();
  });
});

describe("services/gdn/controllers/adDetailController > URL array fallback", () => {
  it("populates adData.urlArray from second query", async () => {
    const db = mkDb({ adRow: { id: 1, last_seen: null }, urlRows: [{ url: "a" }, { url: "b" }] });
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.data[0].urlArray).toEqual(["a", "b"]);
  });
  it("urlArray defaults to [] when query throws (silently swallowed)", async () => {
    const db = mkDb({ adRow: { id: 1, last_seen: null }, urlThrows: true });
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.data[0].urlArray).toEqual([]);
  });
  it("urlArray null returns []", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ id: 1, last_seen: null }];
      return null;
    })}};
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.data[0].urlArray).toEqual([]);
  });
});

describe("services/gdn/controllers/adDetailController > ad_status", () => {
  it("Active when last_seen recent", async () => {
    const db = mkDb({ adRow: { id: 1, last_seen: new Date().toISOString() } });
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).data[0].ad_status).toBe("Active");
  });
  it("Inactive when last_seen > 15 days", async () => {
    const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const db = mkDb({ adRow: { id: 1, last_seen: old } });
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).data[0].ad_status).toBe("Inactive");
  });
  it("Inactive when last_seen falsy", async () => {
    const db = mkDb({ adRow: { id: 1, last_seen: null } });
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).data[0].ad_status).toBe("Inactive");
  });
});

describe("services/gdn/controllers/adDetailController > ES overlay", () => {
  function elasticHits(_source) {
    return { indexName: "gdn_search_mix", search: vi.fn(async () => ({ hits: { hits: [{ _source }] } })) };
  }

  it("applies full ES overlay", async () => {
    const src = {
      "gdn_ad_translation.es": "Hola",
      "gdn_ad_variants.image_brand_logo": "brand",
      "gdn_ad_variants.image_object": "obj",
      "gdn_ad_variants.image_celebrity": "celeb",
      "gdn_ad_variants.image_ocr": "ocr",
      new_nas_image_url: "https://x/nas.png",
      "gdn_ad_domains.domain_registered_date": "2020-01-01",
      "gdn_ad.days_running": 42,
      "gdn.category": "cat",
      "gdn.subCategory": "sub",
      lang_detect: "es",
      "gdn_ad_url.url_destination": "ud",
      "gdn_ad_outgoing_links.source_url": "src",
      "gdn_ad_outgoing_links.redirect_url": "redir",
      "gdn_ad_outgoing_links.final_url": "final",
      "gdn_ad_url.url_redirects": "redirects",
      "gdn_ad_meta_data.destination_url": "dest",
    };
    const db = mkDb({ adRow: { id: 1, last_seen: null }, elastic: elasticHits(src) });
    const out = await getAdDetails(
      { body: { ad_id: "1", language: "es" }, query: {} }, db, fakeLogger
    );
    expect(out.data[0]["gdn_ad_translation.es"]).toBe("Hola");
    expect(out.data[0].image_brand).toBe("brand");
    expect(out.data[0].image_object).toBe("obj");
    expect(out.data[0].image_celeb).toBe("celeb");
    expect(out.data[0].image_ocr).toBe("ocr");
    expect(out.data[0].image_url).toBe("https://x/nas.png");
    expect(out.data[0].domain_registered_date).toBe("2020-01-01");
    expect(out.data[0].days_running).toBe(42);
    expect(out.data[0].category).toBe("cat");
    expect(out.data[0].subCategory).toBe("sub");
    expect(out.data[0].language).toBe("Spanish");
    expect(out.data[0].market_platform_urls.source_url).toBe("src");
  });

  it("ES body.hits fallback", async () => {
    const elastic = {
      indexName: "gdn",
      search: vi.fn(async () => ({ body: { hits: { hits: [{ _source: { "gdn.category": "cat" } }] } } })),
    };
    const db = mkDb({ adRow: { id: 1, last_seen: null }, elastic });
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).data[0].category).toBe("cat");
  });

  it("uses default 'gdn_search_mix' index when indexName missing", async () => {
    const elastic = { search: vi.fn(async () => ({ hits: { hits: [] } })) };
    const db = mkDb({ adRow: { id: 1, last_seen: null }, elastic });
    await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(elastic.search.mock.calls[0][0].index).toBe("gdn_search_mix");
  });

  it("ES with 0 hits leaves adData unchanged", async () => {
    const elastic = { indexName: "gdn", search: vi.fn(async () => ({ hits: { hits: [] } })) };
    const db = mkDb({ adRow: { id: 1, last_seen: null }, elastic });
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).data[0].image_brand).toBeUndefined();
  });

  it("ES throws → logger.warn", async () => {
    const elastic = { indexName: "gdn", search: vi.fn(async () => { throw new Error("es-down"); }) };
    const db = mkDb({ adRow: { id: 1, last_seen: null }, elastic });
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(fakeLogger.warn).toHaveBeenCalledWith("ES overlay failed in GDN getAdDetails", { error: "es-down" });
  });

  it("language='en' → no translation applied", async () => {
    const db = mkDb({ adRow: { id: 1, last_seen: null }, elastic: elasticHits({ "gdn_ad_translation.en": "ignored" }) });
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).data[0]["gdn_ad_translation.en"]).toBeUndefined();
  });

  it("language requested but key missing → branch skipped", async () => {
    const db = mkDb({ adRow: { id: 1, last_seen: null }, elastic: elasticHits({}) });
    expect((await getAdDetails({ body: { ad_id: "1", language: "fr" }, query: {} }, db, fakeLogger)).data[0]["gdn_ad_translation.fr"]).toBeUndefined();
  });

  it("ES src without lang_detect → getLanguageMap not called", async () => {
    const db = mkDb({ adRow: { id: 1, last_seen: null }, elastic: elasticHits({}) });
    await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(getLanguageMap).not.toHaveBeenCalled();
  });
});

describe("services/gdn/controllers/adDetailController > builtwithStatusCode", () => {
  it("defaults to 501 when domain absent", async () => {
    const db = mkDb({ adRow: { id: 1, last_seen: null } });
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).builtwithStatusCode).toBe(501);
  });

  it("defaults to 501 when domain is 'null' string", async () => {
    const db = mkDb({ adRow: { id: 1, last_seen: null, domain: "null" } });
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).builtwithStatusCode).toBe(501);
  });

  it("defaults to 501 when domain present but API_URL_BUILTWITH env unset", async () => {
    const db = mkDb({ adRow: { id: 1, last_seen: null, domain: "example.com" } });
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).builtwithStatusCode).toBe(501);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("uses fetch result code when API_URL_BUILTWITH set", async () => {
    process.env.API_URL_BUILTWITH = "https://bw.example";
    fetchSpy.mockResolvedValueOnce({ json: async () => ({ code: 200 }) });
    const db = mkDb({ adRow: { id: 1, last_seen: null, domain: "example.com" } });
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.builtwithStatusCode).toBe(200);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://bw.example/get-technology-status",
      expect.objectContaining({ method: "POST" })
    );
  });

  it("falls back to 501 when fetch returns no code", async () => {
    process.env.API_URL_BUILTWITH = "https://bw.example";
    fetchSpy.mockResolvedValueOnce({ json: async () => ({}) });
    const db = mkDb({ adRow: { id: 1, last_seen: null, domain: "example.com" } });
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.builtwithStatusCode).toBe(501);
  });

  it("fetch throws → logger.warn + builtwithStatusCode stays 501", async () => {
    process.env.API_URL_BUILTWITH = "https://bw.example";
    fetchSpy.mockRejectedValueOnce(new Error("bw-down"));
    const db = mkDb({ adRow: { id: 1, last_seen: null, domain: "example.com" } });
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.builtwithStatusCode).toBe(501);
    expect(fakeLogger.warn).toHaveBeenCalledWith(
      "Built-with API call failed (gdn)", { error: "bw-down" }
    );
  });
});
