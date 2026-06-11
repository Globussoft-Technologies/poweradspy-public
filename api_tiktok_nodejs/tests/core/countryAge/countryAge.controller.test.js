import { describe, it, expect, vi, beforeEach } from "vitest";

const { addSvc, updateSvc, getOneSvc, getAllSvc, deleteSvc } = vi.hoisted(() => ({
  addSvc: vi.fn(),
  updateSvc: vi.fn(),
  getOneSvc: vi.fn(),
  getAllSvc: vi.fn(),
  deleteSvc: vi.fn(),
}));

vi.mock("../../../core/countryAge/countryAge.service.js", () => ({
  default: {
    AddCountryAge: addSvc,
    updateCountryAge: updateSvc,
    getCountryAge: getOneSvc,
    getAllCountryAge: getAllSvc,
    deleteCountryAge: deleteSvc,
  },
}));

let controller;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [addSvc, updateSvc, getOneSvc, getAllSvc, deleteSvc]) s.mockReset();
  ({ default: controller } = await import(
    "../../../core/countryAge/countryAge.controller.js"
  ));
});

describe("core/countryAge/countryAge.controller > thin wrappers", () => {
  it("AddCountryAge -> service.AddCountryAge(req, res)", async () => {
    addSvc.mockResolvedValueOnce("a");
    const req = {}, res = {};
    expect(await controller.AddCountryAge(req, res)).toBe("a");
    expect(addSvc).toHaveBeenCalledWith(req, res);
  });

  it("updateCountryAge -> service.updateCountryAge(req, res)", async () => {
    updateSvc.mockResolvedValueOnce("u");
    const req = {}, res = {};
    expect(await controller.updateCountryAge(req, res)).toBe("u");
    expect(updateSvc).toHaveBeenCalledWith(req, res);
  });

  it("getCountryAge -> service.getCountryAge(req, res)", async () => {
    getOneSvc.mockResolvedValueOnce("g1");
    const req = {}, res = {};
    expect(await controller.getCountryAge(req, res)).toBe("g1");
    expect(getOneSvc).toHaveBeenCalledWith(req, res);
  });

  it("getAllCountryAge -> service.getAllCountryAge(req, res)", async () => {
    getAllSvc.mockResolvedValueOnce("ga");
    const req = {}, res = {};
    expect(await controller.getAllCountryAge(req, res)).toBe("ga");
    expect(getAllSvc).toHaveBeenCalledWith(req, res);
  });

  it("deleteCountryAge -> service.deleteCountryAge(req, res)", async () => {
    deleteSvc.mockResolvedValueOnce("d");
    const req = {}, res = {};
    expect(await controller.deleteCountryAge(req, res)).toBe("d");
    expect(deleteSvc).toHaveBeenCalledWith(req, res);
  });
});
