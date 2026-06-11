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

const { getDescriptionDetails, newCatInsertion } = require(
  "../../../../src/services/common/controllers/addCategoryController"
);

function mkRes() {
  const r = { statusCode: 200, body: null };
  r.status = vi.fn((c) => { r.statusCode = c; return r; });
  r.json = vi.fn((b) => { r.body = b; return r; });
  return r;
}

function mkService({ esSearch, esIndex, esUpdate, log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } } = {}) {
  return { db: { elastic: { search: esSearch, index: esIndex, update: esUpdate } }, log };
}

beforeEach(() => {
  serviceRegistry.getService.mockReset();
  syncCategory.mockReset().mockResolvedValue();
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
      "facebook_ad_variants.image_ocr": "OCR",
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
    await newCatInsertion(valReq({ sub_category: "abc", subcategory_id: "12345678" }), res);
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

  it("inserts new category when none exists + updates ad doc", async () => {
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
    expect(indexFn).toHaveBeenCalledWith(expect.objectContaining({ index: "category" }));
    expect(updateFn).toHaveBeenCalled();
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

  it("ad doc not found → warns and continues, 200", async () => {
    setupES({ existHits: [], adHits: [] });
    const res = mkRes();
    await newCatInsertion(happyBody(), res);
    expect(res.statusCode).toBe(200);
  });

  it("ad update throws → warn (still 200)", async () => {
    setupES({ existHits: [], adHits: [{ _id: "ad" }], updateFn: vi.fn(async () => { throw new Error("upd-fail"); }) });
    const res = mkRes();
    await newCatInsertion(happyBody(), res);
    expect(res.statusCode).toBe(200);
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
