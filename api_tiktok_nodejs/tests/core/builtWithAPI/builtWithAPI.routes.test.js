import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { updateSpy, getUrlsSpy } = vi.hoisted(() => ({
  updateSpy: vi.fn((req, res) => res.status(200).json({ from: "updateBuiltWithStatus" })),
  getUrlsSpy: vi.fn((req, res) => res.status(200).json({ from: "getUrlsForBuiltWith" })),
}));

vi.mock("../../../core/builtWithAPI/builtWithAPI.controller.js", () => ({
  default: {
    updateBuiltWithStatus: updateSpy,
    getUrlsForBuiltWith: getUrlsSpy,
  },
}));

let router;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [updateSpy, getUrlsSpy]) s.mockClear();
  ({ default: router } = await import("../../../core/builtWithAPI/builtWithAPI.routes.js"));
});

function appWith(r) {
  const app = express();
  app.use(express.json());
  app.use(r);
  return app;
}

describe("core/builtWithAPI/builtWithAPI.routes > controller dispatch", () => {
  it("POST /updateBuiltWithStatus -> updateBuiltWithStatus", async () => {
    const res = await request(appWith(router)).post("/updateBuiltWithStatus").send({});
    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalled();
  });

  it("GET /getUrlsForBuiltWith -> getUrlsForBuiltWith", async () => {
    const res = await request(appWith(router)).get("/getUrlsForBuiltWith");
    expect(res.status).toBe(200);
    expect(getUrlsSpy).toHaveBeenCalled();
  });
});
