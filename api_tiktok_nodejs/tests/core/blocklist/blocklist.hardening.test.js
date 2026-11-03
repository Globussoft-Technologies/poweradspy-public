import { describe, it, expect, vi, beforeEach } from "vitest";

// A refused row must not block the rest, rows already stored are never written
// twice, and non-ASCII text must not sink a whole batch.

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock("../../../Sequelize_cli/models/index.js", () => ({
  default: {
    sequelize: { query: queryMock },
    Sequelize: { QueryTypes: { SELECT: "SELECT", INSERT: "INSERT" } },
  },
}));

import { BlockedAttemptLogger, isDataError } from "../../../core/blocklist/blocklist.attempts.js";
import { insertAttempts } from "../../../core/blocklist/blocklist.repository.js";
import { buildSettings } from "../../../core/blocklist/blocklist.service.js";

const log = { info() {}, warn: vi.fn(), error: vi.fn() };
const row = (n) => ({ network: "tiktok", platform_ad_id: String(n), blocklist_id: 1, match_type: "ad_id" });
const dataError = (errno = 1366) => Object.assign(new Error("Incorrect string value"), { errno });

function make({ insertAttempts: insert, attempts = {} } = {}) {
  const config = buildSettings({ enabled: true, attempts: { batchSize: 100, maxQueue: 100, ...attempts } });
  return new BlockedAttemptLogger({ repository: { insertAttempts: insert }, config, log });
}

// braces: a returned mock would be run by vitest as a cleanup function, with no arguments
beforeEach(() => { queryMock.mockReset(); });

describe("blocklist.attempts > isDataError", () => {
  it("recognises data errors, including Sequelize's wrapped ones, and not connection errors", () => {
    for (const errno of [1048, 1264, 1265, 1292, 1364, 1366, 1406]) expect(isDataError({ errno })).toBe(true);
    expect(isDataError({ original: { errno: 1406 } })).toBe(true);
    expect(isDataError({ parent: { code: "ER_DATA_TOO_LONG" } })).toBe(true);
    for (const err of [new Error("x"), { code: "ECONNRESET" }, { errno: 2006 }, null, undefined]) expect(isDataError(err)).toBe(false);
  });
});

describe("blocklist.attempts > failure handling", () => {
  it("a row the table refuses does not block the others: they are stored, the bad one is dropped and counted", async () => {
    const stored = [];
    const insert = vi.fn(async (rows) => {
      if (rows.some((r) => r.platform_ad_id === "bad")) throw dataError();
      stored.push(...rows.map((r) => r.platform_ad_id));
    });
    const logger = make({ insertAttempts: insert });
    ["1", "bad", "3"].forEach((n) => logger.record(row(n)));
    await logger.flush();
    expect(stored).toEqual(["1", "3"]);
    expect(logger.rejected).toBe(1);
    expect(logger.queue).toHaveLength(0);
  });

  it("a connection problem part-way through keeps only the unwritten rows for the next flush", async () => {
    let calls = 0;
    const insert = vi.fn(async (rows) => {
      calls += 1;
      if (calls === 1) throw dataError();
      if (rows[0].platform_ad_id === "3") throw Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" });
    });
    const logger = make({ insertAttempts: insert });
    ["1", "2", "3", "4"].forEach((n) => logger.record(row(n)));
    await logger.flush();
    expect(logger.queue.map((r) => r.platform_ad_id)).toEqual(["3", "4"]);
  });

  it("rows already written by an earlier chunk are never written twice when a later chunk fails", async () => {
    const seen = [];
    let n = 0;
    const insert = vi.fn(async (rows) => {
      n += 1;
      if (n === 2) throw new Error("db blip");
      seen.push(...rows.map((r) => r.platform_ad_id));
    });
    const logger = make({ insertAttempts: insert, attempts: { batchSize: 2, maxQueue: 100 } });
    for (let i = 1; i <= 5; i += 1) logger.queue.push(row(i));
    await logger.flush();
    expect(seen).toEqual(["1", "2"]);
    expect(logger.queue.map((r) => r.platform_ad_id)).toEqual(["3", "4", "5"]);
    await logger.flush();
    expect(seen).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("a full outage keeps everything up to maxQueue and loses nothing else", async () => {
    const logger = make({ insertAttempts: vi.fn(async () => { throw new Error("db down"); }), attempts: { batchSize: 1000, maxQueue: 100 } });
    for (let i = 0; i < 100; i += 1) logger.record(row(i));
    await logger.flush();
    expect(logger.queue).toHaveLength(100);
    expect(logger.dropped).toBe(0);
  });
});

describe("blocklist.repository > ASCII-only columns", () => {
  it("keeps a row whose ASCII columns hold other characters, replacing them", async () => {
    queryMock.mockResolvedValue([0, 1]);
    await insertAttempts([{
      network: "tiktok", platform_ad_id: "ad-é中-1", advertiser: "Café ☕", image_url: "https://x.com/é.jpg",
      blocklist_id: 1, match_type: "ad_id", distance: null, source: "insertion:tiktok:créate",
    }]);
    const p = queryMock.mock.calls[0][1].replacements;
    expect(p[1]).toBe("ad-??-1");
    expect(p[7]).toBe("insertion:tiktok:cr?ate");
    expect(p[2]).toBe("Café ☕");
    expect(p[3]).toBe("https://x.com/é.jpg");
  });
});
