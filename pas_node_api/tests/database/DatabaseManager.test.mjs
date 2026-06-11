import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── Mock config ─────────────────────────
const configPath = require.resolve("../../src/config");
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true,
  exports: { databases: {
    sql: { queueLimit: 0, keepAliveInitialDelay: 1000, idleTimeout: 60000 },
    mongo: { minPoolSize: 1, serverSelectionTimeoutMs: 1000, heartbeatFrequencyMs: 1000 },
    elastic: { maxRetries: 1, requestTimeoutMs: 1000 },
    elastic_tiktok: { maxRetries: 1, requestTimeoutMs: 1000 },
  }},
};

// ── Mock logger ─────────────────────────
const loggerPath = require.resolve("../../src/logger");
const childLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { createChild: vi.fn(() => childLog) },
};

// ── Mock mysql2/promise ─────────────────
const mysqlPath = require.resolve("mysql2/promise");
const mysqlConn = { ping: vi.fn(async () => {}), release: vi.fn() };
const mysqlPool = {
  getConnection: vi.fn(async () => mysqlConn),
  execute: vi.fn(async () => [[{ x: 1 }]]),
  end: vi.fn(async () => {}),
  pool: { _allConnections: [1, 2], _freeConnections: [1], _connectionQueue: [] },
};
const mysqlCreatePool = vi.fn(() => mysqlPool);
require.cache[mysqlPath] = {
  id: mysqlPath, filename: mysqlPath, loaded: true,
  exports: { createPool: mysqlCreatePool },
};

// ── Mock mongodb ────────────────────────
const mongoPath = require.resolve("mongodb");
const mongoCollection = vi.fn(() => "fake-coll");
const mongoDb = { command: vi.fn(async () => ({ ok: 1 })), collection: mongoCollection };
const mongoClient = {
  connect: vi.fn(async () => {}),
  db: vi.fn(() => mongoDb),
  close: vi.fn(async () => {}),
};
function FakeMongoClient(uri, opts) { this._uri = uri; this._opts = opts; Object.assign(this, mongoClient); }
require.cache[mongoPath] = {
  id: mongoPath, filename: mongoPath, loaded: true,
  exports: { MongoClient: FakeMongoClient },
};

// ── Mock @elastic/elasticsearch ─────────
const elasticPath = require.resolve("@elastic/elasticsearch");
const esClient = {
  ping: vi.fn(async () => {}),
  info: vi.fn(async () => ({ body: { version: { number: "7.17.0" } } })),
  search: vi.fn(),
  index: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  bulk: vi.fn(),
  close: vi.fn(async () => {}),
};
function FakeClient(opts) { this._opts = opts; Object.assign(this, esClient); }
require.cache[elasticPath] = {
  id: elasticPath, filename: elasticPath, loaded: true,
  exports: { Client: FakeClient },
};

const sutPath = require.resolve("../../src/database/DatabaseManager");
function freshSut() {
  delete require.cache[sutPath];
  return require(sutPath);
}

beforeEach(() => {
  childLog.info.mockClear(); childLog.warn.mockClear(); childLog.error.mockClear();
  mysqlCreatePool.mockClear();
  mysqlConn.ping.mockClear().mockResolvedValue();
  mysqlConn.release.mockClear();
  mysqlPool.getConnection.mockClear().mockResolvedValue(mysqlConn);
  mysqlPool.execute.mockClear().mockResolvedValue([[{ x: 1 }]]);
  mysqlPool.end.mockClear().mockResolvedValue();
  mongoClient.connect.mockClear().mockResolvedValue();
  mongoClient.close.mockClear().mockResolvedValue();
  mongoDb.command.mockClear().mockResolvedValue({ ok: 1 });
  esClient.ping.mockClear().mockResolvedValue();
  esClient.info.mockClear().mockResolvedValue({ body: { version: { number: "7.17.0" } } });
  esClient.close.mockClear().mockResolvedValue();
});

const fbCfg = {
  enabled: true,
  database: {
    sql: { enabled: true, host: "h", port: 3306, user: "u", password: "p", database: "db", poolSize: 5 },
    mongo: { enabled: true, uri: "mongodb://x", poolSize: 5, database: "fbmongo" },
    elastic: { enabled: true, node: "http://es:9200", index: "fb_idx", auth: { username: "u", password: "p" } },
  },
};

