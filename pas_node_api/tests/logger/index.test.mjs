import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── Mock winston ──────────────
const winstonPath = require.resolve("winston");
let lastCreatedLogger;
const formatPrintfCalls = [];
const formatCombineCalls = [];
const consoleCtorCalls = [];
const addColorsCalls = [];
function fakeFormatFn(fn) {
  // Returns a "factory" — called as injectRequestId() then used in combine
  return () => ({ _kind: "injector", _fn: fn });
}
const fakeWinston = {
  format: Object.assign(fakeFormatFn, {
    combine: (...args) => { formatCombineCalls.push(args); return { _kind: "combine", _args: args }; },
    timestamp: (opts) => ({ _kind: "timestamp", opts }),
    errors: (opts) => ({ _kind: "errors", opts }),
    colorize: () => ({ _kind: "colorize" }),
    json: () => ({ _kind: "json" }),
    printf: (fn) => { formatPrintfCalls.push(fn); return { _kind: "printf", _fn: fn }; },
  }),
  transports: {
    Console: function (opts) { consoleCtorCalls.push(opts); this.opts = opts; },
  },
  createLogger: vi.fn((opts) => {
    lastCreatedLogger = {
      _opts: opts,
      child: vi.fn(() => ({ _isChild: true })),
      levels: {},
      error: vi.fn(),
      warn: vi.fn(),
      http: vi.fn(),
      info: vi.fn(),
    };
    return lastCreatedLogger;
  }),
  addColors: vi.fn((c) => { addColorsCalls.push(c); }),
};
require.cache[winstonPath] = {
  id: winstonPath, filename: winstonPath, loaded: true, exports: fakeWinston,
};

// ── Mock winston-daily-rotate-file ──────────────
const dailyPath = require.resolve("winston-daily-rotate-file");
const dailyCtorCalls = [];
function FakeDaily(opts) { dailyCtorCalls.push(opts); this.opts = opts; }
require.cache[dailyPath] = {
  id: dailyPath, filename: dailyPath, loaded: true, exports: FakeDaily,
};

// ── Mock config (toggleable) ──────────────
const configPath = require.resolve("../../src/config");
let configExports = {
  isDev: true,
  env: "test",
  log: { level: "info", dir: "test-logs", errorLogMaxSize: "10m", errorLogMaxDays: "5d", combinedLogMaxSize: "20m", combinedLogMaxDays: "7d", zippedArchive: true },
};
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true,
  get exports() { return configExports; },
  set exports(v) { configExports = v; },
};

const sutPath = require.resolve("../../src/logger");
function freshSut() {
  delete require.cache[sutPath];
  return require(sutPath);
}

beforeEach(() => {
  consoleCtorCalls.length = 0;
  dailyCtorCalls.length = 0;
  formatPrintfCalls.length = 0;
  formatCombineCalls.length = 0;
  addColorsCalls.length = 0;
  fakeWinston.createLogger.mockClear();
  fakeWinston.addColors.mockClear();
});

