import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const repo = require("../../../../src/services/reddit/ocr/repository");

/** Fake `exec` (db.sql wrapper) recording calls and returning a canned value. */
function mkExec(returnValue) {
  return {
    calls: [],
    query: vi.fn(async function (sql, params) {
      this.calls.push({ sql, params });
      return typeof returnValue === "function" ? returnValue(sql, params) : returnValue;
    }),
  };
}

describe("services/reddit/ocr/repository > getImagesUrl", () => {
  it("selects reddit_ad_variants joined to reddit_ad on type=IMAGE, no image_ocr by default", async () => {
    const exec = mkExec([{ ad_id: 1, image_url: "a.jpg" }]);
    const out = await repo.getImagesUrl(exec, 0, false);
    const sql = exec.query.mock.calls[0][0];
    const params = exec.query.mock.calls[0][1];
    expect(sql).toContain("FROM reddit_ad_variants");
    expect(sql).toContain("LEFT JOIN reddit_ad ON reddit_ad.id = reddit_ad_variants.reddit_ad_id");
    expect(sql).toContain("reddit_ad.type = 'IMAGE'");
    expect(sql).toContain("reddit_ad_variants.reddit_ad_id AS ad_id");
    expect(sql).not.toContain("image_ocr");
    expect(params).toEqual([0]);
    expect(out).toEqual([{ ad_id: 1, image_url: "a.jpg" }]);
  });

  it("includes image_ocr column when withOcr=true and filters by given status", async () => {
    const exec = mkExec([]);
    await repo.getImagesUrl(exec, 4, true);
    const sql = exec.query.mock.calls[0][0];
    const params = exec.query.mock.calls[0][1];
    expect(sql).toContain("reddit_ad_variants.image_ocr");
    expect(params).toEqual([4]);
  });

  it("returns [] when the driver returns a non-array", async () => {
    const exec = mkExec(undefined);
    expect(await repo.getImagesUrl(exec, 0, false)).toEqual([]);
  });
});

describe("services/reddit/ocr/repository > updateStatusMultiple", () => {
  it("builds IN(...) placeholders and returns affectedRows", async () => {
    const exec = mkExec({ affectedRows: 3 });
    const out = await repo.updateStatusMultiple(exec, [1, 2, 3], 2);
    const sql = exec.query.mock.calls[0][0];
    const params = exec.query.mock.calls[0][1];
    expect(sql).toBe("UPDATE reddit_ad_variants SET image_url_status = ? WHERE reddit_ad_id IN (?,?,?)");
    expect(params).toEqual([2, 1, 2, 3]);
    expect(out).toBe(3);
  });

  it("accepts a single id (non-array)", async () => {
    const exec = mkExec({ affectedRows: 1 });
    await repo.updateStatusMultiple(exec, 9, 2);
    expect(exec.query.mock.calls[0][1]).toEqual([2, 9]);
  });

  it("returns 0 and runs no query for empty id list", async () => {
    const exec = mkExec({ affectedRows: 5 });
    expect(await repo.updateStatusMultiple(exec, [], 2)).toBe(0);
    expect(exec.query).not.toHaveBeenCalled();
  });
});

describe("services/reddit/ocr/repository > getVariantByAdId", () => {
  it("returns the first row when present", async () => {
    const exec = mkExec([{ id: 1, reddit_ad_id: 55 }]);
    const out = await repo.getVariantByAdId(exec, 55);
    expect(exec.query.mock.calls[0][0]).toContain("FROM reddit_ad_variants WHERE reddit_ad_id = ?");
    expect(out).toEqual({ id: 1, reddit_ad_id: 55 });
  });

  it("returns null when no row", async () => {
    const exec = mkExec([]);
    expect(await repo.getVariantByAdId(exec, 999)).toBeNull();
  });
});

describe("services/reddit/ocr/repository > updateVariant", () => {
  it("builds SET clause, skips undefined keys, appends adId, returns affectedRows", async () => {
    const exec = mkExec({ affectedRows: 1 });
    const out = await repo.updateVariant(exec, 7, {
      image_object: "car",
      image_ocr: undefined, // skipped
      image_url_status: 4,
    });
    const sql = exec.query.mock.calls[0][0];
    const params = exec.query.mock.calls[0][1];
    expect(sql).toBe("UPDATE reddit_ad_variants SET image_object = ?, image_url_status = ? WHERE reddit_ad_id = ?");
    expect(params).toEqual(["car", 4, 7]);
    expect(out).toBe(1);
  });

  it("returns 0 and runs no query when all values undefined", async () => {
    const exec = mkExec({ affectedRows: 1 });
    expect(await repo.updateVariant(exec, 7, { a: undefined })).toBe(0);
    expect(exec.query).not.toHaveBeenCalled();
  });

  it("preserves null values (does not skip them)", async () => {
    const exec = mkExec({ affectedRows: 1 });
    await repo.updateVariant(exec, 7, { image_object: null });
    expect(exec.query.mock.calls[0][1]).toEqual([null, 7]);
  });
});
