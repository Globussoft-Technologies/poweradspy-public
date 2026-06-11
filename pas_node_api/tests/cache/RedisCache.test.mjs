import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── Mock ioredis (new-invoked) ──────────────
const redisPath = require.resolve("ioredis");
let lastClient;
function FakeRedis(opts) {
  lastClient = this;
  this._opts = opts;
  this._listeners = {};
  this._onceListeners = {};
  this.on = vi.fn((event, cb) => { this._listeners[event] = cb; return this; });
  this.once = vi.fn((event, cb) => { this._onceListeners[event] = cb; return this; });
  this.get = vi.fn();
  this.set = vi.fn();
  this.del = vi.fn();
  this.keys = vi.fn();
  this.quit = vi.fn(async () => {});
}
require.cache[redisPath] = {
  id: redisPath, filename: redisPath, loaded: true, exports: FakeRedis,
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
  exports: { redis: {
    host: "h", port: 6379, password: "p", db: 0,
    retryDelayBase: 50, retryDelayMax: 2000,
    maxRetriesPerRequest: 3, connectTimeoutMs: 100,
  }},
};

const sutPath = require.resolve("../../src/cache/RedisCache");
function freshSut() {
  delete require.cache[sutPath];
  return require(sutPath);
}

beforeEach(() => {
  lastClient = undefined;
  childLog.info.mockClear();
  childLog.error.mockClear();
  childLog.warn.mockClear();
});

describe("cache/RedisCache > connect", () => {
  it("ready event resolves and connect emits → connected=true", async () => {
    const cache = freshSut();
    const p = cache.connect();
    // Fire ready, then connect listener
    lastClient._onceListeners.ready();
    lastClient._listeners.connect();
    await p;
    expect(cache.connected).toBe(true);
    expect(childLog.info).toHaveBeenCalledWith("Redis connected");
  });

  it("once-error resolves but leaves connected=false", async () => {
    const cache = freshSut();
    const p = cache.connect();
    lastClient._onceListeners.error(new Error("conn-fail"));
    await p;
    expect(cache.connected).toBe(false);
  });

  it("error listener sets connected=false and logs", async () => {
    const cache = freshSut();
    const p = cache.connect();
    lastClient._onceListeners.ready();
    lastClient._listeners.connect();
    lastClient._listeners.error(new Error("post-conn-err"));
    await p;
    expect(cache.connected).toBe(false);
    expect(childLog.error).toHaveBeenCalledWith("Redis error", { error: "post-conn-err" });
  });

  it("connect timeout resolves with warn", async () => {
    vi.useFakeTimers();
    const cache = freshSut();
    const p = cache.connect();
    vi.advanceTimersByTime(100);
    await p;
    expect(childLog.warn).toHaveBeenCalledWith("Redis connection timeout");
    vi.useRealTimers();
  });

  it("retryStrategy returns clamped delay", async () => {
    const cache = freshSut();
    const p = cache.connect();
    lastClient._onceListeners.ready();
    await p;
    const fn = lastClient._opts.retryStrategy;
    expect(fn(1)).toBe(50);
    expect(fn(100)).toBe(2000); // clamped
  });

  it("noop when already connected (returns early)", async () => {
    const cache = freshSut();
    const p1 = cache.connect();
    lastClient._onceListeners.ready();
    await p1;
    const firstClient = cache.client;
    await cache.connect();
    expect(cache.client).toBe(firstClient);
  });

  it("constructor throw caught → logger.error + connected=false", async () => {
    // Swap the redis ctor temporarily
    const orig = require.cache[redisPath].exports;
    require.cache[redisPath].exports = function () { throw new Error("ctor-fail"); };
    const cache = freshSut();
    await cache.connect();
    expect(cache.connected).toBe(false);
    expect(childLog.error).toHaveBeenCalledWith("Failed to initialize Redis client", { error: "ctor-fail" });
    require.cache[redisPath].exports = orig;
  });
});

