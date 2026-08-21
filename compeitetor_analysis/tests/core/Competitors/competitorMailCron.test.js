import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  // fs
  readFileSync: vi.fn(), writeFileSync: vi.fn(), mkdirSync: vi.fn(),
  // node-cron
  schedule: vi.fn(), validate: vi.fn(),
  // keywordNotifyCron.toCronExpr
  toCronExpr: vi.fn(),
  // monitorService methods (invoked in-process by invokeService)
  getCompetitors: vi.fn(), updateCompetitorsStatus: vi.fn(),
  activeCompetitorContacts: vi.fn(), updateDailyCompetitors: vi.fn(),
  loggerInfo: vi.fn(), loggerError: vi.fn(),
  // config + moment state
  cfg: {}, dateKey: "2026-08-21", hour: 5,
  lastRun: {},
}));

vi.mock("node-cron", () => ({ default: { schedule: (...a) => h.schedule(...a), validate: (...a) => h.validate(...a) } }));
vi.mock("fs", () => ({ default: {
  readFileSync: (...a) => h.readFileSync(...a),
  writeFileSync: (...a) => h.writeFileSync(...a),
  mkdirSync: (...a) => h.mkdirSync(...a),
} }));
vi.mock("config", () => ({ default: { get: (k) => { const v = h.cfg[k]; if (v === "__THROW__") throw new Error("unset"); return v; } } }));
vi.mock("moment", () => {
  const m = { utcOffset: () => m, format: () => h.dateKey, hour: () => h.hour };
  const moment = () => m;
  moment.utc = () => m;
  return { default: moment };
});
vi.mock("../../../resources/logs/logger.log.js", () => ({ default: { info: h.loggerInfo, error: h.loggerError, warn: vi.fn() } }));
vi.mock("../../../core/mailer/keywordNotifyCron.js", () => ({ toCronExpr: (...a) => h.toCronExpr(...a) }));
// monitorService pulls in Elasticsearch/Mongo/config — stub it entirely so this
// file tests ONLY competitorMailCron's own orchestration, not monitorService's
// internals (those already have dedicated coverage in monitorService.test.js).
vi.mock("../../../core/Competitors/monitorService.js", () => ({
  default: {
    getCompetitors: (...a) => h.getCompetitors(...a),
    updateCompetitorsStatus: (...a) => h.updateCompetitorsStatus(...a),
    activeCompetitorContacts: (...a) => h.activeCompetitorContacts(...a),
    updateDailyCompetitors: (...a) => h.updateDailyCompetitors(...a),
  },
}));

let mod;
async function load() {
  vi.resetModules();
  mod = await import("../../../core/Competitors/competitorMailCron.js");
  return mod;
}

function okResp(data) {
  return { statusCode: 200, body: { status: "success", message: "ok", data } };
}
function namesResp(n) {
  return okResp({ competitorNames: Array.from({ length: n }, (_, i) => `C${i}`) });
}

beforeEach(() => {
  for (const k of ["readFileSync", "writeFileSync", "mkdirSync", "schedule", "validate", "toCronExpr", "getCompetitors", "updateCompetitorsStatus", "activeCompetitorContacts", "updateDailyCompetitors", "loggerInfo", "loggerError"]) h[k].mockReset();

  h.cfg = {
    competitor_mail_cron: true,
    competitor_mail_cron_schedule: "0 5 * * *",
    competitor_get_batch_size: 500,
    competitor_leg_max_minutes: 20,
  };
  h.dateKey = "2026-08-21";
  h.hour = 5;
  h.lastRun = {};

  h.readFileSync.mockImplementation((file) => {
    const f = String(file);
    if (f.includes("last_run")) return JSON.stringify(h.lastRun);
    throw new Error("nofile");
  });
  h.validate.mockReturnValue(true);
  h.toCronExpr.mockImplementation((s) => s);

  // Realistic default: each platform has exactly ONE small (below-batch-size)
  // batch of candidates, so a leg does one getCompetitors + one
  // updateCompetitorsStatus call and then stops (drained). Tracked per
  // platform so re-calling the same platform correctly reports "drained".
  const seenPerPlatform = {};
  h.getCompetitors.mockImplementation(async (req, res) => {
    const p = req.query.platform;
    seenPerPlatform[p] = (seenPerPlatform[p] || 0) + 1;
    res.send(seenPerPlatform[p] === 1 ? namesResp(1) : namesResp(0));
  });
  h.updateCompetitorsStatus.mockImplementation(async (req, res) => { res.send(okResp([])); });
  h.activeCompetitorContacts.mockImplementation(async (req, res) => { res.send(okResp([])); });
  h.updateDailyCompetitors.mockImplementation(async (req, res) => { res.send(okResp([])); });
});

