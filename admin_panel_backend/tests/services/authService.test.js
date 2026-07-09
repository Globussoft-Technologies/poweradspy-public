import { describe, it, expect, vi, beforeEach } from "vitest";

// authService.js uses ESM syntax (import/export) inside a CJS-default
// package — vitest's loader handles it. Test file is .test.js (matches
// vitest's pattern AND uses import-syntax friendly to mixed-module repos).

const { jwtVerifySpy } = vi.hoisted(() => ({
  jwtVerifySpy: vi.fn(),
}));

vi.mock("jsonwebtoken", () => ({
  default: { verify: jwtVerifySpy },
}));

vi.mock("dotenv", () => ({ default: { config: vi.fn() } }));
                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                
let authenticateJWT;

beforeEach(async () => {
  vi.resetModules();
  jwtVerifySpy.mockReset();
  process.env.JWT_SECRET = "test-secret";
  ({ authenticateJWT } = await import("../../services/authService.js"));
});

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe("services/authService > authenticateJWT", () => {
  it("401 'Authorization token missing' when header is absent", () => {
    const res = mockRes();
    const next = vi.fn();
    authenticateJWT({ headers: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      message: "Authorization token missing",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("401 when header doesn't start with 'Bearer '", () => {
    const res = mockRes();
    const next = vi.fn();
    authenticateJWT(
      { headers: { authorization: "Basic abc" } },
      res,
      next
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      message: "Authorization token missing",
    });
  });

  it("401 'Invalid access token' when decoded payload lacks user_name", () => {
    jwtVerifySpy.mockReturnValueOnce({ id: 1 });
    const res = mockRes();
    authenticateJWT(
      { headers: { authorization: "Bearer abc" } },
      res,
      vi.fn()
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: "Invalid access token" });
  });

  it("sets req.user and calls next() on valid token", () => {
    const decoded = { user_name: "sumit", role: "admin" };
    jwtVerifySpy.mockReturnValueOnce(decoded);
    const req = { headers: { authorization: "Bearer good-token" } };
    const res = mockRes();
    const next = vi.fn();
    authenticateJWT(req, res, next);
    expect(jwtVerifySpy).toHaveBeenCalledWith("good-token", "test-secret");
    expect(req.user).toBe(decoded);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("401 'Unauthorized' when jwt.verify throws", () => {
    jwtVerifySpy.mockImplementationOnce(() => {
      throw new Error("bad-signature");
    });
    const res = mockRes();
    authenticateJWT(
      { headers: { authorization: "Bearer bad-token" } },
      res,
      vi.fn()
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: "Unauthorized" });
  });
});
