import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const svc = require("../../../../../src/services/instagram/ocr/services/updateImageDetailsService");

const fakeLog = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };

/**
 * Build a mock `db` where:
 *   - the SELECT (getVariantByAdId) returns `variant`
 *   - the UPDATE returns affectedRows:1 (captured for assertions)
 *   - elastic search/update are controllable
 */
function makeDb({ variant, esHits = [{ _id: "es1" }], esResult = "updated" } = {}) {
  const updates = [];
  const sql = {
    query: vi.fn(async (text, params) => {
      if (/^\s*SELECT/i.test(text)) return variant ? [variant] : [];
      updates.push({ text, params });
      return { affectedRows: 1 };
    }),
  };
  const elastic = {
    search: vi.fn(async () => ({ hits: { hits: esHits } })),
    update: vi.fn(async () => ({ result: esResult })),
  };
  return { db: { sql, elastic }, updates, elastic };
}

/** Extract the UPDATE column→value map from the captured SET clause + params. */
function updatePayload(update) {
  const cols = [...update.text.matchAll(/(\w+) = \?/g)].map((m) => m[1]);
  const map = {};
  cols.forEach((c, i) => (map[c] = update.params[i]));
  return map;
}

describe("services/instagram/ocr/services/updateImageDetailsService", () => {
  it("400 'Some Error occurred' when the variant row is missing", async () => {
    const { db } = makeDb({ variant: null });
    const out = await svc.updateImageDetails({ ad_id: 1, status: 4 }, db, fakeLog);
    expect(out).toEqual({ code: 400, message: "Some Error occurred" });
  });

  it("encodes multi-value object as a JSON array string (|| → JSON) in SQL + ES", async () => {
    const { db, updates, elastic } = makeDb({ variant: { image_text_final_status: 0, image_ocr: null } });
    const out = await svc.updateImageDetails(
      { ad_id: 5, status: 1, object: "car||sunglasses", celebrity: "John", brand_logo: "Nike", ocr: "" },
      db,
      fakeLog
    );
    expect(out.code).toBe(200);

    const payload = updatePayload(updates[0]);
    expect(payload.image_object).toBe('["car","sunglasses"]'); // json_encode(explode('|'))
    expect(payload.image_celebrity).toBe("John"); // scalar
    expect(payload.image_brand_logo).toBe("Nike");
    expect(payload.image_url_status).toBe(1);
    expect(payload).toHaveProperty("object_update_date"); // status 1
    expect(payload).not.toHaveProperty("ocr_updated_date");

    // ES doc carries the same encoded values across the multilingual family.
    const doc = elastic.update.mock.calls[0][0].body.doc;
    expect(doc["instagram_ad_variants.image_object"]).toBe('["car","sunglasses"]');
    expect(doc["instagram_ad_variants.image_object_ru"]).toBe('["car","sunglasses"]');
    // OCB pass (status 1) must NOT write the ocr family.
    expect(doc).not.toHaveProperty("instagram_ad_variants.image_ocr");
  });

  it("empty fields become null; absent image_text_final_status not overwritten when non-zero", async () => {
    const { db, updates } = makeDb({ variant: { image_text_final_status: 1, image_ocr: null } });
    await svc.updateImageDetails(
      { ad_id: 5, status: 1, object: "", celebrity: "", brand_logo: "", ocr: "" },
      db,
      fakeLog
    );
    const payload = updatePayload(updates[0]);
    expect(payload.image_object).toBeNull();
    expect(payload.image_celebrity).toBeNull();
    expect(payload.image_brand_logo).toBeNull();
    expect(payload).not.toHaveProperty("image_text_final_status"); // was 1, not 0 → untouched
  });

  it("status 4: keeps existing image_ocr when ocr omitted, writes ocr family + ocr_updated_date", async () => {
    const { db, updates, elastic } = makeDb({ variant: { image_text_final_status: 0, image_ocr: "old-ocr" } });
    const out = await svc.updateImageDetails(
      { ad_id: 9, status: 4, object: "car", celebrity: "x", brand_logo: "y" }, // no ocr
      db,
      fakeLog
    );
    expect(out.code).toBe(200);

    const payload = updatePayload(updates[0]);
    expect(payload.image_ocr).toBe("old-ocr"); // kept
    expect(payload.image_url_status).toBe(4);
    expect(payload).toHaveProperty("ocr_updated_date");
    expect(payload).not.toHaveProperty("object_update_date");

    const doc = elastic.update.mock.calls[0][0].body.doc;
    expect(doc["instagram_ad_variants.image_ocr"]).toBe("old-ocr");
    expect(doc["instagram_ad_variants.image_ocr_exactly"]).toBe("old-ocr");
  });

  it("status 4: a delimited ocr overrides the existing value as a JSON array string", async () => {
    const { db, updates } = makeDb({ variant: { image_text_final_status: 0, image_ocr: "old" } });
    await svc.updateImageDetails(
      { ad_id: 9, status: 4, ocr: "Buy now||Limited" },
      db,
      fakeLog
    );
    expect(updatePayload(updates[0]).image_ocr).toBe('["Buy now","Limited"]');
  });

  it("any status other than 1/4 resets image_url_status to 0", async () => {
    const { db, updates } = makeDb({ variant: { image_text_final_status: 0, image_ocr: null } });
    await svc.updateImageDetails({ ad_id: 5, status: 2, object: "car" }, db, fakeLog);
    expect(updatePayload(updates[0]).image_url_status).toBe(0);
  });

  it("400 'ad not found' when no ES document matches", async () => {
    const { db } = makeDb({ variant: { image_text_final_status: 0, image_ocr: null }, esHits: [] });
    const out = await svc.updateImageDetails({ ad_id: 5, status: 1, object: "car" }, db, fakeLog);
    expect(out).toEqual({ code: 400, message: "ad not found" });
  });

  it("400 'ad not found' when the ES update is not 'updated'", async () => {
    const { db } = makeDb({ variant: { image_text_final_status: 0, image_ocr: null }, esResult: "noop" });
    const out = await svc.updateImageDetails({ ad_id: 5, status: 1, object: "car" }, db, fakeLog);
    expect(out).toEqual({ code: 400, message: "ad not found" });
  });

  it("200 after SQL when no elastic is configured (skips ES)", async () => {
    const { db } = makeDb({ variant: { image_text_final_status: 0, image_ocr: null } });
    db.elastic = null;
    const out = await svc.updateImageDetails({ ad_id: 5, status: 1, object: "car" }, db, fakeLog);
    expect(out.code).toBe(200);
  });
});
