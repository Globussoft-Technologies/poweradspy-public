import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── Mock GoogleSearchQueryBuilder ──────────────
const builderPath = require.resolve("../../../../src/services/google/builders/GoogleSearchQueryBuilder");
const builderCalls = [];
function FakeBuilder(indexName) {
  builderCalls.push({ ctor: indexName, calls: [] });
  const self = this;
  const last = builderCalls[builderCalls.length - 1];
  const fluent = (name) => function (...args) { last.calls.push([name, args]); return self; };
  for (const k of [
    "setFrom","setSize","setSortField","setSortMethod","setIpBasedCountry",
    "setKeyword","setExactSearch","setPostOwnerName","setUrl","setCallToAction","setAdCategory","setSubCategory","setCountry",
    "setState","setCity","setAdType","setTargetKeyword","setTags","setLangDetect","setAdPosition",
    "setAdSubPosition","setGender","setLowerAgeSeen","setLastSeen","setPostDate","setDomainDate","setCountryDelivery",
    "setBuiltWith","setTrack","setSource","setFunnel","setAffiliate","setMarketPlatform",
    "setHtmlContent","setNeedle","setAdDetailId","setNotCountry",
  ]) self[k] = fluent(k);
  self.build = vi.fn(() => ({ body: { from: 0, size: 20, query: { match_all: {} } } }));
}
require.cache[builderPath] = {
  id: builderPath, filename: builderPath, loaded: true, exports: FakeBuilder,
};

// ── Mock paramParser ──────────────
const paramsPath = require.resolve("../../../../src/services/google/helpers/paramParser");
const normalizeParams = vi.fn((raw) => raw);
const ensureArray = vi.fn((v) => Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]));
let parsePaginationImpl = () => ({ size: 20, from: 0 });
const parsePagination = vi.fn((...args) => parsePaginationImpl(...args));
const parseSort = vi.fn(() => ({ field: "google_ad.last_seen", order: "desc" }));
const parseCountryDeliveryFilters = vi.fn(() => null);
const cleanAdsData = vi.fn((rows) => rows);
require.cache[paramsPath] = {
  id: paramsPath, filename: paramsPath, loaded: true,
  exports: { normalizeParams, ensureArray, parsePagination, parseSort, parseCountryDeliveryFilters, cleanAdsData },
};

// ── Mock searchCursorCache ──────────────
const cursorPath = require.resolve("../../../../src/utils/searchCursorCache");
const buildQueryHash = vi.fn(() => "qhash");
const saveCursor = vi.fn();
const getCursor = vi.fn();
require.cache[cursorPath] = {
  id: cursorPath, filename: cursorPath, loaded: true,
  exports: { SAFE_FROM: 9000, buildQueryHash, saveCursor, getCursor },
};

const { getTopAds } = require(
  "../../../../src/services/google/controllers/getTopAdsController"
);

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };

beforeEach(() => {
  builderCalls.length = 0;
  parsePaginationImpl = () => ({ size: 20, from: 0 });
  normalizeParams.mockClear().mockImplementation((raw) => raw);
  ensureArray.mockClear().mockImplementation((v) => Array.isArray(v) ? v : (v == null || v === "" ? [] : [v]));
  parsePagination.mockClear();
  parseSort.mockClear().mockImplementation(() => ({ field: "google_ad.last_seen", order: "desc" }));
  parseCountryDeliveryFilters.mockClear().mockReturnValue(null);
  cleanAdsData.mockClear().mockImplementation((rows) => rows);
  buildQueryHash.mockClear().mockImplementation(() => "qhash");
  saveCursor.mockClear();
  getCursor.mockClear();
  fakeLogger.info.mockClear(); fakeLogger.warn.mockClear(); fakeLogger.error.mockClear();
});

