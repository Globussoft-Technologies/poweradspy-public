import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const regPath = require.resolve("../../../../src/services/ServiceRegistry");
const serviceRegistry = { getService: vi.fn() };
require.cache[regPath] = {
  id: regPath, filename: regPath, loaded: true, exports: serviceRegistry,
};

const catCtrlPath = require.resolve("../../../../src/services/common/controllers/categoryController");
const syncCategory = vi.fn(async () => {});
require.cache[catCtrlPath] = {
  id: catCtrlPath, filename: catCtrlPath, loaded: true,
  exports: { syncCategory },
};

const config = require("../../../../src/config");
const originalEnv = config.env;

const { getDescriptionDetails, newCatInsertion, getAdCategory, insertAiMeta } = require(
  "../../../../src/services/common/controllers/addCategoryController"
);

const VALID_AI_META = {
  ad_type: "promotional",
  intent: ["conversion"],
  hook: ["social_proof"],
  offering_type: "product",
  offering: "printer parts",
  caption: "A hand holding printer parts against a white background.",
  roa: { intent: "CTA button present.", offering: "Text names the product." },
  colors: ["#FFFFFF", "#C9A227"],
};

function mkRes() {
  const r = { statusCode: 200, body: null };
  r.status = vi.fn((c) => { r.statusCode = c; return r; });
  r.json = vi.fn((b) => { r.body = b; return r; });
  return r;
}

function mkService({ esSearch, esIndex, esUpdate, sql, log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } = {}) {
  return { db: { elastic: { search: esSearch, index: esIndex, update: esUpdate }, sql }, log };
}

beforeEach(() => {
  serviceRegistry.getService.mockReset();
  syncCategory.mockReset().mockResolvedValue();
  config.env = originalEnv;
});

