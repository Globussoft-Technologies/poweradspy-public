import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── Mock the two OCR services the controller depends on ───────────────
const getSvcPath = require.resolve("../../../../src/services/reddit/ocr/services/getImageUrlService");
const getImageUrl = vi.fn();
require.cache[getSvcPath] = { id: getSvcPath, filename: getSvcPath, loaded: true, exports: { getImageUrl } };

const updSvcPath = require.resolve("../../../../src/services/reddit/ocr/services/updateImageOcrService");
const updateImageDetails = vi.fn();
require.cache[updSvcPath] = { id: updSvcPath, filename: updSvcPath, loaded: true, exports: { updateImageDetails } };

const Controller = require("../../../../src/services/reddit/controllers/redditOcrController");

function mkRes() {
  const r = { statusCode: 200, body: null };
  r.status = vi.fn((c) => { r.statusCode = c; return r; });
  r.json = vi.fn((b) => { r.body = b; return r; });
  return r;
}

const svc = { db: { sql: {}, elastic: {} }, log: { info: vi.fn() } };

beforeEach(() => {
  getImageUrl.mockReset();
  updateImageDetails.mockReset();
});

describe("redditOcrController > getImageUrl", () => {
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

describe("redditOcrController > updateImageDetails", () => {
  it("delegates to service and returns its result (HTTP 200) — no ad_id validation in the controller", async () => {
    updateImageDetails.mockResolvedValue({ code: 200, message: " Image Data Updated Successfully" });
    const res = mkRes();
    const body = { ad_id: 8515, status: 4, ocr: "x" };
    await Controller.updateImageDetails({ body }, res, null, svc);
    expect(updateImageDetails).toHaveBeenCalledWith(body, svc.db, svc.log);
    expect(res.statusCode).toBe(200);
    expect(res.body.code).toBe(200);
  });

  it("passes an empty body straight to the service (ad_id resolved there)", async () => {
    updateImageDetails.mockResolvedValue({ code: 400, message: "ad_id is not available" });
    const res = mkRes();
    await Controller.updateImageDetails({ body: {} }, res, null, svc);
    expect(updateImageDetails).toHaveBeenCalledWith({}, svc.db, svc.log);
    expect(res.body.code).toBe(400);
  });

  it("400 'Some Error occured' body (HTTP 200) when service throws", async () => {
    updateImageDetails.mockRejectedValue(new Error("boom"));
    const res = mkRes();
    await Controller.updateImageDetails({ body: { ad_id: 1 } }, res, null, svc);
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ code: 400, message: "Some Error occured" });
  });
});
