import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

import fs from "node:fs";
const realReadFileSync = fs.readFileSync;
const realStatSync = fs.statSync;
let configJsonContent = null;
let configJsonExists = false;
const writtenFiles = [];
const copiedFiles = [];
const mkdirCalls = [];
const unlinkCalls = [];

const existsSpy = vi.spyOn(fs, "existsSync").mockImplementation((p) => {
  if (typeof p === "string" && p.includes("config.json")) return configJsonExists;
  if (typeof p === "string" && p.includes("config_backups")) return true;
  return true;
});

const readFileSpy = vi.spyOn(fs, "readFileSync").mockImplementation((p, enc) => {
  if (typeof p === "string" && p.endsWith("config.json")) {
    if (!configJsonContent) throw new Error("not found");
    return configJsonContent;
  }
  return realReadFileSync(p, enc);
});

vi.spyOn(fs, "writeFileSync").mockImplementation((p, data) => {
  writtenFiles.push({ path: p, data });
});

vi.spyOn(fs, "copyFileSync").mockImplementation((src, dst) => {
  copiedFiles.push({ src, dst });
});

vi.spyOn(fs, "mkdirSync").mockImplementation((p, opts) => {
  mkdirCalls.push({ p, opts });
});

vi.spyOn(fs, "readdirSync").mockImplementation((p) => {
  if (typeof p === "string" && p.includes("config_backups")) {
    return ["config_1.json", "config_2.json", "config_3.json"];
  }
  return [];
});

vi.spyOn(fs, "statSync").mockImplementation((p) => {
  if (typeof p === "string" && p.includes("config_")) {
    return { mtime: { getTime: () => Number(p.match(/_(\d+)\.json/)?.[1] || 0) } };
  }
  return realStatSync(p);
});

vi.spyOn(fs, "unlinkSync").mockImplementation((p) => {
  unlinkCalls.push(p);
});

// Mock dotenv
const dotenvPath = require.resolve("dotenv");
require.cache[dotenvPath] = {
  id: dotenvPath, filename: dotenvPath, loaded: true,
  exports: { config: vi.fn() },
};

const sutPath = require.resolve("../../src/config");
function freshSut() {
  delete require.cache[sutPath];
  return require(sutPath);
}

beforeEach(() => {
  configJsonContent = null;
  configJsonExists = false;
  writtenFiles.length = 0;
  copiedFiles.length = 0;
  mkdirCalls.length = 0;
  unlinkCalls.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  // Don't restore the fs spies — they're set up once at module load
});

describe("config/index > module load", () => {
  it("loads with no config.json + no env vars", () => {
    const c = freshSut();
    expect(c).toBeDefined();
    expect(c.cors.methods).toEqual(["GET", "POST", "PUT", "DELETE", "OPTIONS"]);
    expect(c.isDev).toBe(true); // env undefined ≠ 'production'
  });

  it("loads config.json values when present", () => {
    configJsonExists = true;
    configJsonContent = JSON.stringify({
      server: { nodeEnv: "production", port: 8080, host: "0.0.0.0", bodyLimit: "10mb", trustProxy: 2 },
      jwt: { secret: "s", expiresIn: "2d", cookieMaxAgeMs: 999 },
      admin: { enabled: true, username: "a", password: "p" },
    });
    const c = freshSut();
    expect(c.env).toBe("production");
    expect(c.port).toBe(8080);
    expect(c.host).toBe("0.0.0.0");
    expect(c.isDev).toBe(false);
    expect(c.admin.enabled).toBe(true);
  });

  it("env var fallback when config.json missing", () => {
    process.env.PORT = "5000";
    process.env.NODE_ENV = "production";
    const c = freshSut();
    expect(c.port).toBe(5000);
    expect(c.env).toBe("production");
    delete process.env.PORT; delete process.env.NODE_ENV;
  });

  it("config.json parse failure → logs error and proceeds with empty fileConfig", () => {
    configJsonExists = true;
    configJsonContent = "not-valid-json";
    const c = freshSut();
    expect(c).toBeDefined();
    expect(console.error).toHaveBeenCalled();
  });

  it("dailyKeyword.newPlanUser parses JSON string from env", () => {
    process.env.NEW_PLAN_USER = JSON.stringify([69, 70]);
    const c = freshSut();
    expect(c.dailyKeyword.newPlanUser).toEqual(["69", "70"]);
    delete process.env.NEW_PLAN_USER;
  });

  it("dailyKeyword.newPlanUser handles invalid JSON → []", () => {
    process.env.NEW_PLAN_USER = "not-valid";
    const c = freshSut();
    expect(c.dailyKeyword.newPlanUser).toEqual([]);
    delete process.env.NEW_PLAN_USER;
  });

  it("dailyKeyword.newPlanUser empty when no env + no config", () => {
    delete process.env.NEW_PLAN_USER;
    const c = freshSut();
    expect(c.dailyKeyword.newPlanUser).toEqual([]);
  });

  it("dailyKeyword.newPlanUser from config.json array", () => {
    configJsonExists = true;
    configJsonContent = JSON.stringify({ dailyKeyword: { newPlanUser: [33] } });
    const c = freshSut();
    expect(c.dailyKeyword.newPlanUser).toEqual(["33"]);
  });

  it("transform applied (toBool) for booleans", () => {
    process.env.ADMIN_ENABLED = "true";
    const c = freshSut();
    expect(c.admin.enabled).toBe(true);
    delete process.env.ADMIN_ENABLED;
  });

  it("notifications.*Enabled default to true when unset", () => {
    const c = freshSut();
    expect(c.notifications.pushEnabled).toBe(true);
    expect(c.notifications.emailEnabled).toBe(true);
  });

  it("notifications.*Enabled=false when set to 'false'", () => {
    process.env.NOTIFICATIONS_PUSH_ENABLED = "false";
    const c = freshSut();
    expect(c.notifications.pushEnabled).toBe(false);
    delete process.env.NOTIFICATIONS_PUSH_ENABLED;
  });

  it("jwt.cookieMaxAgeMs defaults to 86400000", () => {
    const c = freshSut();
    expect(c.jwt.cookieMaxAgeMs).toBe(86400000);
  });
});

