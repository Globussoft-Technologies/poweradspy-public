import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// compliance.blocklist is built in src/config/index.js. Each case loads the
// real module in a fresh Node process against a temp config.json, so nothing
// here touches the repo's own config.json.

const root = path.resolve(import.meta.dirname, "../../..");
let dir;

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "blocklist-config-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function loadBlocklistConfig(fileConfig, env = {}) {
  const file = path.join(dir, "config.json");
  fs.writeFileSync(file, JSON.stringify(fileConfig ?? {}));
  const out = execFileSync(
    process.execPath,
    ["-e", "console.log(JSON.stringify(require('./src/config').compliance.blocklist))"],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        PATH: process.env.PATH,
        PAS_NODE_API_CONFIG_PATH: file,
        BLOCKLIST_ENABLED: "",
        BLOCKLIST_FAIL_MODE: "",
        BLOCKLIST_REFRESH_SECONDS: "",
        BLOCKLIST_SNAPSHOT_DIR: "",
        ...env,
      },
    }
  );
  return JSON.parse(out.trim().split("\n").pop());
}

describe("config > compliance.blocklist", () => {
  it("is off by default, fails closed, and has safe numbers", () => {
    const c = loadBlocklistConfig({});
    expect(c).toMatchObject({
      enabled: false,
      failMode: "closed",
      refreshSeconds: 30,
      loadTimeoutMs: 5000,
      pageSize: 5000,
      emptyRefreshGuard: true,
      networks: [],
      response: { code: 422 },
      unavailable: { code: 503 },
      attempts: { batchSize: 100, flushSeconds: 5, maxQueue: 10000 },
      rules: { adId: true, advertiser: true, url: true, domain: true },
      fields: {},
    });
    expect(c.snapshot.enabled).toBe(true);
    expect(c.snapshot.dir).toMatch(/compliance-blocklist$/);
  });

  it("reads values from config.json", () => {
    const c = loadBlocklistConfig({
      compliance: { blocklist: {
        enabled: true, failMode: "open", refreshSeconds: 15,
        networks: ["Reddit", " quora "],
        response: { code: 451, message: "No." },
        rules: { domain: false },
        fields: { reddit: { advertiser: ["post_owner"] } },
      } },
    });
    expect(c).toMatchObject({
      enabled: true, failMode: "open", refreshSeconds: 15,
      networks: ["reddit", "quora"],
      response: { code: 451, message: "No." },
      rules: { adId: true, domain: false },
      fields: { reddit: { advertiser: ["post_owner"] } },
    });
  });

  it("lets env turn it on and set the fail mode when config.json does not", () => {
    const c = loadBlocklistConfig({}, { BLOCKLIST_ENABLED: "true", BLOCKLIST_FAIL_MODE: "open", BLOCKLIST_REFRESH_SECONDS: "60" });
    expect(c).toMatchObject({ enabled: true, failMode: "open", refreshSeconds: 60 });
  });

  it("falls back to closed for any failMode that is not 'open'", () => {
    expect(loadBlocklistConfig({ compliance: { blocklist: { failMode: "banana" } } }).failMode).toBe("closed");
    expect(loadBlocklistConfig({ compliance: { blocklist: { failMode: "OPEN" } } }).failMode).toBe("open");
  });

  it("reads new banned images every minute and all of them every 15 minutes by default, within safe limits", () => {
    expect(loadBlocklistConfig({})).toMatchObject({ imageRefreshSeconds: 60, imageFullReloadSeconds: 900 });
    expect(loadBlocklistConfig({ compliance: { blocklist: { imageRefreshSeconds: 1, imageFullReloadSeconds: 1 } } }))
      .toMatchObject({ imageRefreshSeconds: 5, imageFullReloadSeconds: 60 });
    expect(loadBlocklistConfig({ compliance: { blocklist: { imageRefreshSeconds: 10 ** 9, imageFullReloadSeconds: 10 ** 9 } } }))
      .toMatchObject({ imageRefreshSeconds: 86400, imageFullReloadSeconds: 86400 });
  });

  it("clamps or replaces bad numbers instead of trusting them", () => {
    const c = loadBlocklistConfig({
      compliance: { blocklist: {
        refreshSeconds: -5, loadTimeoutMs: 1, pageSize: "x",
        response: { code: 200 }, unavailable: { code: 200 },
        attempts: { batchSize: 99999, flushSeconds: 0, maxQueue: 1 },
      } },
    });
    expect(c.refreshSeconds).toBe(5);
    expect(c.loadTimeoutMs).toBe(500);
    expect(c.pageSize).toBe(5000);
    expect(c.response.code).toBe(400);
    expect(c.unavailable.code).toBe(500);
    expect(c.attempts).toEqual({ batchSize: 1000, flushSeconds: 1, maxQueue: 100 });
  });

  it("ignores a malformed fields value", () => {
    expect(loadBlocklistConfig({ compliance: { blocklist: { fields: "nope" } } }).fields).toEqual({});
  });

  it("has the tuning knobs with the same defaults the code used to hardcode", () => {
    expect(loadBlocklistConfig({})).toMatchObject({ refreshJitterPercent: 20, openWarnSeconds: 60, maxUrlsPerAd: 200 });
  });

  it("reads the tuning knobs from config.json and clamps bad values", () => {
    expect(loadBlocklistConfig({ compliance: { blocklist: { refreshJitterPercent: 0, openWarnSeconds: 120, maxUrlsPerAd: 50 } } }))
      .toMatchObject({ refreshJitterPercent: 0, openWarnSeconds: 120, maxUrlsPerAd: 50 });
    expect(loadBlocklistConfig({ compliance: { blocklist: { refreshJitterPercent: 500, openWarnSeconds: 1, maxUrlsPerAd: 0 } } }))
      .toMatchObject({ refreshJitterPercent: 50, openWarnSeconds: 5, maxUrlsPerAd: 1 });
    expect(loadBlocklistConfig({ compliance: { blocklist: { refreshJitterPercent: "x", openWarnSeconds: null, maxUrlsPerAd: {} } } }))
      .toMatchObject({ refreshJitterPercent: 20, openWarnSeconds: 60, maxUrlsPerAd: 200 });
  });
});

