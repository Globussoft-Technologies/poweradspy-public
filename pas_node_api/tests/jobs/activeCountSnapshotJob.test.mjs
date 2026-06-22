import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── mock logger ──
const loggerPath = require.resolve("../../src/logger");
const childLog = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { createChild: vi.fn(() => childLog) },
};

// ── mock config ──
const configPath = require.resolve("../../src/config");
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true,
  exports: { crons: { timezone: "Asia/Kolkata" } },
};

// ── mock DatabaseManager: per-network getSql → fake pooled connection ──
const dbmPath = require.resolve("../../src/database/DatabaseManager");
let queries = [];
function makeConn() {
  return {
    query: vi.fn(async (sql, params) => {
      queries.push({ sql: sql.replace(/\s+/g, " ").trim(), params });
      const s = sql.trim().toUpperCase();
      if (s.startsWith("SELECT COUNT")) return [[{ cnt: 42 }], []];
      if (s.startsWith("INSERT")) return [{ affectedRows: 1 }, []];
      if (s.startsWith("DELETE")) return [{ affectedRows: 3 }, []];
      return [[], []]; // CREATE TABLE
    }),
    release: vi.fn(),
  };
}
let lastConn;
const getSql = vi.fn((network) => {
  if (network === "bing") return null; // simulate a network with no SQL connection
  return { getConnection: async () => { lastConn = makeConn(); return lastConn; } };
});
require.cache[dbmPath] = {
  id: dbmPath, filename: dbmPath, loaded: true,
  exports: { getSql },
};

const { runActiveCountSnapshot, snapshotNetwork, NETWORK_TABLES } =
  require("../../src/jobs/activeCountSnapshotJob");

beforeEach(() => { queries = []; getSql.mockClear(); });

describe("jobs/activeCountSnapshotJob > snapshotNetwork", () => {
  it("creates the table, counts the day's window, upserts, and prunes", async () => {
    const out = await snapshotNetwork("facebook", "2026-06-17", 365, "Asia/Kolkata");

    expect(queries.map((q) => q.sql.split(" ").slice(0, 2).join(" "))).toEqual([
      "CREATE TABLE", "SELECT COUNT(id)", "INSERT INTO", "DELETE FROM",
    ]);
    // count window = [day, day+1)
    const sel = queries.find((q) => q.sql.startsWith("SELECT COUNT"));
    expect(sel.sql).toContain("FROM facebook_ad WHERE last_seen >= ? AND last_seen < ?");
    expect(sel.params).toEqual(["2026-06-17 00:00:00", "2026-06-18 00:00:00"]);
    // upsert: date + count + taken_at
    const ins = queries.find((q) => q.sql.startsWith("INSERT"));
    expect(ins.params[0]).toBe("2026-06-17");
    expect(ins.params[1]).toBe(42);
    expect(typeof ins.params[2]).toBe("string");
    // prune: delete rows older than retentionDays (365 days before the date)
    const del = queries.find((q) => q.sql.startsWith("DELETE"));
    expect(del.params).toEqual(["2025-06-17"]);

    expect(out).toEqual({ network: "facebook", date: "2026-06-17", count: 42, pruned: 3 });
    expect(lastConn.release).toHaveBeenCalled();
  });

  it("skips a network with no SQL connection", async () => {
    const out = await snapshotNetwork("bing", "2026-06-17", 365, "Asia/Kolkata");
    expect(out).toEqual({ network: "bing", skipped: "no sql connection" });
    expect(queries).toHaveLength(0);
  });

  it("uses the correct main table per network", () => {
    expect(NETWORK_TABLES.youtube).toBe("youtube_ad");
    expect(NETWORK_TABLES.google).toBe("google_text_ad");
    expect(NETWORK_TABLES.linkedin).toBe("linkedin_ad");
  });
});

describe("jobs/activeCountSnapshotJob > runActiveCountSnapshot", () => {
  it("snapshots each requested network for an explicit date; skips unconnected ones", async () => {
    const { date, results } = await runActiveCountSnapshot({ date: "2026-06-17", networks: ["facebook", "bing"] });
    expect(date).toBe("2026-06-17");
    expect(results).toEqual([
      { network: "facebook", date: "2026-06-17", count: 42, pruned: 3 },
      { network: "bing", skipped: "no sql connection" },
    ]);
  });

  it("defaults the date to yesterday (in TZ) when none is given", async () => {
    const { date } = await runActiveCountSnapshot({ networks: ["facebook"] });
    // yesterday = today - 1 day; just assert it's a valid past YYYY-MM-DD < today
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    expect(date < today).toBe(true);
  });
});
