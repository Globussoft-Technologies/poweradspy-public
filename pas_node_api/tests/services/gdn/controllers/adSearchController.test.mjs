import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── Mock SearchMixQueryBuilder ─────────────────────────────────────────────
const builderPath = require.resolve("../../../../src/services/gdn/builders/SearchMixQueryBuilder");
const builderCalls = [];
function FakeBuilder(indexName) {
  builderCalls.push({ ctor: indexName, calls: [] });
  const self = this;
  const last = builderCalls[builderCalls.length - 1];
  const fluent = (name) => function (...args) { last.calls.push([name, args]); return self; };
  for (const k of [
    "setFrom","setSize","setSortField","setSortMethod","setIpBasedCountry","setStatus",
    "setKeyword","setPostOwnerName","setUrl","setCallToAction","setAdCategory","setSubCategory",
    "setTags","setTargetKeyword","setCountry","setAdType","setLangDetect","setGender",
    "setAdPosition","setAdSubPosition","setLowerAgeSeen","setLastSeen","setPostDate","setDomainDate",
    "setBuiltWith","setSource","setFunnel","setAffiliate","setMarketPlatform",
    "setHtmlContent","setNeedle","setNotCountry","setAdDetailId",
    "setOcr","setCelebrity","setLogo","setImageObject","setAdImageSize",
  ]) self[k] = fluent(k);
  self.build = vi.fn(() => ({ body: { from: 0, size: 20, query: { match_all: {} } } }));
}
require.cache[builderPath] = {
  id: builderPath, filename: builderPath, loaded: true, exports: FakeBuilder,
};

// ── Mock paramParser ───────────────────────────────────────────────────────
const paramsPath = require.resolve("../../../../src/services/gdn/helpers/paramParser");
const normalizeParams = vi.fn((raw) => raw);
const ensureArray = vi.fn((v) => Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]));
const parsePagination = vi.fn(() => ({ size: 20, from: 0 }));
const parseSort = vi.fn(() => ({ field: "gdn_ad.last_seen", order: "desc" }));
const cleanAdsData = vi.fn((rows) => rows);
require.cache[paramsPath] = {
  id: paramsPath, filename: paramsPath, loaded: true,
  exports: { normalizeParams, ensureArray, parsePagination, parseSort, cleanAdsData },
};

// ── Mock searchCursorCache ─────────────────────────────────────────────────
const cursorPath = require.resolve("../../../../src/utils/searchCursorCache");
const buildQueryHash = vi.fn(() => "qhash");
const saveCursor = vi.fn();
const getCursor = vi.fn();
require.cache[cursorPath] = {
  id: cursorPath, filename: cursorPath, loaded: true,
  exports: { SAFE_FROM: 9000, buildQueryHash, saveCursor, getCursor },
};

const { searchAds } = require(
  "../../../../src/services/gdn/controllers/adSearchController"
);

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

beforeEach(() => {
  builderCalls.length = 0;
  normalizeParams.mockClear().mockImplementation((raw) => raw);
  ensureArray.mockClear().mockImplementation((v) => Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]));
  parsePagination.mockClear().mockImplementation(() => ({ size: 20, from: 0 }));
  parseSort.mockClear().mockImplementation(() => ({ field: "gdn_ad.last_seen", order: "desc" }));
  cleanAdsData.mockClear().mockImplementation((rows) => rows);
  buildQueryHash.mockClear().mockImplementation(() => "qhash");
  saveCursor.mockClear();
  getCursor.mockClear();
  fakeLogger.info.mockClear(); fakeLogger.warn.mockClear(); fakeLogger.error.mockClear();
});

describe("services/gdn/controllers/adSearchController > routing", () => {
  it("400 when user_id missing", async () => {
    expect(await searchAds({ body: {}, query: {} }, {}, fakeLogger))
      .toEqual({ code: 400, message: "Missing params: user_id is required" });
  });
  it("favorite='true' routes to searchFavoriteAds", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect((await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger)).message).toBe("No favorite ads found");
  });
  it("hiddenads='true' routes to searchHiddenAds", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect((await searchAds({ body: { user_id: "u", hidden: "true" }, query: {} }, db, fakeLogger)).message).toBe("No hidden ads found");
  });
  it("503 when db.elastic missing (regular search)", async () => {
    expect(await searchAds({ body: { user_id: "u" }, query: {} }, { elastic: null }, fakeLogger))
      .toEqual({ code: 503, message: "Elasticsearch connection not available" });
  });
});

