import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Mock jwt
const jwtPath = require.resolve("jsonwebtoken");
const verifySpy = vi.fn();
const signSpy = vi.fn(() => "signed-token");
require.cache[jwtPath] = {
  id: jwtPath, filename: jwtPath, loaded: true,
  exports: { verify: verifySpy, sign: signSpy },
};

// Mock config
const configPath = require.resolve("../../src/config");
const fakeConfig = {
  jwt: { secret: "s", algorithm: "HS512", expiresIn: "1h" },
};
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true, exports: fakeConfig,
};

const { authMiddleware, generateToken } = require("../../src/middleware/auth");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

beforeEach(() => {
  verifySpy.mockReset();
  signSpy.mockClear();
});

describe("middleware/auth > authMiddleware", () => {
  it("401 when no token in header or cookie", () => {
    const res = mockRes();
    const next = vi.fn();
    authMiddleware({ headers: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ code: 401, message: "Unauthorized: No token provided" });
    expect(next).not.toHaveBeenCalled();
  });

  it("extracts token from Bearer header", () => {
    verifySpy.mockReturnValueOnce({ id: "u1" });
    const req = { headers: { authorization: "Bearer abc.def.ghi" }, body: {} };
    const next = vi.fn();
    authMiddleware(req, mockRes(), next);
    expect(verifySpy).toHaveBeenCalledWith("abc.def.ghi", "s", { algorithms: ["HS512"] });
    expect(req.user).toEqual({ id: "u1" });
    expect(req.body.user_id).toBe("u1");
    expect(next).toHaveBeenCalled();
  });

  it("ignores non-Bearer Authorization header (line 16 false), falls back to cookie", () => {
    verifySpy.mockReturnValueOnce({ id: "u2" });
    const req = {
      headers: { authorization: "Basic dXNlcjpwYXNz" },
      cookies: { authToken: "cookie-token" },
      body: {},
    };
    const next = vi.fn();
    authMiddleware(req, mockRes(), next);
    expect(verifySpy).toHaveBeenCalledWith("cookie-token", "s", { algorithms: ["HS512"] });
    expect(next).toHaveBeenCalled();
  });

  it("falls back to authToken httpOnly cookie", () => {
    verifySpy.mockReturnValueOnce({ id: "u3" });
    const req = {
      headers: {},
      cookies: { authToken: "cookie-tok" },
      body: { user_id: "preset" },
    };
    authMiddleware(req, mockRes(), vi.fn());
    expect(verifySpy).toHaveBeenCalledWith("cookie-tok", "s", { algorithms: ["HS512"] });
    // user_id already set → not overwritten (line 39 false branch)
    expect(req.body.user_id).toBe("preset");
  });

  it("no req.body → user_id auto-inject skipped (line 39 first operand false)", () => {
    verifySpy.mockReturnValueOnce({ id: "u4" });
    const req = { headers: { authorization: "Bearer t" } };
    authMiddleware(req, mockRes(), vi.fn());
    expect(req.user.id).toBe("u4");
  });

  it("default jwt.algorithm 'HS512' when config omits it", () => {
    fakeConfig.jwt.algorithm = undefined;
    try {
      verifySpy.mockReturnValueOnce({ id: "u5" });
      authMiddleware({ headers: { authorization: "Bearer t" }, body: {} }, mockRes(), vi.fn());
      expect(verifySpy).toHaveBeenCalledWith("t", "s", { algorithms: ["HS512"] });
    } finally {
      fakeConfig.jwt.algorithm = "HS512";
    }
  });

  it("401 'Token expired' when jwt throws TokenExpiredError", () => {
    const err = new Error("jwt expired");
    err.name = "TokenExpiredError";
    verifySpy.mockImplementationOnce(() => { throw err; });
    const res = mockRes();
    authMiddleware({ headers: { authorization: "Bearer t" }, body: {} }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ code: 401, message: "Unauthorized: Token expired" });
  });

  it("401 'Invalid token' on other jwt errors", () => {
    verifySpy.mockImplementationOnce(() => { throw new Error("bad sig"); });
    const res = mockRes();
    authMiddleware({ headers: { authorization: "Bearer t" }, body: {} }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ code: 401, message: "Unauthorized: Invalid token" });
  });
});

describe("middleware/auth > generateToken", () => {
  it("calls jwt.sign with configured secret, algorithm, expiresIn", () => {
    const tok = generateToken({ id: "u1" });
    expect(tok).toBe("signed-token");
    expect(signSpy).toHaveBeenCalledWith(
      { id: "u1" }, "s",
      { algorithm: "HS512", expiresIn: "1h" }
    );
  });

  it("falls back to HS512 default algorithm when config omits it", () => {
    fakeConfig.jwt.algorithm = undefined;
    try {
      generateToken({ id: "u" });
      expect(signSpy.mock.calls.at(-1)[2].algorithm).toBe("HS512");
    } finally {
      fakeConfig.jwt.algorithm = "HS512";
    }
  });
});