describe("addCategoryController > getDescriptionDetails", () => {
  it("400 for unsupported platform", async () => {
    const res = mkRes();
    await getDescriptionDetails({ query: { platform: "xx" }, body: {} }, res);
    expect(res.statusCode).toBe(400);
  });
  it("400 when platform missing", async () => {
    const res = mkRes();
    await getDescriptionDetails({ query: {}, body: {} }, res);
    expect(res.statusCode).toBe(400);
  });
  it("503 when no ES service", async () => {
    serviceRegistry.getService.mockReturnValue(null);
    const res = mkRes();
    await getDescriptionDetails({ query: { platform: "facebook" }, body: {} }, res);
    expect(res.statusCode).toBe(503);
  });
  it("200 with normalized facebook IMAGE row (destPageField + ocr + ad_image)", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [{ _source: {
      "facebook_ad.id": 1,
      "facebook_ad_variants.text_exactly": "T",
      "facebook_ad_variants.title_exactly": "Title",
      "facebook_ad_post_owners.post_owner_name": "Po",
      "facebook_ad_variants.newsfeed_description_exactly": "NF",
      "facebook_ad_variants.image_ocr_exactly": "OCR",
      "facebook_ad_html_lander_content.html_dc_blackhat_lander_text": "DEST",
      "facebook_ad.type": "IMAGE",
      "new_nas_image_url": "https://x/PowerAdspy/i.png",
    }}]}}));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    const res = mkRes();
    await getDescriptionDetails({ query: { platform: "FACEBOOK", exVal: 5, limit: 50 }, body: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body[0]).toMatchObject({
      id: 1, ad_text: "T", ad_title: "Title", post_owner_name: "Po",
      news_feed_description: "NF", ocr: "OCR", destination_page_text: "DEST",
      ad_image: "https://x/PowerAdspy/i.png",
    });
  });
  it("falls back to MySQL for fields ES left null (facebook)", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [{ _source: {
      "facebook_ad.id": 1,
      "facebook_ad.type": "IMAGE",
      // ad_text/ad_title/news_feed_description/post_owner_name/ad_image all absent from ES.
    }}]}}));
    const sqlQuery = vi.fn(async (query, params) => {
      expect(query).toContain("FROM facebook_ad");
      expect(query).toContain("facebook_ad_variants");
      expect(query).toContain("facebook_ad_post_owners");
      expect(params).toEqual([1]);
      return [{
        _fallback_id: 1,
        ad_title: "SQL Title",
        ad_text: "SQL Text",
        news_feed_description: "SQL NF",
        post_owner_name: "SQL Owner",
        ad_image_url: "https://x/PowerAdspy/n2/img.png",
      }];
    });
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search, sql: { query: sqlQuery } }));
    const res = mkRes();
    await getDescriptionDetails({ query: { platform: "facebook", exVal: 0, limit: 50 }, body: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(sqlQuery).toHaveBeenCalledTimes(1);
    expect(res.body[0]).toMatchObject({
      id: 1, ad_title: "SQL Title", ad_text: "SQL Text",
      news_feed_description: "SQL NF", post_owner_name: "SQL Owner",
    });
    expect(res.body[0].ad_image).toContain("img.png");
  });
  it("treats an ES value of the literal string \"0\" as present, not missing (facebook)", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [{ _source: {
      "facebook_ad.id": 3,
      "facebook_ad_variants.text_exactly": "0",
      "facebook_ad_variants.title_exactly": "Title",
      "facebook_ad_post_owners.post_owner_name": "Po",
      "facebook_ad_variants.newsfeed_description_exactly": "NF",
      "facebook_ad.type": "VIDEO",
    }}]}}));
    const sqlQuery = vi.fn(async () => [{ _fallback_id: 3, ad_text: "SQL Text (should not be used)" }]);
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search, sql: { query: sqlQuery } }));
    const res = mkRes();
    await getDescriptionDetails({ query: { platform: "facebook", exVal: 0, limit: 50 }, body: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(sqlQuery).not.toHaveBeenCalled();
    expect(res.body[0].ad_text).toBe("0");
  });
  it("does not query MySQL when ES already has all fields (facebook)", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [{ _source: {
      "facebook_ad.id": 2,
      "facebook_ad_variants.text_exactly": "T",
      "facebook_ad_variants.title_exactly": "Title",
      "facebook_ad_post_owners.post_owner_name": "Po",
      "facebook_ad_variants.newsfeed_description_exactly": "NF",
      "facebook_ad.type": "VIDEO",
    }}]}}));
    const sqlQuery = vi.fn(async () => []);
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search, sql: { query: sqlQuery } }));
    const res = mkRes();
    await getDescriptionDetails({ query: { platform: "facebook", exVal: 0, limit: 50 }, body: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(sqlQuery).not.toHaveBeenCalled();
  });
  it("skips SQL fallback for tiktok (no SQL creative-text table)", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [{ _source: {
      ad_id: 5, ad_type: "IMAGE",
    }}]}}));
    const sqlQuery = vi.fn(async () => []);
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search, sql: { query: sqlQuery } }));
    const res = mkRes();
    await getDescriptionDetails({ query: { platform: "tiktok", exVal: 0, limit: 50 }, body: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(sqlQuery).not.toHaveBeenCalled();
  });
  it("applies the displayable-media filter to the ES query (facebook)", async () => {
    const search = vi.fn(async (params) => {
      expect(params.body.query.bool.must).toEqual([{ range: { "facebook_ad.id": { gt: 0 } } }]);
      const filter = params.body.query.bool.filter;
      expect(Array.isArray(filter)).toBe(true);
      expect(JSON.stringify(filter)).toContain("new_nas_image_url");
      expect(JSON.stringify(filter)).toContain("DefaultImage");
      return { hits: { hits: [] } };
    });
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    const res = mkRes();
    await getDescriptionDetails({ query: { platform: "facebook", exVal: 0, limit: 50 }, body: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(search).toHaveBeenCalledTimes(1);
  });
  it("applies the tiktok displayable-media filter (video_cover gate)", async () => {
    const search = vi.fn(async (params) => {
      const filter = params.body.query.bool.filter;
      expect(JSON.stringify(filter)).toContain("video_cover");
      return { hits: { hits: [] } };
    });
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    const res = mkRes();
    await getDescriptionDetails({ query: { platform: "tiktok", exVal: 0, limit: 50 }, body: {} }, res);
    expect(res.statusCode).toBe(200);
  });
  it("google paginates on internal id and exposes ad_id + cursor separately", async () => {
    const search = vi.fn(async (params) => {
      // Assert ES query uses the monotonic internal PK, not the public ad_id.
      expect(params.body.sort).toEqual([{ id: "asc" }]);
      expect(params.body.query.bool.must[0].range).toEqual({ id: { gt: 7 } });
      return { hits: { hits: [{ _source: {
        id: 42,
        ad_id: "pub_99",
        ad_text: "GT",
        ad_title: "GTitle",
        post_owner: "GO",
        newsfeed_description: "GNF",
      }}]}};
    });
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    const res = mkRes();
    await getDescriptionDetails({ query: { platform: "google", exVal: 7, limit: 20 }, body: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body[0]).toMatchObject({
      id: 42,
      cursor: 42,
      ad_id: "pub_99",
      ad_text: "GT",
      ad_title: "GTitle",
      post_owner_name: "GO",
      news_feed_description: "GNF",
    });
  });
  it("google reads its IMAGE ad_type off the flat `type` field, not `ad_type`", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [{ _source: {
      id: 1, ad_id: "pub_1",
      type: "IMAGE",
      new_nas_image_url: "https://x/PowerAdspy/n2/g.png",
    }}]}}));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    const res = mkRes();
    await getDescriptionDetails({ query: { platform: "google", exVal: 0, limit: 20 }, body: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body[0].ad_image).toContain("g.png");
  });
  it("google TEXT ads still emit ad_image (null) instead of omitting the key", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [{ _source: {
      id: 2, ad_id: "pub_2",
      type: "TEXT",
      // no new_nas_image_url / image_url_original / screenshot_url / png_file at all.
    }}]}}));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    const res = mkRes();
    await getDescriptionDetails({ query: { platform: "google", exVal: 0, limit: 20 }, body: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body[0]).toHaveProperty("ad_image");
    expect(res.body[0].ad_image).toBeNull();
  });
  it("google TEXT ads never fall back to screenshot_url/png_file (landing-page screenshots, not the ad creative)", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [{ _source: {
      id: 3, ad_id: "pub_3",
      type: "TEXT",
      screenshot_url: "https://x/screenshots/pub_3.png",
      png_file: "https://x/pngs/pub_3.png",
    }}]}}));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    const res = mkRes();
    await getDescriptionDetails({ query: { platform: "google", exVal: 0, limit: 20 }, body: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body[0].ad_image).toBeNull();
  });
  it("linkedin reads its VIDEO thumbnail off `ad_video`, not `Thumbnail`", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [{ _source: {
      ad_id: 1,
      ad_type: "VIDEO",
      ad_video: "https://x/PowerAdspy/n2/li-video-thumb.png",
      Thumbnail: "https://x/should-not-be-used.png",
    }}]}}));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    const res = mkRes();
    await getDescriptionDetails({ query: { platform: "linkedin", exVal: 0, limit: 20 }, body: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body[0].thumbnail).toContain("li-video-thumb.png");
  });
  it("non-google platforms have cursor equal to id and no ad_id", async () => {
    const search = vi.fn(async (params) => {
      expect(params.body.sort).toEqual([{ "facebook_ad.id": "asc" }]);
      return { hits: { hits: [{ _source: {
        "facebook_ad.id": 9,
        "facebook_ad.type": "TEXT",
      } }] } };
    });
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    const res = mkRes();
    await getDescriptionDetails({ query: { platform: "facebook" }, body: {} }, res);
    expect(res.body[0].id).toBe(9);
    expect(res.body[0].cursor).toBe(9);
    expect(res.body[0].ad_id).toBeUndefined();
  });
  it("VIDEO row with thumb containing 'PowerAdspy' → keeps thumb", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [{ _source: {
      "facebook_ad.id": 1, "facebook_ad.type": "VIDEO",
      "Thumbnail": "https://x/PowerAdspy/thumb.png",
    }}]}}));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    const res = mkRes();
    await getDescriptionDetails({ query: {}, body: { platform: "facebook" } }, res);
    expect(res.body[0].thumbnail).toBe("https://x/PowerAdspy/thumb.png");
  });
  it("VIDEO row with non-PowerAdspy thumb → kept (source no longer PowerAdspy-filters)", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [{ _source: {
      "facebook_ad.id": 1, "facebook_ad.type": "VIDEO",
      "Thumbnail": "https://x/other.png",
    }}]}}));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    const res = mkRes();
    await getDescriptionDetails({ query: {}, body: { platform: "facebook" } }, res);
    expect(res.body[0].thumbnail).toBe("https://x/other.png");
  });
  it("VIDEO row with empty thumb → null", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [{ _source: {
      "facebook_ad.id": 1, "facebook_ad.type": "VIDEO",
    }}]}}));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    const res = mkRes();
    await getDescriptionDetails({ query: {}, body: { platform: "facebook" } }, res);
    expect(res.body[0].thumbnail).toBeNull();
  });
  it("VIDEO row but thumbField=null (gdn) → no thumbnail set", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [{ _source: {
      "gdn_ad.id": 1, "gdn_ad.type": "VIDEO",
    }}]}}));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    const res = mkRes();
    await getDescriptionDetails({ query: {}, body: { platform: "gdn" } }, res);
    expect(res.body[0].thumbnail).toBeUndefined();
  });
  it("gdn never emits ad_text/ad_title/news_feed_description, even when ES has them (post_owner_name still sent)", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [{ _source: {
      "gdn_ad.id": 1, "gdn_ad.type": "IMAGE",
      "gdn_ad_variants.text": "Click here to Continue",
      "gdn_ad_variants.title": "Some Title",
      "gdn_ad_variants.newsfeed_description": "some-site.com",
      "gdn_ad_post_owners.post_owner_name": "Advertiser Co",
      "new_nas_image_url": "https://x/PowerAdspy/n2/g.png",
    }}]}}));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    const res = mkRes();
    await getDescriptionDetails({ query: {}, body: { platform: "gdn" } }, res);
    expect(res.body[0]).not.toHaveProperty("ad_text");
    expect(res.body[0]).not.toHaveProperty("ad_title");
    expect(res.body[0]).not.toHaveProperty("news_feed_description");
    expect(res.body[0].post_owner_name).toBe("Advertiser Co");
    expect(res.body[0].ad_image).toContain("g.png");
  });
  it("gdn's SQL fallback never reintroduces ad_text/ad_title/news_feed_description", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [{ _source: {
      "gdn_ad.id": 1, "gdn_ad.type": "IMAGE",
      // no post_owner_name / new_nas_image_url in ES — should trigger the SQL fallback.
    }}]}}));
    const sqlQuery = vi.fn(async () => [{
      _fallback_id: 1,
      ad_text: "SQL Text (should never appear)",
      ad_title: "SQL Title (should never appear)",
      news_feed_description: "SQL NF (should never appear)",
      post_owner_name: "SQL Owner",
      ad_image_url: "https://x/PowerAdspy/n2/sql-img.png",
    }]);
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search, sql: { query: sqlQuery } }));
    const res = mkRes();
    await getDescriptionDetails({ query: {}, body: { platform: "gdn" } }, res);
    expect(sqlQuery).toHaveBeenCalledTimes(1);
    expect(res.body[0]).not.toHaveProperty("ad_text");
    expect(res.body[0]).not.toHaveProperty("ad_title");
    expect(res.body[0]).not.toHaveProperty("news_feed_description");
    expect(res.body[0].post_owner_name).toBe("SQL Owner");
    expect(res.body[0].ad_image).toContain("sql-img.png");
  });
  it("IMAGE row but no nasValue → ad_image=null", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [{ _source: {
      "facebook_ad.id": 1, "facebook_ad.type": "IMAGE",
    }}]}}));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    const res = mkRes();
    await getDescriptionDetails({ query: {}, body: { platform: "facebook" } }, res);
    expect(res.body[0].ad_image).toBeNull();
  });
  it("non-IMAGE non-VIDEO type — neither ad_image nor thumbnail set", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [{ _source: {
      "facebook_ad.id": 1, "facebook_ad.type": "TEXT",
    }}]}}));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    const res = mkRes();
    await getDescriptionDetails({ query: {}, body: { platform: "facebook" } }, res);
    expect(res.body[0].ad_image).toBeUndefined();
    expect(res.body[0].thumbnail).toBeUndefined();
  });
  it("ocr undefined → ocr field NOT set", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [{ _source: {
      "facebook_ad.id": 1,
    }}]}}));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    const res = mkRes();
    await getDescriptionDetails({ query: {}, body: { platform: "facebook" } }, res);
    expect("ocr" in res.body[0]).toBe(false);
  });
  it("destPageField undefined → destination_page_text NOT set", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [{ _source: { "facebook_ad.id": 1 } }] } }));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    const res = mkRes();
    await getDescriptionDetails({ query: {}, body: { platform: "facebook" } }, res);
    expect("destination_page_text" in res.body[0]).toBe(false);
  });
  it("body.hits fallback shape", async () => {
    const search = vi.fn(async () => ({ body: { hits: { hits: [{ _source: { "facebook_ad.id": 1 } }] } } }));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    const res = mkRes();
    await getDescriptionDetails({ query: {}, body: { platform: "facebook" } }, res);
    expect(res.body).toHaveLength(1);
  });
  it("ES response with no nested .hits → `|| []` fallback fires (line 200 outer ||)", async () => {
    // esResult.hits exists but lacks nested .hits → optional chain undefined
    // → trailing `|| []` falls through to []. finalArray ends up [].
    const search = vi.fn(async () => ({ hits: { /* no .hits */ total: 0 } }));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    const res = mkRes();
    await getDescriptionDetails({ query: {}, body: { platform: "facebook" } }, res);
    expect(res.body).toEqual([]);
  });
  it("500 on ES throw + service.log.error called", async () => {
    const search = vi.fn(async () => { throw new Error("es-down"); });
    const logError = vi.fn();
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search, log: { error: logError } }));
    const res = mkRes();
    await getDescriptionDetails({ query: {}, body: { platform: "facebook" } }, res);
    expect(res.statusCode).toBe(500);
    expect(logError).toHaveBeenCalled();
  });
  it("500 path tolerates missing service.log", async () => {
    const search = vi.fn(async () => { throw new Error("es-down"); });
    serviceRegistry.getService.mockReturnValue({ db: { elastic: { search } } });
    const res = mkRes();
    await getDescriptionDetails({ query: {}, body: { platform: "facebook" } }, res);
    expect(res.statusCode).toBe(500);
  });
});

