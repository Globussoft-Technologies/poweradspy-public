import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ESM service — vi.mock works reliably for both npm packages and
// relative imports here (api_tiktok_nodejs has "type":"module").

const {
  appCalls, appEnv, serverInstance, ServerCtor,
  expressFn, helmetFn, compressionFn, cookieParserFn, corsFn,
  morganFn, swaggerUiServe, swaggerUiSetup,
  fileStreamRotatorStream, fakeLogStream,
  RoutesCtor, dbInitializeSpy, DbConnectCtor,
  runCronJobSpy, swaggerAuthFn,
  loggerInfoSpy, loggerErrorSpy, loggerStream,
  configGetSpy,
} = vi.hoisted(() => {
  const appCalls = { use: [], get: [], post: [] };
  const appEnv = { current: "production" };
  const fakeApp = {
    use: vi.fn((...args) => appCalls.use.push(args)),
    get: vi.fn((path, ...handlers) => {
      // app.get('env') is a getter for env config
      if (typeof path === "string" && path === "env") return appEnv.current;
      appCalls.get.push({ path, handlers });
    }),
    post: vi.fn(),
  };
  const serverInstance = {
    listen: vi.fn((port, cb) => { if (cb) cb(); return serverInstance; }),
  };
  const ServerCtor = vi.fn(() => serverInstance);

  const expressFn = vi.fn(() => fakeApp);
  expressFn.urlencoded = vi.fn(() => "urlencoded-mw");
  expressFn.json = vi.fn(() => "json-mw");

  const helmetFn = vi.fn(() => "helmet-mw");
  const compressionFn = vi.fn(() => "compression-mw");
  const cookieParserFn = vi.fn(() => "cookie-parser-mw");
  const corsFn = vi.fn(() => "cors-mw");
  const morganFn = vi.fn((format, opts) => `morgan-${format}-mw`);
  const swaggerUiServe = "swagger-serve-mw";
  const swaggerUiSetup = vi.fn(() => "swagger-setup-mw");

  const fakeLogStream = { write: vi.fn() };
  const fileStreamRotatorStream = vi.fn(() => fakeLogStream);

  const RoutesCtor = vi.fn(function () {});
  const dbInitializeSpy = vi.fn(async () => undefined);
  const DbConnectCtor = vi.fn(function () {
    this.initialize = dbInitializeSpy;
  });

  const runCronJobSpy = vi.fn();
  const swaggerAuthFn = "swagger-auth-mw";

  const loggerInfoSpy = vi.fn();
  const loggerErrorSpy = vi.fn();
  const loggerStream = { write: vi.fn() };

  const configGetSpy = vi.fn((key) => {
    if (key === "user.port") return 3030;
    if (key === "user.host_url") return "http://localhost:3030";
    throw new Error(`unstubbed config: ${key}`);
  });

  return {
    appCalls, appEnv, serverInstance, ServerCtor,
    expressFn, helmetFn, compressionFn, cookieParserFn, corsFn,
    morganFn, swaggerUiServe, swaggerUiSetup,
    fileStreamRotatorStream, fakeLogStream,
    RoutesCtor, dbInitializeSpy, DbConnectCtor,
    runCronJobSpy, swaggerAuthFn,
    loggerInfoSpy, loggerErrorSpy, loggerStream,
    configGetSpy,
  };
});

vi.mock("express", () => {
  const fn = expressFn;
  // attach urlencoded + json as named (for express.urlencoded() etc.)
  return { default: fn };
});
vi.mock("config", () => ({ default: { get: configGetSpy } }));
vi.mock("helmet", () => ({ default: helmetFn }));
vi.mock("compression", () => ({ default: compressionFn }));
vi.mock("cookie-parser", () => ({ default: cookieParserFn }));
vi.mock("cors", () => ({ default: corsFn }));
vi.mock("morgan", () => ({ default: morganFn }));
vi.mock("swagger-ui-express", () => ({
  default: { serve: swaggerUiServe, setup: swaggerUiSetup },
}));
vi.mock("file-stream-rotator", () => ({
  default: { getStream: fileStreamRotatorStream },
}));
vi.mock("http", () => ({ Server: ServerCtor }));

vi.mock("../resources/routes/public.routes.js", () => ({ default: RoutesCtor }));
vi.mock("../resources/logs/logger.log.js", () => ({
  default: { info: loggerInfoSpy, error: loggerErrorSpy, stream: loggerStream },
}));
vi.mock("../resources/database/mysql.connection.js", () => ({
  default: DbConnectCtor,
}));
vi.mock("../utils/authentication.js", () => ({ SwaggerAuth: swaggerAuthFn }));
vi.mock("../utils/cronJob.js", () => ({ runCronJob: runCronJobSpy }));

// fs mocked via spyOn after import (fs is built-in)
import nodeFs from "fs";
let fsExistsSpy, fsMkdirSpy, fsReadFileSpy;

