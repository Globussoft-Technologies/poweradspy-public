import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const loggerPath = require.resolve("../../src/logger");
const childLog = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };
const createChild = vi.fn(() => childLog);
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { createChild },
};

const dbPath = require.resolve("../../src/database/DatabaseManager");
const databaseManager = {
  getSQL: vi.fn(),
  getMongo: vi.fn(),
  getElastic: vi.fn(),
};
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true, exports: databaseManager,
};

import fs from "node:fs";
let existsSpy, readdirSpy;

const sutPath = require.resolve("../../src/services/ServiceRegistry");
function freshSut() {
  delete require.cache[sutPath];
  return require(sutPath);
}

beforeEach(() => {
  childLog.info.mockClear(); childLog.warn.mockClear(); childLog.debug.mockClear(); childLog.error.mockClear();
  createChild.mockClear().mockReturnValue(childLog);
  databaseManager.getSQL.mockReset();
  databaseManager.getMongo.mockReset();
  databaseManager.getElastic.mockReset();
  existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(false);
  readdirSpy = vi.spyOn(fs, "readdirSync").mockReturnValue([]);
});
afterEach(() => {
  existsSpy.mockRestore();
  readdirSpy.mockRestore();
});

describe("ServiceRegistry > loadAll — dynamic services", () => {
  it("warns and returns early when services directory missing", () => {
    existsSpy.mockReturnValue(false);
    const reg = freshSut();
    reg.loadAll();
    expect(reg.size).toBe(0);
    expect(childLog.warn).toHaveBeenCalledWith(expect.stringContaining("Services directory not found"));
  });

  it("registers folders with a routes/ subdirectory; skips excluded names", () => {
    existsSpy.mockImplementation((p) => {
      if (p.endsWith("services")) return true;
      if (p.endsWith("networks")) return false;
      // routes/ existence check for each folder
      return p.includes("facebook") || p.includes("instagram");
    });
    readdirSpy.mockImplementation((p, opts) => {
      if (opts?.withFileTypes) {
        return [
          { name: "facebook", isDirectory: () => true },
          { name: "instagram", isDirectory: () => true },
          { name: "common", isDirectory: () => true },     // excluded
          { name: "networks", isDirectory: () => true },   // excluded
          { name: "noroutes", isDirectory: () => true },   // no routes/ → skipped
          { name: "file.js", isDirectory: () => false },   // file, not dir
        ];
      }
      return [];
    });
    const reg = freshSut();
    reg.loadAll();
    expect(reg.size).toBe(2);
    expect(reg.getService("facebook")).toBeTruthy();
    expect(reg.getService("instagram")).toBeTruthy();
    expect(reg.getService("common")).toBeNull();
    expect(reg.getService("noroutes")).toBeNull();
  });
});

describe("ServiceRegistry > loadAll — class-based services in networks/", () => {
  // Note: networks/ subdirectory doesn't exist in this repo, so the
  // class-based service loading block (lines 60-87) is dead in production.
  // The success branches require pre-resolving Node's require for files that
  // don't physically exist — which Node refuses to do.  We cover the
  // entry-skip path (existsSync false) instead, plus the require-throws path.

  it("skips class-based block when networks/ dir missing", () => {
    existsSpy.mockImplementation((p) => p.endsWith("services"));
    readdirSpy.mockImplementation(() => []);
    const reg = freshSut();
    reg.loadAll();
    expect(reg.size).toBe(0);
  });

  it("catches errors when loading a class service file (require throws ENOENT for missing file)", () => {
    const cfgPath = require.resolve("../../src/config/networks");
    require.cache[cfgPath] = {
      id: cfgPath, filename: cfgPath, loaded: true,
      exports: { broken: { enabled: true } },
    };
    existsSpy.mockImplementation((p) => p.endsWith("services") || p.endsWith("networks"));
    readdirSpy.mockImplementation((p, opts) => {
      if (opts?.withFileTypes) return [];
      if (p.endsWith("networks")) return ["BrokenService.js"];
      return [];
    });
    const reg = freshSut();
    reg.loadAll();
    expect(childLog.error).toHaveBeenCalledWith(expect.stringContaining("Failed to load class service"), expect.any(Object));
  });

  it("skips disabled or unknown networks (no require attempted)", () => {
    const cfgPath = require.resolve("../../src/config/networks");
    require.cache[cfgPath] = {
      id: cfgPath, filename: cfgPath, loaded: true,
      exports: { facebook: { enabled: false } /* instagram entirely absent → unknown */ },
    };
    existsSpy.mockImplementation((p) => p.endsWith("services") || p.endsWith("networks"));
    readdirSpy.mockImplementation((p, opts) => {
      if (opts?.withFileTypes) return [];
      if (p.endsWith("networks")) return ["FacebookService.js", "InstagramService.js"];
      return [];
    });
    const reg = freshSut();
    reg.loadAll();
    // Neither network had enabled=true, so no require attempted → no error log
    expect(childLog.error).not.toHaveBeenCalled();
  });
});

describe("ServiceRegistry > injectDatabases", () => {
  it("calls injectDatabases on legacy class instances and seeds dynamic service.db", () => {
    databaseManager.getSQL.mockReturnValue("sql");
    databaseManager.getMongo.mockReturnValue("mongo");
    databaseManager.getElastic.mockReturnValue("elastic");

    const reg = freshSut();
    const inject = vi.fn();
    reg.services.set("facebook", { name: "facebook", instance: { injectDatabases: inject } });
    reg.services.set("instagram", { name: "instagram" });

    reg.injectDatabases();
    expect(inject).toHaveBeenCalled();
    expect(reg.getService("facebook").db).toEqual({ sql: "sql", mongo: "mongo", elastic: "elastic" });
    expect(reg.getService("instagram").db).toEqual({ sql: "sql", mongo: "mongo", elastic: "elastic" });
  });

  it("skips legacy injectDatabases when not a function", () => {
    const reg = freshSut();
    reg.services.set("x", { name: "x", instance: { /* no injectDatabases */ } });
    reg.injectDatabases();
    expect(reg.getService("x").db).toBeDefined();
  });
});

