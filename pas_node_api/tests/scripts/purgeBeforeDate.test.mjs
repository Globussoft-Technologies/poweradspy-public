import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseArgs, Throttle, cutoffValue, esRange, SKIP_TABLE } = require("../../scripts/purge-before-date");

describe("purge-before-date", () => {
  it("is a dry-run unless --apply, and validates the date", () => {
    const opts = parseArgs(["--before", "2023-01-01"]);
    expect(opts.apply).toBe(false);
    expect(opts.dateColumn).toBe("last_seen");
    expect(opts.networks).toContain("facebook");
    expect(() => parseArgs(["--before", "01-01-2023"])).toThrow();
    expect(() => parseArgs([])).toThrow();
    expect(() => parseArgs(["--before", "2023-01-01", "--date-column", "last_seen; DROP TABLE x"])).toThrow();
    expect(() => parseArgs(["--before", "2023-01-01", "--networks", "nope"])).toThrow();
  });

  it("grows the batch when fast, shrinks + pauses when slow or the host is busy", () => {
    const t = new Throttle({ initial: 500, min: 100, max: 3000, targetMs: 1500 });
    expect(t.next(300, false).size).toBe(700);
    expect(t.next(5000, false).size).toBe(420);
    expect(t.pauseMs).toBe(500);
    expect(t.next(100, true).size).toBe(210);
    expect(t.pauseMs).toBe(3000);
    for (let i = 0; i < 30; i += 1) t.next(10, false);
    expect(t.size).toBe(3000); // capped
    for (let i = 0; i < 30; i += 1) t.next(10, true);
    expect(t.size).toBe(100); // floored
  });

  it("writes the SQL cutoff in the column's own type", () => {
    expect(cutoffValue("2023-01-01", "datetime")).toBe("2023-01-01 00:00:00");
    expect(cutoffValue("2023-01-01", "int")).toBe(1672531200);
    expect(cutoffValue("2023-01-01", "bigint")).toBe(1672531200);
  });

  it("builds ES ranges that work for epoch and string date fields", () => {
    expect(esRange("last_seen", "2023-01-01")).toEqual({ range: { last_seen: { lt: "2023-01-01", format: "yyyy-MM-dd" } } });
    expect(esRange("a.last_seen", "2023-01-01", "datetime")).toEqual({ range: { "a.last_seen": { lt: "2023-01-01 00:00:00" } } });
  });

  it("never purges activity / log / user-list tables found by name", () => {
    for (const t of ["facebook_accounts_activities", "analytics_history", "instagram_hidden_ads", "user_favourite_ads", "insert_logs"]) {
      expect([t, SKIP_TABLE.test(t)]).toEqual([t, true]);
    }
    for (const t of ["facebook_ad_variants", "facebook_ad_url", "gdn_ad_countries", "facebook_ad_analytics"]) {
      expect([t, SKIP_TABLE.test(t)]).toEqual([t, false]);
    }
  });
});