describe("services/google/controllers/getTopAdsController > validation", () => {
  it("400 when user_id missing", async () => {
    expect(await getTopAds({ body: {}, query: {} }, {}, fakeLogger))
      .toEqual({ code: 400, message: "Missing params: user_id is required" });
  });
  it("503 when elastic missing", async () => {
    expect(await getTopAds({ body: { user_id: "u" }, query: {} }, { elastic: null }, fakeLogger))
      .toEqual({ code: 503, message: "Elasticsearch connection not available" });
  });
});

describe("services/google/controllers/getTopAdsController > setter routing", () => {
  function setterNames() {
    return builderCalls[0].calls.map(c => c[0]);
  }
  async function run(body, hits = []) {
    const db = { elastic: { indexName: "idx", search: vi.fn(async () => ({ hits: { hits, total: hits.length } })) } };
    await getTopAds({ body, query: {} }, db, fakeLogger);
    return db;
  }

  it("calls all common setters with truthy + array values", async () => {
    await run({
      user_id: "u",
      keyword: "kw", advertiser: "adv", domain: "d.com",
      call_to_action: ["BUY"], adcategory: ["c"], subCategory: ["sc"],
      country: ["US"], state: ["CA"], city: ["LA"],
      type: ["text"], target_keywords: ["tk"], tags: ["t"], lang: ["en"],
      ad_position: ["1"], ad_sub_position: ["a"], gender: ["m"],
      lower_age: 18, upper_age: 30,
      seen_btn_sort: ["2024-01-01", "2024-12-31"],
      post_date_btn_sort: ["2024-01-01", "2024-12-31"],
      domain_date_btn_sort: ["2024-01-01", "2024-12-31"],
      ecommerce: ["e"], track: ["t"], source: ["s"], funnel: ["f"],
      affiliate: ["a"], market_platform: ["m"],
      html_content: "h", needle: "n", similar_ad_id: "sid", not_country: "X",
      ipBasedCountry: "IN",
    });
    const names = setterNames();
    expect(names).toEqual(expect.arrayContaining([
      "setFrom","setSize","setSortField","setSortMethod","setIpBasedCountry",
      "setKeyword","setPostOwnerName","setUrl","setCallToAction","setAdCategory","setSubCategory",
      "setCountry","setState","setCity","setAdType","setTargetKeyword","setTags","setLangDetect",
      "setAdPosition","setAdSubPosition","setGender","setLowerAgeSeen",
      "setLastSeen","setPostDate","setDomainDate",
      "setBuiltWith","setTrack","setSource","setFunnel","setAffiliate","setMarketPlatform",
      "setHtmlContent","setNeedle","setAdDetailId","setNotCountry",
    ]));
  });

  it("fallback alias setters: advertisername/domainname/callToAction/subposition/position/adDetail_id/html_feild", async () => {
    await run({
      user_id: "u",
      advertisername: "adv",
      domainname: "d.com",
      callToAction: ["BUY"],
      position: ["1"],
      subposition: ["b"],
      adDetail_id: "sid",
      html_feild: "h",
    });
    const names = setterNames();
    expect(names).toContain("setPostOwnerName");
    expect(names).toContain("setUrl");
    expect(names).toContain("setCallToAction");
    expect(names).toContain("setAdPosition");
    expect(names).toContain("setAdSubPosition");
    expect(names).toContain("setAdDetailId");
    expect(names).toContain("setHtmlContent");
  });

  it("ipBasedCountry default 'NA' when missing", async () => {
    await run({ user_id: "u" });
    const setIp = builderCalls[0].calls.find(c => c[0] === "setIpBasedCountry");
    expect(setIp[1]).toEqual(["NA"]);
  });

  it("only lower_age without upper_age → setLowerAgeSeen NOT called", async () => {
    await run({ user_id: "u", lower_age: 18 });
    expect(setterNames()).not.toContain("setLowerAgeSeen");
  });

  it("ad_position empty array → setAdPosition NOT called", async () => {
    await run({ user_id: "u", ad_position: [] });
    expect(setterNames()).not.toContain("setAdPosition");
  });

  it("seen_btn_sort wrong length → setLastSeen NOT called", async () => {
    await run({ user_id: "u", seen_btn_sort: ["2024-01-01"] });
    expect(setterNames()).not.toContain("setLastSeen");
  });
});