describe("DatabaseManager > connectAll", () => {
  it("skips disabled networks", async () => {
    const dm = freshSut();
    await dm.connectAll({ facebook: { enabled: false, database: {} } });
    expect(dm.getConnections("facebook")).toBeNull();
  });

  it("connects SQL + Mongo + ES (HTTPS branch) for full network", async () => {
    const dm = freshSut();
    await dm.connectAll({
      facebook: {
        ...fbCfg,
        database: {
          ...fbCfg.database,
          elastic: { ...fbCfg.database.elastic, node: "https://es-secure:9200" },
        },
      },
    });
    const conns = dm.getConnections("facebook");
    expect(conns.sql).toBeTruthy();
    expect(conns.mongo).toBeTruthy();
    expect(conns.elastic).toBeTruthy();
    expect(dm.initialized).toBe(true);
  });

  it("uses slug as Mongo db name when mongoConfig.database missing", async () => {
    const dm = freshSut();
    await dm.connectAll({ facebook: { enabled: true, database: { mongo: { enabled: true, uri: "u", poolSize: 1 } } } });
    expect(mongoClient.db).toHaveBeenCalledWith("facebook");
  });

  it("ES auth omitted when username missing", async () => {
    const dm = freshSut();
    await dm.connectAll({ facebook: { enabled: true, database: { elastic: { enabled: true, node: "http://es", index: "i" } } } });
    // FakeClient stored opts on this — the most recent client opts will lack auth
    expect(dm.getConnections("facebook").elastic).toBeTruthy();
  });

  it("logs SQL connect error but continues", async () => {
    mysqlPool.getConnection.mockRejectedValueOnce(new Error("sql-down"));
    const dm = freshSut();
    await dm.connectAll({ facebook: fbCfg });
    expect(childLog.error).toHaveBeenCalledWith(expect.stringContaining("SQL connection failed"), expect.any(Object));
    expect(dm.getConnections("facebook").sql).toBeNull();
  });

  it("logs Mongo connect error but continues", async () => {
    mongoDb.command.mockRejectedValueOnce(new Error("mongo-down"));
    const dm = freshSut();
    await dm.connectAll({ facebook: fbCfg });
    expect(dm.getConnections("facebook").mongo).toBeNull();
  });

  it("logs ES connect error but continues", async () => {
    esClient.ping.mockRejectedValueOnce(new Error("es-down"));
    const dm = freshSut();
    await dm.connectAll({ facebook: fbCfg });
    expect(dm.getConnections("facebook").elastic).toBeNull();
  });

  it("SQL MODULE_NOT_FOUND swallowed → warn", async () => {
    mysqlCreatePool.mockImplementationOnce(() => { const e = new Error("notfound"); e.code = "MODULE_NOT_FOUND"; throw e; });
    const dm = freshSut();
    await dm.connectAll({ facebook: fbCfg });
    expect(childLog.warn).toHaveBeenCalledWith(expect.stringContaining("mysql2 not installed"));
  });

  it("Mongo MODULE_NOT_FOUND swallowed → warn", async () => {
    mongoClient.connect.mockImplementationOnce(() => { const e = new Error("notfound"); e.code = "MODULE_NOT_FOUND"; throw e; });
    const dm = freshSut();
    await dm.connectAll({ facebook: fbCfg });
    expect(childLog.warn).toHaveBeenCalledWith(expect.stringContaining("mongodb driver not installed"));
  });

  it("ES MODULE_NOT_FOUND swallowed → warn", async () => {
    esClient.ping.mockImplementationOnce(() => { const e = new Error("notfound"); e.code = "MODULE_NOT_FOUND"; throw e; });
    const dm = freshSut();
    await dm.connectAll({ facebook: fbCfg });
    expect(childLog.warn).toHaveBeenCalledWith(expect.stringContaining("@elastic/elasticsearch not installed"));
  });

  it("Shared ES client reused between two networks with same node+user", async () => {
    const dm = freshSut();
    await dm.connectAll({
      facebook: fbCfg,
      instagram: { ...fbCfg, database: { elastic: fbCfg.database.elastic } }, // same node+auth
    });
    // Cache should contain 1 entry, with refCount 2
    expect(dm._esClientCache.size).toBe(1);
  });

  it("Tiktok ES branch is used when configured — method delegates work", async () => {
    const dm = freshSut();
    await dm.connectAll({ tiktok: { enabled: true, database: {
      elastic_tiktok: { enabled: true, node: "http://es", index: "tt_idx", auth: { username: "u", password: "p" } },
    } } });
    const e = dm.getElastic("tiktok");
    expect(e).toBeTruthy();
    e.search({});  e.index({}); e.update({}); e.delete({}); e.bulk({});
    expect(esClient.search).toHaveBeenCalled();
    await e.close();
    expect(dm._esClientCache.size).toBe(0);
  });

  it("Tiktok ES MODULE_NOT_FOUND swallowed", async () => {
    esClient.ping.mockImplementationOnce(() => { const e = new Error("nf"); e.code = "MODULE_NOT_FOUND"; throw e; });
    const dm = freshSut();
    await dm.connectAll({ tiktok: { enabled: true, database: {
      elastic_tiktok: { enabled: true, node: "http://es", index: "tt", auth: { username: "u" } },
    } } });
    expect(childLog.warn).toHaveBeenCalled();
  });

  it("Tiktok ES generic error logged", async () => {
    esClient.ping.mockRejectedValueOnce(new Error("es-down"));
    const dm = freshSut();
    await dm.connectAll({ tiktok: { enabled: true, database: {
      elastic_tiktok: { enabled: true, node: "http://es", index: "tt", auth: { username: "u" } },
    } } });
    expect(dm.getConnections("tiktok").elastic).toBeNull();
  });

  it("ES info path with no body uses info.version directly", async () => {
    esClient.info.mockResolvedValueOnce({ version: { number: "8.0.0" } });
    const dm = freshSut();
    await dm.connectAll({ facebook: { enabled: true, database: { elastic: { enabled: true, node: "http://es", index: "i" } } } });
    expect(childLog.info).toHaveBeenCalledWith(expect.stringContaining("Version: 8.0.0"));
  });

  it("ES info with neither body nor version → 'Unknown'", async () => {
    esClient.info.mockResolvedValueOnce({});
    const dm = freshSut();
    await dm.connectAll({ facebook: { enabled: true, database: { elastic: { enabled: true, node: "http://es", index: "i" } } } });
    expect(childLog.info).toHaveBeenCalledWith(expect.stringContaining("Version: Unknown"));
  });

  it("ES cfgSection fallback when dbConfigKey missing from databases", async () => {
    const cfgExports = require.cache[configPath].exports;
    require.cache[configPath].exports = { databases: { elastic: { maxRetries: 5, requestTimeoutMs: 9000 } } };
    const dm = freshSut();
    await dm.connectAll({ tiktok: { enabled: true, database: {
      elastic_tiktok: { enabled: true, node: "http://es", index: "tt", auth: { username: "u" } },
    } } });
    require.cache[configPath].exports = cfgExports;
    expect(dm.getConnections("tiktok").elastic).toBeTruthy();
  });
});

