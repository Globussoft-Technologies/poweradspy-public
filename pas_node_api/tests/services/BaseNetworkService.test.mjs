import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const expressPath = require.resolve("express");
const routerInstances = [];
function FakeRouter() {
  const r = {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    _id: routerInstances.length,
  };
  routerInstances.push(r);
  return r;
}
require.cache[expressPath] = {
  id: expressPath, filename: expressPath, loaded: true,
  exports: { Router: FakeRouter },
};

const cbPath = require.resolve("../../src/utils/circuitBreaker");
const cbInstances = [];
function FakeCircuitBreaker(slug, opts) {
  this.slug = slug; this.opts = opts;
  this.getStatus = vi.fn(() => ({ state: "closed" }));
  cbInstances.push(this);
}
require.cache[cbPath] = {
  id: cbPath, filename: cbPath, loaded: true, exports: FakeCircuitBreaker,
};

const errHandlerPath = require.resolve("../../src/middleware/errorHandler");
const asyncHandler = (fn) => fn;
const AppError = class AppError extends Error {};
require.cache[errHandlerPath] = {
  id: errHandlerPath, filename: errHandlerPath, loaded: true,
  exports: { asyncHandler, AppError },
};

const respPath = require.resolve("../../src/utils/responseFormatter");
const ResponseFormatter = { success: vi.fn((res, payload) => ({ res, payload })) };
require.cache[respPath] = {
  id: respPath, filename: respPath, loaded: true,
  exports: ResponseFormatter,
};

const dbMgrPath = require.resolve("../../src/database/DatabaseManager");
const databaseManager = { getConnections: vi.fn() };
require.cache[dbMgrPath] = {
  id: dbMgrPath, filename: dbMgrPath, loaded: true, exports: databaseManager,
};

const loggerPath = require.resolve("../../src/logger");
const childLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { createChild: vi.fn(() => childLog) },
};

const constantsPath = require.resolve("../../src/utils/constants");
require.cache[constantsPath] = {
  id: constantsPath, filename: constantsPath, loaded: true,
  exports: { HTTP: {}, ERROR_CODES: {}, CACHE_NS: {} },
};

const BaseNetworkService = require("../../src/services/BaseNetworkService");

class FacebookFake extends BaseNetworkService {
  _registerCustomRoutes() { this._customCalled = true; }
}

beforeEach(() => {
  routerInstances.length = 0;
  cbInstances.length = 0;
  ResponseFormatter.success.mockClear();
  databaseManager.getConnections.mockReset();
  childLog.info.mockClear();
});

describe("BaseNetworkService > abstract guard", () => {
  it("throws when instantiated directly", () => {
    expect(() => new BaseNetworkService({ name: "Foo" })).toThrow(/abstract/);
  });
});

describe("BaseNetworkService > subclass constructor", () => {
  it("sets defaults + builds router + registers /status and /db/health", () => {
    const svc = new FacebookFake({ name: "Facebook", slug: "facebook", enabled: true });
    expect(svc.name).toBe("Facebook");
    expect(svc.slug).toBe("facebook");
    expect(svc.enabled).toBe(true);
    expect(svc.cacheTTL).toBe(300);
    expect(svc.router.get).toHaveBeenCalledWith("/status", expect.any(Function));
    expect(svc.router.get).toHaveBeenCalledWith("/db/health", expect.any(Function));
    expect(svc._customCalled).toBe(true);
    expect(childLog.info).toHaveBeenCalledWith(expect.stringContaining("initialized"));
  });

  it("default slug uses name.toLowerCase() when not provided", () => {
    const svc = new FacebookFake({ name: "Facebook", enabled: true });
    expect(svc.slug).toBe("facebook");
  });

  it("default name='Unknown' when not provided", () => {
    const svc = new FacebookFake({});
    expect(svc.name).toBe("Unknown");
    expect(svc.slug).toBe("unknown");
  });

  it("uses cacheTTL from config when present", () => {
    const svc = new FacebookFake({ name: "X", cacheTTL: 999 });
    expect(svc.cacheTTL).toBe(999);
  });

  it("instantiates CircuitBreaker with expected slug + threshold opts", () => {
    new FacebookFake({ name: "Foo", slug: "foo" });
    expect(cbInstances[0].slug).toBe("foo");
    expect(cbInstances[0].opts).toEqual({ failureThreshold: 5, resetTimeoutMs: 30000 });
  });

  it("base _registerCustomRoutes is a no-op when subclass doesn't override", () => {
    class Bare extends BaseNetworkService {}
    const svc = new Bare({ name: "Bare" });
    expect(svc._customCalled).toBeUndefined();
  });
});

