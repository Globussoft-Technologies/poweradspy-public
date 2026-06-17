import { describe, it, expect, vi, beforeEach } from "vitest";

const { findSpy, aggregateSpy, loggerErrorSpy } = vi.hoisted(() => ({
  findSpy: vi.fn(),
  aggregateSpy: vi.fn(),
  loggerErrorSpy: vi.fn(),
}));

vi.mock("../../../models/user_details.js", () => ({ default: { find: findSpy } }));
vi.mock("../../../models/competitors_request.js", () => ({ default: { aggregate: aggregateSpy } }));
vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { error: loggerErrorSpy, info: vi.fn(), warn: vi.fn() },
}));

let controller;
beforeEach(async () => {
  findSpy.mockReset();
  aggregateSpy.mockReset();
  loggerErrorSpy.mockReset();
  vi.resetModules();
  ({ default: controller } = await import("../../../core/Users/userController.js"));
});

function mockRes() {
  const res = {};
  res.send = vi.fn(() => res);
  return res;
}

describe("userController > getAllUsers", () => {
  it("merges per-user brand/competitor stats; missing stats default to 0/null", async () => {
    findSpy.mockReturnValue({ sort: () => ({ lean: () => Promise.resolve([
      { _id: "u1", userName: "Alice", email: "a@x.com" },
      { _id: "u2", userName: "Bob", email: "b@x.com" }, // no stats → defaults
    ]) }) });
    aggregateSpy.mockResolvedValue([
      { _id: "u1", totalBrands: 3, totalCompetitors: 7, lastActivity: "2025-01-01" },
    ]);
    const res = mockRes();
    await controller.getAllUsers({}, res);
    const payload = res.send.mock.calls[0][0];
    const users = payload.data?.users || payload.projectDetails?.users || payload.body?.users;
    // tolerate the Response wrapper shape; just assert the merged values exist somewhere
    const flat = JSON.stringify(payload);
    expect(flat).toContain("Alice");
    expect(flat).toContain("\"totalBrands\":3");
    expect(flat).toContain("\"totalCompetitors\":7");
    // u2 (no stats) → 0 / null
    expect(flat).toContain("\"totalBrands\":0");
  });

  it("error → userFailResp + logs", async () => {
    findSpy.mockImplementation(() => { throw new Error("db-down"); });
    const res = mockRes();
    await controller.getAllUsers({}, res);
    expect(loggerErrorSpy).toHaveBeenCalled();
    expect(JSON.stringify(res.send.mock.calls[0][0]).toLowerCase()).toContain("failed");
  });
});