describe("imageMatch settings", () => {
// compliance.imageMatch is built in src/config/index.js. Each case loads the real module in a
// fresh Node process against a temp config.json, so nothing here touches the repo's config.json.

const root = path.resolve(import.meta.dirname, "../../..");
let dir;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "imagematch-config-")); });
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function load(fileConfig, env = {}) {
  const file = path.join(dir, "config.json");
  fs.writeFileSync(file, JSON.stringify(fileConfig ?? {}));
  const out = execFileSync(
    process.execPath,
    ["-e", "console.log(JSON.stringify(require('./src/config').compliance.imageMatch))"],
    {
      cwd: root,
      encoding: "utf8",
      env: { PATH: process.env.PATH, PAS_NODE_API_CONFIG_PATH: file, IMAGE_MATCH_ENABLED: "", IMAGE_HASH_API_URL: "", IMAGE_HASH_API_KEY: "", ...env },
    }
  );
  return JSON.parse(out.trim().split("\n").pop());
}

function loadRequest(fileConfig, env = {}) {
  const file = path.join(dir, "config.json");
  fs.writeFileSync(file, JSON.stringify(fileConfig ?? {}));
  const out = execFileSync(
    process.execPath,
    ["-e", "console.log(JSON.stringify(require('./src/config').compliance.request))"],
    { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH, PAS_NODE_API_CONFIG_PATH: file, COPYRIGHT_REQUEST_TOKEN: "", ...env } }
  );
  return JSON.parse(out.trim().split("\n").pop());
}

