import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const expressPath = require.resolve("express");
const handlers = { get: {}, post: {} };
function FakeRouter() {
  return {
    get: vi.fn((path, ...rest) => { handlers.get[path] = rest; }),
    post: vi.fn((path, ...rest) => { handlers.post[path] = rest; }),
  };
}
require.cache[expressPath] = { id: expressPath, filename: expressPath, loaded: true, exports: { Router: FakeRouter } };

const authMwPath = require.resolve("../../src/middleware/auth");
const generateToken = vi.fn(() => "jwt-token");
const authMiddleware = vi.fn((req, res, next) => next());
require.cache[authMwPath] = {
  id: authMwPath, filename: authMwPath, loaded: true,
  exports: { generateToken, authMiddleware },
};

const errHandlerPath = require.resolve("../../src/middleware/errorHandler");
const asyncHandler = (fn) => fn;
require.cache[errHandlerPath] = {
  id: errHandlerPath, filename: errHandlerPath, loaded: true,
  exports: { asyncHandler },
};

const validatorPath = require.resolve("../../src/middleware/validator");
const validator = vi.fn(() => (req, res, next) => next());
require.cache[validatorPath] = {
  id: validatorPath, filename: validatorPath, loaded: true,
  exports: validator,
};

const dbPath = require.resolve("../../src/database/DatabaseManager");
const dbManager = { getSQL: vi.fn() };
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true, exports: dbManager,
};

const configPath = require.resolve("../../src/config");
let configExports = {
  env: "production", isDev: false,
  jwt: { cookieMaxAgeMs: 1000, expiresIn: "1d" },
  amember: { plans: { custom: [33, 46, 70] } },
  pricing: { activePlanGeneration: "2026-restructure" },
};
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true,
  get exports() { return configExports; },
  set exports(v) { configExports = v; },
};

const loggerPath = require.resolve("../../src/logger");
const childLog = { info: vi.fn(), error: vi.fn() };
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { createChild: vi.fn(() => childLog) },
};

const planSvcPath = require.resolve("../../src/services/planAccess/planAccessService");
const planSvc = {
  getConfig: vi.fn(),
  getAllowedPlatforms: vi.fn(() => ["facebook", "google"]),
  getFilterStatus: vi.fn(() => ({})),
  getCompetitorLimits: vi.fn(() => ({ brandLimit: 5, competitorLimit: 5 })),
  resolvePlanTier: vi.fn(() => null),
};
require.cache[planSvcPath] = {
  id: planSvcPath, filename: planSvcPath, loaded: true, exports: planSvc,
};

// bcryptjs
const bcryptPath = require.resolve("bcryptjs");
const bcryptCompare = vi.fn();
require.cache[bcryptPath] = {
  id: bcryptPath, filename: bcryptPath, loaded: true,
  exports: { compare: bcryptCompare },
};

const sutPath = require.resolve("../../src/auth/authRoutes");
function freshSut() {
  for (const k of Object.keys(handlers.get)) delete handlers.get[k];
  for (const k of Object.keys(handlers.post)) delete handlers.post[k];
  delete require.cache[sutPath];
  return require(sutPath);
}

function mkRes() {
  const r = { statusCode: 200, body: null, cookies: {} };
  r.status = vi.fn((c) => { r.statusCode = c; return r; });
  r.json = vi.fn((b) => { r.body = b; return r; });
  r.cookie = vi.fn((n, v, opts) => { r.cookies[n] = { v, opts }; return r; });
  r.clearCookie = vi.fn();
  return r;
}

function getHandler(method, path) {
  const stack = handlers[method][path];
  return stack[stack.length - 1]; // last fn in middleware chain is the handler
}

beforeEach(() => {
  configExports = {
    env: "production", isDev: false,
    jwt: { cookieMaxAgeMs: 1000, expiresIn: "1d" },
    amember: { plans: { custom: [33, 46, 70] } },
    pricing: { activePlanGeneration: "2026-restructure" },
  };
  generateToken.mockReset().mockReturnValue("jwt-token");
  bcryptCompare.mockReset();
  dbManager.getSQL.mockReset();
  childLog.info.mockClear(); childLog.error.mockClear();
  planSvc.getConfig.mockReset();
  planSvc.getAllowedPlatforms.mockReset().mockReturnValue(["facebook", "google"]);
  planSvc.getFilterStatus.mockReset().mockReturnValue({});
  planSvc.getCompetitorLimits.mockReset().mockReturnValue({ brandLimit: 5, competitorLimit: 5 });
  planSvc.resolvePlanTier.mockReset().mockReturnValue(null);
});

