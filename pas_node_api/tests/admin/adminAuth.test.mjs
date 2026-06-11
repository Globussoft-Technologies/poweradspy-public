import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const jwtPath = require.resolve("jsonwebtoken");
const jwtVerify = vi.fn();
const jwtSign = vi.fn(() => "signed-token");
require.cache[jwtPath] = {
  id: jwtPath, filename: jwtPath, loaded: true,
  exports: { verify: jwtVerify, sign: jwtSign },
};

const configPath = require.resolve("../../src/config");
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true,
  exports: { admin: { sessionSecret: "secret", username: "admin", password: "pw", sessionMaxAgeMs: 1000 } },
};

const telegramPath = require.resolve("../../src/utils/telegram");
const sendTelegramAlert = vi.fn();
require.cache[telegramPath] = {
  id: telegramPath, filename: telegramPath, loaded: true,
  exports: { sendTelegramAlert },
};

const { adminAuthMiddleware, requireEditorRole, login, logout, verifyEditKey } = require(
  "../../src/admin/adminAuth"
);

function mkRes() {
  const r = { statusCode: 200, body: null, cookies: {} };
  r.status = vi.fn((c) => { r.statusCode = c; return r; });
  r.json = vi.fn((b) => { r.body = b; return r; });
  r.cookie = vi.fn((name, val, opts) => { r.cookies[name] = { val, opts }; return r; });
  r.clearCookie = vi.fn((name) => { delete r.cookies[name]; return r; });
  return r;
}

beforeEach(() => {
  jwtVerify.mockReset();
  jwtSign.mockReset().mockReturnValue("signed-token");
  sendTelegramAlert.mockReset();
  delete process.env.NODE_ENV;
});

describe("admin/adminAuth > adminAuthMiddleware", () => {
  it("401 when no token", () => {
    const res = mkRes(); const next = vi.fn();
    adminAuthMiddleware({ headers: {} }, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });
  it("token from cookie", () => {
    jwtVerify.mockReturnValue({ role: "viewer" });
    const res = mkRes(); const next = vi.fn();
    const req = { headers: { cookie: "admin_session=cookie-token" } };
    adminAuthMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.adminSession).toEqual({ role: "viewer" });
  });
  it("token from x-admin-token header (no cookie)", () => {
    jwtVerify.mockReturnValue({ role: "viewer" });
    const req = { headers: { "x-admin-token": "hdr-token" } };
    const res = mkRes(); const next = vi.fn();
    adminAuthMiddleware(req, res, next);
    expect(next).toHaveBeenCalled();
  });
  it("401 on jwt.verify throw", () => {
    jwtVerify.mockImplementation(() => { throw new Error("bad"); });
    const res = mkRes();
    adminAuthMiddleware({ headers: { cookie: "admin_session=x" } }, res, vi.fn());
    expect(res.statusCode).toBe(401);
    expect(res.body.message).toBe("Invalid or expired token");
  });
});

describe("admin/adminAuth > requireEditorRole", () => {
  it("calls next when role=editor", () => {
    const next = vi.fn();
    requireEditorRole({ adminSession: { role: "editor" } }, mkRes(), next);
    expect(next).toHaveBeenCalled();
  });
  it("403 when role is viewer", () => {
    const res = mkRes();
    requireEditorRole({ adminSession: { role: "viewer" } }, res, vi.fn());
    expect(res.statusCode).toBe(403);
  });
  it("403 when adminSession missing", () => {
    const res = mkRes();
    requireEditorRole({}, res, vi.fn());
    expect(res.statusCode).toBe(403);
  });
});

describe("admin/adminAuth > login", () => {
  it("200 with token on valid creds, NO telegram in test env", () => {
    const res = mkRes();
    login({ body: { username: "admin", password: "pw" }, headers: {} }, res);
    expect(res.body.code).toBe(200);
    expect(res.cookies.admin_session.val).toBe("signed-token");
    expect(sendTelegramAlert).not.toHaveBeenCalled();
  });
  it("sends telegram in production env, uses cf-connecting-ip", () => {
    process.env.NODE_ENV = "production";
    const res = mkRes();
    login({ body: { username: "admin", password: "pw" }, headers: { "cf-connecting-ip": "1.2.3.4" } }, res);
    expect(sendTelegramAlert).toHaveBeenCalled();
    expect(sendTelegramAlert.mock.calls[0][0]).toContain("1.2.3.4");
  });
  it("sends telegram in development env, uses req.ip fallback", () => {
    process.env.NODE_ENV = "development";
    const res = mkRes();
    login({ body: { username: "admin", password: "pw" }, headers: {}, ip: "9.9.9.9" }, res);
    expect(sendTelegramAlert.mock.calls[0][0]).toContain("9.9.9.9");
  });
  it("uses 'unknown' IP when none available", () => {
    process.env.NODE_ENV = "development";
    const res = mkRes();
    login({ body: { username: "admin", password: "pw" }, headers: {} }, res);
    expect(sendTelegramAlert.mock.calls[0][0]).toContain("unknown");
  });
  it("401 on invalid creds", () => {
    const res = mkRes();
    login({ body: { username: "x", password: "y" }, headers: {} }, res);
    expect(res.statusCode).toBe(401);
  });
});

describe("admin/adminAuth > logout", () => {
  it("clears cookie + 200", () => {
    const res = mkRes();
    logout({}, res);
    expect(res.clearCookie).toHaveBeenCalledWith("admin_session", expect.any(Object));
    expect(res.body.code).toBe(200);
  });
});

