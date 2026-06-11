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
const srcModule = require("../../src/range-counts-analytics");
const handler = vi.fn();
srcModule.rangeCountsFilter = handler;

// Load the router — its `require('../src/range-counts-analytics')` hits the
// cached + patched module, destructures our handler.
const router = require("../../routes/range-counts-analytics");

describe("routes/range-counts-analytics > registration", () => {
  it("exports an Express router", () => {
    expect(typeof router).toBe("function");
    expect(Array.isArray(router.stack)).toBe(true);
  });

  it("registers POST /get-range-counts pointing at rangeCountsFilter", () => {
    const layer = router.stack.find((l) => l.route && l.route.path === "/get-range-counts");
    expect(layer).toBeDefined();
    expect(layer.route.methods.post).toBe(true);
    const registered = layer.route.stack[0].handle;
    expect(registered).toBe(handler);
  });

  it("registers exactly one route on the router", () => {
    const routes = router.stack.filter((l) => l.route);
    expect(routes).toHaveLength(1);
  });
});
