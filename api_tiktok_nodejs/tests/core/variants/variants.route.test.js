import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { create, getAll, getOne, update, del } = vi.hoisted(() => ({
  create: vi.fn((req, res) => res.status(201).json({ from: "create" })),
  getAll: vi.fn((req, res) => res.status(200).json({ from: "getAll" })),
  getOne: vi.fn((req, res) =>
    res.status(200).json({ from: "getOne", id: req.params.variantsid })
  ),
  update: vi.fn((req, res) =>
    res.status(200).json({ from: "update", id: req.params.variantsid })
  ),
  del: vi.fn((req, res) =>
    res.status(200).json({ from: "delete", id: req.params.variantsid })
  ),
}));

vi.mock("../../../core/variants/veriants.controller.js", () => ({
  default: {
    createVariants: create,
    getAllVariants: getAll,
    getVariants: getOne,
    updateVariants: update,
    deleteVariants: del,
  },
}));

let router;

beforeEach(async () => {
  vi.resetModules();
  for (const s of [create, getAll, getOne, update, del]) s.mockClear();
  ({ default: router } = await import(
    "../../../core/variants/variants.route.js"
  ));
});

function appWith(r) {
  const app = express();
  app.use(express.json());
  app.use(r);
  return app;
}

describe("core/variants/variants.route > shape", () => {
  it("exports an Express router", () => {
    expect(typeof router).toBe("function");
    expect(typeof router.use).toBe("function");
  });
});

describe("core/variants/variants.route > five CRUD routes", () => {
  it("POST /create -> variantsController.createVariants", async () => {
    const res = await request(appWith(router))
      .post("/create")
      .send({ name: "v1" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ from: "create" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("GET /get -> variantsController.getAllVariants", async () => {
    const res = await request(appWith(router)).get("/get");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: "getAll" });
    expect(getAll).toHaveBeenCalledTimes(1);
  });

  it("GET /get/:variantsid -> variantsController.getVariants", async () => {
    const res = await request(appWith(router)).get("/get/42");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: "getOne", id: "42" });
    expect(getOne).toHaveBeenCalledTimes(1);
  });

  it("PATCH /update/:variantsid -> variantsController.updateVariants", async () => {
    const res = await request(appWith(router))
      .patch("/update/abc")
      .send({ name: "v2" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: "update", id: "abc" });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("DELETE /delete/:variantsid -> variantsController.deleteVariants", async () => {
    const res = await request(appWith(router)).delete("/delete/99");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: "delete", id: "99" });
    expect(del).toHaveBeenCalledTimes(1);
  });
});

describe("core/variants/variants.route > unknown paths", () => {
  it("returns 404 for routes not registered on this router", async () => {
    const res = await request(appWith(router)).get("/nope");
    expect(res.status).toBe(404);
  });
});