describe("ServiceRegistry > registerRoutes", () => {
  function mkApp() { return { use: vi.fn() }; }

  it("mounts class-based router via instance.getRouter()", () => {
    const reg = freshSut();
    const fakeRouter = { id: "router" };
    reg.services.set("facebook", { name: "facebook", instance: { getRouter: () => fakeRouter } });
    const app = mkApp();
    reg.registerRoutes(app);
    expect(app.use).toHaveBeenCalledWith("/api/v1/facebook", fakeRouter);
  });

  // For dynamic route tests, pre-cache real absolute paths so Node's require can find them.
  // Node won't use require.cache for nonexistent files — it tries fs first.
  const realRoutesPath = require("node:path").resolve(__dirname.replace(/tests.*/, "src/services/facebook/routes"));
  const realRouteFile = "facebookRoutes.js";
  const realRouteAbs = require("node:path").join(realRoutesPath, realRouteFile);

  it("mounts dynamic routes — creator function pattern", () => {
    const router = { id: "router" };
    require.cache[realRouteAbs] = { id: realRouteAbs, filename: realRouteAbs, loaded: true,
      exports: { createFacebookRoutes: (svc) => router },
    };
    readdirSpy.mockImplementation(() => [realRouteFile, "ignore.txt"]);
    const reg = freshSut();
    reg.services.set("facebook", { name: "facebook", routesPath: realRoutesPath });
    const app = mkApp();
    reg.registerRoutes(app);
    expect(app.use).toHaveBeenCalledWith("/api/v1/facebook", router);
  });

  it("mounts dynamic routes — function default export", () => {
    const router = { id: "r" };
    const fn = (svc) => router;
    require.cache[realRouteAbs] = { id: realRouteAbs, filename: realRouteAbs, loaded: true, exports: fn };
    readdirSpy.mockImplementation(() => [realRouteFile]);
    const reg = freshSut();
    reg.services.set("instagram", { name: "instagram", routesPath: realRoutesPath });
    const app = mkApp();
    reg.registerRoutes(app);
    expect(app.use).toHaveBeenCalledWith("/api/v1/instagram", router);
  });

  it("mounts dynamic routes — Router instance default export", () => {
    const router = { stack: [] };
    require.cache[realRouteAbs] = { id: realRouteAbs, filename: realRouteAbs, loaded: true, exports: router };
    readdirSpy.mockImplementation(() => [realRouteFile]);
    const reg = freshSut();
    reg.services.set("google", { name: "google", routesPath: realRoutesPath });
    const app = mkApp();
    reg.registerRoutes(app);
    expect(app.use).toHaveBeenCalledWith("/api/v1/google", router);
  });

  it("logs error when dynamic require throws", () => {
    require.cache[realRouteAbs] = { id: realRouteAbs, filename: realRouteAbs, loaded: true,
      get exports() { throw new Error("rm-fail"); } };
    readdirSpy.mockImplementation(() => [realRouteFile]);
    const reg = freshSut();
    reg.services.set("quora", { name: "quora", routesPath: realRoutesPath });
    const app = mkApp();
    reg.registerRoutes(app);
    expect(childLog.error).toHaveBeenCalledWith(expect.stringContaining("Failed to mount"), expect.any(Object));
  });

  it("skips when router resolves to falsy", () => {
    require.cache[realRouteAbs] = { id: realRouteAbs, filename: realRouteAbs, loaded: true, exports: null };
    readdirSpy.mockImplementation(() => [realRouteFile]);
    const reg = freshSut();
    reg.services.set("native", { name: "native", routesPath: realRoutesPath });
    const app = mkApp();
    reg.registerRoutes(app);
    expect(app.use).not.toHaveBeenCalled();
  });

  it("router resolves to non-null falsy (e.g. empty string) → if(router) false branch (line 149)", () => {
    // routeModule = "" — empty string, not null. The property/typeof checks
    // fall through to `router = routeModule` (= ""), then `if (router)` is
    // falsy → no app.use. Exercises the false branch of line 149 cleanly.
    require.cache[realRouteAbs] = { id: realRouteAbs, filename: realRouteAbs, loaded: true, exports: "" };
    readdirSpy.mockImplementation(() => [realRouteFile]);
    const reg = freshSut();
    reg.services.set("tiktok", { name: "tiktok", routesPath: realRoutesPath });
    const app = mkApp();
    reg.registerRoutes(app);
    expect(app.use).not.toHaveBeenCalled();
    // Also verify no error was logged — the catch block did NOT fire,
    // proving the falsy router path was the one that ran.
    expect(childLog.error).not.toHaveBeenCalled();
  });

  it("services with neither instance nor routesPath are no-ops", () => {
    const reg = freshSut();
    reg.services.set("empty", { name: "empty" });
    const app = mkApp();
    reg.registerRoutes(app);
    expect(app.use).not.toHaveBeenCalled();
  });
});

describe("ServiceRegistry > getService + size", () => {
  it("getService returns null for unknown", () => {
    expect(freshSut().getService("missing")).toBeNull();
  });
  it("size reflects map", () => {
    const reg = freshSut();
    reg.services.set("a", {});
    expect(reg.size).toBe(1);
  });
});