describe("addCategoryController > newCatInsertion > validation", () => {
  function valReq(overrides = {}) {
    return { body: { platform: "facebook", category: "FooCat", category_id: "1234", ad_id: 999, ...overrides } };
  }
  it("400 for bad platform", async () => {
    const res = mkRes();
    await newCatInsertion(valReq({ platform: "xx" }), res);
    expect(res.statusCode).toBe(400);
  });
  it("400 when category too short", async () => {
    const res = mkRes();
    await newCatInsertion(valReq({ category: "abc" }), res);
    expect(res.statusCode).toBe(400);
  });
  it("400 when category_id wrong length", async () => {
    const res = mkRes();
    await newCatInsertion(valReq({ category_id: "12" }), res);
    expect(res.statusCode).toBe(400);
  });
  it("400 when ad_id missing", async () => {
    const res = mkRes();
    await newCatInsertion(valReq({ ad_id: undefined }), res);
    expect(res.statusCode).toBe(400);
  });
  it("400 when subcategory has only one of name/id", async () => {
    const res = mkRes();
    await newCatInsertion(valReq({ sub_category: "SubName" }), res);
    expect(res.statusCode).toBe(400);
  });
  it("400 when subcategory_id has only one", async () => {
    const res = mkRes();
    await newCatInsertion(valReq({ subcategory_id: "12345678" }), res);
    expect(res.statusCode).toBe(400);
  });
  it("400 when sub_category too short", async () => {
    const res = mkRes();
    await newCatInsertion(valReq({ sub_category: "a", subcategory_id: "12345678" }), res);
    expect(res.statusCode).toBe(400);
  });
  it("400 when subcategory_id wrong length", async () => {
    const res = mkRes();
    await newCatInsertion(valReq({ sub_category: "FooSub", subcategory_id: "123" }), res);
    expect(res.statusCode).toBe(400);
  });
  it("400 when subcategory_id does not start with category_id", async () => {
    const res = mkRes();
    await newCatInsertion(valReq({ sub_category: "FooSub", subcategory_id: "99995678" }), res);
    expect(res.statusCode).toBe(400);
  });
  it("503 when gdn service has no elastic", async () => {
    serviceRegistry.getService.mockReturnValue(null);
    const res = mkRes();
    await newCatInsertion(valReq(), res);
    expect(res.statusCode).toBe(503);
  });
});

