import { describe, it, expect, vi, beforeEach } from "vitest";

const { createSendTokenSpy, getUserSpy } = vi.hoisted(() => ({
  createSendTokenSpy: vi.fn(async () => "login-result"),
  getUserSpy: vi.fn(async () => "get-user-result"),
}));

vi.mock("../../../utils/authentication.js", () => ({
  createSendToken: createSendTokenSpy,
}));

vi.mock("../../../core/users/users.service.js", () => ({
  default: { getUser: getUserSpy },
}));

let usersController;

beforeEach(async () => {
  vi.resetModules();
  createSendTokenSpy.mockClear();
  getUserSpy.mockClear();
  ({ default: usersController } = await import(
    "../../../core/users/users.controller.js"
  ));
});

describe("core/users/users.controller", () => {
  it("login delegates to authentication.createSendToken with req/res/next", async () => {
    const req = { body: { u: 1 } };
    const res = {};
    const next = vi.fn();
    const result = await usersController.login(req, res, next);
    expect(createSendTokenSpy).toHaveBeenCalledWith(req, res, next);
    expect(result).toBe("login-result");
  });

  it("getUser delegates to usersService.getUser with req/res/next", async () => {
    const req = { body: { token: "x" } };
    const res = {};
    const next = vi.fn();
    const result = await usersController.getUser(req, res, next);
    expect(getUserSpy).toHaveBeenCalledWith(req, res, next);
    expect(result).toBe("get-user-result");
  });
});
