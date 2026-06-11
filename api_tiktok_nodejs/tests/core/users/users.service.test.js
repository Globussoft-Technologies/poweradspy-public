import { describe, it, expect, vi, beforeEach } from "vitest";

const { jwtVerifySpy, loggerErrorSpy, validationFailSpy, userSuccessSpy, userFailSpy } =
  vi.hoisted(() => ({
    jwtVerifySpy: vi.fn(),
    loggerErrorSpy: vi.fn(),
    validationFailSpy: vi.fn((msg, extra) => ({
      ok: false,
      kind: "validation",
      msg,
      extra,
    })),
    userSuccessSpy: vi.fn((msg, data) => ({
      ok: true,
      kind: "user",
      msg,
      data,
    })),
    userFailSpy: vi.fn((msg, err) => ({
      ok: false,
      kind: "user-fail",
      msg,
      err,
    })),
  }));

vi.mock("jsonwebtoken", () => ({
  default: { verify: jwtVerifySpy },
}));

vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { error: loggerErrorSpy },
}));

vi.mock("../../../utils/response.js", () => ({
  default: {
    validationFailResp: validationFailSpy,
    userSuccessResp: userSuccessSpy,
    userFailResp: userFailSpy,
  },
}));

vi.mock("config", () => ({
  default: {
    get: (key) => {
      if (key === "jwt_secret_key") return "test-secret";
      throw new Error(`unstubbed config: ${key}`);
    },
  },
}));

let usersService;

beforeEach(async () => {
  vi.resetModules();
  jwtVerifySpy.mockReset();
  loggerErrorSpy.mockClear();
  validationFailSpy.mockClear();
  userSuccessSpy.mockClear();
  userFailSpy.mockClear();
  ({ default: usersService } = await import(
    "../../../core/users/users.service.js"
  ));
});

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.send = vi.fn(() => res);
  return res;
}

describe("core/users/users.service > getUser", () => {
  it("returns validationFailResp when no token is supplied", async () => {
    const res = mockRes();
    await usersService.getUser({ body: {} }, res);
    expect(loggerErrorSpy).toHaveBeenCalledWith("Missing jwt token in body");
    expect(validationFailSpy).toHaveBeenCalledWith(
      "Missing jwt token in body",
      ""
    );
    expect(res.send).toHaveBeenCalledWith({
      ok: false,
      kind: "validation",
      msg: "Missing jwt token in body",
      extra: "",
    });
    expect(jwtVerifySpy).not.toHaveBeenCalled();
  });

  it("returns 401 'Token expired!' when jwt.verify yields an error", async () => {
    jwtVerifySpy.mockImplementation((token, key, cb) => {
      cb(new Error("jwt expired"), null);
    });
    const res = mockRes();
    await usersService.getUser({ body: { token: "abc" } }, res);
    expect(jwtVerifySpy).toHaveBeenCalledWith(
      "abc",
      "test-secret",
      expect.any(Function)
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: "Token expired!" });
  });

  it("returns userSuccessResp with decoded payload when verify succeeds", async () => {
    const decoded = { user_id: 42, email: "x@y.io" };
    jwtVerifySpy.mockImplementation((token, key, cb) => {
      cb(null, decoded);
    });
    const res = mockRes();
    await usersService.getUser({ body: { token: "abc" } }, res);
    expect(userSuccessSpy).toHaveBeenCalledWith("User details found", decoded);
    expect(res.send).toHaveBeenCalledWith({
      ok: true,
      kind: "user",
      msg: "User details found",
      data: decoded,
    });
  });

  it("returns userFailResp via outer catch when jwt.verify throws synchronously", async () => {
    const err = new Error("synchronous boom");
    jwtVerifySpy.mockImplementation(() => {
      throw err;
    });
    const res = mockRes();
    await usersService.getUser({ body: { token: "abc" } }, res);
    expect(loggerErrorSpy).toHaveBeenCalledWith("Error decoding data", err);
    expect(userFailSpy).toHaveBeenCalledWith("Error decoding data", err);
    expect(res.send).toHaveBeenCalledWith({
      ok: false,
      kind: "user-fail",
      msg: "Error decoding data",
      err,
    });
  });
});