describe("admin/adminAuth > verifyEditKey", () => {
  it("401 when no token", () => {
    const res = mkRes();
    verifyEditKey({ body: { key: "x" }, headers: {} }, res);
    expect(res.statusCode).toBe(401);
  });
  it("401 when jwt.verify throws", () => {
    jwtVerify.mockImplementation(() => { throw new Error("bad"); });
    const res = mkRes();
    verifyEditKey({ body: { key: "x.y" }, headers: { cookie: "admin_session=tok" } }, res);
    expect(res.statusCode).toBe(401);
    expect(res.body.message).toBe("Invalid token");
  });
  it("400 when key missing or no dot", () => {
    jwtVerify.mockReturnValue({ username: "admin" });
    let res = mkRes();
    verifyEditKey({ body: {}, headers: { cookie: "admin_session=tok" } }, res);
    expect(res.statusCode).toBe(400);

    res = mkRes();
    verifyEditKey({ body: { key: "nodot" }, headers: { cookie: "admin_session=tok" } }, res);
    expect(res.statusCode).toBe(400);
  });
  it("403 when hash mismatch", () => {
    jwtVerify.mockReturnValue({ username: "admin" });
    const res = mkRes();
    verifyEditKey({ body: { key: "Zm9v.badhash" }, headers: { cookie: "admin_session=tok" } }, res);
    expect(res.statusCode).toBe(403);
  });
  it("happy path: hash matches, upgrades to editor + telegram in prod", async () => {
    process.env.NODE_ENV = "production";
    jwtVerify.mockReturnValue({ username: "admin" });
    // Build a valid key that hashes correctly with the mocked secret
    const crypto = await import("node:crypto");
    const payload = JSON.stringify({ hostname: "host1", username: "u1" });
    const base64 = Buffer.from(payload).toString("base64");
    const hash = crypto.createHmac("sha256", "secret").update(payload).digest("hex");
    const key = `${base64}.${hash}`;

    const res = mkRes();
    verifyEditKey({ body: { key }, headers: { cookie: "admin_session=tok", "cf-connecting-ip": "1.1.1.1" } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.code).toBe(200);
    expect(res.cookies.admin_session.val).toBe("signed-token");
    expect(sendTelegramAlert).toHaveBeenCalled();
  });
  it("happy path without telegram (not dev/prod env)", async () => {
    delete process.env.NODE_ENV;
    jwtVerify.mockReturnValue({ username: "admin" });
    const crypto = await import("node:crypto");
    const payload = JSON.stringify({ hostname: "h", username: "u" });
    const base64 = Buffer.from(payload).toString("base64");
    const hash = crypto.createHmac("sha256", "secret").update(payload).digest("hex");
    const key = `${base64}.${hash}`;
    const res = mkRes();
    verifyEditKey({ body: { key }, headers: { cookie: "admin_session=tok" }, ip: "2.2.2.2" }, res);
    expect(res.statusCode).toBe(200);
    expect(sendTelegramAlert).not.toHaveBeenCalled();
  });
  it("happy path development env uses req.ip", async () => {
    process.env.NODE_ENV = "development";
    jwtVerify.mockReturnValue({ username: "admin" });
    const crypto = await import("node:crypto");
    const payload = JSON.stringify({ hostname: "h", username: "u" });
    const base64 = Buffer.from(payload).toString("base64");
    const hash = crypto.createHmac("sha256", "secret").update(payload).digest("hex");
    const key = `${base64}.${hash}`;
    const res = mkRes();
    verifyEditKey({ body: { key }, headers: { cookie: "admin_session=tok" }, ip: "3.3.3.3" }, res);
    expect(sendTelegramAlert).toHaveBeenCalled();
    expect(sendTelegramAlert.mock.calls[0][0]).toContain("3.3.3.3");
  });
  it("happy path with no IP at all → 'unknown'", async () => {
    process.env.NODE_ENV = "development";
    jwtVerify.mockReturnValue({ username: "admin" });
    const crypto = await import("node:crypto");
    const payload = JSON.stringify({ hostname: "h", username: "u" });
    const base64 = Buffer.from(payload).toString("base64");
    const hash = crypto.createHmac("sha256", "secret").update(payload).digest("hex");
    const key = `${base64}.${hash}`;
    const res = mkRes();
    verifyEditKey({ body: { key }, headers: { cookie: "admin_session=tok" } }, res);
    expect(sendTelegramAlert.mock.calls[0][0]).toContain("unknown");
  });
  it("400 when JSON.parse fails in payload", () => {
    jwtVerify.mockReturnValue({ username: "admin" });
    const crypto = require("node:crypto");
    const payload = "not-json";
    const base64 = Buffer.from(payload).toString("base64");
    const hash = crypto.createHmac("sha256", "secret").update(payload).digest("hex");
    const key = `${base64}.${hash}`;
    const res = mkRes();
    verifyEditKey({ body: { key }, headers: { cookie: "admin_session=tok" } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Invalid edit key");
  });
  it("token from x-admin-token header path", () => {
    jwtVerify.mockReturnValue({ username: "admin" });
    const res = mkRes();
    verifyEditKey({ body: { key: "missingdot" }, headers: { "x-admin-token": "hdr" } }, res);
    expect(res.statusCode).toBe(400);
  });
});
