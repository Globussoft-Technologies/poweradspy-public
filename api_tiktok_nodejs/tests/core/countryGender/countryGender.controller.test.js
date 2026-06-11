import { describe, it, expect, vi, beforeEach } from "vitest";

const { addSvc, updateSvc, getOneSvc, getAllSvc, deleteSvc } = vi.hoisted(() => ({
  addSvc: vi.fn(),
  updateSvc: vi.fn(),
  getOneSvc: vi.fn(),
  getAllSvc: vi.fn(),
  deleteSvc: vi.fn(),
}));

vi.mock("../../../core/countryGender/countryGender.service.js", () => ({
  default: {
    AddCountryGender: addSvc,
    updateCountryGender: updateSvc,
    getCountryGender: getOneSvc,
    getAllCountryGender: getAllSvc,
    deleteCountryGender: deleteSvc,
  },
}));

let controller;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [addSvc, updateSvc, getOneSvc, getAllSvc, deleteSvc]) s.mockReset();
  ({ default: controller } = await import(
    "../../../core/countryGender/countryGender.controller.js"
  ));
});

describe("core/countryGender/countryGender.controller > thin wrappers", () => {
  it("AddCountryGender -> service.AddCountryGender(req, res)", async () => {
    addSvc.mockResolvedValueOnce("a");
    const req = {}, res = {};
    expect(await controller.AddCountryGender(req, res)).toBe("a");
    expect(addSvc).toHaveBeenCalledWith(req, res);
  });

  it("updateCountryGender -> service.updateCountryGender(req, res)", async () => {
    updateSvc.mockResolvedValueOnce("u");
    const req = {}, res = {};
    expect(await controller.updateCountryGender(req, res)).toBe("u");
    expect(updateSvc).toHaveBeenCalledWith(req, res);
  });

  it("getCountryGender -> service.getCountryGender(req, res)", async () => {
    getOneSvc.mockResolvedValueOnce("g1");
    const req = {}, res = {};
    expect(await controller.getCountryGender(req, res)).toBe("g1");
    expect(getOneSvc).toHaveBeenCalledWith(req, res);
  });

  it("getAllCountryGender -> service.getAllCountryGender(req, res)", async () => {
    getAllSvc.mockResolvedValueOnce("ga");
    const req = {}, res = {};
    expect(await controller.getAllCountryGender(req, res)).toBe("ga");
    expect(getAllSvc).toHaveBeenCalledWith(req, res);
  });

  it("deleteCountryGender -> service.deleteCountryGender(req, res)", async () => {
    deleteSvc.mockResolvedValueOnce("d");
    const req = {}, res = {};
    expect(await controller.deleteCountryGender(req, res)).toBe("d");
    expect(deleteSvc).toHaveBeenCalledWith(req, res);
  });
});
