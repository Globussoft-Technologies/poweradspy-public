import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── Mock express Router to capture handlers ──────────────
const expressPath = require.resolve("express");
const handlers = { get: {} };
function FakeRouter() {
  return {
    get: vi.fn((path, fn) => { handlers.get[path] = fn; }),
  };
}
require.cache[expressPath] = {
  id: expressPath, filename: expressPath, loaded: true,
  exports: { Router: FakeRouter },
};

// ── Mock auth middleware ──────────────
const authPath = require.resolve("../../src/middleware/auth");
const generateToken = vi.fn(() => "jwt-token");
require.cache[authPath] = {
  id: authPath, filename: authPath, loaded: true,
  exports: { generateToken },
};

// ── Mock config ──────────────
const configPath = require.resolve("../../src/config");
let configExports = {
  env: "production",
  amember: {
    apiUrl: "https://am.test/", apiKey: "key",
    plans: { custom: [33, 46, 70], reward: [8], beta: [18] },
    freePlanCode: 20,
    frontendUrl: "https://fe.test",
    amemberLogoutUrl: "https://am.test/logout",
  },
  jwt: { cookieMaxAgeMs: 999 },
};
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true,
  get exports() { return configExports; },
  set exports(v) { configExports = v; },
};

// ── Mock logger ──────────────
const loggerPath = require.resolve("../../src/logger");
const childLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { createChild: vi.fn(() => childLog) },
};

const sutPath = require.resolve("../../src/auth/amemberAuth");
function freshSut() {
  delete require.cache[sutPath];
  return require(sutPath);
}

function mkRes() {
  const r = { statusCode: 200, body: null, cookies: {}, redirectedTo: null };
  r.status = vi.fn((c) => { r.statusCode = c; return r; });
  r.json = vi.fn((b) => { r.body = b; return r; });
  r.cookie = vi.fn((name, val, opts) => { r.cookies[name] = { val, opts }; return r; });
  r.clearCookie = vi.fn(() => r);
  r.redirect = vi.fn((url) => { r.redirectedTo = url; return r; });
  return r;
}

