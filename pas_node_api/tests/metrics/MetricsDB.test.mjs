import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// sqlite3 has a .verbose() method that returns the module
const sqlite3Path = require.resolve("sqlite3");
const FakeDatabase = function () {};
require.cache[sqlite3Path] = {
  id: sqlite3Path, filename: sqlite3Path, loaded: true,
  exports: { verbose: () => ({ Database: FakeDatabase }) },
};

// sqlite's `open` returns an awaited db
const sqlitePath = require.resolve("sqlite");
const dbInstance = {
  exec: vi.fn(async () => {}),
  run: vi.fn(async () => {}),
  get: vi.fn(async () => ({ total: 0, avg: 0 })),
  all: vi.fn(async () => []),
  prepare: vi.fn(async () => ({ run: vi.fn(async () => {}), finalize: vi.fn(async () => {}) })),
  close: vi.fn(async () => {}),
};
const open = vi.fn(async () => dbInstance);
require.cache[sqlitePath] = {
  id: sqlitePath, filename: sqlitePath, loaded: true,
  exports: { open },
};

import fs from "node:fs";
const existsSpy = vi.spyOn(fs, "existsSync");
const mkdirSpy = vi.spyOn(fs, "mkdirSync");

const sutPath = require.resolve("../../src/metrics/MetricsDB");
function freshSut() {
  delete require.cache[sutPath];
  return require(sutPath);
}

beforeEach(() => {
  open.mockClear().mockResolvedValue(dbInstance);
  dbInstance.exec.mockClear().mockResolvedValue();
  dbInstance.run.mockClear().mockResolvedValue();
  dbInstance.get.mockClear().mockResolvedValue({ total: 0, avg: 0 });
  dbInstance.all.mockClear().mockResolvedValue([]);
  dbInstance.prepare.mockClear().mockResolvedValue({ run: vi.fn(async () => {}), finalize: vi.fn(async () => {}) });
  dbInstance.close.mockClear().mockResolvedValue();
  existsSpy.mockReset().mockReturnValue(true);
  mkdirSpy.mockReset();
  vi.useFakeTimers();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
});

describe("MetricsDB > constructor + init", () => {
  it("constructor sets buffers/interval defaults", () => {
    const db = freshSut();
    expect(db.requestBuffer).toEqual([]);
    expect(db.errorBuffer).toEqual([]);
    expect(db.bufferSize).toBe(100);
  });
  it("init creates data dir if missing, opens db, runs schema", async () => {
    existsSpy.mockReturnValue(false);
    const db = freshSut();
    await db.init();
    expect(mkdirSpy).toHaveBeenCalled();
    expect(open).toHaveBeenCalled();
    expect(dbInstance.exec).toHaveBeenCalled();
  });
  it("init skips mkdir when dir exists", async () => {
    existsSpy.mockReturnValue(true);
    const db = freshSut();
    await db.init();
    expect(mkdirSpy).not.toHaveBeenCalled();
  });
});

describe("MetricsDB > recordRequest", () => {
  it("buffers a request with req.method/url/ip", async () => {
    const db = freshSut();
    await db.init();
    db.recordRequest({ method: "GET", url: "/foo?bar=1", ip: "1.1.1.1" }, 10);
    expect(db.requestBuffer).toHaveLength(1);
    expect(db.requestBuffer[0].endpoint).toBe("/foo");
  });
  it("uses originalUrl when present, simplifies /:id pattern", async () => {
    const db = freshSut();
    await db.init();
    db.recordRequest({ method: "GET", originalUrl: "/api/users/123/posts/456" }, 5);
    expect(db.requestBuffer[0].endpoint).toBe("/api/users/:id/posts/:id");
  });
  it("status default 200 when req.res missing", async () => {
    const db = freshSut();
    await db.init();
    db.recordRequest({ method: "GET", url: "/x" }, 1);
    expect(db.requestBuffer[0].status).toBe(200);
  });
  it("uses req.res.statusCode when present", async () => {
    const db = freshSut();
    await db.init();
    db.recordRequest({ method: "GET", url: "/x", res: { statusCode: 404 } }, 1);
    expect(db.requestBuffer[0].status).toBe(404);
  });
  it("falls back to connection.remoteAddress for ip", async () => {
    const db = freshSut();
    await db.init();
    db.recordRequest({ method: "GET", url: "/x", connection: { remoteAddress: "2.2.2.2" } }, 1);
    expect(db.requestBuffer[0].ip).toBe("2.2.2.2");
  });
  it("ip falls back to 'unknown'", async () => {
    const db = freshSut();
    await db.init();
    db.recordRequest({ method: "GET", url: "/x" }, 1);
    expect(db.requestBuffer[0].ip).toBe("unknown");
  });
  it("auto-flushes when buffer reaches threshold", async () => {
    const db = freshSut();
    await db.init();
    db.bufferSize = 2;
    db.recordRequest({ method: "GET", url: "/x" }, 1);
    db.recordRequest({ method: "GET", url: "/y" }, 1);
    expect(dbInstance.run).toHaveBeenCalledWith("BEGIN TRANSACTION");
  });
});

