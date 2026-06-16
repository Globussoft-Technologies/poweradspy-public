import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const repo = require("../../../../src/services/instagram/ocr/repository");

const execWith = (impl) => ({ query: vi.fn(impl) });

describe("services/instagram/ocr/repository", () => {
  describe("getImagesUrl", () => {
    it("filters IMAGE/STORIES at the given status, newest first, limit 20 (no ocr column)", async () => {
      const exec = execWith(async () => [{ ad_id: 1, image_url: "x.jpg" }]);
      const rows = await repo.getImagesUrl(exec, 0, false);

      expect(rows).toEqual([{ ad_id: 1, image_url: "x.jpg" }]);
      const [sql, params] = exec.query.mock.calls[0];
      expect(sql).toMatch(/instagram_ad_variants/);
      expect(sql).toMatch(/JOIN instagram_ad/);
      expect(sql).toMatch(/type IN \('IMAGE', 'STORIES'\)/);
      expect(sql).toMatch(/last_seen BETWEEN \? AND \?/);
      expect(sql).toMatch(/ORDER BY instagram_ad_variants\.instagram_ad_id DESC/);
      expect(sql).toMatch(/LIMIT 20/);
      expect(sql).not.toMatch(/image_ocr/);
      expect(params[0]).toBe(0); // status filter
      expect(params).toHaveLength(3); // status + 2 dates
    });

    it("includes image_ocr column when withOcr is true (status 4)", async () => {
      const exec = execWith(async () => []);
      await repo.getImagesUrl(exec, 4, true);
      const [sql, params] = exec.query.mock.calls[0];
      expect(sql).toMatch(/instagram_ad_variants\.image_ocr/);
      expect(params[0]).toBe(4);
    });

    it("returns [] when the driver returns a non-array", async () => {
      const exec = execWith(async () => undefined);
      expect(await repo.getImagesUrl(exec, 0, false)).toEqual([]);
    });
  });

  describe("updateStatusMultiple", () => {
    it("builds an IN (...) update and returns affectedRows", async () => {
      const exec = execWith(async () => ({ affectedRows: 3 }));
      const n = await repo.updateStatusMultiple(exec, [1, 2, 3], 2);
      expect(n).toBe(3);
      const [sql, params] = exec.query.mock.calls[0];
      expect(sql).toMatch(/SET image_url_status = \? WHERE instagram_ad_id IN \(\?,\?,\?\)/);
      expect(params).toEqual([2, 1, 2, 3]);
    });

    it("accepts a single id and filters out null/undefined", async () => {
      const exec = execWith(async () => ({ affectedRows: 1 }));
      await repo.updateStatusMultiple(exec, [5, null, undefined], 2);
      expect(exec.query.mock.calls[0][1]).toEqual([2, 5]);
    });

    it("no-ops (returns 0, no query) when there are no ids", async () => {
      const exec = execWith(async () => ({ affectedRows: 9 }));
      expect(await repo.updateStatusMultiple(exec, [], 2)).toBe(0);
      expect(exec.query).not.toHaveBeenCalled();
    });
  });

  describe("getVariantByAdId", () => {
    it("returns the first row", async () => {
      const exec = execWith(async () => [{ instagram_ad_id: 7, image_ocr: "hi" }]);
      expect(await repo.getVariantByAdId(exec, 7)).toEqual({ instagram_ad_id: 7, image_ocr: "hi" });
      expect(exec.query.mock.calls[0][1]).toEqual([7]);
    });

    it("returns null when no row matches", async () => {
      const exec = execWith(async () => []);
      expect(await repo.getVariantByAdId(exec, 7)).toBeNull();
    });
  });

  describe("updateVariant", () => {
    it("builds a SET clause skipping undefined keys", async () => {
      const exec = execWith(async () => ({ affectedRows: 1 }));
      const n = await repo.updateVariant(exec, 10, {
        image_object: "car",
        image_ocr: undefined, // skipped
        image_url_status: 1,
      });
      expect(n).toBe(1);
      const [sql, params] = exec.query.mock.calls[0];
      expect(sql).toMatch(/SET image_object = \?, image_url_status = \? WHERE instagram_ad_id = \?/);
      expect(sql).not.toMatch(/image_ocr/);
      expect(params).toEqual(["car", 1, 10]);
    });

    it("no-ops (returns 0, no query) when every column is undefined", async () => {
      const exec = execWith(async () => ({ affectedRows: 5 }));
      expect(await repo.updateVariant(exec, 10, { a: undefined })).toBe(0);
      expect(exec.query).not.toHaveBeenCalled();
    });
  });
});
