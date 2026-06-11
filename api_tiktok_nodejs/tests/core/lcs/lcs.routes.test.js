import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { updateSpy, getSpy } = vi.hoisted(() => ({
  updateSpy: vi.fn((req, res) => res.status(200).json({ from: "update" })),
  getSpy: vi.fn((req, res) =>
    res.status(200).json({ from: "getLCS", id: req.params.id })
  ),
}));

vi.mock("../../../core/lcs/lcs.controller.js", () => ({
  default: { update: updateSpy, getLCS: getSpy },
}));

let router;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [updateSpy, getSpy]) s.mockClear();
  ({ default: router } = await import("../../../core/lcs/lcs.routes.js"));
});

function appWith(r) {
  const app = express();
  app.use(express.json());
  app.use(r);
  return app;
}

describe("core/lcs/lcs.routes > controller dispatch", () => {
  it("PATCH /update -> update", async () => {
    const res = await request(appWith(router)).patch("/update").send({});
    expect(res.status).toBe(200);
    expect(updateSpy).toHaveBeenCalled();
  });

  it("GET /getLCS/:id -> getLCS with id param", async () => {
    const res = await request(appWith(router)).get("/getLCS/99");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: "getLCS", id: "99" });
    expect(getSpy).toHaveBeenCalled();
  });
});
