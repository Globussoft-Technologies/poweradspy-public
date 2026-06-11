import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { searchSpy, countSpy, industriesSpy } = vi.hoisted(() => ({
  searchSpy: vi.fn((req, res) => res.status(200).json({ from: "searchFilter" })),
  countSpy: vi.fn((req, res) => res.status(200).json({ from: "getAdsCountDetails" })),
  industriesSpy: vi.fn((req, res) => res.status(200).json({ from: "getIndustries" })),
}));

vi.mock("../../../core/dashboard/dashboard.controller.js", () => ({
  default: {
    searchFilter: searchSpy,
    getAdsCountDetails: countSpy,
    getIndustries: industriesSpy,
  },
}));

let router;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [searchSpy, countSpy, industriesSpy]) s.mockClear();
  ({ default: router } = await import("../../../core/dashboard/dashboard.routes.js"));
});

function appWith(r) {
  const app = express();
  app.use(express.json());
  app.use(r);
  return app;
}

describe("core/dashboard/dashboard.routes > controller dispatch", () => {
  it("POST /searchFilter -> searchFilter", async () => {
    const res = await request(appWith(router)).post("/searchFilter").send({});
    expect(res.status).toBe(200);
    expect(searchSpy).toHaveBeenCalled();
  });

  it("POST /get-ads-count -> getAdsCountDetails", async () => {
    const res = await request(appWith(router)).post("/get-ads-count").send({});
    expect(res.status).toBe(200);
    expect(countSpy).toHaveBeenCalled();
  });

  it("GET /get-industries -> getIndustries", async () => {
    const res = await request(appWith(router)).get("/get-industries");
    expect(res.status).toBe(200);
    expect(industriesSpy).toHaveBeenCalled();
  });
});
