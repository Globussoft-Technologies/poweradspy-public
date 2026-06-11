import { describe, it, expect, vi, beforeEach } from "vitest";

const { searchSvc, countSvc, industriesSvc } = vi.hoisted(() => ({
  searchSvc: vi.fn(),
  countSvc: vi.fn(),
  industriesSvc: vi.fn(),
}));

vi.mock("../../../core/dashboard/dashboard.service.js", () => ({
  default: {
    searchFilter: searchSvc,
    getAdsCountDetails: countSvc,
    getIndustries: industriesSvc,
  },
}));

let controller;
beforeEach(async () => {
  vi.resetModules();
  searchSvc.mockReset();
  countSvc.mockReset();
  industriesSvc.mockReset();
  ({ default: controller } = await import(
    "../../../core/dashboard/dashboard.controller.js"
  ));
});

describe("core/dashboard/dashboard.controller > searchFilter", () => {
  it("delegates (req, res, next) to service.searchFilter", async () => {
    searchSvc.mockResolvedValueOnce("s-ok");
    const req = {}, res = {}, next = vi.fn();
    const out = await controller.searchFilter(req, res, next);
    expect(searchSvc).toHaveBeenCalledWith(req, res, next);
    expect(out).toBe("s-ok");
  });
});

describe("core/dashboard/dashboard.controller > getAdsCountDetails", () => {
  it("delegates (req, res, next) to service.getAdsCountDetails", async () => {
    countSvc.mockResolvedValueOnce({ count: 5 });
    const req = {}, res = {}, next = vi.fn();
    const out = await controller.getAdsCountDetails(req, res, next);
    expect(countSvc).toHaveBeenCalledWith(req, res, next);
    expect(out).toEqual({ count: 5 });
  });
});

describe("core/dashboard/dashboard.controller > getIndustries", () => {
  it("delegates (req, res, next) to service.getIndustries", async () => {
    industriesSvc.mockResolvedValueOnce(["a"]);
    const req = {}, res = {}, next = vi.fn();
    const out = await controller.getIndustries(req, res, next);
    expect(industriesSvc).toHaveBeenCalledWith(req, res, next);
    expect(out).toEqual(["a"]);
  });
});