describe("services/gdn/controllers/adSearchController > searchFavoriteAds", () => {
  it("503 when sql missing", async () => {
    expect((await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, { sql: null }, fakeLogger)).code).toBe(503);
  });
  it("no favorites → empty", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect(await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger))
      .toEqual({ code: 200, data: [], total: 0, message: "No favorite ads found" });
  });
  it("happy path returns ads", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [{ ad_id: 1 }];
        return [{ ad_id: 1, type: "TEXT" }];
      })},
    };
    const out = await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data).toHaveLength(1);
  });
  it("enrichAndFilterRows: drops IMAGE without PowerAdspy, keeps text + ones w/ PowerAdspy", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [{ ad_id: 1 }, { ad_id: 2 }, { ad_id: 3 }];
        // gdn SQL aliases gdn_ad.id AS id (no ad_id), so production enrich
        // effectively can't lookup ES — only row.type guides IMAGE drop.
        // Providing both id+ad_id here to exercise the full ES-overlay code path.
        return [
          { id: 1, ad_id: 1, type: "IMAGE" },
          { id: 2, ad_id: 2, type: "IMAGE" },
          { id: 3, ad_id: 3, type: "TEXT" },
        ];
      })},
      elastic: {
        indexName: "gdn",
        search: vi.fn(async () => ({ hits: { hits: [
          { _source: { "gdn_ad.id": 1, new_nas_image_url: "https://x/PowerAdspy/i.png" } },
          { _source: { "gdn_ad.id": 2 } },
          { _source: { "gdn_ad.id": 3 } },
        ]}})),
      },
    };
    const out = await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger);
    expect(out.data.map(d => d.ad_id)).toEqual([1, 3]);
  });
  it("500 when SQL throws", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("sql-fail"); }) } };
    expect((await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger)).code).toBe(500);
  });
  it("enrichAndFilterRows: ES returns body.hits shape (line 107 right operand)", async () => {
    let sqlCall = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        sqlCall++;
        if (sqlCall === 1) return [{ ad_id: 1 }];
        return [{ id: 1, ad_id: 1, type: "IMAGE" }];
      })},
      elastic: {
        indexName: "gdn",
        search: vi.fn(async () => ({
          body: { hits: { hits: [
            { _source: { "gdn_ad.id": 1, new_nas_image_url: "https://x/nas.png" } },
          ]}}
        })),
      },
    };
    const out = await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger);
    expect(out.data.map(d => d.ad_id)).toEqual([1]);
  });
  it("dedupeRows drops duplicate id rows (line 54)", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [{ ad_id: 1 }, { ad_id: 2 }];
        return [
          { id: 1, ad_id: 1, type: "TEXT" },
          { id: 1, ad_id: 1, type: "TEXT" }, // duplicate id
          { id: 2, ad_id: 2, type: "TEXT" },
        ];
      })},
      elastic: { indexName: "gdn", search: vi.fn(async () => ({ hits: { hits: [] } })) },
    };
    const out = await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger);
    expect(out.data.map(d => d.id)).toEqual([1, 2]);
  });
  it("enrichAndFilterRows: ES throws → catch returns original rows (line 125)", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [{ ad_id: 1 }, { ad_id: 2 }];
        return [
          { id: 1, ad_id: 1, type: "IMAGE" },
          { id: 2, ad_id: 2, type: "TEXT" },
        ];
      })},
      elastic: { indexName: "gdn", search: vi.fn(async () => { throw new Error("es-down"); }) },
    };
    const out = await searchAds({ body: { user_id: "u", favorite: "true" }, query: {} }, db, fakeLogger);
    expect(out.data.map(d => d.ad_id)).toEqual([1, 2]);
  });
});

describe("services/gdn/controllers/adSearchController > searchHiddenAds", () => {
  it("503 when sql missing", async () => {
    expect((await searchAds({ body: { user_id: "u", hidden: "true" }, query: {} }, { sql: null }, fakeLogger)).code).toBe(503);
  });
  it("no hidden → empty", async () => {
    const db = { sql: { query: vi.fn(async () => []) } };
    expect(await searchAds({ body: { user_id: "u", hidden: "true" }, query: {} }, db, fakeLogger))
      .toEqual({ code: 200, data: [], total: 0, message: "No hidden ads found" });
  });
  it("rows without ad_id filtered out → empty", async () => {
    const db = { sql: { query: vi.fn(async () => [{ post_owner_id: "po", type: 1 }]) } };
    expect((await searchAds({ body: { user_id: "u", hidden: "true" }, query: {} }, db, fakeLogger)).total).toBe(0);
  });
  it("happy path attaches hideType + hiddenPostOwnerId", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [
          { ad_id: 1, post_owner_id: "po1", type: 1 },
          { ad_id: 2, post_owner_id: null, type: 2 },
        ];
        // gdn dedupeRows uses r.id; need distinct id per row to keep both.
        return [{ id: 1, ad_id: 1, type: "TEXT" }, { id: 2, ad_id: 2, type: "TEXT" }];
      })},
    };
    const out = await searchAds({ body: { user_id: "u", hidden: "true" }, query: {} }, db, fakeLogger);
    expect(out.data[0].hideType).toBe(1);
    expect(out.data[0].hiddenPostOwnerId).toBe("po1");
    expect(out.data[1].hideType).toBe(2);
  });
  it("ads without meta default to hideType=2", async () => {
    let call = 0;
    const db = {
      sql: { query: vi.fn(async () => {
        call++;
        if (call === 1) return [{ ad_id: 1, post_owner_id: null, type: 1 }];
        return [{ id: 99, ad_id: 99, type: "TEXT" }];
      })},
    };
    expect((await searchAds({ body: { user_id: "u", hidden: "true" }, query: {} }, db, fakeLogger)).data[0].hideType).toBe(2);
  });
  it("500 when SQL throws", async () => {
    const db = { sql: { query: vi.fn(async () => { throw new Error("sql-fail"); }) } };
    expect((await searchAds({ body: { user_id: "u", hidden: "true" }, query: {} }, db, fakeLogger)).code).toBe(500);
  });
});

