import { describe, it, expect, vi, beforeEach } from "vitest";

const methods = [
  "getLCS",
  "getEngagementData",
  "getFrequentData",
  "getAverageBudgetByData",
  "getLongestAd",
  "getTopLikes",
  "getTopComments",
  "getTopImpressions",
  "getTopPopularity",
  "getAdCount",
  "getAdType",
  "getCategory",
];

const spies = vi.hoisted(() => {
  const m = {};
  for (const k of [
    "getLCS", "getEngagementData", "getFrequentData", "getAverageBudgetByData",
    "getLongestAd", "getTopLikes", "getTopComments", "getTopImpressions",
    "getTopPopularity", "getAdCount", "getAdType", "getCategory",
  ]) m[k] = vi.fn();
  return m;
});

vi.mock("../../../core/Advertisers/advertiserService.js", () => ({
  default: spies,
}));

let ctrl;

beforeEach(async () => {
  Object.values(spies).forEach((s) => s.mockReset());
  vi.resetModules();
  ({ default: ctrl } = await import("../../../core/Advertisers/advertiserController.js"));
});

describe("core/Advertisers/advertiserController", () => {
  for (const method of methods) {
    it(`${method} delegates to advertiserService.${method}`, async () => {
      spies[method].mockResolvedValueOnce({ ok: true });
      const req = {}; const res = {};
      const out = await ctrl[method](req, res);
      expect(spies[method]).toHaveBeenCalledWith(req, res);
      expect(out).toEqual({ ok: true });
    });
  }
});