describe("cache/RedisCache > get", () => {
  it("returns null when not connected", async () => {
    const cache = freshSut();
    expect(await cache.get("k")).toBeNull();
  });
  it("parses JSON when data present", async () => {
    const cache = freshSut();
    const p = cache.connect();
    lastClient._onceListeners.ready();
    lastClient._listeners.connect();
    await p;
    cache.client.get.mockResolvedValue('{"x":1}');
    expect(await cache.get("k")).toEqual({ x: 1 });
  });
  it("returns null when data is null", async () => {
    const cache = freshSut();
    const p = cache.connect();
    lastClient._onceListeners.ready();
    lastClient._listeners.connect();
    await p;
    cache.client.get.mockResolvedValue(null);
    expect(await cache.get("k")).toBeNull();
  });
  it("returns null + logs on error", async () => {
    const cache = freshSut();
    const p = cache.connect();
    lastClient._onceListeners.ready();
    lastClient._listeners.connect();
    await p;
    cache.client.get.mockRejectedValue(new Error("get-err"));
    expect(await cache.get("k")).toBeNull();
    expect(childLog.error).toHaveBeenCalledWith("Redis GET error", expect.any(Object));
  });
});

describe("cache/RedisCache > set", () => {
  it("returns false when not connected", async () => {
    const cache = freshSut();
    expect(await cache.set("k", 1, 60)).toBe(false);
  });
  it("set with ttl uses EX", async () => {
    const cache = freshSut();
    const p = cache.connect();
    lastClient._onceListeners.ready();
    lastClient._listeners.connect();
    await p;
    cache.client.set.mockResolvedValue("OK");
    expect(await cache.set("k", { a: 1 }, 60)).toBe(true);
    expect(cache.client.set).toHaveBeenCalledWith("k", '{"a":1}', "EX", 60);
  });
  it("set without ttl skips EX", async () => {
    const cache = freshSut();
    const p = cache.connect();
    lastClient._onceListeners.ready();
    lastClient._listeners.connect();
    await p;
    cache.client.set.mockResolvedValue("OK");
    await cache.set("k", 1);
    expect(cache.client.set).toHaveBeenCalledWith("k", "1");
  });
  it("returns false + logs on error", async () => {
    const cache = freshSut();
    const p = cache.connect();
    lastClient._onceListeners.ready();
    lastClient._listeners.connect();
    await p;
    cache.client.set.mockRejectedValue(new Error("set-err"));
    expect(await cache.set("k", 1, 60)).toBe(false);
  });
});

describe("cache/RedisCache > del", () => {
  it("false when not connected", async () => {
    expect(await freshSut().del("k")).toBe(false);
  });
  it("true on success", async () => {
    const cache = freshSut();
    const p = cache.connect();
    lastClient._onceListeners.ready();
    lastClient._listeners.connect();
    await p;
    cache.client.del.mockResolvedValue(1);
    expect(await cache.del("k")).toBe(true);
  });
  it("false + logs on error", async () => {
    const cache = freshSut();
    const p = cache.connect();
    lastClient._onceListeners.ready();
    lastClient._listeners.connect();
    await p;
    cache.client.del.mockRejectedValue(new Error("del-err"));
    expect(await cache.del("k")).toBe(false);
  });
});

describe("cache/RedisCache > flush", () => {
  it("false when not connected", async () => {
    expect(await freshSut().flush("*")).toBe(false);
  });
  it("flushes all matching keys", async () => {
    const cache = freshSut();
    const p = cache.connect();
    lastClient._onceListeners.ready();
    lastClient._listeners.connect();
    await p;
    cache.client.keys.mockResolvedValue(["k1", "k2"]);
    cache.client.del.mockResolvedValue(2);
    expect(await cache.flush("u:*")).toBe(true);
    expect(cache.client.del).toHaveBeenCalledWith("k1", "k2");
  });
  it("no keys matched → del not called but still returns true", async () => {
    const cache = freshSut();
    const p = cache.connect();
    lastClient._onceListeners.ready();
    lastClient._listeners.connect();
    await p;
    cache.client.keys.mockResolvedValue([]);
    expect(await cache.flush("u:*")).toBe(true);
    expect(cache.client.del).not.toHaveBeenCalled();
  });
  it("false + logs on error", async () => {
    const cache = freshSut();
    const p = cache.connect();
    lastClient._onceListeners.ready();
    lastClient._listeners.connect();
    await p;
    cache.client.keys.mockRejectedValue(new Error("flush-err"));
    expect(await cache.flush("u:*")).toBe(false);
  });
});

describe("cache/RedisCache > disconnect", () => {
  it("noop when no client", async () => {
    await freshSut().disconnect();
  });
  it("quits client and nulls reference", async () => {
    const cache = freshSut();
    const p = cache.connect();
    lastClient._onceListeners.ready();
    lastClient._listeners.connect();
    await p;
    const quitFn = cache.client.quit;
    await cache.disconnect();
    expect(quitFn).toHaveBeenCalled();
    expect(cache.client).toBeNull();
    expect(cache.connected).toBe(false);
  });
});
