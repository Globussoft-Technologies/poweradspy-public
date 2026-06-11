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
const srcModule = require("../../src/types-anaytics");
const handler = vi.fn();
srcModule.typesStatsWithFilter = handler;

// Load the router — its `require('../src/types-anaytics')` hits the
// cached + patched module, destructures our handler.
const router = require("../../routes/types-analytics");

describe("routes/types-analytics > registration", () => {
  it("exports an Express router", () => {
    expect(typeof router).toBe("function");
    expect(Array.isArray(router.stack)).toBe(true);
  });

  it("registers POST /counts pointing at typesStatsWithFilter", () => {
    const layer = router.stack.find((l) => l.route && l.route.path === "/counts");
    expect(layer).toBeDefined();
    expect(layer.route.methods.post).toBe(true);
    // Verify the registered handler IS the one we patched
    const registered = layer.route.stack[0].handle;
    expect(registered).toBe(handler);
  });

  it("registers exactly one route on the router", () => {
    const routes = router.stack.filter((l) => l.route);
    expect(routes).toHaveLength(1);
  });
});
