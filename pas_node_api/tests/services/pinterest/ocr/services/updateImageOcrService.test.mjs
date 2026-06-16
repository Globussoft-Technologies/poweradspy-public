import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── Mock the repository ──────────────────────────────────────────────
const repoPath = require.resolve("../../../../../src/services/pinterest/ocr/repository");
const repo = {
  getImagesUrl: vi.fn(),
  updateStatusMultiple: vi.fn(),
  getVariantByAdId: vi.fn(),
  updateVariant: vi.fn(),
};
require.cache[repoPath] = { id: repoPath, filename: repoPath, loaded: true, exports: repo };

const svc = require("../../../../../src/services/pinterest/ocr/services/updateImageOcrService");
const fakeLog = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

/**
 * Variant row (full `SELECT *` shape). All columns non-null by default so
 * hasNullColumn() is false; image_text_final_status = 5 (NOT 0, so it is not
 * overwritten); image_ocr = 'OLD' so the "keep existing" path can be exercised.
 */
function variant(extra = {}) {
  return {
    id: 1,
    pinterest_ad_id: 107168,
    image_text_final_status: 5,
    image_object: "o",
    image_celebrity: "c",
    image_brand_logo: "b",
    image_ocr: "OLD",
    image_url: "u.jpg",
    image_url_status: 2,
    ...extra,
  };
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

describe("services/pinterest/ocr/updateImageOcrService > guards", () => {
  it("400 'Please enter valid ad_id' when no variant row", async () => {
    repo.getVariantByAdId.mockResolvedValue(null);
    const out = await svc.updateImageOcrDetails({ ad_id: 1, status: 4 }, { sql: {} }, fakeLog);
    expect(out).toEqual({ code: 400, message: "Please enter valid ad_id" });
    expect(repo.updateVariant).not.toHaveBeenCalled();
  });

  it("200 'Image Data Updated Successfully' when no elastic configured (SQL already written)", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    const out = await svc.updateImageOcrDetails({ ad_id: 107168, status: 1 }, { sql: {} }, fakeLog);
    expect(out).toEqual({ code: 200, message: "Image Data Updated Successfully" });
    expect(repo.updateVariant).toHaveBeenCalled();
  });
});

describe("services/pinterest/ocr/updateImageOcrService > MySQL payload", () => {
  it("status 1: overwrites object/celebrity/brand, sets object_update_date, image_url_status=1", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    await svc.updateImageOcrDetails(
      { ad_id: 107168, status: 1, object: "car", celebrity: "z", brand_logo: "nike" },
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

  it("multi-value stays a raw '||'-delimited string in MySQL (no JSON encoding)", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    await svc.updateImageOcrDetails(
      { ad_id: 107168, status: 1, celebrity: "Messi||Ronaldo" }, { sql: {} }, fakeLog
    );
    expect(repo.updateVariant.mock.calls[0][2].image_celebrity).toBe("Messi||Ronaldo");
  });

  it("omitted single-value fields become null", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    await svc.updateImageOcrDetails({ ad_id: 107168, status: 1 }, { sql: {} }, fakeLog);
    const payload = repo.updateVariant.mock.calls[0][2];
    expect(payload.image_object).toBeNull();
    expect(payload.image_celebrity).toBeNull();
    expect(payload.image_brand_logo).toBeNull();
  });

  it("status 4: sets ocr_updated_date and image_url_status=4", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    await svc.updateImageOcrDetails(
      { ad_id: 107168, status: 4, ocr: "buy||now" }, { sql: {} }, fakeLog
    );
    const payload = repo.updateVariant.mock.calls[0][2];
    expect(payload.image_ocr).toBe("buy||now");
    expect(payload.image_url_status).toBe(4);
    expect(payload.ocr_updated_date).toBeTruthy();
    expect(payload.object_update_date).toBeUndefined();
  });

  it("ocr keeps the existing row value when omitted", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant({ image_ocr: "OLD TEXT" }));
    await svc.updateImageOcrDetails({ ad_id: 107168, status: 4 }, { sql: {} }, fakeLog);
    expect(repo.updateVariant.mock.calls[0][2].image_ocr).toBe("OLD TEXT");
  });

  it("ocr overwrites with an empty string when an empty ocr is explicitly sent", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant({ image_ocr: "OLD TEXT" }));
    await svc.updateImageOcrDetails({ ad_id: 107168, status: 4, ocr: "" }, { sql: {} }, fakeLog);
    expect(repo.updateVariant.mock.calls[0][2].image_ocr).toBe("");
  });

  it("status 2: image_url_status=3 when any variant column is null", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant({ image_brand_logo: null }));
    await svc.updateImageOcrDetails(
      { ad_id: 107168, status: 2, object: "a", celebrity: "b", brand_logo: "c", ocr: "d" },
      { sql: {} }, fakeLog
    );
    expect(repo.updateVariant.mock.calls[0][2].image_url_status).toBe(3);
  });

  it("status 2: image_url_status=1 when no variant column is null", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant()); // all non-null
    await svc.updateImageOcrDetails(
      { ad_id: 107168, status: 2, object: "a", celebrity: "b", brand_logo: "c", ocr: "d" },
      { sql: {} }, fakeLog
    );
    expect(repo.updateVariant.mock.calls[0][2].image_url_status).toBe(1);
  });

  it("sets image_text_final_status only when it was 0", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant({ image_text_final_status: 0 }));
    await svc.updateImageOcrDetails({ ad_id: 107168, status: 4 }, { sql: {} }, fakeLog);
    expect(repo.updateVariant.mock.calls[0][2].image_text_final_status).toBe(4);

    repo.updateVariant.mockClear();
    repo.getVariantByAdId.mockResolvedValue(variant({ image_text_final_status: 5 }));
    await svc.updateImageOcrDetails({ ad_id: 107168, status: 4 }, { sql: {} }, fakeLog);
    expect(repo.updateVariant.mock.calls[0][2].image_text_final_status).toBeUndefined();
  });
});

