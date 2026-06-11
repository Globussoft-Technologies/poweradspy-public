import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  jwtVerifySpy,
  jwtSignSpy,
  basicAuthSpy,
  userSuccessSpy,
} = vi.hoisted(() => ({
  jwtVerifySpy: vi.fn(),
  jwtSignSpy: vi.fn(() => "signed.jwt.token"),
  basicAuthSpy: vi.fn(),
  userSuccessSpy: vi.fn((msg, data) => ({ ok: true, msg, data })),
}));

vi.mock("jsonwebtoken", () => ({
  default: { verify: jwtVerifySpy, sign: jwtSignSpy },
}));

vi.mock("basic-auth", () => ({ default: basicAuthSpy }));

vi.mock("../../utils/response.js", () => ({
  default: { userSuccessResp: userSuccessSpy },
}));

vi.mock("config", () => ({
  default: {
    get: (key) => {
      const map = {
        jwt_secret_key: "test-secret",
        username: "admin",
        password: "pa$$",
      };
      if (!(key in map)) throw new Error(`unstubbed: ${key}`);
      return map[key];
    },
  },
}));

let verifyToken;
let createSendToken;
let SwaggerAuth;

beforeEach(async () => {
  vi.resetModules();
  jwtVerifySpy.mockReset();
  jwtSignSpy.mockClear().mockReturnValue("signed.jwt.token");
  basicAuthSpy.mockReset();
  userSuccessSpy.mockClear();
  ({ verifyToken, createSendToken, SwaggerAuth } = await import(
    "../../utils/authentication.js"
  ));
});

function makeRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.send = vi.fn(() => res);
  res.set = vi.fn(() => res);
  return res;
}

describe("utils/authentication > verifyToken", () => {
  it("returns 401 'Unauthorized request!' when no Authorization header", () => {
    const res = makeRes();
    const next = vi.fn();
    verifyToken({ headers: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: "Unauthorized request!" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 'Token expired!' when jwt.verify yields an error", () => {
    jwtVerifySpy.mockImplementation((tok, key, cb) => cb(new Error("bad"), null));
    const res = makeRes();
    const next = vi.fn();
    verifyToken(
      { headers: { authorization: "Bearer abc" } },
      res,
      next
    );
    expect(jwtVerifySpy).toHaveBeenCalledWith("abc", "test-secret", expect.any(Function));
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: "Token expired!" });
    expect(next).not.toHaveBeenCalled();
  });

  it("attaches decoded payload to req.user and calls next() on success", () => {
    const decoded = { username: "admin" };
    jwtVerifySpy.mockImplementation((tok, key, cb) => cb(null, decoded));
    const req = { headers: { authorization: "Bearer abc" } };
    const res = makeRes();
    const next = vi.fn();
    verifyToken(req, res, next);
    expect(req.user).toBe(decoded);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("utils/authentication > createSendToken", () => {
  it("returns 401 'Username or password incorrect' for bad creds", async () => {
    const res = makeRes();
    await createSendToken(
      { body: { username: "wrong", password: "pa$$" } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith("Username or password incorrect");
    expect(jwtSignSpy).not.toHaveBeenCalled();
  });

  it("returns 401 for correct username but wrong password", async () => {
    const res = makeRes();
    await createSendToken(
      { body: { username: "admin", password: "wrong" } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("signs a JWT and sends userSuccessResp on valid creds", async () => {
    const res = makeRes();
    await createSendToken(
      { body: { username: "admin", password: "pa$$" } },
      res
    );
    expect(jwtSignSpy).toHaveBeenCalledWith(
      { username: "admin" },
      "test-secret",
      { expiresIn: "1h" }
    );
    expect(userSuccessSpy).toHaveBeenCalledWith(
      "Logged in successfully.",
      "Bearer signed.jwt.token"
    );
    expect(res.send).toHaveBeenCalledWith({
      ok: true,
      msg: "Logged in successfully.",
      data: "Bearer signed.jwt.token",
    });
  });
});

describe("utils/authentication > SwaggerAuth", () => {
  it("401s with WWW-Authenticate when basic-auth returns nothing", () => {
    basicAuthSpy.mockReturnValueOnce(null);
    const res = makeRes();
    const next = vi.fn();
    SwaggerAuth({}, res, next);
    expect(res.set).toHaveBeenCalledWith(
      "WWW-Authenticate",
      'Basic realm="401"'
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.send).toHaveBeenCalledWith("Authentication required.");
    expect(next).not.toHaveBeenCalled();
  });

  it("401s when basic-auth user has wrong name", () => {
    basicAuthSpy.mockReturnValueOnce({ name: "nope", pass: "pa$$" });
    const res = makeRes();
    SwaggerAuth({}, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("401s when basic-auth user has wrong password", () => {
    basicAuthSpy.mockReturnValueOnce({ name: "admin", pass: "nope" });
    const res = makeRes();
    SwaggerAuth({}, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("calls next() when basic-auth user matches config creds", () => {
    basicAuthSpy.mockReturnValueOnce({ name: "admin", pass: "pa$$" });
    const res = makeRes();
    const next = vi.fn();
    SwaggerAuth({}, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
