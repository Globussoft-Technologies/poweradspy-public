import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const paramsPath = require.resolve("../../../../src/services/instagram/helpers/paramParser");
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
  "../../../../src/services/instagram/controllers/adDetailController"
);

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
beforeEach(() => {
  fakeLogger.warn.mockClear();
  fakeLogger.error.mockClear();
  normalizeParams.mockClear().mockImplementation((raw) => raw);
  getLanguageMap.mockClear();
  resolveLanguageName.mockClear();
  delete process.env.API_URL_BUILTWITH;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("services/instagram/controllers/adDetailController > validation + SQL paths", () => {
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
  it("404 on empty rows", async () => {
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, { sql: { query: vi.fn(async () => []) } }, fakeLogger)).code).toBe(404);
  });
  it("404 on null rows", async () => {
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, { sql: { query: vi.fn(async () => null) } }, fakeLogger)).code).toBe(404);
  });
  it("500 on outer SQL throw", async () => {
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} },
      { sql: { query: vi.fn(async () => { throw new Error("db-down"); }) } }, fakeLogger);
    expect(out.code).toBe(500);
    expect(out.error).toBe("db-down");
    expect(fakeLogger.error).toHaveBeenCalled();
  });
});

describe("services/instagram/controllers/adDetailController > ad_status (computeAdStatus)", () => {
  function mkDb(adRow) {
    let call = 0;
    return { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [adRow];
      return [];
    })}};
  }
  it("Active when last_seen within 15 days", async () => {
    const recent = new Date(Date.now() - 5 * 86400000).toISOString();
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, mkDb({ id: 1, last_seen: recent }), fakeLogger)).data[0].ad_status).toBe("Active");
  });
  it("Inactive when last_seen > 15 days ago", async () => {
    const old = new Date(Date.now() - 30 * 86400000).toISOString();
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, mkDb({ id: 1, last_seen: old }), fakeLogger)).data[0].ad_status).toBe("Inactive");
  });
  it("Inactive when last_seen null", async () => {
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, mkDb({ id: 1, last_seen: null }), fakeLogger)).data[0].ad_status).toBe("Inactive");
  });
});

describe("services/instagram/controllers/adDetailController > call_to_action capitalization", () => {
  it("Title-cases each word", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ id: 1, call_to_action: "shop NOW" }];
      return [];
    })}};
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.data[0].call_to_action).toBe("Shop Now");
  });
});