describe("services/google/controllers/getTopAdsController > cursor / pagination", () => {
  it("from >= SAFE_FROM with cursor present → search_after applied", async () => {
    parsePaginationImpl = () => ({ size: 20, from: 9000 });
    getCursor.mockReturnValueOnce([1, 2, 3]);
    const search = vi.fn(async (params) => {
      expect(params.body.search_after).toEqual([1, 2, 3]);
      expect(params.body.from).toBeUndefined();
      return { hits: { hits: [], total: 0 } };
    });
    const db = { elastic: { indexName: "idx", search } };
    await getTopAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(search).toHaveBeenCalled();
  });
  it("from >= SAFE_FROM with no cursor → from clamped to SAFE_FROM - size", async () => {
    parsePaginationImpl = () => ({ size: 20, from: 9500 });
    getCursor.mockReturnValueOnce(null);
    const search = vi.fn(async (params) => {
      expect(params.body.from).toBe(8980);
      return { hits: { hits: [], total: 0 } };
    });
    const db = { elastic: { indexName: "idx", search } };
    await getTopAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
  });
  it("from >= SAFE_FROM with size > SAFE_FROM → Math.max clamps to 0", async () => {
    parsePaginationImpl = () => ({ size: 20000, from: 9000 });
    getCursor.mockReturnValueOnce(null);
    const search = vi.fn(async (params) => {
      expect(params.body.from).toBe(0);
      return { hits: { hits: [], total: 0 } };
    });
    const db = { elastic: { indexName: "idx", search } };
    await getTopAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
  });
});

