import { describe, it, expect, vi, beforeEach } from "vitest";

const methods = [
  "userProject", "projectcompeitetor", "projectcompeitetorClient", "projectcompeitetorClientNew",
  "getplatformcount", "getCompetitorsCount", "getCompetitorsCountNew",
  "insertBacklink", "insertOrganicSearch", "insertpaidSearch",
  "getBackLinks", "getOrganicSearches", "getPaidSearches",
  "getCount", "getCountry", "getUserBrandStats", "getCompetitorAdsByRange",
];

const spies = vi.hoisted(() => {
  const m = {};
  for (const k of [
    "userProject", "projectcompeitetor", "projectcompeitetorClient", "projectcompeitetorClientNew",
    "getplatformcount", "getCompetitorsCount", "getCompetitorsCountNew",
    "insertBacklink", "insertOrganicSearch", "insertpaidSearch",
    "getBackLinks", "getOrganicSearches", "getPaidSearches",
    "getCount", "getCountry", "getUserBrandStats", "getCompetitorAdsByRange",
  ]) m[k] = vi.fn();
  return m;
});

vi.mock("../../../core/Dashboard/dashboardService.js", () => ({ default: spies }));

let ctrl;

beforeEach(async () => {
  Object.values(spies).forEach((s) => s.mockReset());
  vi.resetModules();
  ({ default: ctrl } = await import("../../../core/Dashboard/dashboardController.js"));
});

describe("core/Dashboard/dashboardController", () => {
  for (const method of methods) {
    it(`${method} delegates to DashboardService.${method}`, async () => {
      spies[method].mockResolvedValueOnce({ ok: true });
      const req = {}; const res = {};
      const out = await ctrl[method](req, res);
      expect(spies[method]).toHaveBeenCalledWith(req, res);
      expect(out).toEqual({ ok: true });
    });
  }
});
