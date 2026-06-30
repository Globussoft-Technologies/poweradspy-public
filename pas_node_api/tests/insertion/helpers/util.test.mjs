import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { isNullLike, normalizeNullLike, sanitizePayload, latin1SafeUrl, latin1SafeUrlCols } = require("../../../src/insertion/helpers/util");

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

describe("insertion/helpers/util > latin1SafeUrl", () => {
  it("leaves a pure-ASCII URL untouched", () => {
    const url = "https://example.com/p?utm_term=sale-2026&id=120247975582120006";
    expect(latin1SafeUrl(url)).toBe(url);
  });

  it("percent-encodes CJK so the result is pure latin1 and fully recoverable", () => {
    const decoded = "utm_term=Image-UK-现货-260626"; // post-urldecode value that broke the insert
    const safe = latin1SafeUrl(decoded);
    expect(/^[\x00-\xFF]*$/.test(safe)).toBe(true); // binds to a latin1 column
    expect(safe).toBe("utm_term=Image-UK-%E7%8E%B0%E8%B4%A7-260626");
    expect(decodeURIComponent(safe)).toBe(decoded); // no data loss
  });

  it("encodes astral chars (emoji) without splitting the surrogate pair", () => {
    expect(latin1SafeUrl("a😀b")).toBe("a%F0%9F%98%80b");
  });

  it("passes non-string / nullish values through unchanged", () => {
    expect(latin1SafeUrl(null)).toBeNull();
    expect(latin1SafeUrl(undefined)).toBeUndefined();
    expect(latin1SafeUrl(123)).toBe(123);
  });
});

describe("insertion/helpers/util > latin1SafeUrlCols", () => {
  it("sanitizes only destination_url / initial_url and leaves other columns alone", () => {
    const obj = { destination_url: "x/现货", initial_url: "y/现货", title: "现货 copy", id: 7 };
    latin1SafeUrlCols(obj);
    expect(obj.destination_url).toBe("x/%E7%8E%B0%E8%B4%A7");
    expect(obj.initial_url).toBe("y/%E7%8E%B0%E8%B4%A7");
    expect(obj.title).toBe("现货 copy"); // utf8mb4 text columns must NOT be mangled
    expect(obj.id).toBe(7);
  });
});