afterEach(() => { vi.useRealTimers(); });

describe("competitorMailCron > runCompetitorPipelineOnce", () => {
  it("fresh run: all 3 platform legs run one batch each, then send, then reset, then writes last-run", async () => {
    const { runCompetitorPipelineOnce } = await load();
    await runCompetitorPipelineOnce("test");

    expect(h.getCompetitors).toHaveBeenCalledTimes(3); // one batch per platform, drained after
    const platformsSeen = h.getCompetitors.mock.calls.map((c) => c[0].query.platform).sort();
    expect(platformsSeen).toEqual(["facebook", "google", "instagram"]);
    expect(h.updateCompetitorsStatus).toHaveBeenCalledTimes(3);

    // send + reset only after all 3 legs settle
    expect(h.activeCompetitorContacts).toHaveBeenCalledTimes(1);
    expect(h.updateDailyCompetitors).toHaveBeenCalledTimes(1);

    const lastRunWrite = h.writeFileSync.mock.calls.find((c) => String(c[0]).includes("last_run"));
    expect(lastRunWrite).toBeTruthy();
    expect(JSON.parse(lastRunWrite[1]).date).toBe("2026-08-21");
    expect(h.loggerInfo).toHaveBeenCalledWith(expect.stringContaining("===== DONE 2026-08-21"));
  });

  it("bounded batch loop: a full batch triggers another iteration; a partial/empty batch stops it", async () => {
    // facebook: batch 1 full (500 == batchSize) -> loops; batch 2 partial (3) -> stops.
    let fbCalls = 0;
    h.getCompetitors.mockImplementation(async (req, res) => {
      if (req.query.platform !== "facebook") { res.send(namesResp(0)); return; }
      fbCalls++;
      res.send(fbCalls === 1 ? namesResp(500) : namesResp(3));
    });
    const { runCompetitorPipelineOnce } = await load();
    await runCompetitorPipelineOnce("test");

    const fbGetCalls = h.getCompetitors.mock.calls.filter((c) => c[0].query.platform === "facebook");
    const fbCheckCalls = h.updateCompetitorsStatus.mock.calls.filter((c) => c[0].query.platform === "facebook");
    expect(fbGetCalls.length).toBe(2); // full batch, then the partial batch that ends it
    expect(fbCheckCalls.length).toBe(2); // both batches get ES-checked
    // every single getCompetitors call — no matter how many loops — asked for
    // the SAME fixed, bounded batch size, never the whole remaining pool
    for (const c of fbGetCalls) expect(c[0].query.limit).toBe("500");
  });

  it("hits the per-leg time cap mid-loop: stops that platform early, logs it, day still completes normally", async () => {
    h.cfg.competitor_leg_max_minutes = 1; // 60,000ms cap
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T00:00:00Z"));

    // facebook keeps returning FULL batches forever (would loop indefinitely
    // if not time-capped); jump the clock past the cap after its first batch.
    h.getCompetitors.mockImplementation(async (req, res) => {
      res.send(req.query.platform === "facebook" ? namesResp(500) : namesResp(0));
    });
    h.updateCompetitorsStatus.mockImplementation(async (req, res) => {
      if (req.query.platform === "facebook") vi.setSystemTime(new Date("2026-08-21T00:01:10Z")); // +70s, past the 60s cap
      res.send(okResp([]));
    });

    const { runCompetitorPipelineOnce } = await load();
    await runCompetitorPipelineOnce("test");

    const fbGetCalls = h.getCompetitors.mock.calls.filter((c) => c[0].query.platform === "facebook");
    expect(fbGetCalls.length).toBe(1); // stopped after exactly one batch, not looping forever
    expect(h.loggerInfo).toHaveBeenCalledWith(expect.stringContaining("leg facebook hit the 60000ms time cap"));

    // the rest of the day proceeds normally despite the time-capped platform
    expect(h.activeCompetitorContacts).toHaveBeenCalledTimes(1);
    expect(h.updateDailyCompetitors).toHaveBeenCalledTimes(1);
    const lastRunWrite = h.writeFileSync.mock.calls.find((c) => String(c[0]).includes("last_run"));
    expect(JSON.parse(lastRunWrite[1]).legTimedOut).toEqual(["facebook"]);
  });

  it("bounded batch size is read from config, never the route's implicit default-of-1", async () => {
    h.cfg.competitor_get_batch_size = 250;
    const { runCompetitorPipelineOnce } = await load();
    await runCompetitorPipelineOnce("test");
    for (const call of h.getCompetitors.mock.calls) {
      expect(call[0].query.limit).toBe("250");
    }
  });

  it("already completed for today → skip, no service calls", async () => {
    h.lastRun = { date: "2026-08-21" };
    const { runCompetitorPipelineOnce } = await load();
    await runCompetitorPipelineOnce("test");
    expect(h.getCompetitors).not.toHaveBeenCalled();
    expect(h.loggerInfo).toHaveBeenCalledWith(expect.stringContaining("already completed"));
  });

  it("concurrent invocation → second sees running flag and skips", async () => {
    let releaseLeg;
    h.getCompetitors.mockImplementationOnce(
      (req, res) => new Promise((r) => { releaseLeg = () => { res.send(namesResp(0)); r(); }; })
    );
    const { runCompetitorPipelineOnce } = await load();
    const p1 = runCompetitorPipelineOnce("first");
    const p2 = runCompetitorPipelineOnce("second");
    await p2; // returns immediately via the running guard
    expect(h.loggerInfo).toHaveBeenCalledWith(expect.stringContaining("already in progress"));
    releaseLeg();
    await p1;
  });

  it("legs run CONCURRENTLY: a slow facebook leg does not block instagram/google from completing their own get+check", async () => {
    let releaseFacebook;
    h.getCompetitors.mockImplementation((req, res) => {
      if (req.query.platform === "facebook") {
        return new Promise((r) => { releaseFacebook = () => { res.send(namesResp(1)); r(); }; });
      }
      res.send(namesResp(1));
      return Promise.resolve();
    });
    const { runCompetitorPipelineOnce } = await load();
    const p = runCompetitorPipelineOnce("test");

    // Let every already-resolvable microtask run while facebook is still hung.
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(h.updateCompetitorsStatus.mock.calls.map((c) => c[0].query.platform)).toContain("instagram");
    expect(h.updateCompetitorsStatus.mock.calls.map((c) => c[0].query.platform)).toContain("google");
    expect(h.activeCompetitorContacts).not.toHaveBeenCalled(); // still waiting on facebook

    releaseFacebook();
    await p;
    expect(h.activeCompetitorContacts).toHaveBeenCalledTimes(1);
  });

  it("one platform's leg throws (e.g. instagram ES down) → logged, but facebook/google still complete and send/reset still run", async () => {
    h.updateCompetitorsStatus.mockImplementation(async (req, res) => {
      if (req.query.platform === "instagram") throw new Error("es-down");
      res.send(okResp([]));
    });
    const { runCompetitorPipelineOnce } = await load();
    await runCompetitorPipelineOnce("test");

    // all 3 legs still attempted — one platform's ES cluster being down never
    // stops the other two, which hit genuinely separate clusters
    expect(h.getCompetitors).toHaveBeenCalledTimes(3);
    expect(h.loggerError).toHaveBeenCalledWith(expect.stringContaining("leg instagram FAILED"));

    // send + reset still happen off whatever DID get promoted
    expect(h.activeCompetitorContacts).toHaveBeenCalledTimes(1);
    expect(h.updateDailyCompetitors).toHaveBeenCalledTimes(1);

    const lastRunWrite = h.writeFileSync.mock.calls.find((c) => String(c[0]).includes("last_run"));
    expect(lastRunWrite).toBeTruthy();
    expect(JSON.parse(lastRunWrite[1]).legFailures).toEqual(["instagram"]);
  });

  it("all 3 legs fail → still logged per-platform, send/reset still attempted, run still marked done", async () => {
    h.getCompetitors.mockImplementation(async () => { throw new Error("mongo-down"); });
    const { runCompetitorPipelineOnce } = await load();
    await runCompetitorPipelineOnce("test");

    expect(h.loggerError).toHaveBeenCalledWith(expect.stringContaining("leg facebook FAILED"));
    expect(h.loggerError).toHaveBeenCalledWith(expect.stringContaining("leg instagram FAILED"));
    expect(h.loggerError).toHaveBeenCalledWith(expect.stringContaining("leg google FAILED"));
    expect(h.activeCompetitorContacts).toHaveBeenCalledTimes(1);
    expect(h.updateDailyCompetitors).toHaveBeenCalledTimes(1);
  });

  it("activeCompetitorContacts itself throwing → logged, last-run NOT written (genuine infra failure, retry next tick)", async () => {
    h.activeCompetitorContacts.mockImplementation(async () => { throw new Error("db-down"); });
    const { runCompetitorPipelineOnce } = await load();
    await runCompetitorPipelineOnce("test");
    expect(h.loggerError).toHaveBeenCalledWith(expect.stringContaining("run error"));
    const lastRunWrite = h.writeFileSync.mock.calls.find((c) => String(c[0]).includes("last_run"));
    expect(lastRunWrite).toBeFalsy();
  });
});