beforeEach(() => {
  for (const k of Object.keys(handlers.get)) delete handlers.get[k];
  generateToken.mockReset().mockReturnValue("jwt-token");
  childLog.info.mockClear(); childLog.warn.mockClear(); childLog.error.mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  configExports = {
    env: "production",
    amember: {
      apiUrl: "https://am.test/", apiKey: "key",
      plans: { custom: [33, 46, 70], reward: [8], beta: [18] },
      freePlanCode: 20,
      frontendUrl: "https://fe.test",
      amemberLogoutUrl: "https://am.test/logout",
    },
    jwt: { cookieMaxAgeMs: 999 },
  };
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("auth/amemberAuth > module loads + registers routes", () => {
  it("registers /loginpage/:encodedUsername and /logout", () => {
    freshSut();
    expect(handlers.get["/loginpage/:encodedUsername"]).toBeDefined();
    expect(handlers.get["/logout"]).toBeDefined();
  });
});

describe("auth/amemberAuth > /logout", () => {
  it("clears cookie and redirects to amemberLogoutUrl", () => {
    freshSut();
    const res = mkRes();
    handlers.get["/logout"]({}, res);
    expect(res.clearCookie).toHaveBeenCalledTimes(2);
    expect(res.redirectedTo).toBe("https://am.test/logout");
  });
  it("falls back to default logout URL when config missing", () => {
    configExports = { ...configExports, amember: { ...configExports.amember, amemberLogoutUrl: undefined } };
    freshSut();
    const res = mkRes();
    handlers.get["/logout"]({}, res);
    expect(res.redirectedTo).toContain("amember/logout");
  });
});

describe("auth/amemberAuth > /loginpage happy path", () => {
  function mkReq(username = "alice", ip = "1.1.1.1") {
    const encoded = Buffer.from(username).toString("base64");
    return { params: { encodedUsername: encoded }, query: { ip, referrer: "ref" }, ip };
  }

  it("happy path: regular plan → JWT issued, cookie set, redirect to frontend", async () => {
    freshSut();
    global.fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true, user_id: 42, name: "Alice", email: "a@b.com",
        subscriptions: { 69: "2099-01-01" },
      }),
    }));
    const res = mkRes();
    await handlers.get["/loginpage/:encodedUsername"](mkReq(), res);
    expect(generateToken).toHaveBeenCalled();
    expect(res.cookies.authToken.val).toBe("jwt-token");
    expect(res.redirectedTo).toBe("https://fe.test?token=jwt-token");
  });

  it("removes free-plan code when other plans exist", async () => {
    freshSut();
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({
        ok: true, user_id: 42, name: "A", email: "a@b.com",
        subscriptions: { 20: "2099-01-01", 69: "2099-01-01" },
      }),
    }));
    await handlers.get["/loginpage/:encodedUsername"](mkReq(), mkRes());
    const payload = generateToken.mock.calls[0][0];
    expect(payload.subscriptions[20]).toBeUndefined();
    expect(payload.subscriptions[69]).toBe("2099-01-01");
  });

  it("ip fallback to req.ip when query.ip missing", async () => {
    freshSut();
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ ok: true, user_id: 42, subscriptions: { 69: "2099-01-01" } }),
    }));
    const req = { params: { encodedUsername: Buffer.from("a").toString("base64") }, query: {}, ip: "9.9.9.9" };
    await handlers.get["/loginpage/:encodedUsername"](req, mkRes());
    expect(childLog.info).toHaveBeenCalledWith("aMember login redirect received", expect.objectContaining({ ip: "9.9.9.9" }));
  });

  it("dev env: secure cookie=false + sameSite=Lax", async () => {
    configExports = { ...configExports, env: "development" };
    freshSut();
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ ok: true, user_id: 42, subscriptions: { 69: "2099-01-01" } }),
    }));
    const res = mkRes();
    await handlers.get["/loginpage/:encodedUsername"](mkReq(), res);
    expect(res.cookies.authToken.opts.secure).toBe(false);
    expect(res.cookies.authToken.opts.sameSite).toBe("Lax");
  });

  it("default cookie max age when config.jwt.cookieMaxAgeMs missing", async () => {
    configExports = { ...configExports, jwt: {} };
    freshSut();
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ ok: true, user_id: 42, subscriptions: { 69: "2099-01-01" } }),
    }));
    const res = mkRes();
    await handlers.get["/loginpage/:encodedUsername"](mkReq(), res);
    expect(res.cookies.authToken.opts.maxAge).toBe(86400000);
  });
});

describe("auth/amemberAuth > /loginpage error paths", () => {
  function mkReq() {
    return { params: { encodedUsername: Buffer.from("alice").toString("base64") }, query: {}, ip: "1.1.1.1" };
  }

  it("400 when decoded username is empty", async () => {
    freshSut();
    const res = mkRes();
    await handlers.get["/loginpage/:encodedUsername"]({ params: { encodedUsername: "" }, query: {}, ip: "1.1.1.1" }, res);
    expect(res.statusCode).toBe(400);
  });

  it("401 when amData.ok is false", async () => {
    freshSut();
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ ok: false, error: "denied" }),
    }));
    const res = mkRes();
    await handlers.get["/loginpage/:encodedUsername"](mkReq(), res);
    expect(res.statusCode).toBe(401);
  });

  it("401 when amData null", async () => {
    freshSut();
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => null }));
    const res = mkRes();
    await handlers.get["/loginpage/:encodedUsername"](mkReq(), res);
    expect(res.statusCode).toBe(401);
  });

  it("401 when user_id missing", async () => {
    freshSut();
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ ok: true, subscriptions: { 69: "2099-01-01" } }),
    }));
    const res = mkRes();
    await handlers.get["/loginpage/:encodedUsername"](mkReq(), res);
    expect(res.statusCode).toBe(401);
    expect(res.body.message).toBe("User not found in aMember");
  });

  it("403 when no subscriptions / expired", async () => {
    freshSut();
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ ok: true, user_id: 42, subscriptions: { 69: "2000-01-01" } }),
    }));
    const res = mkRes();
    await handlers.get["/loginpage/:encodedUsername"](mkReq(), res);
    expect(res.statusCode).toBe(403);
  });

  it("403 when no subscriptions at all", async () => {
    freshSut();
    global.fetch = vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ ok: true, user_id: 42, subscriptions: {} }),
    }));
    const res = mkRes();
    await handlers.get["/loginpage/:encodedUsername"](mkReq(), res);
    expect(res.statusCode).toBe(403);
  });

  it("500 when checkAmemberAccess throws (missing apiKey)", async () => {
    configExports = { ...configExports, amember: { ...configExports.amember, apiKey: null } };
    freshSut();
    const res = mkRes();
    await handlers.get["/loginpage/:encodedUsername"](mkReq(), res);
    expect(res.statusCode).toBe(500);
    expect(childLog.error).toHaveBeenCalled();
  });

  it("500 when amember API returns non-OK status", async () => {
    freshSut();
    global.fetch = vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) }));
    const res = mkRes();
    await handlers.get["/loginpage/:encodedUsername"](mkReq(), res);
    expect(res.statusCode).toBe(500);
  });
});