describe("services/instagram/controllers/adDetailController > ES overlay", () => {
  function adQueryImpl(rows = [{ id: 1, last_seen: new Date().toISOString() }]) {
    let call = 0;
    return async () => {
      call++;
      if (call === 1) return rows;
      return [];
    };
  }

  it("applies full ES overlay", async () => {
    const esHits = { hits: { hits: [{ _source: {
      "instagram_translations.es": "Hola",
      "instagram_ad.likes": 100, "instagram_ad.shares": 5, "instagram_ad.comments": 10,
      "instagram_ad.impression": 1000, "instagram_ad.popularity": 0.9,
      "instagram.averagebudget": 500,
      "instagram_ad_variants.image_brand_logo_exactly": "brand.png",
      "instagram_ad_variants.image_object": "obj.png",
      "instagram_ad_variants.image_celebrity_exactly": "celeb.png",
      "instagram_ad_variants.image_ocr_exactly": "ocr.txt",
      new_nas_image_url: "https://x/nas.png",
      nas_video_url: "https://x/v.mp4",
      "instagram_ad_domain.domain_registered_date": "2020-01-01",
      days_running: 42,
      "instagram_ad_url.url_destination": "url-dest",
      "instagram_ad_outgoing_links.source_url": "src-url",
      "instagram_ad_outgoing_links.redirect_url": "redir",
      "instagram_ad_outgoing_links.final_url": "final",
      "instagram_ad_url.url_redirects": "redirects",
      "instagram_ad_meta_data.destination_url": "dest",
      "instagram.category": "cat",
      "instagram.subCategory": "subcat",
      behaviors: ["b1"], interests: ["i1"],
      confidence_score: 0.8,
      lang_detect: "es",
    }}]}};
    const db = {
      sql: { query: vi.fn(adQueryImpl()) },
      elastic: { indexName: "idx", search: vi.fn(async () => esHits) },
    };
    const out = await getAdDetails(
      { body: { ad_id: "1", language: "es" }, query: {} }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(out.data[0]["instagram_translations.es"]).toBe("Hola");
    expect(out.data[0].likes).toBe(100);
    expect(out.data[0].share).toBe(5);
    expect(out.data[0].comment).toBe(10);
    expect(out.data[0].impression).toBe(1000);
    expect(out.data[0].popularity).toBe(0.9);
    expect(out.data[0].averageBudget).toBe(500);
    expect(out.data[0].image_brand).toBe("brand.png");
    expect(out.data[0].image_object).toBe("obj.png");
    expect(out.data[0].image_celeb).toBe("celeb.png");
    expect(out.data[0].image_ocr).toBe("ocr.txt");
    expect(out.data[0].image_video_url).toBe("https://x/nas.png");
    expect(out.data[0].nas_video_url).toBe("https://x/v.mp4");
    expect(out.data[0].domain_registered_date).toBe("2020-01-01");
    expect(out.data[0].days_running).toBe(42);
    expect(out.data[0].ad_category).toBe("cat");
    expect(out.data[0].subCategory).toBe("subcat");
    expect(out.data[0].behaviours).toEqual(["b1"]);
    expect(out.data[0].interests).toEqual(["i1"]);
    expect(out.data[0].confidence_score).toBe(0.8);
    expect(out.data[0].language).toBe("Spanish");
    expect(out.data[0].market_platform_urls.source_url).toBe("src-url");
  });

  it("ES body.hits fallback", async () => {
    const db = {
      sql: { query: vi.fn(adQueryImpl()) },
      elastic: { indexName: "idx", search: vi.fn(async () => ({ body: { hits: { hits: [{ _source: { "instagram.category": "cat" } }] } } })) },
    };
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).data[0].ad_category).toBe("cat");
  });

  it("ES with 0 hits leaves adData unchanged", async () => {
    const db = {
      sql: { query: vi.fn(adQueryImpl()) },
      elastic: { indexName: "idx", search: vi.fn(async () => ({ hits: { hits: [] } })) },
    };
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).data[0].image_brand).toBeUndefined();
  });

  it("ES throws → logger.warn", async () => {
    const db = {
      sql: { query: vi.fn(adQueryImpl()) },
      elastic: { indexName: "idx", search: vi.fn(async () => { throw new Error("es-down"); }) },
    };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(fakeLogger.warn).toHaveBeenCalledWith("ES overlay failed, continuing with SQL data only", { error: "es-down" });
  });

  it("language='en' → no translation applied", async () => {
    const db = {
      sql: { query: vi.fn(adQueryImpl()) },
      elastic: { indexName: "idx", search: vi.fn(async () => ({ hits: { hits: [{ _source: { "instagram_translations.en": "ignored" } }] } })) },
    };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.data[0]["instagram_translations.en"]).toBeUndefined();
  });

  it("language requested but key missing → branch skipped", async () => {
    const db = {
      sql: { query: vi.fn(adQueryImpl()) },
      elastic: { indexName: "idx", search: vi.fn(async () => ({ hits: { hits: [{ _source: {} }] } })) },
    };
    const out = await getAdDetails({ body: { ad_id: "1", language: "es" }, query: {} }, db, fakeLogger);
    expect(out.data[0]["instagram_translations.es"]).toBeUndefined();
  });

  it("platform === 15 → LCS skipped", async () => {
    const db = {
      sql: { query: vi.fn(adQueryImpl([{ id: 1, last_seen: null, likes: 1 }])) },
      elastic: { indexName: "idx", search: vi.fn(async () => ({ hits: { hits: [{ _source: { "instagram_ad.platform": 15, "instagram_ad.likes": 999 } }] } })) },
    };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.data[0].likes).toBe(1);
  });

  it("ES src without lang_detect → getLanguageMap not called", async () => {
    const db = {
      sql: { query: vi.fn(adQueryImpl()) },
      elastic: { indexName: "idx", search: vi.fn(async () => ({ hits: { hits: [{ _source: {} }] } })) },
    };
    await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(getLanguageMap).not.toHaveBeenCalled();
  });

  it("market_platform_urls all null when source has none", async () => {
    const db = {
      sql: { query: vi.fn(adQueryImpl()) },
      elastic: { indexName: "idx", search: vi.fn(async () => ({ hits: { hits: [{ _source: {} }] } })) },
    };
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.data[0].market_platform_urls).toEqual({
      url_destination: null, source_url: null, redirect_url: null, final_url: null,
      url_redirects: null, destination_url: null,
    });
  });
});

