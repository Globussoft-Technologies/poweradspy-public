import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const redisPath = require.resolve("../../src/cache/RedisCache");
const fakeRedis = {
  connected: false,
  connect: vi.fn(async () => {}),
  disconnect: vi.fn(async () => {}),
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  flush: vi.fn(),
};
require.cache[redisPath] = {
  id: redisPath, filename: redisPath, loaded: true, exports: fakeRedis,
};

const localPath = require.resolve("../../src/cache/LocalCache");
const fakeLocal = {
  db: null,
  initialize: vi.fn(),
  close: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  flush: vi.fn(),
};
require.cache[localPath] = {
  id: localPath, filename: localPath, loaded: true, exports: fakeLocal,
};

const loggerPath = require.resolve("../../src/logger");
const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { createChild: () => fakeLogger },
};

let store;
beforeEach(() => {
  // Reset module so the singleton starts fresh
  const sutPath = require.resolve("../../src/cache/CacheStore");
  delete require.cache[sutPath];
  store = require("../../src/cache/CacheStore");
  fakeRedis.connected = false;
  fakeRedis.connect.mockReset().mockResolvedValue();
  fakeRedis.disconnect.mockReset().mockResolvedValue();
  fakeRedis.get.mockReset();
  fakeRedis.set.mockReset();
  fakeRedis.del.mockReset();
  fakeRedis.flush.mockReset();
  fakeLocal.initialize.mockReset();
  fakeLocal.close.mockReset();
  fakeLocal.get.mockReset();
  fakeLocal.set.mockReset();
  fakeLocal.del.mockReset();
  fakeLocal.flush.mockReset();
  fakeLocal.db = null;
  Object.values(fakeLogger).forEach((fn) => fn.mockClear && fn.mockClear());
});

describe("cache/CacheStore > initialize", () => {
  it("uses Redis when connection succeeds", async () => {
    fakeRedis.connect.mockImplementationOnce(async () => { fakeRedis.connected = true; });
    await store.initialize();
    expect(store.backend).toBe("redis");
    expect(fakeLocal.initialize).not.toHaveBeenCalled();
  });

  it("falls back to SQLite when Redis fails to connect", async () => {
    fakeRedis.connect.mockImplementationOnce(async () => { fakeRedis.connected = false; });
    await store.initialize();
    expect(store.backend).toBe("sqlite");
    expect(fakeLocal.initialize).toHaveBeenCalled();
    expect(fakeLogger.warn).toHaveBeenCalledWith(expect.stringContaining("SQLite"));
  });
});

describe("cache/CacheStore > get/set/del/flush", () => {
  beforeEach(() => {
    store.backend = "redis";
    fakeRedis.connected = true;
  });

  it("get: redis hit returns data", async () => {
    fakeRedis.get.mockResolvedValueOnce({ x: 1 });
    expect(await store.get("k")).toEqual({ x: 1 });
  });

  it("get: redis miss returns null when connected", async () => {
    fakeRedis.get.mockResolvedValueOnce(null);
    expect(await store.get("k")).toBeNull();
    expect(fakeLocal.get).not.toHaveBeenCalled();
  });

  it("get: redis returned null AND disconnected → falls back to localCache", async () => {
    fakeRedis.get.mockResolvedValueOnce(null);
    fakeRedis.connected = false;
    fakeLocal.get.mockResolvedValueOnce("local-val");
    expect(await store.get("k")).toBe("local-val");
    expect(fakeLogger.warn).toHaveBeenCalledWith("Redis disconnected during GET, trying SQLite");
  });

  it("get: sqlite backend → returns from localCache", async () => {
    store.backend = "sqlite";
    fakeLocal.get.mockResolvedValueOnce("v");
    expect(await store.get("k")).toBe("v");
  });

  it("get: unknown backend returns null", async () => {
    store.backend = "none";
    expect(await store.get("k")).toBeNull();
  });

  it("set: redis path", async () => {
    fakeRedis.set.mockResolvedValueOnce("OK");
    expect(await store.set("k", { v: 1 }, 60)).toBe("OK");
  });

  it("set: falls back to localCache when redis disconnected", async () => {
    fakeRedis.connected = false;
    fakeLocal.set.mockResolvedValueOnce(true);
    expect(await store.set("k", "v", 60)).toBe(true);
    expect(fakeRedis.set).not.toHaveBeenCalled();
  });

  it("set: sqlite backend → localCache", async () => {
    store.backend = "sqlite";
    await store.set("k", "v", 60);
    expect(fakeLocal.set).toHaveBeenCalled();
  });

  it("del: redis path", async () => {
    await store.del("k");
    expect(fakeRedis.del).toHaveBeenCalledWith("k");
  });

  it("del: falls back to local when redis disconnected", async () => {
    fakeRedis.connected = false;
    await store.del("k");
    expect(fakeLocal.del).toHaveBeenCalledWith("k");
  });

  it("flush: redis path", async () => {
    await store.flush("prefix:*");
    expect(fakeRedis.flush).toHaveBeenCalledWith("prefix:*");
  });

  it("flush: local fallback", async () => {
    fakeRedis.connected = false;
    await store.flush("prefix:*");
    expect(fakeLocal.flush).toHaveBeenCalled();
  });
});

describe("cache/CacheStore > buildKey + getHealth + disconnect", () => {
  it("buildKey concatenates network:namespace:id", () => {
    expect(store.buildKey("fb", "posts", "p1")).toBe("fb:posts:p1");
  });

  it("getHealth reports backend + redis.connected + sqlite.initialized (db null)", async () => {
    store.backend = "redis";
    fakeRedis.connected = true;
    fakeLocal.db = null;
    const h = await store.getHealth();
    expect(h).toEqual({
      backend: "redis",
      redis: { connected: true },
      sqlite: { initialized: false },
    });
  });

  it("getHealth: sqlite.initialized true when localCache.db set", async () => {
    fakeLocal.db = {};
    const h = await store.getHealth();
    expect(h.sqlite.initialized).toBe(true);
  });

  it("disconnect: closes redis + local", async () => {
    await store.disconnect();
    expect(fakeRedis.disconnect).toHaveBeenCalled();
    expect(fakeLocal.close).toHaveBeenCalled();
  });
});
