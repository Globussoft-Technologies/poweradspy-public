import { describe, it, expect } from "vitest";
import defaults, { getSDUIFallbackConfig } from "../../src/config/defaultConfig.js";

describe("config/defaultConfig > getSDUIFallbackConfig", () => {
  const cfg = getSDUIFallbackConfig();
  it("returns shape matching GET /api/sdui/config", () => {
    expect(cfg).toHaveProperty("schema_version");
    expect(cfg).toHaveProperty("config_version");
    expect(Array.isArray(cfg.searchbar)).toBe(true);
  });
  it("schema_version is semver", () => {
    expect(cfg.schema_version).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it("config_version is a number", () => {
    expect(typeof cfg.config_version).toBe("number");
  });
  it("each call returns a fresh object (not a shared reference)", () => {
    const a = getSDUIFallbackConfig();
    const b = getSDUIFallbackConfig();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
  it("searchbar contains the search_input document with autocomplete", () => {
    const sb = cfg.searchbar.find(d => d._id === "search_input");
    expect(sb).toBeDefined();
    const filter = sb.filters[0];
    expect(filter.type).toBe("autocomplete");
    expect(filter.suggestion_sources.length).toBeGreaterThan(0);
  });
});

describe("config/defaultConfig > default export", () => {
  it("default exports the same getSDUIFallbackConfig function", () => {
    expect(defaults.getSDUIFallbackConfig).toBe(getSDUIFallbackConfig);
  });
});