describe("logger > module load", () => {
  it("dev mode: creates logger with all transports + http level + addColors", () => {
    configExports = {
      isDev: true, env: "dev",
      log: { level: "debug", dir: "logs", errorLogMaxSize: "1m", errorLogMaxDays: "1d", combinedLogMaxSize: "2m", combinedLogMaxDays: "2d", zippedArchive: true },
    };
    const log = freshSut();
    expect(fakeWinston.createLogger).toHaveBeenCalled();
    expect(dailyCtorCalls).toHaveLength(2);
    expect(dailyCtorCalls[0].dirname).toContain("logs");
    expect(dailyCtorCalls[0].filename).toBe("error-%DATE%.log");
    expect(dailyCtorCalls[0].maxSize).toBe("1m");
    expect(dailyCtorCalls[1].filename).toBe("combined-%DATE%.log");
    // http level was missing → set + addColors invoked
    expect(addColorsCalls).toHaveLength(1);
    expect(log.levels.http).toBe(3);
  });

  it("prod mode: json formats only", () => {
    configExports = {
      isDev: false, env: "prod",
      log: { level: "warn", dir: "logs" },
    };
    freshSut();
    // Console transport opts.format should be json (object with _kind:'json')
    expect(consoleCtorCalls[0].format._kind).toBe("json");
  });

  it("missing log.dir falls back to 'logs'", () => {
    configExports = {
      isDev: false, env: "prod",
      log: { level: "info" },
    };
    freshSut();
    expect(dailyCtorCalls[0].dirname).toContain("logs");
  });

  it("missing maxSize/maxDays falls back to defaults", () => {
    configExports = {
      isDev: false, env: "prod",
      log: { level: "info" },
    };
    freshSut();
    expect(dailyCtorCalls[0].maxSize).toBe("20m");
    expect(dailyCtorCalls[0].maxFiles).toBe("30d");
    expect(dailyCtorCalls[1].maxSize).toBe("50m");
    expect(dailyCtorCalls[1].maxFiles).toBe("14d");
  });

  it("zippedArchive=false explicit → propagates", () => {
    configExports = {
      isDev: false, env: "prod",
      log: { level: "info", zippedArchive: false },
    };
    freshSut();
    expect(dailyCtorCalls[0].zippedArchive).toBe(false);
  });

  it("does NOT re-add http level when already present", () => {
    configExports = { isDev: false, env: "prod", log: { level: "info" } };
    // Pre-stuff createLogger to return a logger with existing http level
    fakeWinston.createLogger.mockImplementationOnce((opts) => ({
      _opts: opts, child: vi.fn(() => ({})),
      levels: { http: 3 }, error: vi.fn(), warn: vi.fn(), http: vi.fn(),
    }));
    freshSut();
    expect(addColorsCalls).toHaveLength(0);
  });
});

describe("logger > createChild", () => {
  it("delegates to underlying logger.child", () => {
    configExports = { isDev: false, env: "prod", log: { level: "info" } };
    const log = freshSut();
    const child = log.createChild("svc", { extra: 1 });
    expect(log.child).toHaveBeenCalledWith({ service: "svc", extra: 1 });
    expect(child._isChild).toBe(true);
  });
  it("createChild default empty extraMeta", () => {
    configExports = { isDev: false, env: "prod", log: { level: "info" } };
    const log = freshSut();
    log.createChild("svc2");
    expect(log.child).toHaveBeenCalledWith({ service: "svc2" });
  });
});

describe("logger > requestMiddleware", () => {
  function setup() {
    configExports = { isDev: false, env: "prod", log: { level: "info" } };
    return freshSut();
  }
  function runReq({ statusCode = 200 } = {}) {
    const log = setup();
    const mw = log.requestMiddleware();
    const finishCb = { cb: null };
    const req = { requestId: "rid-1", method: "GET", originalUrl: "/x", ip: "1.1.1.1", get: vi.fn(() => "UA") };
    const res = { statusCode, on: vi.fn((event, cb) => { if (event === "finish") finishCb.cb = cb; }), get: vi.fn(() => "123") };
    const next = vi.fn();
    mw(req, res, next);
    expect(next).toHaveBeenCalled();
    finishCb.cb();
    return log;
  }
  it("statusCode 500 → logger.error", () => {
    const log = runReq({ statusCode: 500 });
    expect(log.error).toHaveBeenCalled();
  });
  it("statusCode 400 → logger.warn", () => {
    const log = runReq({ statusCode: 400 });
    expect(log.warn).toHaveBeenCalled();
  });
  it("statusCode 200 → logger.http", () => {
    const log = runReq({ statusCode: 200 });
    expect(log.http).toHaveBeenCalled();
  });
});

