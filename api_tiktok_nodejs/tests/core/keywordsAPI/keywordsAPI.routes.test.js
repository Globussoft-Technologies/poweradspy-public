import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { addSpy, getSpy, logsSpy } = vi.hoisted(() => ({
  addSpy: vi.fn((req, res) => res.status(201).json({ from: "addKeywords" })),
  getSpy: vi.fn((req, res) => res.status(200).json({ from: "getKeywords" })),
  logsSpy: vi.fn((req, res) => res.status(200).json({ from: "getLogFiles" })),
}));

vi.mock("../../../core/keywordsAPI/keywordsAPI.controller.js", () => ({
  default: {
    addKeywords: addSpy,
    getKeywords: getSpy,
    getLogFiles: logsSpy,
  },
}));

let router;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [addSpy, getSpy, logsSpy]) s.mockClear();
  ({ default: router } = await import("../../../core/keywordsAPI/keywordsAPI.routes.js"));
});

function appWith(r) {
  const app = express();
  app.use(express.json());
  app.use(r);
  return app;
}

describe("core/keywordsAPI/keywordsAPI.routes > controller dispatch", () => {
  it("POST /create -> addKeywords", async () => {
    const res = await request(appWith(router)).post("/create").send({});
    expect(res.status).toBe(201);
    expect(addSpy).toHaveBeenCalled();
  });

  it("GET /get -> getKeywords", async () => {
    const res = await request(appWith(router)).get("/get");
    expect(res.status).toBe(200);
    expect(getSpy).toHaveBeenCalled();
  });

  it("GET /get-all-logs -> getLogFiles", async () => {
    const res = await request(appWith(router)).get("/get-all-logs");
    expect(res.status).toBe(200);
    expect(logsSpy).toHaveBeenCalled();
  });
});
