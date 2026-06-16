import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── Mock the repository ──────────────────────────────────────────────
const repoPath = require.resolve("../../../../../src/services/reddit/ocr/repository");
const repo = {
  getImagesUrl: vi.fn(),
  updateStatusMultiple: vi.fn(),
  getVariantByAdId: vi.fn(),
  updateVariant: vi.fn(),
};
require.cache[repoPath] = { id: repoPath, filename: repoPath, loaded: true, exports: repo };

const svc = require("../../../../../src/services/reddit/ocr/services/updateImageOcrService");
const fakeLog = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

/** Variant row. image_text_final_status defaults to 5 (so it is NOT overwritten);
 *  image_ocr defaults to null (so a posted ocr is used unless kept-existing is tested). */
function variant(extra = {}) {
  return { id: 1, reddit_ad_id: 8515, image_text_final_status: 5, image_ocr: null, ...extra };
}

function mkElastic({ hits = [{ _id: "doc1" }], updateResult = "updated" } = {}) {
  return {
    search: vi.fn(async () => ({ hits: { hits } })),
    update: vi.fn(async () => ({ result: updateResult })),
  };
}

beforeEach(() => {
  repo.getVariantByAdId.mockReset();
  repo.updateVariant.mockReset().mockResolvedValue(1);
});

describe("services/reddit/ocr/updateImageOcrService > guards", () => {
  it("400 'ad_id is not available' when no variant row", async () => {
    repo.getVariantByAdId.mockResolvedValue(null);
    const out = await svc.updateImageDetails({ ad_id: 1, status: 4 }, { sql: {} }, fakeLog);
    expect(out).toEqual({ code: 400, message: "ad_id is not available" });
    expect(repo.updateVariant).not.toHaveBeenCalled();
  });

  it("400 'ad_id is not available' when ad_id missing (no DB lookup attempted)", async () => {
    const out = await svc.updateImageDetails({ status: 1 }, { sql: {} }, fakeLog);
    expect(out).toEqual({ code: 400, message: "ad_id is not available" });
    expect(repo.getVariantByAdId).not.toHaveBeenCalled();
  });

  it("200 ' Image Data Updated Successfully' (leading space) when no elastic configured", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    const out = await svc.updateImageDetails({ ad_id: 8515, status: 1 }, { sql: {} }, fakeLog);
    expect(out).toEqual({ code: 200, message: " Image Data Updated Successfully" });
    expect(repo.updateVariant).toHaveBeenCalled();
  });
});

describe("services/reddit/ocr/updateImageOcrService > MySQL payload", () => {
  it("status 1: overwrites object/celebrity/brand, sets object_update_date, image_url_status=1", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    await svc.updateImageDetails(
      { ad_id: 8515, status: 1, object: "car", celebrity: "z", brand_logo: "nike" },
      { sql: {} }, fakeLog
    );
    const payload = repo.updateVariant.mock.calls[0][2];
    expect(payload.image_object).toBe("car");
    expect(payload.image_celebrity).toBe("z");
    expect(payload.image_brand_logo).toBe("nike");
    expect(payload.image_url_status).toBe(1);
    expect(payload.object_update_date).toBeTruthy();
    expect(payload.ocr_updated_date).toBeUndefined();
  });

  it("multi-value (|| → JSON array string) stored in MySQL", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    await svc.updateImageDetails(
      { ad_id: 8515, status: 1, celebrity: "Messi||Ronaldo" }, { sql: {} }, fakeLog
    );
    const payload = repo.updateVariant.mock.calls[0][2];
    expect(payload.image_celebrity).toBe('["Messi","Ronaldo"]');
  });

  it("empty / omitted single-value fields become null", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    await svc.updateImageDetails({ ad_id: 8515, status: 1 }, { sql: {} }, fakeLog);
    const payload = repo.updateVariant.mock.calls[0][2];
    expect(payload.image_object).toBeNull();
    expect(payload.image_celebrity).toBeNull();
    expect(payload.image_brand_logo).toBeNull();
  });

  it("status 4: sets ocr_updated_date and image_url_status=4", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    await svc.updateImageDetails(
      { ad_id: 8515, status: 4, ocr: "buy||now" }, { sql: {} }, fakeLog
    );
    const payload = repo.updateVariant.mock.calls[0][2];
    expect(payload.image_ocr).toBe('["buy","now"]');
    expect(payload.image_url_status).toBe(4);
    expect(payload.ocr_updated_date).toBeTruthy();
    expect(payload.object_update_date).toBeUndefined();
  });

  it("ocr keeps the existing row value when present and posted ocr is single-valued/empty", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant({ image_ocr: "OLD TEXT" }));
    await svc.updateImageDetails({ ad_id: 8515, status: 4, ocr: "" }, { sql: {} }, fakeLog);
    expect(repo.updateVariant.mock.calls[0][2].image_ocr).toBe("OLD TEXT");
  });

  it("ocr uses the posted value when existing image_ocr is null", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant({ image_ocr: null }));
    await svc.updateImageDetails({ ad_id: 8515, status: 4, ocr: "fresh" }, { sql: {} }, fakeLog);
    expect(repo.updateVariant.mock.calls[0][2].image_ocr).toBe("fresh");
  });

  it("multi-valued posted ocr (||) overrides the existing image_ocr", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant({ image_ocr: "OLD" }));
    await svc.updateImageDetails({ ad_id: 8515, status: 4, ocr: "x||y" }, { sql: {} }, fakeLog);
    expect(repo.updateVariant.mock.calls[0][2].image_ocr).toBe('["x","y"]');
  });

  it("image_url_status stays 0 for status 2 (reddit has NO status-2 3/1 branch)", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant({ some_col: null }));
    await svc.updateImageDetails(
      { ad_id: 8515, status: 2, object: "a", celebrity: "b", brand_logo: "c", ocr: "d" },
      { sql: {} }, fakeLog
    );
    expect(repo.updateVariant.mock.calls[0][2].image_url_status).toBe(0);
  });

  it("sets image_text_final_status only when it was 0", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant({ image_text_final_status: 0 }));
    await svc.updateImageDetails({ ad_id: 8515, status: 4 }, { sql: {} }, fakeLog);
    expect(repo.updateVariant.mock.calls[0][2].image_text_final_status).toBe(4);

    repo.updateVariant.mockClear();
    repo.getVariantByAdId.mockResolvedValue(variant({ image_text_final_status: 5 }));
    await svc.updateImageDetails({ ad_id: 8515, status: 4 }, { sql: {} }, fakeLog);
    expect(repo.updateVariant.mock.calls[0][2].image_text_final_status).toBeUndefined();
  });
});

