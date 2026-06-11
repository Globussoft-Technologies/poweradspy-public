import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Mock express-rate-limit
const rlPath = require.resolve("express-rate-limit");
const rlSpy = vi.fn(() => "rate-limit-instance");
require.cache[rlPath] = {
  id: rlPath, filename: rlPath, loaded: true, exports: rlSpy,
};

// Mock config
const configPath = require.resolve("../../src/config");
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true,
  exports: {
    rateLimit: { windowMs: 60000, maxRequests: 100 },
    blockedIps: { filePath: "data/blocked-ips.json" },
  },
};

// Pre-mock fs so the loadBlockedIps() top-level call doesn't read disk
const fsPath = require.resolve("fs");
const fsExistsSyncSpy = vi.fn(() => false);
const fsReadFileSyncSpy = vi.fn();
const fsWriteFileSyncSpy = vi.fn();
const fsMkdirSyncSpy = vi.fn();
require.cache[fsPath] = {
  id: fsPath, filename: fsPath, loaded: true,
  exports: {
    existsSync: fsExistsSyncSpy,
    readFileSync: fsReadFileSyncSpy,
    writeFileSync: fsWriteFileSyncSpy,
    mkdirSync: fsMkdirSyncSpy,
  },
};

let mod;
beforeEach(() => {
  fsExistsSyncSpy.mockReset().mockReturnValue(false);
  fsReadFileSyncSpy.mockReset();
  fsWriteFileSyncSpy.mockReset();
  fsMkdirSyncSpy.mockReset();
  rlSpy.mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
  // Re-import so blockedIps Set starts empty
  const sutPath = require.resolve("../../src/middleware/rateLimiter");
  delete require.cache[sutPath];
  mod = require("../../src/middleware/rateLimiter");
});

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe("middleware/rateLimiter > module load", () => {
  it("exports globalLimiter + IP management API", () => {
    expect(mod.globalLimiter).toBe("rate-limit-instance");
    expect(typeof mod.ipBlocklistMiddleware).toBe("function");
    expect(typeof mod.blockIp).toBe("function");
    expect(typeof mod.unblockIp).toBe("function");
    expect(typeof mod.getBlockedIps).toBe("function");
    expect(typeof mod.isBlocked).toBe("function");
    expect(typeof mod.reloadBlockedIps).toBe("function");
  });

  it("rate-limit factory called with windowMs/max/headers + keyGenerator", () => {
    const opts = rlSpy.mock.calls[0][0];
    expect(opts.windowMs).toBe(60000);
    expect(opts.max).toBe(100);
    expect(opts.standardHeaders).toBe(true);
    expect(opts.legacyHeaders).toBe(false);
    // keyGenerator falls back to remoteAddress when req.ip missing
    expect(opts.keyGenerator({ ip: "1.1.1.1", connection: {} })).toBe("1.1.1.1");
    expect(opts.keyGenerator({ connection: { remoteAddress: "2.2.2.2" } })).toBe("2.2.2.2");
  });

  it("loadBlockedIps: existing file → populates set", () => {
    fsExistsSyncSpy.mockReturnValueOnce(true);
    fsReadFileSyncSpy.mockReturnValueOnce(JSON.stringify(["1.2.3.4", "5.6.7.8"]));
    const sutPath = require.resolve("../../src/middleware/rateLimiter");
    delete require.cache[sutPath];
    const fresh = require("../../src/middleware/rateLimiter");
    expect(fresh.getBlockedIps()).toEqual(["1.2.3.4", "5.6.7.8"]);
  });

  it("loadBlockedIps: file has non-array JSON → empty set fallback (line 16 false)", () => {
    fsExistsSyncSpy.mockReturnValueOnce(true);
    fsReadFileSyncSpy.mockReturnValueOnce(JSON.stringify({ not: "array" }));
    const sutPath = require.resolve("../../src/middleware/rateLimiter");
    delete require.cache[sutPath];
    const fresh = require("../../src/middleware/rateLimiter");
    expect(fresh.getBlockedIps()).toEqual([]);
  });

  it("loadBlockedIps: read throws → silently ignored", () => {
    fsExistsSyncSpy.mockReturnValueOnce(true);
    fsReadFileSyncSpy.mockImplementationOnce(() => { throw new Error("read-fail"); });
    const sutPath = require.resolve("../../src/middleware/rateLimiter");
    delete require.cache[sutPath];
    const fresh = require("../../src/middleware/rateLimiter");
    expect(fresh.getBlockedIps()).toEqual([]);
  });
});

describe("middleware/rateLimiter > ipBlocklistMiddleware", () => {
  it("blocked IP → 403", () => {
    mod.blockIp("1.1.1.1");
    const res = mockRes();
    const next = vi.fn();
    mod.ipBlocklistMiddleware({ ip: "1.1.1.1", connection: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      code: 403, message: "Access denied. Your IP has been blocked.",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("non-blocked IP → next()", () => {
    const res = mockRes();
    const next = vi.fn();
    mod.ipBlocklistMiddleware({ ip: "9.9.9.9", connection: {} }, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("uses req.connection.remoteAddress when req.ip missing", () => {
    mod.blockIp("3.3.3.3");
    const res = mockRes();
    const next = vi.fn();
    mod.ipBlocklistMiddleware({ connection: { remoteAddress: "3.3.3.3" } }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe("middleware/rateLimiter > blockIp/unblockIp/isBlocked/getBlockedIps", () => {
  it("blockIp adds to set + saveBlockedIps writes file", () => {
    fsExistsSyncSpy.mockReturnValue(true); // dir exists → mkdirSync NOT called
    mod.blockIp("8.8.8.8");
    expect(mod.isBlocked("8.8.8.8")).toBe(true);
    expect(fsWriteFileSyncSpy).toHaveBeenCalled();
    expect(fsMkdirSyncSpy).not.toHaveBeenCalled();
  });

  it("saveBlockedIps creates dir when missing (line 27 true)", () => {
    fsExistsSyncSpy.mockReturnValue(false);
    mod.blockIp("4.4.4.4");
    expect(fsMkdirSyncSpy).toHaveBeenCalledWith(expect.any(String), { recursive: true });
  });

  it("saveBlockedIps: write throws → console.error logged", () => {
    fsExistsSyncSpy.mockReturnValue(true);
    fsWriteFileSyncSpy.mockImplementationOnce(() => { throw new Error("write-fail"); });
    mod.blockIp("5.5.5.5");
    expect(console.error).toHaveBeenCalledWith(
      "[rateLimiter] Failed to save blocked IPs:", "write-fail"
    );
  });

  it("unblockIp removes from set", () => {
    fsExistsSyncSpy.mockReturnValue(true);
    mod.blockIp("6.6.6.6");
    mod.unblockIp("6.6.6.6");
    expect(mod.isBlocked("6.6.6.6")).toBe(false);
  });

  it("getBlockedIps returns spread array", () => {
    fsExistsSyncSpy.mockReturnValue(true);
    mod.blockIp("a");
    mod.blockIp("b");
    expect(mod.getBlockedIps().sort()).toEqual(["a", "b"]);
  });

  it("reloadBlockedIps re-reads from file", () => {
    fsExistsSyncSpy.mockReturnValue(true);
    fsReadFileSyncSpy.mockReturnValueOnce(JSON.stringify(["fresh-ip"]));
    mod.reloadBlockedIps();
    expect(mod.getBlockedIps()).toEqual(["fresh-ip"]);
  });
});
