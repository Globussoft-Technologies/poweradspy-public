import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── Leaf mocks (set BEFORE requiring the module under test) ───────────────────

const nasPath = require.resolve("../../../../src/insertion/helpers/nasClient");
require.cache[nasPath] = {
  id: nasPath, filename: nasPath, loaded: true,
  exports: {
    resolveMediaUrl: (p) =>
      !p ? p : /^https?:\/\//i.test(p) ? p : "https://media.test/" + String(p).replace(/^\/+/, ""),
    storeInNas: vi.fn(), DEFAULT_IMAGE: "/DefaultImage.jpg", TYPE_SUBFOLDER: {},
  },
};

const repoPath = require.resolve("../../../../src/services/youtube/ocr/repository");
const repo = {
  leaseImageAds: vi.fn(),
  updateVariantStatusByAdIds: vi.fn(),
  ocbRowExists: vi.fn(),
  insertOcb: vi.fn(),
  updateOcb: vi.fn(),
  updateVariantStatus: vi.fn(),
};
require.cache[repoPath] = { id: repoPath, filename: repoPath, loaded: true, exports: repo };

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
const { leaseOcb } = require("../../../../src/services/youtube/ocr/services/getOcbUrlService");
const { insertUpdateOcb } = require("../../../../src/services/youtube/ocr/services/insertUpdateOcbService");
const ctrl = require("../../../../src/services/youtube/controllers/youtubeOcrController");
const createYoutubeOcrRoutes = require("../../../../src/services/youtube/routes/youtubeOcrRoutes");

