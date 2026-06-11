import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── Mock express ──────────────────────
const expressPath = require.resolve("express");
function FakeApp() {
  const app = {
    _settings: {}, _middleware: [], _routes: { get: {}, post: {}, use: [] },
    set: vi.fn((k, v) => { app._settings[k] = v; }),
    use: vi.fn((...args) => { app._routes.use.push(args); }),
    get: vi.fn((path, ...rest) => { app._routes.get[path] = rest[rest.length - 1]; }),
    post: vi.fn((path, ...rest) => { app._routes.post[path] = rest[rest.length - 1]; }),
  };
  return app;
}
const expressFn = vi.fn(() => FakeApp());
expressFn.json = vi.fn(() => "json-mw");
expressFn.urlencoded = vi.fn(() => "urlencoded-mw");
require.cache[expressPath] = {
  id: expressPath, filename: expressPath, loaded: true, exports: expressFn,
};

// ── Mock cookie-parser ──────────────
const cookieParserPath = require.resolve("cookie-parser");
require.cache[cookieParserPath] = {
  id: cookieParserPath, filename: cookieParserPath, loaded: true,
  exports: vi.fn(() => "cookie-parser-mw"),
};

// ── Mock config ──────────────
const configPath = require.resolve("../src/config");
const configExports = {
  trustProxy: 1, bodyLimit: "1mb", isDev: true, env: "test",
  jwt: { expiresIn: "1d" }, admin: { enabled: true },
  notifications: { enabled: true },
  amember: { frontendUrl: "http://fe" },
};
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true, exports: configExports,
};

// ── Mock logger ──────────────
const loggerPath = require.resolve("../src/logger");
const childLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { createChild: vi.fn(() => childLog), requestMiddleware: vi.fn(() => "request-mw") },
};

// ── Mock databaseManager ──────────────
const dbMgrPath = require.resolve("../src/database/DatabaseManager");
const dbManager = { connectAll: vi.fn(async () => {}) };
require.cache[dbMgrPath] = {
  id: dbMgrPath, filename: dbMgrPath, loaded: true, exports: dbManager,
};

// ── Mock config/networks ──────────────
const netCfgPath = require.resolve("../src/config/networks");
require.cache[netCfgPath] = {
  id: netCfgPath, filename: netCfgPath, loaded: true, exports: { facebook: { enabled: true } },
};

// ── Mock serviceRegistry ──────────────
const regPath = require.resolve("../src/services/ServiceRegistry");
const serviceRegistry = {
  loadAll: vi.fn(), injectDatabases: vi.fn(), registerRoutes: vi.fn(), size: 5,
};
require.cache[regPath] = {
  id: regPath, filename: regPath, loaded: true, exports: serviceRegistry,
};

// ── Mock HealthCheck ──────────────
const healthPath = require.resolve("../src/health/HealthCheck");
const HealthCheck = { register: vi.fn() };
require.cache[healthPath] = {
  id: healthPath, filename: healthPath, loaded: true, exports: HealthCheck,
};

// ── Mock metricsDB ──────────────
const metricsDBPath = require.resolve("../src/metrics/MetricsDB");
const metricsDB = { init: vi.fn(async () => {}) };
require.cache[metricsDBPath] = {
  id: metricsDBPath, filename: metricsDBPath, loaded: true, exports: metricsDB,
};

// ── Mock middleware ──────────────
const reqIdPath = require.resolve("../src/middleware/requestId");
require.cache[reqIdPath] = { id: reqIdPath, filename: reqIdPath, loaded: true, exports: vi.fn(() => "reqid-mw") };

const securityPath = require.resolve("../src/middleware/security");
require.cache[securityPath] = {
  id: securityPath, filename: securityPath, loaded: true,
  exports: { helmetMiddleware: vi.fn(() => "helmet-mw"), corsMiddleware: vi.fn(() => "cors-mw") },
};

const compressionPath = require.resolve("../src/middleware/compression");
require.cache[compressionPath] = { id: compressionPath, filename: compressionPath, loaded: true, exports: vi.fn(() => "compression-mw") };

const rateLimiterPath = require.resolve("../src/middleware/rateLimiter");
require.cache[rateLimiterPath] = {
  id: rateLimiterPath, filename: rateLimiterPath, loaded: true,
  exports: { globalLimiter: "global-limiter", ipBlocklistMiddleware: "ip-blocklist" },
};