describe("addCategoryController > newCatInsertion > main flow", () => {
  function setupES({ existHits, adHits, indexFn, updateFn, log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }) {
    const search = vi.fn(async (params) => {
      if (params.index === "category") return { hits: { hits: existHits } };
      return { hits: { hits: adHits } };
    });
    const svc = { db: { elastic: { search, index: indexFn || vi.fn(async () => {}), update: updateFn || vi.fn(async () => {}) } }, log };
    serviceRegistry.getService.mockReturnValue(svc);
    return svc;
  }

  function happyBody(overrides = {}) {
    return { body: { platform: "facebook", category: "FooCat", category_id: "1234", ad_id: 7, ...overrides } };
  }

  it("inserts new category when none exists + updates ad doc with confidence_score", async () => {
    const indexFn = vi.fn(async () => {});
    const updateFn = vi.fn(async () => {});
    setupES({
      existHits: [],
      adHits: [{ _id: "ad-1" }],
      indexFn, updateFn,
    });
    const res = mkRes();
    await newCatInsertion(happyBody(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.message).toContain("New category");
    expect(res.body.updated).toBe(true);
    expect(res.body.warning).toBeUndefined();
    expect(indexFn).toHaveBeenCalledWith(expect.objectContaining({ index: "category" }));
    expect(updateFn).toHaveBeenCalled();
    const updateCall = updateFn.mock.calls[0][0];
    expect(updateCall.body.doc).toMatchObject({
      category_id: "1234",
      "facebook.category": "FooCat",
      subCategory_id: null,
      "facebook.subCategory": null,
      confidence_score: 0,
    });
  });

  it("inserts new category WITH subcategory", async () => {
    const indexFn = vi.fn(async () => {});
    setupES({ existHits: [], adHits: [], indexFn });
    const res = mkRes();
    await newCatInsertion(happyBody({ sub_category: "SubNameX", subcategory_id: "12345678" }), res);
    expect(res.body.message).toContain("subcategory inserted");
    const indexedDoc = indexFn.mock.calls[0][0].body;
    expect(indexedDoc.subcategory).toHaveLength(1);
  });

  it("500 when catId matches but name differs", async () => {
    setupES({ existHits: [{ _id: "d", _source: { cat_id: "1234", category: "DIFFERENT", platforms: [] } }], adHits: [] });
    const res = mkRes();
    await newCatInsertion(happyBody(), res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/category name doesn/);
  });

  it("500 when name matches but catId differs", async () => {
    setupES({ existHits: [{ _id: "d", _source: { cat_id: "9999", category: "FooCat", platforms: [] } }], adHits: [] });
    const res = mkRes();
    await newCatInsertion(happyBody(), res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toContain("category ID doesn");
  });

  it("existing category WITHOUT platform → update script adds platform", async () => {
    const updateFn = vi.fn(async () => {});
    setupES({ existHits: [{ _id: "d", _source: { cat_id: "1234", category: "FooCat", platforms: ["gdn"] } }], adHits: [], updateFn });
    const res = mkRes();
    await newCatInsertion(happyBody(), res);
    expect(updateFn).toHaveBeenCalled();
    expect(res.body.message).toContain("already exists");
  });

  it("existing category with platform already present → no-op platform update", async () => {
    const updateFn = vi.fn(async () => {});
    setupES({ existHits: [{ _id: "d", _source: { cat_id: "1234", category: "FooCat", platforms: ["facebook"] } }], adHits: [], updateFn });
    const res = mkRes();
    await newCatInsertion(happyBody(), res);
    expect(res.body.message).toBe("Category already exists");
  });

  it("existing category + new subcategory → inserts subcategory", async () => {
    const updateFn = vi.fn(async () => {});
    setupES({
      existHits: [{ _id: "d", _source: { cat_id: "1234", category: "FooCat", platforms: ["facebook"], subcategory: [] } }],
      adHits: [], updateFn,
    });
    const res = mkRes();
    await newCatInsertion(happyBody({ sub_category: "SubNameX", subcategory_id: "12345678" }), res);
    expect(res.body.message).toBe("Subcategory inserted successfully");
    expect(updateFn).toHaveBeenCalled();
  });

  it("existing category + existing subcategory_id with matching name → adds platform to sub", async () => {
    const updateFn = vi.fn(async () => {});
    setupES({
      existHits: [{ _id: "d", _source: {
        cat_id: "1234", category: "FooCat", platforms: ["facebook"],
        subcategory: [{ sub_cat_id: "12345678", sub_cat: "SubNameX", platforms: ["gdn"] }],
      }}],
      adHits: [], updateFn,
    });
    const res = mkRes();
    await newCatInsertion(happyBody({ sub_category: "SubNameX", subcategory_id: "12345678" }), res);
    expect(res.body.message).toBe("Category and Subcategory already exist");
    expect(updateFn).toHaveBeenCalled();
  });

  it("existing subcategory_id where platform already there → no update script", async () => {
    const updateFn = vi.fn(async () => {});
    setupES({
      existHits: [{ _id: "d", _source: {
        cat_id: "1234", category: "FooCat", platforms: ["facebook"],
        subcategory: [{ sub_cat_id: "12345678", sub_cat: "SubNameX", platforms: ["facebook"] }],
      }}],
      adHits: [], updateFn,
    });
    const res = mkRes();
    await newCatInsertion(happyBody({ sub_category: "SubNameX", subcategory_id: "12345678" }), res);
    expect(res.body.message).toBe("Category and Subcategory already exist");
  });

  it("500 when subcategory_id exists but name differs", async () => {
    setupES({
      existHits: [{ _id: "d", _source: {
        cat_id: "1234", category: "FooCat", platforms: ["facebook"],
        subcategory: [{ sub_cat_id: "12345678", sub_cat: "OldSubName", platforms: [] }],
      }}],
      adHits: [],
    });
    const res = mkRes();
    await newCatInsertion(happyBody({ sub_category: "SubNameX", subcategory_id: "12345678" }), res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/subcategory name doesn/);
  });

  it("500 when subcategory name exists with different id", async () => {
    setupES({
      existHits: [{ _id: "d", _source: {
        cat_id: "1234", category: "FooCat", platforms: ["facebook"],
        subcategory: [{ sub_cat_id: "11111111", sub_cat: "SubNameX", platforms: [] }],
      }}],
      adHits: [],
    });
    const res = mkRes();
    await newCatInsertion(happyBody({ sub_category: "SubNameX", subcategory_id: "12345678" }), res);
    expect(res.statusCode).toBe(500);
    expect(res.body.error).toMatch(/subcategory ID doesn/);
  });

  it("subcategory loop skips unrelated sub then matches by id (line 390 falsy branch)", async () => {
    // First sub matches neither id nor name → both line 357 and line 390 falsy
    // (loop continues). Second sub matches by id → enters truthy of line 357
    // and breaks. The unrelated sub exercises line 390's falsy branch.
    setupES({
      existHits: [{ _id: "d", _source: {
        cat_id: "1234", category: "FooCat", platforms: ["facebook"],
        subcategory: [
          { sub_cat_id: "99999999", sub_cat: "Unrelated", platforms: ["facebook"] },
          { sub_cat_id: "12345678", sub_cat: "SubNameX", platforms: ["facebook"] },
        ],
      }}],
      adHits: [],
    });
    const res = mkRes();
    await newCatInsertion(happyBody({ sub_category: "SubNameX", subcategory_id: "12345678" }), res);
    expect(res.statusCode).toBe(200);
  });

  it("ad doc not found → warns and continues, 200, updated=false", async () => {
    setupES({ existHits: [], adHits: [] });
    const res = mkRes();
    await newCatInsertion(happyBody(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.updated).toBe(false);
    expect(res.body.warning).toMatch(/not found/);
  });

  it("ad update throws → warn, 200, updated=false", async () => {
    setupES({ existHits: [], adHits: [{ _id: "ad" }], updateFn: vi.fn(async () => { throw new Error("upd-fail"); }) });
    const res = mkRes();
    await newCatInsertion(happyBody(), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.updated).toBe(false);
    expect(res.body.warning).toMatch(/update failed/);
  });

  it("ad lookup uses exact term query with string + numeric id", async () => {
    let capturedAdSearch = null;
    const search = vi.fn(async (params) => {
      if (params.index === "category") return { hits: { hits: [] } };
      capturedAdSearch = params;
      return { hits: { hits: [{ _id: "ad-1" }] } };
    });
    const update = vi.fn(async () => {});
    const svc = { db: { elastic: { search, index: vi.fn(), update } }, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
    serviceRegistry.getService.mockReturnValue(svc);
    const res = mkRes();
    await newCatInsertion(happyBody({ ad_id: "13011" }), res);
    expect(capturedAdSearch).not.toBeNull();
    expect(capturedAdSearch.body.query.bool.should).toEqual([
      { term: { "facebook_ad.id": "13011" } },
      { term: { "facebook_ad.id": 13011 } },
    ]);
    expect(capturedAdSearch.body.query.bool.minimum_should_match).toBe(1);
  });

  it("ad lookup uses only string term for non-numeric ad_id", async () => {
    let capturedAdSearch = null;
    const search = vi.fn(async (params) => {
      if (params.index === "category") return { hits: { hits: [] } };
      capturedAdSearch = params;
      return { hits: { hits: [{ _id: "ad-1" }] } };
    });
    const update = vi.fn(async () => {});
    const svc = { db: { elastic: { search, index: vi.fn(), update } }, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
    serviceRegistry.getService.mockReturnValue(svc);
    const res = mkRes();
    await newCatInsertion(happyBody({ ad_id: "abc123" }), res);
    expect(capturedAdSearch.body.query.bool.should).toEqual([
      { term: { "facebook_ad.id": "abc123" } },
    ]);
  });

  it("uses gdnService when platform-specific service missing", async () => {
    const indexFn = vi.fn(async () => {});
    const search = vi.fn(async (p) => {
      if (p.index === "category") return { hits: { hits: [] } };
      return { hits: { hits: [{ _id: "ad" }] } };
    });
    const gdn = { db: { elastic: { search, index: indexFn, update: vi.fn(async () => {}) } }, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
    serviceRegistry.getService.mockImplementation((slug) => {
      if (slug === "gdn") return gdn;
      return null; // platform service null → falls back to gdn
    });
    const res = mkRes();
    await newCatInsertion(happyBody(), res);
    expect(res.statusCode).toBe(200);
  });

  it("body.hits fallback for ad search", async () => {
    setupES({
      existHits: [],
      adHits: [{ _id: "ad-x" }],
    });
    // override the search mock to return body.hits shape for ad query
    const svc = serviceRegistry.getService();
    const orig = svc.db.elastic.search;
    svc.db.elastic.search = vi.fn(async (p) => {
      if (p.index === "category") return { hits: { hits: [] } };
      return { body: { hits: { hits: [{ _id: "ad-x" }] } } };
    });
    serviceRegistry.getService.mockReturnValue(svc);
    const res = mkRes();
    await newCatInsertion(happyBody(), res);
    expect(res.statusCode).toBe(200);
  });

  it("category existResult body.hits fallback", async () => {
    const indexFn = vi.fn(async () => {});
    const search = vi.fn(async (params) => {
      if (params.index === "category") return { body: { hits: { hits: [] } } };
      return { hits: { hits: [] } };
    });
    serviceRegistry.getService.mockReturnValue({ db: { elastic: { search, index: indexFn, update: vi.fn() } }, log: { info: vi.fn(), warn: vi.fn() } });
    const res = mkRes();
    await newCatInsertion(happyBody(), res);
    expect(res.statusCode).toBe(200);
  });

  it("500 on outer throw", async () => {
    // First search throws synchronously
    serviceRegistry.getService.mockReturnValue({ db: { elastic: { search: () => { throw new Error("boom"); } } } });
    const res = mkRes();
    await newCatInsertion(happyBody(), res);
    expect(res.statusCode).toBe(500);
  });

  it("setImmediate syncCategory success path logs info", async () => {
    syncCategory.mockImplementationOnce(async (req, res) => res.status(200).json({}));
    setupES({ existHits: [], adHits: [] });
    const res = mkRes();
    await newCatInsertion(happyBody(), res);
    await new Promise(r => setImmediate(r));
  });

  it("setImmediate syncCategory non-200 → warn", async () => {
    syncCategory.mockImplementationOnce(async (req, res) => res.status(404).json({ message: "no" }));
    setupES({ existHits: [], adHits: [] });
    const res = mkRes();
    await newCatInsertion(happyBody(), res);
    await new Promise(r => setImmediate(r));
  });

  it("setImmediate syncCategory throws → warn", async () => {
    syncCategory.mockImplementationOnce(async () => { throw new Error("sync-fail"); });
    setupES({ existHits: [], adHits: [] });
    const res = mkRes();
    await newCatInsertion(happyBody(), res);
    await new Promise(r => setImmediate(r));
  });

  it("setImmediate syncCategory uses res.json directly (no status)", async () => {
    syncCategory.mockImplementationOnce(async (req, res) => res.json({}));
    setupES({ existHits: [], adHits: [] });
    const res = mkRes();
    await newCatInsertion(happyBody(), res);
    await new Promise(r => setImmediate(r));
  });

  it("platService.db.elastic missing → falls back to gdnService.db.elastic (line 435 right operand)", async () => {
    // platService present but no elastic → triggers the `|| gdnService.db.elastic`
    // fallback at line 435. gdnService still provides ES for the ad search.
    const gdnEsSearch = vi.fn(async (params) => {
      if (params.index === "category") return { hits: { hits: [] } };
      return { hits: { hits: [{ _id: "ad-1" }] } };
    });
    const gdnSvc = { db: { elastic: { search: gdnEsSearch, index: vi.fn(async () => {}), update: vi.fn(async () => {}) } }, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
    // platService is a different service object with no `.elastic` on db
    const platSvc = { db: { /* no elastic */ }, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
    serviceRegistry.getService.mockImplementation((name) => name === "gdn" ? gdnSvc : platSvc);
    const res = mkRes();
    await newCatInsertion(happyBody(), res);
    // gdnService.db.elastic.search was used for the ad-lookup at line 438
    expect(gdnEsSearch).toHaveBeenCalled();
  });

  it("ES response with no hits.hits property → || [] fallback (line 200)", async () => {
    // existResult.hits exists but lacks nested .hits → optional chain undefined
    // → trailing `|| []` falls back. finalArray ends up [] → treated as no existing category.
    const search = vi.fn(async (params) => {
      if (params.index === "category") return { hits: { /* no .hits */ total: 0 } };
      return { hits: { hits: [{ _id: "ad-1" }] } };
    });
    const svc = { db: { elastic: { search, index: vi.fn(async () => {}), update: vi.fn(async () => {}) } }, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
    serviceRegistry.getService.mockReturnValue(svc);
    const res = mkRes();
    await newCatInsertion(happyBody(), res);
    // No category found → goes into "new category" insert path → calls .index
    expect(svc.db.elastic.index).toHaveBeenCalled();
  });
});

describe("addCategoryController > getDescriptionDetails > category read-back (Issue 1)", () => {
  it("returns stored category/sub_category + ids + confidence_score", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [{ _source: {
      "facebook_ad.id": 5,
      "facebook.category": "Retail",
      "facebook.subCategory": "eCommerce",
      category_id: "1234",
      subCategory_id: "12340001",
      confidence_score: 0,
    }}]}}));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    const res = mkRes();
    await getDescriptionDetails({ query: { platform: "facebook" }, body: {} }, res);
    expect(res.body[0]).toMatchObject({
      category: "Retail",
      sub_category: "eCommerce",
      category_id: "1234",
      subcategory_id: "12340001",
      confidence_score: 0,
    });
  });

  it("uncategorized ad → category/sub_category null", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [{ _source: { "facebook_ad.id": 5 } }] } }));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    const res = mkRes();
    await getDescriptionDetails({ query: { platform: "facebook" }, body: {} }, res);
    expect(res.body[0].category).toBeNull();
    expect(res.body[0].sub_category).toBeNull();
  });
});