describe("services/instagram/controllers/adDetailController > country resolution", () => {
  it("country_iso applies fixCountryIso (Czechia)", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ id: 1, last_seen: null }];
      if (call === 2) return [{ country: "Czechia", instagram_ad_id: 1, iso: null }];
      return [];
    })}};
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.data[0].country_iso[0]).toEqual({ country: "Czechia", instagram_ad_id: 1, iso: "CZ" });
  });
  it("Russia → RU fixup", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ id: 1, last_seen: null }];
      if (call === 2) return [{ country: "Russia", instagram_ad_id: 1, iso: null }];
      return [];
    })}};
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).data[0].country_iso[0].iso).toBe("RU");
  });
  it("DR Congo → CD fixup", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ id: 1, last_seen: null }];
      if (call === 2) return [{ country: "DR Congo", instagram_ad_id: 1, iso: "XX" }];
      return [];
    })}};
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).data[0].country_iso[0].iso).toBe("CD");
  });
  it("congo with iso='null' string → CD fixup", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ id: 1, last_seen: null }];
      if (call === 2) return [{ country: "Republic of Congo", instagram_ad_id: 1, iso: "null" }];
      return [];
    })}};
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).data[0].country_iso[0].iso).toBe("CD");
  });
  it("country null preserved (no title-case)", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ id: 1, last_seen: null }];
      if (call === 2) return [{ country: null, instagram_ad_id: 1, iso: "US" }];
      return [];
    })}};
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).data[0].country_iso[0].country).toBeNull();
  });
  it("country_iso swallows error → []", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ id: 1, last_seen: null }];
      if (call === 2) throw new Error("iso-fail");
      return [];
    })}};
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger);
    expect(out.data[0].country_iso).toEqual([]);
    expect(fakeLogger.warn).toHaveBeenCalledWith("Country ISO query failed", { error: "iso-fail" });
  });
  it("country_iso returns null → []", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ id: 1, last_seen: null }];
      if (call === 2) return null;
      return [];
    })}};
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).data[0].country_iso).toEqual([]);
  });
  it("single code, single-pipe separator", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async (sql, params) => {
      call++;
      if (call === 1) return [{ id: 1, country_code: "US", last_seen: null }];
      if (call === 2) return [];
      if (params[0] === "US") return [{ name: "United States" }];
      return [];
    })}};
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).country).toEqual(["United States"]);
  });
  it("multiple codes double-pipe + dedup", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async (sql, params) => {
      call++;
      if (call === 1) return [{ id: 1, country_code: "US||IN||US", last_seen: null }];
      if (call === 2) return [];
      if (params[0] === "US") return [{ name: "United States" }];
      if (params[0] === "IN") return [{ name: "India" }];
      return [];
    })}};
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).country).toEqual(["United States", "India"]);
  });
  it("country name lookup throws → swallowed", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ id: 1, country_code: "US", last_seen: null }];
      if (call === 2) return [];
      throw new Error("name-fail");
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
    let call = 0;
    const db = { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [{ id: 1, last_seen: null }];
      return [];
    })}};
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).country).toEqual([]);
  });
  it("empty entries from split filtered out", async () => {
    let call = 0;
    const db = { sql: { query: vi.fn(async (sql, params) => {
      call++;
      if (call === 1) return [{ id: 1, country_code: "||US||", last_seen: null }];
      if (call === 2) return [];
      if (params[0] === "US") return [{ name: "United States" }];
      return [];
    })}};
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, db, fakeLogger)).country).toEqual(["United States"]);
  });
});

describe("services/instagram/controllers/adDetailController > built-with API", () => {
  function mkDb({ adRow }) {
    let call = 0;
    return { sql: { query: vi.fn(async () => {
      call++;
      if (call === 1) return [adRow];
      return [];
    })}};
  }
  it("default 501 when no domain", async () => {
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, mkDb({ adRow: { id: 1, last_seen: null } }), fakeLogger)).builtwithStatusCode).toBe(501);
  });
  it("default 501 when domain='null'", async () => {
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, mkDb({ adRow: { id: 1, last_seen: null, domain: "null" } }), fakeLogger)).builtwithStatusCode).toBe(501);
  });
  it("default 501 when no env URL", async () => {
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, mkDb({ adRow: { id: 1, last_seen: null, domain: "x.com" } }), fakeLogger)).builtwithStatusCode).toBe(501);
  });
  it("fetches when URL set + domain present", async () => {
    process.env.API_URL_BUILTWITH = "http://bw.local";
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ code: 200 }) })));
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, mkDb({ adRow: { id: 1, last_seen: null, domain: "x.com" } }), fakeLogger)).builtwithStatusCode).toBe(200);
  });
  it("API returns no code → defaults to 501", async () => {
    process.env.API_URL_BUILTWITH = "http://bw.local";
    vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({}) })));
    expect((await getAdDetails({ body: { ad_id: "1" }, query: {} }, mkDb({ adRow: { id: 1, last_seen: null, domain: "x.com" } }), fakeLogger)).builtwithStatusCode).toBe(501);
  });
  it("fetch throws → logger.warn", async () => {
    process.env.API_URL_BUILTWITH = "http://bw.local";
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("bw-down"); }));
    const out = await getAdDetails({ body: { ad_id: "1" }, query: {} }, mkDb({ adRow: { id: 1, last_seen: null, domain: "x.com" } }), fakeLogger);
    expect(out.builtwithStatusCode).toBe(501);
    expect(fakeLogger.warn).toHaveBeenCalledWith("Built-with API call failed", { error: "bw-down" });
  });
});
