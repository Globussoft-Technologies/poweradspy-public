import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
import fs from "fs";

// SUT does `createRequire(import.meta.url); require('winston')` — this bypasses
// vi.mock entirely. Replace winston in Node's CJS require.cache BEFORE the SUT
// is loaded. Same for winston-daily-rotate-file (required for side-effects).
const require = createRequire(import.meta.url);

const transportInstances = [];
function DailyRotateFile(opts) {
  this.opts = opts;
  transportInstances.push(this);
}
const loggers = [];
function createLogger(cfg) {
  const inst = {
    cfg,
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
  loggers.push(inst);
  return inst;
}
const winstonMock = {
  createLogger,
  format: {
    combine: vi.fn(() => "combined-format"),
    timestamp: vi.fn(() => "timestamp-format"),
    label: vi.fn(),
    prettyPrint: vi.fn(() => "pretty-format"),
  },
  transports: { DailyRotateFile },
};
const winstonPath = require.resolve("winston");
require.cache[winstonPath] = {
  id: winstonPath, filename: winstonPath, loaded: true, exports: winstonMock,
};
const dailyRotatePath = require.resolve("winston-daily-rotate-file");
require.cache[dailyRotatePath] = {
  id: dailyRotatePath, filename: dailyRotatePath, loaded: true, exports: {},
};

let existsSyncSpy, mkdirSyncSpy;

function freshLoad() {
  // The SUT itself is ESM but we must reset its module-level state. Use
  // vitest's dynamic import with `vi.resetModules()` to force re-evaluation.
  return import("../../../resources/logs/logger.log.js");
}

beforeEach(() => {
  transportInstances.length = 0;
  loggers.length = 0;
  existsSyncSpy = vi.spyOn(fs, "existsSync").mockReturnValue(true);
  mkdirSyncSpy = vi.spyOn(fs, "mkdirSync").mockImplementation(() => {});
  vi.resetModules();
});

describe("resources/logs/logger.log", () => {
  it("creates a winston DailyRotateFile transport with the documented options", async () => {
    await freshLoad();
    const t = transportInstances[0];
    expect(t.opts.filename).toBe("resources/logs/responselogs/users%DATE%.log");
    expect(t.opts.datePattern).toBe("DD-MM-YYYY");
    expect(t.opts.maxFiles).toBe("3d");
  });

  it("registers a stream.write that delegates to logger.info", async () => {
    const { default: logger } = await freshLoad();
    expect(typeof logger.stream.write).toBe("function");
    logger.stream.write("hello");
    expect(logger.info).toHaveBeenCalledWith("hello");
  });

  it("when responselogs dir does not exist, calls fs.mkdirSync", async () => {
    existsSyncSpy.mockReturnValue(false);
    await freshLoad();
    expect(mkdirSyncSpy).toHaveBeenCalledWith("resources/logs/responselogs");
  });

  it("ENV=default sets transport level to 'debug'", async () => {
    const prev = process.env.ENV;
    process.env.ENV = "default";
    await freshLoad();
    expect(transportInstances[0].opts.level).toBe("debug");
    if (prev === undefined) delete process.env.ENV; else process.env.ENV = prev;
  });
});