describe("addCategoryController > getDescriptionDetails > native image fallback (Issue 3)", () => {
  it("IMAGE with no NAS url falls back to image_url_original", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [{ _source: {
      "native_ad.id": 9,
      "native_ad.type": "IMAGE",
      // no native_ad.nas_url
      image_url_original: "https://cdn.example/creative.jpg",
    }}]}}));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    const res = mkRes();
    await getDescriptionDetails({ query: { platform: "native" }, body: {} }, res);
    expect(res.body[0].ad_image).toBe("https://cdn.example/creative.jpg");
    expect(res.body[0].image_url_original).toBe("https://cdn.example/creative.jpg");
  });

  it("IMAGE prefers NAS url over original when both present", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [{ _source: {
      "native_ad.id": 9,
      "native_ad.type": "IMAGE",
      "native_ad.nas_url": "https://cdn.example/nas.jpg",
      image_url_original: "https://cdn.example/orig.jpg",
    }}]}}));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    const res = mkRes();
    await getDescriptionDetails({ query: { platform: "native" }, body: {} }, res);
    expect(res.body[0].ad_image).toBe("https://cdn.example/nas.jpg");
  });
});

describe("addCategoryController > newCatInsertion > ad_status (Issue 1)", () => {
  function setupES({ existHits, adHits, updateFn }) {
    const search = vi.fn(async (params) => {
      if (params.index === "category") return { hits: { hits: existHits } };
      return { hits: { hits: adHits } };
    });
    const svc = { db: { elastic: { search, index: vi.fn(async () => {}), update: updateFn || vi.fn(async () => {}) } }, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
    serviceRegistry.getService.mockReturnValue(svc);
    return svc;
  }
  const body = (o = {}) => ({ body: { platform: "facebook", category: "FooCat", category_id: "1234", ad_id: 7, ...o } });

  it("ad with no prior category → ad_status inserted", async () => {
    setupES({ existHits: [], adHits: [{ _id: "ad-1", _source: {} }] });
    const res = mkRes();
    await newCatInsertion(body(), res);
    expect(res.body.ad_status).toBe("inserted");
    expect(res.body.updated).toBe(true);
  });

  it("ad with a different prior category → ad_status updated + previous_category", async () => {
    setupES({ existHits: [], adHits: [{ _id: "ad-1", _source: { "facebook.category": "OldCat" } }] });
    const res = mkRes();
    await newCatInsertion(body(), res);
    expect(res.body.ad_status).toBe("updated");
    expect(res.body.previous_category).toBe("OldCat");
  });

  it("ad already holding the identical category → ad_status unchanged", async () => {
    setupES({ existHits: [], adHits: [{ _id: "ad-1", _source: { "facebook.category": "FooCat" } }] });
    const res = mkRes();
    await newCatInsertion(body(), res);
    expect(res.body.ad_status).toBe("unchanged");
  });

  it("ad not found → ad_status not_found", async () => {
    setupES({ existHits: [], adHits: [] });
    const res = mkRes();
    await newCatInsertion(body(), res);
    expect(res.body.ad_status).toBe("not_found");
    expect(res.body.updated).toBe(false);
  });
});

describe("addCategoryController > getAdCategory (Issue 1 read-back endpoint)", () => {
  it("400 for unsupported platform", async () => {
    const res = mkRes();
    await getAdCategory({ query: { platform: "xx", ad_id: 1 }, body: {} }, res);
    expect(res.statusCode).toBe(400);
  });
  it("400 when ad_id missing", async () => {
    const res = mkRes();
    await getAdCategory({ query: { platform: "facebook" }, body: {} }, res);
    expect(res.statusCode).toBe(400);
  });
  it("503 when no ES", async () => {
    serviceRegistry.getService.mockReturnValue(null);
    const res = mkRes();
    await getAdCategory({ query: { platform: "facebook", ad_id: 1 }, body: {} }, res);
    expect(res.statusCode).toBe(503);
  });
  it("404 when ad not found", async () => {
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: vi.fn(async () => ({ hits: { hits: [] } })) }));
    const res = mkRes();
    await getAdCategory({ query: { platform: "facebook", ad_id: 1 }, body: {} }, res);
    expect(res.statusCode).toBe(404);
  });
  it("200 returns stored category for the ad", async () => {
    const search = vi.fn(async () => ({ hits: { hits: [{ _id: "x", _source: {
      "facebook.category": "Retail", "facebook.subCategory": "eCommerce",
      category_id: "1234", subCategory_id: "12340001", confidence_score: 0,
      ai_meta: { ad_type: "promotional", offering_type: "product" },
    }}]}}));
    serviceRegistry.getService.mockReturnValue(mkService({ esSearch: search }));
    const res = mkRes();
    await getAdCategory({ query: { platform: "facebook", ad_id: "13011" }, body: {} }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      platform: "facebook", ad_id: "13011",
      category: "Retail", sub_category: "eCommerce",
      category_id: "1234", subcategory_id: "12340001", confidence_score: 0,
      ai_meta: { ad_type: "promotional", offering_type: "product" },
    });
  });
});

