import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { getAdSpy, searchSpy, videoSpy, countSpy, graphSpy, countriesSpy } = vi.hoisted(() => ({
  getAdSpy: vi.fn((req, res) =>
    res.status(200).json({ from: "getAdDetails", id: req.params.id })
  ),
  searchSpy: vi.fn((req, res) => res.status(200).json({ from: "guestUserSearchAds" })),
  videoSpy: vi.fn((req, res) => res.status(200).json({ from: "getVideoURL" })),
  countSpy: vi.fn((req, res) => res.status(200).json({ from: "getAdsCount" })),
  graphSpy: vi.fn((req, res) => res.status(200).json({ from: "getAdsCountGraph" })),
  countriesSpy: vi.fn((req, res) => res.status(200).json({ from: "getAdsCountCountries" })),
}));

vi.mock("../../../core/guestUser/guestUser.controller.js", () => ({
  default: {
    getAdDetails: getAdSpy,
    guestUserSearchAds: searchSpy,
    getVideoURL: videoSpy,
    getAdsCount: countSpy,
    getAdsCountGraph: graphSpy,
    getAdsCountCountries: countriesSpy,
  },
}));

let router;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [getAdSpy, searchSpy, videoSpy, countSpy, graphSpy, countriesSpy])
    s.mockClear();
  ({ default: router } = await import("../../../core/guestUser/guestUser.routes.js"));
});

function appWith(r) {
  const app = express();
  app.use(express.json());
  app.use(r);
  return app;
}

describe("core/guestUser/guestUser.routes > controller dispatch", () => {
  it("GET /landing/:id -> getAdDetails with id param", async () => {
    const res = await request(appWith(router)).get("/landing/abc");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: "getAdDetails", id: "abc" });
  });

  it("POST /landing/getAds -> guestUserSearchAds", async () => {
    const res = await request(appWith(router)).post("/landing/getAds").send({});
    expect(searchSpy).toHaveBeenCalled();
  });

  it("POST /get-video-url -> getVideoURL", async () => {
    const res = await request(appWith(router)).post("/get-video-url").send({});
    expect(videoSpy).toHaveBeenCalled();
  });

  it("POST /tiktok-ads-count -> getAdsCount", async () => {
    const res = await request(appWith(router)).post("/tiktok-ads-count").send({});
    expect(countSpy).toHaveBeenCalled();
  });

  it("POST /tiktok-ads-count-graph -> getAdsCountGraph", async () => {
    const res = await request(appWith(router)).post("/tiktok-ads-count-graph").send({});
    expect(graphSpy).toHaveBeenCalled();
  });

  it("POST /tiktok-ads-countries -> getAdsCountCountries", async () => {
    const res = await request(appWith(router)).post("/tiktok-ads-countries").send({});
    expect(countriesSpy).toHaveBeenCalled();
  });
});
