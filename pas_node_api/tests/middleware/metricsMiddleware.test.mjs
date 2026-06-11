import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Mock MetricsCollector
const mcPath = require.resolve("../../src/metrics/MetricsCollector");
const fakeMetrics = {
  activeConnections: 0,
  recordRequest: vi.fn(),
};
require.cache[mcPath] = {
  id: mcPath, filename: mcPath, loaded: true,
  exports: fakeMetrics,
};

const metricsMiddleware = require("../../src/middleware/metricsMiddleware");

function mockReqRes() {
  const handlers = {};
  const res = {
    on: vi.fn((event, fn) => { handlers[event] = fn; }),
    writableFinished: false,
    statusCode: 200,
  };
  const req = { method: "GET", url: "/x" };
  return { req, res, handlers };
}

beforeEach(() => {
  fakeMetrics.activeConnections = 0;
  fakeMetrics.recordRequest.mockClear();
});

describe("middleware/metricsMiddleware", () => {
  it("increments activeConnections on enter, decrements + records on finish", () => {
    const mw = metricsMiddleware();
    const { req, res, handlers } = mockReqRes();
    const next = vi.fn();
    mw(req, res, next);
    expect(fakeMetrics.activeConnections).toBe(1);
    expect(next).toHaveBeenCalled();
    // fire finish
    res.writableFinished = true;
    handlers.finish();
    expect(fakeMetrics.activeConnections).toBe(0);
    expect(fakeMetrics.recordRequest).toHaveBeenCalledWith(req, res, expect.any(Number));
  });

  it("on close without finish → decrements activeConnections (line 25 true branch)", () => {
    const mw = metricsMiddleware();
    const { req, res, handlers } = mockReqRes();
    mw(req, res, vi.fn());
    expect(fakeMetrics.activeConnections).toBe(1);
    // close fires WITHOUT finish — writableFinished stays false
    handlers.close();
    expect(fakeMetrics.activeConnections).toBe(0);
  });

  it("on close after finish → does NOT double-decrement (line 25 false branch)", () => {
    const mw = metricsMiddleware();
    const { req, res, handlers } = mockReqRes();
    mw(req, res, vi.fn());
    res.writableFinished = true;
    handlers.finish(); // -> 0
    handlers.close();  // res.writableFinished true, skip
    expect(fakeMetrics.activeConnections).toBe(0);
  });
});