describe("services/gdn/controllers/adSearchController > regular searchAds", () => {
  function mkEsHits(hits, total = hits.length) {
    return { hits: { hits, total: { value: total } } };
  }

  it("happy path: ES hits → SQL enrich + NAS image overlay + country merge", async () => {
    const esHits = [
      { _source: { "gdn_ad.id": 1, new_nas_image_url: "https://x/nas.png",
                   "gdn_country_only.country": "US",
                   "gdn_ad_url.url_destination": "ud",
                   "gdn_ad_outgoing_links.source_url": "src" } },
    ];
    const db = {
      elastic: { indexName: "gdn", search: vi.fn(async () => mkEsHits(esHits)) },
      sql: { query: vi.fn(async () => [{ id: 1, ad_id: 1, type: "TEXT" }]) },
    };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data[0].image_video_url).toBe("https://x/nas.png");
    expect(out.data[0].country).toBe("US");
    expect(out.data[0].market_platform_urls.source_url).toBe("src");
  });

  it("0 hits → No ads found", async () => {
    const db = { elastic: { search: vi.fn(async () => mkEsHits([])) } };
    expect((await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger)).message).toBe("No ads found");
  });

  it("body.hits fallback + total as number", async () => {
    const db = {
      elastic: { search: vi.fn(async () => ({ body: { hits: { hits: [{ _source: { "gdn_ad.id": 1 } }], total: 1 } } })) },
    };
    expect((await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger)).total).toBe(1);
  });

  it("nested gdn_ad.id format also works", async () => {
    const esHits = [{ _source: { gdn_ad: { id: 7 } } }];
    const db = {
      elastic: { search: vi.fn(async () => mkEsHits(esHits)) },
      sql: { query: vi.fn(async () => [{ id: 7, ad_id: 7 }]) },
    };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
  });

  it("SQL fetch failure → falls back to normalizeEsSource", async () => {
    const esHits = [{ _source: {
      "gdn_ad.id": 1, "gdn_ad.type": "IMAGE", "gdn_ad.source": "fb",
      "gdn_ad.post_owner_id": 5, "gdn_ad.ad_position": "TOP",
      "gdn_ad_post_owners.post_owner_name": "Brand",
      "gdn_ad_variants.title": "Sale", new_nas_image_url: "https://x/nas.png",
    }}];
    const db = {
      elastic: { search: vi.fn(async () => mkEsHits(esHits)) },
      sql: { query: vi.fn(async () => { throw new Error("sql-fail"); }) },
    };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data[0].ad_title).toBe("Sale");
    expect(out.data[0].image_video_url).toBe("https://x/nas.png");
    expect(fakeLogger.warn).toHaveBeenCalled();
  });

  it("no db.sql → uses normalizeEsSource directly", async () => {
    const esHits = [{ _source: {
      "gdn_ad.id": 2, "gdn_ad_variants.image_url": "https://x/v.png",
    }}];
    const db = { elastic: { search: vi.fn(async () => mkEsHits(esHits)) } };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.data[0].image_video_url).toBe("https://x/v.png");
  });

  it("SQL row without matching ES hit returns row unchanged", async () => {
    const esHits = [{ _source: { "gdn_ad.id": 999 } }];
    const db = {
      elastic: { search: vi.fn(async () => mkEsHits(esHits)) },
      sql: { query: vi.fn(async () => [{ id: 1, ad_id: 1 }]) },
    };
    const out = await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.data[0].ad_id).toBe(1);
  });

  it("nested gdn_country_only.country (object form) also merged", async () => {
    const esHits = [{ _source: { "gdn_ad.id": 1, gdn_country_only: { country: "IN" } } }];
    const db = {
      elastic: { search: vi.fn(async () => mkEsHits(esHits)) },
      sql: { query: vi.fn(async () => [{ id: 1, ad_id: 1 }]) },
    };
    expect((await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger)).data[0].country).toBe("IN");
  });

  it("deep page with cached cursor → search_after", async () => {
    parsePagination.mockReturnValue({ size: 20, from: 9000 });
    getCursor.mockReturnValue(["cursor-val"]);
    const db = { elastic: { search: vi.fn(async () => mkEsHits([])) } };
    await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    const esParams = db.elastic.search.mock.calls[0][0];
    expect(esParams.body.search_after).toEqual(["cursor-val"]);
    expect(esParams.body.from).toBeUndefined();
  });

  it("deep page without cached cursor → caps at SAFE_FROM-size", async () => {
    parsePagination.mockReturnValue({ size: 20, from: 9000 });
    getCursor.mockReturnValue(null);
    const db = { elastic: { search: vi.fn(async () => mkEsHits([])) } };
    await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(db.elastic.search.mock.calls[0][0].body.from).toBe(8980);
  });

  it("500 when ES throws", async () => {
    const db = { elastic: { search: vi.fn(async () => { throw new Error("es-down"); }) } };
    expect((await searchAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger)).code).toBe(500);
  });

  it("invokes builder setters for filter params", async () => {
    const db = { elastic: { search: vi.fn(async () => mkEsHits([])) } };
    await searchAds({
      body: {
        user_id: "u",
        status: [1, 2],
        keyword: "k", advertiser: "a", domain: "d.com",
        call_to_action: "Buy", adcategory: "cat", subCategory: "sub",
        tags: "t", target_keyword: "tk",
        country: "US", state: "CA", city: "SF",
        type: "IMAGE", lang: "en",
        ad_position: "FEED", ad_sub_position: "TOP", gender: "M",
        lower_age: "18", upper_age: "65",
        seen_btn_sort: [1700000000, 1600000000],
        post_date_btn_sort: [1700000000, 1600000000],
        domain_date_btn_sort: [1700000000, 1600000000],
        ecommerce: "shopify", source: "src", funnel: "fn", affiliate: "aff", market_platform: "mp",
        ocr: "txt", image_celebrity: "c", image_logo: "l", image_object: "o",
        size: "300x250",
        html_content: "html", needle: "n", not_country: "RU",
        ipBasedCountry: "US",
      },
      query: {},
    }, db, fakeLogger);
    const setters = builderCalls[0].calls.map(c => c[0]);
    expect(setters).toEqual(expect.arrayContaining([
      "setStatus","setKeyword","setPostOwnerName","setUrl","setCallToAction",
      "setAdCategory","setSubCategory","setTags","setTargetKeyword","setCountry",
      "setAdType","setLangDetect","setGender","setAdPosition","setAdSubPosition",
      "setLowerAgeSeen","setLastSeen","setPostDate","setDomainDate",
      "setBuiltWith","setSource","setFunnel","setAffiliate","setMarketPlatform",
      "setHtmlContent","setNeedle","setNotCountry",
      "setOcr","setCelebrity","setLogo","setImageObject","setAdImageSize",
    ]));
  });

  it("status: empty array does not call setStatus", async () => {
    const db = { elastic: { search: vi.fn(async () => mkEsHits([])) } };
    await searchAds({ body: { user_id: "u", status: [] }, query: {} }, db, fakeLogger);
    expect(builderCalls[0].calls.find(c => c[0] === "setStatus")).toBeUndefined();
  });

  it("status: non-array does not call setStatus", async () => {
    const db = { elastic: { search: vi.fn(async () => mkEsHits([])) } };
    await searchAds({ body: { user_id: "u", status: "active" }, query: {} }, db, fakeLogger);
    expect(builderCalls[0].calls.find(c => c[0] === "setStatus")).toBeUndefined();
  });

  it("lower_age without upper_age does not call setLowerAgeSeen", async () => {
    const db = { elastic: { search: vi.fn(async () => mkEsHits([])) } };
    await searchAds({ body: { user_id: "u", lower_age: "18" }, query: {} }, db, fakeLogger);
    expect(builderCalls[0].calls.find(c => c[0] === "setLowerAgeSeen")).toBeUndefined();
  });

  it("empty ad_position skips setAdPosition", async () => {
    ensureArray.mockReturnValueOnce([]);
    const db = { elastic: { search: vi.fn(async () => mkEsHits([])) } };
    await searchAds({ body: { user_id: "u", ad_position: "" }, query: {} }, db, fakeLogger);
    expect(builderCalls[0].calls.find(c => c[0] === "setAdPosition")).toBeUndefined();
  });
});
