import { describe, it, expect, vi } from "vitest";
import { BlockedAttemptLogger } from "../../../core/blocklist/blocklist.attempts.js";
import { buildSettings } from "../../../core/blocklist/blocklist.service.js";

const log = { info() {}, warn: vi.fn(), error() {} };
const row = (n) => ({ network: "tiktok", platform_ad_id: String(n), blocklist_id: 1, match_type: "ad_id" });

function make({ insertAttempts = vi.fn(async () => ({})), attempts = {} } = {}) {
  const config = buildSettings({ enabled: true, attempts });
  return { logger: new BlockedAttemptLogger({ repository: { insertAttempts }, config, log }), insertAttempts };
}

describe("blocklist.attempts > BlockedAttemptLogger", () => {
  it("record() is synchronous and does not write until a flush", () => {
    const { logger, insertAttempts } = make();
    logger.record(row(1));
    expect(logger.queue).toHaveLength(1);
    expect(insertAttempts).not.toHaveBeenCalled();
  });

  it("writes queued rows in one statement on flush", async () => {
    const { logger, insertAttempts } = make();
    [row(1), row(2), row(3)].forEach((r) => logger.record(r));
    await logger.flush();
    expect(insertAttempts).toHaveBeenCalledTimes(1);
    expect(insertAttempts.mock.calls[0][0]).toHaveLength(3);
    expect(logger.queue).toHaveLength(0);
  });

  it("flushes by itself when a full batch is queued, and splits large flushes", async () => {
    const { logger, insertAttempts } = make({ attempts: { batchSize: 2, maxQueue: 1000 } });
    for (let i = 0; i < 5; i += 1) logger.queue.push(row(i));
    await logger.flush();
    expect(insertAttempts.mock.calls.map(([rows]) => rows.length)).toEqual([2, 2, 1]);
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

  it("drops the newest rows beyond maxQueue and counts them", () => {
    const { logger } = make({ attempts: { maxQueue: 100, batchSize: 1000 } });
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
