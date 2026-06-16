import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── Mock the repository ──────────────────────────────────────────────
const repoPath = require.resolve("../../../../../src/services/quora/ocr/repository");
const repo = {
  getImagesUrl: vi.fn(),
  updateStatusMultiple: vi.fn(),
  getVariantByAdId: vi.fn(),
  updateVariant: vi.fn(),
};
require.cache[repoPath] = { id: repoPath, filename: repoPath, loaded: true, exports: repo };

const svc = require("../../../../../src/services/quora/ocr/services/updateImageOcrService");
const fakeLog = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

/** Minimal variant row with no null columns (so status-2 path resolves to 1). */
function variant(extra = {}) {
  return { id: 1, quora_ad_id: 8515, image_text_final_status: 5, image_ocr: "old", ...extra };
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

describe("services/quora/ocr/updateImageOcrService > guards", () => {
  it("400 'Please enter valid ad_id' when no variant row", async () => {
    repo.getVariantByAdId.mockResolvedValue(null);
    const out = await svc.updateImageOcrDetails({ ad_id: 1, status: 4 }, { sql: {} }, fakeLog);
    expect(out).toEqual({ code: 400, message: "Please enter valid ad_id" });
    expect(repo.updateVariant).not.toHaveBeenCalled();
  });

  it("200 after SQL update when no elastic configured", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    const out = await svc.updateImageOcrDetails({ ad_id: 8515, status: 1 }, { sql: {} }, fakeLog);
    expect(out).toEqual({ code: 200, message: "Image Data Updated Successfully" });
    expect(repo.updateVariant).toHaveBeenCalled();
  });
});

describe("services/quora/ocr/updateImageOcrService > MySQL payload", () => {
  it("overwrites object/celebrity/brand; keeps image_ocr when ocr omitted", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    await svc.updateImageOcrDetails(
      { ad_id: 8515, status: 1, object: "car", celebrity: "z", brand_logo: "nike" },
      { sql: {} }, fakeLog
    );
    const payload = repo.updateVariant.mock.calls[0][2];
    expect(payload.image_object).toBe("car");
    expect(payload.image_celebrity).toBe("z");
    expect(payload.image_brand_logo).toBe("nike");
    expect(payload.image_ocr).toBe("old"); // kept
    expect(payload.object_update_date).toBeTruthy(); // status 1
    expect(payload.ocr_updated_date).toBeUndefined();
    expect(payload.image_url_status).toBe(1);
  });

  it("sets image_ocr + ocr_updated_date and image_url_status=4 on status 4", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    await svc.updateImageOcrDetails(
      { ad_id: 8515, status: 4, object: "car", celebrity: "z", brand_logo: "nike", ocr: "buy||now" },
      { sql: {} }, fakeLog
    );
    const payload = repo.updateVariant.mock.calls[0][2];
    expect(payload.image_ocr).toBe("buy||now");
    expect(payload.ocr_updated_date).toBeTruthy();
    expect(payload.object_update_date).toBeUndefined();
    expect(payload.image_url_status).toBe(4);
  });

  it("nulls fields when omitted (overwrite, not append)", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    await svc.updateImageOcrDetails({ ad_id: 8515, status: 1 }, { sql: {} }, fakeLog);
    const payload = repo.updateVariant.mock.calls[0][2];
    expect(payload.image_object).toBeNull();
    expect(payload.image_celebrity).toBeNull();
    expect(payload.image_brand_logo).toBeNull();
  });

  it("sets image_text_final_status only when it was 0", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant({ image_text_final_status: 0 }));
    await svc.updateImageOcrDetails({ ad_id: 8515, status: 4 }, { sql: {} }, fakeLog);
    expect(repo.updateVariant.mock.calls[0][2].image_text_final_status).toBe(4);
  });

  it("status 2 → 1 when no null columns, 3 when a column is null", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    await svc.updateImageOcrDetails({ ad_id: 8515, status: 2 }, { sql: {} }, fakeLog);
    expect(repo.updateVariant.mock.calls[0][2].image_url_status).toBe(1);

    repo.updateVariant.mockClear();
    repo.getVariantByAdId.mockResolvedValue(variant({ some_col: null }));
    await svc.updateImageOcrDetails({ ad_id: 8515, status: 2 }, { sql: {} }, fakeLog);
    expect(repo.updateVariant.mock.calls[0][2].image_url_status).toBe(3);
  });
});

describe("services/quora/ocr/updateImageOcrService > Elasticsearch", () => {
  it("uses quora_search_mix index and matches quora_ad.id", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    const elastic = mkElastic();
    await svc.updateImageOcrDetails({ ad_id: 8515, status: 1 }, { sql: {}, elastic }, fakeLog);
    const searchArg = elastic.search.mock.calls[0][0];
    expect(searchArg.index).toBe("quora_search_mix");
    expect(searchArg.body.query.match["quora_ad.id"]).toBe(8515);
  });

  it("400 'ad not found' when ES returns no hits", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    const elastic = mkElastic({ hits: [] });
    const out = await svc.updateImageOcrDetails({ ad_id: 8515, status: 1 }, { sql: {}, elastic }, fakeLog);
    expect(out).toEqual({ code: 400, message: "ad not found" });
    expect(elastic.update).not.toHaveBeenCalled();
  });

  it("200 when ES update result is 'updated'", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    const elastic = mkElastic({ updateResult: "updated" });
    const out = await svc.updateImageOcrDetails({ ad_id: 8515, status: 1 }, { sql: {}, elastic }, fakeLog);
    expect(out).toEqual({ code: 200, message: "Image Data Updated Successfully" });
  });

  it("400 'ad not found' on ES no-op (quora parity, not 'Image Object not updated')", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    const elastic = mkElastic({ updateResult: "noop" });
    const out = await svc.updateImageOcrDetails({ ad_id: 8515, status: 1 }, { sql: {}, elastic }, fakeLog);
    expect(out).toEqual({ code: 400, message: "ad not found" });
  });

  it("writes quora_ad_variants.* doc fields; adds image_ocr family only on status 4", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());

    const e1 = mkElastic();
    await svc.updateImageOcrDetails(
      { ad_id: 8515, status: 1, object: "a||b" }, { sql: {}, elastic: e1 }, fakeLog
    );
    const doc1 = e1.update.mock.calls[0][0].body.doc;
    expect(doc1["quora_ad_variants.image_object"]).toEqual(["a", "b"]);
    expect(doc1["quora_ad_variants.image_object_exactly"]).toEqual(["a", "b"]);
    expect(doc1["quora_ad_variants.image_ocr"]).toBeUndefined();
    expect(e1.update.mock.calls[0][0].body.detect_noop).toBe(false);

    const e2 = mkElastic();
    await svc.updateImageOcrDetails(
      { ad_id: 8515, status: 4, ocr: "x||y" }, { sql: {}, elastic: e2 }, fakeLog
    );
    const doc2 = e2.update.mock.calls[0][0].body.doc;
    expect(doc2["quora_ad_variants.image_ocr"]).toEqual(["x", "y"]);
    expect(doc2["quora_ad_variants.image_ocr_exactly"]).toEqual(["x", "y"]);
  });

  it("reads ES result via body.result fallback (v7 shape)", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    const elastic = {
      search: vi.fn(async () => ({ body: { hits: { hits: [{ _id: "d" }] } } })),
      update: vi.fn(async () => ({ body: { result: "updated" } })),
    };
    const out = await svc.updateImageOcrDetails({ ad_id: 8515, status: 1 }, { sql: {}, elastic }, fakeLog);
    expect(out.code).toBe(200);
  });
});
