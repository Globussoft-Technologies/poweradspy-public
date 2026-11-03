// Copyright blocklist (B1) for TikTok — the check used by tiktok.service.js.
//
//   await init()          start it, once, after the database is connected
//   guard(ad, source)     null = allowed, otherwise the response to send  (sync, no DB call)
//   status()              state for debugging
//   await shutdown()      flush pending attempt rows
//
// Settings come from the `config` package under compliance.blocklist (with env
// overrides) and are validated in buildSettings(); bad values fall back to safe
// ones. The feature is OFF by default, so deploying the code before the tables
// exist cannot stop insertion. When it is enabled but could not start at all,
// the configured failMode applies instead of silently letting ads through.
//
// Heavy dependencies (database, logger, config, cache) are imported inside
// init(), so importing this module is free and guard() is a no-op until init().
import path from "path";
import { NETWORK, STATUS } from "./blocklist.constants.js";
import { resolveFields, extract } from "./blocklist.extract.js";
import { evaluate } from "./blocklist.match.js";

const DEFAULT_REJECT_MESSAGE = "Ad rejected: this content is not allowed.";
const DEFAULT_UNAVAILABLE_MESSAGE = "Ad insertion is temporarily unavailable.";
// Used only if the setting is missing from the config object (the real default lives in
// buildSettings below: compliance.blocklist.openWarnSeconds).
const FALLBACK_OPEN_WARN_SECONDS = 60;

const toBool = (v) => v === true || v === "true";
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const text = (v, fallback) => (typeof v === "string" && v.trim() ? v.trim() : fallback);
function boundedInt(value, fallback, min, max) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}

// Same response shape as utils/response.js (statusCode + body), with the code
// chosen by configuration.
const failure = (code, message, hint = "") => ({
  statusCode: code,
  body: { status: "failed", message, error: hint },
});

// Validated settings from the raw compliance.blocklist object.
export function buildSettings(raw, env = {}) {
  const r = isObject(raw) ? raw : {};
  const envEnabled = env.BLOCKLIST_ENABLED;
  const failMode = String(env.BLOCKLIST_FAIL_MODE || r.failMode || "closed").toLowerCase();
  const dir = env.BLOCKLIST_SNAPSHOT_DIR || r.snapshot?.dir
    || path.join("resources", "logs", "responselogs", "compliance-blocklist");

  return {
    enabled: envEnabled !== undefined && envEnabled !== "" ? toBool(envEnabled) : toBool(r.enabled),
    failMode: failMode === "open" ? "open" : "closed", // anything but 'open' means closed
    refreshSeconds: boundedInt(env.BLOCKLIST_REFRESH_SECONDS ?? r.refreshSeconds, 30, 5, 3600),
    // Random extra delay (0..N % of refreshSeconds), so several instances do not all read the database in the same second.
    refreshJitterPercent: boundedInt(r.refreshJitterPercent, 20, 0, 50),
    // With failMode 'open', log "ads are NOT being checked" at most once per this many seconds.
    openWarnSeconds: boundedInt(r.openWarnSeconds, 60, 5, 3600),
    // Most URLs checked from one ad; bounds the work per ad.
    maxUrlsPerAd: boundedInt(r.maxUrlsPerAd, 200, 1, 1000),
    // Shortest advertiser name (letters and digits only) indexed for the spelling-proof match.
    compactMinLength: boundedInt(r.compactMinLength, 4, 2, 20),
    loadTimeoutMs: boundedInt(r.loadTimeoutMs, 5000, 500, 60000),
    pageSize: boundedInt(r.pageSize, 5000, 100, 50000),
    emptyRefreshGuard: r.emptyRefreshGuard !== false,
    response: {
      code: boundedInt(r.response?.code, 422, 400, 499),
      message: text(r.response?.message, DEFAULT_REJECT_MESSAGE),
    },
    unavailable: {
      code: boundedInt(r.unavailable?.code, 503, 500, 599),
      message: text(r.unavailable?.message, DEFAULT_UNAVAILABLE_MESSAGE),
    },
    attempts: {
      batchSize: boundedInt(r.attempts?.batchSize, 100, 1, 1000),
      flushSeconds: boundedInt(r.attempts?.flushSeconds, 5, 1, 300),
      maxQueue: boundedInt(r.attempts?.maxQueue, 10000, 100, 1000000),
    },
    snapshot: { enabled: r.snapshot?.enabled !== false, dir: path.resolve(String(dir)) },
    rules: {
      adId: r.rules?.adId !== false,
      advertiser: r.rules?.advertiser !== false,
      // Also match an advertiser written with other spacing / punctuation / accents ("twinkling tree" = "TwinklingTree").
      advertiserVariant: r.rules?.advertiserVariant !== false,
      url: r.rules?.url !== false,
      domain: r.rules?.domain !== false,
    },
    fields: isObject(r.fields) ? r.fields : {},
  };
}

