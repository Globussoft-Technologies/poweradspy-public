import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import { EventEmitter } from "node:events";
const require = createRequire(import.meta.url);

// ── Mock https (built-in) — monkey-patch the live module ──────────────
import https from "node:https";
let lastHttpsCall;
const httpsRequest = vi.fn();
https.request = httpsRequest;

// ── Mock logger ──────────────
const loggerPath = require.resolve("../../src/logger");
const childLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { createChild: vi.fn(() => childLog) },
};

// ── Mock config ──────────────
const configPath = require.resolve("../../src/config");
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true,
  exports: { firebase: { projectId: "test-proj", credentialsPath: "fake-creds.json" } },
};

// ── Spy crypto.createSign at runtime ──────────────
import crypto from "node:crypto";
const signObj = { update: vi.fn().mockReturnThis(), sign: vi.fn(() => "sig+/=") };
const createSignSpy = vi.spyOn(crypto, "createSign").mockReturnValue(signObj);

import fs from "node:fs";
const realReadFileSync = fs.readFileSync;
const existsSpy = vi.spyOn(fs, "existsSync");
// Only stub readFileSync for the credentials path; pass through everything else
// (otherwise Node's own module loader gets confused when reading source files).
const credentialsJson = JSON.stringify({
  private_key_id: "kid-1",
  client_email: "svc@p.iam.gserviceaccount.com",
  private_key: "-----BEGIN KEY-----",
});
let readFileMockReturn = credentialsJson;
const readFileSpy = vi.spyOn(fs, "readFileSync").mockImplementation((p, enc) => {
  if (typeof p === "string" && p.includes("fake-creds")) return readFileMockReturn;
  return realReadFileSync(p, enc);
});

const sutPath = require.resolve("../../src/services/FirebaseService");
function freshSut() {
  delete require.cache[sutPath];
  return require(sutPath);
}

// Helper: fake https.request that drives res events and captures the request
function setupHttps(resJson, statusCode = 200, resError = null) {
  httpsRequest.mockReset();
  httpsRequest.mockImplementation((opts, cb) => {
    lastHttpsCall = opts;
    const req = new EventEmitter();
    req.write = vi.fn();
    req.end = vi.fn();
    if (resError === "req-err") {
      // Fire the error WITHOUT calling the response callback
      setImmediate(() => req.emit("error", new Error("req-fail")));
      return req;
    }
    const res = new EventEmitter();
    res.statusCode = statusCode;
    setImmediate(() => {
      cb(res);
      if (resError === "json-err") {
        res.emit("data", "not-json{");
        res.emit("end");
      } else {
        res.emit("data", JSON.stringify(resJson));
        res.emit("end");
      }
    });
    return req;
  });
}

