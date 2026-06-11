import { describe, it, expect, vi, beforeEach } from "vitest";

const methods = [
  "create", "insertCompRequests", "fetchCompetitors", "fetchCompetitorsClient",
  "fetchCompetitorsForUpdate", "fetchCompetitorsForUpdateClient", "fetchCompetitorsForUpdateNew",
  "checkUser", "checkBrand", "updateMonitoring", "updateCompetitors", "updateCompetitorsNew",
  "updateAdvertiser", "getAllDetails", "filterDetails", "getActiveUsers", "getInactiveUsers",
  "getCompUsersCount", "getStoreProcessCompetitors", "checkExistingCompetitorCount",
  "getAllCompetitors", "checkDailyTokenLimit", "fetchKeywordsBasedOnWebsite",
  "checkCompetitorProcess", "deleteProject", "addManualCompetitor",
];

const spies = vi.hoisted(() => {
  const m = {};
  for (const k of [
    "create", "insertCompRequests", "fetchCompetitors", "fetchCompetitorsClient",
    "fetchCompetitorsForUpdate", "fetchCompetitorsForUpdateClient", "fetchCompetitorsForUpdateNew",
    "checkUser", "checkBrand", "updateMonitoring", "updateCompetitors", "updateCompetitorsNew",
    "updateAdvertiser", "getAllDetails", "filterDetails", "getActiveUsers", "getInactiveUsers",
    "getCompUsersCount", "getStoreProcessCompetitors", "checkExistingCompetitorCount",
    "getAllCompetitors", "checkDailyTokenLimit", "fetchKeywordsBasedOnWebsite",
    "checkCompetitorProcess", "deleteProject", "addManualCompetitor",
  ]) m[k] = vi.fn();
  return m;
});

vi.mock("../../../core/Competitors/competitorService.js", () => ({ default: spies }));

let ctrl;

beforeEach(async () => {
  Object.values(spies).forEach((s) => s.mockReset());
  vi.resetModules();
  ({ default: ctrl } = await import("../../../core/Competitors/competitorController.js"));
});

describe("core/Competitors/competitorController", () => {
  for (const method of methods) {
    it(`${method} delegates to CompetitorService.${method}`, async () => {
      spies[method].mockResolvedValueOnce({ ok: true });
      const req = {}; const res = {};
      const out = await ctrl[method](req, res);
      expect(spies[method]).toHaveBeenCalledWith(req, res);
      expect(out).toEqual({ ok: true });
    });
  }
});
