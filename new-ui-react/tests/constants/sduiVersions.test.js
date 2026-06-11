import { describe, it, expect } from "vitest";
import {
  CLIENT_VERSION,
  SUPPORTED_SCHEMA_MAJOR,
  SDUI_BASE,
  CACHE_TTL,
  POLL_INTERVAL,
} from "../../src/constants/sduiVersions.js";

describe("constants/sduiVersions", () => {
  it("CLIENT_VERSION is a non-empty semver-ish string", () => {
    expect(typeof CLIENT_VERSION).toBe("string");
    expect(CLIENT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it("SUPPORTED_SCHEMA_MAJOR is a positive integer", () => {
    expect(Number.isInteger(SUPPORTED_SCHEMA_MAJOR)).toBe(true);
    expect(SUPPORTED_SCHEMA_MAJOR).toBeGreaterThanOrEqual(1);
  });
  it("SDUI_BASE is a string URL", () => {
    expect(typeof SDUI_BASE).toBe("string");
    expect(SDUI_BASE.length).toBeGreaterThan(0);
  });
  it("CACHE_TTL is 5 minutes in ms", () => {
    expect(CACHE_TTL).toBe(5 * 60 * 1000);
  });
  it("POLL_INTERVAL is 30 seconds in ms", () => {
    expect(POLL_INTERVAL).toBe(30_000);
  });
});
