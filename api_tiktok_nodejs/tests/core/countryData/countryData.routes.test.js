import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { addSpy, getAllSpy, getOneSpy, updateSpy, deleteSpy } = vi.hoisted(() => ({
  addSpy: vi.fn((req, res) => res.status(201).json({ from: "AddData" })),
  getAllSpy: vi.fn((req, res) => res.status(200).json({ from: "getAllCountry" })),
  getOneSpy: vi.fn((req, res) =>
    res.status(200).json({ from: "getCountry", id: req.params.countryid })
  ),
  updateSpy: vi.fn((req, res) =>
    res.status(200).json({ from: "updateCountryData", id: req.params.countryid })
  ),
  deleteSpy: vi.fn((req, res) =>
    res.status(200).json({ from: "deleteCountryData", id: req.params.countryid })
  ),
}));

vi.mock("../../../core/countryData/countryData.controller.js", () => ({
  default: {
    AddData: addSpy,
    getAllCountry: getAllSpy,
    getCountry: getOneSpy,
    updateCountryData: updateSpy,
    deleteCountryData: deleteSpy,
  },
}));

let router;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [addSpy, getAllSpy, getOneSpy, updateSpy, deleteSpy]) s.mockClear();
  ({ default: router } = await import("../../../core/countryData/countryData.routes.js"));
});

function appWith(r) {
  const app = express();
  app.use(express.json());
  app.use(r);
  return app;
}

describe("core/countryData/countryData.routes > controller dispatch", () => {
  it("POST /create -> AddData", async () => {
    const res = await request(appWith(router)).post("/create").send({ name: "IN" });
    expect(res.status).toBe(201);
    expect(addSpy).toHaveBeenCalled();
  });

  it("GET /get -> getAllCountry", async () => {
    const res = await request(appWith(router)).get("/get");
    expect(res.status).toBe(200);
    expect(getAllSpy).toHaveBeenCalled();
  });

  it("GET /get/:countryid -> getCountry with id param", async () => {
    const res = await request(appWith(router)).get("/get/42");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: "getCountry", id: "42" });
  });

  it("PATCH /update/:countryid -> updateCountryData", async () => {
    const res = await request(appWith(router)).patch("/update/7").send({ name: "US" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: "updateCountryData", id: "7" });
  });

  it("DELETE /delete/:countryid -> deleteCountryData", async () => {
    const res = await request(appWith(router)).delete("/delete/9");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: "deleteCountryData", id: "9" });
  });
});