beforeEach(() => {
  httpsRequest.mockReset();
  childLog.info.mockClear(); childLog.warn.mockClear(); childLog.error.mockClear();
  signObj.update.mockClear().mockReturnThis();
  signObj.sign.mockClear().mockReturnValue("sig+/=");
  // Don't reset readFileSpy — it has a path-aware passthrough we need to preserve.
  existsSpy.mockReset().mockReturnValue(true);
  readFileMockReturn = credentialsJson;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("FirebaseService > constructor", () => {
  it("reads config.firebase.projectId + credentialsPath", () => {
    const svc = freshSut();
    expect(svc.projectId).toBe("test-proj");
    expect(svc.credentialPath).toContain("fake-creds.json");
    expect(svc.accessToken).toBeNull();
  });
  it("falls back to defaults when config.firebase missing", () => {
    const origExports = require.cache[configPath].exports;
    require.cache[configPath].exports = {};
    const svc = freshSut();
    expect(svc.projectId).toBe("poweradspy-firebase-prod");
    expect(svc.credentialPath).toContain("firebase-credentials.json");
    require.cache[configPath].exports = origExports;
  });
});

describe("FirebaseService > _loadCredentials", () => {
  it("throws + logs when file missing", () => {
    existsSpy.mockReturnValue(false);
    const svc = freshSut();
    expect(() => svc._loadCredentials()).toThrow(/not found/);
    expect(childLog.error).toHaveBeenCalled();
  });
  it("returns parsed credentials", () => {
    const svc = freshSut();
    const creds = svc._loadCredentials();
    expect(creds.client_email).toBe("svc@p.iam.gserviceaccount.com");
  });
  it("re-throws on JSON parse failure", () => {
    readFileMockReturn = "not-json{";
    const svc = freshSut();
    expect(() => svc._loadCredentials()).toThrow();
  });
});

describe("FirebaseService > _getAccessToken", () => {
  it("returns cached token when not expired", async () => {
    const svc = freshSut();
    svc.accessToken = "cached";
    svc.tokenExpiry = Date.now() + 600000;
    expect(await svc._getAccessToken()).toBe("cached");
  });

  it("refetches when cached token is near expiry", async () => {
    setupHttps({ access_token: "new-token", expires_in: 3600 });
    const svc = freshSut();
    svc.accessToken = "old";
    svc.tokenExpiry = Date.now() + 10000; // < 60s buffer
    const t = await svc._getAccessToken();
    expect(t).toBe("new-token");
  });

  it("fetches fresh token via JWT + caches it", async () => {
    setupHttps({ access_token: "fresh", expires_in: 3600 });
    const svc = freshSut();
    const t = await svc._getAccessToken();
    expect(t).toBe("fresh");
    expect(svc.accessToken).toBe("fresh");
    expect(lastHttpsCall.hostname).toBe("oauth2.googleapis.com");
  });

  it("rejects when oauth response contains error", async () => {
    setupHttps({ error: "invalid_grant", error_description: "JWT invalid" });
    const svc = freshSut();
    await expect(svc._getAccessToken()).rejects.toThrow("JWT invalid");
  });

  it("rejects on JSON parse failure", async () => {
    setupHttps(null, 200, "json-err");
    const svc = freshSut();
    await expect(svc._getAccessToken()).rejects.toBeDefined();
  });

  it("rejects on https req error", async () => {
    setupHttps({ access_token: "x", expires_in: 3600 }, 200, "req-err");
    const svc = freshSut();
    await expect(svc._getAccessToken()).rejects.toThrow("req-fail");
  });

  it("logs + rethrows on outer failure (credentials missing)", async () => {
    existsSpy.mockReturnValue(false);
    const svc = freshSut();
    await expect(svc._getAccessToken()).rejects.toThrow();
    expect(childLog.error).toHaveBeenCalledWith("Failed to get Firebase access token", expect.any(Object));
  });
});

describe("FirebaseService > sendNotification", () => {
  it("throws when fcmToken missing", async () => {
    const svc = freshSut();
    await expect(svc.sendNotification("")).rejects.toThrow("FCM token is required");
    expect(childLog.error).toHaveBeenCalled();
  });

  it("happy path → resolves with FCM result", async () => {
    let callCount = 0;
    httpsRequest.mockImplementation((opts, cb) => {
      callCount++;
      const res = new EventEmitter();
      res.statusCode = 200;
      setImmediate(() => {
        cb(res);
        if (callCount === 1) {
          res.emit("data", JSON.stringify({ access_token: "tok", expires_in: 3600 }));
        } else {
          res.emit("data", JSON.stringify({ name: "msg-1" }));
        }
        res.emit("end");
      });
      const req = new EventEmitter();
      req.write = vi.fn(); req.end = vi.fn();
      return req;
    });
    const svc = freshSut();
    const out = await svc.sendNotification("fcm-tok", "Hi", "Body", "img.png", "/url");
    expect(out).toEqual({ name: "msg-1" });
    expect(childLog.info).toHaveBeenCalledWith("Push notification sent successfully");
  });

  it("FCM 4xx → error logged + reject", async () => {
    let callCount = 0;
    httpsRequest.mockImplementation((opts, cb) => {
      callCount++;
      const res = new EventEmitter();
      res.statusCode = callCount === 1 ? 200 : 400;
      setImmediate(() => {
        cb(res);
        if (callCount === 1) res.emit("data", JSON.stringify({ access_token: "tok", expires_in: 3600 }));
        else res.emit("data", JSON.stringify({ error: { message: "INVALID_ARGUMENT" } }));
        res.emit("end");
      });
      const req = new EventEmitter();
      req.write = vi.fn(); req.end = vi.fn();
      return req;
    });
    const svc = freshSut();
    await expect(svc.sendNotification("fcm-tok", "Hi", "Body")).rejects.toThrow("INVALID_ARGUMENT");
    expect(childLog.error).toHaveBeenCalledWith("FCM push notification failed", expect.any(Object));
  });

  it("FCM 4xx with no error.message → defaults to 'FCM error'", async () => {
    let callCount = 0;
    httpsRequest.mockImplementation((opts, cb) => {
      callCount++;
      const res = new EventEmitter();
      res.statusCode = callCount === 1 ? 200 : 500;
      setImmediate(() => {
        cb(res);
        if (callCount === 1) res.emit("data", JSON.stringify({ access_token: "tok", expires_in: 3600 }));
        else res.emit("data", JSON.stringify({ }));
        res.emit("end");
      });
      const req = new EventEmitter();
      req.write = vi.fn(); req.end = vi.fn();
      return req;
    });
    const svc = freshSut();
    await expect(svc.sendNotification("fcm-tok", "Hi", "Body")).rejects.toThrow("FCM error");
  });

  it("FCM response JSON parse error → reject", async () => {
    let callCount = 0;
    httpsRequest.mockImplementation((opts, cb) => {
      callCount++;
      const res = new EventEmitter();
      res.statusCode = 200;
      setImmediate(() => {
        cb(res);
        if (callCount === 1) {
          res.emit("data", JSON.stringify({ access_token: "tok", expires_in: 3600 }));
        } else {
          res.emit("data", "not-json{");
        }
        res.emit("end");
      });
      const req = new EventEmitter();
      req.write = vi.fn(); req.end = vi.fn();
      return req;
    });
    const svc = freshSut();
    await expect(svc.sendNotification("fcm-tok", "Hi", "Body")).rejects.toBeDefined();
  });

  it("FCM https req error → reject", async () => {
    let callCount = 0;
    httpsRequest.mockImplementation((opts, cb) => {
      callCount++;
      if (callCount === 1) {
        const res = new EventEmitter();
        res.statusCode = 200;
        setImmediate(() => {
          cb(res);
          res.emit("data", JSON.stringify({ access_token: "tok", expires_in: 3600 }));
          res.emit("end");
        });
      }
      const req = new EventEmitter();
      req.write = vi.fn(); req.end = vi.fn();
      if (callCount === 2) setImmediate(() => req.emit("error", new Error("fcm-req-err")));
      return req;
    });
    const svc = freshSut();
    await expect(svc.sendNotification("fcm-tok", "Hi", "Body")).rejects.toThrow("fcm-req-err");
  });

  it("default image and actionUrl params accepted", async () => {
    let callCount = 0;
    httpsRequest.mockImplementation((opts, cb) => {
      callCount++;
      const res = new EventEmitter();
      res.statusCode = 200;
      setImmediate(() => {
        cb(res);
        if (callCount === 1) res.emit("data", JSON.stringify({ access_token: "tok", expires_in: 3600 }));
        else res.emit("data", JSON.stringify({ name: "ok" }));
        res.emit("end");
      });
      const req = new EventEmitter();
      req.write = vi.fn(); req.end = vi.fn();
      return req;
    });
    const svc = freshSut();
    await svc.sendNotification("fcm-tok", "Hi", "Body");
    expect(httpsRequest).toHaveBeenCalledTimes(2);
  });
});
