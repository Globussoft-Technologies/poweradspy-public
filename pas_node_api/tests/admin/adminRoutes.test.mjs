import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── Fake express Router with handler-capture ─────────────────────────────────
const handlers = { get: {}, post: {}, put: {}, patch: {}, delete: {}, use: [] };
const FakeRouter = () => ({
  get: vi.fn((p, ...rest) => { handlers.get[p] = rest; }),
  post: vi.fn((p, ...rest) => { handlers.post[p] = rest; }),
  put: vi.fn((p, ...rest) => { handlers.put[p] = rest; }),
  patch: vi.fn((p, ...rest) => { handlers.patch[p] = rest; }),
  delete: vi.fn((p, ...rest) => { handlers.delete[p] = rest; }),
  use: vi.fn((p, ...rest) => { handlers.use.push({ p, rest }); }),
});
const fakeJson = vi.fn(() => (req, res, next) => next());
const fakeStatic = vi.fn(() => (req, res, next) => next());
const expressFake = Object.assign(FakeRouter, { Router: FakeRouter, json: fakeJson, static: fakeStatic });

const expressPath = require.resolve("express");
require.cache[expressPath] = {
  id: expressPath, filename: expressPath, loaded: true, exports: expressFake,
};

// ── Stub fs ──────────────────────────────────────────────────────────────────
import fs from "node:fs";
const existsSpy = vi.spyOn(fs, "existsSync");
const readdirSpy = vi.spyOn(fs, "readdirSync");
const statSpy = vi.spyOn(fs, "statSync");
const readFileSpy = vi.spyOn(fs, "readFileSync");

// ── Stub config ──────────────────────────────────────────────────────────────
const configFns = {
  getRawFileConfig: vi.fn(() => ({})),
  writeConfigFile: vi.fn(() => true),
};
const configObj = {
  server: { domain: "" },
  log: { dir: "logs" },
  getRawFileConfig: configFns.getRawFileConfig,
  writeConfigFile: configFns.writeConfigFile,
};
const configPath = require.resolve("../../src/config");
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true, exports: configObj,
};

// ── Stub metrics ─────────────────────────────────────────────────────────────
const metricsObj = { getMetrics: vi.fn(), getIpStats: vi.fn() };
const metricsPath = require.resolve("../../src/metrics/MetricsCollector");
require.cache[metricsPath] = {
  id: metricsPath, filename: metricsPath, loaded: true, exports: metricsObj,
};

// ── Stub database manager ────────────────────────────────────────────────────
const dbMgr = { getHealth: vi.fn(() => ({ ok: true })), getPoolStats: vi.fn(() => ({})) };
const dbPath = require.resolve("../../src/database/DatabaseManager");
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true, exports: dbMgr,
};

// ── Stub adminAuth ───────────────────────────────────────────────────────────
const adminAuth = {
  adminAuthMiddleware: vi.fn((req, res, next) => next()),
  requireEditorRole: vi.fn((req, res, next) => next()),
  login: vi.fn(),
  logout: vi.fn(),
  verifyEditKey: vi.fn(),
};
const adminAuthPath = require.resolve("../../src/admin/adminAuth");
require.cache[adminAuthPath] = {
  id: adminAuthPath, filename: adminAuthPath, loaded: true, exports: adminAuth,
};

// ── Stub rateLimiter ─────────────────────────────────────────────────────────
const rateLim = { blockIp: vi.fn(), unblockIp: vi.fn(), getBlockedIps: vi.fn(() => []) };
const rlPath = require.resolve("../../src/middleware/rateLimiter");
require.cache[rlPath] = {
  id: rlPath, filename: rlPath, loaded: true, exports: rateLim,
};

// ── Stub telegram ────────────────────────────────────────────────────────────
const tg = { sendTelegramAlert: vi.fn() };
const tgPath = require.resolve("../../src/utils/telegram");
require.cache[tgPath] = {
  id: tgPath, filename: tgPath, loaded: true, exports: tg,
};

// ── Stub sdui adminService ───────────────────────────────────────────────────
const sduiAdmin = {
  getAllDocs: vi.fn(), getDoc: vi.fn(), createDoc: vi.fn(), updateDoc: vi.fn(),
  patchField: vi.fn(), deleteDoc: vi.fn(),
  addFilter: vi.fn(), updateFilter: vi.fn(), deleteFilter: vi.fn(),
  addOption: vi.fn(), updateOption: vi.fn(), deleteOption: vi.fn(),
  saveSnapshot: vi.fn(), getSnapshots: vi.fn(), restoreSnapshot: vi.fn(),
};
const sduiAdminPath = require.resolve("../../src/services/sdui/services/adminService");
require.cache[sduiAdminPath] = {
  id: sduiAdminPath, filename: sduiAdminPath, loaded: true, exports: sduiAdmin,
};

// ── Stub planAccessService ───────────────────────────────────────────────────
const pas = { invalidateConfigCache: vi.fn() };
const pasPath = require.resolve("../../src/services/planAccess/planAccessService");
require.cache[pasPath] = {
  id: pasPath, filename: pasPath, loaded: true, exports: pas,
};

// ── Stub sdui db (getDB) ─────────────────────────────────────────────────────
const fakeCollections = new Map();
const dbCollection = (name) => {
  if (!fakeCollections.has(name)) {
    const arr = [];
    fakeCollections.set(name, {
      _arr: arr,
      find: vi.fn((q = {}, opts = {}) => ({
        toArray: vi.fn(async () => arr.slice()),
      })),
      findOne: vi.fn(async (q) => null),
      insertOne: vi.fn(async (d) => { arr.push(d); return { insertedId: d._id }; }),
      updateOne: vi.fn(async () => ({ modifiedCount: 1 })),
      replaceOne: vi.fn(async () => ({ matchedCount: 1 })),
      countDocuments: vi.fn(async () => arr.length),
    });
  }
  return fakeCollections.get(name);
};
const sduiDb = { getDB: vi.fn(async () => ({ collection: dbCollection })) };
const sduiDbPath = require.resolve("../../src/services/sdui/db");
require.cache[sduiDbPath] = {
  id: sduiDbPath, filename: sduiDbPath, loaded: true, exports: sduiDb,
};

// ── Stub planAccessSeed (loaded via require inside handler) ──────────────────
const seedExports = {
  planBillingMetadata: { _id: "plan_billing_metadata", plans: {} },
  DEFAULT_PLAN_GROUPS: { _id: "plan_groups", groups: { Free: { color: "#fff", plans: [1] } } },
};
const seedPath = require.resolve("../../src/services/planAccess/planAccessSeed");
require.cache[seedPath] = {
  id: seedPath, filename: seedPath, loaded: true, exports: seedExports,
};

// ── Stub logger ──────────────────────────────────────────────────────────────
const childLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const loggerPath = require.resolve("../../src/logger");
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { createChild: vi.fn(() => childLog) },
};

// ── Load SUT ─────────────────────────────────────────────────────────────────
const sutPath = require.resolve("../../src/admin/adminRoutes");
function freshSut() {
  for (const m of ["get", "post", "put", "patch", "delete"]) {
    for (const k of Object.keys(handlers[m])) delete handlers[m][k];
  }
  handlers.use.length = 0;
  fakeCollections.clear();
  delete require.cache[sutPath];
  return require(sutPath);
}

function mkRes() {
  const r = { statusCode: 200, body: null, headers: {}, sent: null, downloaded: null };
  r.status = vi.fn((c) => { r.statusCode = c; return r; });
  r.json = vi.fn((b) => { r.body = b; return r; });
  r.send = vi.fn((b) => { r.sent = b; return r; });
  r.redirect = vi.fn();
  r.setHeader = vi.fn((k, v) => { r.headers[k] = v; });
  r.download = vi.fn((p) => { r.downloaded = p; });
  return r;
}

function lastHandler(method, path) {
  const stack = handlers[method][path];
  return stack ? stack[stack.length - 1] : null;
}

