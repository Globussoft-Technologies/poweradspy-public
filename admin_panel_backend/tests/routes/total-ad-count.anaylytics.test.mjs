import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Stub the src/ collaborator so we don't pull in ES + mongo on import.
const srcPath = require.resolve("../../src/total-ad-count-analytics.js");
const totalAdsCountFilter = vi.fn();
require.cache[srcPath] = {
  id: srcPath, filename: srcPath, loaded: true,
  exports: { totalAdsCountFilter },
};

const router = require("../../routes/total-ad-count.anaylytics");

function find(path) {
  return router.stack.find((l) => l.route && l.route.path === path);
}

describe("routes/total-ad-count.anaylytics > registration", () => {
  it("exports an Express router function", () => {
    expect(typeof router).toBe("function");
    expect(Array.isArray(router.stack)).toBe(true);
  });

  it("POST /get-ads-count -> totalAdsCountFilter", () => {
    const layer = find("/get-ads-count");
    expect(layer).toBeDefined();
    expect(layer.route.methods.post).toBe(true);
    expect(layer.route.stack[0].handle).toBe(totalAdsCountFilter);
  });
});
