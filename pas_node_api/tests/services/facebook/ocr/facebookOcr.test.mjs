import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── Leaf mocks (set BEFORE requiring the module under test) ───────────────────

// nasClient.resolveMediaUrl — deterministic, no config/env needed.
const nasPath = require.resolve("../../../../src/insertion/helpers/nasClient");
require.cache[nasPath] = {
  id: nasPath, filename: nasPath, loaded: true,
  exports: {
    resolveMediaUrl: (p) =>
      !p ? p : /^https?:\/\//i.test(p) ? p : "https://media.test/" + String(p).replace(/^\/+/, ""),
    storeInNas: vi.fn(), DEFAULT_IMAGE: "/DefaultImage.jpg", TYPE_SUBFOLDER: {},
  },
};

// facebook/ocr/repository — fully mocked; tests drive its return values.
const repoPath = require.resolve("../../../../src/services/facebook/ocr/repository");
const repo = {
  leaseImageAds: vi.fn(),
  updateStatusByAdIds: vi.fn(),
  getVariantByAdId: vi.fn(),
  updateVariant: vi.fn(),
};
require.cache[repoPath] = { id: repoPath, filename: repoPath, loaded: true, exports: repo };

// express + errorHandler (for the routes test only).
const expressPath = require.resolve("express");
const routerInstances = [];
function FakeRouter() {
  const r = {
    routes: { get: {}, post: {} },
    get: vi.fn((path, ...rest) => { r.routes.get[path] = rest; }),
    post: vi.fn((path, ...rest) => { r.routes.post[path] = rest; }),
  };
  routerInstances.push(r);
  return r;
}
require.cache[expressPath] = { id: expressPath, filename: expressPath, loaded: true, exports: { Router: FakeRouter } };
const errPath = require.resolve("../../../../src/middleware/errorHandler");
require.cache[errPath] = { id: errPath, filename: errPath, loaded: true, exports: { asyncHandler: (fn) => fn, AppError: class {} } };

// ── Modules under test (real code) ───────────────────────────────────────────
const { leaseImages } = require("../../../../src/services/facebook/ocr/services/getImageUrlService");
const { updateImageInfo } = require("../../../../src/services/facebook/ocr/services/updateImageOcrService");
const ctrl = require("../../../../src/services/facebook/controllers/facebookOcrController");
const createFacebookOcrRoutes = require("../../../../src/services/facebook/routes/facebookOcrRoutes");

const log = { error: vi.fn() };
const mkEs = ({ hits = [{ _id: "es1" }], result = "updated" } = {}) => ({
  indexName: "search_mix",
  search: vi.fn().mockResolvedValue({ hits: { hits } }),
  update: vi.fn().mockResolvedValue({ result }),
});
const mkRes = () => {
  const r = { statusCode: 200, body: null };
  r.status = vi.fn((c) => { r.statusCode = c; return r; });
  r.json = vi.fn((b) => { r.body = b; return r; });
  return r;
};

beforeEach(() => {
  for (const f of Object.values(repo)) f.mockReset();
  routerInstances.length = 0;
});