beforeEach(() => {
  existsSpy.mockReset().mockReturnValue(false);
  readdirSpy.mockReset().mockReturnValue([]);
  statSpy.mockReset();
  readFileSpy.mockReset();
  configFns.getRawFileConfig.mockReset().mockReturnValue({});
  configFns.writeConfigFile.mockReset().mockReturnValue(true);
  metricsObj.getMetrics.mockReset();
  metricsObj.getIpStats.mockReset();
  dbMgr.getHealth.mockReset().mockReturnValue({ ok: true });
  dbMgr.getPoolStats.mockReset().mockReturnValue({});
  rateLim.blockIp.mockReset();
  rateLim.unblockIp.mockReset();
  rateLim.getBlockedIps.mockReset().mockReturnValue([]);
  tg.sendTelegramAlert.mockReset();
  for (const fn of Object.values(sduiAdmin)) fn.mockReset();
  pas.invalidateConfigCache.mockReset();
  sduiDb.getDB.mockReset().mockImplementation(async () => ({ collection: dbCollection }));
  childLog.info.mockReset();
  childLog.warn.mockReset();
  childLog.error.mockReset();
  freshSut();
});

describe("adminRoutes > /ui static middleware", () => {
  it("403 when dest=document for JS file", () => {
    const mw = handlers.use.find(u => u.p === "/ui").rest[0];
    const res = mkRes();
    const next = vi.fn();
    mw({ path: "/foo.js", headers: { "sec-fetch-dest": "document" } }, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
  it("403 when no dest + no referer for CSS file", () => {
    const mw = handlers.use.find(u => u.p === "/ui").rest[0];
    const res = mkRes();
    const next = vi.fn();
    mw({ path: "/foo.css", headers: {} }, res, next);
    expect(res.statusCode).toBe(403);
  });
  it("passes through for non-asset path", () => {
    const mw = handlers.use.find(u => u.p === "/ui").rest[0];
    const next = vi.fn();
    mw({ path: "/index.html", headers: {} }, mkRes(), next);
    expect(next).toHaveBeenCalled();
  });
  it("passes through for JS with referer (sub-resource)", () => {
    const mw = handlers.use.find(u => u.p === "/ui").rest[0];
    const next = vi.fn();
    mw({ path: "/x.js", headers: { referer: "http://x" } }, mkRes(), next);
    expect(next).toHaveBeenCalled();
  });
});

describe("adminRoutes > GET / redirect", () => {
  it("redirects to /admin/ui/", () => {
    const h = lastHandler("get", "/");
    const res = mkRes();
    h({}, res);
    expect(res.redirect).toHaveBeenCalledWith("/admin/ui/");
  });
});

describe("adminRoutes > GET /client-config.js", () => {
  it("returns JS with empty domain", () => {
    const h = lastHandler("get", "/client-config.js");
    const res = mkRes();
    h({}, res);
    expect(res.headers["Content-Type"]).toBe("application/javascript");
    expect(res.send).toHaveBeenCalled();
    expect(res.sent).toContain("/admin/api");
  });
  it("uses configured domain", () => {
    configObj.server.domain = "https://example.com";
    freshSut();
    const h = lastHandler("get", "/client-config.js");
    const res = mkRes();
    h({}, res);
    expect(res.sent).toContain("https://example.com");
    configObj.server.domain = "";
  });
});

describe("adminRoutes > GET /api/session", () => {
  it("returns the session", () => {
    const h = lastHandler("get", "/api/session");
    const res = mkRes();
    h({ adminSession: { user: "admin" } }, res);
    expect(res.body.data.user).toBe("admin");
  });
});

describe("adminRoutes > GET /api/metrics", () => {
  it("returns metrics data", async () => {
    metricsObj.getMetrics.mockResolvedValue({ requests: 5 });
    const h = lastHandler("get", "/api/metrics");
    const res = mkRes();
    await h({ query: { startDate: "a", endDate: "b" } }, res);
    expect(res.body.success).toBe(true);
  });
});

describe("adminRoutes > GET /api/metrics/ips", () => {
  it("returns ip stats", async () => {
    metricsObj.getIpStats.mockResolvedValue([{ ip: "1.1.1.1" }]);
    const h = lastHandler("get", "/api/metrics/ips");
    const res = mkRes();
    await h({ query: {} }, res);
    expect(res.body.success).toBe(true);
  });
});

describe("adminRoutes > GET /api/db-status", () => {
  it("returns health + pool stats", () => {
    const h = lastHandler("get", "/api/db-status");
    const res = mkRes();
    h({}, res);
    expect(res.body.data.health.ok).toBe(true);
  });
});

describe("adminRoutes > GET /api/logs (list)", () => {
  it("empty array when dir doesn't exist", () => {
    existsSpy.mockReturnValue(false);
    const h = lastHandler("get", "/api/logs");
    const res = mkRes();
    h({}, res);
    expect(res.body.data).toEqual([]);
  });
  it("lists log files with size/mtime", () => {
    existsSpy.mockReturnValue(true);
    readdirSpy.mockReturnValue(["a.log", "b.log.gz", "x.txt"]);
    statSpy.mockImplementation(() => ({ size: 1000, mtime: new Date() }));
    const h = lastHandler("get", "/api/logs");
    const res = mkRes();
    h({}, res);
    expect(res.body.data.length).toBe(2);
    expect(res.body.data[0].sizeHuman).toMatch(/KB|B/);
  });
  it("uses default 'logs' dir when config.log.dir undefined", () => {
    configObj.log = {};
    existsSpy.mockReturnValue(false);
    freshSut();
    const h = lastHandler("get", "/api/logs");
    const res = mkRes();
    h({}, res);
    expect(res.body.data).toEqual([]);
    configObj.log = { dir: "logs" };
  });
  it("500 on fs failure", () => {
    existsSpy.mockImplementation(() => { throw new Error("fs-fail"); });
    const h = lastHandler("get", "/api/logs");
    const res = mkRes();
    h({}, res);
    expect(res.statusCode).toBe(500);
  });
});

describe("adminRoutes > GET /api/logs/:filename (read)", () => {
  it("403 when path escapes log dir", () => {
    const h = lastHandler("get", "/api/logs/:filename");
    const res = mkRes();
    h({ params: { filename: "../../etc/passwd" }, query: {} }, res);
    expect(res.statusCode).toBe(403);
  });
  it("404 when not found", () => {
    existsSpy.mockReturnValue(false);
    const h = lastHandler("get", "/api/logs/:filename");
    const res = mkRes();
    h({ params: { filename: "a.log" }, query: {} }, res);
    expect(res.statusCode).toBe(404);
  });
  it("200 'File is empty' when 0 size", () => {
    existsSpy.mockReturnValue(true);
    statSpy.mockReturnValue({ size: 0 });
    const h = lastHandler("get", "/api/logs/:filename");
    const res = mkRes();
    h({ params: { filename: "a.log" }, query: {} }, res);
    expect(res.body.data.content).toBe("File is empty.");
  });
  it("200 reads last N lines with default 200", () => {
    existsSpy.mockReturnValue(true);
    statSpy.mockReturnValue({ size: 1000 });
    readFileSpy.mockReturnValue("line1\nline2\nline3");
    const h = lastHandler("get", "/api/logs/:filename");
    const res = mkRes();
    h({ params: { filename: "a.log" }, query: {} }, res);
    expect(res.body.data.totalLines).toBe(3);
  });
  it("200 honors ?lines query (capped at 1000)", () => {
    existsSpy.mockReturnValue(true);
    statSpy.mockReturnValue({ size: 1000 });
    readFileSpy.mockReturnValue("a\nb\nc");
    const h = lastHandler("get", "/api/logs/:filename");
    const res = mkRes();
    h({ params: { filename: "a.log" }, query: { lines: "2000" } }, res);
    expect(res.body.data.returnedLines).toBe(3);
  });
  it("uses default 'logs' dir when config.log.dir undefined", () => {
    configObj.log = {};
    existsSpy.mockReturnValue(false);
    freshSut();
    const h = lastHandler("get", "/api/logs/:filename");
    const res = mkRes();
    h({ params: { filename: "a.log" }, query: {} }, res);
    expect(res.statusCode).toBe(404);
    configObj.log = { dir: "logs" };
  });
  it("500 on thrown error", () => {
    existsSpy.mockImplementation(() => { throw new Error("boom"); });
    const h = lastHandler("get", "/api/logs/:filename");
    const res = mkRes();
    h({ params: { filename: "a.log" }, query: {} }, res);
    expect(res.statusCode).toBe(500);
  });
});

describe("adminRoutes > GET /api/logs/:filename/download", () => {
  it("403 when path escapes log dir", () => {
    const h = lastHandler("get", "/api/logs/:filename/download");
    const res = mkRes();
    h({ params: { filename: "../../etc/passwd" } }, res);
    expect(res.statusCode).toBe(403);
  });
  it("404 when not found", () => {
    existsSpy.mockReturnValue(false);
    const h = lastHandler("get", "/api/logs/:filename/download");
    const res = mkRes();
    h({ params: { filename: "a.log" } }, res);
    expect(res.statusCode).toBe(404);
  });
  it("200 download streams file", () => {
    existsSpy.mockReturnValue(true);
    const h = lastHandler("get", "/api/logs/:filename/download");
    const res = mkRes();
    h({ params: { filename: "a.log" } }, res);
    expect(res.download).toHaveBeenCalled();
  });
  it("uses default 'logs' dir when config.log.dir undefined", () => {
    configObj.log = {};
    existsSpy.mockReturnValue(false);
    freshSut();
    const h = lastHandler("get", "/api/logs/:filename/download");
    const res = mkRes();
    h({ params: { filename: "a.log" } }, res);
    expect(res.statusCode).toBe(404);
    configObj.log = { dir: "logs" };
  });
  it("500 on thrown error", () => {
    existsSpy.mockImplementation(() => { throw new Error("boom"); });
    const h = lastHandler("get", "/api/logs/:filename/download");
    const res = mkRes();
    h({ params: { filename: "a.log" } }, res);
    expect(res.statusCode).toBe(500);
  });
});

describe("adminRoutes > GET/PUT /api/config", () => {
  it("GET returns raw config", () => {
    configFns.getRawFileConfig.mockReturnValue({ a: 1 });
    const h = lastHandler("get", "/api/config");
    const res = mkRes();
    h({}, res);
    expect(res.body.data).toEqual({ a: 1 });
  });
  it("PUT 400 when body invalid", () => {
    const h = lastHandler("put", "/api/config");
    const res = mkRes();
    h({ body: null }, res);
    expect(res.statusCode).toBe(400);
  });
  it("PUT 200 when write succeeds + audit alert", () => {
    configFns.getRawFileConfig.mockReturnValue({ a: 1 });
    configFns.writeConfigFile.mockReturnValue(true);
    const h = lastHandler("put", "/api/config");
    const res = mkRes();
    h({
      body: { a: 2, _internal: "x" },
      adminSession: { systemAuth: { hostname: "h", platform: "p", arch: "a", username: "u" } },
      ip: "127.0.0.1",
    }, res);
    expect(res.body.code).toBe(200);
    expect(tg.sendTelegramAlert).toHaveBeenCalled();
  });
  it("PUT skips _-prefixed keys from change summary", () => {
    configFns.getRawFileConfig.mockReturnValue({});
    configFns.writeConfigFile.mockReturnValue(true);
    const h = lastHandler("put", "/api/config");
    const res = mkRes();
    h({ body: { _meta: "x" }, adminSession: {} }, res);
    expect(tg.sendTelegramAlert).not.toHaveBeenCalled();
  });
  it("PUT no audit when no systemAuth", () => {
    configFns.getRawFileConfig.mockReturnValue({});
    configFns.writeConfigFile.mockReturnValue(true);
    const h = lastHandler("put", "/api/config");
    const res = mkRes();
    h({ body: { a: 2 }, adminSession: {}, connection: { remoteAddress: "1.1.1.1" } }, res);
    expect(tg.sendTelegramAlert).toHaveBeenCalled();
  });
  it("PUT no ip → 'unknown' falls through audit", () => {
    configFns.getRawFileConfig.mockReturnValue({});
    configFns.writeConfigFile.mockReturnValue(true);
    const h = lastHandler("put", "/api/config");
    const res = mkRes();
    h({ body: { a: 2 }, adminSession: { systemAuth: { hostname: "h", platform: "p", arch: "a", username: "u" } } }, res);
    expect(tg.sendTelegramAlert).toHaveBeenCalled();
  });
  it("PUT 500 when write fails", () => {
    configFns.writeConfigFile.mockReturnValue(false);
    const h = lastHandler("put", "/api/config");
    const res = mkRes();
    h({ body: { a: 1 }, adminSession: {} }, res);
    expect(res.statusCode).toBe(500);
  });
  it("PUT 500 on thrown error", () => {
    configFns.getRawFileConfig.mockImplementation(() => { throw new Error("err"); });
    const h = lastHandler("put", "/api/config");
    const res = mkRes();
    h({ body: { a: 1 }, adminSession: {} }, res);
    expect(res.statusCode).toBe(500);
  });
});

describe("adminRoutes > /api/config/backups + restore", () => {
  it("GET backups empty when dir missing", () => {
    existsSpy.mockReturnValue(false);
    const h = lastHandler("get", "/api/config/backups");
    const res = mkRes();
    h({}, res);
    expect(res.body.data).toEqual([]);
  });
  it("GET backups lists files", () => {
    existsSpy.mockReturnValue(true);
    readdirSpy.mockReturnValue(["config_1.json", "config_2.json", "other.txt"]);
    statSpy.mockImplementation(() => ({ size: 100, mtime: { getTime: () => Date.now() } }));
    const h = lastHandler("get", "/api/config/backups");
    const res = mkRes();
    h({}, res);
    expect(res.body.data.length).toBe(2);
  });
  it("GET backups 500 on fs failure", () => {
    existsSpy.mockImplementation(() => { throw new Error("boom"); });
    const h = lastHandler("get", "/api/config/backups");
    const res = mkRes();
    h({}, res);
    expect(res.statusCode).toBe(500);
  });
  it("POST restore 400 invalid filename", () => {
    const h = lastHandler("post", "/api/config/restore");
    const res = mkRes();
    h({ body: { filename: "../../etc/passwd" } }, res);
    expect(res.statusCode).toBe(400);
  });
  it("POST restore 400 when filename missing", () => {
    const h = lastHandler("post", "/api/config/restore");
    const res = mkRes();
    h({ body: {} }, res);
    expect(res.statusCode).toBe(400);
  });
  it("POST restore 404 when file missing", () => {
    existsSpy.mockReturnValue(false);
    const h = lastHandler("post", "/api/config/restore");
    const res = mkRes();
    h({ body: { filename: "config_1.json" } }, res);
    expect(res.statusCode).toBe(404);
  });
  it("POST restore 200 + audit", () => {
    existsSpy.mockReturnValue(true);
    readFileSpy.mockReturnValue('{"foo":"bar"}');
    configFns.writeConfigFile.mockReturnValue(true);
    const h = lastHandler("post", "/api/config/restore");
    const res = mkRes();
    h({
      body: { filename: "config_1.json" },
      adminSession: { systemAuth: { hostname: "h", platform: "p", arch: "a", username: "u" } },
      ip: "1.1.1.1",
    }, res);
    expect(res.body.code).toBe(200);
    expect(tg.sendTelegramAlert).toHaveBeenCalled();
  });
  it("POST restore 200 without systemAuth", () => {
    existsSpy.mockReturnValue(true);
    readFileSpy.mockReturnValue('{}');
    configFns.writeConfigFile.mockReturnValue(true);
    const h = lastHandler("post", "/api/config/restore");
    const res = mkRes();
    h({ body: { filename: "config_1.json" }, adminSession: {}, connection: { remoteAddress: "1" } }, res);
    expect(res.body.code).toBe(200);
  });
  it("POST restore 500 when write fails", () => {
    existsSpy.mockReturnValue(true);
    readFileSpy.mockReturnValue('{}');
    configFns.writeConfigFile.mockReturnValue(false);
    const h = lastHandler("post", "/api/config/restore");
    const res = mkRes();
    h({ body: { filename: "config_1.json" }, adminSession: {} }, res);
    expect(res.statusCode).toBe(500);
  });
  it("POST restore 500 on JSON parse error", () => {
    existsSpy.mockReturnValue(true);
    readFileSpy.mockReturnValue('not-json');
    const h = lastHandler("post", "/api/config/restore");
    const res = mkRes();
    h({ body: { filename: "config_1.json" }, adminSession: {} }, res);
    expect(res.statusCode).toBe(500);
  });
});

describe("adminRoutes > IP blocklist", () => {
  it("GET returns blocked IPs", () => {
    rateLim.getBlockedIps.mockReturnValue(["1.1.1.1"]);
    const h = lastHandler("get", "/api/blocked-ips");
    const res = mkRes();
    h({}, res);
    expect(res.body.data).toEqual(["1.1.1.1"]);
  });
  it("POST 400 when ip missing", () => {
    const h = lastHandler("post", "/api/blocked-ips");
    const res = mkRes();
    h({ body: {} }, res);
    expect(res.statusCode).toBe(400);
  });
  it("POST 200 blocks ip", () => {
    const h = lastHandler("post", "/api/blocked-ips");
    const res = mkRes();
    h({ body: { ip: "1.1.1.1" } }, res);
    expect(rateLim.blockIp).toHaveBeenCalledWith("1.1.1.1");
  });
  it("DELETE unblocks ip", () => {
    const h = lastHandler("delete", "/api/blocked-ips/:ip");
    const res = mkRes();
    h({ params: { ip: "1.1.1.1" } }, res);
    expect(rateLim.unblockIp).toHaveBeenCalledWith("1.1.1.1");
  });
});

describe("adminRoutes > SDUI docs CRUD", () => {
  it("GET list 200", async () => {
    sduiAdmin.getAllDocs.mockResolvedValue([{ _id: "a" }]);
    const h = lastHandler("get", "/api/sdui/docs");
    const res = mkRes();
    await h({}, res);
    expect(res.body.data).toEqual([{ _id: "a" }]);
  });
  it("GET list 500 on error", async () => {
    sduiAdmin.getAllDocs.mockRejectedValue(new Error("e"));
    const h = lastHandler("get", "/api/sdui/docs");
    const res = mkRes();
    await h({}, res);
    expect(res.statusCode).toBe(500);
  });
  it("GET one 404 when missing", async () => {
    sduiAdmin.getDoc.mockResolvedValue(null);
    const h = lastHandler("get", "/api/sdui/docs/:id");
    const res = mkRes();
    await h({ params: { id: "a" } }, res);
    expect(res.statusCode).toBe(404);
  });
  it("GET one 200", async () => {
    sduiAdmin.getDoc.mockResolvedValue({ _id: "a" });
    const h = lastHandler("get", "/api/sdui/docs/:id");
    const res = mkRes();
    await h({ params: { id: "a" } }, res);
    expect(res.body.data._id).toBe("a");
  });
  it("GET one 500 on error", async () => {
    sduiAdmin.getDoc.mockRejectedValue(new Error("e"));
    const h = lastHandler("get", "/api/sdui/docs/:id");
    const res = mkRes();
    await h({ params: { id: "a" } }, res);
    expect(res.statusCode).toBe(500);
  });
  it("POST create 400 when fields missing", async () => {
    const h = lastHandler("post", "/api/sdui/docs");
    const res = mkRes();
    await h({ body: {} }, res);
    expect(res.statusCode).toBe(400);
  });
  it("POST create 201 + autoSeed for sidebar", async () => {
    sduiAdmin.createDoc.mockResolvedValue({ _id: "cta", title: "CTA", config_type: "sidebar" });
    const h = lastHandler("post", "/api/sdui/docs");
    const res = mkRes();
    await h({ body: { _id: "cta", title: "CTA", config_type: "sidebar" } }, res);
    expect(res.statusCode).toBe(201);
    // give the fire-and-forget a tick
    await new Promise(r => setTimeout(r, 5));
  });
  it("POST create 201 for non-sidebar (no autoSeed)", async () => {
    sduiAdmin.createDoc.mockResolvedValue({ _id: "n", title: "N", config_type: "navbar" });
    const h = lastHandler("post", "/api/sdui/docs");
    const res = mkRes();
    await h({ body: { _id: "n", title: "N", config_type: "navbar" } }, res);
    expect(res.statusCode).toBe(201);
  });
  it("POST create 409 when 'already exists'", async () => {
    sduiAdmin.createDoc.mockRejectedValue(new Error("already exists"));
    const h = lastHandler("post", "/api/sdui/docs");
    const res = mkRes();
    await h({ body: { _id: "a", title: "t", config_type: "c" } }, res);
    expect(res.statusCode).toBe(409);
  });
  it("POST create 500 on generic error", async () => {
    sduiAdmin.createDoc.mockRejectedValue(new Error("boom"));
    const h = lastHandler("post", "/api/sdui/docs");
    const res = mkRes();
    await h({ body: { _id: "a", title: "t", config_type: "c" } }, res);
    expect(res.statusCode).toBe(500);
  });
  it("POST autoSeed: existing doc in collection → no insert", async () => {
    // Configure getPlanAccessCollection mock chain
    const findOne = vi.fn().mockResolvedValue({ _id: "cta" });
    const insertOne = vi.fn();
    sduiDb.getDB.mockResolvedValue({ collection: () => ({ findOne, insertOne }) });
    sduiAdmin.createDoc.mockResolvedValue({ _id: "cta", title: "CTA", config_type: "sidebar" });
    const h = lastHandler("post", "/api/sdui/docs");
    await h({ body: { _id: "cta", title: "CTA", config_type: "sidebar" } }, mkRes());
    await new Promise(r => setTimeout(r, 5));
    expect(insertOne).not.toHaveBeenCalled();
  });
  it("POST autoSeed: getDB throws → warn logged", async () => {
    sduiDb.getDB.mockRejectedValue(new Error("db-down"));
    sduiAdmin.createDoc.mockResolvedValue({ _id: "x", title: "X", config_type: "sidebar" });
    const h = lastHandler("post", "/api/sdui/docs");
    await h({ body: { _id: "x", title: "X", config_type: "sidebar" } }, mkRes());
    await new Promise(r => setTimeout(r, 5));
    expect(childLog.warn).toHaveBeenCalledWith("autoSeedPlanAccessForSduiDoc failed", expect.any(Object));
  });
  it("PUT update 400 when body missing", async () => {
    const h = lastHandler("put", "/api/sdui/docs/:id");
    const res = mkRes();
    await h({ body: null, params: { id: "a" } }, res);
    expect(res.statusCode).toBe(400);
  });
  it("PUT update 200 + audit", async () => {
    const h = lastHandler("put", "/api/sdui/docs/:id");
    const res = mkRes();
    await h({
      body: { title: "T", config_type: "sidebar" },
      params: { id: "a" },
      adminSession: { systemAuth: { hostname: "h", platform: "p", arch: "a", username: "u" } },
      ip: "1",
    }, res);
    expect(res.body.code).toBe(200);
  });
  it("PUT update 200 without systemAuth", async () => {
    const h = lastHandler("put", "/api/sdui/docs/:id");
    const res = mkRes();
    await h({ body: { title: "T" }, params: { id: "a" }, adminSession: {}, connection: { remoteAddress: "1" } }, res);
    expect(res.body.code).toBe(200);
  });
  it("PUT update 500 on error", async () => {
    sduiAdmin.updateDoc.mockRejectedValue(new Error("e"));
    const h = lastHandler("put", "/api/sdui/docs/:id");
    const res = mkRes();
    await h({ body: { title: "T" }, params: { id: "a" }, adminSession: {} }, res);
    expect(res.statusCode).toBe(500);
  });
  it("PATCH flag 400 when flag undefined", async () => {
    const h = lastHandler("patch", "/api/sdui/docs/:id/flag");
    const res = mkRes();
    await h({ body: {}, params: { id: "a" } }, res);
    expect(res.statusCode).toBe(400);
  });
  it("PATCH flag 400 when no body", async () => {
    const h = lastHandler("patch", "/api/sdui/docs/:id/flag");
    const res = mkRes();
    await h({ params: { id: "a" } }, res);
    expect(res.statusCode).toBe(400);
  });
  it("PATCH flag 200 + audit", async () => {
    const h = lastHandler("patch", "/api/sdui/docs/:id/flag");
    const res = mkRes();
    await h({
      body: { flag: true }, params: { id: "a" },
      adminSession: { systemAuth: { username: "u" } }, ip: "1",
    }, res);
    expect(res.body.code).toBe(200);
  });
  it("PATCH flag 200 no audit", async () => {
    const h = lastHandler("patch", "/api/sdui/docs/:id/flag");
    const res = mkRes();
    await h({ body: { flag: false }, params: { id: "a" }, adminSession: {}, connection: { remoteAddress: "1" } }, res);
    expect(res.body.code).toBe(200);
  });
  it("PATCH flag 500", async () => {
    sduiAdmin.patchField.mockRejectedValue(new Error("e"));
    const h = lastHandler("patch", "/api/sdui/docs/:id/flag");
    const res = mkRes();
    await h({ body: { flag: true }, params: { id: "a" }, adminSession: {} }, res);
    expect(res.statusCode).toBe(500);
  });
  it("PATCH visible 400/200/500", async () => {
    const h = lastHandler("patch", "/api/sdui/docs/:id/visible");
    const res1 = mkRes();
    await h({ body: {}, params: { id: "a" } }, res1);
    expect(res1.statusCode).toBe(400);

    const res2 = mkRes();
    await h({ body: { visible: true }, params: { id: "a" }, adminSession: { systemAuth: { username: "u" } }, ip: "1" }, res2);
    expect(res2.body.code).toBe(200);

    // no audit branch
    const res3 = mkRes();
    await h({ body: { visible: false }, params: { id: "a" }, adminSession: {}, connection: {} }, res3);
    expect(res3.body.code).toBe(200);

    sduiAdmin.patchField.mockRejectedValueOnce(new Error("e"));
    const res4 = mkRes();
    await h({ body: { visible: true }, params: { id: "a" }, adminSession: {} }, res4);
    expect(res4.statusCode).toBe(500);

    // no body branch
    const res5 = mkRes();
    await h({ params: { id: "a" } }, res5);
    expect(res5.statusCode).toBe(400);
  });
  it("DELETE doc 200 + audit", async () => {
    const h = lastHandler("delete", "/api/sdui/docs/:id");
    const res = mkRes();
    await h({
      params: { id: "a" },
      adminSession: { systemAuth: { hostname: "h", platform: "p", arch: "a", username: "u" } },
      ip: "1",
    }, res);
    expect(res.body.code).toBe(200);
  });
  it("DELETE doc 200 without systemAuth", async () => {
    const h = lastHandler("delete", "/api/sdui/docs/:id");
    const res = mkRes();
    await h({ params: { id: "a" }, adminSession: {}, connection: { remoteAddress: "1" } }, res);
    expect(res.body.code).toBe(200);
  });
  it("DELETE doc 500", async () => {
    sduiAdmin.deleteDoc.mockRejectedValue(new Error("e"));
    const h = lastHandler("delete", "/api/sdui/docs/:id");
    const res = mkRes();
    await h({ params: { id: "a" }, adminSession: {} }, res);
    expect(res.statusCode).toBe(500);
  });
});

describe("adminRoutes > SDUI snapshots", () => {
  it("GET snapshots 200", async () => {
    sduiAdmin.getSnapshots.mockResolvedValue([{ id: "s" }]);
    const h = lastHandler("get", "/api/sdui/docs/:id/snapshots");
    const res = mkRes();
    await h({ params: { id: "a" } }, res);
    expect(res.body.code).toBe(200);
  });
  it("GET snapshots 500", async () => {
    sduiAdmin.getSnapshots.mockRejectedValue(new Error("e"));
    const h = lastHandler("get", "/api/sdui/docs/:id/snapshots");
    const res = mkRes();
    await h({ params: { id: "a" } }, res);
    expect(res.statusCode).toBe(500);
  });
  it("POST restore 200 with systemAuth", async () => {
    sduiAdmin.restoreSnapshot.mockResolvedValue({ _id: "a" });
    const h = lastHandler("post", "/api/sdui/docs/:id/restore/:snapshotId");
    const res = mkRes();
    await h({
      params: { id: "a", snapshotId: "s" },
      adminSession: { systemAuth: { username: "u" } }, ip: "1",
    }, res);
    expect(res.body.code).toBe(200);
  });
  it("POST restore 200 without systemAuth", async () => {
    sduiAdmin.restoreSnapshot.mockResolvedValue({});
    const h = lastHandler("post", "/api/sdui/docs/:id/restore/:snapshotId");
    const res = mkRes();
    await h({ params: { id: "a", snapshotId: "s" }, adminSession: {}, connection: {} }, res);
    expect(res.body.code).toBe(200);
  });
  it("POST restore 500", async () => {
    sduiAdmin.restoreSnapshot.mockRejectedValue(new Error("e"));
    const h = lastHandler("post", "/api/sdui/docs/:id/restore/:snapshotId");
    const res = mkRes();
    await h({ params: { id: "a", snapshotId: "s" }, adminSession: {} }, res);
    expect(res.statusCode).toBe(500);
  });
});

describe("adminRoutes > SDUI filter CRUD", () => {
  it("POST filter 400 when _id missing", async () => {
    const h = lastHandler("post", "/api/sdui/docs/:id/filters");
    const res = mkRes();
    await h({ body: {}, params: { id: "a" } }, res);
    expect(res.statusCode).toBe(400);
  });
  it("POST filter 201", async () => {
    const h = lastHandler("post", "/api/sdui/docs/:id/filters");
    const res = mkRes();
    await h({ body: { _id: "f", label: "Filter" }, params: { id: "a" } }, res);
    expect(res.statusCode).toBe(201);
  });
  it("POST filter 500", async () => {
    sduiAdmin.addFilter.mockRejectedValue(new Error("e"));
    const h = lastHandler("post", "/api/sdui/docs/:id/filters");
    const res = mkRes();
    await h({ body: { _id: "f" }, params: { id: "a" } }, res);
    expect(res.statusCode).toBe(500);
  });
  it("PUT filter 200", async () => {
    const h = lastHandler("put", "/api/sdui/docs/:id/filters/:filterId");
    const res = mkRes();
    await h({ body: {}, params: { id: "a", filterId: "f" } }, res);
    expect(res.body.code).toBe(200);
  });
  it("PUT filter 500", async () => {
    sduiAdmin.updateFilter.mockRejectedValue(new Error("e"));
    const h = lastHandler("put", "/api/sdui/docs/:id/filters/:filterId");
    const res = mkRes();
    await h({ body: {}, params: { id: "a", filterId: "f" } }, res);
    expect(res.statusCode).toBe(500);
  });
  it("DELETE filter 200", async () => {
    const h = lastHandler("delete", "/api/sdui/docs/:id/filters/:filterId");
    const res = mkRes();
    await h({ params: { id: "a", filterId: "f" } }, res);
    expect(res.body.code).toBe(200);
  });
  it("DELETE filter 500", async () => {
    sduiAdmin.deleteFilter.mockRejectedValue(new Error("e"));
    const h = lastHandler("delete", "/api/sdui/docs/:id/filters/:filterId");
    const res = mkRes();
    await h({ params: { id: "a", filterId: "f" } }, res);
    expect(res.statusCode).toBe(500);
  });
});

describe("adminRoutes > SDUI option CRUD", () => {
  it("POST option 400 when _id missing", async () => {
    const h = lastHandler("post", "/api/sdui/docs/:id/filters/:filterId/options");
    const res = mkRes();
    await h({ body: {}, params: { id: "a", filterId: "f" } }, res);
    expect(res.statusCode).toBe(400);
  });
  it("POST option 201", async () => {
    const h = lastHandler("post", "/api/sdui/docs/:id/filters/:filterId/options");
    const res = mkRes();
    await h({ body: { _id: "o" }, params: { id: "a", filterId: "f" } }, res);
    expect(res.statusCode).toBe(201);
  });
  it("POST option 500", async () => {
    sduiAdmin.addOption.mockRejectedValue(new Error("e"));
    const h = lastHandler("post", "/api/sdui/docs/:id/filters/:filterId/options");
    const res = mkRes();
    await h({ body: { _id: "o" }, params: { id: "a", filterId: "f" } }, res);
    expect(res.statusCode).toBe(500);
  });
  it("PUT option 200", async () => {
    const h = lastHandler("put", "/api/sdui/docs/:id/filters/:filterId/options/:optionId");
    const res = mkRes();
    await h({ body: {}, params: { id: "a", filterId: "f", optionId: "o" } }, res);
    expect(res.body.code).toBe(200);
  });
  it("PUT option 500", async () => {
    sduiAdmin.updateOption.mockRejectedValue(new Error("e"));
    const h = lastHandler("put", "/api/sdui/docs/:id/filters/:filterId/options/:optionId");
    const res = mkRes();
    await h({ body: {}, params: { id: "a", filterId: "f", optionId: "o" } }, res);
    expect(res.statusCode).toBe(500);
  });
  it("DELETE option 200", async () => {
    const h = lastHandler("delete", "/api/sdui/docs/:id/filters/:filterId/options/:optionId");
    const res = mkRes();
    await h({ params: { id: "a", filterId: "f", optionId: "o" } }, res);
    expect(res.body.code).toBe(200);
  });
  it("DELETE option 500", async () => {
    sduiAdmin.deleteOption.mockRejectedValue(new Error("e"));
    const h = lastHandler("delete", "/api/sdui/docs/:id/filters/:filterId/options/:optionId");
    const res = mkRes();
    await h({ params: { id: "a", filterId: "f", optionId: "o" } }, res);
    expect(res.statusCode).toBe(500);
  });
});

function fakePlanCol(impl) {
  const def = {
    find: vi.fn(() => ({ toArray: vi.fn(async () => []) })),
    findOne: vi.fn(async () => null),
    insertOne: vi.fn(async () => ({})),
    updateOne: vi.fn(async () => ({})),
    replaceOne: vi.fn(async () => ({})),
    countDocuments: vi.fn(async () => 0),
  };
  return Object.assign(def, impl || {});
}

describe("adminRoutes > GET /api/plan-access/config", () => {
  it("200 with merged docs (happy path)", async () => {
    const col = fakePlanCol({
      find: vi.fn(() => ({ toArray: vi.fn(async () => [
        { _id: "platform_access", platform_plans: {} },
        { _id: "competitor_limits", plan_limits: {} },
        { _id: "plan_groups", groups: {} },
        { _id: "filter_x", allowed_plan_ids: [1] },
      ]) })),
    });
    sduiDb.getDB.mockResolvedValue({
      collection: (n) => n === "plan_access_config" ? col : { find: () => ({ toArray: async () => [{ _id: "x", title: "X", config_type: "sidebar" }] }) },
    });
    const h = lastHandler("get", "/api/plan-access/config");
    const res = mkRes();
    await h({}, res);
    expect(res.body.code).toBe(200);
  });
  it("falls back to seed JSON when MongoDB empty", async () => {
    const col = fakePlanCol({});
    sduiDb.getDB.mockResolvedValue({
      collection: (n) => n === "plan_access_config" ? col : { find: () => ({ toArray: async () => [] }) },
    });
    existsSpy.mockReturnValue(true);
    readFileSpy.mockReturnValue(JSON.stringify([{ _id: "platform_access", platform_plans: {} }]));
    const h = lastHandler("get", "/api/plan-access/config");
    const res = mkRes();
    await h({}, res);
    expect(res.body.code).toBe(200);
  });
  it("plan-access getDB throws → still proceeds", async () => {
    sduiDb.getDB.mockRejectedValueOnce(new Error("db-fail"));
    const h = lastHandler("get", "/api/plan-access/config");
    const res = mkRes();
    await h({}, res);
    expect(res.body.code).toBe(200);
  });
  it("seeds plan_groups when missing", async () => {
    const col = fakePlanCol({
      find: vi.fn(() => ({ toArray: vi.fn(async () => []) })),
    });
    sduiDb.getDB.mockResolvedValue({
      collection: (n) => n === "plan_access_config" ? col : { find: () => ({ toArray: async () => [] }) },
    });
    const h = lastHandler("get", "/api/plan-access/config");
    const res = mkRes();
    await h({}, res);
    expect(res.body.data.planGroupsDoc).toBeDefined();
  });
  it("logs sdui_config fetch failure", async () => {
    const col = fakePlanCol({});
    let call = 0;
    sduiDb.getDB.mockImplementation(async () => ({
      collection: (n) => {
        if (n === "plan_access_config") return col;
        return { find: () => { throw new Error("sdui-fail"); } };
      },
    }));
    const h = lastHandler("get", "/api/plan-access/config");
    const res = mkRes();
    await h({}, res);
    expect(childLog.error).toHaveBeenCalledWith("plan-access GET: failed to fetch sdui_config", expect.any(Object));
  });
  it("logs auto-seed failure", async () => {
    const col = fakePlanCol({
      find: vi.fn(() => ({ toArray: vi.fn(async () => []) })),
      updateOne: vi.fn().mockRejectedValue(new Error("upd-fail")),
    });
    sduiDb.getDB.mockResolvedValue({
      collection: (n) => n === "plan_access_config" ? col : { find: () => ({ toArray: async () => [{ _id: "newf", title: "New", config_type: "sidebar" }] }) },
    });
    const h = lastHandler("get", "/api/plan-access/config");
    const res = mkRes();
    await h({}, res);
    expect(childLog.warn).toHaveBeenCalledWith("Failed to auto-seed new features with Palladium IDs", expect.any(Object));
  });
  it("logs plan_groups seed failure", async () => {
    const col = fakePlanCol({
      find: vi.fn(() => ({ toArray: vi.fn(async () => []) })),
      insertOne: vi.fn().mockRejectedValue(new Error("ins-fail")),
    });
    sduiDb.getDB.mockResolvedValue({
      collection: (n) => n === "plan_access_config" ? col : { find: () => ({ toArray: async () => [] }) },
    });
    const h = lastHandler("get", "/api/plan-access/config");
    const res = mkRes();
    await h({}, res);
    expect(childLog.warn).toHaveBeenCalledWith("Failed to seed plan_groups to MongoDB", expect.any(Object));
  });
  it("500 on outer error (planAccessSeed require fails)", async () => {
    // Bust the cached seed so require() inside the handler throws.
    delete require.cache[seedPath];
    require.cache[seedPath] = {
      id: seedPath, filename: seedPath, loaded: true,
      get exports() { throw new Error("seed-explode"); },
    };
    freshSut();
    // Restore for downstream tests
    const h = lastHandler("get", "/api/plan-access/config");
    const res = mkRes();
    await h({}, res);
    expect(res.statusCode).toBe(500);
    // restore
    require.cache[seedPath] = {
      id: seedPath, filename: seedPath, loaded: true, exports: seedExports,
    };
    freshSut();
  });
  it("hides remapped SDUI IDs (cta→call_to_action)", async () => {
    const col = fakePlanCol({
      find: vi.fn(() => ({ toArray: vi.fn(async () => [
        { _id: "call_to_action", allowed_plan_ids: [1] },
        { _id: "cta", allowed_plan_ids: [9] },
      ]) })),
    });
    sduiDb.getDB.mockResolvedValue({
      collection: (n) => n === "plan_access_config" ? col : { find: () => ({ toArray: async () => [{ _id: "cta", title: "CTA", config_type: "sidebar" }] }) },
    });
    const h = lastHandler("get", "/api/plan-access/config");
    const res = mkRes();
    await h({}, res);
    const ids = res.body.data.filterDocs.map(d => d._id);
    expect(ids).not.toContain("cta");
  });
});

describe("adminRoutes > GET /api/plan-access/review-count", () => {
  it("200 with count", async () => {
    const col = fakePlanCol({
      find: vi.fn(() => ({ toArray: vi.fn(async () => [{ _id: "a", label: "A" }, { _id: "b" }]) })),
    });
    sduiDb.getDB.mockResolvedValue({
      collection: () => col,
    });
    const h = lastHandler("get", "/api/plan-access/review-count");
    const res = mkRes();
    await h({}, res);
    expect(res.body.data.count).toBe(2);
  });
  it("200 with zero on error", async () => {
    sduiDb.getDB.mockImplementation(() => { throw new Error("e"); });
    const h = lastHandler("get", "/api/plan-access/review-count");
    const res = mkRes();
    await h({}, res);
    expect(res.body.data.count).toBe(0);
  });
});

describe("adminRoutes > PUT /api/plan-access/config", () => {
  it("400 when planId missing", async () => {
    const h = lastHandler("put", "/api/plan-access/config");
    const res = mkRes();
    await h({ body: {} }, res);
    expect(res.statusCode).toBe(400);
  });
  it("400 when planId not a positive integer", async () => {
    const h = lastHandler("put", "/api/plan-access/config");
    const res = mkRes();
    await h({ body: { planId: "abc" } }, res);
    expect(res.statusCode).toBe(400);
  });
  it("400 when planId is zero/negative", async () => {
    const h = lastHandler("put", "/api/plan-access/config");
    const res = mkRes();
    await h({ body: { planId: "0" } }, res);
    expect(res.statusCode).toBe(400);
  });
  it("200 happy path with platforms+limits+filters+filterPlatforms", async () => {
    const col = fakePlanCol({
      findOne: vi.fn(async (q) => {
        if (q._id === "platform_access") return { platform_plans: { facebook: [1], google: [2] } };
        return null;
      }),
    });
    sduiDb.getDB.mockResolvedValue({ collection: () => col });
    const h = lastHandler("put", "/api/plan-access/config");
    const res = mkRes();
    await h({
      body: {
        planId: 99,
        platforms: ["facebook"],
        limits: { brandLimit: 5, competitorLimit: 10 },
        filters: { f1: true, f2: false },
        filterPlatforms: { f3: { fb: true } },
      },
    }, res);
    expect(res.body.code).toBe(200);
  });
  it("auto-seeds from JSON when empty + planBillingMetadata absent from seed", async () => {
    const col = fakePlanCol({
      countDocuments: vi.fn(async () => 0),
    });
    sduiDb.getDB.mockResolvedValue({ collection: () => col });
    existsSpy.mockReturnValue(true);
    readFileSpy.mockReturnValue(JSON.stringify([{ _id: "a" }]));
    const h = lastHandler("put", "/api/plan-access/config");
    const res = mkRes();
    await h({ body: { planId: 1 } }, res);
    expect(res.body.code).toBe(200);
  });
  it("seed JSON parse error in early-fallback is swallowed", async () => {
    // Make countDocuments return non-zero so the second (non-try-wrapped) read is skipped.
    const col = fakePlanCol({ countDocuments: vi.fn(async () => 5) });
    sduiDb.getDB.mockResolvedValue({ collection: () => col });
    existsSpy.mockReturnValue(true);
    readFileSpy.mockReturnValue("not-json"); // hits seedConfig try/catch only
    const h = lastHandler("put", "/api/plan-access/config");
    const res = mkRes();
    await h({ body: { planId: 1 } }, res);
    expect(res.body.code).toBe(200);
  });
  it("filter without existing doc uses seed default", async () => {
    const col = fakePlanCol({
      findOne: vi.fn(async () => null),
    });
    sduiDb.getDB.mockResolvedValue({ collection: () => col });
    existsSpy.mockReturnValue(true);
    readFileSpy.mockReturnValue(JSON.stringify([{ _id: "myFilter", allowed_plan_ids: [1, 2] }]));
    const h = lastHandler("put", "/api/plan-access/config");
    const res = mkRes();
    await h({ body: { planId: 1, filters: { myFilter: false } } }, res);
    expect(res.body.code).toBe(200);
  });
  it("filter not present anywhere and shouldHave=false → explicit []", async () => {
    const col = fakePlanCol({});
    sduiDb.getDB.mockResolvedValue({ collection: () => col });
    const h = lastHandler("put", "/api/plan-access/config");
    const res = mkRes();
    await h({ body: { planId: 7, filters: { brand_new: false } } }, res);
    expect(res.body.code).toBe(200);
  });
  it("filter shouldHave + already has = no-op (no updateOne)", async () => {
    const col = fakePlanCol({
      findOne: vi.fn(async () => ({ allowed_plan_ids: [1] })),
    });
    sduiDb.getDB.mockResolvedValue({ collection: () => col });
    const h = lastHandler("put", "/api/plan-access/config");
    const res = mkRes();
    await h({ body: { planId: 1, filters: { f1: true } } }, res);
    expect(res.body.code).toBe(200);
  });
  it("500 when getPlanAccessCollection throws", async () => {
    sduiDb.getDB.mockRejectedValue(new Error("db-fail"));
    const h = lastHandler("put", "/api/plan-access/config");
    const res = mkRes();
    await h({ body: { planId: 1 } }, res);
    expect(res.statusCode).toBe(500);
  });
  it("platform access path: grants and revokes correctly", async () => {
    const col = fakePlanCol({
      findOne: vi.fn(async () => ({ platform_plans: { fb: [1, 2], ig: [3] } })),
    });
    sduiDb.getDB.mockResolvedValue({ collection: () => col });
    const h = lastHandler("put", "/api/plan-access/config");
    const res = mkRes();
    await h({ body: { planId: 3, platforms: ["fb"] } }, res);
    expect(res.body.code).toBe(200);
  });
});

describe("adminRoutes > POST /api/plan-access/add-plan", () => {
  it("400 when ids missing", async () => {
    const h = lastHandler("post", "/api/plan-access/add-plan");
    const res = mkRes();
    await h({ body: {} }, res);
    expect(res.statusCode).toBe(400);
  });
  it("400 when group missing", async () => {
    const h = lastHandler("post", "/api/plan-access/add-plan");
    const res = mkRes();
    await h({ body: { newPlanId: 1, refPlanId: 2 } }, res);
    expect(res.statusCode).toBe(400);
  });
  it("200 with full copy path", async () => {
    const col = fakePlanCol({
      findOne: vi.fn(async (q) => {
        if (q._id === "platform_access") return { platform_plans: { fb: [2] } };
        if (q._id === "competitor_limits") return { plan_limits: { "2": { brandLimit: 5, competitorLimit: 5 } } };
        if (q._id === "plan_groups") return { groups: { Premium: { plans: [2] } } };
        return null;
      }),
      find: vi.fn(() => ({ toArray: async () => [{ _id: "f1", allowed_plan_ids: [2] }] })),
    });
    sduiDb.getDB.mockResolvedValue({ collection: () => col });
    const h = lastHandler("post", "/api/plan-access/add-plan");
    const res = mkRes();
    await h({ body: { newPlanId: 99, refPlanId: 2, group: "Premium" } }, res);
    expect(res.body.code).toBe(200);
  });
  it("200 creates group when missing (uses default color)", async () => {
    const col = fakePlanCol({
      findOne: vi.fn(async (q) => q._id === "plan_groups" ? { groups: { Premium: { plans: [] } } } : null),
      find: vi.fn(() => ({ toArray: async () => [] })),
    });
    sduiDb.getDB.mockResolvedValue({ collection: () => col });
    const h = lastHandler("post", "/api/plan-access/add-plan");
    const res = mkRes();
    await h({ body: { newPlanId: 99, refPlanId: 2, group: "Free" } }, res);
    expect(res.body.code).toBe(200);
  });
  it("200 creates group with unknown name (gets default color)", async () => {
    const col = fakePlanCol({
      findOne: vi.fn(async (q) => q._id === "plan_groups" ? { groups: {} } : null),
      find: vi.fn(() => ({ toArray: async () => [] })),
    });
    sduiDb.getDB.mockResolvedValue({ collection: () => col });
    const h = lastHandler("post", "/api/plan-access/add-plan");
    const res = mkRes();
    await h({ body: { newPlanId: 99, refPlanId: 2, group: "Unknown" } }, res);
    expect(res.body.code).toBe(200);
  });
  it("200 with no limits doc → uses zero defaults", async () => {
    const col = fakePlanCol({
      findOne: vi.fn(async (q) => q._id === "competitor_limits" ? { plan_limits: {} } : null),
      find: vi.fn(() => ({ toArray: async () => [] })),
    });
    sduiDb.getDB.mockResolvedValue({ collection: () => col });
    const h = lastHandler("post", "/api/plan-access/add-plan");
    const res = mkRes();
    await h({ body: { newPlanId: 99, refPlanId: 2, group: "Free" } }, res);
    expect(res.body.code).toBe(200);
  });
  it("500 when collection access fails", async () => {
    sduiDb.getDB.mockRejectedValue(new Error("e"));
    const h = lastHandler("post", "/api/plan-access/add-plan");
    const res = mkRes();
    await h({ body: { newPlanId: 1, refPlanId: 2, group: "Free" } }, res);
    expect(res.statusCode).toBe(500);
  });
  it("skips filter doc when refPid not present", async () => {
    const col = fakePlanCol({
      findOne: vi.fn(async () => null),
      find: vi.fn(() => ({ toArray: async () => [{ _id: "f1", allowed_plan_ids: [99] }] })),
    });
    sduiDb.getDB.mockResolvedValue({ collection: () => col });
    const h = lastHandler("post", "/api/plan-access/add-plan");
    const res = mkRes();
    await h({ body: { newPlanId: 1, refPlanId: 2, group: "Free" } }, res);
    expect(res.body.code).toBe(200);
  });
});

describe("adminRoutes > GET /api/plan-access/check-id/:id", () => {
  it("400 invalid id", async () => {
    const h = lastHandler("get", "/api/plan-access/check-id/:id");
    const res = mkRes();
    await h({ params: { id: "abc" } }, res);
    expect(res.body.code).toBe(400);
  });
  it("200 exists via platform_access", async () => {
    const col = fakePlanCol({
      findOne: vi.fn(async (q) => q._id === "platform_access" ? { platform_plans: { fb: [5] } } : null),
    });
    sduiDb.getDB.mockResolvedValue({ collection: () => col });
    const h = lastHandler("get", "/api/plan-access/check-id/:id");
    const res = mkRes();
    await h({ params: { id: "5" } }, res);
    expect(res.body.exists).toBe(true);
  });
  it("200 exists via competitor_limits", async () => {
    const col = fakePlanCol({
      findOne: vi.fn(async (q) => {
        if (q._id === "platform_access") return { platform_plans: {} };
        if (q._id === "competitor_limits") return { plan_limits: { "5": {} } };
        return null;
      }),
    });
    sduiDb.getDB.mockResolvedValue({ collection: () => col });
    const h = lastHandler("get", "/api/plan-access/check-id/:id");
    const res = mkRes();
    await h({ params: { id: "5" } }, res);
    expect(res.body.exists).toBe(true);
  });
  it("200 exists via filter doc", async () => {
    const col = fakePlanCol({
      findOne: vi.fn(async (q) => {
        if (q._id === "platform_access") return { platform_plans: {} };
        if (q._id === "competitor_limits") return null;
        if (q.allowed_plan_ids) return { _id: "anything" };
        return null;
      }),
    });
    sduiDb.getDB.mockResolvedValue({ collection: () => col });
    const h = lastHandler("get", "/api/plan-access/check-id/:id");
    const res = mkRes();
    await h({ params: { id: "5" } }, res);
    expect(res.body.exists).toBe(true);
  });
  it("200 not-found path", async () => {
    const col = fakePlanCol({
      findOne: vi.fn(async () => null),
    });
    sduiDb.getDB.mockResolvedValue({ collection: () => col });
    const h = lastHandler("get", "/api/plan-access/check-id/:id");
    const res = mkRes();
    await h({ params: { id: "5" } }, res);
    expect(res.body.exists).toBe(false);
  });
  it("500 on outer error", async () => {
    sduiDb.getDB.mockRejectedValue(new Error("e"));
    const h = lastHandler("get", "/api/plan-access/check-id/:id");
    const res = mkRes();
    await h({ params: { id: "5" } }, res);
    expect(res.statusCode).toBe(500);
  });
});

describe("adminRoutes > DELETE /api/plan-access/plan/:id (soft delete)", () => {
  it("400 invalid id", async () => {
    const h = lastHandler("delete", "/api/plan-access/plan/:id");
    const res = mkRes();
    await h({ params: { id: "abc" } }, res);
    expect(res.statusCode).toBe(400);
  });
  it("404 no plan_groups doc", async () => {
    const col = fakePlanCol({ findOne: vi.fn(async () => null) });
    sduiDb.getDB.mockResolvedValue({ collection: () => col });
    const h = lastHandler("delete", "/api/plan-access/plan/:id");
    const res = mkRes();
    await h({ params: { id: "5" } }, res);
    expect(res.statusCode).toBe(404);
  });
  it("404 plan not in any group", async () => {
    const col = fakePlanCol({
      findOne: vi.fn(async () => ({ groups: { Premium: { plans: [99] } }, deleted_plan_ids: [] })),
    });
    sduiDb.getDB.mockResolvedValue({ collection: () => col });
    const h = lastHandler("delete", "/api/plan-access/plan/:id");
    const res = mkRes();
    await h({ params: { id: "5" } }, res);
    expect(res.statusCode).toBe(404);
  });
  it("409 already deleted", async () => {
    const col = fakePlanCol({
      findOne: vi.fn(async () => ({
        groups: { Premium: { plans: [5] } },
        deleted_plan_ids: [{ plan_id: 5 }],
      })),
    });
    sduiDb.getDB.mockResolvedValue({ collection: () => col });
    const h = lastHandler("delete", "/api/plan-access/plan/:id");
    const res = mkRes();
    await h({ params: { id: "5" } }, res);
    expect(res.statusCode).toBe(409);
  });
  it("200 soft-delete success", async () => {
    const col = fakePlanCol({
      findOne: vi.fn(async () => ({
        groups: { Premium: { plans: [5] } },
        deleted_plan_ids: [],
      })),
    });
    sduiDb.getDB.mockResolvedValue({ collection: () => col });
    const h = lastHandler("delete", "/api/plan-access/plan/:id");
    const res = mkRes();
    await h({ params: { id: "5" } }, res);
    expect(res.body.code).toBe(200);
  });
  it("200 with undefined plans key in a group is skipped", async () => {
    const col = fakePlanCol({
      findOne: vi.fn(async () => ({
        groups: { Premium: {}, Other: { plans: [5] } },
        deleted_plan_ids: [],
      })),
    });
    sduiDb.getDB.mockResolvedValue({ collection: () => col });
    const h = lastHandler("delete", "/api/plan-access/plan/:id");
    const res = mkRes();
    await h({ params: { id: "5" } }, res);
    expect(res.body.code).toBe(200);
  });
  it("500 on outer error", async () => {
    sduiDb.getDB.mockRejectedValue(new Error("e"));
    const h = lastHandler("delete", "/api/plan-access/plan/:id");
    const res = mkRes();
    await h({ params: { id: "5" } }, res);
    expect(res.statusCode).toBe(500);
  });
});

describe("adminRoutes > POST /api/plan-access/restore-plan/:id", () => {
  it("400 invalid id", async () => {
    const h = lastHandler("post", "/api/plan-access/restore-plan/:id");
    const res = mkRes();
    await h({ params: { id: "abc" } }, res);
    expect(res.statusCode).toBe(400);
  });
  it("404 no plan_groups doc", async () => {
    const col = fakePlanCol({ findOne: vi.fn(async () => null) });
    sduiDb.getDB.mockResolvedValue({ collection: () => col });
    const h = lastHandler("post", "/api/plan-access/restore-plan/:id");
    const res = mkRes();
    await h({ params: { id: "5" } }, res);
    expect(res.statusCode).toBe(404);
  });
  it("404 plan not soft-deleted", async () => {
    const col = fakePlanCol({
      findOne: vi.fn(async () => ({ deleted_plan_ids: [] })),
    });
    sduiDb.getDB.mockResolvedValue({ collection: () => col });
    const h = lastHandler("post", "/api/plan-access/restore-plan/:id");
    const res = mkRes();
    await h({ params: { id: "5" } }, res);
    expect(res.statusCode).toBe(404);
  });
  it("200 restored success", async () => {
    const col = fakePlanCol({
      findOne: vi.fn(async () => ({ deleted_plan_ids: [{ plan_id: 5, group: "Premium" }] })),
    });
    sduiDb.getDB.mockResolvedValue({ collection: () => col });
    const h = lastHandler("post", "/api/plan-access/restore-plan/:id");
    const res = mkRes();
    await h({ params: { id: "5" } }, res);
    expect(res.body.code).toBe(200);
  });
  it("500 on outer error", async () => {
    sduiDb.getDB.mockRejectedValue(new Error("e"));
    const h = lastHandler("post", "/api/plan-access/restore-plan/:id");
    const res = mkRes();
    await h({ params: { id: "5" } }, res);
    expect(res.statusCode).toBe(500);
  });
});

describe("adminRoutes > formatBytes (via /api/logs)", () => {
  it("formats 0 bytes", () => {
    existsSpy.mockReturnValue(true);
    readdirSpy.mockReturnValue(["a.log"]);
    statSpy.mockReturnValue({ size: 0, mtime: new Date() });
    const h = lastHandler("get", "/api/logs");
    const res = mkRes();
    h({}, res);
    expect(res.body.data[0].sizeHuman).toBe("0 B");
  });
  it("formats KB sizes", () => {
    existsSpy.mockReturnValue(true);
    readdirSpy.mockReturnValue(["a.log"]);
    statSpy.mockReturnValue({ size: 5000, mtime: new Date() });
    const h = lastHandler("get", "/api/logs");
    const res = mkRes();
    h({}, res);
    expect(res.body.data[0].sizeHuman).toMatch(/KB/);
  });
  it("formats MB sizes", () => {
    existsSpy.mockReturnValue(true);
    readdirSpy.mockReturnValue(["a.log"]);
    statSpy.mockReturnValue({ size: 5 * 1024 * 1024, mtime: new Date() });
    const h = lastHandler("get", "/api/logs");
    const res = mkRes();
    h({}, res);
    expect(res.body.data[0].sizeHuman).toMatch(/MB/);
  });
});
