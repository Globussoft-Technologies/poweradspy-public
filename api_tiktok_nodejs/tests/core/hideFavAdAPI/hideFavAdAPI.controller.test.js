import { describe, it, expect, vi, beforeEach } from "vitest";

const { hideSvc, unHideSvc, getAdsSvc, getFavSvc } = vi.hoisted(() => ({
  hideSvc: vi.fn(),
  unHideSvc: vi.fn(),
  getAdsSvc: vi.fn(),
  getFavSvc: vi.fn(),
}));

vi.mock("../../../core/hideFavAdAPI/hideFavAdAPI.service.js", () => ({
  default: {
    hideFavAd: hideSvc,
    unHideFavAd: unHideSvc,
    getHideAds: getAdsSvc,
    getHideFavAds: getFavSvc,
  },
}));

let controller;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [hideSvc, unHideSvc, getAdsSvc, getFavSvc]) s.mockReset();
  ({ default: controller } = await import(
    "../../../core/hideFavAdAPI/hideFavAdAPI.controller.js"
  ));
});

describe("core/hideFavAdAPI/hideFavAdAPI.controller > hideFavAd", () => {
  it("delegates (req, res, next) to service.hideFavAd", async () => {
    hideSvc.mockResolvedValueOnce("hidden");
    const req = {}, res = {}, next = vi.fn();
    const out = await controller.hideFavAd(req, res, next);
    expect(hideSvc).toHaveBeenCalledWith(req, res, next);
    expect(out).toBe("hidden");
  });
});

describe("core/hideFavAdAPI/hideFavAdAPI.controller > unHideFavAd", () => {
  it("delegates (req, res, next) to service.unHideFavAd", async () => {
    unHideSvc.mockResolvedValueOnce("unhidden");
    const req = {}, res = {}, next = vi.fn();
    const out = await controller.unHideFavAd(req, res, next);
    expect(unHideSvc).toHaveBeenCalledWith(req, res, next);
    expect(out).toBe("unhidden");
  });
});

describe("core/hideFavAdAPI/hideFavAdAPI.controller > getHideAds", () => {
  it("delegates (req, res, next) to service.getHideAds", async () => {
    getAdsSvc.mockResolvedValueOnce(["a"]);
    const req = {}, res = {}, next = vi.fn();
    const out = await controller.getHideAds(req, res, next);
    expect(getAdsSvc).toHaveBeenCalledWith(req, res, next);
    expect(out).toEqual(["a"]);
  });
});

describe("core/hideFavAdAPI/hideFavAdAPI.controller > getHideFavAds", () => {
  it("delegates (req, res, next) to service.getHideFavAds", async () => {
    getFavSvc.mockResolvedValueOnce(["b"]);
    const req = {}, res = {}, next = vi.fn();
    const out = await controller.getHideFavAds(req, res, next);
    expect(getFavSvc).toHaveBeenCalledWith(req, res, next);
    expect(out).toEqual(["b"]);
  });
});
