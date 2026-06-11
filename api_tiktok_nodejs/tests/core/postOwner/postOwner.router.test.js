import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { addSpy, getAllSpy, getOneSpy, updateSpy, deleteSpy } = vi.hoisted(() => ({
  addSpy: vi.fn((req, res) => res.status(201).json({ from: "createPostOwner" })),
  getAllSpy: vi.fn((req, res) => res.status(200).json({ from: "getAllPostOwner" })),
  getOneSpy: vi.fn((req, res) =>
    res.status(200).json({ from: "getPostOwner", id: req.params.postownerid })
  ),
  updateSpy: vi.fn((req, res) =>
    res.status(200).json({ from: "updatePostOwner", id: req.params.postownerid })
  ),
  deleteSpy: vi.fn((req, res) =>
    res.status(200).json({ from: "deletePostOwner", id: req.params.postownerid })
  ),
}));

vi.mock("../../../core/postOwner/postOwner.controller.js", () => ({
  default: {
    createPostOwner: addSpy,
    getAllPostOwner: getAllSpy,
    getPostOwner: getOneSpy,
    updatePostOwner: updateSpy,
    deletePostOwner: deleteSpy,
  },
}));

let router;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [addSpy, getAllSpy, getOneSpy, updateSpy, deleteSpy]) s.mockClear();
  ({ default: router } = await import("../../../core/postOwner/postOwner.router.js"));
});

function appWith(r) {
  const app = express();
  app.use(express.json());
  app.use(r);
  return app;
}

describe("core/postOwner/postOwner.router > controller dispatch", () => {
  it("POST /create -> createPostOwner", async () => {
    const res = await request(appWith(router)).post("/create").send({});
    expect(res.status).toBe(201);
    expect(addSpy).toHaveBeenCalled();
  });

  it("GET /get -> getAllPostOwner", async () => {
    const res = await request(appWith(router)).get("/get");
    expect(res.status).toBe(200);
  });

  it("GET /get/:postownerid -> getPostOwner", async () => {
    const res = await request(appWith(router)).get("/get/1");
    expect(res.body).toEqual({ from: "getPostOwner", id: "1" });
  });

  it("PATCH /update/:postownerid -> updatePostOwner", async () => {
    const res = await request(appWith(router)).patch("/update/2").send({});
    expect(res.body).toEqual({ from: "updatePostOwner", id: "2" });
  });

  it("DELETE /delete/:postownerid -> deletePostOwner", async () => {
    const res = await request(appWith(router)).delete("/delete/3");
    expect(res.body).toEqual({ from: "deletePostOwner", id: "3" });
  });
});