describe("competitorMailCron > initCompetitorMailCron", () => {
  it("disabled (competitor_mail_cron false) → no schedule registered", async () => {
    h.cfg.competitor_mail_cron = false;
    const { initCompetitorMailCron } = await load();
    initCompetitorMailCron();
    expect(h.schedule).not.toHaveBeenCalled();
    expect(h.loggerInfo).toHaveBeenCalledWith(expect.stringContaining("disabled"));
  });

  it("config.get throws → treated as disabled", async () => {
    h.cfg.competitor_mail_cron = "__THROW__";
    const { initCompetitorMailCron } = await load();
    initCompetitorMailCron();
    expect(h.schedule).not.toHaveBeenCalled();
  });

  it("enabled + valid schedule → registers with IST timezone", async () => {
    const { initCompetitorMailCron } = await load();
    initCompetitorMailCron();
    expect(h.schedule).toHaveBeenCalledWith("0 5 * * *", expect.any(Function), { timezone: "Asia/Kolkata" });
  });

  it("invalid schedule → falls back to default and logs an error", async () => {
    h.validate.mockReturnValue(false);
    const { initCompetitorMailCron } = await load();
    initCompetitorMailCron();
    expect(h.loggerError).toHaveBeenCalledWith(expect.stringContaining("invalid"));
    expect(h.schedule).toHaveBeenCalledWith("0 5 * * *", expect.any(Function), expect.anything());
  });

  it("scheduled callback invokes the pipeline", async () => {
    const { initCompetitorMailCron } = await load();
    initCompetitorMailCron();
    const cb = h.schedule.mock.calls[0][1];
    await cb();
    expect(h.getCompetitors).toHaveBeenCalled();
  });

  it("past trigger hour + not done today → catches up immediately on init", async () => {
    h.hour = 6; // >= 5
    h.lastRun = {};
    const { initCompetitorMailCron } = await load();
    initCompetitorMailCron();
    expect(h.loggerInfo).toHaveBeenCalledWith(expect.stringContaining("catching up"));
    await Promise.resolve();
  });

  it("past trigger but already done today → no catch-up", async () => {
    h.hour = 6;
    h.lastRun = { date: "2026-08-21" };
    const { initCompetitorMailCron } = await load();
    initCompetitorMailCron();
    expect(h.loggerInfo).not.toHaveBeenCalledWith(expect.stringContaining("catching up"));
  });

  it("before trigger hour → no catch-up", async () => {
    h.hour = 2; // < 5
    const { initCompetitorMailCron } = await load();
    initCompetitorMailCron();
    expect(h.loggerInfo).not.toHaveBeenCalledWith(expect.stringContaining("catching up"));
  });
});
