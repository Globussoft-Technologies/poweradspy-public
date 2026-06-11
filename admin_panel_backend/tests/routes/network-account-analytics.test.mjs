import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const esConnPath = require.resolve("../../es-connections/connection");
require.cache[esConnPath] = {
  id: esConnPath, filename: esConnPath, loaded: true,
  exports: vi.fn(),
};

const srcModule = require("../../src/network-account-data");
const networkHandler = vi.fn();
const currentHandler = vi.fn();
srcModule.networkAccountDataWithFilter = networkHandler;
srcModule.currentCount = currentHandler;

const router = require("../../routes/network-account-analytics");

describe("routes/network-account-analytics > registration", () => {
  it("exports an Express router", () => {
    expect(typeof router).toBe("function");
  });

  it("registers POST /analytics -> networkAccountDataWithFilter", () => {
    const layer = router.stack.find((l) => l.route && l.route.path === "/analytics");
    expect(layer).toBeDefined();
    expect(layer.route.methods.post).toBe(true);
    expect(layer.route.stack[0].handle).toBe(networkHandler);
  });

  it("registers POST /current-analytics -> currentCount", () => {
    const layer = router.stack.find((l) => l.route && l.route.path === "/current-analytics");
    expect(layer).toBeDefined();
    expect(layer.route.methods.post).toBe(true);
    expect(layer.route.stack[0].handle).toBe(currentHandler);
  });

  it("registers exactly two routes", () => {
    expect(router.stack.filter((l) => l.route)).toHaveLength(2);
  });
});
