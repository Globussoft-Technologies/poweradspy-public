import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { addSpy, getAllSpy, getOneSpy, updateSpy, deleteSpy } = vi.hoisted(() => ({
  addSpy: vi.fn((req, res) => res.status(201).json({ from: "createMetaData" })),
  getAllSpy: vi.fn((req, res) => res.status(200).json({ from: "getAllMetaData" })),
  getOneSpy: vi.fn((req, res) =>
    res.status(200).json({ from: "getMetaData", id: req.params.metadataid })
  ),
  updateSpy: vi.fn((req, res) =>
    res.status(200).json({ from: "updateMetaData", id: req.params.metadataid })
  ),
  deleteSpy: vi.fn((req, res) =>
    res.status(200).json({ from: "deleteMetaData", id: req.params.metadataid })
  ),
}));

vi.mock("../../../core/metaData/metaData.controller.js", () => ({
  default: {
    createMetaData: addSpy,
    getAllMetaData: getAllSpy,
    getMetaData: getOneSpy,
    updateMetaData: updateSpy,
    deleteMetaData: deleteSpy,
  },
}));

let router;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [addSpy, getAllSpy, getOneSpy, updateSpy, deleteSpy]) s.mockClear();
  ({ default: router } = await import("../../../core/metaData/metaData.routes.js"));
});

function appWith(r) {
  const app = express();
  app.use(express.json());
  app.use(r);
  return app;
}

describe("core/metaData/metaData.routes > controller dispatch", () => {
  it("POST /create -> createMetaData", async () => {
    const res = await request(appWith(router)).post("/create").send({});
    expect(res.status).toBe(201);
    expect(addSpy).toHaveBeenCalled();
  });

  it("GET /get -> getAllMetaData", async () => {
    const res = await request(appWith(router)).get("/get");
    expect(res.status).toBe(200);
  });

  it("GET /get/:metadataid -> getMetaData", async () => {
    const res = await request(appWith(router)).get("/get/55");
    expect(res.body).toEqual({ from: "getMetaData", id: "55" });
  });

  it("PATCH /update/:metadataid -> updateMetaData", async () => {
    const res = await request(appWith(router)).patch("/update/11").send({});
    expect(res.body).toEqual({ from: "updateMetaData", id: "11" });
  });

  it("DELETE /delete/:metadataid -> deleteMetaData", async () => {
    const res = await request(appWith(router)).delete("/delete/9");
    expect(res.body).toEqual({ from: "deleteMetaData", id: "9" });
  });
});