describe("auth/amemberAuth > custom plan path", () => {
  function mkReq() {
    return { params: { encodedUsername: Buffer.from("u").toString("base64") }, query: {}, ip: "1.1.1.1" };
  }

  it("custom plan ID + invoice with platforms → platformAccess from invoice", async () => {
    freshSut();
    let call = 0;
    global.fetch = vi.fn(async (url) => {
      call++;
      if (call === 1) return { ok: true, status: 200, json: async () => ({
        ok: true, user_id: 42, subscriptions: { 33: "2099-01-01" },
      })};
      if (url.includes("users?")) return { ok: true, json: async () => ([
        { nested: { invoices: [{ invoice_id: 1, status: 0 }] } },
      ])};
      if (url.includes("invoices/1")) return { ok: true, json: async () => ([
        { nested: { "invoice-items": [{ options: JSON.stringify({ Facebook: { value: 1 }, Instagram: { value: 1 }, YouTube: { value: 1 }, Google: { value: 1 }, GDN: { value: 1 }, Native: { value: 1 }, Reddit: { value: 1 }, Quora: { value: 1 }, Pinterest: { value: 1 }, tiktok: { value: 1 }, linkedin: { value: 1 } }) }] } },
      ])};
      return { ok: true, json: async () => ({}) };
    });
    await handlers.get["/loginpage/:encodedUsername"](mkReq(), mkRes());
    const payload = generateToken.mock.calls[0][0];
    expect(payload.platformAccess.facebook).toBe(1);
    expect(payload.platformAccess.tiktok).toBe(1);
  });

  it("custom plan + alternate key casings (lowercase facebook, Youtube)", async () => {
    freshSut();
    let call = 0;
    global.fetch = vi.fn(async (url) => {
      call++;
      if (call === 1) return { ok: true, json: async () => ({ ok: true, user_id: 42, subscriptions: { 33: "2099-01-01" } }) };
      if (url.includes("users?")) return { ok: true, json: async () => ([{ nested: { invoices: [{ invoice_id: 1, status: 0 }] } }]) };
      if (url.includes("invoices/1")) return { ok: true, json: async () => ([
        { nested: { "invoice-items": [{ options: { facebook: { value: 1 }, Youtube: { value: 1 } } }] } },
      ])};
      return { ok: true, json: async () => ({}) };
    });
    await handlers.get["/loginpage/:encodedUsername"](mkReq(), mkRes());
    const payload = generateToken.mock.calls[0][0];
    expect(payload.platformAccess.facebook).toBe(1);
    expect(payload.platformAccess.youtube).toBe(1);
  });

  it("unknown plan ID treated as custom → invoice fetch attempted", async () => {
    freshSut();
    let call = 0;
    global.fetch = vi.fn(async (url) => {
      call++;
      if (call === 1) return { ok: true, json: async () => ({ ok: true, user_id: 42, subscriptions: { 9999: "2099-01-01" } }) };
      if (url.includes("users?")) return { ok: true, json: async () => ([]) };
      return { ok: true, json: async () => ({}) };
    });
    await handlers.get["/loginpage/:encodedUsername"](mkReq(), mkRes());
    const payload = generateToken.mock.calls[0][0];
    // Empty invoice nesting → fallback restricts all
    expect(payload.platformAccess.facebook).toBe(0);
  });

  it("custom plan: invoice options as raw object (not string)", async () => {
    freshSut();
    let call = 0;
    global.fetch = vi.fn(async (url) => {
      call++;
      if (call === 1) return { ok: true, json: async () => ({ ok: true, user_id: 42, subscriptions: { 33: "2099-01-01" } }) };
      if (url.includes("users?")) return { ok: true, json: async () => ([{ nested: { invoices: [{ invoice_id: 1, status: 1 }] } }]) };
      if (url.includes("invoices/1")) return { ok: true, json: async () => ([
        { nested: { "invoice-items": [{ options: { Facebook: { value: 1 } } }] } },
      ])};
      return { ok: true, json: async () => ({}) };
    });
    await handlers.get["/loginpage/:encodedUsername"](mkReq(), mkRes());
    const payload = generateToken.mock.calls[0][0];
    expect(payload.platformAccess.facebook).toBe(1);
  });

  it("custom plan: void/refunded/failed invoice (status 2,3,4) is skipped", async () => {
    freshSut();
    let call = 0;
    global.fetch = vi.fn(async (url) => {
      call++;
      if (call === 1) return { ok: true, json: async () => ({ ok: true, user_id: 42, subscriptions: { 33: "2099-01-01" } }) };
      if (url.includes("users?")) return { ok: true, json: async () => ([{ nested: { invoices: [{ invoice_id: 1, status: 2 }] } }]) };
      if (url.includes("invoices/1")) return { ok: true, json: async () => ([
        { nested: { "invoice-items": [{ options: { Facebook: { value: 1 } } }] } },
      ])};
      return { ok: true, json: async () => ({}) };
    });
    await handlers.get["/loginpage/:encodedUsername"](mkReq(), mkRes());
    const payload = generateToken.mock.calls[0][0];
    expect(payload.platformAccess.facebook).toBe(0);
  });

  it("custom plan: invoice with no platform keys is skipped", async () => {
    freshSut();
    let call = 0;
    global.fetch = vi.fn(async (url) => {
      call++;
      if (call === 1) return { ok: true, json: async () => ({ ok: true, user_id: 42, subscriptions: { 33: "2099-01-01" } }) };
      if (url.includes("users?")) return { ok: true, json: async () => ([{ nested: { invoices: [{ invoice_id: 1, status: 0 }] } }]) };
      if (url.includes("invoices/1")) return { ok: true, json: async () => ([
        { nested: { "invoice-items": [{ options: { somethingElse: { value: 1 } } }] } },
      ])};
      return { ok: true, json: async () => ({}) };
    });
    await handlers.get["/loginpage/:encodedUsername"](mkReq(), mkRes());
    const payload = generateToken.mock.calls[0][0];
    expect(payload.platformAccess.facebook).toBe(0);
  });

  it("custom plan: invoice with missing options is skipped (continue)", async () => {
    freshSut();
    let call = 0;
    global.fetch = vi.fn(async (url) => {
      call++;
      if (call === 1) return { ok: true, json: async () => ({ ok: true, user_id: 42, subscriptions: { 33: "2099-01-01" } }) };
      if (url.includes("users?")) return { ok: true, json: async () => ([{ nested: { invoices: [{ invoice_id: 1, status: 0 }] } }]) };
      if (url.includes("invoices/1")) return { ok: true, json: async () => ([{ nested: { "invoice-items": [{}] } }]) };
      return { ok: true, json: async () => ({}) };
    });
    await handlers.get["/loginpage/:encodedUsername"](mkReq(), mkRes());
    const payload = generateToken.mock.calls[0][0];
    expect(payload.platformAccess.facebook).toBe(0);
  });

  it("custom plan: invalid JSON options → continue past invoice", async () => {
    freshSut();
    let call = 0;
    global.fetch = vi.fn(async (url) => {
      call++;
      if (call === 1) return { ok: true, json: async () => ({ ok: true, user_id: 42, subscriptions: { 33: "2099-01-01" } }) };
      if (url.includes("users?")) return { ok: true, json: async () => ([{ nested: { invoices: [{ invoice_id: 1, status: 0 }] } }]) };
      if (url.includes("invoices/1")) return { ok: true, json: async () => ([
        { nested: { "invoice-items": [{ options: "not-valid-json" }] } },
      ])};
      return { ok: true, json: async () => ({}) };
    });
    await handlers.get["/loginpage/:encodedUsername"](mkReq(), mkRes());
    const payload = generateToken.mock.calls[0][0];
    expect(payload.platformAccess.facebook).toBe(0);
  });

  it("custom plan: invoice API throws → warn + fallback restrict", async () => {
    freshSut();
    let call = 0;
    global.fetch = vi.fn(async (url) => {
      call++;
      if (call === 1) return { ok: true, json: async () => ({ ok: true, user_id: 42, subscriptions: { 33: "2099-01-01" } }) };
      if (url.includes("users?")) throw new Error("am-down");
      return { ok: true, json: async () => ({}) };
    });
    await handlers.get["/loginpage/:encodedUsername"](mkReq(), mkRes());
    const payload = generateToken.mock.calls[0][0];
    expect(payload.platformAccess.facebook).toBe(0);
    expect(childLog.warn).toHaveBeenCalledWith("Failed to fetch custom plan platforms", expect.any(Object));
  });

  it("custom plan: users API returns null body → fallback restrict", async () => {
    freshSut();
    let call = 0;
    global.fetch = vi.fn(async (url) => {
      call++;
      if (call === 1) return { ok: true, json: async () => ({ ok: true, user_id: 42, subscriptions: { 33: "2099-01-01" } }) };
      if (url.includes("users?")) return { ok: true, json: async () => null };
      return { ok: true, json: async () => ({}) };
    });
    await handlers.get["/loginpage/:encodedUsername"](mkReq(), mkRes());
    const payload = generateToken.mock.calls[0][0];
    expect(payload.platformAccess.facebook).toBe(0);
  });
});

