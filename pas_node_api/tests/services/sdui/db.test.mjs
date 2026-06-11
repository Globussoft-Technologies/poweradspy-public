import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Mock mongodb's MongoClient — must be a constructor (called with `new`),
// so use `vi.fn(function(...) {...})` NOT arrow.
const mongoPath = require.resolve("mongodb");
const clientInstances = [];
const MongoClientCtor = vi.fn(function (uri, opts) {
  this.uri = uri;
  this.opts = opts;
  this.connect = vi.fn(async () => true);
  this.close = vi.fn(async () => true);
  const dbInstance = {
    command: vi.fn(async () => ({ ok: 1 })),
    _name: null,
  };
  this.db = vi.fn((name) => { dbInstance._name = name; return dbInstance; });
  this._dbInstance = dbInstance;
  clientInstances.push(this);
});
require.cache[mongoPath] = {
  id: mongoPath, filename: mongoPath, loaded: true,
  exports: { MongoClient: MongoClientCtor },
};

// Mock config
const configPath = require.resolve("../../../src/config");
const fakeConfig = {
  databases: {
    mongo: { uri: "mongodb://test/", poolSize: 5, database: "pas_ui" },
  },
};
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true,
  exports: fakeConfig,
};

// Mock logger
const loggerPath = require.resolve("../../../src/logger");
const fakeLogger = { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() };
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { createChild: () => fakeLogger },
};

let mod;
beforeEach(() => {
  // Reset module cache so the SUT's `db`/`client` module-level vars start null
  const sutPath = require.resolve("../../../src/services/sdui/db");
  delete require.cache[sutPath];
  mod = require("../../../src/services/sdui/db");
  MongoClientCtor.mockClear();
  clientInstances.length = 0;
  fakeLogger.info.mockClear();
  fakeLogger.error.mockClear();
});

describe("services/sdui/db", () => {
  it("getDB: connects, pings, returns db; second call returns cached", async () => {
    const db = await mod.getDB();
    expect(db).toBeDefined();
    expect(MongoClientCtor).toHaveBeenCalledTimes(1);
    expect(MongoClientCtor.mock.calls[0][0]).toBe("mongodb://test/");
    expect(MongoClientCtor.mock.calls[0][1].maxPoolSize).toBe(5);
    expect(clientInstances[0].connect).toHaveBeenCalled();
    expect(clientInstances[0]._dbInstance.command).toHaveBeenCalledWith({ ping: 1 });
    expect(fakeLogger.info).toHaveBeenCalledWith(expect.stringContaining("pas_ui"));
    // Second call → cached
    const db2 = await mod.getDB();
    expect(db2).toBe(db);
    expect(MongoClientCtor).toHaveBeenCalledTimes(1);
  });

  it("getDB: falls back to default URI when config.databases.mongo missing (line 20 || branch)", async () => {
    const orig = fakeConfig.databases;
    fakeConfig.databases = {};
    try {
      // Re-import to pick up the changed config (module-level destructuring)
      const sutPath = require.resolve("../../../src/services/sdui/db");
      delete require.cache[sutPath];
      const freshMod = require("../../../src/services/sdui/db");
      try {
        await freshMod.getDB();
      } catch (_) {
        // db.command may fail since database is undefined; we only care the
        // URI fallback was used.
      }
      expect(MongoClientCtor.mock.calls.at(-1)[0]).toBe("mongodb://localhost:27017/");
    } finally {
      fakeConfig.databases = orig;
    }
  });

  it("getDB: connect throws → logs error and rethrows", async () => {
    MongoClientCtor.mockImplementationOnce(function () {
      this.connect = vi.fn(async () => { throw new Error("conn-fail"); });
      this.close = vi.fn();
      this.db = vi.fn();
      clientInstances.push(this);
    });
    await expect(mod.getDB()).rejects.toThrow("conn-fail");
    expect(fakeLogger.error).toHaveBeenCalledWith(
      "SDUI MongoDB connection failed",
      { error: "conn-fail" }
    );
  });

  it("closeDB: closes client and resets state", async () => {
    await mod.getDB();
    await mod.closeDB();
    expect(clientInstances[0].close).toHaveBeenCalled();
    expect(fakeLogger.info).toHaveBeenCalledWith("SDUI MongoDB connection closed");
    // After close, next getDB should create a NEW client
    await mod.getDB();
    expect(clientInstances.length).toBe(2);
  });

  it("closeDB: no-op when client was never created (line 42 false branch)", async () => {
    await mod.closeDB();
    expect(fakeLogger.info).not.toHaveBeenCalledWith("SDUI MongoDB connection closed");
  });
});
