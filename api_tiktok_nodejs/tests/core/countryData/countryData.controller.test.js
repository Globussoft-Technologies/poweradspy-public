import { describe, it, expect, vi, beforeEach } from "vitest";

const { addSvc, updateSvc, getOneSvc, getAllSvc, deleteSvc } = vi.hoisted(() => ({
  addSvc: vi.fn(),
  updateSvc: vi.fn(),
  getOneSvc: vi.fn(),
  getAllSvc: vi.fn(),
  deleteSvc: vi.fn(),
}));

vi.mock("../../../core/countryData/countryData.service.js", () => ({
  default: {
    AddData: addSvc,
    updateCountryData: updateSvc,
    getCountry: getOneSvc,
    getAllCountry: getAllSvc,
    deleteCountryData: deleteSvc,
  },
}));

let controller;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [addSvc, updateSvc, getOneSvc, getAllSvc, deleteSvc]) s.mockReset();
  ({ default: controller } = await import(
    "../../../core/countryData/countryData.controller.js"
  ));
});

describe("core/countryData/countryData.controller > thin wrappers", () => {
  it("AddData -> service.AddData(req, res)", async () => {
    addSvc.mockResolvedValueOnce("a");
    const req = {}, res = {};
    expect(await controller.AddData(req, res)).toBe("a");
    expect(addSvc).toHaveBeenCalledWith(req, res);
  });

  it("updateCountryData -> service.updateCountryData(req, res)", async () => {
    updateSvc.mockResolvedValueOnce("u");
    const req = {}, res = {};
    expect(await controller.updateCountryData(req, res)).toBe("u");
    expect(updateSvc).toHaveBeenCalledWith(req, res);
  });

  it("getCountry -> service.getCountry(req, res)", async () => {
    getOneSvc.mockResolvedValueOnce("g1");
    const req = {}, res = {};
    expect(await controller.getCountry(req, res)).toBe("g1");
    expect(getOneSvc).toHaveBeenCalledWith(req, res);
  });

  it("getAllCountry -> service.getAllCountry(req, res)", async () => {
    getAllSvc.mockResolvedValueOnce("ga");
    const req = {}, res = {};
    expect(await controller.getAllCountry(req, res)).toBe("ga");
    expect(getAllSvc).toHaveBeenCalledWith(req, res);
  });

  it("deleteCountryData -> service.deleteCountryData(req, res)", async () => {
    deleteSvc.mockResolvedValueOnce("d");
    const req = {}, res = {};
    expect(await controller.deleteCountryData(req, res)).toBe("d");
    expect(deleteSvc).toHaveBeenCalledWith(req, res);
  });
});