// ══════════════════════════════════════════════════════════════════════════════
describe("facebook/ocr getImageUrlService.leaseImages", () => {
  it("status=0 (OCB): no image_ocr select, resolves URL, flips batch to 2", async () => {
    repo.leaseImageAds.mockResolvedValue([{ ad_id: 1, image_url: "/pas/fb/a.jpg" }]);
    repo.updateStatusByAdIds.mockResolvedValue(1);
    const out = await leaseImages({ sql: {} }, log, "0");
    expect(repo.leaseImageAds).toHaveBeenCalledWith({}, 0, false);
    expect(out.code).toBe(200);
    expect(out.data[0].image_url).toBe("https://media.test/pas/fb/a.jpg");
    expect(repo.updateStatusByAdIds).toHaveBeenCalledWith({}, [1], 2);
  });

  it("status=4 (OCR): selects image_ocr (withOcr=true)", async () => {
    repo.leaseImageAds.mockResolvedValue([{ ad_id: 9, image_url: "https://cdn.x/a.jpg", image_ocr: "x" }]);
    repo.updateStatusByAdIds.mockResolvedValue(1);
    const out = await leaseImages({ sql: {} }, log, "4");
    expect(repo.leaseImageAds).toHaveBeenCalledWith({}, 4, true);
    expect(out.data[0].image_url).toBe("https://cdn.x/a.jpg"); // already absolute → untouched
  });

  it("takes the segment before the first || when resolving", async () => {
    repo.leaseImageAds.mockResolvedValue([{ ad_id: 2, image_url: "/p/a.jpg||/p/b.jpg" }]);
    repo.updateStatusByAdIds.mockResolvedValue(1);
    const out = await leaseImages({ sql: {} }, log, "0");
    expect(out.data[0].image_url).toBe("https://media.test/p/a.jpg");
  });

  it("empty queue → 400 'No More Image are present'", async () => {
    repo.leaseImageAds.mockResolvedValue([]);
    const out = await leaseImages({ sql: {} }, log, "0");
    expect(out).toMatchObject({ code: 400, message: "No More Image are present" });
    expect(repo.updateStatusByAdIds).not.toHaveBeenCalled();
  });

  it("no sql connection → 401", async () => {
    const out = await leaseImages({}, log, "0");
    expect(out.code).toBe(401);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("facebook/ocr updateImageOcrService.updateImageInfo", () => {
  it("variant missing → 400 'Please enter valid ad_id'", async () => {
    repo.getVariantByAdId.mockResolvedValue(null);
    const out = await updateImageInfo({ sql: {}, elastic: mkEs() }, log, { ad_id: 1, status: 1 });
    expect(out).toMatchObject({ code: 400, message: "Please enter valid ad_id" });
  });

  it("MySQL update affects no row → 400 'Ad not found' (ES not touched)", async () => {
    repo.getVariantByAdId.mockResolvedValue({ image_text_final_status: 0 });
    repo.updateVariant.mockResolvedValue(0);
    const es = mkEs();
    const out = await updateImageInfo({ sql: {}, elastic: es }, log, { ad_id: 1, status: 1 });
    expect(out).toMatchObject({ code: 400, message: "Ad not found" });
    expect(es.search).not.toHaveBeenCalled();
  });

  it("ES no hits → 400 'ad not found'", async () => {
    repo.getVariantByAdId.mockResolvedValue({ image_text_final_status: 0 });
    repo.updateVariant.mockResolvedValue(1);
    const es = mkEs({ hits: [] });
    const out = await updateImageInfo({ sql: {}, elastic: es }, log, { ad_id: 1, status: 1 });
    expect(out).toMatchObject({ code: 400, message: "ad not found" });
  });

  it("OCB success (status=1): MySQL first then ES; ES gets ARRAYS, NO image_ocr family; object_update_date", async () => {
    repo.getVariantByAdId.mockResolvedValue({ image_text_final_status: 0, image_ocr: "keep" });
    repo.updateVariant.mockResolvedValue(1);
    const es = mkEs();
    const out = await updateImageInfo({ sql: {}, elastic: es }, log,
      { ad_id: 7, status: 1, object: "a||b", celebrity: "", brand_logo: "Nike" }); // ocr omitted
    expect(out).toMatchObject({ code: 200, message: "Image Data Updated Successfully" });

    // MySQL write happened before ES.
    const mysqlOrder = repo.updateVariant.mock.invocationCallOrder[0];
    const esOrder = es.update.mock.invocationCallOrder[0];
    expect(mysqlOrder).toBeLessThan(esOrder);

    // ES stores ARRAYS (split on ||); no OCR family on status 1.
    const doc = es.update.mock.calls[0][0].body.doc;
    expect(doc["facebook_ad_variants.image_object"]).toEqual(["a", "b"]);
    expect(doc["facebook_ad_variants.image_object_exactly"]).toEqual(["a", "b"]);
    expect("facebook_ad_variants.image_ocr" in doc).toBe(false);

    // MySQL fields.
    const mysql = repo.updateVariant.mock.calls[0][2];
    expect(mysql.image_object).toBe("a||b");           // raw string to MySQL
    expect(mysql.image_ocr).toBe("keep");              // ocr omitted → existing kept
    expect(mysql.object_update_date).toBeTruthy();
    expect(mysql.ocr_updated_date).toBeUndefined();
    expect(mysql.image_text_final_status).toBe(1);     // was 0 → set to status
    expect(mysql.image_url_status).toBe(1);            // status 1 → status
  });

  it("OCR success (status=4): image_ocr family written as arrays; ocr_updated_date", async () => {
    repo.getVariantByAdId.mockResolvedValue({ image_text_final_status: 1, image_ocr: "old" });
    repo.updateVariant.mockResolvedValue(1);
    const es = mkEs();
    const out = await updateImageInfo({ sql: {}, elastic: es }, log,
      { ad_id: 7, status: 4, object: "obj", celebrity: "", brand_logo: "Nike", ocr: "buy||now" });
    expect(out.code).toBe(200);
    const doc = es.update.mock.calls[0][0].body.doc;
    expect(doc["facebook_ad_variants.image_ocr"]).toEqual(["buy", "now"]);
    expect(doc["facebook_ad_variants.image_ocr_ru"]).toEqual(["buy", "now"]);
    const mysql = repo.updateVariant.mock.calls[0][2];
    expect(mysql.image_ocr).toBe("buy||now");
    expect(mysql.ocr_updated_date).toBeTruthy();
    expect(mysql.image_url_status).toBe(4);
  });

  it("status=2 → image_url_status 3 when any pre-update column is null, else 1", async () => {
    // any null → 3
    repo.getVariantByAdId.mockResolvedValue({ image_text_final_status: 5, image_ocr: null });
    repo.updateVariant.mockResolvedValue(1);
    await updateImageInfo({ sql: {}, elastic: mkEs() }, log,
      { ad_id: 7, status: 2, object: "o", celebrity: "c", brand_logo: "b", ocr: "t" });
    expect(repo.updateVariant.mock.calls[0][2].image_url_status).toBe(3);

    // no null → 1
    repo.updateVariant.mockClear();
    repo.getVariantByAdId.mockResolvedValue({ image_text_final_status: 5, image_ocr: "x", a: 1, b: "y" });
    repo.updateVariant.mockResolvedValue(1);
    await updateImageInfo({ sql: {}, elastic: mkEs() }, log,
      { ad_id: 7, status: 2, object: "o", celebrity: "c", brand_logo: "b", ocr: "t" });
    expect(repo.updateVariant.mock.calls[0][2].image_url_status).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("facebook/ocr controller validation", () => {
  it("getImageUrl: missing status → 400", async () => {
    const out = await ctrl.getImageUrl({ query: {}, body: {} }, { sql: {} }, log);
    expect(out.code).toBe(400);
    expect(out.message).toMatch(/status/i);
  });
  it("updateImageOcr: missing ad_id → 400", async () => {
    const out = await ctrl.updateImageOcr({ body: {} }, { sql: {}, elastic: mkEs() }, log);
    expect(out.code).toBe(400);
    expect(out.message).toMatch(/ad_id/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("facebook/ocr routes", () => {
  it("registers the two OCR routes", () => {
    const router = createFacebookOcrRoutes({ db: { sql: {} }, log });
    expect(router.routes.get["/ocr/getFBImageUrl"]).toBeDefined();
    expect(router.routes.post["/ocr/update-image-info"]).toBeDefined();
  });

  it("GET handler always replies HTTP 200 with the service body", async () => {
    repo.leaseImageAds.mockResolvedValue([]);
    const router = createFacebookOcrRoutes({ db: { sql: {} }, log });
    const handler = router.routes.get["/ocr/getFBImageUrl"].slice(-1)[0];
    const res = mkRes();
    await handler({ query: { status: "0" }, body: {} }, res);
    expect(res.statusCode).toBe(200);            // HTTP 200 envelope
    expect(res.body.code).toBe(400);             // outcome in body.code
  });
});
