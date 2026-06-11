import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const esConnPath = require.resolve("../../es-connections/connection");
require.cache[esConnPath] = {
  id: esConnPath, filename: esConnPath, loaded: true,
  exports: vi.fn(),
};

const srcModule = require("../../src/ad-count-analytics");
const handler = vi.fn();
srcModule.adCountFilter = handler;

const router = require("../../routes/ad-count-analytics");

describe("routes/ad-count-analytics > registration", () => {
  it("exports an Express router", () => {
    expect(typeof router).toBe("function");
  });

  it("registers POST /ad-counts pointing at adCountFilter", () => {
    const layer = router.stack.find((l) => l.route && l.route.path === "/ad-counts");
    expect(layer).toBeDefined();
    expect(layer.route.methods.post).toBe(true);
    expect(layer.route.stack[0].handle).toBe(handler);
  });

  it("registers exactly one route", () => {
    expect(router.stack.filter((l) => l.route)).toHaveLength(1);
  });
});
