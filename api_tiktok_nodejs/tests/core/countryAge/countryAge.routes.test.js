import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { addSpy, getAllSpy, getOneSpy, updateSpy, deleteSpy } = vi.hoisted(() => ({
  addSpy: vi.fn((req, res) => res.status(201).json({ from: "AddCountryAge" })),
  getAllSpy: vi.fn((req, res) => res.status(200).json({ from: "getAllCountryAge" })),
  getOneSpy: vi.fn((req, res) =>
    res.status(200).json({ from: "getCountryAge", id: req.params.ageid })
  ),
  updateSpy: vi.fn((req, res) =>
    res.status(200).json({ from: "updateCountryAge", id: req.params.ageid })
  ),
  deleteSpy: vi.fn((req, res) =>
    res.status(200).json({ from: "deleteCountryAge", id: req.params.ageid })
  ),
}));

vi.mock("../../../core/countryAge/countryAge.controller.js", () => ({
  default: {
    AddCountryAge: addSpy,
    getAllCountryAge: getAllSpy,
    getCountryAge: getOneSpy,
    updateCountryAge: updateSpy,
    deleteCountryAge: deleteSpy,
  },
}));

let router;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [addSpy, getAllSpy, getOneSpy, updateSpy, deleteSpy]) s.mockClear();
  ({ default: router } = await import("../../../core/countryAge/countryAge.routes.js"));
});

function appWith(r) {
  const app = express();
  app.use(express.json());
  app.use(r);
  return app;
}

describe("core/countryAge/countryAge.routes > controller dispatch", () => {
  it("POST /create -> AddCountryAge", async () => {
    const res = await request(appWith(router)).post("/create").send({});
    expect(res.status).toBe(201);
    expect(addSpy).toHaveBeenCalled();
  });

  it("GET /get -> getAllCountryAge", async () => {
    const res = await request(appWith(router)).get("/get");
    expect(res.status).toBe(200);
  });

  it("GET /get/:ageid -> getCountryAge with id param", async () => {
    const res = await request(appWith(router)).get("/get/18");
    expect(res.body).toEqual({ from: "getCountryAge", id: "18" });
  });

  it("PATCH /update/:ageid -> updateCountryAge", async () => {
    const res = await request(appWith(router)).patch("/update/22").send({});
    expect(res.body).toEqual({ from: "updateCountryAge", id: "22" });
  });

  it("DELETE /delete/:ageid -> deleteCountryAge", async () => {
    const res = await request(appWith(router)).delete("/delete/35");
    expect(res.body).toEqual({ from: "deleteCountryAge", id: "35" });
  });
});