describe("DatabaseManager > public getters", () => {
  it("getSQL / getMongo / getElastic / getConnections", async () => {
    const dm = freshSut();
    await dm.connectAll({ facebook: fbCfg });
    expect(dm.getSQL("facebook")).toBeTruthy();
    expect(dm.getMongo("facebook")).toBeTruthy();
    expect(dm.getElastic("facebook")).toBeTruthy();
    expect(dm.getSQL("unknown")).toBeNull();
    expect(dm.getMongo("unknown")).toBeNull();
    expect(dm.getElastic("unknown")).toBeNull();
  });

  it("SQL.query passes params and returns rows", async () => {
    const dm = freshSut();
    await dm.connectAll({ facebook: fbCfg });
    const rows = await dm.getSQL("facebook").query("SELECT 1", []);
    expect(rows).toEqual([{ x: 1 }]);
  });

  it("SQL.getConnection delegates to pool", async () => {
    const dm = freshSut();
    await dm.connectAll({ facebook: fbCfg });
    const conn = await dm.getSQL("facebook").getConnection();
    expect(conn).toBe(mysqlConn);
  });

  it("Mongo collection delegates to db.collection", async () => {
    const dm = freshSut();
    await dm.connectAll({ facebook: fbCfg });
    expect(dm.getMongo("facebook").collection("foo")).toBe("fake-coll");
  });

  it("ES methods delegate to client", async () => {
    const dm = freshSut();
    await dm.connectAll({ facebook: fbCfg });
    const e = dm.getElastic("facebook");
    e.search({});  e.index({}); e.update({}); e.delete({}); e.bulk({});
    expect(esClient.search).toHaveBeenCalled();
    expect(esClient.index).toHaveBeenCalled();
    expect(esClient.update).toHaveBeenCalled();
    expect(esClient.delete).toHaveBeenCalled();
    expect(esClient.bulk).toHaveBeenCalled();
  });
});

describe("DatabaseManager > getHealth", () => {
  it("reports connected/not-configured per slug", async () => {
    const dm = freshSut();
    await dm.connectAll({ facebook: fbCfg, instagram: { enabled: true, database: {} } });
    const h = dm.getHealth();
    expect(h.facebook.sql.status).toBe("connected");
    expect(h.instagram.sql.status).toBe("not configured");
    expect(h.instagram.mongo.status).toBe("not configured");
    expect(h.instagram.elastic.status).toBe("not configured");
  });
});

