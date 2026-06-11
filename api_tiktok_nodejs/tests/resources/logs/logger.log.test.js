import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import fs from "fs";

const require = createRequire(import.meta.url);

// Pre-require winston + winston-daily-rotate-file via Node's CJS loader
// and monkey-patch their exports on the cached module instance. The SUT
// also uses createRequire to load winston, so it resolves to the same
// cached object (Node CJS cache is path-keyed and global).
const winstonModule = require("winston");
const wdrfModule = require("winston-daily-rotate-file"); // side-effect register

// Records of every createLogger call + the DailyRotateFile constructor args
const created = { loggers: [], transports: [] };

const FakeDailyRotateFile = vi.fn(function (opts) {
  created.transports.push(opts);
  this._opts = opts;
});

const fakeFormat = {
  combine: vi.fn((...parts) => ({ __combine: parts })),
  timestamp: vi.fn(() => ({ __timestamp: true })),
  label: vi.fn(() => ({ __label: true })),
  prettyPrint: vi.fn(() => ({ __prettyPrint: true })),
};

const createLoggerSpy = vi.fn(function (cfg) {
  const fake = {
    __config: cfg,
    info: vi.fn(),
    error: vi.fn(),
  };
  created.loggers.push(fake);
  return fake;
});

winstonModule.createLogger = createLoggerSpy;
winstonModule.format = fakeFormat;
winstonModule.transports = { DailyRotateFile: FakeDailyRotateFile };

let sutModule;

beforeEach(() => {
  vi.resetModules();
  created.loggers.length = 0;
  created.transports.length = 0;
  createLoggerSpy.mockClear();
  FakeDailyRotateFile.mockClear();
  fakeFormat.combine.mockClear();
  fakeFormat.timestamp.mockClear();
  fakeFormat.prettyPrint.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ENV;
});

async function loadSut() {
  return await import("../../../resources/logs/logger.log.js");
}

describe("resources/logs/logger.log > directory bootstrap", () => {
  it("calls fs.mkdirSync('resources/logs/responselogs') when the directory does NOT exist", async () => {
    const existsSpy = vi.spyOn(fs, "existsSync").mockReturnValue(false);
    const mkdirSpy = vi.spyOn(fs, "mkdirSync").mockImplementation(() => {});
    await loadSut();
    expect(existsSpy).toHaveBeenCalledWith("resources/logs/responselogs");
    expect(mkdirSpy).toHaveBeenCalledWith("resources/logs/responselogs");
  });

  it("skips fs.mkdirSync when the directory already exists", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const mkdirSpy = vi.spyOn(fs, "mkdirSync").mockImplementation(() => {});
    await loadSut();
    expect(mkdirSpy).not.toHaveBeenCalled();
  });
});

describe("resources/logs/logger.log > transport level depends on ENV", () => {
  it("uses 'debug' level when ENV==='localDev'", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    process.env.ENV = "localDev";
    await loadSut();
    expect(FakeDailyRotateFile).toHaveBeenCalledTimes(1);
    expect(created.transports[0].level).toBe("debug");
    expect(created.transports[0].datePattern).toBe("DD-MM-YYYY");
    expect(created.transports[0].filename).toBe(
      "resources/logs/responselogs/users%DATE%.log"
    );
    expect(created.transports[0].handleExceptions).toBe(true);
    expect(created.transports[0].json).toBe(true);
    expect(created.transports[0].maxSize).toBe("1g");
    expect(created.transports[0].maxFiles).toBe("3d");
  });

  it("uses 'info' level when ENV is unset", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    await loadSut();
    expect(created.transports[0].level).toBe("info");
  });

  it("uses 'info' level when ENV is set to something other than localDev", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    process.env.ENV = "prod";
    await loadSut();
    expect(created.transports[0].level).toBe("info");
  });
});

describe("resources/logs/logger.log > createLogger config", () => {
  it("passes the transports + exitOnError:false + combine(timestamp, prettyPrint) format", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    await loadSut();
    expect(createLoggerSpy).toHaveBeenCalledTimes(1);
    const cfg = createLoggerSpy.mock.calls[0][0];
    expect(cfg.exitOnError).toBe(false);
    expect(Array.isArray(cfg.transports)).toBe(true);
    expect(cfg.transports).toHaveLength(1);
    expect(fakeFormat.timestamp).toHaveBeenCalled();
    expect(fakeFormat.prettyPrint).toHaveBeenCalled();
    expect(fakeFormat.combine).toHaveBeenCalled();
  });
});

describe("resources/logs/logger.log > logger.stream.write", () => {
  it("attaches a stream object whose write() proxies to logger.info()", async () => {
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const { default: logger } = await loadSut();
    expect(typeof logger.stream).toBe("object");
    expect(typeof logger.stream.write).toBe("function");
    logger.stream.write("hello world", "utf-8");
    expect(logger.info).toHaveBeenCalledWith("hello world");
  });
});
