import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Stub es-connections so the src import doesn't try to connect to ES.
const esConnPath = require.resolve("../../es-connections/connection");
require.cache[esConnPath] = {
  id: esConnPath, filename: esConnPath, loaded: true,
  exports: vi.fn(),
};

// Pre-load src + monkey-patch BEFORE the router loads.
const srcModule = require("../../src/dynamic-count-analytics");
const handler = vi.fn();
srcModule.dynamicCountFilter = handler;

const router = require("../../routes/dynamic-count-analytics");

describe("routes/dynamic-count-analytics > registration", () => {
  it("exports an Express router", () => {
    expect(typeof router).toBe("function");
    expect(Array.isArray(router.stack)).toBe(true);
  });

  it("registers POST /get-count pointing at dynamicCountFilter", () => {
    const layer = router.stack.find((l) => l.route && l.route.path === "/get-count");
    expect(layer).toBeDefined();
    expect(layer.route.methods.post).toBe(true);
    expect(layer.route.stack[0].handle).toBe(handler);
  });

  it("registers exactly one route on the router", () => {
    const routes = router.stack.filter((l) => l.route);
    expect(routes).toHaveLength(1);
  });
});