const metricsMwPath = require.resolve("../src/middleware/metricsMiddleware");
require.cache[metricsMwPath] = { id: metricsMwPath, filename: metricsMwPath, loaded: true, exports: vi.fn(() => "metrics-mw") };

const errHandlerPath = require.resolve("../src/middleware/errorHandler");
require.cache[errHandlerPath] = {
  id: errHandlerPath, filename: errHandlerPath, loaded: true,
  exports: {
    notFoundHandler: "404-handler",
    globalErrorHandler: "error-handler",
    asyncHandler: (fn) => fn,
    AppError: class {},
  },
};

const authMwPath = require.resolve("../src/middleware/auth");
require.cache[authMwPath] = {
  id: authMwPath, filename: authMwPath, loaded: true,
  exports: { generateToken: vi.fn(() => "jwt-token"), authMiddleware: vi.fn() },
};

// ── Mock routes ──────────────
const adminRoutesPath = require.resolve("../src/admin/adminRoutes");
require.cache[adminRoutesPath] = { id: adminRoutesPath, filename: adminRoutesPath, loaded: true, exports: "admin-router" };

const authRoutesPath = require.resolve("../src/auth/authRoutes");
require.cache[authRoutesPath] = { id: authRoutesPath, filename: authRoutesPath, loaded: true, exports: "auth-router" };

const amemberAuthPath = require.resolve("../src/auth/amemberAuth");
require.cache[amemberAuthPath] = { id: amemberAuthPath, filename: amemberAuthPath, loaded: true, exports: "amember-router" };

const swaggerPath = require.resolve("../src/docs/swaggerRoute");
const mountSwagger = vi.fn();
require.cache[swaggerPath] = { id: swaggerPath, filename: swaggerPath, loaded: true, exports: mountSwagger };

const sduiRoutesPath = require.resolve("../src/services/sdui/routes");
require.cache[sduiRoutesPath] = { id: sduiRoutesPath, filename: sduiRoutesPath, loaded: true, exports: { createSduiRouter: vi.fn(() => "sdui-router") } };

const commonRoutesPath = require.resolve("../src/services/common/routes/commonRoutes");
require.cache[commonRoutesPath] = { id: commonRoutesPath, filename: commonRoutesPath, loaded: true, exports: "common-router" };

// ── Pre-cache pushNotificationCron (lazy required) ──────────────
const cronJobsPath = require.resolve("../src/jobs/pushNotificationCron");
const cronInits = {
  initPushNotificationCron: vi.fn(),
  initDailyMailUpdateCron: vi.fn(),
  initDailyResetCron: vi.fn(),
  initUpdateKeywordStatusCron: vi.fn(),
};
require.cache[cronJobsPath] = { id: cronJobsPath, filename: cronJobsPath, loaded: true, exports: cronInits };

const createApp = require("../src/app");

function mkRes() {
  const r = { statusCode: 200, body: null, cookies: {}, redirectedTo: null };
  r.status = vi.fn((c) => { r.statusCode = c; return r; });
  r.json = vi.fn((b) => { r.body = b; return r; });
  r.cookie = vi.fn((n, v, opts) => { r.cookies[n] = { v, opts }; return r; });
  r.redirect = vi.fn((u) => { r.redirectedTo = u; });
  r.sendFile = vi.fn();
  return r;
}

beforeEach(() => {
  metricsDB.init.mockClear();
  dbManager.connectAll.mockClear();
  serviceRegistry.loadAll.mockClear();
  serviceRegistry.injectDatabases.mockClear();
  serviceRegistry.registerRoutes.mockClear();
  HealthCheck.register.mockClear();
  mountSwagger.mockClear();
  Object.values(cronInits).forEach(fn => fn.mockClear());
  Object.values(childLog).forEach(fn => fn.mockClear());
  delete process.env.WORKER_ID;
});

