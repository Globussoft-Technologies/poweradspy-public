import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const esConnPath = require.resolve("../../es-connections/connection");
require.cache[esConnPath] = {
  id: esConnPath, filename: esConnPath, loaded: true,
  exports: vi.fn(),
};

const srcModule = require("../../src/builtwith-analytics");
const handler = vi.fn();
srcModule.builtWithStatsWithFilter = handler;

const router = require("../../routes/builtwith-analytics");

describe("routes/builtwith-analytics > registration", () => {
  it("exports an Express router", () => {
    expect(typeof router).toBe("function");
    expect(Array.isArray(router.stack)).toBe(true);
  });

  it("registers POST /counts pointing at builtWithStatsWithFilter", () => {
    const layer = router.stack.find((l) => l.route && l.route.path === "/counts");
    expect(layer).toBeDefined();
    expect(layer.route.methods.post).toBe(true);
    expect(layer.route.stack[0].handle).toBe(handler);
  });

  it("registers exactly one route", () => {
    expect(router.stack.filter((l) => l.route)).toHaveLength(1);
  });
});
