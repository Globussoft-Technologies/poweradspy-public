import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const {
  scheduleSpy, updateSpy, loggerInfoSpy, loggerErrorSpy,
  createCtrl, updateCtrl, analyticsCtrl, advAdsCtrl, getAdsCtrl,
  deleteAdCtrl, deleteSqlCtrl, videoCtrl, adUrlCtrl, thumbCtrl,
} = vi.hoisted(() => ({
  scheduleSpy: vi.fn(),
  updateSpy: vi.fn(),
  loggerInfoSpy: vi.fn(),
  loggerErrorSpy: vi.fn(),
  createCtrl: vi.fn((req, res) => res.status(201).json({ from: "create" })),
  updateCtrl: vi.fn((req, res) => res.status(200).json({ from: "update" })),
  analyticsCtrl: vi.fn((req, res) =>
    res.status(200).json({ from: "getAnalytics", id: req.params.id })
  ),
  advAdsCtrl: vi.fn((req, res) =>
    res.status(200).json({ from: "getAdvertiserAds", po: req.params.postOwner })
  ),
  getAdsCtrl: vi.fn((req, res) => res.status(200).json({ from: "getAds" })),
  deleteAdCtrl: vi.fn((req, res) =>
    res.status(200).json({ from: "deleteAd", id: req.params.id })
  ),
  deleteSqlCtrl: vi.fn((req, res) =>
    res.status(200).json({ from: "deleteSQLAd" })
  ),
  videoCtrl: vi.fn((req, res) => res.status(200).json({ from: "getVideoURL" })),
  adUrlCtrl: vi.fn((req, res) => res.status(200).json({ from: "getAdURL" })),
  thumbCtrl: vi.fn((req, res) =>
    res.status(200).json({ from: "updateThumbNail" })
  ),
}));

vi.mock("node-cron", () => ({
  default: { schedule: scheduleSpy },
  schedule: scheduleSpy,
}));

vi.mock("../../../core/tiktok/tiktok.controller.js", () => ({
  default: {
    create: createCtrl,
    update: updateCtrl,
    getAnalytics: analyticsCtrl,
    getAdvertiserAds: advAdsCtrl,
    getAds: getAdsCtrl,
    deleteAd: deleteAdCtrl,
    deleteSQLAd: deleteSqlCtrl,
    getVideoURL: videoCtrl,
    getAdURL: adUrlCtrl,
    updateThumbNail: thumbCtrl,
  },
}));

vi.mock("../../../Sequelize_cli/models/index.js", () => ({
  default: { tiktok_ad_meta_data: { update: updateSpy } },
}));

vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { info: loggerInfoSpy, error: loggerErrorSpy, warn: vi.fn() },
}));

let router;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [
    scheduleSpy, updateSpy, loggerInfoSpy, loggerErrorSpy,
    createCtrl, updateCtrl, analyticsCtrl, advAdsCtrl, getAdsCtrl,
    deleteAdCtrl, deleteSqlCtrl, videoCtrl, adUrlCtrl, thumbCtrl,
  ]) s.mockClear();
  ({ default: router } = await import("../../../core/tiktok/tiktok.routes.js"));
});

function appWith(r) {
  const app = express();
  app.use(express.json());
  app.use(r);
  return app;
}

describe("core/tiktok/tiktok.routes > controller dispatch", () => {
  it("POST /create -> create", async () => {
    const res = await request(appWith(router)).post("/create").send({});
    expect(res.status).toBe(201);
    expect(createCtrl).toHaveBeenCalled();
  });

  it("PUT /update -> update", async () => {
    const res = await request(appWith(router)).put("/update").send({});
    expect(updateCtrl).toHaveBeenCalled();
  });

  it("GET /analytics/:id -> getAnalytics", async () => {
    const res = await request(appWith(router)).get("/analytics/77");
    expect(res.body).toEqual({ from: "getAnalytics", id: "77" });
  });

  it("GET /advertiserAds/:postOwner -> getAdvertiserAds", async () => {
    const res = await request(appWith(router)).get("/advertiserAds/Acme");
    expect(res.body).toEqual({ from: "getAdvertiserAds", po: "Acme" });
  });

  it("GET /getAds -> getAds", async () => {
    const res = await request(appWith(router)).get("/getAds");
    expect(getAdsCtrl).toHaveBeenCalled();
  });

  it("DELETE /delete/:id -> deleteAd", async () => {
    const res = await request(appWith(router)).delete("/delete/9");
    expect(res.body).toEqual({ from: "deleteAd", id: "9" });
  });

  it("DELETE /delete-sql-ads -> deleteSQLAd", async () => {
    const res = await request(appWith(router)).delete("/delete-sql-ads");
    expect(deleteSqlCtrl).toHaveBeenCalled();
  });

  it("POST /get-video-url -> getVideoURL", async () => {
    const res = await request(appWith(router)).post("/get-video-url").send({});
    expect(videoCtrl).toHaveBeenCalled();
  });

  it("GET /get-ad-url -> getAdURL", async () => {
    const res = await request(appWith(router)).get("/get-ad-url");
    expect(adUrlCtrl).toHaveBeenCalled();
  });

  it("PUT /update-thumb-nail -> updateThumbNail", async () => {
    const res = await request(appWith(router)).put("/update-thumb-nail").send({});
    expect(thumbCtrl).toHaveBeenCalled();
  });
});

describe("core/tiktok/tiktok.routes > cron job (every day at 00:00)", () => {
  it("schedules a daily cron at '0 0 * * *'", () => {
    expect(scheduleSpy).toHaveBeenCalledTimes(1);
    expect(scheduleSpy.mock.calls[0][0]).toBe("0 0 * * *");
  });

  it("cron callback updates thumb_nail_status from 2 to 0 and logs success", async () => {
    updateSpy.mockResolvedValueOnce([5]);
    const cb = scheduleSpy.mock.calls[0][1];
    await cb();
    expect(updateSpy).toHaveBeenCalledWith(
      { thumb_nail_status: 0 },
      { where: { thumb_nail_status: 2 } }
    );
    expect(loggerInfoSpy).toHaveBeenCalledWith(
      expect.stringMatching(/thumb_nail_status updated/),
      { updatedRows: 5 }
    );
  });

  it("cron callback logs error when META_DATA.update rejects", async () => {
    updateSpy.mockRejectedValueOnce(new Error("db-down"));
    const cb = scheduleSpy.mock.calls[0][1];
    await cb();
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Error in data updation in cronjob/),
      expect.any(Error)
    );
  });
});
