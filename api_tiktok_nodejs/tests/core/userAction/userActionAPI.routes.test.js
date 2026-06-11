import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { insertSpy, updateSpy } = vi.hoisted(() => ({
  insertSpy: vi.fn((req, res) => res.status(201).json({ from: "insert" })),
  updateSpy: vi.fn((req, res) =>
    res.status(200).json({ from: "update", email: req.params.email })
  ),
}));

vi.mock("../../../core/userAction/userActionAPI.controller.js", () => ({
  default: {
    insertAdsCountDetails: insertSpy,
    updateAdsCount: updateSpy,
  },
}));

let router;

beforeEach(async () => {
  vi.resetModules();
  insertSpy.mockClear();
  updateSpy.mockClear();
  ({ default: router } = await import(
    "../../../core/userAction/userActionAPI.routes.js"
  ));
});

function appWith(router) {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

describe("core/userAction/userActionAPI.routes > shape", () => {
  it("exports an Express router (function with use/get/post methods)", () => {
    expect(typeof router).toBe("function");
    expect(typeof router.use).toBe("function");
    expect(typeof router.get).toBe("function");
    expect(typeof router.post).toBe("function");
  });

  it("returns 404 for an unregistered path", async () => {
    const res = await request(appWith(router)).get("/nope");
    expect(res.status).toBe(404);
  });
});

describe("core/userAction/userActionAPI.routes > POST /update", () => {
  it("dispatches to userActionAPIController.insertAdsCountDetails", async () => {
    const res = await request(appWith(router))
      .post("/update")
      .send({ foo: "bar" });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ from: "insert" });
    expect(insertSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe("core/userAction/userActionAPI.routes > GET /action/:email", () => {
  it("dispatches to userActionAPIController.updateAdsCount with email param", async () => {
    const res = await request(appWith(router)).get(
      "/action/sumit%40chingari.io"
    );
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: "update", email: "sumit@chingari.io" });
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(insertSpy).not.toHaveBeenCalled();
  });
});