describe("addCategoryController > insertAiMeta (Option B — dedicated /ai-meta)", () => {
  function esWithAd(adHits, updateFn) {
    const search = vi.fn(async () => ({ hits: { hits: adHits } }));
    const svc = { db: { elastic: { search, update: updateFn || vi.fn(async () => {}), index: vi.fn() } }, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
    serviceRegistry.getService.mockReturnValue(svc);
    return svc;
  }

  it("400 VALIDATION_ERROR when ad_id/network/ai_meta missing", async () => {
    const res = mkRes();
    await insertAiMeta({ body: {} }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    const fields = res.body.error.details.map((d) => d.field);
    expect(fields).toEqual(expect.arrayContaining(["ad_id", "network", "ai_meta"]));
  });

  it("400 for unsupported network", async () => {
    const res = mkRes();
    await insertAiMeta({ body: { ad_id: "1", network: "myspace", ai_meta: VALID_AI_META } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.details.some((d) => d.field === "network")).toBe(true);
  });

  it("400 surfaces ai_meta field errors (spec §6.2)", async () => {
    const res = mkRes();
    // named-word color + missing required core → field-level errors
    await insertAiMeta({ body: { ad_id: "1", network: "instagram", ai_meta: { colors: ["teal"] } } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.error.details.some((d) => d.field.startsWith("ai_meta"))).toBe(true);
  });

  it("404 AD_NOT_FOUND when ad absent", async () => {
    esWithAd([]);
    const res = mkRes();
    await insertAiMeta({ body: { ad_id: "48979890", network: "instagram", ai_meta: VALID_AI_META } }, res);
    expect(res.statusCode).toBe(404);
    expect(res.body.error.code).toBe("AD_NOT_FOUND");
  });

  it("503 when ES unavailable", async () => {
    serviceRegistry.getService.mockReturnValue(null);
    const res = mkRes();
    await insertAiMeta({ body: { ad_id: "1", network: "instagram", ai_meta: VALID_AI_META } }, res);
    expect(res.statusCode).toBe(503);
  });

  it("200 success replaces the whole ai object in development + returns stored_fields", async () => {
    const updateFn = vi.fn(async () => {});
    esWithAd([{ _id: "ad-1" }], updateFn);
    const res = mkRes();
    await insertAiMeta({ body: { ad_id: "48979890", network: "instagram", ai_meta: VALID_AI_META } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("AI-Meta labels stored successfully");
    expect(res.body.stored_fields).toEqual(expect.arrayContaining(["ad_type", "offering_type"]));
    // Development keeps the original `ai` field because its mapping is already correct.
    const call = updateFn.mock.calls[0][0];
    expect(call.body.script.source).toContain("ctx._source.ai = params.aiMeta");
    expect(call.body.script.params.aiMeta.ad_type).toBe("promotional");
    expect(call.body.script.params.aiMeta.offering_type).toBe("product");
  });

  it("production facebook writes to ai_meta to bypass the poisoned ai mapping", async () => {
    config.env = "production";
    const update = vi.fn(async () => {});
    serviceRegistry.getService.mockReturnValue(mkService({
      esSearch: vi.fn(async () => ({ hits: { hits: [{ _id: "es-1", _source: {} }] } })),
      esUpdate: update,
    }));
    const res = mkRes();
    await insertAiMeta({ body: { ad_id: "48979890", network: "facebook", ai_meta: VALID_AI_META } }, res);
    expect(res.statusCode).toBe(200);
    const call = update.mock.calls.find((c) => c[0].body?.script)?.[0];
    expect(call.body.script.source).toContain("ctx._source.ai_meta = params.aiMeta");
  });
});

describe("addCategoryController > newCatInsertion + ai_meta (Option A)", () => {
  function setupES({ existHits = [], adHits, updateFn }) {
    const search = vi.fn(async (params) => {
      if (params.index === "category") return { hits: { hits: existHits } };
      return { hits: { hits: adHits } };
    });
    const svc = { db: { elastic: { search, index: vi.fn(async () => {}), update: updateFn || vi.fn(async () => {}) } }, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
    serviceRegistry.getService.mockReturnValue(svc);
    return svc;
  }
  const body = (o = {}) => ({ body: { platform: "facebook", category: "FooCat", category_id: "1234", ad_id: 7, ...o } });

  it("valid ai_meta is stored alongside category", async () => {
    const updateFn = vi.fn(async () => {});
    setupES({ adHits: [{ _id: "ad-1", _source: {} }], updateFn });
    const res = mkRes();
    await newCatInsertion(body({ ai_meta: VALID_AI_META }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.ai_meta_status).toBe("stored");
    expect(res.body.ai_meta_stored_fields).toEqual(expect.arrayContaining(["ad_type", "offering_type"]));
    // two updates: category doc-merge + ai script
    const hasAiScript = updateFn.mock.calls.some((c) => c[0].body.script && c[0].body.script.params.aiMeta);
    expect(hasAiScript).toBe(true);
  });

  it("invalid ai_meta does NOT fail the category write (validation_error)", async () => {
    setupES({ adHits: [{ _id: "ad-1", _source: {} }] });
    const res = mkRes();
    await newCatInsertion(body({ ai_meta: { ad_type: "promotional" /* missing offering_type/intent/hook */ } }), res);
    expect(res.statusCode).toBe(200);
    expect(res.body.updated).toBe(true);              // category still written
    expect(res.body.ai_meta_status).toBe("validation_error");
    expect(res.body.ai_meta_errors.length).toBeGreaterThan(0);
  });

  it("ai_meta with ad not found → ad_not_found", async () => {
    setupES({ adHits: [] });
    const res = mkRes();
    await newCatInsertion(body({ ai_meta: VALID_AI_META }), res);
    expect(res.body.ai_meta_status).toBe("ad_not_found");
  });

  it("no ai_meta → response unchanged (no ai_meta fields)", async () => {
    setupES({ adHits: [{ _id: "ad-1", _source: {} }] });
    const res = mkRes();
    await newCatInsertion(body(), res);
    expect(res.body.ai_meta_status).toBeUndefined();
  });
});

// ── SQL dual-write wiring (persistAiMeta) ──────────────────────────────
// A fake mysql2 pool connection so we can assert the controller invokes the
// SQL writer and surfaces its status without a live DB.
function mkSqlConn({ adRow = [{ id: 42 }], catRows = [{ id: 300 }] } = {}) {
  const calls = [];
  return {
    calls,
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    release: vi.fn(() => {}),
    execute: vi.fn(async (sql) => {
      calls.push(sql);
      if (/WHERE `(id|ad_id)`/.test(sql)) return [adRow];
      if (/FROM `\w+_category`/.test(sql)) return [catRows];
      return [{ affectedRows: 1, insertId: 1 }];
    }),
  };
}

describe("addCategoryController > SQL dual-write wiring", () => {
  function setupWithSql({ adHits, sqlConn, existHits = [] }) {
    const search = vi.fn(async (params) => {
      if (params.index === "category") return { hits: { hits: existHits } };
      return { hits: { hits: adHits } };
    });
    const svc = {
      db: {
        elastic: { search, index: vi.fn(async () => {}), update: vi.fn(async () => {}) },
        sql: { getConnection: vi.fn(async () => sqlConn) },
      },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    serviceRegistry.getService.mockReturnValue(svc);
    return svc;
  }

  it("Option A: newCatInsertion attaches ai_meta_sql=stored when SQL is available", async () => {
    const sqlConn = mkSqlConn();
    setupWithSql({ adHits: [{ _id: "ad-1", _source: {} }], sqlConn });
    const res = mkRes();
    await newCatInsertion({ body: { platform: "facebook", category: "FooCat", category_id: "1234", ad_id: 7, ai_meta: VALID_AI_META } }, res);
    expect(res.body.ai_meta_status).toBe("stored");
    expect(res.body.ai_meta_sql).toMatchObject({ sql_status: "stored", sql_ad_row_id: 42 });
    expect(sqlConn.commit).toHaveBeenCalled();
    // meta upsert ran against facebook_ad_ai_meta
    expect(sqlConn.calls.some((s) => s.includes("facebook_ad_ai_meta"))).toBe(true);
  });

  it("Option B: /ai-meta with category dual-writes SQL + mirrors category (name+ids) to ES", async () => {
    const sqlConn = mkSqlConn();
    const svc = setupWithSql({ adHits: [{ _id: "ad-1" }], sqlConn });
    const res = mkRes();
    const aiWithCat = { ...VALID_AI_META, category: "Retail", category_id: "1234", sub_category: "eCommerce", subcategory_id: "12340001" };
    await insertAiMeta({ body: { ad_id: "48979890", network: "instagram", ai_meta: aiWithCat } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.sql).toMatchObject({ sql_status: "stored", category_synced: true });
    // taxonomy sync + ES mirror both reported
    expect(res.body.category_sync).toBeTruthy();
    expect(res.body.category_sync.mirrored).toBe(true);
    // ES ad-doc mirror carries the dotted names AND the flat 4/8-char codes + confidence
    const mirror = svc.db.elastic.update.mock.calls.find((c) => c[0].body.doc && c[0].body.doc["instagram.category"] === "Retail");
    expect(mirror).toBeTruthy();
    expect(mirror[0].body.doc["instagram.subCategory"]).toBe("eCommerce");
    expect(mirror[0].body.doc.category_id).toBe("1234");
    expect(mirror[0].body.doc.subCategory_id).toBe("12340001");
    expect(mirror[0].body.doc.confidence_score).toBe(0);
  });

  it("Option B: no category in ai_meta → no ES category mirror, category_synced false", async () => {
    const sqlConn = mkSqlConn();
    const svc = setupWithSql({ adHits: [{ _id: "ad-1" }], sqlConn });
    const res = mkRes();
    await insertAiMeta({ body: { ad_id: "48979890", network: "instagram", ai_meta: VALID_AI_META } }, res);
    expect(res.body.sql).toMatchObject({ sql_status: "stored", category_synced: false });
    const mirror = svc.db.elastic.update.mock.calls.find((c) => c[0].body.doc && "instagram.category" in c[0].body.doc);
    expect(mirror).toBeUndefined();
  });

  // Regression guard: on ES 6.x the shared `category` index is mapped under `_doc`,
  // while per-network ad indices are mapped under `doc`. A scripted update sent to
  // the wrong type silently 404s as document_missing_exception (search sends no type,
  // so it masks the mismatch). withEsType must resolve `category` → `_doc`.
  it("Option B: taxonomy scripted-update on `category` uses type `_doc`; ad-doc mirror uses `doc`", async () => {
    const sqlConn = mkSqlConn();
    // Existing taxonomy doc with the SAME name+id but WITHOUT this platform → forces
    // the platform-add scripted update() on the `category` index.
    const existHits = [{ _id: "cat-1", _source: { category: "Retail", cat_id: "1234", platforms: [], subcategory: [] } }];
    const svc = setupWithSql({ adHits: [{ _id: "ad-1" }], sqlConn, existHits });
    const res = mkRes();
    const aiWithCat = { ...VALID_AI_META, category: "Retail", category_id: "1234", sub_category: "eCommerce", subcategory_id: "12340001" };
    await insertAiMeta({ body: { ad_id: "48979890", network: "instagram", ai_meta: aiWithCat } }, res);
    expect(res.statusCode).toBe(200);

    const catUpdates  = svc.db.elastic.update.mock.calls.filter((c) => c[0].index === "category");
    const adUpdates   = svc.db.elastic.update.mock.calls.filter((c) => c[0].index !== "category");
    expect(catUpdates.length).toBeGreaterThan(0);
    catUpdates.forEach((c) => expect(c[0].type).toBe("_doc"));
    adUpdates.forEach((c) => expect(c[0].type).toBe("doc"));
  });

  it("SQL failure is non-fatal — ES write still succeeds (ai_meta_status stored)", async () => {
    // getConnection throws → persistAiMeta returns error, controller still 200/stored
    const svc = {
      db: {
        elastic: {
          search: vi.fn(async (p) => (p.index === "category" ? { hits: { hits: [] } } : { hits: { hits: [{ _id: "ad-1", _source: {} }] } })),
          index: vi.fn(async () => {}), update: vi.fn(async () => {}),
        },
        sql: { getConnection: vi.fn(async () => { throw new Error("pool-empty"); }) },
      },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    serviceRegistry.getService.mockReturnValue(svc);
    const res = mkRes();
    await newCatInsertion({ body: { platform: "facebook", category: "FooCat", category_id: "1234", ad_id: 7, ai_meta: VALID_AI_META } }, res);
    expect(res.body.ai_meta_status).toBe("stored");
    expect(res.body.ai_meta_sql.sql_status).toBe("error");
  });
});
