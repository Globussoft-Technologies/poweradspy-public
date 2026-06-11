import { describe, it, expect, vi, beforeEach } from "vitest";

const { addSvc, delSvc, getSvc, getSubSvc, dailySvc, weeklySvc, monthlySvc } =
  vi.hoisted(() => ({
    addSvc: vi.fn(),
    delSvc: vi.fn(),
    getSvc: vi.fn(),
    getSubSvc: vi.fn(),
    dailySvc: vi.fn(),
    weeklySvc: vi.fn(),
    monthlySvc: vi.fn(),
  }));

vi.mock("../../../core/keywordNotification/keywordNotification.service.js", () => ({
  default: {
    addKeywords: addSvc,
    deleteKeywords: delSvc,
    getKeywords: getSvc,
    getSubscribedKeywords: getSubSvc,
    sendKeywordMailDaily: dailySvc,
    sendKeywordMailWeekly: weeklySvc,
    sendKeywordMailMonthly: monthlySvc,
  },
}));

let controller;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [addSvc, delSvc, getSvc, getSubSvc, dailySvc, weeklySvc, monthlySvc])
    s.mockReset();
  ({ default: controller } = await import(
    "../../../core/keywordNotification/keywordNotification.controller.js"
  ));
});

describe("core/keywordNotification/keywordNotification.controller > delegations", () => {
  it("addKeywords -> service.addKeywords(req, res, next)", async () => {
    addSvc.mockResolvedValueOnce("a");
    const req = {}, res = {}, next = vi.fn();
    expect(await controller.addKeywords(req, res, next)).toBe("a");
    expect(addSvc).toHaveBeenCalledWith(req, res, next);
  });

  it("deleteKeywords -> service.deleteKeywords(req, res) (no next)", async () => {
    delSvc.mockResolvedValueOnce("d");
    const req = {}, res = {};
    expect(await controller.deleteKeywords(req, res)).toBe("d");
    expect(delSvc).toHaveBeenCalledWith(req, res);
  });

  it("getKeywords -> service.getKeywords(req, res, next)", async () => {
    getSvc.mockResolvedValueOnce("g");
    const req = {}, res = {}, next = vi.fn();
    expect(await controller.getKeywords(req, res, next)).toBe("g");
    expect(getSvc).toHaveBeenCalledWith(req, res, next);
  });

  it("getSubscribedKeywords -> service.getSubscribedKeywords", async () => {
    getSubSvc.mockResolvedValueOnce("gs");
    const req = {}, res = {}, next = vi.fn();
    expect(await controller.getSubscribedKeywords(req, res, next)).toBe("gs");
    expect(getSubSvc).toHaveBeenCalledWith(req, res, next);
  });

  it("sendKeywordMailDaily -> service.sendKeywordMailDaily", async () => {
    dailySvc.mockResolvedValueOnce("md");
    const req = {}, res = {}, next = vi.fn();
    expect(await controller.sendKeywordMailDaily(req, res, next)).toBe("md");
    expect(dailySvc).toHaveBeenCalledWith(req, res, next);
  });

  it("sendKeywordMailWeekly -> service.sendKeywordMailWeekly", async () => {
    weeklySvc.mockResolvedValueOnce("mw");
    const req = {}, res = {}, next = vi.fn();
    expect(await controller.sendKeywordMailWeekly(req, res, next)).toBe("mw");
    expect(weeklySvc).toHaveBeenCalledWith(req, res, next);
  });

  it("sendKeywordMailMonthly -> service.sendKeywordMailMonthly", async () => {
    monthlySvc.mockResolvedValueOnce("mm");
    const req = {}, res = {}, next = vi.fn();
    expect(await controller.sendKeywordMailMonthly(req, res, next)).toBe("mm");
    expect(monthlySvc).toHaveBeenCalledWith(req, res, next);
  });
});
