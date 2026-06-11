import { describe, it, expect, vi, beforeEach } from "vitest";

const { addSvc, getSvc, logsSvc } = vi.hoisted(() => ({
  addSvc: vi.fn(),
  getSvc: vi.fn(),
  logsSvc: vi.fn(),
}));

vi.mock("../../../core/keywordsAPI/keywordsAPI.service.js", () => ({
  default: {
    addKeywords: addSvc,
    getKeywords: getSvc,
    getLogFiles: logsSvc,
  },
}));

let controller;
beforeEach(async () => {
  vi.resetModules();
  addSvc.mockReset();
  getSvc.mockReset();
  logsSvc.mockReset();
  ({ default: controller } = await import(
    "../../../core/keywordsAPI/keywordsAPI.controller.js"
  ));
});

describe("core/keywordsAPI/keywordsAPI.controller > addKeywords", () => {
  it("delegates (req, res, next) to service.addKeywords", async () => {
    addSvc.mockResolvedValueOnce("a-ok");
    const req = {}, res = {}, next = vi.fn();
    const out = await controller.addKeywords(req, res, next);
    expect(addSvc).toHaveBeenCalledWith(req, res, next);
    expect(out).toBe("a-ok");
  });
});

describe("core/keywordsAPI/keywordsAPI.controller > getKeywords", () => {
  it("delegates (req, res, next) to service.getKeywords", async () => {
    getSvc.mockResolvedValueOnce("g-ok");
    const req = {}, res = {}, next = vi.fn();
    const out = await controller.getKeywords(req, res, next);
    expect(getSvc).toHaveBeenCalledWith(req, res, next);
    expect(out).toBe("g-ok");
  });
});

describe("core/keywordsAPI/keywordsAPI.controller > getLogFiles", () => {
  it("delegates (req, res, next) to service.getLogFiles", async () => {
    logsSvc.mockResolvedValueOnce("l-ok");
    const req = {}, res = {}, next = vi.fn();
    const out = await controller.getLogFiles(req, res, next);
    expect(logsSvc).toHaveBeenCalledWith(req, res, next);
    expect(out).toBe("l-ok");
  });
});