describe("config/index > reload()", () => {
  it("returns undefined when config.json missing", () => {
    configJsonExists = false;
    const c = freshSut();
    expect(c.reload()).toBeUndefined();
  });

  it("returns true and updates rateLimit when present", () => {
    configJsonExists = true;
    configJsonContent = JSON.stringify({});
    const c = freshSut();
    configJsonContent = JSON.stringify({
      rateLimit: { windowMs: 100000, maxRequests: 50 },
      apiTimeouts: { networkSearchTimeoutMs: 5000 },
      serverTimeouts: { keepAliveTimeoutMs: 10000 },
      cluster: { maxRestarts: 99, restartWindowMs: 60000 },
      circuitBreaker: { failureThreshold: 7 },
      admin: { username: "new" },
      metrics: { enabled: true, retentionMinutes: 30 },
      compression: { threshold: 1024 },
      cors: { origin: "*" },
      logging: { level: "debug" },
    });
    expect(c.reload()).toBe(true);
    expect(c.rateLimit.windowMs).toBe(100000);
    expect(c.apiTimeouts.networkSearchTimeoutMs).toBe(5000);
    expect(c.serverTimeouts.keepAliveTimeoutMs).toBe(10000);
    expect(c.cluster.maxRestarts).toBe(99);
    expect(c.circuitBreaker.failureThreshold).toBe(7);
    expect(c.admin.username).toBe("new");
    expect(c.metricsConfig.enabled).toBe(true);
    expect(c.compression.threshold).toBe(1024);
    expect(c.cors.origin).toBe("*");
    expect(c.log.level).toBe("debug");
  });

  it("logs error on JSON parse failure during reload", () => {
    configJsonExists = true;
    configJsonContent = "{}";
    const c = freshSut();
    configJsonContent = "not-valid-json";
    expect(c.reload()).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });

  it("reload with parent objects but missing sub-fields → each `!== undefined` falsy branch fires (lines 269-317)", () => {
    configJsonExists = true;
    configJsonContent = JSON.stringify({});
    const c = freshSut();
    // Snapshot the pre-reload values so we can assert no field was touched.
    const before = {
      windowMs: c.rateLimit.windowMs,
      maxRequests: c.rateLimit.maxRequests,
      networkSearchTimeoutMs: c.apiTimeouts.networkSearchTimeoutMs,
      maxRestarts: c.cluster.maxRestarts,
      restartWindowMs: c.cluster.restartWindowMs,
      metricsEnabled: c.metricsConfig.enabled,
      retentionMinutes: c.metricsConfig.retentionMinutes,
      logLevel: c.log.level,
    };
    // Each parent object is present (truthy outer if) but its sub-fields are
    // all undefined (falsy inner ifs at lines 269, 270, 275, 285, 286, 301, 302, 317).
    configJsonContent = JSON.stringify({
      rateLimit: {},
      apiTimeouts: {},
      cluster: {},
      metrics: {},
      logging: {},
    });
    expect(c.reload()).toBe(true);
    // None of the values were updated since each inner if was falsy
    expect(c.rateLimit.windowMs).toBe(before.windowMs);
    expect(c.rateLimit.maxRequests).toBe(before.maxRequests);
    expect(c.apiTimeouts.networkSearchTimeoutMs).toBe(before.networkSearchTimeoutMs);
    expect(c.cluster.maxRestarts).toBe(before.maxRestarts);
    expect(c.cluster.restartWindowMs).toBe(before.restartWindowMs);
    expect(c.metricsConfig.enabled).toBe(before.metricsEnabled);
    expect(c.metricsConfig.retentionMinutes).toBe(before.retentionMinutes);
    expect(c.log.level).toBe(before.logLevel);
  });
});

