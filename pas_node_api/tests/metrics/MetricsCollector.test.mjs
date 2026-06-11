import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const configPath = require.resolve("../../src/config");
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true,
  exports: { metricsConfig: { snapshotIntervalMs: 1234 } },
};

const dbPath = require.resolve("../../src/metrics/MetricsDB");
const metricsDB = {
  recordRequest: vi.fn(),
  recordError: vi.fn(),
  recordSnapshot: vi.fn(),
  getDashboardAggregates: vi.fn(),
  getIpStats: vi.fn(),
};
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true, exports: metricsDB,
};

const sutPath = require.resolve("../../src/metrics/MetricsCollector");
function freshSut() {
  delete require.cache[sutPath];
  return require(sutPath);
}

beforeEach(() => {
  Object.values(metricsDB).forEach(fn => fn.mockReset());
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("MetricsCollector > constructor", () => {
  it("initializes counters and registers snapshot interval", () => {
    const c = freshSut();
    expect(c.activeConnections).toBe(0);
    expect(c.totalRequestsReceivedSinceStartup).toBe(0);
    expect(c.totalErrorsSinceStartup).toBe(0);
    // Trigger snapshot interval
    vi.advanceTimersByTime(1234);
    expect(metricsDB.recordSnapshot).toHaveBeenCalled();
  });

  it("uses default snapshot interval (10000ms) when config missing", () => {
    const origCfg = require.cache[configPath].exports;
    require.cache[configPath].exports = {};
    const c = freshSut();
    vi.advanceTimersByTime(10000);
    expect(metricsDB.recordSnapshot).toHaveBeenCalled();
    require.cache[configPath].exports = origCfg;
  });
});

describe("MetricsCollector > recordRequest", () => {
  it("increments totalRequests + pipes to DB; no error if status < 500", () => {
    const c = freshSut();
    c.recordRequest({ method: "GET" }, { statusCode: 200 }, 10);
    expect(c.totalRequestsReceivedSinceStartup).toBe(1);
    expect(c.totalErrorsSinceStartup).toBe(0);
    expect(metricsDB.recordRequest).toHaveBeenCalledWith({ method: "GET" }, 10);
    expect(metricsDB.recordError).not.toHaveBeenCalled();
  });

  it("increments error counter and pipes to recordError when status >= 500", () => {
    const c = freshSut();
    c.recordRequest({}, { statusCode: 503 }, 5);
    expect(c.totalErrorsSinceStartup).toBe(1);
    expect(metricsDB.recordError).toHaveBeenCalled();
  });
});

describe("MetricsCollector > getMetrics", () => {
  it("merges DB aggregates with live process+os data", async () => {
    metricsDB.getDashboardAggregates.mockResolvedValue({
      requests: { total: 100, byEndpoint: {} },
      responseTimes: { avg: 5, p50: 4, p95: 9, p99: 12, sampleSize: 50 },
      errors: { total: 3, recent: [{ url: "/x" }] },
      topEndpoints: [{ url: "/x", count: 100 }],
      snapshots: [{ ts: 1 }],
    });
    const c = freshSut();
    c.activeConnections = 7;
    const out = await c.getMetrics("2024-01-01", "2024-12-31");
    expect(out.server.pid).toBe(process.pid);
    expect(out.server.uptimeHuman).toMatch(/s$/);
    expect(out.memory.rss).toMatch(/[BKMG]B$/);
    expect(out.requests.activeConnections).toBe(7);
    expect(out.requests.rps).toBeGreaterThanOrEqual(0);
    expect(out.responseTimes.avg).toBe(5);
    expect(out.errors.total).toBe(3);
    expect(out.topEndpoints).toHaveLength(1);
    expect(out.snapshots).toHaveLength(1);
  });

  it("falls back to defaults when DB aggregates are missing fields", async () => {
    metricsDB.getDashboardAggregates.mockResolvedValue({ requests: {} });
    const c = freshSut();
    const out = await c.getMetrics();
    expect(out.responseTimes).toEqual({ avg: 0, p50: 0, p95: 0, p99: 0, sampleSize: 0 });
    expect(out.errors).toEqual({ total: 0, recent: [] });
    expect(out.topEndpoints).toEqual([]);
    expect(out.snapshots).toEqual([]);
    expect(out.requests.rps).toBe(0);
  });

  it("rps divisor falls back to 1 when process.uptime() returns 0 (line 72 `uptime || 1` falsy)", async () => {
    // Spy process.uptime to return 0 so the `|| 1` fallback fires.
    const uptimeSpy = vi.spyOn(process, "uptime").mockReturnValue(0);
    metricsDB.getDashboardAggregates.mockResolvedValue({
      requests: { total: 50, byEndpoint: {} },
    });
    const c = freshSut();
    const out = await c.getMetrics();
    // 50 / 1 = 50; without the fallback this would be Infinity or NaN
    expect(out.requests.rps).toBe(50);
    uptimeSpy.mockRestore();
  });
});

describe("MetricsCollector > getIpStats", () => {
  it("proxies to metricsDB.getIpStats", async () => {
    metricsDB.getIpStats.mockResolvedValue([{ ip: "1.1.1.1", count: 5 }]);
    const c = freshSut();
    const out = await c.getIpStats("2024-01-01", "2024-12-31");
    expect(out).toEqual([{ ip: "1.1.1.1", count: 5 }]);
    expect(metricsDB.getIpStats).toHaveBeenCalledWith("2024-01-01", "2024-12-31");
  });
});

describe("MetricsCollector > _formatBytes", () => {
  it("formats 0 B / KB / MB / GB", () => {
    const c = freshSut();
    expect(c._formatBytes(0)).toBe("0 B");
    expect(c._formatBytes(512)).toBe("512.0 B");
    expect(c._formatBytes(2048)).toBe("2.0 KB");
    expect(c._formatBytes(1024 * 1024 * 5)).toBe("5.0 MB");
    expect(c._formatBytes(1024 ** 3 * 2)).toBe("2.0 GB");
  });
});

describe("MetricsCollector > _formatUptime", () => {
  it("formats with all units", () => {
    const c = freshSut();
    expect(c._formatUptime(0)).toBe("0s");
    expect(c._formatUptime(45)).toBe("45s");
    expect(c._formatUptime(125)).toBe("2m 5s");
    expect(c._formatUptime(3725)).toBe("1h 2m 5s");
    expect(c._formatUptime(90065)).toBe("1d 1h 1m 5s");
  });
});