beforeEach(() => {
  // Reset captures
  appCalls.use.length = 0;
  appCalls.get.length = 0;
  appCalls.post.length = 0;
  ServerCtor.mockClear();
  expressFn.mockClear();
  helmetFn.mockClear();
  compressionFn.mockClear();
  cookieParserFn.mockClear();
  corsFn.mockClear();
  morganFn.mockClear();
  swaggerUiSetup.mockClear();
  fileStreamRotatorStream.mockClear();
  RoutesCtor.mockClear();
  dbInitializeSpy.mockClear().mockResolvedValue(undefined);
  DbConnectCtor.mockClear();
  runCronJobSpy.mockClear();
  loggerInfoSpy.mockClear();
  loggerErrorSpy.mockClear();
  configGetSpy.mockClear();
  serverInstance.listen.mockClear();

  fsExistsSpy = vi.spyOn(nodeFs, "existsSync").mockReturnValue(true);
  fsMkdirSpy = vi.spyOn(nodeFs, "mkdirSync").mockImplementation(() => {});
  fsReadFileSpy = vi
    .spyOn(nodeFs, "readFileSync")
    .mockReturnValue(JSON.stringify({ openapi: "3.0.0", paths: {} }));
  appEnv.current = "production"; // default
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  delete process.env.NODE_ENV;
  delete process.env.NODE_APP_INSTANCE;
  delete process.env.HOST_URL;
  delete process.env.PORT;
});

async function loadSut() {
  return await import("../project.server.js");
}

// =====================================================================
describe("project.server > middleware stack", () => {
  it("wires cors, helmet, compression, urlencoded, json, cookie-parser in order", async () => {
    await loadSut();
    await new Promise((r) => setImmediate(r));
    expect(corsFn).toHaveBeenCalledWith({ origin: "*" });
    expect(helmetFn).toHaveBeenCalled();
    expect(compressionFn).toHaveBeenCalled();
    expect(expressFn.urlencoded).toHaveBeenCalledWith({ extended: true });
    expect(expressFn.json).toHaveBeenCalledWith({ limit: "50mb" });
    expect(cookieParserFn).toHaveBeenCalled();
    // Confirm app.use received them all
    const usedArgs = appCalls.use.map((args) => args[0]);
    expect(usedArgs).toContain("cors-mw");
    expect(usedArgs).toContain("helmet-mw");
    expect(usedArgs).toContain("compression-mw");
    expect(usedArgs).toContain("urlencoded-mw");
    expect(usedArgs).toContain("json-mw");
    expect(usedArgs).toContain("cookie-parser-mw");
  });
});

describe("project.server > log directory bootstrap", () => {
  it("creates the logDir when fs.existsSync returns false", async () => {
    fsExistsSpy.mockReturnValue(false);
    await loadSut();
    expect(fsMkdirSpy).toHaveBeenCalledWith(
      expect.stringMatching(/responselogs$/),
      { recursive: true }
    );
  });

  it("skips fs.mkdirSync when logDir exists", async () => {
    fsExistsSpy.mockReturnValue(true);
    await loadSut();
    expect(fsMkdirSpy).not.toHaveBeenCalled();
  });
});

describe("project.server > file-stream-rotator + morgan", () => {
  it("creates daily log stream and wires morgan tiny + dev + custom format", async () => {
    await loadSut();
    expect(fileStreamRotatorStream).toHaveBeenCalledWith(
      expect.objectContaining({
        frequency: "daily",
        datePattern: "YYYY-MM-DD",
        max_logs: "7d",
        size: "100M",
      })
    );
    // morgan called: 'tiny' (always), 'dev' (when env != local), custom format with stream
    expect(morganFn).toHaveBeenCalledWith("tiny", { stream: loggerStream });
    expect(morganFn).toHaveBeenCalledWith("dev");
    expect(morganFn).toHaveBeenCalledWith(
      expect.stringMatching(/:method :url :status/),
      { stream: fakeLogStream }
    );
  });
});

describe("project.server > morgan dev/custom skipped when env==='local'", () => {
  it("only wires morgan('tiny') in 'local' env (no dev, no custom)", async () => {
    appEnv.current = "local";
    await loadSut();
    // Should be called exactly once — only with 'tiny'
    expect(morganFn).toHaveBeenCalledTimes(1);
    expect(morganFn).toHaveBeenCalledWith("tiny", { stream: loggerStream });
  });
});