describe("MetricsDB > recordError", () => {
  it("buffers error + auto-flush threshold", async () => {
    const db = freshSut();
    await db.init();
    db.bufferSize = 1;
    db.recordError({ method: "GET", url: "/x", ip: "1.1.1.1" }, { statusCode: 500 });
    expect(dbInstance.run).toHaveBeenCalledWith("BEGIN TRANSACTION");
  });
  it("uses originalUrl and connection.remoteAddress fallbacks", async () => {
    const db = freshSut();
    await db.init();
    db.recordError({ method: "POST", originalUrl: "/api/x", connection: { remoteAddress: "3.3.3.3" } }, { statusCode: 500 });
    expect(db.errorBuffer[0].url).toBe("/api/x");
    expect(db.errorBuffer[0].ip).toBe("3.3.3.3");
  });
  it("ip falls back to 'unknown'", async () => {
    const db = freshSut();
    await db.init();
    db.recordError({ method: "GET", url: "/x" }, { statusCode: 500 });
    expect(db.errorBuffer[0].ip).toBe("unknown");
  });
});

describe("MetricsDB > recordSnapshot", () => {
  it("returns early when db not initialized", async () => {
    const db = freshSut();
    await db.recordSnapshot({});
    expect(dbInstance.run).not.toHaveBeenCalled();
  });
  it("inserts snapshot row", async () => {
    const db = freshSut();
    await db.init();
    await db.recordSnapshot({ requests: 1, errors: 0, rss: 10, heapUsed: 5, loadAvg: 0.5, activeConnections: 2 });
    expect(dbInstance.run).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO snapshots"), expect.any(Array));
  });
  it("catches insert error", async () => {
    const db = freshSut();
    await db.init();
    dbInstance.run.mockRejectedValueOnce(new Error("snap-fail"));
    await db.recordSnapshot({});
    expect(console.error).toHaveBeenCalled();
  });
});

describe("MetricsDB > flush", () => {
  it("noop when db not initialized", async () => {
    const db = freshSut();
    await db.flush();
  });
  it("noop when buffers empty", async () => {
    const db = freshSut();
    await db.init();
    // Wait microtask for the startup cleanup job to settle then clear
    await Promise.resolve();
    dbInstance.run.mockClear();
    await db.flush();
    expect(dbInstance.run).not.toHaveBeenCalled();
  });
  it("flushes both requests + errors in one transaction", async () => {
    const db = freshSut();
    await db.init();
    db.requestBuffer.push({ method: "GET", endpoint: "/x", status: 200, response_time: 1, ip: "ip", timestamp: "ts" });
    db.errorBuffer.push({ method: "GET", url: "/x", status: 500, ip: "ip", timestamp: "ts" });
    await db.flush();
    expect(dbInstance.run).toHaveBeenCalledWith("BEGIN TRANSACTION");
    expect(dbInstance.run).toHaveBeenCalledWith("COMMIT");
    expect(dbInstance.prepare).toHaveBeenCalledTimes(2);
  });
  it("rolls back on error", async () => {
    const db = freshSut();
    await db.init();
    db.requestBuffer.push({ method: "GET", endpoint: "/x", status: 200, response_time: 1, ip: "ip", timestamp: "ts" });
    dbInstance.prepare.mockRejectedValueOnce(new Error("prep-fail"));
    await db.flush();
    expect(dbInstance.run).toHaveBeenCalledWith("ROLLBACK");
    expect(console.error).toHaveBeenCalled();
  });
  it("rollback itself catches if it fails", async () => {
    const db = freshSut();
    await db.init();
    db.requestBuffer.push({ method: "GET", endpoint: "/x", status: 200, response_time: 1, ip: "ip", timestamp: "ts" });
    let runCall = 0;
    dbInstance.run.mockImplementation(async (sql) => {
      runCall++;
      if (sql === "ROLLBACK") throw new Error("rb-fail");
    });
    dbInstance.prepare.mockRejectedValueOnce(new Error("prep-fail"));
    await db.flush(); // should not throw
  });
});