describe("authRoutes > module load", () => {
  it("registers login/logout/me/plan-access/plans-catalog/refresh", () => {
    freshSut();
    expect(handlers.post["/login"]).toBeDefined();
    expect(handlers.post["/logout"]).toBeDefined();
    expect(handlers.get["/me"]).toBeDefined();
    expect(handlers.get["/plan-access"]).toBeDefined();
    expect(handlers.get["/plans-catalog"]).toBeDefined();
    expect(handlers.post["/refresh"]).toBeDefined();
  });
});

describe("authRoutes > GET /plans-catalog", () => {
  it("is public — no auth middleware in its handler chain", () => {
    freshSut();
    // Only one handler registered (the route fn itself), unlike /plan-access
    // which has [authMiddleware, asyncHandler(...)].
    expect(handlers.get["/plans-catalog"].length).toBe(1);
  });

  it("defaults to 2026-restructure (4 new tiers) when config.pricing is unset", async () => {
    configExports.pricing = undefined;
    freshSut();
    const res = mkRes();
    getHandler("get", "/plans-catalog")({}, res);
    expect(res.body.code).toBe(200);
    expect(res.body.data.generation).toBe("2026-restructure");
    expect(res.body.data.plans.map((p) => p.tier)).toEqual([
      "Basic (2026)", "Standard (2026)", "Platinum (2026)", "Palladium (2026)",
    ]);
  });

  it("respects config.pricing.activePlanGeneration = 'legacy'", async () => {
    configExports.pricing = { activePlanGeneration: "legacy" };
    freshSut();
    const res = mkRes();
    getHandler("get", "/plans-catalog")({}, res);
    expect(res.body.data.generation).toBe("legacy");
    expect(res.body.data.plans.map((p) => p.tier)).toEqual([
      "Basic", "Standard", "Premium", "Platinum", "Titanium", "Palladium",
    ]);
  });

  it("'both' returns all 10 tiers, legacy first", async () => {
    configExports.pricing = { activePlanGeneration: "both" };
    freshSut();
    const res = mkRes();
    getHandler("get", "/plans-catalog")({}, res);
    expect(res.body.data.plans).toHaveLength(10);
    expect(res.body.data.plans[0].tier).toBe("Basic");
    expect(res.body.data.plans[9].tier).toBe("Palladium (2026)");
  });

  it("computes priceAnnual as monthly × config.pricing.annualPriceMultiplier (PRD FR-18)", async () => {
    configExports.pricing = { activePlanGeneration: "2026-restructure", annualPriceMultiplier: 10 };
    freshSut();
    const res = mkRes();
    getHandler("get", "/plans-catalog")({}, res);
    expect(res.body.data.annualPriceMultiplier).toBe(10);
    const basic = res.body.data.plans.find((p) => p.tier === "Basic (2026)");
    expect(basic.price).toBe("$69/Month");
    expect(basic.priceAnnual).toBe("$690/Year");
  });

  it("respects a different annualPriceMultiplier value", async () => {
    configExports.pricing = { activePlanGeneration: "2026-restructure", annualPriceMultiplier: 12 };
    freshSut();
    const res = mkRes();
    getHandler("get", "/plans-catalog")({}, res);
    const basic = res.body.data.plans.find((p) => p.tier === "Basic (2026)");
    expect(basic.priceAnnual).toBe("$828/Year"); // 69 * 12
  });

  it("defaults annualPriceMultiplier to 10 when unset", async () => {
    configExports.pricing = { activePlanGeneration: "2026-restructure" };
    freshSut();
    const res = mkRes();
    getHandler("get", "/plans-catalog")({}, res);
    expect(res.body.data.annualPriceMultiplier).toBe(10);
  });

  it("every plan's features array matches the features list length", async () => {
    freshSut();
    const res = mkRes();
    getHandler("get", "/plans-catalog")({}, res);
    const { features, plans } = res.body.data;
    for (const p of plans) {
      expect(p.features).toHaveLength(features.length - 1); // "Networks" header has no boolean row
    }
  });
});

