import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const {
  scheduleSpy,
  dailySvc, weeklySvc, monthlySvc,
  addCtrl, getCtrl, delCtrl, getSubCtrl, dailyCtrl, weeklyCtrl, monthlyCtrl,
} = vi.hoisted(() => ({
  scheduleSpy: vi.fn(),
  dailySvc: vi.fn(),
  weeklySvc: vi.fn(),
  monthlySvc: vi.fn(),
  addCtrl: vi.fn((req, res) => res.status(201).json({ from: "addKeywords" })),
  getCtrl: vi.fn((req, res) =>
    res.status(200).json({ from: "getKeywords", id: req.params.userid })
  ),
  delCtrl: vi.fn((req, res) =>
    res.status(200).json({ from: "deleteKeywords", id: req.params.keywordid })
  ),
  getSubCtrl: vi.fn((req, res) =>
    res.status(200).json({ from: "getSubscribedKeywords" })
  ),
  dailyCtrl: vi.fn((req, res) =>
    res.status(200).json({ from: "sendKeywordMailDaily" })
  ),
  weeklyCtrl: vi.fn((req, res) =>
    res.status(200).json({ from: "sendKeywordMailWeekly" })
  ),
  monthlyCtrl: vi.fn((req, res) =>
    res.status(200).json({ from: "sendKeywordMailMonthly" })
  ),
}));

vi.mock("node-cron", () => ({
  default: { schedule: scheduleSpy },
  schedule: scheduleSpy,
}));

vi.mock("../../../core/keywordNotification/keywordNotification.controller.js", () => ({
  default: {
    addKeywords: addCtrl,
    getKeywords: getCtrl,
    deleteKeywords: delCtrl,
    getSubscribedKeywords: getSubCtrl,
    sendKeywordMailDaily: dailyCtrl,
    sendKeywordMailWeekly: weeklyCtrl,
    sendKeywordMailMonthly: monthlyCtrl,
  },
}));

vi.mock("../../../core/keywordNotification/keywordNotification.service.js", () => ({
  default: {
    sendKeywordMailDaily: dailySvc,
    sendKeywordMailWeekly: weeklySvc,
    sendKeywordMailMonthly: monthlySvc,
  },
}));

let router;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [
    scheduleSpy, dailySvc, weeklySvc, monthlySvc,
    addCtrl, getCtrl, delCtrl, getSubCtrl, dailyCtrl, weeklyCtrl, monthlyCtrl,
  ]) s.mockClear();
  ({ default: router } = await import(
    "../../../core/keywordNotification/keywordNotification.routes.js"
  ));
});

function appWith(r) {
  const app = express();
  app.use(express.json());
  app.use(r);
  return app;
}

describe("core/keywordNotification/keywordNotification.routes > controller dispatch", () => {
  it("POST /insert_keyword -> addKeywords", async () => {
    const res = await request(appWith(router)).post("/insert_keyword").send({});
    expect(res.status).toBe(201);
    expect(addCtrl).toHaveBeenCalled();
  });

  it("GET /get-subscribed-keyword/:userid -> getKeywords with param", async () => {
    const res = await request(appWith(router)).get("/get-subscribed-keyword/77");
    expect(res.body).toEqual({ from: "getKeywords", id: "77" });
  });

  it("DELETE /delete-keyword/:keywordid -> deleteKeywords", async () => {
    const res = await request(appWith(router)).delete("/delete-keyword/9");
    expect(res.body).toEqual({ from: "deleteKeywords", id: "9" });
  });

  it("GET /get-keywords -> getSubscribedKeywords", async () => {
    const res = await request(appWith(router)).get("/get-keywords");
    expect(getSubCtrl).toHaveBeenCalled();
  });

  it("GET /sendKeywordMailDaily -> sendKeywordMailDaily", async () => {
    const res = await request(appWith(router)).get("/sendKeywordMailDaily");
    expect(dailyCtrl).toHaveBeenCalled();
  });

  it("GET /sendKeywordMailWeekly -> sendKeywordMailWeekly", async () => {
    const res = await request(appWith(router)).get("/sendKeywordMailWeekly");
    expect(weeklyCtrl).toHaveBeenCalled();
  });

  it("GET /sendKeywordMailMonthly -> sendKeywordMailMonthly", async () => {
    const res = await request(appWith(router)).get("/sendKeywordMailMonthly");
    expect(monthlyCtrl).toHaveBeenCalled();
  });
});

describe("core/keywordNotification/keywordNotification.routes > cron jobs", () => {
  it("registers 3 cron jobs (daily 0 0 * * *, weekly 0 0 * * 1, monthly 0 0 1 * *)", () => {
    expect(scheduleSpy).toHaveBeenCalledTimes(3);
    expect(scheduleSpy.mock.calls[0][0]).toBe("0 0 * * *");
    expect(scheduleSpy.mock.calls[1][0]).toBe("0 0 * * 1");
    expect(scheduleSpy.mock.calls[2][0]).toBe("0 0 1 * *");
  });

  it("daily cron callback invokes sendKeywordMailDaily with (null, fakeRes, fakeNext)", () => {
    const cb = scheduleSpy.mock.calls[0][1];
    cb();
    expect(dailySvc).toHaveBeenCalledTimes(1);
    const [reqArg, resArg, nextArg] = dailySvc.mock.calls[0];
    expect(reqArg).toBeNull();
    expect(typeof resArg.send).toBe("function");
    resArg.send({ ok: true });
    expect(typeof nextArg).toBe("function");
    nextArg();
  });

  it("weekly cron callback invokes sendKeywordMailWeekly", () => {
    const cb = scheduleSpy.mock.calls[1][1];
    cb();
    expect(weeklySvc).toHaveBeenCalledTimes(1);
  });

  it("monthly cron callback invokes sendKeywordMailMonthly", () => {
    const cb = scheduleSpy.mock.calls[2][1];
    cb();
    expect(monthlySvc).toHaveBeenCalledTimes(1);
  });
});