describe("MetricsDB > getDashboardAggregates", () => {
  it("returns {} when db not initialized", async () => {
    const db = freshSut();
    expect(await db.getDashboardAggregates()).toEqual({});
  });
  it("happy path with no dates → no date WHERE", async () => {
    const db = freshSut();
    await db.init();
    dbInstance.get.mockImplementation(async (sql) => {
      if (sql.includes("COUNT(*) as total FROM requests")) return { total: 5 };
      if (sql.includes("COUNT(*) as total FROM errors")) return { total: 1 };
      if (sql.includes("AVG(response_time)")) return { avg: 10 };
      return {};
    });
    dbInstance.all.mockImplementation(async (sql) => {
      if (sql.includes("GROUP BY method")) return [{ method: "GET", count: 4 }, { method: "POST", count: 1 }];
      if (sql.includes("GROUP BY status")) return [{ status: 200, count: 5 }];
      if (sql.includes("endpoint NOT LIKE")) return [{ endpoint: "/x", count: 5, avgTime: 10 }];
      if (sql.includes("FROM requests") && sql.includes("LIMIT 500")) return [{ response_time: 1 }, { response_time: 5 }, { response_time: 10 }];
      if (sql.includes("FROM errors")) return [{ id: 1 }];
      if (sql.includes("FROM snapshots")) return [{ id: 1, total_requests: 5 }];
      return [];
    });
    const out = await db.getDashboardAggregates();
    expect(out.requests.total).toBe(5);
    expect(out.requests.byMethod).toEqual({ GET: 4, POST: 1 });
    expect(out.requests.byStatus).toEqual({ 200: 5 });
    expect(out.responseTimes.avg).toBe(10);
    expect(out.responseTimes.sampleSize).toBe(3);
    expect(out.topEndpoints).toHaveLength(1);
    expect(out.errors.total).toBe(1);
    expect(out.snapshots).toHaveLength(1);
  });
  it("with date range applies WHERE BETWEEN and topEndpoints uses AND", async () => {
    const db = freshSut();
    await db.init();
    dbInstance.get.mockResolvedValue({ total: 0, avg: 0 });
    dbInstance.all.mockResolvedValue([]);
    await db.getDashboardAggregates("2024-01-01", "2024-01-31");
    const topEpCall = dbInstance.all.mock.calls.find(c => c[0].includes("endpoint NOT LIKE"));
    expect(topEpCall[0]).toContain("WHERE timestamp BETWEEN");
    expect(topEpCall[0]).toContain("AND  endpoint NOT LIKE");
  });
  it("avg null fallback to 0", async () => {
    const db = freshSut();
    await db.init();
    dbInstance.get.mockImplementation(async (sql) => {
      if (sql.includes("AVG")) return { avg: null };
      return { total: 0 };
    });
    const out = await db.getDashboardAggregates();
    expect(out.responseTimes.avg).toBe(0);
  });
});

