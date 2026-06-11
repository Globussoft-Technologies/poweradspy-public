import { describe, it, expect, vi, beforeEach } from "vitest";

const { createSvc, updateSvc, getOneSvc, getAllSvc, deleteSvc } = vi.hoisted(() => ({
  createSvc: vi.fn(),
  updateSvc: vi.fn(),
  getOneSvc: vi.fn(),
  getAllSvc: vi.fn(),
  deleteSvc: vi.fn(),
}));

vi.mock("../../../core/metaData/metaData.service.js", () => ({
  default: {
    createMetaData: createSvc,
    updateMetaData: updateSvc,
    getMetaData: getOneSvc,
    getAllMetaData: getAllSvc,
    deleteMetaData: deleteSvc,
  },
}));

let controller;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [createSvc, updateSvc, getOneSvc, getAllSvc, deleteSvc]) s.mockReset();
  ({ default: controller } = await import(
    "../../../core/metaData/metaData.controller.js"
  ));
});

describe("core/metaData/metaData.controller > thin wrappers", () => {
  it("createMetaData -> service.createMetaData(req, res, next)", async () => {
    createSvc.mockResolvedValueOnce("c");
    const req = {}, res = {}, next = vi.fn();
    expect(await controller.createMetaData(req, res, next)).toBe("c");
    expect(createSvc).toHaveBeenCalledWith(req, res, next);
  });

  it("updateMetaData -> service.updateMetaData(req, res, next)", async () => {
    updateSvc.mockResolvedValueOnce("u");
    const req = {}, res = {}, next = vi.fn();
    expect(await controller.updateMetaData(req, res, next)).toBe("u");
    expect(updateSvc).toHaveBeenCalledWith(req, res, next);
  });

  it("getAllMetaData -> service.getAllMetaData(req, res, next)", async () => {
    getAllSvc.mockResolvedValueOnce("ga");
    const req = {}, res = {}, next = vi.fn();
    expect(await controller.getAllMetaData(req, res, next)).toBe("ga");
    expect(getAllSvc).toHaveBeenCalledWith(req, res, next);
  });

  it("getMetaData -> service.getMetaData(req, res, next)", async () => {
    getOneSvc.mockResolvedValueOnce("g1");
    const req = {}, res = {}, next = vi.fn();
    expect(await controller.getMetaData(req, res, next)).toBe("g1");
    expect(getOneSvc).toHaveBeenCalledWith(req, res, next);
  });

  it("deleteMetaData -> service.deleteMetaData(req, res, next)", async () => {
    deleteSvc.mockResolvedValueOnce("d");
    const req = {}, res = {}, next = vi.fn();
    expect(await controller.deleteMetaData(req, res, next)).toBe("d");
    expect(deleteSvc).toHaveBeenCalledWith(req, res, next);
  });
});
