import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const Controller = require("../../../../src/services/instagram/controllers/instagramOcrController");

const fakeLog = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };

/** Minimal Express res stub capturing status + json body. */
function makeRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

beforeEach(() => fakeLog.error.mockClear());

describe("services/instagram/controllers/instagramOcrController", () => {
  describe("getImageUrl", () => {
    it("always responds HTTP 200; 400-coded body when status is missing", async () => {
      const res = makeRes();
      await Controller.getImageUrl({ query: {}, body: {} }, res, vi.fn(), { db: {}, log: fakeLog });
      expect(res.statusCode).toBe(200);
      expect(res.body.code).toBe(400);
      expect(res.body.message).toBe(JSON.stringify(["The status field is required."]));
    });

    it("reads status from the query string and returns the service result", async () => {
      const query = vi
        .fn()
        .mockResolvedValueOnce([{ ad_id: 1, image_url: "https://x/1.jpg", image_ocr: null }])
        .mockResolvedValueOnce({ affectedRows: 1 });
      const res = makeRes();
      await Controller.getImageUrl(
        { query: { status: "4" }, body: {} },
        res,
        vi.fn(),
        { db: { sql: { query } }, log: fakeLog }
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.code).toBe(200);
      expect(res.body.data[0].ad_id).toBe(1);
    });

    it("falls back to body.status when no query param", async () => {
      const query = vi.fn().mockResolvedValueOnce([]); // empty queue
      const res = makeRes();
      await Controller.getImageUrl(
        { query: {}, body: { status: 0 } },
        res,
        vi.fn(),
        { db: { sql: { query } }, log: fakeLog }
      );
      expect(res.body.code).toBe(400);
      expect(res.body.message).toBe("No More Image are present");
    });

    it("401-coded body (HTTP 200) on unexpected service error", async () => {
      const query = vi.fn(async () => { throw new Error("db down"); });
      const res = makeRes();
      await Controller.getImageUrl(
        { query: { status: "4" }, body: {} },
        res,
        vi.fn(),
        { db: { sql: { query } }, log: fakeLog }
      );
      expect(res.statusCode).toBe(200);
      expect(res.body.code).toBe(401);
      expect(res.body.message).toBe("No More Image are present");
    });
  });

  describe("updateImageDetails", () => {
    it("400-coded body when ad_id is missing", async () => {
      const res = makeRes();
      await Controller.updateImageDetails({ body: { status: 4 } }, res, vi.fn(), { db: {}, log: fakeLog });
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ code: 400, message: "Some Error occurred" });
    });

    it("returns the service result for a valid update", async () => {
      const sql = {
        query: vi.fn(async (text) =>
          /^\s*SELECT/i.test(text) ? [{ image_text_final_status: 0, image_ocr: null }] : { affectedRows: 1 }
        ),
      };
      const elastic = {
        search: vi.fn(async () => ({ hits: { hits: [{ _id: "e1" }] } })),
        update: vi.fn(async () => ({ result: "updated" })),
      };
      const res = makeRes();
      await Controller.updateImageDetails(
        { body: { ad_id: 5, status: 1, object: "car" } },
        res,
        vi.fn(),
        { db: { sql, elastic }, log: fakeLog }
      );
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ code: 200, message: " Image Data Updated Successfully" });
    });

    it("401-coded body (HTTP 200) on unexpected error", async () => {
      const sql = { query: vi.fn(async () => { throw new Error("boom"); }) };
      const res = makeRes();
      await Controller.updateImageDetails(
        { body: { ad_id: 5, status: 1 } },
        res,
        vi.fn(),
        { db: { sql }, log: fakeLog }
      );
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual({ code: 401, message: "Image Object not updated" });
    });
  });
});