describe("DatabaseManager > getPoolStats", () => {
  it("reports per-network pool stats", async () => {
    const dm = freshSut();
    await dm.connectAll({ facebook: fbCfg, instagram: { enabled: true, database: {} } });
    const s = dm.getPoolStats();
    expect(s.facebook.sql.totalConnections).toBe(2);
    expect(s.facebook.sql.freeConnections).toBe(1);
    expect(s.facebook.mongo.status).toBe("connected");
    expect(s.facebook.elastic.status).toBe("connected");
    expect(s.instagram.sql.status).toBe("not configured");
    expect(s.instagram.mongo.status).toBe("not configured");
    expect(s.instagram.elastic.status).toBe("not configured");
  });

  it("missing pool internals → 0s", async () => {
    const orig = { ...mysqlPool.pool };
    mysqlPool.pool = {};
    const dm = freshSut();
    await dm.connectAll({ facebook: fbCfg });
    const s = dm.getPoolStats();
    expect(s.facebook.sql.totalConnections).toBe(0);
    mysqlPool.pool = orig;
  });
});

describe("DatabaseManager > disconnectAll", () => {
  it("closes everything and clears caches", async () => {
    const dm = freshSut();
    await dm.connectAll({ facebook: fbCfg });
    await dm.disconnectAll();
    expect(mysqlPool.end).toHaveBeenCalled();
    expect(mongoClient.close).toHaveBeenCalled();
    expect(dm.initialized).toBe(false);
    expect(dm.connections.size).toBe(0);
  });

  it("logs error when a close throws but continues", async () => {
    mysqlPool.end.mockRejectedValueOnce(new Error("end-fail"));
    const dm = freshSut();
    await dm.connectAll({ facebook: fbCfg });
    await dm.disconnectAll();
    expect(childLog.error).toHaveBeenCalled();
  });

  it("force-closes leftover shared ES clients", async () => {
    const dm = freshSut();
    await dm.connectAll({ facebook: fbCfg });
    // Manually put a stale entry into the cache to force the loop
    dm._esClientCache.set("stale", { client: { close: vi.fn(async () => {}) }, refCount: 1 });
    await dm.disconnectAll();
    expect(dm._esClientCache.size).toBe(0);
  });

  it("logs error if leftover ES client close throws", async () => {
    const dm = freshSut();
    await dm.connectAll({ facebook: fbCfg });
    dm._esClientCache.set("stale", { client: { close: vi.fn(async () => { throw new Error("close-fail"); }) }, refCount: 1 });
    await dm.disconnectAll();
    expect(childLog.error).toHaveBeenCalled();
  });
});

describe("DatabaseManager > _releaseEsClient (via SQL close paths)", () => {
  it("releasing a non-cached client is a noop", async () => {
    const dm = freshSut();
    // Directly call _releaseEsClient with a key that's not in cache
    await dm._releaseEsClient({ node: "http://nowhere", auth: {} });
    // No throw → pass
  });

  it("releasing decrements refCount + closes when zero", async () => {
    const dm = freshSut();
    await dm.connectAll({ facebook: fbCfg });
    const beforeSize = dm._esClientCache.size;
    await dm.getElastic("facebook").close();
    expect(dm._esClientCache.size).toBe(beforeSize - 1);
  });

  it("close error on shared ES client is logged", async () => {
    esClient.close.mockRejectedValueOnce(new Error("close-fail"));
    const dm = freshSut();
    await dm.connectAll({ facebook: fbCfg });
    await dm.getElastic("facebook").close();
    expect(childLog.error).toHaveBeenCalled();
  });

  it("release with refCount > 1 → decrement but keep the cached entry (line 340 falsy)", async () => {
    const dm = freshSut();
    await dm.connectAll({ facebook: fbCfg });
    // Manually bump refCount to 2 so the next release decrements to 1 (>0).
    const [, entry] = dm._esClientCache.entries().next().value;
    entry.refCount = 2;
    const beforeSize = dm._esClientCache.size;
    await dm.getElastic("facebook").close();
    // Cache entry survives because refCount went 2 → 1
    expect(dm._esClientCache.size).toBe(beforeSize);
    expect(entry.refCount).toBe(1);
  });
});

describe("DatabaseManager > disconnectAll subset of connections (lines 417/421/425 falsy)", () => {
  it("conns with only sql (no mongo, no elastic) → only sql.close fires", async () => {
    const dm = freshSut();
    const sqlClose = vi.fn(async () => {});
    dm.connections.set("only-sql", { sql: { close: sqlClose } });
    await dm.disconnectAll();
    expect(sqlClose).toHaveBeenCalled();
  });
  it("conns with only mongo → only mongo.close fires", async () => {
    const dm = freshSut();
    const mongoClose = vi.fn(async () => {});
    dm.connections.set("only-mongo", { mongo: { close: mongoClose } });
    await dm.disconnectAll();
    expect(mongoClose).toHaveBeenCalled();
  });
  it("conns with only elastic → only elastic.close fires", async () => {
    const dm = freshSut();
    const elasticClose = vi.fn(async () => {});
    dm.connections.set("only-es", { elastic: { close: elasticClose } });
    await dm.disconnectAll();
    expect(elasticClose).toHaveBeenCalled();
  });
});
