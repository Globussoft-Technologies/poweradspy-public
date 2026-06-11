import { describe, it, expect, vi, beforeEach } from "vitest";

const { getAdSvc, uploadSvc, insertSvc } = vi.hoisted(() => ({
  getAdSvc: vi.fn(),
  uploadSvc: vi.fn(),
  insertSvc: vi.fn(),
}));

vi.mock("../../../core/destinationLander/lander.service.js", () => ({
  default: {
    getAdwithCountryCode: getAdSvc,
    uploadFileToServer: uploadSvc,
    insertLanderContent: insertSvc,
  },
}));

let controller;
beforeEach(async () => {
  vi.resetModules();
  getAdSvc.mockReset();
  uploadSvc.mockReset();
  insertSvc.mockReset();
  ({ default: controller } = await import(
    "../../../core/destinationLander/lander.controller.js"
  ));
});

describe("core/destinationLander/lander.controller > getAdwithCountryCode", () => {
  it("delegates (req, res, next) to service.getAdwithCountryCode", async () => {
    getAdSvc.mockResolvedValueOnce({ ok: 1 });
    const req = {}, res = {}, next = vi.fn();
    const out = await controller.getAdwithCountryCode(req, res, next);
    expect(getAdSvc).toHaveBeenCalledWith(req, res, next);
    expect(out).toEqual({ ok: 1 });
  });
});

describe("core/destinationLander/lander.controller > uploadFileToServer", () => {
  it("delegates (req, res, next) to service.uploadFileToServer", async () => {
    uploadSvc.mockResolvedValueOnce("uploaded");
    const req = {}, res = {}, next = vi.fn();
    const out = await controller.uploadFileToServer(req, res, next);
    expect(uploadSvc).toHaveBeenCalledWith(req, res, next);
    expect(out).toBe("uploaded");
  });
});

describe("core/destinationLander/lander.controller > insertLanderContent", () => {
  it("delegates (req, res, next) to service.insertLanderContent", async () => {
    insertSvc.mockResolvedValueOnce("inserted");
    const req = {}, res = {}, next = vi.fn();
    const out = await controller.insertLanderContent(req, res, next);
    expect(insertSvc).toHaveBeenCalledWith(req, res, next);
    expect(out).toBe("inserted");
  });
});