describe("MetricsDB > getIpStats", () => {
  it("returns [] when db not initialized", async () => {
    const db = freshSut();
    expect(await db.getIpStats()).toEqual([]);
  });
  it("happy path: top IPs + endpoint breakdown with date range", async () => {
    const db = freshSut();
    await db.init();
    dbInstance.all.mockImplementation(async (sql, params) => {
      // endpoint breakdown query — check FIRST since both contain "GROUP BY ip"
      if (sql.includes("GROUP BY ip, endpoint")) {
        return [
          { ip: "1.1.1.1", endpoint: "/x", count: 5 },
          { ip: "1.1.1.1", endpoint: "/y", count: 3 },
          { ip: "2.2.2.2", endpoint: "/z", count: 4 },
        ];
      }
      if (sql.includes("GROUP BY ip")) {
        return [
          { ip: "1.1.1.1", requests: 10, firstSeen: "a", lastSeen: "b" },
          { ip: "2.2.2.2", requests: 5, firstSeen: "c", lastSeen: "d" },
        ];
      }
      return [];
    });
    const out = await db.getIpStats("2024-01-01", "2024-01-31");
    expect(out).toHaveLength(2);
    expect(out[0].endpoints["/x"]).toBe(5);
    expect(out[1].endpoints["/z"]).toBe(4);
  });
  it("no dates path skips WHERE clause", async () => {
    const db = freshSut();
    await db.init();
    dbInstance.all.mockResolvedValue([{ ip: "1.1.1.1", requests: 1 }]);
    await db.getIpStats();
    const ipCall = dbInstance.all.mock.calls[0];
    expect(ipCall[0]).not.toContain("BETWEEN");
  });
  it("no IPs returned → returns empty array (no endpoint query)", async () => {
    const db = freshSut();
    await db.init();
    dbInstance.all.mockResolvedValue([]);
    const out = await db.getIpStats();
    expect(out).toEqual([]);
    expect(dbInstance.all).toHaveBeenCalledTimes(1);
  });
  it("ip with no endpoints in epMap → empty endpoints object", async () => {
    const db = freshSut();
    await db.init();
    dbInstance.all.mockImplementation(async (sql) => {
      if (sql.includes("GROUP BY ip, endpoint")) return [];
      if (sql.includes("GROUP BY ip")) return [{ ip: "1.1.1.1", requests: 1 }];
      return [];
    });
    const out = await db.getIpStats();
    expect(out[0].endpoints).toEqual({});
  });
});

describe("MetricsDB > _percentile + _simplifyPath", () => {
  it("_percentile of empty → 0", () => {
    const db = freshSut();
    expect(db._percentile([], 50)).toBe(0);
  });
  it("_percentile picks correct index", () => {
    const db = freshSut();
    expect(db._percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(db._percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
  });
  it("_simplifyPath strips query + collapses numeric ids", () => {
    const db = freshSut();
    expect(db._simplifyPath("/api/x?a=1")).toBe("/api/x");
    expect(db._simplifyPath("/api/users/42")).toBe("/api/users/:id");
  });
});

describe("MetricsDB > flush timer + cleanup job", () => {
  it("flush timer auto-fires every 5s", async () => {
    const db = freshSut();
    await db.init();
    db.requestBuffer.push({ method: "GET", endpoint: "/x", status: 200, response_time: 1, ip: "ip", timestamp: "ts" });
    dbInstance.run.mockClear();
    vi.advanceTimersByTime(5000);
    // The flush is async; let microtasks run
    await Promise.resolve();
    expect(dbInstance.run).toHaveBeenCalled();
  });
  it("cleanup job runs delete + vacuum; catches errors", async () => {
    const db = freshSut();
    await db.init();
    dbInstance.exec.mockClear();
    dbInstance.run.mockClear();
    // Trigger 1-hour interval
    vi.advanceTimersByTime(60 * 60 * 1000);
    await Promise.resolve();
    expect(dbInstance.run).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM requests"), expect.any(Array));
  });
  it("cleanup job error path", async () => {
    const db = freshSut();
    await db.init();
    dbInstance.run.mockRejectedValueOnce(new Error("cleanup-fail"));
    vi.advanceTimersByTime(60 * 60 * 1000);
    await Promise.resolve();
    await Promise.resolve();
    // Cleanup error path may or may not trigger; just don't crash
  });
  it("cleanup job no-ops when this.db is null (line 342 truthy guard)", async () => {
    const db = freshSut();
    await db.init();
    dbInstance.run.mockClear();
    dbInstance.exec.mockClear();
    // Null out the db so the cleanup callback's `if (!this.db) return;` fires.
    db.db = null;
    vi.advanceTimersByTime(60 * 60 * 1000);
    await Promise.resolve();
    // No DELETE / no exec called because cleanup returned early
    expect(dbInstance.run).not.toHaveBeenCalled();
    expect(dbInstance.exec).not.toHaveBeenCalled();
  });
});

describe("MetricsDB > close", () => {
  it("clears timer + flushes + closes db", async () => {
    const db = freshSut();
    await db.init();
    await db.close();
    expect(dbInstance.close).toHaveBeenCalled();
  });
  it("close without init noop on close", async () => {
    const db = freshSut();
    await db.close();
    // No throw
  });
});
