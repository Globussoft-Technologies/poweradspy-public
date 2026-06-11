import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const { loginSpy, getUserSpy } = vi.hoisted(() => ({
  loginSpy: vi.fn((req, res) => res.status(200).json({ from: "login" })),
  getUserSpy: vi.fn((req, res) =>
    res.status(200).json({ from: "getUser", body: req.body })
  ),
}));

vi.mock("../../../core/users/users.controller.js", () => ({
  default: { login: loginSpy, getUser: getUserSpy },
}));

let router;

beforeEach(async () => {
  vi.resetModules();
  loginSpy.mockClear();
  getUserSpy.mockClear();
  ({ default: router } = await import(
    "../../../core/users/users.routes.js"
  ));
});

function appWith(r) {
  const app = express();
  app.use(express.json());
  app.use(r);
  return app;
}

describe("core/users/users.routes > module shape", () => {
  it("exports an Express router", () => {
    expect(typeof router).toBe("function");
    expect(typeof router.use).toBe("function");
  });
});

describe("core/users/users.routes > POST /login", () => {
  it("dispatches to usersController.login", async () => {
    const res = await request(appWith(router))
      .post("/login")
      .send({ email: "x@y.z", password: "p" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: "login" });
    expect(loginSpy).toHaveBeenCalledTimes(1);
    expect(getUserSpy).not.toHaveBeenCalled();
  });
});

describe("core/users/users.routes > POST /get-user-details", () => {
  it("dispatches to usersController.getUser with the request body", async () => {
    const res = await request(appWith(router))
      .post("/get-user-details")
      .send({ id: 42 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ from: "getUser", body: { id: 42 } });
    expect(getUserSpy).toHaveBeenCalledTimes(1);
    expect(loginSpy).not.toHaveBeenCalled();
  });
});

describe("core/users/users.routes > unknown paths", () => {
  it("returns 404 for routes not registered on this router", async () => {
    const res = await request(appWith(router)).get("/random");
    expect(res.status).toBe(404);
  });
});
