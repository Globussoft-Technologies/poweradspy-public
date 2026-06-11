import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { addSpy, getAllSpy, getOneSpy, updateSpy, deleteSpy } = vi.hoisted(() => ({
  addSpy: vi.fn((req, res) => res.status(201).json({ from: "AddCountryGender" })),
  getAllSpy: vi.fn((req, res) => res.status(200).json({ from: "getAllCountryGender" })),
  getOneSpy: vi.fn((req, res) =>
    res.status(200).json({ from: "getCountryGender", id: req.params.genderid })
  ),
  updateSpy: vi.fn((req, res) =>
    res.status(200).json({ from: "updateCountryGender", id: req.params.genderid })
  ),
  deleteSpy: vi.fn((req, res) =>
    res.status(200).json({ from: "deleteCountryGender", id: req.params.genderid })
  ),
}));

vi.mock("../../../core/countryGender/countryGender.controller.js", () => ({
  default: {
    AddCountryGender: addSpy,
    getAllCountryGender: getAllSpy,
    getCountryGender: getOneSpy,
    updateCountryGender: updateSpy,
    deleteCountryGender: deleteSpy,
  },
}));

let router;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [addSpy, getAllSpy, getOneSpy, updateSpy, deleteSpy]) s.mockClear();
  ({ default: router } = await import("../../../core/countryGender/countryGender.routes.js"));
});

function appWith(r) {
  const app = express();
  app.use(express.json());
  app.use(r);
  return app;
}

describe("core/countryGender/countryGender.routes > controller dispatch", () => {
  it("POST /create -> AddCountryGender", async () => {
    const res = await request(appWith(router)).post("/create").send({});
    expect(res.status).toBe(201);
    expect(addSpy).toHaveBeenCalled();
  });

  it("GET /get -> getAllCountryGender", async () => {
    const res = await request(appWith(router)).get("/get");
    expect(res.status).toBe(200);
    expect(getAllSpy).toHaveBeenCalled();
  });

  it("GET /get/:genderid -> getCountryGender with id param", async () => {
    const res = await request(appWith(router)).get("/get/3");
    expect(res.body).toEqual({ from: "getCountryGender", id: "3" });
  });

  it("PATCH /update/:genderid -> updateCountryGender", async () => {
    const res = await request(appWith(router)).patch("/update/4").send({});
    expect(res.body).toEqual({ from: "updateCountryGender", id: "4" });
  });

  it("DELETE /delete/:genderid -> deleteCountryGender", async () => {
    const res = await request(appWith(router)).delete("/delete/5");
    expect(res.body).toEqual({ from: "deleteCountryGender", id: "5" });
  });
});