describe("BaseNetworkService > injectDatabases", () => {
  it("populates this.db with connections from manager", () => {
    databaseManager.getConnections.mockReturnValue({ sql: "sql-conn", mongo: "mongo-conn", elastic: "es-conn" });
    const svc = new FacebookFake({ name: "Foo" });
    childLog.info.mockClear();
    svc.injectDatabases();
    expect(svc.db.sql).toBe("sql-conn");
    expect(svc.db.mongo).toBe("mongo-conn");
    expect(svc.db.elastic).toBe("es-conn");
    expect(childLog.info).toHaveBeenCalledWith("Database connections injected: [SQL, MongoDB, Elasticsearch]");
  });

  it("skips log when all connections are null", () => {
    databaseManager.getConnections.mockReturnValue({ sql: null, mongo: null, elastic: null });
    const svc = new FacebookFake({ name: "Foo" });
    childLog.info.mockClear();
    svc.injectDatabases();
    expect(childLog.info).not.toHaveBeenCalled();
  });

  it("noop when getConnections returns null", () => {
    databaseManager.getConnections.mockReturnValue(null);
    const svc = new FacebookFake({ name: "Foo" });
    svc.injectDatabases();
    expect(svc.db.sql).toBeNull();
  });

  it("partial connections logged with subset only", () => {
    databaseManager.getConnections.mockReturnValue({ sql: "x", mongo: null, elastic: null });
    const svc = new FacebookFake({ name: "Foo" });
    childLog.info.mockClear();
    svc.injectDatabases();
    expect(childLog.info).toHaveBeenCalledWith("Database connections injected: [SQL]");
  });
});

describe("BaseNetworkService > route handlers", () => {
  it("/status route handler invokes _handleGetStatus via arrow wrapper", async () => {
    const svc = new FacebookFake({ name: "Foo", slug: "foo", enabled: true });
    svc.db.sql = "x";
    // The 2nd arg of router.get('/status', handler) is the asyncHandler-wrapped arrow
    const statusCall = svc.router.get.mock.calls.find(c => c[0] === "/status");
    await statusCall[1]({}, {});
    const payload = ResponseFormatter.success.mock.calls[0][1];
    expect(payload.data.network).toBe("Foo");
    expect(payload.data.databases.sql).toBe("connected");
    expect(payload.data.databases.mongo).toBe("not configured");
    expect(payload.data.circuitBreaker).toEqual({ state: "closed" });
  });

  it("/db/health route handler invokes _handleGetDbHealth via arrow wrapper", async () => {
    const svc = new FacebookFake({ name: "Foo", slug: "foo" });
    svc.db.sql = { type: "mysql" };
    svc.db.elastic = { type: "es" };
    const dbHealthCall = svc.router.get.mock.calls.find(c => c[0] === "/db/health");
    await dbHealthCall[1]({}, {});
    const payload = ResponseFormatter.success.mock.calls[0][1];
    expect(payload.data.sql).toEqual({ status: "connected", type: "mysql" });
    expect(payload.data.mongo).toEqual({ status: "not configured" });
    expect(payload.data.elastic).toEqual({ status: "connected", type: "es" });
  });

  it("/status with mongo+elastic only (sql missing) → mirror branches of lines 115-117", async () => {
    const svc = new FacebookFake({ name: "Foo", slug: "foo" });
    // sql intentionally not set → sql branch right; mongo+elastic set → left branches
    svc.db.mongo = "m";
    svc.db.elastic = "e";
    const statusCall = svc.router.get.mock.calls.find(c => c[0] === "/status");
    await statusCall[1]({}, {});
    const payload = ResponseFormatter.success.mock.calls[0][1];
    expect(payload.data.databases.sql).toBe("not configured");
    expect(payload.data.databases.mongo).toBe("connected");
    expect(payload.data.databases.elastic).toBe("connected");
  });

  it("/db/health with mongo only (sql+elastic missing) → mirror branches of lines 127-129", async () => {
    const svc = new FacebookFake({ name: "Foo", slug: "foo" });
    svc.db.mongo = { type: "mongo" };
    const dbHealthCall = svc.router.get.mock.calls.find(c => c[0] === "/db/health");
    await dbHealthCall[1]({}, {});
    const payload = ResponseFormatter.success.mock.calls[0][1];
    expect(payload.data.sql).toEqual({ status: "not configured" });
    expect(payload.data.mongo).toEqual({ status: "connected", type: "mongo" });
    expect(payload.data.elastic).toEqual({ status: "not configured" });
  });
});

describe("BaseNetworkService > getRouter / getHealth", () => {
  it("getRouter returns the router instance", () => {
    const svc = new FacebookFake({ name: "Foo" });
    expect(svc.getRouter()).toBe(svc.router);
  });

  it("getHealth returns shape matching status (mongo connected only)", () => {
    const svc = new FacebookFake({ name: "Foo", slug: "foo", enabled: true });
    svc.db.mongo = { type: "mongo" };
    expect(svc.getHealth()).toEqual({
      name: "Foo",
      slug: "foo",
      enabled: true,
      circuitBreaker: { state: "closed" },
      databases: { sql: "not configured", mongo: "connected", elastic: "not configured" },
    });
  });
  it("getHealth with sql+elastic connected (no mongo) → mirror branches of lines 154-156", () => {
    const svc = new FacebookFake({ name: "Foo", slug: "foo", enabled: true });
    svc.db.sql = "x";
    svc.db.elastic = "y";
    const out = svc.getHealth();
    expect(out.databases.sql).toBe("connected");
    expect(out.databases.mongo).toBe("not configured");
    expect(out.databases.elastic).toBe("connected");
  });
});