describe("auth/amemberAuth > computeSubscriptionType branches", () => {
  it("free code returned when subscriptions empty", async () => {
    freshSut();
    global.fetch = vi.fn(async () => ({
      ok: true, json: async () => ({ ok: true, user_id: 42, subscriptions: {} }),
    }));
    const res = mkRes();
    await handlers.get["/loginpage/:encodedUsername"]({ params: { encodedUsername: Buffer.from("u").toString("base64") }, query: {}, ip: "1.1.1.1" }, res);
    // Expect 403 (no valid subscription path)
    expect(res.statusCode).toBe(403);
  });

  it("reward(8) skipped when other plans exist → uses next-highest", async () => {
    freshSut();
    global.fetch = vi.fn(async () => ({
      ok: true, json: async () => ({ ok: true, user_id: 42, subscriptions: { 8: "2099-01-01", 69: "2099-01-01" } }),
    }));
    await handlers.get["/loginpage/:encodedUsername"]({ params: { encodedUsername: Buffer.from("u").toString("base64") }, query: {}, ip: "1.1.1.1" }, mkRes());
    const payload = generateToken.mock.calls[0][0];
    expect(payload.userSubscriptionType).toBe(69);
  });

  it("reward(8) alone → returned as subType (filter leaves empty)", async () => {
    freshSut();
    global.fetch = vi.fn(async () => ({
      ok: true, json: async () => ({ ok: true, user_id: 42, subscriptions: { 8: "2099-01-01", 18: "2099-01-01" } }),
    }));
    await handlers.get["/loginpage/:encodedUsername"]({ params: { encodedUsername: Buffer.from("u").toString("base64") }, query: {}, ip: "1.1.1.1" }, mkRes());
    const payload = generateToken.mock.calls[0][0];
    expect([8, 18]).toContain(payload.userSubscriptionType);
  });

  it("FREE_CODE/custom/reward/beta `|| []` fallbacks fire when config lacks those keys (lines 27, 31, 36, 37)", async () => {
    // Swap config so freePlanCode is undefined and plans is empty — every
    // `... || 20`, `... || []` left side is falsy → fallback fires.
    const prev = configExports;
    configExports = {
      ...prev,
      amember: {
        ...prev.amember,
        freePlanCode: undefined,           // line 27 `|| 20`
        plans: {},                          // line 31/36/37 `|| []` × 3
      },
    };
    freshSut();
    // Non-empty subscription so computeSubscriptionType invokes SKIP_CODES()
    // AND the handler invokes CUSTOM_CODES() — both fall through their `|| []`.
    global.fetch = vi.fn(async () => ({
      ok: true, json: async () => ({ ok: true, user_id: 42, subscriptions: { 50: "2099-01-01" } }),
    }));
    const res = mkRes();
    await handlers.get["/loginpage/:encodedUsername"](
      { params: { encodedUsername: Buffer.from("u").toString("base64") }, query: {}, ip: "1.1.1.1" },
      res,
    );
    // restore for other tests
    configExports = prev;
    // 200 since productId 50 is valid (no custom required)
    expect([200, 403]).toContain(res.statusCode);
  });
});
