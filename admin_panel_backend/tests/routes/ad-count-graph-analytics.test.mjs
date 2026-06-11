import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const esConnPath = require.resolve("../../es-connections/connection");
require.cache[esConnPath] = {
  id: esConnPath, filename: esConnPath, loaded: true,
  exports: vi.fn(),
};

const srcModule = require("../../src/ad-count-graph-analytics");
const handler = vi.fn();
srcModule.adCountGraphFilter = handler;

const router = require("../../routes/ad-count-graph-analytics");

describe("routes/ad-count-graph-analytics > registration", () => {
  it("exports an Express router", () => {
    expect(typeof router).toBe("function");
  });

  it("registers POST /ad-count-graph pointing at adCountGraphFilter", () => {
    const layer = router.stack.find((l) => l.route && l.route.path === "/ad-count-graph");
    expect(layer).toBeDefined();
    expect(layer.route.methods.post).toBe(true);
    expect(layer.route.stack[0].handle).toBe(handler);
  });

  it("registers exactly one route", () => {
    expect(router.stack.filter((l) => l.route)).toHaveLength(1);
  });
});
