import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const esConnPath = require.resolve("../../es-connections/connection");
require.cache[esConnPath] = {
  id: esConnPath, filename: esConnPath, loaded: true,
  exports: vi.fn(),
};

const srcModule = require("../../src/total-ad-count-analytics.js");
const handler = vi.fn();
srcModule.totalAdsCountFilter = handler;

const router = require("../../routes/total-ad-count.anaylytics");

describe("routes/total-ad-count.anaylytics > registration", () => {
  it("exports an Express router", () => {
    expect(typeof router).toBe("function");
  });

  it("registers POST /get-ads-count pointing at totalAdsCountFilter", () => {
    const layer = router.stack.find(
      (l) => l.route && l.route.path === "/get-ads-count"
    );
    expect(layer).toBeDefined();
    expect(layer.route.methods.post).toBe(true);
    expect(layer.route.stack[0].handle).toBe(handler);
  });

  it("registers exactly one route", () => {
    expect(router.stack.filter((l) => l.route)).toHaveLength(1);
  });
});
