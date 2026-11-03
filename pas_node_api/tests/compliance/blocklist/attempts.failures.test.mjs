import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

import { makeConfig } from "./helpers.mjs";

const { BlockedAttemptLogger, isDataError } = require("../../../src/compliance/blocklist/attempts");

// Failures are handled by kind: a refused row is isolated, a connection problem
// is retried, and rows already stored are never written twice.

const log = { info() {}, warn: vi.fn(), error: vi.fn() };
const row = (n) => ({ network: "reddit", platform_ad_id: String(n), blocklist_id: 1, match_type: "ad_id" });
const dataError = (errno = 1366) => Object.assign(new Error("Incorrect string value"), { errno, code: "ER_TRUNCATED_WRONG_VALUE_FOR_FIELD" });

function make({ insertAttempts, attempts = {} } = {}) {
  const config = makeConfig({ attempts: { batchSize: 100, maxQueue: 100, ...attempts } });
  return new BlockedAttemptLogger({ repository: { insertAttempts }, getSql: () => ({}), config, log });
}

describe("attempts > isDataError", () => {
  it("recognises the errors a retry can never fix", () => {
    for (const errno of [1048, 1264, 1265, 1292, 1364, 1366, 1406]) expect(isDataError({ errno })).toBe(true);
    for (const code of ["ER_DATA_TOO_LONG", "ER_BAD_NULL_ERROR", "ER_NO_DEFAULT_FOR_FIELD", "WARN_DATA_TRUNCATED"]) {
      expect(isDataError({ code })).toBe(true);
    }
    expect(isDataError({ original: { errno: 1406 } })).toBe(true);
    expect(isDataError({ parent: { code: "ER_DATA_TOO_LONG" } })).toBe(true);
  });

  it("treats connection and other errors as retryable", () => {
    for (const err of [new Error("x"), { code: "ECONNRESET" }, { errno: 2006 }, { errno: 1213 }, null, undefined]) {
      expect(isDataError(err)).toBe(false);
    }
  });
});

describe("attempts > a row the table refuses", () => {
  it("does not block the others: they are stored, the bad one is dropped and counted", async () => {
    const stored = [];
    const insertAttempts = vi.fn(async (sql, rows) => {
      if (rows.some((r) => r.platform_ad_id === "bad")) throw dataError();
      stored.push(...rows.map((r) => r.platform_ad_id));
    });
    const logger = make({ insertAttempts });
    ["1", "bad", "3"].forEach((n) => logger.record(row(n)));
    await logger.flush();
    expect(stored).toEqual(["1", "3"]);
    expect(logger.rejected).toBe(1);
    expect(logger.queue).toHaveLength(0); // nothing is retried forever
  });

  it("works for every data error kind (too long, NOT NULL, no default, truncated, out of range)", async () => {
    for (const errno of [1406, 1048, 1364, 1265, 1292, 1264]) {
      const insertAttempts = vi.fn(async (sql, rows) => {
        if (rows.length > 1 || rows[0].platform_ad_id === "bad") throw dataError(errno);
      });
      const logger = make({ insertAttempts });
      logger.record(row("bad"));
      logger.record(row("ok"));
      await logger.flush();
      expect(logger.rejected).toBe(1);
      expect(logger.queue).toHaveLength(0);
    }
  });

  it("recognises a wrapped (Sequelize-style) error", async () => {
    const insertAttempts = vi.fn(async (sql, rows) => {
      if (rows.length > 1) throw Object.assign(new Error("x"), { original: { errno: 1406 } });
    });
    const logger = make({ insertAttempts });
    logger.record(row(1));
    logger.record(row(2));
    await logger.flush();
    expect(logger.queue).toHaveLength(0);
    expect(logger.rejected).toBe(0);
  });

  it("a connection problem part-way through keeps only the unwritten rows for the next flush", async () => {
    let calls = 0;
    const insertAttempts = vi.fn(async (sql, rows) => {
      calls += 1;
      if (calls === 1) throw dataError(); // the batch has a bad row -> row by row
      if (rows[0].platform_ad_id === "3") throw Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" });
    });
    const logger = make({ insertAttempts });
    ["1", "2", "3", "4"].forEach((n) => logger.record(row(n)));
    await logger.flush();
    expect(logger.queue.map((r) => r.platform_ad_id)).toEqual(["3", "4"]); // 1 and 2 were stored, not repeated
  });
});

describe("attempts > rows already written are never written again", () => {
  it("when a later chunk fails, only the chunks not yet stored are retried", async () => {
    const seen = [];
    let n = 0;
    const insertAttempts = vi.fn(async (sql, rows) => {
      n += 1;
      if (n === 2) throw new Error("db blip");
      seen.push(...rows.map((r) => r.platform_ad_id));
    });
    const logger = make({ insertAttempts, attempts: { batchSize: 2, maxQueue: 100 } });
    for (let i = 1; i <= 5; i += 1) logger.queue.push(row(i));
    await logger.flush();
    expect(seen).toEqual(["1", "2"]);
    expect(logger.queue.map((r) => r.platform_ad_id)).toEqual(["3", "4", "5"]);
    await logger.flush();
    expect(seen).toEqual(["1", "2", "3", "4", "5"]); // each stored exactly once
  });

  it("a full database outage keeps everything (bounded by maxQueue) and loses nothing else", async () => {
    const logger = make({ insertAttempts: vi.fn(async () => { throw new Error("db down"); }), attempts: { batchSize: 1000, maxQueue: 100 } });
    for (let i = 0; i < 100; i += 1) logger.record(row(i));
    await logger.flush();
    expect(logger.queue).toHaveLength(100);
    expect(logger.dropped).toBe(0);
    expect(logger.rejected).toBe(0);
  });
});
