import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── Mock better-sqlite3 (new-invoked constructor) ──────────────
const sqlitePath = require.resolve("better-sqlite3");
const stmtRun = vi.fn();
const stmtGet = vi.fn();
const dbPragma = vi.fn();
const dbClose = vi.fn();
const dbPrepare = vi.fn(() => ({ run: stmtRun, get: stmtGet }));
let throwOnCtor = false;
function FakeDatabase(path) {
  if (throwOnCtor) throw new Error("db-init-fail");
  this.pragma = dbPragma;
  this.prepare = dbPrepare;
  this.close = dbClose;
  this._path = path;
}
require.cache[sqlitePath] = {
  id: sqlitePath, filename: sqlitePath, loaded: true, exports: FakeDatabase,
};

// ── Mock logger ──────────────
const loggerPath = require.resolve("../../src/logger");
const childLog = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { createChild: vi.fn(() => childLog) },
};

// ── Mock config ──────────────
const configPath = require.resolve("../../src/config");
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true,
  exports: { localCache: { dir: "test-cache", cleanupIntervalMs: 1234 } },
};

// ── Spy fs ──────────────
import fs from "node:fs";
const existsSpy = vi.spyOn(fs, "existsSync");
const mkdirSpy = vi.spyOn(fs, "mkdirSync");

// SUT loader (singleton; freshen cache each describe block)
const sutPath = require.resolve("../../src/cache/LocalCache");
function freshSut() {
  delete require.cache[sutPath];
  return require(sutPath);
}

