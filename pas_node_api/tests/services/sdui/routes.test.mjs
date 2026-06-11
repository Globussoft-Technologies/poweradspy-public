import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Mock express.Router to capture handlers
const expressPath = require.resolve("express");
const handlers = {};
function fakeRouter() {
  return {
    get: vi.fn((path, fn) => { handlers[path] = fn; }),
    use: vi.fn(),
  };
}
const fakeExpress = function () { return fakeRouter(); };
fakeExpress.Router = fakeRouter;
require.cache[expressPath] = {
  id: expressPath, filename: expressPath, loaded: true, exports: fakeExpress,
};

// Mock sduiService
const svcPath = require.resolve("../../../src/services/sdui/services/sduiService");
const fakeSvc = {
  getSDUIConfig: vi.fn(),
  filterConfigByPlatforms: vi.fn(),
  computeVersion: vi.fn(),
};
require.cache[svcPath] = {
  id: svcPath, filename: svcPath, loaded: true, exports: fakeSvc,
};

const loggerPath = require.resolve("../../../src/logger");
const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { createChild: () => fakeLogger },
};

const { createSduiRouter } = require("../../../src/services/sdui/routes");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.set = vi.fn(() => res);
  return res;
}

beforeEach(() => {
  Object.keys(handlers).forEach((k) => delete handlers[k]);
  fakeSvc.getSDUIConfig.mockReset();
  fakeSvc.filterConfigByPlatforms.mockReset();
  fakeSvc.computeVersion.mockReset();
  fakeLogger.error.mockClear();
  createSduiRouter();
});

describe("services/sdui/routes > GET /sdui/config", () => {
  it("no platforms query: returns full config + cache-control header", async () => {
    fakeSvc.getSDUIConfig.mockResolvedValueOnce({ sidebar: ["a", "b"] });
    const res = mockRes();
    await handlers["/sdui/config"]({ query: {} }, res);
    expect(res.set).toHaveBeenCalledWith("Cache-Control", "no-cache, no-store, must-revalidate");
    expect(res.json).toHaveBeenCalledWith({ sidebar: ["a", "b"] });
    expect(fakeSvc.filterConfigByPlatforms).not.toHaveBeenCalled();
  });

  it("with platforms query: applies filter", async () => {
    fakeSvc.getSDUIConfig.mockResolvedValueOnce({ sidebar: ["a"] });
    fakeSvc.filterConfigByPlatforms.mockReturnValueOnce({ sidebar: ["filtered"] });
    const res = mockRes();
    await handlers["/sdui/config"]({ query: { platforms: "facebook, youtube" } }, res);
    expect(fakeSvc.filterConfigByPlatforms).toHaveBeenCalledWith(
      { sidebar: ["a"] }, ["facebook", "youtube"]
    );
    expect(res.json).toHaveBeenCalledWith({ sidebar: ["filtered"] });
  });

  it("platforms query with empty entries → no filter applied", async () => {
    fakeSvc.getSDUIConfig.mockResolvedValueOnce({ sidebar: [] });
    const res = mockRes();
    await handlers["/sdui/config"]({ query: { platforms: " , , " } }, res);
    // After split+trim+filter(Boolean), no platforms remain → length 0 → skip
    expect(fakeSvc.filterConfigByPlatforms).not.toHaveBeenCalled();
  });

  it("500 on getSDUIConfig throw", async () => {
    fakeSvc.getSDUIConfig.mockRejectedValueOnce(new Error("db-down"));
    const res = mockRes();
    await handlers["/sdui/config"]({ query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "db error" });
    expect(fakeLogger.error).toHaveBeenCalled();
  });
});

describe("services/sdui/routes > GET /v1/sdui/config/version", () => {
  it("returns config_version from computeVersion", async () => {
    fakeSvc.getSDUIConfig.mockResolvedValueOnce({ x: 1 });
    fakeSvc.computeVersion.mockReturnValueOnce("v-hash");
    const res = mockRes();
    await handlers["/v1/sdui/config/version"]({}, res);
    expect(fakeSvc.computeVersion).toHaveBeenCalledWith(JSON.stringify({ x: 1 }));
    expect(res.json).toHaveBeenCalledWith({ config_version: "v-hash" });
  });

  it("500 on getSDUIConfig throw", async () => {
    fakeSvc.getSDUIConfig.mockRejectedValueOnce(new Error("oops"));
    const res = mockRes();
    await handlers["/v1/sdui/config/version"]({}, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(fakeLogger.error).toHaveBeenCalled();
  });
});
