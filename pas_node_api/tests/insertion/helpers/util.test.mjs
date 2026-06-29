import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { isNullLike, normalizeNullLike, sanitizePayload } = require("../../../src/insertion/helpers/util");

describe("insertion/helpers/util > isNullLike", () => {
  it("returns true for undefined, null, empty string and case-insensitive 'null'", () => {
    expect(isNullLike(undefined)).toBe(true);
    expect(isNullLike(null)).toBe(true);
    expect(isNullLike("")).toBe(true);
    expect(isNullLike("null")).toBe(true);
    expect(isNullLike("NULL")).toBe(true);
    expect(isNullLike("Null")).toBe(true);
    expect(isNullLike("  null  ")).toBe(true);
  });

  it("returns false for real values", () => {
    expect(isNullLike(0)).toBe(false);
    expect(isNullLike(false)).toBe(false);
    expect(isNullLike("0")).toBe(false);
    expect(isNullLike("US")).toBe(false);
    expect(isNullLike([])).toBe(false);
    expect(isNullLike({})).toBe(false);
  });
});

describe("insertion/helpers/util > normalizeNullLike", () => {
  it("converts null-like values to null and leaves real values unchanged", () => {
    expect(normalizeNullLike("null")).toBeNull();
    expect(normalizeNullLike("")).toBeNull();
    expect(normalizeNullLike(undefined)).toBeNull();
    expect(normalizeNullLike(null)).toBeNull();
    expect(normalizeNullLike("US")).toBe("US");
    expect(normalizeNullLike(0)).toBe(0);
    expect(normalizeNullLike(false)).toBe(false);
  });
});

describe("insertion/helpers/util > sanitizePayload", () => {
  it("strips null-like entries from arrays while preserving real items", () => {
    expect(sanitizePayload(["US", "null", "", "CA", null])).toEqual(["US", "CA"]);
  });

  it("keeps object keys but normalizes null-like scalar values", () => {
    const out = sanitizePayload({ a: "null", b: "", c: "US", d: null });
    expect(out).toEqual({ a: null, b: null, c: "US", d: null });
  });

  it("recursively sanitizes nested objects and arrays", () => {
    const out = sanitizePayload({
      country: ["null", "US", ""],
      meta: { title: "null", views: 100 },
      tags: ["", null, "sale"],
    });
    expect(out).toEqual({
      country: ["US"],
      meta: { title: null, views: 100 },
      tags: ["sale"],
    });
  });

  it("preserves dates and numbers", () => {
    const d = new Date("2024-01-01");
    const out = sanitizePayload({ date: d, count: 42, zero: 0, flag: false });
    expect(out.date).toBeInstanceOf(Date);
    expect(out.count).toBe(42);
    expect(out.zero).toBe(0);
    expect(out.flag).toBe(false);
  });
});
