import { describe, it, expect } from "vitest";
import convertTimeStamp, { daysRunning } from "../../utils/epochConverter.js";

describe("utils/epochConverter > daysRunning", () => {
  it("returns the rounded number of days between two ISO timestamps", () => {
    expect(daysRunning("2025-01-01T00:00:00Z", "2025-01-11T00:00:00Z")).toBe(10);
    expect(daysRunning("2025-01-01T00:00:00Z", "2025-02-01T00:00:00Z")).toBe(31);
  });

  it("rounds to the nearest whole day", () => {
    // 1.4 days -> 1
    expect(
      daysRunning("2025-01-01T00:00:00Z", "2025-01-02T09:36:00Z")
    ).toBe(1);
    // 1.6 days -> 2
    expect(
      daysRunning("2025-01-01T00:00:00Z", "2025-01-02T14:24:00Z")
    ).toBe(2);
  });

  it("returns 1 (not 0) when first==last (active-today floor)", () => {
    const t = "2025-06-15T12:00:00Z";
    expect(daysRunning(t, t)).toBe(1);
  });

  it("returns 1 when the diff rounds to 0 (sub-12-hour spans)", () => {
    expect(
      daysRunning("2025-01-01T00:00:00Z", "2025-01-01T06:00:00Z")
    ).toBe(1);
  });

  it("works with numeric epoch-millisecond inputs (Date accepts numbers too)", () => {
    expect(daysRunning(0, 86_400_000)).toBe(1);
    expect(daysRunning(0, 86_400_000 * 5)).toBe(5);
  });

  it("can return a negative number when lastSeen < firstSeen", () => {
    expect(
      daysRunning("2025-01-10T00:00:00Z", "2025-01-01T00:00:00Z")
    ).toBe(-9);
  });
});

describe("utils/epochConverter > convertTimeStamp (default export)", () => {
  it("converts a unix-epoch-seconds timestamp to UTC 'YYYY-MM-DD HH:MM:SS'", () => {
    // 1705321996 == 2024-01-15 12:33:16 UTC
    expect(convertTimeStamp(1705321996)).toBe("2024-01-15 12:33:16");
  });

  it("converts the unix epoch to '1970-01-01 00:00:00'", () => {
    expect(convertTimeStamp(0)).toBe("1970-01-01 00:00:00");
  });

  it("zero-pads single-digit months / days / hours / minutes / seconds", () => {
    // 2025-03-04 05:06:07 UTC = 1741064767
    expect(convertTimeStamp(1741064767)).toBe("2025-03-04 05:06:07");
  });

  it("preserves UTC (does not shift to local timezone)", () => {
    const out = convertTimeStamp(1700000000); // 2023-11-14 22:13:20 UTC
    expect(out).toBe("2023-11-14 22:13:20");
  });
});