describe("services/reddit/ocr/updateImageOcrService > Elasticsearch", () => {
  it("uses reddit_search_mix index and matches reddit_ad.id", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    const elastic = mkElastic();
    await svc.updateImageDetails({ ad_id: 8515, status: 1 }, { sql: {}, elastic }, fakeLog);
    const searchArg = elastic.search.mock.calls[0][0];
    expect(searchArg.index).toBe("reddit_search_mix");
    expect(searchArg.body.query.match["reddit_ad.id"]).toBe(8515);
  });

  it("400 'Ad not found<br>' when ES returns no hits", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    const elastic = mkElastic({ hits: [] });
    const out = await svc.updateImageDetails({ ad_id: 8515, status: 1 }, { sql: {}, elastic }, fakeLog);
    expect(out).toEqual({ code: 400, message: "Ad not found<br>" });
    expect(elastic.update).not.toHaveBeenCalled();
  });

  it("200 ' Image Data Updated Successfully' when ES update result is 'updated'", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    const elastic = mkElastic({ updateResult: "updated" });
    const out = await svc.updateImageDetails({ ad_id: 8515, status: 1 }, { sql: {}, elastic }, fakeLog);
    expect(out).toEqual({ code: 200, message: " Image Data Updated Successfully" });
  });

  it("400 'ad not found' on ES no-op", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    const elastic = mkElastic({ updateResult: "noop" });
    const out = await svc.updateImageDetails({ ad_id: 8515, status: 1 }, { sql: {}, elastic }, fakeLog);
    expect(out).toEqual({ code: 400, message: "ad not found" });
  });

  it("writes reddit_ad_variants.* doc fields; image_ocr family only on status 4; detect_noop false", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());

    const e1 = mkElastic();
    await svc.updateImageDetails(
      { ad_id: 8515, status: 1, object: "a||b" }, { sql: {}, elastic: e1 }, fakeLog
    );
    const doc1 = e1.update.mock.calls[0][0].body.doc;
    expect(doc1["reddit_ad_variants.image_object"]).toEqual(["a", "b"]);
    expect(doc1["reddit_ad_variants.image_object_exactly"]).toEqual(["a", "b"]);
    expect(doc1["reddit_ad_variants.image_ocr"]).toBeUndefined();
    expect(e1.update.mock.calls[0][0].body.detect_noop).toBe(false);

    const e2 = mkElastic();
    await svc.updateImageDetails(
      { ad_id: 8515, status: 4, ocr: "x||y" }, { sql: {}, elastic: e2 }, fakeLog
    );
    const doc2 = e2.update.mock.calls[0][0].body.doc;
    expect(doc2["reddit_ad_variants.image_ocr"]).toEqual(["x", "y"]);
    expect(doc2["reddit_ad_variants.image_ocr_exactly"]).toEqual(["x", "y"]);
  });

  it("single-value field is mirrored to ES as a raw scalar", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    const elastic = mkElastic();
    await svc.updateImageDetails(
      { ad_id: 8515, status: 1, object: "car" }, { sql: {}, elastic }, fakeLog
    );
    expect(elastic.update.mock.calls[0][0].body.doc["reddit_ad_variants.image_object"]).toBe("car");
  });

  it("reads ES result via body.result fallback (v7 shape)", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    const elastic = {
      search: vi.fn(async () => ({ body: { hits: { hits: [{ _id: "d" }] } } })),
      update: vi.fn(async () => ({ body: { result: "updated" } })),
    };
    const out = await svc.updateImageDetails({ ad_id: 8515, status: 1 }, { sql: {}, elastic }, fakeLog);
    expect(out.code).toBe(200);
  });
});