describe("authRoutes > POST /login", () => {
  it("dev test user shortcut", async () => {
    configExports = { ...configExports, isDev: true };
    freshSut();
    const res = mkRes();
    await getHandler("post", "/login")({ body: { email: "test@pas.dev", password: "Test@123" } }, res);
    expect(res.body.code).toBe(200);
    expect(res.body.data.user.id).toBe(281);
  });

  it("503 when no SQL available", async () => {
    dbManager.getSQL.mockReturnValue(null);
    freshSut();
    const res = mkRes();
    await getHandler("post", "/login")({ body: { email: "x@y.com", password: "p" } }, res);
    expect(res.statusCode).toBe(503);
  });

  it("falls back to instagram SQL when facebook missing", async () => {
    let call = 0;
    dbManager.getSQL.mockImplementation((slug) => {
      call++;
      if (slug === "facebook") return null;
      if (slug === "instagram") return { query: vi.fn(async () => []) };
      return null;
    });
    freshSut();
    const res = mkRes();
    await getHandler("post", "/login")({ body: { email: "x@y.com", password: "p" } }, res);
    expect(res.statusCode).toBe(401); // user not found
  });

  it("401 when user not found", async () => {
    dbManager.getSQL.mockReturnValue({ query: vi.fn(async () => []) });
    freshSut();
    const res = mkRes();
    await getHandler("post", "/login")({ body: { email: "x@y.com", password: "p" } }, res);
    expect(res.statusCode).toBe(401);
  });

  it("401 when bcrypt compare fails", async () => {
    bcryptCompare.mockResolvedValue(false);
    dbManager.getSQL.mockReturnValue({ query: vi.fn(async () => [{ id: 1, email: "x@y.com", password: "$2a$10$hashedstuff" }]) });
    freshSut();
    const res = mkRes();
    await getHandler("post", "/login")({ body: { email: "x@y.com", password: "wrong" } }, res);
    expect(res.statusCode).toBe(401);
  });

  it("200 + cookie when bcrypt compare succeeds", async () => {
    bcryptCompare.mockResolvedValue(true);
    dbManager.getSQL.mockReturnValue({ query: vi.fn(async () => [{ id: 1, email: "x@y.com", password: "$2a$10$hashedstuff", name: "X", plan_id: 5, role: "user" }]) });
    freshSut();
    const res = mkRes();
    await getHandler("post", "/login")({ body: { email: "x@y.com", password: "ok" } }, res);
    expect(res.body.code).toBe(200);
    expect(res.cookies.authToken.v).toBe("jwt-token");
  });

  it("MD5 fallback path matches when hash matches", async () => {
    const crypto = await import("node:crypto");
    const md5 = crypto.createHash("md5").update("plain").digest("hex");
    dbManager.getSQL.mockReturnValue({ query: vi.fn(async () => [{ id: 1, email: "x@y.com", password: md5 }]) });
    freshSut();
    const res = mkRes();
    await getHandler("post", "/login")({ body: { email: "x@y.com", password: "plain" } }, res);
    expect(res.body.code).toBe(200);
  });

  it("MD5 fallback rejects when hash differs", async () => {
    dbManager.getSQL.mockReturnValue({ query: vi.fn(async () => [{ id: 1, email: "x@y.com", password: "nothex" }]) });
    freshSut();
    const res = mkRes();
    await getHandler("post", "/login")({ body: { email: "x@y.com", password: "wrong" } }, res);
    expect(res.statusCode).toBe(401);
  });

  it("user with empty password field → MD5 path with empty string", async () => {
    dbManager.getSQL.mockReturnValue({ query: vi.fn(async () => [{ id: 1, email: "x@y.com" /* no password */ }]) });
    freshSut();
    const res = mkRes();
    await getHandler("post", "/login")({ body: { email: "x@y.com", password: "p" } }, res);
    expect(res.statusCode).toBe(401);
  });

  it("dev env: cookie not secure + sameSite=Lax", async () => {
    configExports = { ...configExports, env: "development" };
    bcryptCompare.mockResolvedValue(true);
    dbManager.getSQL.mockReturnValue({ query: vi.fn(async () => [{ id: 1, email: "x@y.com", password: "$2a$10$h" }]) });
    freshSut();
    const res = mkRes();
    await getHandler("post", "/login")({ body: { email: "x@y.com", password: "ok" } }, res);
    expect(res.cookies.authToken.opts.secure).toBe(false);
    expect(res.cookies.authToken.opts.sameSite).toBe("Lax");
  });

  it("cookie default max age when config.jwt.cookieMaxAgeMs missing", async () => {
    configExports = { ...configExports, jwt: { expiresIn: "1d" } };
    bcryptCompare.mockResolvedValue(true);
    dbManager.getSQL.mockReturnValue({ query: vi.fn(async () => [{ id: 1, email: "x@y.com", password: "$2a$10$h" }]) });
    freshSut();
    const res = mkRes();
    await getHandler("post", "/login")({ body: { email: "x@y.com", password: "ok" } }, res);
    expect(res.cookies.authToken.opts.maxAge).toBe(86400000);
  });
});

describe("authRoutes > POST /logout", () => {
  it("clears cookie + 200", () => {
    freshSut();
    const res = mkRes();
    getHandler("post", "/logout")({}, res);
    expect(res.clearCookie).toHaveBeenCalledWith("authToken", { path: "/" });
    expect(res.body.code).toBe(200);
  });
});

