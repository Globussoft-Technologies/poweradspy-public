import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const esConnPath = require.resolve("../../es-connections/connection");
require.cache[esConnPath] = {
  id: esConnPath, filename: esConnPath, loaded: true,
  exports: vi.fn(),
};

const srcModule = require("../../src/funnel-analytics");
const handler = vi.fn();
srcModule.funnelStatsWithFilter = handler;

const router = require("../../routes/funnel-analytics");

describe("routes/funnel-analytics > registration", () => {
  it("exports an Express router", () => {
    expect(typeof router).toBe("function");
  });

  it("registers POST /counts pointing at funnelStatsWithFilter", () => {
    const layer = router.stack.find((l) => l.route && l.route.path === "/counts");
    expect(layer).toBeDefined();
    expect(layer.route.methods.post).toBe(true);
    expect(layer.route.stack[0].handle).toBe(handler);
  });

  it("registers exactly one route", () => {
    expect(router.stack.filter((l) => l.route)).toHaveLength(1);
  });
});
