import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { hideSpy, unHideSpy, getAdsSpy, getFavSpy } = vi.hoisted(() => ({
  hideSpy: vi.fn((req, res) => res.status(200).json({ from: "hideFavAd" })),
  unHideSpy: vi.fn((req, res) => res.status(200).json({ from: "unHideFavAd" })),
  getAdsSpy: vi.fn((req, res) => res.status(200).json({ from: "getHideAds" })),
  getFavSpy: vi.fn((req, res) => res.status(200).json({ from: "getHideFavAds" })),
}));

vi.mock("../../../core/hideFavAdAPI/hideFavAdAPI.controller.js", () => ({
  default: {
    hideFavAd: hideSpy,
    unHideFavAd: unHideSpy,
    getHideAds: getAdsSpy,
    getHideFavAds: getFavSpy,
  },
}));

let router;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [hideSpy, unHideSpy, getAdsSpy, getFavSpy]) s.mockClear();
  ({ default: router } = await import("../../../core/hideFavAdAPI/hideFavAdAPI.routes.js"));
});

function appWith(r) {
  const app = express();
  app.use(express.json());
  app.use(r);
  return app;
}

describe("core/hideFavAdAPI/hideFavAdAPI.routes > controller dispatch", () => {
  it("POST /hide -> hideFavAd", async () => {
    const res = await request(appWith(router)).post("/hide").send({});
    expect(res.status).toBe(200);
    expect(hideSpy).toHaveBeenCalled();
  });

  it("POST /un-hide -> unHideFavAd", async () => {
    const res = await request(appWith(router)).post("/un-hide").send({});
    expect(unHideSpy).toHaveBeenCalled();
  });

  it("POST /get-ads -> getHideAds", async () => {
    const res = await request(appWith(router)).post("/get-ads").send({});
    expect(getAdsSpy).toHaveBeenCalled();
  });

  it("POST /get-fav-ads -> getHideFavAds", async () => {
    const res = await request(appWith(router)).post("/get-fav-ads").send({});
    expect(getFavSpy).toHaveBeenCalled();
  });
});