describe("services/google/controllers/getTopAdsController > result paths", () => {
  it("hits.total as object → uses .value", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [], total: { value: 42 } } }));
    const db = { elastic: { indexName: "idx", search } };
    const out = await getTopAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out).toEqual({ code: 200, data: [], total: 42, message: "No ads found" });
  });

  it("hits.total as number → used directly", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [], total: 9 } }));
    const db = { elastic: { indexName: "idx", search } };
    const out = await getTopAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.total).toBe(9);
  });

  it("body.hits fallback shape", async () => {
    const search = vi.fn(async () => ({ body: { hits: { hits: [], total: 0 } } }));
    const db = { elastic: { indexName: "idx", search } };
    const out = await getTopAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
  });

  it("200 with SQL overlay applied (image_url + country array join)", async () => {
    const search = vi.fn(async () => ({
      hits: {
        hits: [
          { _source: { id: 1, new_nas_image_url: "https://nas/1.png", country: ["US", "IN"] } },
          { _source: { ad_id: 2 } },
        ],
        total: 2,
      },
    }));
    const sqlQuery = vi.fn(async () => [
      { ad_id: 1, image_video_url: "stale.png" },
      { ad_id: 2, image_video_url: "stale2.png" },
      { ad_id: 1, image_video_url: "dupe.png" }, // dedupe
    ]);
    const db = { elastic: { indexName: "idx", search }, sql: { query: sqlQuery } };
    const out = await getTopAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data).toHaveLength(2);
    expect(out.data[0].image_video_url).toBe("https://nas/1.png");
    expect(out.data[0].country).toBe("US, IN");
  });

  it("country as string (not array) → preserved as string", async () => {
    const search = vi.fn(async () => ({
      hits: { hits: [{ _source: { id: 5, country: "FR" } }], total: 1 },
    }));
    const sqlQuery = vi.fn(async () => [{ ad_id: 5 }]);
    const db = { elastic: { indexName: "idx", search }, sql: { query: sqlQuery } };
    const out = await getTopAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.data[0].country).toBe("FR");
  });

  it("SQL row has no matching esHit → row passed through unchanged", async () => {
    const search = vi.fn(async () => ({
      hits: { hits: [{ _source: { id: 1 } }], total: 1 },
    }));
    const sqlQuery = vi.fn(async () => [{ ad_id: 999 }]); // not in esMap
    const db = { elastic: { indexName: "idx", search }, sql: { query: sqlQuery } };
    const out = await getTopAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.data[0]).toEqual({ ad_id: 999 });
  });

  it("SQL throw → falls back to ES (logger.warn)", async () => {
    const search = vi.fn(async () => ({
      hits: { hits: [{ _source: { id: 1, title: "t" } }], total: 1 },
    }));
    const sqlQuery = vi.fn(async () => { throw new Error("sql-down"); });
    const db = { elastic: { indexName: "idx", search }, sql: { query: sqlQuery } };
    const out = await getTopAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data[0].id).toBe(1);
    expect(out.data[0].ad_id).toBe(1);
    expect(fakeLogger.warn).toHaveBeenCalled();
  });

  it("no db.sql → ES-only response", async () => {
    const search = vi.fn(async () => ({
      hits: { hits: [{ _source: { id: 7, title: "t" } }, { _source: { ad_id: 8 } }, { _id: "9", _source: {} }], total: 3 },
    }));
    const db = { elastic: { indexName: "idx", search } };
    const out = await getTopAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.data[0].id).toBe(7);
    expect(out.data[1].id).toBe(8);
    expect(out.data[2].id).toBe("9");
  });

  it("SQL overlay: esHit missing _source → keys off _id, src defaults to {}", async () => {
    const search = vi.fn(async () => ({
      hits: { hits: [{ _id: "1" }], total: 1 }, // no _source at all
    }));
    const sqlQuery = vi.fn(async () => [{ ad_id: 1 }]); // matches String(_id)
    const db = { elastic: { indexName: "idx", search }, sql: { query: sqlQuery } };
    const out = await getTopAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data[0]).toEqual({ ad_id: 1 }); // src {} → no overlay applied
  });

  it("SQL throw: hit missing _source → ES fallback defaults src to {}", async () => {
    const search = vi.fn(async () => ({
      hits: { hits: [{ _id: "5" }], total: 1 }, // no _source
    }));
    const sqlQuery = vi.fn(async () => { throw new Error("sql-down"); });
    const db = { elastic: { indexName: "idx", search }, sql: { query: sqlQuery } };
    const out = await getTopAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(out.data[0].id).toBe("5");
    expect(out.data[0].ad_id).toBe("5");
    expect(fakeLogger.warn).toHaveBeenCalled();
  });

  it("no db.sql: hit missing _source → src defaults to {}, uses _id", async () => {
    const search = vi.fn(async () => ({
      hits: { hits: [{ _id: "42" }], total: 1 }, // no _source
    }));
    const db = { elastic: { indexName: "idx", search } };
    const out = await getTopAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.data[0].id).toBe("42");
    expect(out.data[0].ad_id).toBe("42");
  });

  it("hits.hits missing → defaults to [] (No ads found)", async () => {
    const search = vi.fn(async () => ({ hits: { total: 0 } })); // no .hits array
    const db = { elastic: { indexName: "idx", search } };
    const out = await getTopAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out).toEqual({ code: 200, data: [], total: 0, message: "No ads found" });
  });

  it("db.elastic without indexName → lander index falls back to default", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [], total: 0 } }));
    const db = { elastic: { search } }; // no indexName → '' falls back to 'google_ads_data_v2'
    const out = await getTopAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(200);
  });

  it("500 on ES throw", async () => {
    const search = vi.fn(async () => { throw new Error("es-down"); });
    const db = { elastic: { indexName: "idx", search } };
    const out = await getTopAds({ body: { user_id: "u" }, query: {} }, db, fakeLogger);
    expect(out.code).toBe(500);
    expect(out.error).toBe("es-down");
    expect(fakeLogger.error).toHaveBeenCalled();
  });

});
