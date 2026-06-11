import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// The module caches _map/_loading at module level. We need to reset the
// module between tests for clean cache state.
let mod;
beforeEach(async () => {
  const modPath = require.resolve("../../src/utils/languageMap");
  delete require.cache[modPath];
  mod = require("../../src/utils/languageMap");
});

describe("utils/languageMap > getLanguageMap", () => {
  it("loads from SQL and caches the map", async () => {
    const sqlDb = {
      query: vi.fn(async () => [
        { iso: "en", name: "English" },
        { iso: "fr", name: "French" },
      ]),
    };
    const map = await mod.getLanguageMap(sqlDb);
    expect(map.get("EN")).toBe("English");
    expect(map.get("FR")).toBe("French");
    // Second call returns cached map without re-querying
    const map2 = await mod.getLanguageMap(sqlDb);
    expect(map2).toBe(map);
    expect(sqlDb.query).toHaveBeenCalledTimes(1);
  });

  it("concurrent calls share the in-flight promise", async () => {
    let resolve;
    const sqlDb = {
      query: vi.fn(() => new Promise((r) => { resolve = r; })),
    };
    const p1 = mod.getLanguageMap(sqlDb);
    const p2 = mod.getLanguageMap(sqlDb);
    resolve([{ iso: "en", name: "English" }]);
    const [m1, m2] = await Promise.all([p1, p2]);
    expect(m1).toBe(m2);
    expect(sqlDb.query).toHaveBeenCalledTimes(1);
  });

  it("SQL error returns empty map (catch path)", async () => {
    const sqlDb = {
      query: vi.fn(async () => { throw new Error("db-down"); }),
    };
    const map = await mod.getLanguageMap(sqlDb);
    expect(map).toBeInstanceOf(Map);
    expect(map.size).toBe(0);
  });
});

describe("utils/languageMap > resolveLanguageName", () => {
  it("returns null for falsy code", () => {
    const map = new Map();
    expect(mod.resolveLanguageName(map, null)).toBeNull();
    expect(mod.resolveLanguageName(map, undefined)).toBeNull();
    expect(mod.resolveLanguageName(map, "")).toBeNull();
  });

  it("uppercases code before lookup", () => {
    const map = new Map([["EN", "English"]]);
    expect(mod.resolveLanguageName(map, "en")).toBe("English");
    expect(mod.resolveLanguageName(map, "EN")).toBe("English");
  });

  it("falls back to raw code when not in map", () => {
    const map = new Map([["EN", "English"]]);
    expect(mod.resolveLanguageName(map, "zz")).toBe("zz");
  });
});
