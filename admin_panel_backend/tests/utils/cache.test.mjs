import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// node-cache is a sealed npm package — require.cache replacement.
const nodeCachePath = require.resolve("node-cache");
const NodeCacheCtor = vi.fn(function (opts) {
  this.opts = opts;
  this.get = vi.fn();
  this.set = vi.fn();
  this.del = vi.fn();
});
require.cache[nodeCachePath] = {
  id: nodeCachePath,
  filename: nodeCachePath,
  loaded: true,
  exports: NodeCacheCtor,
};

const cache = require("../../utils/cache");

describe("utils/cache", () => {
  it("constructs NodeCache with stdTTL=180 and checkperiod=60", () => {
    expect(NodeCacheCtor).toHaveBeenCalledWith({
      stdTTL: 180,
      checkperiod: 60,
    });
  });

  it("exports the NodeCache instance", () => {
    expect(cache).toBeInstanceOf(NodeCacheCtor);
  });
});
