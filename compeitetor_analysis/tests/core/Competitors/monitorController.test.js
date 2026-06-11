import { describe, it, expect, vi, beforeEach } from "vitest";

const spies = vi.hoisted(() => ({
  getCompetitors: vi.fn(),
  updateCompetitorsStatus: vi.fn(),
  updateDailyCompetitors: vi.fn(),
  activeCompetitorContacts: vi.fn(),
  unSubscribeMail: vi.fn(),
  reSubscribeMail: vi.fn(),
}));

vi.mock("../../../core/Competitors/monitorService.js", () => ({
  default: spies,
}));

let ctrl;

beforeEach(async () => {
  Object.values(spies).forEach((s) => s.mockReset());
  vi.resetModules();
  ({ default: ctrl } = await import("../../../core/Competitors/monitorController.js"));
});

describe("core/Competitors/monitorController", () => {
  for (const method of Object.keys(spies)) {
    it(`${method} delegates to MonitorService.${method}`, async () => {
      spies[method].mockResolvedValueOnce({ ok: true });
      const req = {}; const res = {};
      const out = await ctrl[method](req, res);
      expect(spies[method]).toHaveBeenCalledWith(req, res);
      expect(out).toEqual({ ok: true });
    });
  }
});