beforeEach(() => {
  throwOnCtor = false;
  stmtRun.mockReset();
  stmtGet.mockReset();
  dbPragma.mockReset();
  dbClose.mockReset();
  dbPrepare.mockClear();
  childLog.info.mockClear();
  childLog.error.mockClear();
  existsSpy.mockReset().mockReturnValue(true);
  mkdirSpy.mockReset();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("cache/LocalCache > module load + initialize", () => {
  it("constructor sets cacheDir from config", () => {
    const cache = freshSut();
    expect(cache.cacheDir).toContain("test-cache");
    expect(cache.db).toBeNull();
  });

  it("initialize creates dir when missing, sets pragmas, creates table+index", () => {
    existsSpy.mockReturnValue(false);
    const cache = freshSut();
    cache.initialize();
    expect(mkdirSpy).toHaveBeenCalledWith(cache.cacheDir, { recursive: true });
    expect(dbPragma).toHaveBeenCalledWith("journal_mode = WAL");
    expect(dbPragma).toHaveBeenCalledWith("synchronous = NORMAL");
    expect(dbPrepare).toHaveBeenCalled();
    expect(childLog.info).toHaveBeenCalled();
  });

  it("initialize skips mkdir when dir exists", () => {
    existsSpy.mockReturnValue(true);
    const cache = freshSut();
    cache.initialize();
    expect(mkdirSpy).not.toHaveBeenCalled();
  });

  it("initialize uses WORKER_ID env for db filename", () => {
    existsSpy.mockReturnValue(true);
    process.env.WORKER_ID = "7";
    const cache = freshSut();
    cache.initialize();
    expect(cache.db._path).toContain("cache_w7.db");
    delete process.env.WORKER_ID;
  });

  it("initialize defaults WORKER_ID to '1'", () => {
    existsSpy.mockReturnValue(true);
    delete process.env.WORKER_ID;
    const cache = freshSut();
    cache.initialize();
    expect(cache.db._path).toContain("cache_w1.db");
  });

  it("initialize error caught and logged", () => {
    throwOnCtor = true;
    const cache = freshSut();
    cache.initialize();
    expect(childLog.error).toHaveBeenCalledWith("Failed to initialize local cache", expect.any(Object));
  });
});

describe("cache/LocalCache > get", () => {
  it("returns null when db not initialized", () => {
    const cache = freshSut();
    expect(cache.get("k")).toBeNull();
  });
  it("returns parsed JSON when row found", () => {
    const cache = freshSut();
    cache.initialize();
    stmtGet.mockReturnValue({ value: '{"x":1}' });
    expect(cache.get("k")).toEqual({ x: 1 });
  });
  it("returns null when row not found", () => {
    const cache = freshSut();
    cache.initialize();
    stmtGet.mockReturnValue(undefined);
    expect(cache.get("k")).toBeNull();
  });
  it("returns null + logs on error", () => {
    const cache = freshSut();
    cache.initialize();
    stmtGet.mockImplementation(() => { throw new Error("get-fail"); });
    expect(cache.get("k")).toBeNull();
    expect(childLog.error).toHaveBeenCalledWith("LocalCache GET error", expect.any(Object));
  });
});

describe("cache/LocalCache > set", () => {
  it("returns false when db not initialized", () => {
    const cache = freshSut();
    expect(cache.set("k", 1, 60)).toBe(false);
  });
  it("returns true on successful insert with ttl", () => {
    const cache = freshSut();
    cache.initialize();
    expect(cache.set("k", { x: 1 }, 60)).toBe(true);
    expect(stmtRun).toHaveBeenCalled();
  });
  it("set without ttl → expires_at null", () => {
    const cache = freshSut();
    cache.initialize();
    cache.set("k", 1);
    const args = stmtRun.mock.calls.at(-1);
    expect(args[2]).toBeNull();
  });
  it("returns false + logs on error", () => {
    const cache = freshSut();
    cache.initialize();
    stmtRun.mockImplementation(() => { throw new Error("set-fail"); });
    expect(cache.set("k", 1, 60)).toBe(false);
    expect(childLog.error).toHaveBeenCalledWith("LocalCache SET error", expect.any(Object));
  });
});

describe("cache/LocalCache > del", () => {
  it("returns false when db not initialized", () => {
    const cache = freshSut();
    expect(cache.del("k")).toBe(false);
  });
  it("returns true on success", () => {
    const cache = freshSut();
    cache.initialize();
    expect(cache.del("k")).toBe(true);
  });
  it("returns false + logs on error", () => {
    const cache = freshSut();
    cache.initialize();
    stmtRun.mockImplementation(() => { throw new Error("del-fail"); });
    expect(cache.del("k")).toBe(false);
    expect(childLog.error).toHaveBeenCalledWith("LocalCache DEL error", expect.any(Object));
  });
});

describe("cache/LocalCache > flush", () => {
  it("returns false when db not initialized", () => {
    const cache = freshSut();
    expect(cache.flush("*")).toBe(false);
  });
  it("flushes with LIKE pattern when '*' present", () => {
    const cache = freshSut();
    cache.initialize();
    expect(cache.flush("user:*")).toBe(true);
    expect(dbPrepare).toHaveBeenCalledWith("DELETE FROM cache WHERE key LIKE ?");
  });
  it("flushes all when no '*' in pattern", () => {
    const cache = freshSut();
    cache.initialize();
    expect(cache.flush("user")).toBe(true);
    expect(dbPrepare).toHaveBeenCalledWith("DELETE FROM cache");
  });
  it("returns false + logs on error", () => {
    const cache = freshSut();
    cache.initialize();
    stmtRun.mockImplementation(() => { throw new Error("flush-fail"); });
    expect(cache.flush("*")).toBe(false);
    expect(childLog.error).toHaveBeenCalledWith("LocalCache FLUSH error", expect.any(Object));
  });
});

describe("cache/LocalCache > _startCleanup (setInterval)", () => {
  it("runs cleanup query on each interval tick", () => {
    const cache = freshSut();
    cache.initialize();
    stmtRun.mockClear();
    vi.advanceTimersByTime(1234);
    expect(stmtRun).toHaveBeenCalled();
  });
  it("cleanup error caught and logged", () => {
    const cache = freshSut();
    cache.initialize();
    stmtRun.mockImplementation(() => { throw new Error("cleanup-fail"); });
    vi.advanceTimersByTime(1234);
    expect(childLog.error).toHaveBeenCalledWith("LocalCache cleanup error", expect.any(Object));
  });
});

describe("cache/LocalCache > close", () => {
  it("noop when db not initialized", () => {
    const cache = freshSut();
    cache.close();
    expect(dbClose).not.toHaveBeenCalled();
  });
  it("closes db and nulls reference", () => {
    const cache = freshSut();
    cache.initialize();
    cache.close();
    expect(dbClose).toHaveBeenCalled();
    expect(cache.db).toBeNull();
  });
});

describe("cache/LocalCache > config defaults", () => {
  it("falls back to 'data' when no config.localCache.dir", () => {
    const orig = require.cache[configPath].exports;
    require.cache[configPath].exports = {};
    const cache = freshSut();
    expect(cache.cacheDir).toContain("data");
    require.cache[configPath].exports = orig;
  });
  it("uses default 60000ms cleanup when no config.localCache.cleanupIntervalMs", () => {
    const orig = require.cache[configPath].exports;
    require.cache[configPath].exports = {};
    const cache = freshSut();
    cache.initialize();
    stmtRun.mockClear();
    vi.advanceTimersByTime(60000);
    expect(stmtRun).toHaveBeenCalled();
    require.cache[configPath].exports = orig;
  });
});