describe("config/index > getRawFileConfig()", () => {
  it("returns parsed config.json contents", () => {
    configJsonExists = true;
    configJsonContent = JSON.stringify({ foo: "bar" });
    const c = freshSut();
    expect(c.getRawFileConfig()).toEqual({ foo: "bar" });
  });
  it("returns {} when config.json missing", () => {
    configJsonExists = false;
    const c = freshSut();
    expect(c.getRawFileConfig()).toEqual({});
  });
  it("returns {} and logs error when JSON parse fails", () => {
    configJsonExists = true;
    configJsonContent = "{}";
    const c = freshSut();
    configJsonContent = "not-json";
    expect(c.getRawFileConfig()).toEqual({});
    expect(console.error).toHaveBeenCalled();
  });
});

describe("config/index > writeConfigFile()", () => {
  it("writes new config + backs up old file", () => {
    configJsonExists = true;
    configJsonContent = "{}";
    const c = freshSut();
    expect(c.writeConfigFile({ foo: "new" })).toBe(true);
    expect(copiedFiles.length).toBe(1);
    expect(writtenFiles.length).toBe(1);
    expect(JSON.parse(writtenFiles[0].data)).toEqual({ foo: "new" });
  });

  it("creates backup dir if missing", () => {
    configJsonExists = true;
    configJsonContent = "{}";
    existsSpy.mockImplementation((p) => {
      if (typeof p === "string" && p.endsWith("config.json")) return true;
      if (typeof p === "string" && p.includes("config_backups")) return false;
      return true;
    });
    const c = freshSut();
    c.writeConfigFile({ foo: "x" });
    expect(mkdirCalls.length).toBeGreaterThan(0);
    // restore
    existsSpy.mockImplementation((p) => {
      if (typeof p === "string" && p.includes("config.json")) return configJsonExists;
      if (typeof p === "string" && p.includes("config_backups")) return true;
      return true;
    });
  });

  it("prunes backups to keep latest 10", () => {
    configJsonExists = true;
    configJsonContent = "{}";
    vi.spyOn(fs, "readdirSync").mockImplementationOnce(() =>
      Array.from({ length: 15 }, (_, i) => `config_${i}.json`)
    );
    const c = freshSut();
    c.writeConfigFile({ x: 1 });
    expect(unlinkCalls.length).toBeGreaterThanOrEqual(5);
  });

  it("backup unlink failure caught + logged", () => {
    configJsonExists = true;
    configJsonContent = "{}";
    vi.spyOn(fs, "readdirSync").mockImplementationOnce(() =>
      Array.from({ length: 15 }, (_, i) => `config_${i}.json`)
    );
    vi.spyOn(fs, "unlinkSync").mockImplementationOnce(() => { throw new Error("unlink-fail"); });
    const c = freshSut();
    expect(c.writeConfigFile({ x: 1 })).toBe(true);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Failed to delete old backup"), expect.any(Error));
  });

  it("skips backup step when no existing config.json", () => {
    configJsonExists = false;
    const c = freshSut();
    expect(c.writeConfigFile({ x: 1 })).toBe(true);
    expect(copiedFiles.length).toBe(0);
  });

  it("returns false + logs when write fails", () => {
    configJsonExists = false;
    const c = freshSut();
    vi.spyOn(fs, "writeFileSync").mockImplementationOnce(() => { throw new Error("write-fail"); });
    expect(c.writeConfigFile({ x: 1 })).toBe(false);
    expect(console.error).toHaveBeenCalled();
  });
});
