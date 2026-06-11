import { describe, it, expect, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const configPath = require.resolve("../../src/config");
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true,
  exports: { elasticsearch: { safeFrom: 9000 } },
};

let mod;
beforeEach(() => {
  // Reset module so the in-memory _cache Map starts empty each test
  const sutPath = require.resolve("../../src/utils/searchCursorCache");
  delete require.cache[sutPath];
  mod = require("../../src/utils/searchCursorCache");
});

describe("utils/searchCursorCache > buildQueryHash", () => {
  it("excludes pagination keys (take/skip/page/page_size) and sorts entries", () => {
    const a = mod.buildQueryHash({ keyword: "x", country: "us", take: 10, skip: 0, page: 1, page_size: 20 });
    const b = mod.buildQueryHash({ country: "us", keyword: "x" }); // different order, no pagination
    expect(a).toBe(b);
  });

  it("different filters produce different hashes", () => {
    expect(mod.buildQueryHash({ q: "a" })).not.toBe(mod.buildQueryHash({ q: "b" }));
  });
});

describe("utils/searchCursorCache > saveCursor + getCursor", () => {
  it("no-op when esHits empty/undefined", () => {
    mod.saveCursor("h1", 0, 10, []);
    mod.saveCursor("h1", 0, 10, undefined);
    expect(mod.getCursor("h1", 10)).toBeNull();
  });

  it("no-op when last hit has no .sort", () => {
    mod.saveCursor("h1", 0, 10, [{ _id: "x" }]); // no sort
    expect(mod.getCursor("h1", 10)).toBeNull();
  });

  it("saves last hit's sort values under `hash:from+size` key", () => {
    mod.saveCursor("h1", 9000, 100, [{ sort: [111] }, { sort: [222] }]);
    expect(mod.getCursor("h1", 9100)).toEqual([222]);
  });

  it("getCursor returns null for unknown key", () => {
    expect(mod.getCursor("nope", 9000)).toBeNull();
  });

  it("re-inserting same key updates LRU order without growing size", () => {
    mod.saveCursor("h1", 0, 10, [{ sort: [1] }]);
    mod.saveCursor("h1", 0, 10, [{ sort: [2] }]); // overwrite with new sort
    expect(mod.getCursor("h1", 10)).toEqual([2]);
  });
});

describe("utils/searchCursorCache > LRU eviction (line 33)", () => {
  it("evicts oldest entry when cache exceeds MAX_SIZE (2000)", () => {
    // Fill cache past MAX_SIZE
    for (let i = 0; i < 2001; i++) {
      mod.saveCursor("h", i * 10, 10, [{ sort: [i] }]);
    }
    // The very first key (h:10) should have been evicted
    expect(mod.getCursor("h", 10)).toBeNull();
    // The most recent key should still be present
    expect(mod.getCursor("h", 20010)).toEqual([2000]);
  });
});

describe("utils/searchCursorCache > SAFE_FROM export", () => {
  it("exports SAFE_FROM = 9000 (from config)", () => {
    expect(mod.SAFE_FROM).toBe(9000);
  });
});

describe("utils/searchCursorCache > SAFE_FROM fallback", () => {
  it("falls back to literal 9000 when config.elasticsearch missing", () => {
    require.cache[configPath].exports = {}; // no elasticsearch key
    const sutPath = require.resolve("../../src/utils/searchCursorCache");
    delete require.cache[sutPath];
    const freshMod = require("../../src/utils/searchCursorCache");
    expect(freshMod.SAFE_FROM).toBe(9000);
    // Restore
    require.cache[configPath].exports = { elasticsearch: { safeFrom: 9000 } };
  });
});