describe("logger > injectRequestId + dev formatters", () => {
  it("injectRequestId mutates info when ctx + requestId present and info lacks it", () => {
    configExports = { isDev: true, env: "dev", log: { level: "info" } };
    freshSut();
    // First combine call is buildLogFormat's baseFormat — first arg is the injector factory result
    const injectorObj = formatCombineCalls[0][0];
    expect(injectorObj._kind).toBe("injector");
    const fn = injectorObj._fn;
    // No ctx → info passed through
    const info = { level: "info", message: "x" };
    expect(fn(info)).toBe(info);
    expect(info.requestId).toBeUndefined();
  });

  it("injectRequestId fills in requestId when ctx active (via middleware)", () => {
    configExports = { isDev: true, env: "dev", log: { level: "info" } };
    const log = freshSut();
    const injectorObj = formatCombineCalls[0][0];
    const fn = injectorObj._fn;

    const mw = log.requestMiddleware();
    const req = { requestId: "ctx-rid", method: "GET", originalUrl: "/", ip: "1.1.1.1", get: vi.fn() };
    const res = { statusCode: 200, on: vi.fn(), get: vi.fn() };
    let captured;
    const next = vi.fn(() => {
      // Inside requestContext.run scope — invoke the injector here
      const info = { level: "info", message: "x" };
      captured = fn(info);
    });
    mw(req, res, next);
    expect(captured.requestId).toBe("ctx-rid");
  });

  it("injectRequestId leaves info.requestId untouched if already set", () => {
    configExports = { isDev: true, env: "dev", log: { level: "info" } };
    const log = freshSut();
    const fn = formatCombineCalls[0][0]._fn;
    const mw = log.requestMiddleware();
    const req = { requestId: "ctx-rid", method: "GET", originalUrl: "/", ip: "1.1.1.1", get: vi.fn() };
    const res = { statusCode: 200, on: vi.fn(), get: vi.fn() };
    let captured;
    mw(req, res, () => { captured = fn({ level: "info", message: "x", requestId: "original" }); });
    expect(captured.requestId).toBe("original");
  });

  it("dev printf formatters render full + minimal info lines", () => {
    configExports = { isDev: true, env: "dev", log: { level: "info" } };
    freshSut();
    // Two printf formatters were registered (buildLogFormat dev + Console dev)
    expect(formatPrintfCalls.length).toBeGreaterThanOrEqual(2);
    const buildLogPrintf = formatPrintfCalls[0];
    const consolePrintf = formatPrintfCalls[1];

    const full = buildLogPrintf({
      timestamp: "TS", level: "info", message: "hello",
      service: "svc", requestId: "abcdefgh-rest", responseTime: 5, statusCode: 200,
      method: "GET", url: "/x", stack: "STACK", customKey: "v",
    });
    expect(full).toContain("hello");
    expect(full).toContain("[svc]");
    expect(full).toContain("[abcdefgh]");
    expect(full).toContain("GET /x");
    expect(full).toContain("→ 200");
    expect(full).toContain("(5ms)");
    expect(full).toContain("STACK");
    expect(full).toContain("customKey");

    const minimal = buildLogPrintf({ timestamp: "TS", level: "info", message: "msg" });
    expect(minimal).toBe("TS info: msg");

    const consoleFull = consolePrintf({
      timestamp: "TS", level: "warn", message: "m", service: "s", requestId: "rid", method: "POST", url: "/y", statusCode: 400, responseTime: 9, error: "boom",
    });
    expect(consoleFull).toContain("POST /y");
    expect(consoleFull).toContain("400");
    expect(consoleFull).toContain("(9ms)");
    expect(consoleFull).toContain("- boom");

    const consoleMin = consolePrintf({ timestamp: "TS", level: "warn", message: "m" });
    expect(consoleMin).toBe("TS warn: m");

    // When error === message, ' - error' suffix omitted
    const consoleDedupe = consolePrintf({ timestamp: "TS", level: "warn", message: "m", error: "m" });
    expect(consoleDedupe).toBe("TS warn: m");
  });
});
