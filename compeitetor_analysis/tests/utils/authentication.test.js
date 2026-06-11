import { describe, it, expect, vi, beforeEach } from "vitest";

const { jwtVerifySpy, configGetSpy, basicAuthSpy } = vi.hoisted(() => ({
  jwtVerifySpy: vi.fn(),
  configGetSpy: vi.fn(),
  basicAuthSpy: vi.fn(),
}));

vi.mock("jsonwebtoken", () => ({ default: { verify: jwtVerifySpy } }));
vi.mock("config", () => ({ default: { get: configGetSpy } }));
vi.mock("basic-auth", () => ({ default: basicAuthSpy }));

let verifyToken, SwaggerAuth;

beforeEach(async () => {
  jwtVerifySpy.mockReset();
  configGetSpy.mockReset();
  basicAuthSpy.mockReset();
  vi.resetModules();
  ({ verifyToken, SwaggerAuth } = await import("../../utils/authentication.js"));
});

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.send = vi.fn(() => res);
  res.set = vi.fn(() => res);
  return res;
}

describe("utils/authentication > verifyToken", () => {
  it("401 'Unauthorized request!' when authorization header missing", () => {
    const res = mockRes();
    const next = vi.fn();
    verifyToken({ headers: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: "Unauthorized request!" });
    expect(next).not.toHaveBeenCalled();
  });

  it("401 'Token expired!' when jwt.verify yields an error", () => {
    configGetSpy.mockReturnValueOnce("secret");
    jwtVerifySpy.mockImplementationOnce((tok, secret, cb) => cb(new Error("bad")));
    const res = mockRes();
    verifyToken({ headers: { authorization: "Bearer abc" } }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: "Token expired!" });
  });

  it("sets req.user and calls next() on valid token", () => {
    configGetSpy.mockReturnValueOnce("secret");
    jwtVerifySpy.mockImplementationOnce((tok, secret, cb) => cb(null, { id: 9 }));
    const req = { headers: { authorization: "Bearer good" } };
    const res = mockRes();
    const next = vi.fn();
    verifyToken(req, res, next);
    expect(jwtVerifySpy).toHaveBeenCalledWith("good", "secret", expect.any(Function));
    expect(req.user).toEqual({ id: 9 });
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("utils/authentication > SwaggerAuth", () => {
  it("401 + WWW-Authenticate when basic-auth returns no user", () => {
    basicAuthSpy.mockReturnValueOnce(null);
    const res = mockRes();
    SwaggerAuth({ headers: {} }, res, vi.fn());
    expect(res.set).toHaveBeenCalledWith("WWW-Authenticate", 'Basic realm="401"');
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith("Authentication required.");
  });

  it("401 when name/pass don't match", () => {
    basicAuthSpy.mockReturnValueOnce({ name: "wrong", pass: "wrong" });
    configGetSpy.mockReturnValueOnce("u").mockReturnValueOnce("p");
    const res = mockRes();
    SwaggerAuth({ headers: {} }, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("calls next() when credentials match", () => {
    basicAuthSpy.mockReturnValueOnce({ name: "u", pass: "p" });
    configGetSpy.mockReturnValueOnce("u").mockReturnValueOnce("p");
    const res = mockRes();
    const next = vi.fn();
    SwaggerAuth({ headers: {} }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
