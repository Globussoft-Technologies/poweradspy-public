import { describe, it, expect, vi, beforeEach } from "vitest";

const { addSvc, updateSvc, getOneSvc, getAllSvc, deleteSvc } = vi.hoisted(() => ({
  addSvc: vi.fn(),
  updateSvc: vi.fn(),
  getOneSvc: vi.fn(),
  getAllSvc: vi.fn(),
  deleteSvc: vi.fn(),
}));

vi.mock("../../../core/adLocation/adLocation.service.js", () => ({
  default: {
    AddLocation: addSvc,
    updateLocationData: updateSvc,
    getLocationData: getOneSvc,
    getAllLocationData: getAllSvc,
    deleteLocationData: deleteSvc,
  },
}));

let controller;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [addSvc, updateSvc, getOneSvc, getAllSvc, deleteSvc]) s.mockReset();
  ({ default: controller } = await import(
    "../../../core/adLocation/adLocation.controller.js"
  ));
});

describe("core/adLocation/adLocation.controller > thin wrappers", () => {
  it("AddLocation -> service.AddLocation(req, res)", async () => {
    addSvc.mockResolvedValueOnce("a");
    const req = {}, res = {};
    expect(await controller.AddLocation(req, res)).toBe("a");
    expect(addSvc).toHaveBeenCalledWith(req, res);
  });

  it("updateLocationData -> service.updateLocationData(req, res)", async () => {
    updateSvc.mockResolvedValueOnce("u");
    const req = {}, res = {};
    expect(await controller.updateLocationData(req, res)).toBe("u");
    expect(updateSvc).toHaveBeenCalledWith(req, res);
  });

  it("getLocationData -> service.getLocationData(req, res)", async () => {
    getOneSvc.mockResolvedValueOnce("g1");
    const req = {}, res = {};
    expect(await controller.getLocationData(req, res)).toBe("g1");
    expect(getOneSvc).toHaveBeenCalledWith(req, res);
  });

  it("getAllLocationData -> service.getAllLocationData(req, res)", async () => {
    getAllSvc.mockResolvedValueOnce("ga");
    const req = {}, res = {};
    expect(await controller.getAllLocationData(req, res)).toBe("ga");
    expect(getAllSvc).toHaveBeenCalledWith(req, res);
  });

  it("deleteLocationData -> service.deleteLocationData(req, res)", async () => {
    deleteSvc.mockResolvedValueOnce("d");
    const req = {}, res = {};
    expect(await controller.deleteLocationData(req, res)).toBe("d");
    expect(deleteSvc).toHaveBeenCalledWith(req, res);
  });
});
