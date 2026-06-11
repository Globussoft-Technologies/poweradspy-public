import { describe, it, expect, vi, beforeEach } from "vitest";

const svcSpies = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  getAnalytics: vi.fn(),
  getAdvertiserAds: vi.fn(),
  getAds: vi.fn(),
  getAdURL: vi.fn(),
  deleteAd: vi.fn(),
  deleteSQLAd: vi.fn(),
  getVideoURL: vi.fn(),
  updateThumbNail: vi.fn(),
}));

vi.mock("../../../core/tiktok/tiktok.service.js", () => ({
  default: svcSpies,
}));

let controller;
beforeEach(async () => {
  vi.resetModules();
  for (const s of Object.values(svcSpies)) s.mockReset();
  ({ default: controller } = await import(
    "../../../core/tiktok/tiktok.controller.js"
  ));
});

const methods = [
  "create", "update", "getAnalytics", "getAdvertiserAds", "getAds",
  "getAdURL", "deleteAd", "deleteSQLAd", "getVideoURL", "updateThumbNail",
];

describe("core/tiktok/tiktok.controller > delegations", () => {
  for (const m of methods) {
    it(`${m} -> tikTokService.${m}(req, res, next)`, async () => {
      svcSpies[m].mockResolvedValueOnce(`r-${m}`);
      const req = {}, res = {}, next = vi.fn();
      expect(await controller[m](req, res, next)).toBe(`r-${m}`);
      expect(svcSpies[m]).toHaveBeenCalledWith(req, res, next);
    });
  }
});
