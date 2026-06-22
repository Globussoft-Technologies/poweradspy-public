import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── mock node-cron ──
const cronPath = require.resolve("node-cron");
const cronSchedule = vi.fn();
const cronValidate = vi.fn((expr) => /^[\d*/, -]+( [\d*/, -]+){4}$/.test(expr));
require.cache[cronPath] = {
  id: cronPath, filename: cronPath, loaded: true,
  exports: { schedule: cronSchedule, validate: cronValidate },
};

// ── mock logger ──
const loggerPath = require.resolve("../../src/logger");
const childLog = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { createChild: vi.fn(() => childLog) },
};

// ── mock config (mutable per test) ──
const configPath = require.resolve("../../src/config");
let configExports = { crons: { timezone: "Asia/Kolkata", jobs: {} } };
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true,
  get exports() { return configExports; },
  set exports(v) { configExports = v; },
};

// ── mock the snapshot job so we don't pull in DatabaseManager ──
const jobPath = require.resolve("../../src/jobs/activeCountSnapshotJob");
const runActiveCountSnapshot = vi.fn(async () => ({ date: "x", results: [] }));
require.cache[jobPath] = {
  id: jobPath, filename: jobPath, loaded: true,
  exports: { runActiveCountSnapshot },
};

const sutPath = require.resolve("../../src/jobs/cronManager");
function freshSut() {
  delete require.cache[sutPath];
  return require("../../src/jobs/cronManager");
}

beforeEach(() => {
  cronSchedule.mockClear();
  cronValidate.mockClear();
  runActiveCountSnapshot.mockClear();
});

describe("jobs/cronManager > initConfigCrons", () => {
  it("schedules only enabled, registered jobs with a valid schedule", () => {
    configExports = {
      crons: {
        timezone: "Asia/Kolkata",
        jobs: {
          activeCountSnapshot: { enabled: true, schedule: "daily 12:05 AM", retentionDays: 365 },
          someDisabled: { enabled: false, schedule: "5 min" },
          notRegistered: { enabled: true, schedule: "5 min" },
        },
      },
    };
    const { initConfigCrons } = freshSut();
    const started = initConfigCrons();

    expect(started).toBe(1);
    expect(cronSchedule).toHaveBeenCalledTimes(1);
    const [expr, , opts] = cronSchedule.mock.calls[0];
    expect(expr).toBe("5 0 * * *");                 // "daily 12:05 AM" → 00:05
    expect(opts).toEqual({ timezone: "Asia/Kolkata" });
  });

  it("the scheduled callback runs the registered job with its config", async () => {
    configExports = {
      crons: { timezone: "Asia/Kolkata", jobs: { activeCountSnapshot: { enabled: true, schedule: "daily 12:05 AM", retentionDays: 90 } } },
    };
    const { initConfigCrons } = freshSut();
    initConfigCrons();
    const callback = cronSchedule.mock.calls[0][1];
    await callback();
    expect(runActiveCountSnapshot).toHaveBeenCalledWith({ retentionDays: 90 });
  });

  it("skips a job whose schedule is invalid", () => {
    cronValidate.mockReturnValue(false);
    configExports = {
      crons: { timezone: "Asia/Kolkata", jobs: { activeCountSnapshot: { enabled: true, schedule: "not-a-schedule-!!" } } },
    };
    const { initConfigCrons } = freshSut();
    expect(initConfigCrons()).toBe(0);
    expect(cronSchedule).not.toHaveBeenCalled();
  });

  it("does nothing when there are no jobs", () => {
    configExports = { crons: { timezone: "Asia/Kolkata", jobs: {} } };
    const { initConfigCrons } = freshSut();
    expect(initConfigCrons()).toBe(0);
  });
});