const log = { error: vi.fn() };
const mkEs = ({ result = "updated" } = {}) => ({
  indexName: "youtube_ads_data",
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
describe("youtube/ocr getOcbUrlService.leaseOcb", () => {
  it("type=1: image lease, resolves URL, flips batch to ocb_url_status=1", async () => {
    repo.leaseImageAds.mockResolvedValue([{ ad_id: 1, image_url: "/pas/yt/a.webp" }]);
    repo.updateVariantStatusByAdIds.mockResolvedValue(1);
    const out = await leaseOcb({ sql: {} }, log, "1");
    expect(repo.leaseImageAds).toHaveBeenCalledWith({}, 0); // PENDING
    expect(out.code).toBe(200);
    expect(out.data[0].image_url).toBe("https://media.test/pas/yt/a.webp");
    expect(repo.updateVariantStatusByAdIds).toHaveBeenCalledWith({}, [1], 1); // LEASED=1
  });

  it("empty queue → code 400", async () => {
    repo.leaseImageAds.mockResolvedValue([]);
    const out = await leaseOcb({ sql: {} }, log, "1");
    expect(out.code).toBe(400);
    expect(repo.updateVariantStatusByAdIds).not.toHaveBeenCalled();
  });

  it("type other than 1 → code 404 (legacy type=2 video lease was dropped)", async () => {
    expect((await leaseOcb({ sql: {} }, log, "2")).code).toBe(404);
    expect((await leaseOcb({ sql: {} }, log, "9")).code).toBe(404);
    expect(repo.leaseImageAds).not.toHaveBeenCalled();
  });

  it("no sql connection → code 500", async () => {
    expect((await leaseOcb({}, log, "1")).code).toBe(500);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("youtube/ocr insertUpdateOcbService.insertUpdateOcb", () => {
  it("OCB (status=1) new row: inserts youtube_ad_ocb, flips variant, ES image_object/celebrity/brand arrays, NO image_ocr", async () => {
    repo.ocbRowExists.mockResolvedValue(false);
    repo.insertOcb.mockResolvedValue(true);
    repo.updateVariantStatus.mockResolvedValue(1);
    const es = mkEs();
    const out = await insertUpdateOcb({ sql: {}, elastic: es }, log,
      { ad_id: 7, status: 1, object: "shoe||bottle", celebrity: "", brand_logo: "Nike", ocr: "" });
    expect(out).toMatchObject({ code: 200, message: "Image Data Updated Successfully" });

    // youtube_ad_ocb insert payload
    const ocb = repo.insertOcb.mock.calls[0][2];
    expect(ocb.object).toBe("shoe||bottle");
    expect(ocb.brand_logo).toBe("Nike");
    expect(ocb.object_update_date).toBeTruthy();
    expect("ocr" in ocb).toBe(false);

    // variant status flip uses raw body.status
    expect(repo.updateVariantStatus).toHaveBeenCalledWith({}, 7, 1);

    // ES doc: arrays, image_brand (not image_brand_logo), no image_ocr, no language families
    const doc = es.update.mock.calls[0][0].body.doc;
    expect(doc.image_object).toEqual(["shoe", "bottle"]);
    expect(doc.image_celebrity).toEqual([""]);
    expect(doc.image_brand).toEqual(["Nike"]);
    expect("image_ocr" in doc).toBe(false);
    expect("image_object_ru" in doc).toBe(false);
    expect(es.update.mock.calls[0][0].id).toBe(7); // updated by _id directly
  });

  it("OCR (status=4): ES writes image_ocr array only; ocr_update_date stamped", async () => {
    repo.ocbRowExists.mockResolvedValue(false);
    repo.insertOcb.mockResolvedValue(true);
    repo.updateVariantStatus.mockResolvedValue(1);
    const es = mkEs();
    const out = await insertUpdateOcb({ sql: {}, elastic: es }, log,
      { ad_id: 7, status: 4, ocr: "buy||now" });
    expect(out.code).toBe(200);
    const ocb = repo.insertOcb.mock.calls[0][2];
    expect(ocb.ocr).toBe("buy||now");
    expect(ocb.ocr_update_date).toBeTruthy();
    const doc = es.update.mock.calls[0][0].body.doc;
    expect(doc.image_ocr).toEqual(["buy", "now"]);
    expect("image_object" in doc).toBe(false);
  });

  it("existing row, update changes nothing → 400 'Image Data is already updated' (ES skipped)", async () => {
    repo.ocbRowExists.mockResolvedValue(true);
    repo.updateOcb.mockResolvedValue(0); // affectedRows 0
    repo.updateVariantStatus.mockResolvedValue(1);
    const es = mkEs();
    const out = await insertUpdateOcb({ sql: {}, elastic: es }, log,
      { ad_id: 7, status: 1, object: "x", celebrity: "", brand_logo: "y", ocr: "" });
    expect(out).toMatchObject({ code: 400, message: "Image Data is already updated" });
    expect(es.update).not.toHaveBeenCalled();
    expect(repo.updateVariantStatus).toHaveBeenCalled(); // variant flip still runs
  });

  it("ES update noop → 400 'Image Object not updated'", async () => {
    repo.ocbRowExists.mockResolvedValue(true);
    repo.updateOcb.mockResolvedValue(1);
    repo.updateVariantStatus.mockResolvedValue(1);
    const es = mkEs({ result: "noop" });
    const out = await insertUpdateOcb({ sql: {}, elastic: es }, log,
      { ad_id: 7, status: 1, object: "x", celebrity: "", brand_logo: "y", ocr: "" });
    expect(out).toMatchObject({ code: 400, message: "Image Object not updated" });
  });

  it("no sql/elastic → 500 'DB Exception'", async () => {
    const out = await insertUpdateOcb({ sql: null, elastic: null }, log, { ad_id: 7, status: 1 });
    expect(out).toMatchObject({ code: 500, messages: "DB Exception" });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("youtube/ocr controller (buildResponse shaping + validation)", () => {
  it("getOcbUrl 200 → { code, messages: 'Success', data }", async () => {
    repo.leaseImageAds.mockResolvedValue([{ ad_id: 1, image_url: "/p/a.webp" }]);
    repo.updateVariantStatusByAdIds.mockResolvedValue(1);
    const out = await ctrl.getOcbUrl({ query: { type: "1" }, body: {} }, { sql: {} }, log);
    expect(out.code).toBe(200);
    expect(out.messages).toBe("Success");
    expect(Array.isArray(out.data)).toBe(true);
  });

  it("getOcbUrl empty → { code: 400, messages: 'No data found' }", async () => {
    repo.leaseImageAds.mockResolvedValue([]);
    const out = await ctrl.getOcbUrl({ query: { type: "1" }, body: {} }, { sql: {} }, log);
    expect(out).toMatchObject({ code: 400, messages: "No data found" });
  });

  it("getOcbUrl bad type → { code: 404, messages: 'Missing Parameter' }", async () => {
    const out = await ctrl.getOcbUrl({ query: { type: "2" }, body: {} }, { sql: {} }, log);
    expect(out).toMatchObject({ code: 404, messages: "Missing Parameter", error: "" });
  });

  it("updateOcb missing ad_id/status → 404 Missing Parameter", async () => {
    const out = await ctrl.updateOcb({ body: { object: "x" } }, { sql: {}, elastic: mkEs() }, log);
    expect(out).toMatchObject({ code: 404, messages: "Missing Parameter" });
  });
});

// ══════════════════════════════════════════════════════════════════════════════
describe("youtube/ocr routes", () => {
  it("registers the two OCB routes", () => {
    const router = createYoutubeOcrRoutes({ db: { sql: {} }, log });
    expect(router.routes.get["/ocr/get-ocb-url"]).toBeDefined();
    expect(router.routes.post["/ocr/insert-update-ocb"]).toBeDefined();
  });

  it("GET handler always replies HTTP 200 with the service body", async () => {
    repo.leaseImageAds.mockResolvedValue([]);
    const router = createYoutubeOcrRoutes({ db: { sql: {} }, log });
    const handler = router.routes.get["/ocr/get-ocb-url"].slice(-1)[0];
    const res = mkRes();
    await handler({ query: { type: "1" }, body: {} }, res);
    expect(res.statusCode).toBe(200);     // HTTP 200 envelope
    expect(res.body.code).toBe(400);      // outcome in body.code
  });
});
