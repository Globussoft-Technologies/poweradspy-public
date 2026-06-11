import { describe, it, expect } from "vitest";
import { cn } from "../../src/lib/utils.js";

describe("lib/utils > cn", () => {
  it("joins string args", () => {
    expect(cn("a", "b")).toBe("a b");
  });
  it("filters falsy values", () => {
    expect(cn("a", null, undefined, false, "b")).toBe("a b");
  });
  it("respects clsx object form (key: bool)", () => {
    expect(cn({ a: true, b: false, c: true })).toBe("a c");
  });
  it("merges tailwind classes via twMerge (later wins)", () => {
    // twMerge dedupes conflicting tailwind classes
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
  it("returns empty string for no args", () => {
    expect(cn()).toBe("");
  });
});