describe("services/pinterest/ocr/updateImageOcrService > Elasticsearch", () => {
  it("uses pinterest_search_mix index and matches pinterest_ad.id", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    const elastic = mkElastic();
    await svc.updateImageOcrDetails({ ad_id: 107168, status: 1 }, { sql: {}, elastic }, fakeLog);
    const searchArg = elastic.search.mock.calls[0][0];
    expect(searchArg.index).toBe("pinterest_search_mix");
    expect(searchArg.body.query.match["pinterest_ad.id"]).toBe(107168);
  });

  it("400 'ad not found' when ES returns no hits", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    const elastic = mkElastic({ hits: [] });
    const out = await svc.updateImageOcrDetails({ ad_id: 107168, status: 1 }, { sql: {}, elastic }, fakeLog);
    expect(out).toEqual({ code: 400, message: "ad not found" });
    expect(elastic.update).not.toHaveBeenCalled();
  });

  it("200 'Image Data Updated Successfully' when ES update result is 'updated'", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    const elastic = mkElastic({ updateResult: "updated" });
    const out = await svc.updateImageOcrDetails({ ad_id: 107168, status: 1 }, { sql: {}, elastic }, fakeLog);
    expect(out).toEqual({ code: 200, message: "Image Data Updated Successfully" });
  });

  it("400 'Image Object not updated' on ES no-op", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    const elastic = mkElastic({ updateResult: "noop" });
    const out = await svc.updateImageOcrDetails({ ad_id: 107168, status: 1 }, { sql: {}, elastic }, fakeLog);
    expect(out).toEqual({ code: 400, message: "Image Object not updated" });
  });

  it("writes pinterest_ad_variants.* doc fields; image_ocr family only on status 4; detect_noop false", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());

    const e1 = mkElastic();
    await svc.updateImageOcrDetails(
      { ad_id: 107168, status: 1, object: "a||b" }, { sql: {}, elastic: e1 }, fakeLog
    );
    const doc1 = e1.update.mock.calls[0][0].body.doc;
    expect(doc1["pinterest_ad_variants.image_object"]).toEqual(["a", "b"]);
    expect(doc1["pinterest_ad_variants.image_object_exactly"]).toEqual(["a", "b"]);
    expect(doc1["pinterest_ad_variants.image_ocr"]).toBeUndefined();
    expect(e1.update.mock.calls[0][0].body.detect_noop).toBe(false);

    const e2 = mkElastic();
    await svc.updateImageOcrDetails(
      { ad_id: 107168, status: 4, ocr: "x||y" }, { sql: {}, elastic: e2 }, fakeLog
    );
    const doc2 = e2.update.mock.calls[0][0].body.doc;
    expect(doc2["pinterest_ad_variants.image_ocr"]).toEqual(["x", "y"]);
    expect(doc2["pinterest_ad_variants.image_ocr_exactly"]).toEqual(["x", "y"]);
  });

  it("single-value field is split on '||' into a 1-element array for ES (PHP explode parity)", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    const elastic = mkElastic();
    await svc.updateImageOcrDetails(
      { ad_id: 107168, status: 1, object: "car" }, { sql: {}, elastic }, fakeLog
    );
    expect(elastic.update.mock.calls[0][0].body.doc["pinterest_ad_variants.image_object"]).toEqual(["car"]);
  });

  it("reads ES result via body.result fallback (v7 shape)", async () => {
    repo.getVariantByAdId.mockResolvedValue(variant());
    const elastic = {
      search: vi.fn(async () => ({ body: { hits: { hits: [{ _id: "d" }] } } })),
      update: vi.fn(async () => ({ body: { result: "updated" } })),
    };
    const out = await svc.updateImageOcrDetails({ ad_id: 107168, status: 1 }, { sql: {}, elastic }, fakeLog);
    expect(out.code).toBe(200);
  });
});