export class Blocklist {
  // deps: config (buildSettings result), cache?, attempts?, log
  constructor({ config, cache = null, attempts = null, log }) {
    this.config = config;
    this.cache = cache;
    this.attempts = attempts;
    this.log = log;
    this.fields = resolveFields(config.fields);
    this.lastOpenWarn = 0;
  }

  guard(ad, source = null) {
    if (!this.config.enabled || !this.cache) return null;
    try {
      const state = this.cache.get();
      if (!state || state.status === STATUS.UNAVAILABLE || !state.snapshot) return this.unavailable();

      const extracted = extract(ad, this.fields, this.config.maxUrlsPerAd);
      const hit = evaluate(extracted, state.snapshot, this.config.rules);
      if (!hit) return null;

      this.recordAttempt(hit, extracted, source);
      return failure(this.config.response.code, this.config.response.message, "This content cannot be accepted. Do not resend it.");
    } catch (err) {
      this.log.error("blocklist check failed", { error: err.message, stack: err.stack });
      return this.unavailable();
    }
  }

  unavailable() {
    if (this.config.failMode === "closed") {
      return failure(this.config.unavailable.code, this.config.unavailable.message, "Retry shortly. The ad was not stored.");
    }
    const now = Date.now();
    const seconds = Number(this.config.openWarnSeconds);
    const warnEveryMs = (Number.isFinite(seconds) && seconds > 0 ? seconds : FALLBACK_OPEN_WARN_SECONDS) * 1000;
    if (now - this.lastOpenWarn > warnEveryMs) {
      this.lastOpenWarn = now;
      this.log.warn("blocklist unavailable; failMode=open so ads are NOT being checked");
    }
    return null;
  }

  recordAttempt(hit, extracted, source) {
    if (!this.attempts) return;
    this.attempts.record({
      network: NETWORK,
      platform_ad_id: extracted.rawAdId,
      advertiser: extracted.rawAdvertiser,
      image_url: hit.family === "url" ? hit.key : null,
      blocklist_id: hit.entry.id,
      match_type: hit.entry.entryType,
      distance: null,
      source,
    });
  }

  status() {
    return {
      enabled: this.config.enabled,
      failMode: this.config.failMode,
      list: this.cache ? this.cache.summary() : null,
      pendingAttempts: this.attempts ? this.attempts.queue.length : 0,
      droppedAttempts: this.attempts ? this.attempts.dropped : 0,
    };
  }
}

// ─── Module-level instance ───────────────────────────────────────────

let instance = null;
let initFailure = null; // set when enabled but startup crashed

async function readConfig() {
  try {
    const { default: appConfig } = await import("config");
    const raw = typeof appConfig.has === "function" && appConfig.has("compliance.blocklist")
      ? appConfig.get("compliance.blocklist")
      : undefined;
    return buildSettings(raw, process.env);
  } catch {
    return buildSettings(undefined, process.env); // config can never stop startup
  }
}

export async function init(options = {}) {
  if (instance) return instance;
  // init() must never stop the server from starting; fall back to the console if the logger cannot load.
  let log = console;
  try {
    log = options.log || (await import("../../resources/logs/logger.log.js")).default;
  } catch {
    // keep console
  }
  const config = options.config || (await readConfig());

  if (!config.enabled) {
    log.info("Copyright blocklist is disabled (compliance.blocklist.enabled)");
    instance = new Blocklist({ config, log });
    return instance;
  }

  try {
    const repository = options.repository || (await import("./blocklist.repository.js"));
    const { BlocklistCache } = await import("./blocklist.cache.js");
    const { BlockedAttemptLogger } = await import("./blocklist.attempts.js");
    const cache = new BlocklistCache({ repository, config, log });
    const attempts = new BlockedAttemptLogger({ repository, config, log });
    instance = new Blocklist({ config, cache, attempts, log });
    attempts.start();
    await cache.start();
    log.info("Copyright blocklist started", { failMode: config.failMode, list: cache.summary() });
  } catch (err) {
    initFailure = { config, error: err };
    log.error("Copyright blocklist failed to start", { error: err.message, stack: err.stack });
  }
  return instance;
}

export function guard(ad, source) {
  if (initFailure) {
    // Enabled but not running: never fail silently open unless explicitly configured.
    const { config } = initFailure;
    return config.failMode === "closed" ? failure(config.unavailable.code, config.unavailable.message) : null;
  }
  return instance ? instance.guard(ad, source) : null;
}

export function status() {
  if (initFailure) return { enabled: true, failMode: initFailure.config.failMode, startupError: initFailure.error.message };
  return instance ? instance.status() : { enabled: false };
}

export async function shutdown() {
  if (!instance) return;
  if (instance.cache) instance.cache.stop();
  if (instance.attempts) await instance.attempts.stop();
}

// Test hook: inject a prepared instance (or null to reset).
export function _setForTests(next) {
  instance = next;
  initFailure = null;
}

export default { init, guard, status, shutdown };
