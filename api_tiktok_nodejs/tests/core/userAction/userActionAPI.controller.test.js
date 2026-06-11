import { describe, it, expect, vi, beforeEach } from "vitest";

const { insertSpy, updateSpy } = vi.hoisted(() => ({
  insertSpy: vi.fn(async () => "insert-result"),
  updateSpy: vi.fn(async () => "update-result"),
}));

vi.mock("../../../core/userAction/userActionAPI.service.js", () => ({
  default: { insertAdsCountDetails: insertSpy, updateAdsCount: updateSpy },
}));

let controller;

beforeEach(async () => {
  vi.resetModules();
  insertSpy.mockClear();
  updateSpy.mockClear();
  ({ default: controller } = await import(
    "../../../core/userAction/userActionAPI.controller.js"
  ));
});

describe("core/userAction/userActionAPI.controller", () => {
  it("insertAdsCountDetails delegates to service.insertAdsCountDetails(req, res)", async () => {
    const req = { body: { adId: 1 } };
    const res = {};
    const result = await controller.insertAdsCountDetails(req, res);
    expect(insertSpy).toHaveBeenCalledWith(req, res);
    expect(result).toBe("insert-result");
  });

  it("updateAdsCount delegates to service.updateAdsCount(req, res, next)", async () => {
    const req = { params: { email: "x@y.io" } };
    const res = {};
    const next = vi.fn();
    const result = await controller.updateAdsCount(req, res, next);
    expect(updateSpy).toHaveBeenCalledWith(req, res, next);
    expect(result).toBe("update-result");
  });
});