describe("config > compliance.request (the landing-page form's route)", () => {
  it("is off by default, closed to the public, with safe limits", () => {
    expect(loadRequest({})).toEqual({ enabled: false, token: "", allowPublic: false, addedBy: "landing-form", rateLimit: { windowMs: 60000, max: 10 } });
  });

  it("the token comes from the environment only; enabled and allowPublic need an explicit true", () => {
    expect(loadRequest({ compliance: { request: { token: "from-file" } } }).token).toBe("");
    expect(loadRequest({}, { COPYRIGHT_REQUEST_TOKEN: "  s3cret " }).token).toBe("s3cret");
    for (const v of ["true", 1, "yes", null]) {
      const c = loadRequest({ compliance: { request: { enabled: v, allowPublic: v } } });
      expect(c.enabled).toBe(false);
      expect(c.allowPublic).toBe(false);
    }
    expect(loadRequest({ compliance: { request: { enabled: true, allowPublic: true } } })).toMatchObject({ enabled: true, allowPublic: true });
  });

  it("clamps the rate limit and the recorded name", () => {
    expect(loadRequest({ compliance: { request: { rateLimit: { windowMs: 1, max: 10 ** 9 } } } }).rateLimit).toEqual({ windowMs: 1000, max: 1000 });
    expect(loadRequest({ compliance: { request: { rateLimit: { windowMs: "x", max: 0 } } } }).rateLimit).toEqual({ windowMs: 60000, max: 1 });
    expect(loadRequest({ compliance: { request: { addedBy: "x".repeat(300) } } }).addedBy).toHaveLength(128);
    expect(loadRequest({ compliance: { request: { addedBy: "  " } } }).addedBy).toBe("landing-form");
  });
});

