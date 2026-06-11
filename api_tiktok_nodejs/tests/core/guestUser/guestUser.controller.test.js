import { describe, it, expect, vi, beforeEach } from "vitest";

const { ttAnalytics, ttVideoUrl, gSearch, gCount, gGraph, gCountries } = vi.hoisted(() => ({
  ttAnalytics: vi.fn(),
  ttVideoUrl: vi.fn(),
  gSearch: vi.fn(),
  gCount: vi.fn(),
  gGraph: vi.fn(),
  gCountries: vi.fn(),
}));

vi.mock("../../../core/tiktok/tiktok.service.js", () => ({
  default: { getAnalytics: ttAnalytics, getVideoURL: ttVideoUrl },
}));

vi.mock("../../../core/guestUser/guestUser.service.js", () => ({
  default: {
    guestUserSearchAds: gSearch,
    getAdsCount: gCount,
    getAdsCountGraph: gGraph,
    getAdsCountCountries: gCountries,
  },
}));

let controller;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [ttAnalytics, ttVideoUrl, gSearch, gCount, gGraph, gCountries]) s.mockReset();
  ({ default: controller } = await import(
    "../../../core/guestUser/guestUser.controller.js"
  ));
});

describe("core/guestUser/guestUser.controller > delegations", () => {
  it("getAdDetails -> tiktokService.getAnalytics(req, res, next)", async () => {
    ttAnalytics.mockResolvedValueOnce("a");
    const req = {}, res = {}, next = vi.fn();
    expect(await controller.getAdDetails(req, res, next)).toBe("a");
    expect(ttAnalytics).toHaveBeenCalledWith(req, res, next);
  });

  it("guestUserSearchAds -> guestUserService.guestUserSearchAds", async () => {
    gSearch.mockResolvedValueOnce("s");
    const req = {}, res = {}, next = vi.fn();
    expect(await controller.guestUserSearchAds(req, res, next)).toBe("s");
    expect(gSearch).toHaveBeenCalledWith(req, res, next);
  });

  it("getVideoURL -> tiktokService.getVideoURL", async () => {
    ttVideoUrl.mockResolvedValueOnce("v");
    const req = {}, res = {}, next = vi.fn();
    expect(await controller.getVideoURL(req, res, next)).toBe("v");
    expect(ttVideoUrl).toHaveBeenCalledWith(req, res, next);
  });

  it("getAdsCount -> guestUserService.getAdsCount", async () => {
    gCount.mockResolvedValueOnce("c");
    const req = {}, res = {}, next = vi.fn();
    expect(await controller.getAdsCount(req, res, next)).toBe("c");
    expect(gCount).toHaveBeenCalledWith(req, res, next);
  });

  it("getAdsCountGraph -> guestUserService.getAdsCountGraph", async () => {
    gGraph.mockResolvedValueOnce("g");
    const req = {}, res = {}, next = vi.fn();
    expect(await controller.getAdsCountGraph(req, res, next)).toBe("g");
    expect(gGraph).toHaveBeenCalledWith(req, res, next);
  });

  it("getAdsCountCountries -> guestUserService.getAdsCountCountries", async () => {
    gCountries.mockResolvedValueOnce("co");
    const req = {}, res = {}, next = vi.fn();
    expect(await controller.getAdsCountCountries(req, res, next)).toBe("co");
    expect(gCountries).toHaveBeenCalledWith(req, res, next);
  });
});
