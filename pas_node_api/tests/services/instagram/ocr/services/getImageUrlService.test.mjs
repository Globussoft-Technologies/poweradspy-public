import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const svc = require("../../../../../src/services/instagram/ocr/services/getImageUrlService");

const fakeLog = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };

describe("services/instagram/ocr/services/getImageUrlService", () => {
  describe("resolveImageUrl", () => {
    it("leaves already-absolute URLs untouched", () => {
      expect(svc.resolveImageUrl("https://cdn.x.com/a.jpg")).toBe("https://cdn.x.com/a.jpg");
    });

    it("takes only the segment before the first '||'", () => {
      // first segment is absolute → returned unchanged
      expect(svc.resolveImageUrl("https://cdn.x.com/a.jpg||https://cdn.x.com/b.jpg"))
        .toBe("https://cdn.x.com/a.jpg");
    });

    it("returns falsy input unchanged", () => {
      expect(svc.resolveImageUrl("")).toBe("");
      expect(svc.resolveImageUrl(null)).toBeNull();
    });
  });

  describe("getImageUrl", () => {
    it("401 body when no sql connection", async () => {
      const out = await svc.getImageUrl({}, 4, fakeLog);
      expect(out).toEqual({ code: 401, message: "No More Image are present", data: [] });
    });

    it("400 'No More Image are present' when the queue is empty", async () => {
      const db = { sql: { query: vi.fn(async () => []) } };
      const out = await svc.getImageUrl(db, 0, fakeLog);
      expect(out.code).toBe(400);
      expect(out.message).toBe("No More Image are present");
      expect(out.data).toEqual([]);
    });

    it("status 4 leases the batch: resolves urls + flips the ads to in-progress (2)", async () => {
      const query = vi
        .fn()
        // 1st call = SELECT lease batch
        .mockResolvedValueOnce([
          { ad_id: 11, image_url: "https://cdn.x.com/11.jpg", image_ocr: null },
          { ad_id: 12, image_url: "https://cdn.x.com/12.jpg", image_ocr: null },
        ])
        // 2nd call = bulk status UPDATE
        .mockResolvedValueOnce({ affectedRows: 2 });
      const db = { sql: { query } };

      const out = await svc.getImageUrl(db, 4, fakeLog);

      expect(out.code).toBe(200);
      expect(out.message).toBe("Image Url fetched successfully");
      expect(out.data.map((r) => r.ad_id)).toEqual([11, 12]);

      // SELECT used the status-4 filter and selected image_ocr.
      const selectSql = query.mock.calls[0][0];
      expect(selectSql).toMatch(/image_ocr/);
      expect(query.mock.calls[0][1][0]).toBe(4);

      // UPDATE flipped both ids to 2.
      const [updSql, updParams] = query.mock.calls[1];
      expect(updSql).toMatch(/SET image_url_status = \?/);
      expect(updParams).toEqual([2, 11, 12]);
    });

    it("status 0 uses the OCB filter (status 0) and no image_ocr column", async () => {
      const query = vi
        .fn()
        .mockResolvedValueOnce([{ ad_id: 9, image_url: "https://cdn.x.com/9.jpg" }])
        .mockResolvedValueOnce({ affectedRows: 1 });
      const db = { sql: { query } };

      const out = await svc.getImageUrl(db, 0, fakeLog);
      expect(out.code).toBe(200);
      expect(query.mock.calls[0][0]).not.toMatch(/image_ocr/);
      expect(query.mock.calls[0][1][0]).toBe(0);
    });
  });
});