describe("app > createApp", () => {
  it("returns a configured express app instance", async () => {
    const app = await createApp();
    expect(metricsDB.init).toHaveBeenCalled();
    expect(dbManager.connectAll).toHaveBeenCalled();
    expect(serviceRegistry.loadAll).toHaveBeenCalled();
    expect(serviceRegistry.injectDatabases).toHaveBeenCalled();
    expect(HealthCheck.register).toHaveBeenCalledWith(app);
    expect(serviceRegistry.registerRoutes).toHaveBeenCalledWith(app);
    expect(mountSwagger).toHaveBeenCalledWith(app);
    expect(app._settings["trust proxy"]).toBe(1);
  });

  it("registers admin router when admin.enabled !== false", async () => {
    configExports.admin.enabled = true;
    const app = await createApp();
    expect(app._routes.use.some(c => c[0] === "/admin" && c[1] === "admin-router")).toBe(true);
  });

  it("admin router NOT registered when admin.enabled=false", async () => {
    configExports.admin.enabled = false;
    const app = await createApp();
    expect(app._routes.use.some(c => c[0] === "/admin")).toBe(false);
    configExports.admin.enabled = true;
  });

  it("dev mode registers /dev/token and /dev/local-login and /sse-test", async () => {
    configExports.isDev = true;
    const app = await createApp();
    expect(app._routes.post["/dev/token"]).toBeDefined();
    expect(app._routes.get["/dev/local-login"]).toBeDefined();
    expect(app._routes.get["/sse-test"]).toBeDefined();
  });

  it("non-dev mode does not register dev routes", async () => {
    configExports.isDev = false;
    const app = await createApp();
    expect(app._routes.post["/dev/token"]).toBeUndefined();
    expect(app._routes.get["/dev/local-login"]).toBeUndefined();
    configExports.isDev = true;
  });

  it("/dev/token returns generated token", async () => {
    configExports.isDev = true;
    const app = await createApp();
    const handler = app._routes.post["/dev/token"];
    const res = mkRes();
    handler({ body: { id: "u" } }, res);
    expect(res.body.data.token).toBe("jwt-token");
  });

  it("/dev/token uses default payload when body missing", async () => {
    configExports.isDev = true;
    const app = await createApp();
    const handler = app._routes.post["/dev/token"];
    const res = mkRes();
    handler({ body: null }, res);
    expect(res.body.success).toBe(true);
  });

  it("/dev/local-login sets cookie + redirects to frontend", async () => {
    configExports.isDev = true;
    const app = await createApp();
    const handler = app._routes.get["/dev/local-login"];
    const res = mkRes();
    handler({}, res);
    expect(res.cookies.authToken.v).toBe("jwt-token");
    expect(res.redirectedTo).toContain("?token=jwt-token");
  });

  it("/dev/local-login falls back to localhost frontend when config missing", async () => {
    configExports.amember = {};
    configExports.isDev = true;
    const app = await createApp();
    const handler = app._routes.get["/dev/local-login"];
    const res = mkRes();
    handler({}, res);
    expect(res.redirectedTo).toContain("localhost:5173");
    configExports.amember = { frontendUrl: "http://fe" };
  });

  it("/sse-test sends sse-test.html", async () => {
    configExports.isDev = true;
    const app = await createApp();
    const handler = app._routes.get["/sse-test"];
    const res = mkRes();
    handler({}, res);
    expect(res.sendFile).toHaveBeenCalled();
  });

  it("worker_id=1 → cron jobs init", async () => {
    delete process.env.WORKER_ID;
    configExports.notifications = { enabled: true };
    await createApp();
    expect(cronInits.initPushNotificationCron).toHaveBeenCalled();
    expect(cronInits.initDailyMailUpdateCron).toHaveBeenCalled();
    expect(cronInits.initDailyResetCron).toHaveBeenCalled();
    expect(cronInits.initUpdateKeywordStatusCron).toHaveBeenCalled();
  });

  it("worker_id=2 → cron jobs NOT init", async () => {
    process.env.WORKER_ID = "2";
    await createApp();
    expect(cronInits.initPushNotificationCron).not.toHaveBeenCalled();
  });

  it("notifications.enabled=false → cron jobs NOT init", async () => {
    delete process.env.WORKER_ID;
    configExports.notifications = { enabled: false };
    await createApp();
    expect(cronInits.initPushNotificationCron).not.toHaveBeenCalled();
    configExports.notifications = { enabled: true };
  });

  it("cron init failure caught + logged", async () => {
    delete process.env.WORKER_ID;
    cronInits.initPushNotificationCron.mockImplementationOnce(() => { throw new Error("cron-fail"); });
    await createApp();
    expect(childLog.error).toHaveBeenCalledWith(expect.stringContaining("Failed to initialize push notification crons"), expect.any(Object));
  });

  it("trustProxy default 1 when config missing", async () => {
    const orig = configExports.trustProxy;
    configExports.trustProxy = undefined;
    const app = await createApp();
    expect(app._settings["trust proxy"]).toBe(1);
    configExports.trustProxy = orig;
  });
});
