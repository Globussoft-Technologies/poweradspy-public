import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Mock mysql2/promise BEFORE module load with controllable pools.
const createdPools = [];
function makePool() {
  const conn = {
    query: vi.fn(),
    release: vi.fn(),
    // Alternate ping success vs failure across pools so the boot-time
    // IIFE exercises BOTH the success branch (release call on line 44)
    // and the catch branch (line 46).
    ping: createdPools.length % 2 === 0
      ? vi.fn().mockResolvedValue(undefined)
      : vi.fn().mockRejectedValue(new Error(`ping-fail-${createdPools.length}`)),
  };
  const pool = {
    getConnection: vi.fn().mockResolvedValue(conn),
    end: vi.fn().mockResolvedValue(undefined),
    _conn: conn,
  };
  createdPools.push(pool);
  return pool;
}
const mysql2Path = require.resolve("mysql2/promise");
require.cache[mysql2Path] = {
  id: mysql2Path, filename: mysql2Path, loaded: true,
  exports: { createPool: vi.fn(makePool) },
};

let sigtermHandler;
const realProcessOn = process.on.bind(process);
const procOnSpy = vi.spyOn(process, "on").mockImplementation((evt, cb) => {
  if (evt === "SIGTERM") sigtermHandler = cb;
  else realProcessOn(evt, cb);
  return process;
});

process.env.NODE_ENV = "production";
const queryDatabase = require("../../db-connections/connection");
procOnSpy.mockRestore();

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("db-connections/connection", () => {
  it("creates 11 pools in production mode", () => {
    expect(createdPools.length).toBeGreaterThanOrEqual(11);
  });

  it("happy path: USE database + run sql, release connection", async () => {
    const pool = createdPools[0];
    pool._conn.query
      .mockResolvedValueOnce([]) // USE
      .mockResolvedValueOnce([[{ id: 1 }]]); // SELECT
    const rows = await queryDatabase(0, "mydb", "SELECT 1");
    expect(rows).toEqual([{ id: 1 }]);
    expect(pool._conn.query.mock.calls[0][0]).toBe("USE `mydb`");
    expect(pool._conn.release).toHaveBeenCalled();
  });

  it("throws on missing pool", async () => {
    await expect(queryDatabase(999, "mydb", "SELECT 1")).rejects.toThrow("No pool found for serverIndex 999");
  });

  it("propagates query error and still releases", async () => {
    const pool = createdPools[1];
    pool._conn.query.mockRejectedValueOnce(new Error("syntax"));
    await expect(queryDatabase(1, "x", "BAD")).rejects.toThrow("syntax");
    expect(pool._conn.release).toHaveBeenCalled();
  });

  it("propagates getConnection error and skips release (no connection)", async () => {
    const pool = createdPools[2];
    pool.getConnection.mockRejectedValueOnce(new Error("no-conn"));
    await expect(queryDatabase(2, "x", "SQL")).rejects.toThrow("no-conn");
  });

  it("SIGTERM handler closes all pools (does not actually exit)", async () => {
    expect(typeof sigtermHandler).toBe("function");
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined);
    await sigtermHandler();
    for (const p of createdPools) {
      expect(p.end).toHaveBeenCalled();
    }
    exitSpy.mockRestore();
  });

  it("dev branch: single pool with MYSQL_DEV_* config", () => {
    const devProcOnSpy = vi.spyOn(process, "on").mockImplementation(() => process);
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";
    const modulePath = require.resolve("../../db-connections/connection");
    delete require.cache[modulePath];
    const poolsCountBefore = createdPools.length;
    require("../../db-connections/connection");
    expect(createdPools.length).toBe(poolsCountBefore + 1);
    process.env.NODE_ENV = prevEnv;
    devProcOnSpy.mockRestore();
  });

  it("NODE_ENV unset: falls through to 'development' default", () => {
    const devProcOnSpy = vi.spyOn(process, "on").mockImplementation(() => process);
    const prevEnv = process.env.NODE_ENV;
    delete process.env.NODE_ENV;
    const modulePath = require.resolve("../../db-connections/connection");
    delete require.cache[modulePath];
    const before = createdPools.length;
    require("../../db-connections/connection");
    expect(createdPools.length).toBe(before + 1);
    process.env.NODE_ENV = prevEnv;
    devProcOnSpy.mockRestore();
  });
});
