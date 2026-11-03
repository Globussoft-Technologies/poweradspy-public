import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { BlockedAttemptLogger } = require("../../../src/compliance/blocklist/attempts");
import { makeConfig } from "./helpers.mjs";

const log = { info() {}, warn: vi.fn(), error() {} };
const row = (n, network = "reddit") => ({ network, platform_ad_id: String(n), blocklist_id: 1, match_type: "ad_id" });

function make({ insertAttempts = vi.fn(async () => ({})), getSql = () => ({}), raw = {} } = {}) {
  const config = makeConfig({ enabled: true, attempts: { batchSize: 100, maxQueue: 100, ...raw } });
  return { logger: new BlockedAttemptLogger({ repository: { insertAttempts }, getSql, config, log }), insertAttempts };
}

describe("compliance/blocklist > BlockedAttemptLogger", () => {
  it("record() is synchronous and does not write until a flush", () => {
    const { logger, insertAttempts } = make();
    logger.record(row(1));
    expect(logger.queue).toHaveLength(1);
    expect(insertAttempts).not.toHaveBeenCalled();
  });

  it("writes queued rows in one statement per network on flush", async () => {
    const { logger, insertAttempts } = make();
    [row(1), row(2), row(3, "quora")].forEach((r) => logger.record(r));
    await logger.flush();
    expect(insertAttempts).toHaveBeenCalledTimes(2);
    expect(insertAttempts.mock.calls.map(([, rows]) => rows.length).sort()).toEqual([1, 2]);
    expect(logger.queue).toHaveLength(0);
  });

  it("flushes by itself when a full batch is queued", async () => {
    const { logger, insertAttempts } = make({ raw: { batchSize: 3 } });
    [row(1), row(2), row(3)].forEach((r) => logger.record(r));
    await logger.flush();
    expect(insertAttempts).toHaveBeenCalled();
  });

  it("splits a large flush into batches", async () => {
    const { logger, insertAttempts } = make({ raw: { batchSize: 2, maxQueue: 100 } });
    for (let i = 0; i < 5; i += 1) logger.queue.push(row(i));
    await logger.flush();
    expect(insertAttempts.mock.calls.map(([, rows]) => rows.length)).toEqual([2, 2, 1]);
  });

  it("keeps rows for a retry when the write fails, and never throws", async () => {
    let fail = true;
    const { logger, insertAttempts } = make({ insertAttempts: vi.fn(async () => { if (fail) throw new Error("db down"); }) });
    logger.record(row(1));
    await expect(logger.flush()).resolves.toBeUndefined();
    expect(logger.queue).toHaveLength(1);
    fail = false;
    await logger.flush();
    expect(logger.queue).toHaveLength(0);
    expect(insertAttempts).toHaveBeenCalledTimes(2);
  });

  it("keeps rows when the network has no connection", async () => {
    const { logger } = make({ getSql: () => null });
    logger.record(row(1));
    await logger.flush();
    expect(logger.queue).toHaveLength(1);
  });

  it("drops the newest rows beyond maxQueue and counts them", () => {
    // batchSize above maxQueue so the queue is not auto-flushed while filling
    const { logger } = make({ raw: { maxQueue: 100, batchSize: 1000 } });
    for (let i = 0; i < 105; i += 1) logger.record(row(i));
    expect(logger.queue.length).toBeLessThanOrEqual(100);
    expect(logger.dropped).toBeGreaterThanOrEqual(5);
  });

  it("stop() flushes what is left", async () => {
    const { logger, insertAttempts } = make();
    logger.record(row(1));
    await logger.stop();
    expect(insertAttempts).toHaveBeenCalledTimes(1);
  });
});
