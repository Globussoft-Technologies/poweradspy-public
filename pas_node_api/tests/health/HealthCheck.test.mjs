import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Mock express.Router so we can capture the route registrations without
// pulling in full Express.
const expressPath = require.resolve("express");
const registeredRoutes = [];
function fakeRouter() {
  return {
    get: vi.fn((path, handler) => { registeredRoutes.push({ method: "get", path, handler }); }),
    use: vi.fn(),
  };
}
const fakeExpress = function () { return fakeRouter(); };
fakeExpress.Router = fakeRouter;
require.cache[expressPath] = {
  id: expressPath, filename: expressPath, loaded: true,
  exports: fakeExpress,
};

// Mock DatabaseManager
const dbPath = require.resolve("../../src/database/DatabaseManager");
const fakeDbManager = {
  getHealth: vi.fn(() => ({ facebook: { connected: true } })),
};
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: fakeDbManager,
};

const HealthCheck = require("../../src/health/HealthCheck");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe("health/HealthCheck", () => {
  it("register attaches /live + /ready routes under /health", () => {
    registeredRoutes.length = 0;
    const app = { use: vi.fn() };
    HealthCheck.register(app);
    const paths = registeredRoutes.map((r) => r.path);
    expect(paths).toEqual(["/live", "/ready"]);
    expect(app.use).toHaveBeenCalledWith("/health", expect.any(Object));
  });

  it("/live handler returns 200 with status=ok + timestamp ISO", () => {
    registeredRoutes.length = 0;
    HealthCheck.register({ use: vi.fn() });
    const liveHandler = registeredRoutes.find((r) => r.path === "/live").handler;
    const res = mockRes();
    liveHandler({}, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.status).toBe("ok");
    expect(body.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("/ready handler returns 200 ready with db health + memory + uptime + loadAvg", () => {
    registeredRoutes.length = 0;
    HealthCheck.register({ use: vi.fn() });
    const readyHandler = registeredRoutes.find((r) => r.path === "/ready").handler;
    const res = mockRes();
    readyHandler({}, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.status).toBe("ready");
    expect(body.databases).toEqual({ facebook: { connected: true } });
    expect(body.memory).toBeDefined();
    expect(typeof body.uptime).toBe("number");
    expect(Array.isArray(body.loadAvg)).toBe(true);
  });
});
