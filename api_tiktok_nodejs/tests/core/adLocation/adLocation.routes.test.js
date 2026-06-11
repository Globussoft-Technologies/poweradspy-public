import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { addSpy, getAllSpy, getOneSpy, updateSpy, deleteSpy } = vi.hoisted(() => ({
  addSpy: vi.fn((req, res) => res.status(201).json({ from: "AddLocation" })),
  getAllSpy: vi.fn((req, res) => res.status(200).json({ from: "getAllLocationData" })),
  getOneSpy: vi.fn((req, res) =>
    res.status(200).json({ from: "getLocationData", id: req.params.locationid })
  ),
  updateSpy: vi.fn((req, res) =>
    res.status(200).json({ from: "updateLocationData", id: req.params.locationid })
  ),
  deleteSpy: vi.fn((req, res) =>
    res.status(200).json({ from: "deleteLocationData", id: req.params.locationid })
  ),
}));

vi.mock("../../../core/adLocation/adLocation.controller.js", () => ({
  default: {
    AddLocation: addSpy,
    getAllLocationData: getAllSpy,
    getLocationData: getOneSpy,
    updateLocationData: updateSpy,
    deleteLocationData: deleteSpy,
  },
}));

let router;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [addSpy, getAllSpy, getOneSpy, updateSpy, deleteSpy]) s.mockClear();
  ({ default: router } = await import("../../../core/adLocation/adLocation.routes.js"));
});

function appWith(r) {
  const app = express();
  app.use(express.json());
  app.use(r);
  return app;
}

describe("core/adLocation/adLocation.routes > controller dispatch", () => {
  it("POST /create -> AddLocation", async () => {
    const res = await request(appWith(router)).post("/create").send({ city: "X" });
    expect(res.status).toBe(201);
    expect(addSpy).toHaveBeenCalled();
  });

  it("GET /get -> getAllLocationData", async () => {
    const res = await request(appWith(router)).get("/get");
    expect(res.status).toBe(200);
    expect(getAllSpy).toHaveBeenCalled();
  });

  it("GET /get/:locationid -> getLocationData with id param", async () => {
    const res = await request(appWith(router)).get("/get/77");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: "getLocationData", id: "77" });
    expect(getOneSpy).toHaveBeenCalled();
  });

  it("PATCH /update/:locationid -> updateLocationData", async () => {
    const res = await request(appWith(router))
      .patch("/update/12")
      .send({ city: "Y" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: "updateLocationData", id: "12" });
  });

  it("DELETE /delete/:locationid -> deleteLocationData", async () => {
    const res = await request(appWith(router)).delete("/delete/55");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: "deleteLocationData", id: "55" });
  });
});