describe("project.server > swagger setup", () => {
  it("reads swagger-api-view.json and mounts /explorer with SwaggerAuth", async () => {
    await loadSut();
    expect(fsReadFileSpy).toHaveBeenCalledWith(
      expect.stringMatching(/swagger-api-view\.json$/),
      "utf-8"
    );
    expect(swaggerUiSetup).toHaveBeenCalled();
    // app.use('/explorer', SwaggerAuth, swaggerUiServe, swaggerSetupReturn)
    const explorerUse = appCalls.use.find((args) => args[0] === "/explorer");
    expect(explorerUse).toBeDefined();
    expect(explorerUse).toContain("swagger-auth-mw");
    expect(explorerUse).toContain("swagger-serve-mw");
  });

  it("registers GET / that redirects to /explorer", async () => {
    await loadSut();
    const rootRoute = appCalls.get.find((r) => r.path === "/");
    expect(rootRoute).toBeDefined();
    const res = { redirect: vi.fn() };
    rootRoute.handlers[0]({}, res);
    expect(res.redirect).toHaveBeenCalledWith("/explorer");
  });
});

describe("project.server > keep-alive middleware", () => {
  it("registers a middleware that sets Connection + Keep-Alive headers and calls next", async () => {
    await loadSut();
    // The last anonymous middleware in appCalls.use should be the keep-alive one
    const fnMiddleware = appCalls.use.find(
      (args) => typeof args[0] === "function"
    );
    expect(fnMiddleware).toBeDefined();
    const mw = fnMiddleware[0];
    const res = { set: vi.fn() };
    const next = vi.fn();
    mw({}, res, next);
    expect(res.set).toHaveBeenCalledWith({
      Connection: "keep-alive",
      "Keep-Alive": "timeout=300",
    });
    expect(next).toHaveBeenCalled();
  });
});

describe("project.server > process error handlers", () => {
  it("logs unhandled rejections, warnings, and uncaught exceptions", async () => {
    const onSpy = vi.spyOn(process, "on");
    await loadSut();
    // process.on returns process (chain), so calls are: unhandledRejection, warning, uncaughtException
    const events = onSpy.mock.calls.map((c) => c[0]);
    expect(events).toContain("unhandledRejection");
    expect(events).toContain("warning");
    expect(events).toContain("uncaughtException");

    // Invoke each handler to cover its body
    const rejHandler = onSpy.mock.calls.find((c) => c[0] === "unhandledRejection")[1];
    rejHandler("reason-x", Promise.resolve());
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Unhandled Rejection: reason-x/)
    );

    const warnHandler = onSpy.mock.calls.find((c) => c[0] === "warning")[1];
    warnHandler("warning-x");
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Warning: warning-x/)
    );

    const uncaughtHandler = onSpy.mock.calls.find((c) => c[0] === "uncaughtException")[1];
    uncaughtHandler(new Error("uncaught-boom"));
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Uncaught Exception:/)
    );
  });
});

describe("project.server > DbConnect.initialize chain", () => {
  it("on resolve: constructs Routes(app) and starts the server", async () => {
    await loadSut();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(DbConnectCtor).toHaveBeenCalledTimes(1);
    expect(RoutesCtor).toHaveBeenCalledTimes(1);
    expect(serverInstance.listen).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(Function)
    );
    expect(loggerInfoSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Service listening on/)
    );
  });

  it("on reject: logs the error and does NOT start Routes/server", async () => {
    dbInitializeSpy.mockRejectedValueOnce(new Error("db-down"));
    await loadSut();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(loggerErrorSpy).toHaveBeenCalledWith("db-down");
    expect(RoutesCtor).not.toHaveBeenCalled();
    expect(serverInstance.listen).not.toHaveBeenCalled();
  });
});

describe("project.server > startServer cron-trigger branch", () => {
  it("runs runCronJob when NODE_ENV=production AND NODE_APP_INSTANCE==0", async () => {
    process.env.NODE_ENV = "production";
    process.env.NODE_APP_INSTANCE = "0";
    await loadSut();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(runCronJobSpy).toHaveBeenCalledTimes(1);
  });

  it("does NOT run runCronJob when NODE_APP_INSTANCE != 0", async () => {
    process.env.NODE_ENV = "production";
    process.env.NODE_APP_INSTANCE = "1";
    await loadSut();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(runCronJobSpy).not.toHaveBeenCalled();
  });

  it("does NOT run runCronJob when NODE_ENV != production", async () => {
    process.env.NODE_ENV = "development";
    process.env.NODE_APP_INSTANCE = "0";
    await loadSut();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(runCronJobSpy).not.toHaveBeenCalled();
  });

  it("uses PORT env when set, otherwise config.get('user.port')", async () => {
    process.env.PORT = "9876";
    await loadSut();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(serverInstance.listen).toHaveBeenCalledWith(
      "9876",
      expect.any(Function)
    );
  });

  it("uses HOST_URL env when set in the startup log message", async () => {
    process.env.HOST_URL = "https://api.test";
    process.env.NODE_ENV = "staging";
    await loadSut();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    expect(loggerInfoSpy).toHaveBeenCalledWith(
      expect.stringMatching(/Service listening on https:\/\/api\.test/)
    );
  });
});