describe("config > compliance.imageMatch", () => {
  it("is off by default, with no address or key, and safe numbers", () => {
    expect(load({})).toEqual({
      enabled: false,
      baseUrl: "",
      apiKey: "",
      timeoutMs: 30000,
      concurrency: 4,
      maxConcurrency: 0,
      retries: 2,
      retryDelayMs: 500,
      maxFileBytes: 50 * 1024 * 1024,
      hashVersion: "sscd-simhash-v1",
      perceptual: { enabled: false, rejectDistance: 0, reviewDistance: 0 },
      job: {
        pageSize: 200, pageDelayMs: 200, maxImages: 10000, includeCarousel: false, maxConsecutiveFailures: 20,
        addBatchSize: 200, maxOwners: 20,
      },
      worker: {
        networks: [], staleClaimMinutes: 60, maxAttempts: 3, pauseSeconds: 300,
        newJobsPerTick: 100, maxJobsPerTick: 20, maxImagesPerJob: 50000, addedBy: "imagematch-worker",
      },
      sweep: { enabled: false, recordHashes: false, pageSize: 100, budgetShare: 0.4 },
      backfill: { enabled: false, pageSize: 100, fromId: 0 },
    });
  });

  it("recording every new image's hash needs an explicit true, and the backfill is off with a clamped page size and start", () => {
    for (const v of ["true", 1, "yes", null]) {
      expect(load({ compliance: { imageMatch: { sweep: { recordHashes: v }, backfill: { enabled: v } } } }).sweep.recordHashes).toBe(false);
      expect(load({ compliance: { imageMatch: { backfill: { enabled: v } } } }).backfill.enabled).toBe(false);
    }
    expect(load({ compliance: { imageMatch: { sweep: { recordHashes: true } } } }).sweep.recordHashes).toBe(true);
    expect(load({ compliance: { imageMatch: { backfill: { enabled: true, pageSize: 10 ** 6, fromId: 123456 } } } }).backfill).toEqual({ enabled: true, pageSize: 500, fromId: 123456 });
    expect(load({ compliance: { imageMatch: { backfill: { pageSize: 0, fromId: -9 } } } }).backfill).toEqual({ enabled: false, pageSize: 1, fromId: 0 });
  });

  it("calls at once adapt only when maxConcurrency is set (0 = off), and jobs per pass are clamped", () => {
    expect(load({ compliance: { imageMatch: { maxConcurrency: 16 } } }).maxConcurrency).toBe(16);
    expect(load({ compliance: { imageMatch: { maxConcurrency: 10 ** 6 } } }).maxConcurrency).toBe(64);
    expect(load({ compliance: { imageMatch: { maxConcurrency: -3 } } }).maxConcurrency).toBe(0);
    expect(load({ compliance: { imageMatch: { worker: { maxJobsPerTick: 0 } } } }).worker.maxJobsPerTick).toBe(1);
    expect(load({ compliance: { imageMatch: { worker: { maxJobsPerTick: 10 ** 6 } } } }).worker.maxJobsPerTick).toBe(200);
  });

  it("the check of new ads is off by default, needs enabled: true, and its numbers are clamped", () => {
    for (const v of ["true", 1, "yes", null]) {
      expect(load({ compliance: { imageMatch: { sweep: { enabled: v } } } }).sweep.enabled).toBe(false);
    }
    expect(load({ compliance: { imageMatch: { sweep: { enabled: true } } } }).sweep).toEqual({ enabled: true, recordHashes: false, pageSize: 100, budgetShare: 0.4 });
    expect(load({ compliance: { imageMatch: { sweep: { pageSize: 10 ** 9, budgetShare: 5 } } } }).sweep).toMatchObject({ pageSize: 500, budgetShare: 0.9 });
    expect(load({ compliance: { imageMatch: { sweep: { pageSize: 0, budgetShare: 0.01 } } } }).sweep).toMatchObject({ pageSize: 1, budgetShare: 0.1 });
  });

  it("the worker's numbers are clamped to safe ranges, its networks are lowercased, and junk falls back to the defaults", () => {
    const high = load({ compliance: { imageMatch: { worker: { staleClaimMinutes: 10 ** 9, maxAttempts: 10 ** 6, pauseSeconds: 10 ** 9, newJobsPerTick: 10 ** 6, maxImagesPerJob: 10 ** 12 } } } }).worker;
    expect(high).toMatchObject({ staleClaimMinutes: 1440, maxAttempts: 20, pauseSeconds: 3600, newJobsPerTick: 500, maxImagesPerJob: 1000000 });
    const low = load({ compliance: { imageMatch: { worker: { staleClaimMinutes: 0, maxAttempts: 0, pauseSeconds: 0, newJobsPerTick: 0, maxImagesPerJob: 0 } } } }).worker;
    expect(low).toMatchObject({ staleClaimMinutes: 5, maxAttempts: 1, pauseSeconds: 10, newJobsPerTick: 1, maxImagesPerJob: 1 });
    const junk = load({ compliance: { imageMatch: { worker: { maxAttempts: {}, networks: "FACEBOOK", addedBy: 5 } } } }).worker;
    expect(junk).toMatchObject({ maxAttempts: 3, addedBy: "5" });
    expect(load({ compliance: { imageMatch: { worker: { networks: ["Facebook", "REDDIT"] } } } }).worker.networks).toEqual(["facebook", "reddit"]);
    expect(load({ compliance: { imageMatch: { worker: { addedBy: "x".repeat(300) } } } }).worker.addedBy).toHaveLength(128);
  });

  it("the hashing job's settings are gentle by default, clamped, and the carousel needs an explicit true", () => {
    const high = load({ compliance: { imageMatch: { job: { pageSize: 99999, pageDelayMs: 10 ** 9, maxImages: 10 ** 12, maxConsecutiveFailures: 10 ** 6, addBatchSize: 10 ** 6, maxOwners: 10 ** 6 } } } }).job;
    expect(high).toMatchObject({ pageSize: 500, pageDelayMs: 60000, maxImages: 1000000, maxConsecutiveFailures: 1000, addBatchSize: 1000, maxOwners: 200 });
    const low = load({ compliance: { imageMatch: { job: { pageSize: 1, pageDelayMs: -5, maxImages: 0, maxConsecutiveFailures: 0, addBatchSize: 0, maxOwners: 0 } } } }).job;
    expect(low).toMatchObject({ pageSize: 10, pageDelayMs: 0, maxImages: 1, maxConsecutiveFailures: 1, addBatchSize: 1, maxOwners: 1 });
    for (const v of ["true", 1, "yes", null]) {
      expect(load({ compliance: { imageMatch: { job: { includeCarousel: v } } } }).job.includeCarousel).toBe(false);
    }
    expect(load({ compliance: { imageMatch: { job: { includeCarousel: true } } } }).job.includeCarousel).toBe(true);
  });

  it("near-copy matching is off by default, needs enabled: true, and clamps the distances to 0..256", () => {
    expect(load({}).perceptual.enabled).toBe(false);
    for (const v of ["true", 1, "yes", null]) {
      expect(load({ compliance: { imageMatch: { perceptual: { enabled: v } } } }).perceptual.enabled).toBe(false);
    }
    expect(load({ compliance: { imageMatch: { perceptual: { enabled: true, rejectDistance: 12, reviewDistance: 30 } } } }).perceptual)
      .toEqual({ enabled: true, rejectDistance: 12, reviewDistance: 30 });
    expect(load({ compliance: { imageMatch: { perceptual: { rejectDistance: 999, reviewDistance: -5 } } } }).perceptual)
      .toMatchObject({ rejectDistance: 256, reviewDistance: 0 });
    expect(load({ compliance: { imageMatch: { perceptual: { rejectDistance: "abc", reviewDistance: {} } } } }).perceptual)
      .toMatchObject({ rejectDistance: 0, reviewDistance: 0 });
  });

  it("reads the address from config.json and the key only from the environment", () => {
    const c = load(
      { compliance: { imageMatch: { baseUrl: "https://hash.example.test/", apiKey: "from-file-must-be-ignored" } } },
      { IMAGE_HASH_API_KEY: "  env-key  " }
    );
    expect(c.baseUrl).toBe("https://hash.example.test");
    expect(c.apiKey).toBe("env-key");
    expect(load({ compliance: { imageMatch: { apiKey: "from-file-must-be-ignored" } } }).apiKey).toBe("");
  });

  it("environment variables switch it on and set the address", () => {
    const c = load({}, { IMAGE_MATCH_ENABLED: "true", IMAGE_HASH_API_URL: "https://env.example.test" });
    expect(c.enabled).toBe(true);
    expect(c.baseUrl).toBe("https://env.example.test");
  });

  it("only the value true enables it, from the file too", () => {
    expect(load({ compliance: { imageMatch: { enabled: true } } }).enabled).toBe(true);
    for (const v of [false, "yes", 1, null]) expect(load({ compliance: { imageMatch: { enabled: v } } }).enabled).toBe(false);
  });

  it("clamps the numbers to safe ranges and ignores invalid ones", () => {
    const high = load({ compliance: { imageMatch: { timeoutMs: 999999, concurrency: 500, retries: 99, retryDelayMs: 999999, maxFileBytes: 10 ** 12 } } });
    expect(high).toMatchObject({ timeoutMs: 120000, concurrency: 32, retries: 5, retryDelayMs: 10000, maxFileBytes: 50 * 1024 * 1024 });
    const low = load({ compliance: { imageMatch: { timeoutMs: 1, concurrency: 0, retries: -1, retryDelayMs: 1, maxFileBytes: 1 } } });
    expect(low).toMatchObject({ timeoutMs: 1000, concurrency: 1, retries: 0, retryDelayMs: 50, maxFileBytes: 1024 });
    const junk = load({ compliance: { imageMatch: { timeoutMs: "abc", concurrency: null, retries: {}, retryDelayMs: [] } } });
    expect(junk).toMatchObject({ timeoutMs: 30000, concurrency: 4, retries: 2, retryDelayMs: 500 });
  });

  it("lowercases the expected hash version", () => {
    expect(load({ compliance: { imageMatch: { hashVersion: "SSCD-SimHash-V2" } } }).hashVersion).toBe("sscd-simhash-v2");
  });
});
});