describe("authRoutes > GET /me", () => {
  it("returns req.user", () => {
    freshSut();
    const res = mkRes();
    getHandler("get", "/me")({ user: { id: 1, email: "x@y.com" } }, res);
    expect(res.body.data).toEqual({ id: 1, email: "x@y.com" });
  });
});

describe("authRoutes > GET /plan-access", () => {
  it("403 when no planId in JWT", async () => {
    freshSut();
    const res = mkRes();
    await getHandler("get", "/plan-access")({ user: {}, query: {} }, res);
    expect(res.statusCode).toBe(403);
  });

  it("SQL user path → planAccessService.getAllowedPlatforms", async () => {
    planSvc.getConfig.mockResolvedValue([{}]);
    freshSut();
    const res = mkRes();
    await getHandler("get", "/plan-access")({ user: { plan_id: 1 }, query: {} }, res);
    expect(res.body.data.allowedPlatforms).toEqual(["facebook", "google"]);
    expect(res.body.data.customPlatformRestriction).toBe(false);
  });

  // 2026-07-14: this route is a separate implementation from planAccessMiddleware and
  // was missing planTier entirely — PricingModal.jsx's "only show upgrade tiers" filter
  // depends on it (currentPlanTier), so its absence made the modal always fall back to
  // showing every plan including the user's current one.
  it("includes planTier from resolvePlanTier() in the response", async () => {
    planSvc.getConfig.mockResolvedValue([{ _id: "plan_groups", groups: { "Basic (2026)": { plans: [101] } } }]);
    planSvc.resolvePlanTier.mockReturnValue("Basic (2026)");
    freshSut();
    const res = mkRes();
    await getHandler("get", "/plan-access")({ user: { plan_id: 101 }, query: {} }, res);
    expect(res.body.data.planTier).toBe("Basic (2026)");
    expect(planSvc.resolvePlanTier).toHaveBeenCalledWith(101, expect.any(Array));
  });

  it("aMember regular plan → intersects JWT with config", async () => {
    planSvc.getConfig.mockResolvedValue([{}]);
    planSvc.getAllowedPlatforms.mockReturnValue(["facebook"]);
    freshSut();
    const res = mkRes();
    await getHandler("get", "/plan-access")({
      user: { userSubscriptionType: 69, platformAccess: { facebook: 1, google: 1 } },
      query: { network: "facebook" },
    }, res);
    expect(res.body.data.allowedPlatforms).toEqual(["facebook"]);
    expect(res.body.data.customPlatformRestriction).toBe(false);
  });

  it("aMember custom plan → JWT-only platforms", async () => {
    planSvc.getConfig.mockResolvedValue([{}]);
    freshSut();
    const res = mkRes();
    await getHandler("get", "/plan-access")({
      user: { userSubscriptionType: 33, platformAccess: { Facebook: 1, Google: 0 } },
      query: {},
    }, res);
    expect(res.body.data.allowedPlatforms).toContain("facebook");
    expect(res.body.data.allowedPlatforms).not.toContain("google");
    expect(res.body.data.customPlatformRestriction).toBe(true);
  });

  it("aMember with empty config falls back to ALL_PLATFORMS", async () => {
    planSvc.getConfig.mockResolvedValue([]);
    freshSut();
    const res = mkRes();
    await getHandler("get", "/plan-access")({
      user: { userSubscriptionType: 99, platformAccess: { facebook: 1 } },
      query: {},
    }, res);
    expect(res.body.data.allowedPlatforms).toContain("facebook");
  });

  it("default custom codes when config.amember.plans.custom missing", async () => {
    configExports = { ...configExports, amember: {} };
    planSvc.getConfig.mockResolvedValue([{}]);
    freshSut();
    const res = mkRes();
    await getHandler("get", "/plan-access")({
      user: { userSubscriptionType: 33, platformAccess: { facebook: 1 } },
      query: {},
    }, res);
    expect(res.body.data.allowedPlatforms).toContain("facebook");
  });
});

describe("authRoutes > POST /refresh", () => {
  it("re-issues fresh token and strips iat/exp", () => {
    freshSut();
    const res = mkRes();
    getHandler("post", "/refresh")({ user: { id: 1, email: "x@y.com", iat: 100, exp: 200, plan_id: 5 } }, res);
    expect(generateToken).toHaveBeenCalledWith({ id: 1, email: "x@y.com", plan_id: 5 });
    expect(res.body.code).toBe(200);
    expect(res.cookies.authToken.v).toBe("jwt-token");
  });
});
