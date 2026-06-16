import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── Mock the two OCR services the controller depends on ───────────────
const getSvcPath = require.resolve("../../../../src/services/quora/ocr/services/getImageUrlService");
const getImageUrl = vi.fn();
require.cache[getSvcPath] = { id: getSvcPath, filename: getSvcPath, loaded: true, exports: { getImageUrl } };

const updSvcPath = require.resolve("../../../../src/services/quora/ocr/services/updateImageOcrService");
const updateImageOcrDetails = vi.fn();
require.cache[updSvcPath] = { id: updSvcPath, filename: updSvcPath, loaded: true, exports: { updateImageOcrDetails } };

const Controller = require("../../../../src/services/quora/controllers/quoraOcrController");

function mkRes() {
  const r = { statusCode: 200, body: null };
  r.status = vi.fn((c) => { r.statusCode = c; return r; });
  r.json = vi.fn((b) => { r.body = b; return r; });
  return r;
}

const svc = { db: { sql: {}, elastic: {} }, log: { info: vi.fn() } };

beforeEach(() => {
  getImageUrl.mockReset();
  updateImageOcrDetails.mockReset();
});

describe("quoraOcrController > getImageUrl", () => {
  it("400 body (HTTP 200) when status missing", async () => {
    const res = mkRes();
    await Controller.getImageUrl({ query: {}, body: {} }, res, null, svc);
    expect(res.statusCode).toBe(200);
    expect(res.body.code).toBe(400);
    expect(getImageUrl).not.toHaveBeenCalled();
  });

  it("reads status from query, returns service result + exe_time (HTTP 200)", async () => {
    getImageUrl.mockResolvedValue({ code: 200, message: "ok", data: [{ ad_id: 1 }] });
    const res = mkRes();
    await Controller.getImageUrl({ query: { status: "4" }, body: {} }, res, null, svc);
    expect(getImageUrl).toHaveBeenCalledWith(svc.db, 4, svc.log);
    expect(res.statusCode).toBe(200);
    expect(res.body.code).toBe(200);
    expect(typeof res.body.exe_time).toBe("number");
  });

  it("falls back to body.status when query missing", async () => {
    getImageUrl.mockResolvedValue({ code: 400, message: "x", data: [] });
    await Controller.getImageUrl({ query: {}, body: { status: 0 } }, mkRes(), null, svc);
    expect(getImageUrl).toHaveBeenCalledWith(svc.db, 0, svc.log);
  });

  it("401 body (HTTP 200) when service throws", async () => {
    getImageUrl.mockRejectedValue(new Error("boom"));
    const res = mkRes();
    await Controller.getImageUrl({ query: { status: "4" }, body: {} }, res, null, svc);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ code: 401, message: "No More Image are present", data: [] });
  });
});

describe("quoraOcrController > updateImageOcrDetails", () => {
  it("400 body (HTTP 200) when ad_id missing", async () => {
    const res = mkRes();
    await Controller.updateImageOcrDetails({ body: {} }, res, null, svc);
    expect(res.statusCode).toBe(200);
    expect(res.body.code).toBe(400);
    expect(updateImageOcrDetails).not.toHaveBeenCalled();
  });

  it("delegates to service and returns its result (HTTP 200)", async () => {
    updateImageOcrDetails.mockResolvedValue({ code: 200, message: "Image Data Updated Successfully" });
    const res = mkRes();
    const body = { ad_id: 8515, status: 4, ocr: "x" };
    await Controller.updateImageOcrDetails({ body }, res, null, svc);
    expect(updateImageOcrDetails).toHaveBeenCalledWith(body, svc.db, svc.log);
    expect(res.statusCode).toBe(200);
    expect(res.body.code).toBe(200);
  });

  it("401 body (HTTP 200) when service throws", async () => {
    updateImageOcrDetails.mockRejectedValue(new Error("boom"));
    const res = mkRes();
    await Controller.updateImageOcrDetails({ body: { ad_id: 1 } }, res, null, svc);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ code: 401, message: "Image Object not updated" });
  });
});
