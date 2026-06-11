import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { getAdSpy, uploadSpy, insertSpy, fieldsSpy } = vi.hoisted(() => {
  const noopMw = (req, _res, next) => next();
  return {
    getAdSpy: vi.fn((req, res) => res.status(200).json({ from: "getAdwithCountryCode" })),
    uploadSpy: vi.fn((req, res) => res.status(200).json({ from: "uploadFileToServer" })),
    insertSpy: vi.fn((req, res) => res.status(200).json({ from: "insertLanderContent" })),
    fieldsSpy: vi.fn(() => noopMw),
  };
});

vi.mock("../../../core/destinationLander/lander.controller.js", () => ({
  default: {
    getAdwithCountryCode: getAdSpy,
    uploadFileToServer: uploadSpy,
    insertLanderContent: insertSpy,
  },
}));

vi.mock("../../../utils/multer.js", () => ({
  default: { fields: fieldsSpy },
}));

let router;
beforeEach(async () => {
  vi.resetModules();
  for (const s of [getAdSpy, uploadSpy, insertSpy, fieldsSpy]) s.mockClear();
  ({ default: router } = await import("../../../core/destinationLander/lander.routes.js"));
});

function appWith(r) {
  const app = express();
  app.use(express.json());
  app.use(r);
  return app;
}

describe("core/destinationLander/lander.routes > controller dispatch", () => {
  it("GET /getAdwithCountryCode -> getAdwithCountryCode", async () => {
    const res = await request(appWith(router)).get("/getAdwithCountryCode");
    expect(res.status).toBe(200);
    expect(getAdSpy).toHaveBeenCalled();
  });

  it("POST /uploadFileToServer -> uploadFileToServer (with multer.fields middleware)", async () => {
    const res = await request(appWith(router))
      .post("/uploadFileToServer")
      .send({});
    expect(res.status).toBe(200);
    expect(uploadSpy).toHaveBeenCalled();
    expect(fieldsSpy).toHaveBeenCalledWith([
      { name: "image.png", maxCount: 1 },
      { name: "file.zip", maxCount: 1 },
    ]);
  });

  it("POST /insertLanderContent -> insertLanderContent", async () => {
    const res = await request(appWith(router))
      .post("/insertLanderContent")
      .send({});
    expect(res.status).toBe(200);
    expect(insertSpy).toHaveBeenCalled();
  });
});
