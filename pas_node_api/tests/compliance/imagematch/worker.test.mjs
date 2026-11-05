import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
const require = createRequire(import.meta.url);

const { HashWorker } = require("../../../src/compliance/imagematch/worker");
const { STATUS } = require("../../../src/compliance/imagematch/job");
const { ClaimLostError } = require("../../../src/compliance/imagematch/worker");

const silent = { info() {}, warn() {}, error() {} };
const START = Date.parse("2026-11-02T10:00:00Z");

// ── an in-memory copyright_blocklist + copyright_image_hash_jobs with the same rules as the jobRepository of worker.js ──
function makeStore(entries = []) {
  const jobs = [];
  let nextId = 1;
  const clock = { t: START };
  const mine = (j, worker) => j && j.claimed_by === worker && j.status === "running";
  const repo = {
    jobs,
    async findNewAdvertisers(_sql, network, { limit = 100 } = {}) {
      return entries
        .filter((e) => (e.network === network || e.network === "all") && e.status === "active" && ["advertiser", "page", "ad_id", "url", "image_url"].includes(e.entry_type))
        .filter((e) => !jobs.some((j) => j.network === network && j.blocklist_id === e.id))
        .slice(0, limit)
        .map((e) => ({ id: e.id, value: e.value, complaint_id: e.complaint_id || null, entry_type: e.entry_type }));
    },
    async createJobs(_sql, network, list) {
      for (const e of list) {
        if (jobs.some((j) => j.network === network && j.blocklist_id === e.id)) continue;
        jobs.push({ id: nextId++, network, blocklist_id: e.id, entry_type: e.entry_type || "advertiser", advertiser_name: e.value, complaint_id: e.complaint_id || null, status: "pending", attempts: 0, claimed_by: null, heartbeat_at: null, state: null, last_error: null });
      }
      return { created: list.length };
    },
    async claimNext(_sql, network, worker, staleBefore) {
      const j = jobs.find((x) => x.network === network && (x.status === "pending" || (x.status === "running" && x.heartbeat_at < staleBefore.getTime())));
      if (!j) return null;
      Object.assign(j, { status: "running", claimed_by: worker, heartbeat_at: clock.t, attempts: j.attempts + 1 });
      return { ...j };
    },
    async loadState(_sql, id) { return jobs.find((j) => j.id === id)?.state ?? null; },
    async saveProgress(_sql, id, worker, state) {
      const j = jobs.find((x) => x.id === id);
      if (!mine(j, worker)) return false;
      j.state = state; j.heartbeat_at = clock.t;
      return true;
    },
    async finish(_sql, id, worker, status, { error } = {}) {
      const j = jobs.find((x) => x.id === id);
      if (!mine(j, worker)) return false;
      Object.assign(j, { status, last_error: error ?? null });
      return true;
    },
    async release(_sql, id, worker, { error, refundAttempt = false } = {}) {
      const j = jobs.find((x) => x.id === id);
      if (!mine(j, worker)) return false;
      Object.assign(j, { status: "pending", claimed_by: null, heartbeat_at: null, last_error: error ?? null, attempts: refundAttempt ? Math.max(j.attempts - 1, 0) : j.attempts });
      return true;
    },
  };
  return { repo, jobs, clock };
}

const advertiser = (id, value, over = {}) => ({ id, network: "facebook", entry_type: "advertiser", value, status: "active", complaint_id: null, ...over });

function setup({ entries = [advertiser(1, "Twinkling Tree")], networks = ["facebook"], script, config, getSql } = {}) {
  const store = makeStore(entries);
  const runners = [];
  const makeJob = vi.fn(({ network, checkpoint }) => {
    const runner = {
      run: vi.fn(async (opts) => (script ? script(opts, { network, checkpoint, runner }) : { status: STATUS.DONE, network, stats: { hashed: 3 } })),
      requestStop: vi.fn(),
    };
    runners.push(runner);
    return runner;
  });
  const worker = new HashWorker({
    networks, getSql: getSql || (() => ({ fake: true })), makeJob, repo: store.repo, log: silent,
    now: () => new Date(store.clock.t), workerId: "w1", config: { pauseSeconds: 300, maxAttempts: 3, staleClaimMinutes: 60, ...config },
  });
  return { worker, makeJob, runners, ...store };
}

describe("imagematch/worker > finding blocked advertisers", () => {
  it("makes a job for each blocked advertiser, page, ad id or URL, once, from its own entries and the 'all' ones", async () => {
    const entries = [
      advertiser(1, "Twinkling Tree"),
      advertiser(2, "Blue Moon", { entry_type: "page" }),
      advertiser(3, "Everywhere Ltd", { network: "all" }),
      advertiser(4, "A url", { entry_type: "url" }),
      advertiser(5, "An ad", { entry_type: "ad_id" }),
      advertiser(6, "Removed", { status: "revoked" }),
      advertiser(7, "Elsewhere", { network: "reddit" }),
    ];
    const t = setup({ entries });
    await t.worker.discover("facebook", {});
    expect(t.jobs.map((j) => j.advertiser_name).sort()).toEqual(["A url", "An ad", "Blue Moon", "Everywhere Ltd", "Twinkling Tree"]);
    expect(Object.fromEntries(t.jobs.map((j) => [j.advertiser_name, j.entry_type]))).toMatchObject({ "A url": "url", "An ad": "ad_id", "Twinkling Tree": "advertiser", "Blue Moon": "page" });
    await t.worker.discover("facebook", {});
    expect(t.jobs).toHaveLength(5); // a repeat adds nothing
  });

  it("an advertiser added later is picked up on a later pass, with its complaint id", async () => {
    const t = setup({ entries: [] });
    expect((await t.worker.tick()).created).toBe(0);
    t.jobs.length = 0;
    const entries = [advertiser(9, "New Brand", { complaint_id: "11111111-1111-1111-1111-111111111111" })];
    const t2 = setup({ entries });
    const out = await t2.worker.tick();
    expect(out.created).toBe(1);
    expect(t2.jobs[0]).toMatchObject({ advertiser_name: "New Brand", complaint_id: "11111111-1111-1111-1111-111111111111" });
  });
});

describe("imagematch/worker > running a job", () => {
  it("runs the job for the advertiser, as an applied run with the job number, who added it, and the complaint id", async () => {
    const t = setup({ entries: [advertiser(1, "Twinkling Tree", { complaint_id: "11111111-1111-1111-1111-111111111111" })] });
    const out = await t.worker.tick();
    expect(out.ran).toHaveLength(1);
    expect(t.runners[0].run).toHaveBeenCalledWith({
      names: ["Twinkling Tree"], apply: true, jobId: "1", resume: false, addedBy: "imagematch-worker",
      reason: 'auto: advertiser "Twinkling Tree" is blocked', complaintId: "11111111-1111-1111-1111-111111111111",
      entry: { type: "advertiser", value: "Twinkling Tree" }, generation: 1,
    });
  });

  it("passes no complaint id when the entry has none", async () => {
    const t = setup();
    await t.worker.tick();
    expect(t.runners[0].run.mock.calls[0][0].complaintId).toBeUndefined();
  });

  it("marks a finished job done and counts it", async () => {
    const t = setup();
    const out = await t.worker.tick();
    expect(t.jobs[0]).toMatchObject({ status: "done", attempts: 1, last_error: null });
    expect(out.ran[0]).toMatchObject({ jobId: 1, outcome: "done", stats: { hashed: 3 } });
  });

  it("runs one job per network per pass and takes the rest on the next passes", async () => {
    const t = setup({ entries: [advertiser(1, "A One"), advertiser(2, "B Two"), advertiser(3, "C Three")] });
    expect((await t.worker.tick()).ran).toHaveLength(1);
    expect(t.jobs.map((j) => j.status)).toEqual(["done", "pending", "pending"]);
    await t.worker.tick();
    await t.worker.tick();
    expect(t.jobs.map((j) => j.status)).toEqual(["done", "done", "done"]);
    expect((await t.worker.tick()).ran).toHaveLength(0);
  });

  it("continues a job that has a saved place (resume), and starts a fresh one without", async () => {
    const t = setup();
    await t.worker.discover("facebook", {});
    t.jobs[0].state = JSON.stringify({ owners: { 1: { lastAdId: 40, done: false } } });
    await t.worker.tick();
    expect(t.runners[0].run.mock.calls[0][0].resume).toBe(true);
  });

  it("the job saves its place through the checkpoint it is given, and the row keeps it", async () => {
    const t = setup({
      script: async ({ jobId }, { checkpoint }) => {
        await checkpoint.save(jobId, { owners: { 1: { lastAdId: 10 } } });
        return { status: STATUS.DONE, stats: {} };
      },
    });
    await t.worker.tick();
    expect(JSON.parse(t.jobs[0].state)).toEqual({ owners: { 1: { lastAdId: 10 } } });
  });
});

describe("imagematch/worker > how a job ends", () => {
  it("no_owner and limit_reached are final, with the reason kept", async () => {
    for (const [status, message, expected] of [
      [STATUS.NO_OWNER, "no advertiser matches those names / ids", "no_owner"],
      [STATUS.LIMIT_REACHED, undefined, "limit_reached"],
    ]) {
      const t = setup({ script: async () => ({ status, message }) });
      await t.worker.tick();
      expect(t.jobs[0].status).toBe(expected);
      if (message) expect(t.jobs[0].last_error).toBe(message);
      expect((await t.worker.tick()).ran).toHaveLength(0); // not tried again
    }
  });

  it("a request that cannot work (invalid input, too many owners) fails at once, without retries", async () => {
    for (const status of [STATUS.INVALID_INPUT, STATUS.TOO_MANY_OWNERS, STATUS.JOB_EXISTS]) {
      const t = setup({ script: async () => ({ status, message: "cannot work" }) });
      await t.worker.tick();
      expect(t.jobs[0]).toMatchObject({ status: "failed" });
      expect(t.jobs[0].last_error).toContain(status);
    }
  });

  it("a bad key, a service that is not ready or a wrong hash version: back to the queue, the try is not counted, and the worker waits", async () => {
    for (const status of [STATUS.UNAUTHORIZED, STATUS.NOT_CONFIGURED, STATUS.SERVICE_NOT_READY, STATUS.HASH_VERSION_MISMATCH]) {
      const t = setup({ entries: [advertiser(1, "A One"), advertiser(2, "B Two")], script: async () => ({ status, message: "nope" }) });
      const first = await t.worker.tick();
      expect(first.ran[0]).toMatchObject({ outcome: "pending", paused: true });
      expect(t.jobs[0]).toMatchObject({ status: "pending", attempts: 0 });
      expect(t.jobs[0].last_error).toContain(status);

      // paused: nothing runs, and nothing is claimed, until the pause is over
      const second = await t.worker.tick();
      expect(second).toMatchObject({ paused: true, ran: [] });
      expect(t.makeJob).toHaveBeenCalledTimes(1);
      t.clock.t += 301 * 1000;
      expect((await t.worker.tick()).ran).toHaveLength(1);
      expect(t.makeJob).toHaveBeenCalledTimes(2);
    }
  });

  it("a service that keeps failing: tried again, each try counted, and failed after maxAttempts", async () => {
    const t = setup({ script: async () => ({ status: STATUS.SERVICE_UNAVAILABLE, message: "503 in a row" }) });
    const seen = [];
    for (let i = 0; i < 3; i += 1) {
      await t.worker.tick();
      seen.push({ status: t.jobs[0].status, attempts: t.jobs[0].attempts });
      t.clock.t += 301 * 1000; // past the pause
    }
    expect(seen).toEqual([{ status: "pending", attempts: 1 }, { status: "pending", attempts: 2 }, { status: "failed", attempts: 3 }]);
    expect(t.jobs[0].last_error).toContain("service_unavailable");
    expect((await t.worker.tick()).ran).toHaveLength(0);
  });

  it("a database write that failed is retried the same way", async () => {
    const t = setup({ script: async () => ({ status: STATUS.DATABASE_WRITE_FAILED, message: "x" }) });
    await t.worker.tick();
    expect(t.jobs[0]).toMatchObject({ status: "pending", attempts: 1 });
  });

  it("a stop (shutdown) puts the job back, keeping its place and not counting the try", async () => {
    const t = setup({ script: async () => ({ status: STATUS.STOPPED }) });
    await t.worker.tick();
    expect(t.jobs[0]).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("a job that crashes is tried again, and fails after maxAttempts; it never throws out of the pass", async () => {
    const t = setup({ script: async () => { throw new Error("unexpected crash"); } });
    await expect(t.worker.tick()).resolves.toBeTruthy();
    expect(t.jobs[0]).toMatchObject({ status: "pending", attempts: 1 });
    expect(t.jobs[0].last_error).toBe("unexpected crash");
    await t.worker.tick();
    const out = await t.worker.tick();
    expect(t.jobs[0]).toMatchObject({ status: "failed", attempts: 3 });
    expect(out.ran[0].outcome).toBe("failed");
  });

  it("when another worker took the job over, this one changes nothing", async () => {
    const t = setup({
      script: async () => {
        // simulate: the job was taken over by another worker while this one ran
        Object.assign(t.jobs[0], { claimed_by: "w2" });
        throw new ClaimLostError(1);
      },
    });
    const out = await t.worker.tick();
    expect(out.ran[0].outcome).toBe("claim_lost");
    expect(t.jobs[0]).toMatchObject({ status: "running", claimed_by: "w2" });
  });
});

describe("imagematch/worker > two workers and dead workers", () => {
  it("does not take a job that another worker is running, but takes over one whose worker stopped reporting", async () => {
    const t = setup();
    await t.worker.discover("facebook", {});
    Object.assign(t.jobs[0], { status: "running", claimed_by: "w2", heartbeat_at: t.clock.t - 5 * 60 * 1000, attempts: 1 });
    expect((await t.worker.tick()).ran).toHaveLength(0); // 5 minutes of silence is not dead yet (limit is 60)

    t.clock.t += 61 * 60 * 1000;
    const out = await t.worker.tick();
    expect(out.ran).toHaveLength(1);
    expect(t.jobs[0]).toMatchObject({ status: "done", claimed_by: "w1", attempts: 2 });
  });
});

describe("imagematch/worker > networks", () => {
  it("skips a network with no SQL connection and carries on with the others", async () => {
    const entries = [advertiser(1, "On Reddit", { network: "reddit" }), advertiser(2, "On Quora", { network: "quora" })];
    const t = setup({ entries, networks: ["reddit", "quora"], getSql: (n) => (n === "reddit" ? null : { fake: n }) });
    const out = await t.worker.tick();
    expect(out.ran.map((r) => r.network)).toEqual(["quora"]);
  });

  it("a failure in one network does not stop the others, and never throws", async () => {
    const entries = [advertiser(1, "On Reddit", { network: "reddit" }), advertiser(2, "On Quora", { network: "quora" })];
    const t = setup({ entries, networks: ["reddit", "quora"] });
    const original = t.repo.findNewAdvertisers;
    t.repo.findNewAdvertisers = async (sql, network, o) => { if (network === "reddit") throw new Error("table missing"); return original(sql, network, o); };
    const out = await t.worker.tick();
    expect(out.ran.map((r) => r.network)).toEqual(["quora"]);

    const t2 = setup({ networks: ["facebook"], getSql: () => { throw new Error("pool closed"); } });
    await expect(t2.worker.tick()).resolves.toMatchObject({ created: 0, ran: [] });
  });

  it("covers no network when none is given", async () => {
    const t = setup({ networks: [] });
    expect(await t.worker.tick()).toEqual({ created: 0, ran: [] });
  });
});

describe("imagematch/worker > a time budget for one pass (what a cron tick uses)", () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (condition, ms = 2000) => {
    const t0 = Date.now();
    while (!condition()) {
      if (Date.now() - t0 > ms) throw new Error("timed out");
      await wait(3);
    }
  };

  it("asks a job that is still working when the budget ends to stop after its page, and puts it back without counting the try", async () => {
    let t;
    const script = async ({ jobId }, { checkpoint, runner }) => {
      await checkpoint.save(jobId, { owners: { 1: { lastAdId: 10, done: false } } }); // the first page is done
      await until(() => runner.requestStop.mock.calls.length > 0);
      return { status: STATUS.STOPPED };
    };
    t = setup({ script });
    const out = await t.worker.tick({ budgetMs: 30 });
    expect(t.runners[0].requestStop).toHaveBeenCalledTimes(1);
    expect(out.ran[0]).toMatchObject({ outcome: "pending" });
    expect(t.jobs[0]).toMatchObject({ status: "pending", attempts: 0 });
    expect(JSON.parse(t.jobs[0].state).owners[1].lastAdId).toBe(10); // its place is kept

    // the next pass continues from that place
    t.runners.length = 0;
    t.makeJob.mockClear();
    const next = setup({ script: async () => ({ status: STATUS.DONE }) });
    next.jobs.push(...t.jobs.map((j) => ({ ...j })));
    await next.worker.tick({ budgetMs: 30 });
    expect(next.runners[0].run.mock.calls[0][0].resume).toBe(true);
  });

  it("does not stop a job that ends within the budget (and leaves no timer behind)", async () => {
    const t = setup();
    await t.worker.tick({ budgetMs: 40 });
    await wait(80);
    expect(t.runners[0].requestStop).not.toHaveBeenCalled();
    expect(t.jobs[0].status).toBe("done");
  });

  it("with no budget (or a useless one) a job runs until it ends", async () => {
    for (const options of [undefined, {}, { budgetMs: 0 }, { budgetMs: -5 }, { budgetMs: NaN }, { budgetMs: "abc" }]) {
      const t = setup();
      const out = await t.worker.tick(options);
      expect(out.budgetUsed).toBeUndefined();
      expect(t.runners[0].requestStop).not.toHaveBeenCalled();
      expect(t.jobs[0].status).toBe("done");
    }
  });

  it("does not start another network once the budget is used up", async () => {
    const entries = [advertiser(1, "On Reddit", { network: "reddit" }), advertiser(2, "On Quora", { network: "quora" })];
    let t;
    const script = async (_opts, { runner }) => {
      await until(() => runner.requestStop.mock.calls.length > 0);
      t.clock.t += 100; // the time that passed while it worked
      return { status: STATUS.STOPPED };
    };
    t = setup({ entries, networks: ["reddit", "quora"], script });
    const out = await t.worker.tick({ budgetMs: 30 });
    expect(out.budgetUsed).toBe(true);
    expect(out.ran.map((r) => r.network)).toEqual(["reddit"]);
    expect(t.makeJob).toHaveBeenCalledTimes(1);
    expect(t.jobs.find((j) => j.network === "quora")?.status ?? "pending").not.toBe("running");
  });

  it("still starts the second network when the first one finished quickly", async () => {
    const entries = [advertiser(1, "On Reddit", { network: "reddit" }), advertiser(2, "On Quora", { network: "quora" })];
    const t = setup({ entries, networks: ["reddit", "quora"] });
    const out = await t.worker.tick({ budgetMs: 5000 });
    expect(out.ran.map((r) => r.network)).toEqual(["reddit", "quora"]);
    expect(out.budgetUsed).toBeUndefined();
  });
});

describe("imagematch cron runner", () => {
const { createRunner, inWindow } = require("../../../src/compliance/imagematch/worker");

const root = path.resolve(import.meta.dirname, "../../..");
const silent = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

// ── inWindow ─────────────────────────────────────────────────────────────────────────────────
// 2026-11-02 20:30 UTC = 02:00 on 3 Nov in Asia/Kolkata (UTC+5:30)
const AT = new Date("2026-11-02T20:30:00Z");
const clock = (iso) => new Date(iso);

describe("cronRunner > inWindow", () => {
  it("is true inside a window and false outside, in the given time zone", () => {
    expect(inWindow("01:00-06:00", AT, "Asia/Kolkata")).toBe(true);   // 02:00 there
    expect(inWindow("01:00-06:00", AT, "UTC")).toBe(false);           // 20:30 there
    expect(inWindow("20:00-21:00", AT, "UTC")).toBe(true);
    expect(inWindow("09:00-17:00", AT, "Asia/Kolkata")).toBe(false);
  });

  it("includes the start minute and excludes the end minute", () => {
    expect(inWindow("02:00-03:00", clock("2026-11-02T20:30:00Z"), "Asia/Kolkata")).toBe(true);
    expect(inWindow("01:00-02:00", clock("2026-11-02T20:30:00Z"), "Asia/Kolkata")).toBe(false);
    expect(inWindow("01:00-02:01", clock("2026-11-02T20:30:00Z"), "Asia/Kolkata")).toBe(true);
  });

  it("handles a window that crosses midnight", () => {
    for (const [iso, expected] of [
      ["2026-11-02T16:30:00Z", true],   // 22:00 IST
      ["2026-11-02T18:29:00Z", true],   // 23:59 IST
      ["2026-11-02T18:30:00Z", true],   // 00:00 IST
      ["2026-11-02T23:29:00Z", true],   // 04:59 IST
      ["2026-11-02T23:30:00Z", false],  // 05:00 IST (end excluded)
      ["2026-11-02T06:30:00Z", false],  // 12:00 IST
      ["2026-11-02T16:29:00Z", false],  // 21:59 IST
    ]) expect(inWindow("22:00-05:00", clock(iso), "Asia/Kolkata"), iso).toBe(expected);
  });

  it("accepts spaces and one-digit hours, and returns null for anything that is not a valid window", () => {
    expect(inWindow(" 1:00 - 6:00 ", AT, "Asia/Kolkata")).toBe(true);
    for (const bad of ["", "nonsense", "01:00", "01:00-", "25:00-06:00", "01:60-06:00", "02:00-02:00", "01:00-06:00-07:00", null, undefined, 5, {}]) {
      expect(inWindow(bad, AT, "Asia/Kolkata"), String(bad)).toBeNull();
    }
    expect(inWindow("01:00-06:00", AT, "Not/AZone")).toBeNull();
  });
});

// ── the runner, with every dependency replaced ──────────────────────────────────────────────
function harness({ imageMatch, configured = true, getSql = (n) => ({ n }), sources = { facebook: {}, reddit: {} }, networksConfig, tick, now = AT } = {}) {
  const log = silent();
  const tickFn = tick || vi.fn(async () => ({ created: 0, ran: [] }));
  const made = { workers: [], clients: [] };
  class FakeWorker {
    constructor(opts) { Object.assign(this, opts); made.workers.push(this); }
    tick(...args) { return tickFn(...args); }
  }
  class FakeClient {
    constructor(opts) { this.config = opts.config; made.clients.push(this); }
    isConfigured() { return configured; }
  }
  const databaseManager = { getSQL: vi.fn(getSql) };
  const config = {
    compliance: { imageMatch: imageMatch || { worker: { networks: [], maxImagesPerJob: 500 }, job: { pageSize: 200 }, hashVersion: "sscd-simhash-v1" } },
    crons: { timezone: "Asia/Kolkata" }, cdn: { baseUrl: "https://cdn.test" },
  };
  const run = createRunner({
    config, databaseManager, log, now: () => now, sources,
    networksConfig: networksConfig || Object.fromEntries(Object.keys(sources).map((n) => [n, { database: { sql: { enabled: true } } }])),
    clientModule: { ImageHashClient: FakeClient }, jobModule: { HashJob: class {} }, workerModule: { HashWorker: FakeWorker },
    sourcesModule: { sourceFor: () => ({}) }, blocklist: {},
  });
  return { run, log, tickFn, made, databaseManager };
}

describe("cronRunner > a tick", () => {
  it("runs one pass of the worker with the default time budget", async () => {
    const h = harness();
    await h.run({});
    expect(h.tickFn).toHaveBeenCalledTimes(1);
    expect(h.tickFn).toHaveBeenCalledWith({ budgetMs: 240000 });
  });

  it("covers every supported network that has SQL enabled and a connection", async () => {
    const h = harness();
    await h.run({});
    expect(h.made.workers[0].networks).toEqual(["facebook", "reddit"]);
    const some = harness({ getSql: (n) => (n === "reddit" ? { n } : null) });
    await some.run({});
    expect(some.made.workers[0].networks).toEqual(["reddit"]);
    const off = harness({ networksConfig: { facebook: { database: { sql: { enabled: true } } }, reddit: { database: { sql: { enabled: false } } } } });
    await off.run({});
    expect(off.made.workers[0].networks).toEqual(["facebook"]);
  });

  it("uses the configured networks, and says once that one is not supported yet", async () => {
    const h = harness({ imageMatch: { worker: { networks: ["facebook", "quora"], maxImagesPerJob: 5 }, job: {}, hashVersion: "v" } });
    await h.run({});
    await h.run({});
    expect(h.made.workers[0].networks).toEqual(["facebook"]);
    expect(h.log.warn.mock.calls.filter(([m]) => /does not support this network/.test(m))).toHaveLength(1);
  });

  it("clamps the time budget between 10 s and 50 min, and falls back to the default for junk", async () => {
    for (const [asked, ms] of [[60, 60000], [1, 10000], [0, 10000], [99999, 3000000], ["abc", 240000], [undefined, 240000], [null, 10000]]) {
      const h = harness();
      await h.run({ timeBudgetSeconds: asked });
      expect(h.tickFn, String(asked)).toHaveBeenCalledWith({ budgetMs: ms });
    }
  });

  it("builds the worker once and reuses it (so its pause and state last between ticks)", async () => {
    const h = harness();
    await h.run({});
    await h.run({});
    await h.run({});
    expect(h.made.workers).toHaveLength(1);
    expect(h.made.clients).toHaveLength(1);
    expect(h.tickFn).toHaveBeenCalledTimes(3);
  });

  it("returns what the pass did, and logs only when something happened", async () => {
    const quiet = harness();
    await quiet.run({});
    expect(quiet.log.info).not.toHaveBeenCalled();
    const busy = harness({ tick: vi.fn(async () => ({ created: 1, ran: [{ jobId: 7, outcome: "done" }], budgetUsed: false })) });
    const out = await busy.run({});
    expect(out.created).toBe(1);
    expect(busy.log.info).toHaveBeenCalledWith("image-hash pass", expect.objectContaining({ created: 1, ran: [{ job: 7, outcome: "done" }] }));
  });
});

describe("cronRunner > when it must do nothing", () => {
  it("does nothing, and touches no database, outside the window", async () => {
    const h = harness();
    expect(await h.run({ window: "09:00-17:00" })).toEqual({ skipped: "outside the window" });
    expect(h.tickFn).not.toHaveBeenCalled();
    expect(h.databaseManager.getSQL).not.toHaveBeenCalled();
    expect(await h.run({ window: "01:00-06:00" })).toMatchObject({ created: 0 }); // 02:00 IST: inside
  });

  it("an invalid window pauses hashing and says so once, instead of running at the wrong time", async () => {
    const h = harness();
    expect(await h.run({ window: "1am to 6am" })).toEqual({ skipped: "invalid window" });
    await h.run({ window: "1am to 6am" });
    expect(h.tickFn).not.toHaveBeenCalled();
    expect(h.log.warn.mock.calls.filter(([m]) => /window is not valid/.test(m))).toHaveLength(1);
  });

  it("does nothing, and says so once, when the hashing service has no address or key", async () => {
    const h = harness({ configured: false });
    expect(await h.run({})).toEqual({ skipped: "the hashing service is not configured" });
    await h.run({});
    expect(h.tickFn).not.toHaveBeenCalled();
    expect(h.log.warn.mock.calls.filter(([m]) => /no address or key/.test(m))).toHaveLength(1);
  });

  it("does nothing when there is no supported network with a connection, or no imageMatch settings", async () => {
    expect(await harness({ getSql: () => null }).run({})).toEqual({ skipped: "no supported network with a database connection" });
    expect(await harness({ sources: {} }).run({})).toEqual({ skipped: "no supported network with a database connection" });
    const noConfig = createRunner({ config: { compliance: {} }, log: silent() });
    expect(await noConfig({})).toEqual({ skipped: "no compliance.imageMatch configuration" });
  });
});

describe("cronRunner > overlap and errors", () => {
  it("skips a tick while the previous one is still working, then runs again when it is done", async () => {
    let release;
    const gate = new Promise((r) => { release = r; });
    const h = harness({ tick: vi.fn(async () => { await gate; return { created: 0, ran: [] }; }) });
    const first = h.run({});
    await new Promise((r) => setTimeout(r, 10));
    expect(await h.run({})).toEqual({ skipped: "the previous pass is still working" });
    expect(h.tickFn).toHaveBeenCalledTimes(1);
    release();
    await first;
    await h.run({});
    expect(h.tickFn).toHaveBeenCalledTimes(2);
  });

  it("never throws: a failing pass is logged and the next tick can run", async () => {
    let n = 0;
    const h = harness({ tick: vi.fn(async () => { n += 1; if (n === 1) throw new Error("db gone"); return { created: 0, ran: [] }; }) });
    expect(await h.run({})).toEqual({ error: "db gone" });
    expect(h.log.error).toHaveBeenCalledWith("image-hash pass failed", { error: "db gone" });
    expect(await h.run({})).toMatchObject({ created: 0 });
  });

  it("does not even throw when the logger does", async () => {
    const h = harness({ tick: vi.fn(async () => { throw new Error("x"); }) });
    h.log.error.mockImplementation(() => { throw new Error("log broke"); });
    await expect(h.run({})).resolves.toEqual({ error: "x" });
  });
});

describe("cronRunner > wiring into the cron manager", () => {
  it("is registered as imageHashJobs, and is not loaded until its first tick", () => {
    const out = execFileSync(process.execPath, ["-e", `
      const { REGISTRY } = require('./src/jobs/cronManager');
      const loaded = () => Object.keys(require.cache).some((k) => /imagematch[\\\\/]cronRunner\\.js$/.test(k));
      console.log(JSON.stringify({ registered: typeof REGISTRY.imageHashJobs, loadedAtImport: loaded() }));
    `], { cwd: root, encoding: "utf8", env: { PATH: process.env.PATH } });
    expect(JSON.parse(out.trim().split("\n").pop())).toEqual({ registered: "function", loadedAtImport: false });
  });
});
});

describe("imagematch job queries and checkpoint", () => {
const repo = require("../../../src/compliance/imagematch/worker").jobRepository;
const { DbCheckpoint, ClaimLostError } = require("../../../src/compliance/imagematch/worker");

function fakeSql(handler = () => []) {
  const calls = [];
  return {
    calls,
    async query(text, params) {
      calls.push({ text: text.replace(/\s+/g, " ").trim(), params });
      return handler(text, params, calls.length);
    },
  };
}
const noDestructive = (text) => expect(text).not.toMatch(/\b(DELETE|DROP|TRUNCATE|ALTER)\b/i);

describe("jobRepository > findNewAdvertisers", () => {
  it("looks, for the network's own entries and then the 'all' ones, for advertisers without a job (anti-join on the unique key)", async () => {
    const sql = fakeSql((text, params) => {
      if (params[2] !== "advertiser") return [];
      return params[1] === "reddit" ? [{ id: 5, value: "A", complaint_id: null }] : [{ id: 9, value: "B", complaint_id: "c" }];
    });
    const out = await repo.findNewAdvertisers(sql, "reddit", { limit: 50 });
    expect(out.map((r) => r.id)).toEqual([5, 9]);

    // one query per scope and entry type, each an equality on (network, entry_type): it never walks the image_hash entries
    const types = ["advertiser", "page", "ad_id", "url", "image_url"];
    expect(sql.calls).toHaveLength(10);
    expect(sql.calls.map((c) => c.params)).toEqual([...types.map((t) => ["reddit", "reddit", t]), ...types.map((t) => ["reddit", "all", t])]);
    for (const { text } of sql.calls) {
      expect(text).toMatch(/FROM copyright_blocklist b LEFT JOIN copyright_image_hash_jobs j ON j\.network = \? AND j\.blocklist_id = b\.id/);
      expect(text).toMatch(/WHERE b\.network = \? AND b\.entry_type = \? AND b\.status = 'active'/);
      expect(text).not.toMatch(/entry_type IN/);
      expect(text).toMatch(/b\.expires_at IS NULL OR b\.expires_at > UTC_TIMESTAMP\(\)/);
      expect(text).toMatch(/AND j\.id IS NULL ORDER BY b\.id LIMIT 50$/);
      expect(text).not.toMatch(/OFFSET|SELECT \*/i);
      noDestructive(text);
    }
  });

  it("does not return the same entry twice, and uses one scope for 'all'", async () => {
    const dup = fakeSql(() => [{ id: 5, value: "A", complaint_id: null }]);
    expect(await repo.findNewAdvertisers(dup, "reddit")).toHaveLength(1);
    const all = fakeSql();
    await repo.findNewAdvertisers(all, "all");
    expect(all.calls).toHaveLength(5); // one scope, five entry types
  });

  it("keeps the page size in range", async () => {
    for (const [asked, used] of [[99999, 500], [0, 100], [-3, 1], ["x", 100], [undefined, 100]]) {
      const sql = fakeSql();
      await repo.findNewAdvertisers(sql, "reddit", { limit: asked });
      expect(sql.calls[0].text).toMatch(new RegExp(`LIMIT ${used}$`));
    }
  });
});

describe("jobRepository > createJobs", () => {
  it("inserts one row per entry in one statement, and a repeat is harmless", async () => {
    const sql = fakeSql(() => ({ affectedRows: 2 }));
    const out = await repo.createJobs(sql, "reddit", [{ id: 5, value: "  Twinkling Tree ", complaint_id: "c1" }, { id: "6", value: "Blue Moon" }]);
    expect(out).toEqual({ created: 2 });
    const { text, params } = sql.calls[0];
    expect(text).toMatch(/^INSERT INTO copyright_image_hash_jobs \(network, blocklist_id, entry_type, advertiser_name, complaint_id, status, attempts, requested_gen, run_gen, covered_gen, progress_seq, created_at, updated_at, identifier_namespace\) VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?\), \(/);
    expect(text).toMatch(/ON DUPLICATE KEY UPDATE id = id$/);
    // a new job starts at generation 1, not yet run (run_gen 0) and not yet covered (covered_gen 0)
    expect(params.slice(0, 11)).toEqual(["reddit", 5, "advertiser", "Twinkling Tree", "c1", "pending", 0, 1, 0, 0, 0]);
    expect(params[13]).toBe("none"); // advertiser entries carry namespace none
    expect(params[14 + 1]).toBe(6);
    expect(params[14 + 4]).toBeNull(); // no complaint id
    expect(params.includes(undefined)).toBe(false); // the driver rejects undefined binds
    noDestructive(text);
  });

  it("keeps the ad_id namespace on the job and skips an ad_id entry without one", async () => {
    const sql = fakeSql(() => ({ affectedRows: 1 }));
    await repo.createJobs(sql, "reddit", [
      { id: 7, value: "123", entry_type: "ad_id", identifier_namespace: "internal" },
      { id: 8, value: "456", entry_type: "ad_id" },
    ]);
    expect(sql.calls).toHaveLength(1);
    expect(sql.calls[0].params).toHaveLength(14);
    expect(sql.calls[0].params[13]).toBe("internal");
  });

  it("skips entries without a usable id or name, and makes no query for nothing", async () => {
    const sql = fakeSql();
    expect(await repo.createJobs(sql, "reddit", [])).toEqual({ created: 0 });
    expect(await repo.createJobs(sql, "reddit", [
      { id: null, value: "A" }, { id: undefined, value: "A" }, { id: "", value: "A" }, { id: 0, value: "A" }, { id: -4, value: "A" },
      { id: "abc", value: "A" }, { id: "1.5", value: "A" }, { id: 1.5, value: "A" }, { id: true, value: "A" }, { id: [], value: "A" },
      { id: 1, value: "   " }, { id: 2 }, { id: 3, value: 5 && null }, null, undefined,
    ])).toEqual({ created: 0 });
    expect(await repo.createJobs(sql, "reddit", undefined)).toEqual({ created: 0 });
    expect(sql.calls).toHaveLength(0);
  });

  it("cuts a name to the column size", async () => {
    const sql = fakeSql(() => ({ affectedRows: 1 }));
    await repo.createJobs(sql, "reddit", [{ id: 1, value: "x".repeat(400) }]);
    expect(sql.calls[0].params[3]).toHaveLength(255);
  });
});

describe("jobRepository > claimNext", () => {
  it("claims the oldest pending job, or running one with a stale heartbeat, in ONE atomic update", async () => {
    const stale = new Date("2026-11-02T10:00:00Z");
    const sql = fakeSql((text) => (/^UPDATE/.test(text) ? { affectedRows: 1 } : [{ id: 3, network: "reddit", advertiser_name: "A", attempts: 1, state: null }]));
    const job = await repo.claimNext(sql, "reddit", "host:1", stale);
    expect(job).toMatchObject({ id: 3, advertiser_name: "A" });

    const { text, params } = sql.calls[0];
    expect(text).toMatch(/^UPDATE copyright_image_hash_jobs SET status = 'running', run_gen = requested_gen, claimed_by = \?/); // the run takes the newest generation asked for
    expect(text).toMatch(/attempts = attempts \+ 1/);
    expect(text).toMatch(/WHERE id = \(SELECT id FROM \( SELECT id FROM copyright_image_hash_jobs WHERE network = \? AND \(status = 'pending' OR \(status = 'running' AND heartbeat_at < \?\)\) ORDER BY updated_at, id LIMIT 1\) AS pick\)/);
    // the job that has waited longest goes first: a big advertiser's job, put back after its time slice, does not starve new ones
    expect(text).not.toMatch(/ORDER BY id LIMIT 1/);
    expect(text).toMatch(/AND \(status = 'pending' OR \(status = 'running' AND heartbeat_at < \?\)\)$/); // re-checked on the row: the loser of a race gets 0 rows
    expect(params[0]).toBe("host:1");
    expect(params[4]).toBe("reddit");
    expect(params[5]).toBe("2026-11-02 10:00:00");
    expect(params[6]).toBe("2026-11-02 10:00:00");
    // then reads back its own job
    expect(sql.calls[1].text).toMatch(/WHERE network = \? AND claimed_by = \? AND status = 'running'/);
    expect(sql.calls[1].params).toEqual(["reddit", "host:1"]);
    noDestructive(text);
  });

  it("returns null, and reads nothing more, when there is nothing to claim or another worker won", async () => {
    const sql = fakeSql(() => ({ affectedRows: 0 }));
    expect(await repo.claimNext(sql, "reddit", "w", new Date())).toBeNull();
    expect(sql.calls).toHaveLength(1);
    expect(await repo.claimNext(fakeSql(() => ({})), "reddit", "w", new Date())).toBeNull();
  });

  it("makes a worker id that is not plain ASCII safe for the ASCII column", async () => {
    const sql = fakeSql((text) => (/^UPDATE/.test(text) ? { affectedRows: 1 } : []));
    await repo.claimNext(sql, "reddit", `ホスト:${"x".repeat(200)}`, new Date());
    expect(sql.calls[0].params[0]).toMatch(/^\?+:x+$/);
    expect(sql.calls[0].params[0].length).toBe(128);
  });
});

describe("jobRepository > writes are guarded by the claim", () => {
  it("saveProgress only updates a job this worker holds, and says whether it did", async () => {
    const sql = fakeSql(() => ({ affectedRows: 1 }));
    expect(await repo.saveProgress(sql, 7, "me", '{"a":1}')).toBe(true);
    const { text, params } = sql.calls[0];
    expect(text).toMatch(/SET state = \?, heartbeat_at = \?, progress_seq = progress_seq \+ 1, updated_at = \? WHERE id = \? AND claimed_by = \? AND status = 'running'$/);
    expect(params[0]).toBe('{"a":1}');
    expect(params.slice(3)).toEqual([7, "me"]);
    expect(await repo.saveProgress(fakeSql(() => ({ affectedRows: 0 })), 7, "other", "{}")).toBe(false);
    expect(await repo.saveProgress(fakeSql(() => undefined), 7, "me", "{}")).toBe(false);
  });

  it("finish sets a final status, with the error cut to the column size, only for the holder", async () => {
    const sql = fakeSql(() => ({ affectedRows: 1 }));
    expect(await repo.finish(sql, 7, "me", "done")).toBe(true);
    // [covers, error, finished_at, status, updated_at, id, worker]
    expect(sql.calls[0].text).toMatch(/SET covered_gen = IF\(requested_gen > run_gen OR \? = 0, covered_gen, run_gen\).* status = IF\(requested_gen > run_gen, 'pending', \?\).* WHERE id = \? AND claimed_by = \? AND status = 'running'$/);
    expect(sql.calls[0].params[0]).toBe(1); // done covers the generation the run worked for
    expect(sql.calls[0].params[3]).toBe("done");
    expect(sql.calls[0].params[1]).toBeNull();
    await repo.finish(sql, 7, "me", "failed", { error: "e".repeat(900) });
    expect(sql.calls[1].params[1]).toHaveLength(512);
    expect(sql.calls[1].params[0]).toBe(0); // only done / no_owner cover; failed, limit_reached and unresolved never do
    for (const status of ["limit_reached", "unresolved"]) {
      await repo.finish(sql, 7, "me", status);
      expect(sql.calls[sql.calls.length - 1].params[0]).toBe(0);
    }
    await repo.finish(sql, 7, "me", "no_owner");
    expect(sql.calls[sql.calls.length - 1].params[0]).toBe(1);
    expect(await repo.finish(fakeSql(() => ({ affectedRows: 0 })), 7, "other", "done")).toBe(false);
  });

  it("release puts the job back to pending, with its saved place, and can give the attempt back", async () => {
    const sql = fakeSql(() => ({ affectedRows: 1 }));
    expect(await repo.release(sql, 7, "me", { error: "boom", refundAttempt: true })).toBe(true);
    const { text, params } = sql.calls[0];
    expect(text).toMatch(/SET status = 'pending', claimed_by = NULL, claimed_at = NULL, heartbeat_at = NULL, state = IF\(requested_gen > run_gen, NULL, state\), attempts = IF\(requested_gen > run_gen, 0, IF\(\?, GREATEST\(attempts, 1\) - 1, attempts\)\)/);
    expect(text).not.toMatch(/state = \?/); // the saved place is kept, unless a newer generation was asked for (then the run starts clean)
    expect(text).toMatch(/WHERE id = \? AND claimed_by = \? AND status = 'running'$/);
    expect(params[0]).toBe(1);
    await repo.release(sql, 7, "me");
    expect(sql.calls[1].params[0]).toBe(0);
    expect(sql.calls[1].params.includes(undefined)).toBe(false);
  });

  it("no statement of the module deletes or alters anything", async () => {
    const sql = fakeSql((text) => (/^\s*SELECT/i.test(text) ? [] : { affectedRows: 1 }));
    await repo.createJobs(sql, "n", [{ id: 1, value: "A" }]);
    await repo.claimNext(sql, "n", "w", new Date());
    await repo.loadState(sql, 1);
    await repo.saveProgress(sql, 1, "w", "{}");
    await repo.finish(sql, 1, "w", "done");
    await repo.release(sql, 1, "w");
    await repo.findNewAdvertisers(sql, "n");
    for (const { text } of sql.calls) noDestructive(text);
  });
});

describe("jobCheckpoint > DbCheckpoint", () => {
  const fakeRepo = (over = {}) => ({
    loadState: async () => over.state ?? null,
    saveProgress: async (...args) => { (over.saved ||= []).push(args); return over.held !== false; },
  });

  it("loads the saved state as an object, and null for nothing, damage or a non-object", async () => {
    const cp = (state) => new DbCheckpoint({ sql: {}, workerId: "w", repo: fakeRepo({ state }) });
    expect(await cp('{"owners":{"1":{"lastAdId":10}}}').load("7")).toEqual({ owners: { 1: { lastAdId: 10 } } });
    for (const bad of [null, "", "{ not json", "5", "null"]) expect(await cp(bad).load("7")).toBeNull();
  });

  it("saves the state as JSON for the job number, as the worker that holds the job", async () => {
    const over = {};
    const cp = new DbCheckpoint({ sql: { s: 1 }, workerId: "host:9", repo: fakeRepo(over) });
    await cp.save("7", { stats: { hashed: 2 } });
    expect(over.saved[0]).toEqual([{ s: 1 }, 7, "host:9", '{"stats":{"hashed":2}}']);
  });

  it("throws ClaimLostError when the worker no longer holds the job, so the run stops", async () => {
    const cp = new DbCheckpoint({ sql: {}, workerId: "w", repo: fakeRepo({ held: false }) });
    await expect(cp.save("7", {})).rejects.toBeInstanceOf(ClaimLostError);
    await expect(cp.save("7", {})).rejects.toThrow(/no longer holds hash job 7/);
  });
});
});

// ── Stage 4: the check of new ads (NewAdSweeper) ───────────────────────────────────────────────────
const { NewAdSweeper, jobRepository: sweepRepo } = require("../../../src/compliance/imagematch/worker");
const sqlSpy = (handler = () => []) => {
  const calls = [];
  return { calls, async query(text, params) { calls.push({ text: text.replace(/\s+/g, " ").trim(), params }); return handler(text, params); } };
};
const neverDestructive = (text) => expect(text).not.toMatch(/\b(DELETE|DROP|TRUNCATE|ALTER)\b/i);
const sweepSources = require("../../../src/compliance/imagematch/sources");
const { decide, parseHash } = require("../../../src/compliance/imagematch/matcher");

describe("sweep > the queries on the ad tables", () => {
  const FBS = sweepSources.sourceFor("facebook");

  it("newAdsPage is a primary-key range with a LIMIT: no OFFSET, no sort on another column", async () => {
    const sql = sqlSpy(() => [{ id: 11, platform_id: "a11" }, { id: 12, platform_id: "a12" }]);
    const ads = await sweepSources.newAdsPage(sql, FBS, 10, 20, 100);
    expect(ads).toEqual([{ id: 11, platformId: "a11" }, { id: 12, platformId: "a12" }]);
    expect(sql.calls[0].text).toMatch(/FROM `facebook_ad` WHERE `id` > \? AND `id` <= \? ORDER BY `id` LIMIT 100$/);
    expect(sql.calls[0].params).toEqual([10, 20]);
    expect(sql.calls[0].text).not.toMatch(/OFFSET|LIKE/i);
  });

  it("maxAdId reads the end of the primary key, and is 0 for an empty table", async () => {
    expect(await sweepSources.maxAdId(sqlSpy(() => [{ id: 99 }]), FBS)).toBe(99);
    expect(await sweepSources.maxAdId(sqlSpy(() => [{ id: null }]), FBS)).toBe(0);
    const sql = sqlSpy(() => [{ id: 1 }]);
    await sweepSources.maxAdId(sql, FBS);
    expect(sql.calls[0].text).toBe("SELECT MAX(`id`) AS id FROM `facebook_ad`");
  });
});

describe("sweep > the SQL of the cursor and the review queue", () => {
  it("only reads and inserts / updates the reserved row; no delete; the hashing worker's claim never sees a 'sweep' row", async () => {
    const sql = sqlSpy(() => ({ affectedRows: 1 }));
    await sweepRepo.sweepEnsure(sql, "facebook", "{}");
    await sweepRepo.sweepClaim(sqlSpy((t) => (/^UPDATE/.test(t) ? { affectedRows: 1 } : [{ state: "{}" }])), "facebook", "w", new Date());
    await sweepRepo.sweepSave(sql, "facebook", "w", "{}");
    await sweepRepo.sweepRelease(sql, "facebook", "w");
    await sweepRepo.queueForReview(sql, { network: "facebook", sha256: "a".repeat(64), phash: "b".repeat(64), phashAlgo: "sscd-simhash-v1", blocklistId: 4 });
    for (const call of sql.calls) {
      neverDestructive(call.text);
      expect(call.text).toMatch(/copyright_image_hash_jobs|copyright_review_queue/);
    }
    expect(sql.calls[0].text).toMatch(/'sweep'/);
    // looked up first and inserted only when missing: no auto-increment id is used up on every pass
    expect(sql.calls[0].text).toMatch(/^INSERT IGNORE INTO .* SELECT .* FROM DUAL WHERE NOT EXISTS \(SELECT 1 FROM copyright_image_hash_jobs WHERE network = \? AND blocklist_id = 0\)$/);
    expect(sql.calls[0].params).toHaveLength(5);
    expect(sql.calls[3].text).toMatch(/INSERT INTO copyright_review_queue .*'pending'.* ON DUPLICATE KEY UPDATE id = id/);
    const claimSql = sqlSpy(() => ({ affectedRows: 0 }));
    await sweepRepo.claimNext(claimSql, "facebook", "w", new Date());
    expect(claimSql.calls[0].text).not.toMatch(/'sweep'/);
    expect(claimSql.calls[0].text).toMatch(/status = 'pending' OR \(status = 'running'/);
  });

  it("the cursor save is guarded by the holder", async () => {
    expect(await sweepRepo.sweepSave(sqlSpy(() => ({ affectedRows: 0 })), "facebook", "other", "{}")).toBe(false);
    const sql = sqlSpy(() => ({ affectedRows: 1 }));
    await sweepRepo.sweepSave(sql, "facebook", "me", "{}");
    expect(sql.calls[0].text).toMatch(/WHERE network = \? AND blocklist_id = 0 AND claimed_by = \?/);
  });
});

// A network with ads, a cursor row and a review queue, all in memory, behind the same functions the sweeper calls.
function sweepWorld({ maxId = 10, ads = {}, images = {}, carousel = {}, hashes = {}, banned = [], available = true, claimable = true } = {}) {
  const w = { maxId, cursor: null, held: false, saves: [], queue: [], attempts: [], hashCalls: [], hashes, ads, images, carousel, banned, available, claimable };
  const sources = {
    maxAdId: async () => w.maxId,
    newAdsPage: async (_s, _src, after, upTo, limit) =>
      Object.keys(w.ads).map(Number).filter((id) => id > after && id <= upTo).sort((a, b) => a - b).slice(0, limit).map((id) => ({ id, platformId: w.ads[id] })),
    variantImages: async (_s, _src, ids) => ids.filter((id) => w.images[id] !== undefined).map((id) => ({ ad_id: id, image_url: w.images[id], image_url_original: null })),
    carouselImages: async (_s, _src, ids) => ids.flatMap((id) => (w.carousel[id] || []).map((p) => ({ ad_id: id, image_url: p, image_url_original: null }))),
    toFetchableUrl: sweepSources.toFetchableUrl,
  };
  const repo = {
    sweepEnsure: async (_s, _n, json) => { if (!w.cursor) w.cursor = json; },
    sweepClaim: async () => (w.claimable ? { state: w.cursor } : null),
    sweepSave: async (_s, _n, _w, json, err) => { w.cursor = json; w.saves.push({ json, err }); return true; },
    sweepRelease: async () => { w.held = false; return true; },
    queueForReview: async (_s, row) => { w.queue.push(row); return true; },
  };
  const client = {
    hashUrl: async (url) => { w.hashCalls.push(url); const r = w.hashes[url]; return r === undefined ? { ok: false, outcome: "skip", reason: "x" } : r; },
  };
  const blocklist = {
    getImageHashes: () => ({ available: w.available, status: w.available ? "ready" : "unavailable", hashes: w.banned }),
    recordAttempt: (a) => { w.attempts.push(a); return true; },
  };
  const sweeper = new NewAdSweeper({ client, blocklist, matcher: { decide }, sourceFor: () => ({}), sources, repo, options: { cdnBase: "https://cdn.test", hashVersion: "sscd-simhash-v1", perceptual: { enabled: false } }, log: silent });
  w.state = () => JSON.parse(w.cursor);
  return { w, sweeper };
}
const hex = (n) => n.toString(16).padStart(64, "0");
const okHash = (sha, word = 0) => ({ ok: true, outcome: "ok", sha256: sha, sscdHash: hex(word), words: parseHash(hex(word)) });
const bannedImage = (id, sha, word = 0) => ({ id, sha256: sha, phash: parseHash(hex(word)), algo: "sscd-simhash-v1" });
const SHA_BAD = "a".repeat(64);
const SHA_OK = "b".repeat(64);
const U = (p) => `https://cdn.test/${p}`;

describe("NewAdSweeper", () => {
  it("starts at the newest ad: the first pass checks nothing and the old ads are never scanned", async () => {
    const { w, sweeper } = sweepWorld({ maxId: 10, ads: { 5: "old" }, images: { 5: "x.jpg" }, banned: [bannedImage(1, SHA_BAD)] });
    const out = await sweeper.sweep("facebook", {}, { workerId: "w" });
    expect(out).toMatchObject({ checked: 0, matched: 0, lag: 0 });
    expect(w.hashCalls).toEqual([]);
    expect(w.state()).toEqual({ lastAdId: 10, horizon: 10 });
  });

  it("looks at an ad one pass after it first appears, then queues an exact copy of a banned image and logs the attempt", async () => {
    const { w, sweeper } = sweepWorld({
      maxId: 10, banned: [bannedImage(7, SHA_BAD)],
      ads: { 11: "p11", 12: "p12" }, images: { 11: "m/a.jpg", 12: "m/b.jpg" },
      hashes: { [U("m/a.jpg")]: okHash(SHA_BAD), [U("m/b.jpg")]: okHash(SHA_OK, 5) },
    });
    await sweeper.sweep("facebook", {}, { workerId: "w" }); // pass 1: the cursor is made at 10
    w.maxId = 12;
    const second = await sweeper.sweep("facebook", {}, { workerId: "w" }); // pass 2 sees the new ids but waits one pass
    expect(second.checked).toBe(0);
    expect(w.state()).toEqual({ lastAdId: 10, horizon: 12 });
    const third = await sweeper.sweep("facebook", {}, { workerId: "w" });
    expect(third).toMatchObject({ checked: 2, matched: 1, lag: 0 });
    expect(w.state()).toEqual({ lastAdId: 12, horizon: 12 });
    expect(w.queue).toHaveLength(1);
    expect(w.queue[0]).toMatchObject({ network: "facebook", platformAdId: "p11", internalAdId: 11, imageUrl: U("m/a.jpg"), sha256: SHA_BAD, blocklistId: 7, phashAlgo: "sscd-simhash-v1" });
    expect(w.queue[0].note).toMatch(/same file/);
    expect(w.attempts).toEqual([{ network: "facebook", platformAdId: "p11", imageUrl: U("m/a.jpg"), blocklistId: 7, matchType: "sha256", distance: null, source: "imagematch-sweep" }]);
    expect(w.held).toBe(false);
  });

  it("does not match a near copy while near-copy matching is off, and holds it for review when it is on", async () => {
    const world = () => sweepWorld({ maxId: 5, banned: [bannedImage(3, SHA_BAD, 0)], ads: { 6: "p6" }, images: { 6: "n.jpg" }, hashes: { [U("n.jpg")]: okHash(SHA_OK, 0b111) } });
    const off = world();
    await off.sweeper.sweep("facebook", {}, { workerId: "w" });
    off.w.maxId = 6;
    await off.sweeper.sweep("facebook", {}, { workerId: "w" });
    await off.sweeper.sweep("facebook", {}, { workerId: "w" });
    expect(off.w.queue).toEqual([]);

    const on = world();
    on.sweeper.options.perceptual = { enabled: true, rejectDistance: 0, reviewDistance: 5 };
    await on.sweeper.sweep("facebook", {}, { workerId: "w" });
    on.w.maxId = 6;
    await on.sweeper.sweep("facebook", {}, { workerId: "w" });
    await on.sweeper.sweep("facebook", {}, { workerId: "w" });
    expect(on.w.queue).toHaveLength(1);
    expect(on.w.queue[0]).toMatchObject({ blocklistId: 3, distance: 3 });
    expect(on.w.attempts[0]).toMatchObject({ matchType: "phash", distance: 3 });
  });

  it("moves the cursor without calling the service when nothing is banned", async () => {
    const { w, sweeper } = sweepWorld({ maxId: 5, banned: [], ads: { 6: "p6" }, images: { 6: "n.jpg" } });
    await sweeper.sweep("facebook", {}, { workerId: "w" });
    w.maxId = 6;
    await sweeper.sweep("facebook", {}, { workerId: "w" });
    await sweeper.sweep("facebook", {}, { workerId: "w" });
    expect(w.hashCalls).toEqual([]);
    expect(w.state().lastAdId).toBe(6);
  });

  it("does not move when the banned images cannot be trusted", async () => {
    const { w, sweeper } = sweepWorld({ maxId: 5, available: false, banned: [], ads: { 6: "p6" }, images: { 6: "n.jpg" } });
    await sweeper.sweep("facebook", {}, { workerId: "w" });
    w.maxId = 6;
    const out = await sweeper.sweep("facebook", {}, { workerId: "w" });
    expect(out.problem).toMatch(/not loaded/);
    expect(w.state()).toEqual({ lastAdId: 5, horizon: 5 });
    expect(w.hashCalls).toEqual([]);
    expect(w.held).toBe(false);
  });

  it("stays on the page when the service fails for every image, and moves on when only some fail", async () => {
    const down = { ok: false, outcome: "unavailable", reason: "503" };
    const { w, sweeper } = sweepWorld({
      maxId: 10, banned: [bannedImage(1, SHA_BAD)], ads: { 11: "p11", 12: "p12" }, images: { 11: "a.jpg", 12: "b.jpg" },
      hashes: { [U("a.jpg")]: down, [U("b.jpg")]: down },
    });
    await sweeper.sweep("facebook", {}, { workerId: "w" });
    w.maxId = 12;
    await sweeper.sweep("facebook", {}, { workerId: "w" });
    const failed = await sweeper.sweep("facebook", {}, { workerId: "w" });
    expect(failed.problem).toMatch(/unavailable/);
    expect(w.state().lastAdId).toBe(10);
    expect(w.saves.at(-1).err).toMatch(/unavailable/);

    w.hashes[U("b.jpg")] = okHash(SHA_BAD);
    const partly = await sweeper.sweep("facebook", {}, { workerId: "w" });
    expect(partly).toMatchObject({ checked: 1, matched: 1, skipped: 1 });
    expect(w.state().lastAdId).toBe(12);
  });

  it("asks the worker to pause when the key is refused, and does not move", async () => {
    const { w, sweeper } = sweepWorld({ maxId: 10, banned: [bannedImage(1, SHA_BAD)], ads: { 11: "p" }, images: { 11: "a.jpg" }, hashes: { [U("a.jpg")]: { ok: false, outcome: "unauthorized", reason: "no" } } });
    await sweeper.sweep("facebook", {}, { workerId: "w" });
    w.maxId = 11;
    await sweeper.sweep("facebook", {}, { workerId: "w" });
    const out = await sweeper.sweep("facebook", {}, { workerId: "w" });
    expect(out.pause).toMatch(/unauthorized/);
    expect(w.state().lastAdId).toBe(10);
  });

  it("skips ads with no stored image or only the default image, and checks one URL once", async () => {
    const { w, sweeper } = sweepWorld({
      maxId: 10, banned: [bannedImage(1, SHA_BAD)], ads: { 11: "p11", 12: "p12", 13: "p13", 14: "p14" },
      images: { 11: "", 12: "x/DefaultImage.png", 13: "same.jpg", 14: "same.jpg" }, hashes: { [U("same.jpg")]: okHash(SHA_OK, 1) },
    });
    await sweeper.sweep("facebook", {}, { workerId: "w" });
    w.maxId = 14;
    await sweeper.sweep("facebook", {}, { workerId: "w" });
    const out = await sweeper.sweep("facebook", {}, { workerId: "w" });
    expect(w.hashCalls).toEqual([U("same.jpg")]);
    expect(out).toMatchObject({ checked: 1, skipped: 3 });
  });

  it("does nothing when another worker holds the cursor, and never throws when the database fails", async () => {
    const held = sweepWorld({ claimable: false, banned: [bannedImage(1, SHA_BAD)] });
    expect((await held.sweeper.sweep("facebook", {}, { workerId: "w" })).problem).toMatch(/another worker/);
    const broken = sweepWorld();
    broken.sweeper.sources.maxAdId = async () => { throw new Error("db down"); };
    expect((await broken.sweeper.sweep("facebook", {}, { workerId: "w" })).problem).toBe("db down");
  });

  it("stops at the time budget and continues from the saved place", async () => {
    const { w, sweeper } = sweepWorld({
      maxId: 10, banned: [bannedImage(1, SHA_BAD)], ads: { 11: "p11", 12: "p12", 13: "p13" }, images: { 11: "a.jpg", 12: "b.jpg", 13: "c.jpg" },
      hashes: { [U("a.jpg")]: okHash(SHA_OK, 1), [U("b.jpg")]: okHash(SHA_OK, 2), [U("c.jpg")]: okHash(SHA_OK, 3) },
    });
    sweeper.options.pageSize = 1;
    await sweeper.sweep("facebook", {}, { workerId: "w" });
    w.maxId = 13;
    await sweeper.sweep("facebook", {}, { workerId: "w" });
    let clock = 0;
    sweeper.now = () => new Date(clock++); // each look at the clock costs 1 ms
    const part = await sweeper.sweep("facebook", {}, { workerId: "w", deadline: 3 });
    expect(part.lag).toBeGreaterThan(0);
    expect(w.state().lastAdId).toBeLessThan(13);
    sweeper.now = () => new Date();
    const rest = await sweeper.sweep("facebook", {}, { workerId: "w" });
    expect(rest.lag).toBe(0);
    expect(w.state().lastAdId).toBe(13);
  });
});

describe("HashWorker with the sweeper", () => {
  const baseWorker = (sweeper, extra = {}) => new HashWorker({
    networks: ["facebook"], getSql: () => ({}), makeJob: () => ({}), sweeper, log: silent,
    repo: { findNewAdvertisers: async () => [], createJobs: async () => ({}), claimNext: async () => null },
    ...extra,
  });

  it("sweeps a network before its hashing jobs and reports what it did", async () => {
    const calls = [];
    const sweeper = { budgetShare: 0.4, sweep: vi.fn(async (n) => { calls.push("sweep"); return { network: n, checked: 3, matched: 1, skipped: 0, lag: 0 }; }) };
    const worker = baseWorker(sweeper, { repo: { findNewAdvertisers: async () => { calls.push("discover"); return []; }, createJobs: async () => ({}), claimNext: async () => null } });
    const out = await worker.tick({ budgetMs: 10000 });
    expect(calls).toEqual(["sweep", "discover"]);
    expect(out.swept).toEqual([{ network: "facebook", checked: 3, matched: 1, skipped: 0, lag: 0 }]);
    const [, , options] = sweeper.sweep.mock.calls[0];
    expect(options.deadline).toBeGreaterThan(Date.now());
    expect(options.deadline).toBeLessThanOrEqual(Date.now() + 4000);
  });

  it("pauses the whole worker when the sweeper says the service or key is unusable", async () => {
    const sweeper = { budgetShare: 0.4, sweep: async (n) => ({ network: n, checked: 0, matched: 0, skipped: 0, lag: 0, pause: "the key is refused" }) };
    const worker = baseWorker(sweeper);
    const out = await worker.tick();
    expect(out.paused).toBe(true);
    expect((await worker.tick()).paused).toBe(true);
  });

  it("works as before without a sweeper", async () => {
    const out = await baseWorker(null).tick();
    expect(out).toEqual({ created: 0, ran: [] });
  });
});

describe("HashWorker > several jobs in one pass", () => {
  const job = (id) => ({ id, network: "facebook", advertiser_name: "A" + id, attempts: 1 });
  function pass({ jobs, budgetMs, runStatus = () => STATUS.DONE, config = {} }) {
    const queue = [...jobs];
    const repo = {
      findNewAdvertisers: async () => [], createJobs: async () => ({}),
      claimNext: async () => queue.shift() || null,
      loadState: async () => null, saveProgress: async () => true, finish: vi.fn(async () => true), release: vi.fn(async () => true),
    };
    const worker = new HashWorker({
      networks: ["facebook"], getSql: () => ({}), log: silent, repo, config,
      makeJob: () => ({ requestStop() {}, run: async () => ({ status: runStatus(), stats: {} }) }),
    });
    return { worker, repo, tick: () => worker.tick({ budgetMs }) };
  }

  it("with a time budget, small jobs finish one after another in the same pass", async () => {
    const { tick, repo } = pass({ jobs: [job(1), job(2), job(3)], budgetMs: 60000 });
    const out = await tick();
    expect(out.ran.map((r) => r.jobId)).toEqual([1, 2, 3]);
    expect(repo.finish).toHaveBeenCalledTimes(3);
  });

  it("without a budget it still runs one job per pass, as before", async () => {
    const { tick } = pass({ jobs: [job(1), job(2)], budgetMs: undefined });
    expect((await tick()).ran.map((r) => r.jobId)).toEqual([1]);
  });

  it("stops at maxJobsPerTick", async () => {
    const { tick } = pass({ jobs: [job(1), job(2), job(3), job(4)], budgetMs: 60000, config: { maxJobsPerTick: 2 } });
    expect((await tick()).ran.map((r) => r.jobId)).toEqual([1, 2]);
  });

  it("a job cut off by the budget ends the pass (it goes back to the queue), and a bad key pauses and ends it", async () => {
    const stopped = pass({ jobs: [job(1), job(2)], budgetMs: 60000, runStatus: () => STATUS.STOPPED });
    const a = await stopped.tick();
    expect(a.ran.map((r) => r.jobId)).toEqual([1]);
    expect(stopped.repo.release).toHaveBeenCalledTimes(1);

    const noKey = pass({ jobs: [job(1), job(2)], budgetMs: 60000, runStatus: () => STATUS.UNAUTHORIZED });
    const b = await noKey.tick();
    expect(b.ran.map((r) => r.jobId)).toEqual([1]);
    expect((await noKey.tick()).paused).toBe(true);
  });
});

describe("submitAdvertiser (the landing-page entry point)", () => {
  const { createIntake, cleanName } = require("../../../src/compliance/imagematch/worker");
  const COMPLAINT = "11111111-1111-4111-8111-111111111111";

  function build({ owners = { facebook: [{ id: 9, name: "Twinkling Tree", ads_count: "120000" }] }, add, networks = ["facebook", "reddit"], jobFails = false } = {}) {
    const calls = { add: [], find: [], jobs: [] };
    const sources = {
      SOURCES: { facebook: {} },
      sourceFor: (n) => ({ n }),
      nameCandidates: (name) => [name.toLowerCase(), name.toLowerCase().replace(/ /g, "")],
      findOwners: vi.fn(async (_sql, source, names) => { calls.find.push({ network: source.n, names }); return owners[source.n] || []; }),
    };
    const blocklist = {
      add: vi.fn(async (entries) => {
        calls.add.push(entries);
        if (add) return add(entries);
        return { rejected: [], results: networks.map((n, i) => ({ network: n, ok: true, entries: [{ blocklistId: 40 + i }] })) };
      }),
    };
    const jobRepository = { createJobs: vi.fn(async (_sql, network, list) => { if (jobFails) throw new Error("db"); calls.jobs.push({ network, list }); return { created: 1 }; }) };
    const databaseManager = { getSQL: (n) => ({ n }) };
    return { submit: createIntake({ blocklist, sourcesModule: sources, databaseManager, jobRepository }), calls, blocklist, sources, jobRepository };
  }

  it("searches, blocks and queues the hashing, and answers with what it found", async () => {
    const { submit, calls } = build();
    const out = await submit({ name: "  Twinkling   Tree ", addedBy: "landing-form", complaintId: COMPLAINT });
    expect(out).toMatchObject({
      ok: true, complaintId: COMPLAINT, name: "Twinkling Tree", totalAds: 120000,
      blocked: [{ network: "facebook", blocklistId: 40 }, { network: "reddit", blocklistId: 41 }],
      failed: [], rejected: [],
      matches: [{ network: "facebook", ownerId: 9, name: "Twinkling Tree", ads: 120000 }],
      hashing: [{ network: "facebook", queued: true }], // reddit has no image-hashing support yet
    });
    expect(calls.add[0]).toEqual([{ entryType: "advertiser", value: "Twinkling Tree", network: "all", addedBy: "landing-form", reason: 'requested for "Twinkling Tree"', complaintId: COMPLAINT, source: "intake" }]);
    expect(calls.find[0]).toEqual({ network: "facebook", names: ["twinkling tree", "twinklingtree"] });
    expect(calls.jobs).toEqual([{ network: "facebook", list: [{ id: 40, value: "Twinkling Tree", complaint_id: COMPLAINT, entry_type: "advertiser" }] }]);
  });

  it("makes a complaint id when none is given, and keeps the one that is", async () => {
    const { submit } = build();
    const a = await submit({ name: "Brand", addedBy: "x" });
    expect(a.complaintId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect((await submit({ name: "Brand", addedBy: "x", complaintId: COMPLAINT.toUpperCase() })).complaintId).toBe(COMPLAINT);
  });

  it("refuses unusable input without touching the blocklist", async () => {
    const { submit, blocklist } = build();
    for (const [input, error] of [
      [{ name: "", addedBy: "x" }, "invalid_name"],
      [{ name: "a", addedBy: "x" }, "invalid_name"],
      [{ name: "x".repeat(256), addedBy: "x" }, "invalid_name"],
      [{ name: 42, addedBy: "x" }, "invalid_name"],
      [{ name: "\u0000\n \t", addedBy: "x" }, "invalid_name"],
      [{ name: "Brand" }, "added_by_required"],
      [{ name: "Brand", addedBy: "  " }, "added_by_required"],
      [{ name: "Brand", addedBy: "x", complaintId: "not-a-uuid" }, "invalid_complaint_id"],
      [{ name: "Brand", addedBy: "x", network: "bad network!" }, "invalid_network"],
      [undefined, "invalid_name"],
    ]) {
      expect(await submit(input)).toMatchObject({ ok: false, error });
    }
    expect(blocklist.add).not.toHaveBeenCalled();
  });

  it("cleans the name: control characters and repeated spaces", () => {
    expect(cleanName("  A\u0000B \n\t C ")).toBe("A B C");
    expect(cleanName("ab")).toBe("ab");
    expect(cleanName("a")).toBeNull();
  });

  it("a name that is not in our data is still blocked (new ads of that name are refused), with no matches", async () => {
    const { submit } = build({ owners: {} });
    expect(await submit({ name: "Nobody Yet", addedBy: "x" })).toMatchObject({ ok: true, matches: [], totalAds: 0, blocked: [{ network: "facebook" }, { network: "reddit" }] });
  });

  it("a network where the block failed is reported, and no job is made for it; all networks failing is ok: false", async () => {
    const partly = build({ add: async () => ({ rejected: [], results: [{ network: "facebook", ok: false, error: "no SQL connection", entries: [] }, { network: "reddit", ok: true, entries: [{ blocklistId: 7 }] }] }) });
    const out = await partly.submit({ name: "Brand", addedBy: "x" });
    expect(out).toMatchObject({ ok: true, failed: [{ network: "facebook", error: "no SQL connection" }], hashing: [] });
    const none = build({ add: async () => ({ rejected: [], results: [{ network: "facebook", ok: false, error: "down", entries: [] }] }) });
    expect(await none.submit({ name: "Brand", addedBy: "x" })).toMatchObject({ ok: false, blocked: [] });
  });

  it("the entry's own rejection is passed on", async () => {
    const { submit } = build({ add: async () => ({ rejected: [{ reason: "value is empty or unusable" }], results: [] }) });
    expect(await submit({ name: "!!", addedBy: "x" })).toMatchObject({ ok: false, rejected: ["value is empty or unusable"] });
  });

  it("a failed search or a failed job insert never stops the block, and nothing throws", async () => {
    const a = build();
    a.sources.findOwners.mockRejectedValueOnce(new Error("slow query killed"));
    expect(await a.submit({ name: "Brand", addedBy: "x" })).toMatchObject({ ok: true, matches: [], totalAds: 0 });
    const b = build({ jobFails: true });
    expect(await b.submit({ name: "Brand", addedBy: "x" })).toMatchObject({ ok: true, hashing: [{ network: "facebook", queued: false }] });
    const c = build({ add: async () => { throw new Error("blocklist is not initialised"); } });
    expect(await c.submit({ name: "Brand", addedBy: "x" })).toMatchObject({ ok: false, error: "failed", message: "blocklist is not initialised" });
  });

  it("one network only: searches and blocks that network", async () => {
    const { submit, calls } = build({ networks: ["facebook"] });
    await submit({ name: "Brand", addedBy: "x", network: "Facebook" });
    expect(calls.add[0][0].network).toBe("facebook");
    expect(calls.find.map((c) => c.network)).toEqual(["facebook"]);
    const other = build({ networks: ["reddit"] });
    const out = await other.submit({ name: "Brand", addedBy: "x", network: "reddit" });
    expect(other.calls.find).toEqual([]); // reddit has no search support yet
    expect(out).toMatchObject({ ok: true, matches: [], hashing: [] });
  });

  it("the search is an indexed read of the owners table: no count or scan of the ad table", async () => {
    const real = require("../../../src/compliance/imagematch/sources");
    const text = [];
    const sql = { query: async (t) => { text.push(t.replace(/\s+/g, " ")); return []; } };
    await real.findOwners(sql, real.sourceFor("facebook"), real.nameCandidates("Twinkling Tree"));
    expect(text).toHaveLength(1);
    expect(text[0]).toMatch(/FROM `facebook_ad_post_owners` WHERE `post_owner_lower` IN \(/);
    expect(text[0]).not.toMatch(/COUNT\(|facebook_ad\b(?!_post)|LIKE|OFFSET/i);
  });
});

describe("the landing-page route (services/copyrightRequest.js)", () => {
  const express = require("express");
  const { createRouter, reasonOf } = require("../../../src/services/copyrightRequest");
  const COMPLAINT = "22222222-2222-4222-8222-222222222222";
  const goodResult = { ok: true, complaintId: COMPLAINT, name: "Twinkling Tree", totalAds: 120000, matches: [{ network: "facebook", ownerId: 9, name: "Twinkling Tree", ads: 120000 }],
    blocked: [{ network: "facebook", blocklistId: 41 }], failed: [], rejected: [], hashing: [{ network: "facebook", queued: true }] };

  async function serve(opts = {}) {
    const settings = opts.settings || {};
    const submit = "submit" in opts ? opts.submit : vi.fn(async () => goodResult); // submit: undefined means the real function
    const app = express();
    app.use(express.json());
    app.use("/api/v1/copyright", createRouter({ settings: { token: "s3cret", rateLimit: { windowMs: 60000, max: 100 }, ...settings }, submit }));
    const server = await new Promise((resolve) => { const s2 = app.listen(0, "127.0.0.1", () => resolve(s2)); });
    const url = `http://127.0.0.1:${server.address().port}/api/v1/copyright/advertiser/block`;
    const post = (body, headers = {}) => fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    return { post, submit, close: () => new Promise((r) => server.close(r)) };
  }
  const withServer = (opts, fn) => async () => { const t = await serve(opts); try { await fn(t); } finally { await t.close(); } };

  it("with the token it passes the name on and answers with only what the form needs", withServer({}, async (t) => {
    const res = await t.post({ name: "Twinkling Tree", reason: "  my\nbrand  " }, { "x-copyright-token": "s3cret" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ code: 200, message: "ok", data: { complaintId: COMPLAINT, name: "Twinkling Tree", found: true, adsFound: 120000 } });
    expect(t.submit).toHaveBeenCalledWith({ name: "Twinkling Tree", reason: "my brand", addedBy: "landing-form", network: "all" });
  }));

  it("the caller cannot choose who is recorded, the complaint id or the network", withServer({}, async (t) => {
    await t.post({ name: "Brand", addedBy: "someone-else", complaintId: COMPLAINT, network: "reddit" }, { "x-copyright-token": "s3cret" });
    expect(t.submit.mock.calls[0][0]).toEqual({ name: "Brand", reason: undefined, addedBy: "landing-form", network: "all" });
  }));

  it("refuses a missing or wrong token without calling anything", withServer({}, async (t) => {
    expect((await t.post({ name: "Brand" })).status).toBe(401);
    expect((await t.post({ name: "Brand" }, { "x-copyright-token": "wrong" })).status).toBe(401);
    expect((await t.post({ name: "Brand" }, { "x-copyright-token": "s3cret-and-more" })).status).toBe(401);
    expect(t.submit).not.toHaveBeenCalled();
  }));

  it("without a token it is closed (503) unless allowPublic is set", async () => {
    const closed = await serve({ settings: { token: "" } });
    try {
      expect((await closed.post({ name: "Brand" })).status).toBe(503);
      expect(closed.submit).not.toHaveBeenCalled();
    } finally { await closed.close(); }
    const open = await serve({ settings: { token: "", allowPublic: true } });
    try {
      expect((await open.post({ name: "Brand" })).status).toBe(200);
      expect(open.submit).toHaveBeenCalledTimes(1);
    } finally { await open.close(); }
  });

  it("an unusable name is a 400 with the reason; a request that could not be recorded is a 503 with no internals", async () => {
    const bad = await serve({ submit: vi.fn(async () => ({ ok: false, error: "invalid_name", message: "the advertiser name must be 2 to 255 characters" })) });
    try {
      const res = await bad.post({ name: "a" }, { "x-copyright-token": "s3cret" });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ code: 400, message: "the advertiser name must be 2 to 255 characters", data: null });
    } finally { await bad.close(); }

    const rejected = await serve({ submit: vi.fn(async () => ({ ok: false, blocked: [], failed: [], rejected: ["value is empty or unusable"] })) });
    try {
      const res = await rejected.post({ name: "!!" }, { "x-copyright-token": "s3cret" });
      expect(res.status).toBe(400);
      expect((await res.json()).message).toBe("This advertiser name cannot be used.");
    } finally { await rejected.close(); }

    const down = await serve({ submit: vi.fn(async () => ({ ok: false, error: "failed", message: "connect ECONNREFUSED 10.0.0.5:3306", failed: [{ network: "facebook", error: "secret detail" }] })) });
    try {
      const res = await down.post({ name: "Brand" }, { "x-copyright-token": "s3cret" });
      expect(res.status).toBe(503);
      const text = await res.text();
      expect(text).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|secret detail/);
    } finally { await down.close(); }
  });

  it("a body that is not an object, or has no name, is a 400 and never throws", withServer({ submit: undefined }, async (t) => {
    // the real submitAdvertiser rejects it before touching any database
    for (const body of [{}, { name: 42 }, { name: "" }, [], "text"]) {
      const res = await t.post(body, { "x-copyright-token": "s3cret" });
      expect(res.status).toBe(400);
    }
  }));

  it("is limited per address", async () => {
    const t = await serve({ settings: { rateLimit: { windowMs: 60000, max: 2 } } });
    try {
      const h = { "x-copyright-token": "s3cret" };
      expect((await t.post({ name: "Brand" }, h)).status).toBe(200);
      expect((await t.post({ name: "Brand" }, h)).status).toBe(200);
      const third = await t.post({ name: "Brand" }, h);
      expect(third.status).toBe(429);
      expect((await third.json()).message).toMatch(/Too many requests/);
      expect(t.submit).toHaveBeenCalledTimes(2);
    } finally { await t.close(); }
  });

  it("reasonOf keeps one clean line of at most 255 characters, or nothing", () => {
    expect(reasonOf(" a\n b\u0000 c ")).toBe("a b c");
    expect(reasonOf("x".repeat(300))).toHaveLength(255);
    expect(reasonOf("   ")).toBeUndefined();
    expect(reasonOf(5)).toBeUndefined();
  });

  it("is not mounted by app.js unless enabled, and then only with a token or allowPublic", () => {
    const source = require("node:fs").readFileSync(path.resolve(import.meta.dirname, "../../../src/app.js"), "utf8");
    expect(source).toMatch(/if \(copyrightRequest\?\.enabled\) \{\s+if \(copyrightRequest\.token \|\| copyrightRequest\.allowPublic\) \{\s+app\.use\('\/api\/v1\/copyright', require\('\.\/services\/copyrightRequest'\)\);/);
  });
});

// ── the rest of B2: stored hashes, backfill, review queue, search ──────────────────────────────────
const workerMod = require("../../../src/compliance/imagematch/worker");

describe("SQL of the cursors, the stored hashes and the review queue", () => {
  it("the backfill cursor is its own reserved row: it never touches the sweep's row or a hashing job", async () => {
    const sql = sqlSpy(() => ({ affectedRows: 1 }));
    await sweepRepo.sweepEnsure(sql, "facebook", "{}", workerMod.BACKFILL);
    await sweepRepo.sweepSave(sql, "facebook", "w", "{}", null, workerMod.BACKFILL);
    await sweepRepo.sweepRelease(sql, "facebook", "w", workerMod.BACKFILL);
    await sweepRepo.sweepClaim(sqlSpy((t) => (/^UPDATE/.test(t) ? { affectedRows: 1 } : [{ state: "{}" }])), "facebook", "w", new Date(), workerMod.BACKFILL);
    for (const call of sql.calls) {
      expect(call.text).toMatch(/blocklist_id = 4294967295/);
      expect(call.text).not.toMatch(/blocklist_id = 0\b/);
      neverDestructive(call.text);
    }
    expect(sql.calls[0].text).toMatch(/'backfill'/);
    expect(workerMod.BACKFILL.entry).toBeGreaterThan(2 ** 31); // above any real blocklist id
    expect(workerMod.SWEEP).toMatchObject({ entry: 0, status: "sweep" });
  });

  it("recordHashes adds one row per ad image, idempotent on the slot, and skips what cannot be stored", async () => {
    const sql = sqlSpy(() => ({ affectedRows: 2 }));
    const rows = [
      { network: "facebook", internalAdId: 11, platformAdId: "p11", ordinal: 0, sha256: SHA_BAD, phash: hex(1), phashAlgo: "sscd-simhash-v1", sourceUrl: "https://cdn/a.jpg", storagePath: "fb/a.jpg", source: "backfill" },
      { network: "facebook", internalAdId: 12, platformAdId: "p12", ordinal: 1, sha256: SHA_OK, phash: null, source: "ingest" },
      { network: "facebook", internalAdId: 13, platformAdId: null, sha256: SHA_OK, source: "ingest" },   // no platform id: not recorded
      { network: "facebook", internalAdId: 14, platformAdId: "p14" },                                    // no sha256: not recorded
    ];
    expect(await sweepRepo.recordHashes(sql, rows)).toBe(2);
    expect(sql.calls).toHaveLength(1);
    const { text, params } = sql.calls[0];
    expect(text).toMatch(/^INSERT INTO copyright_image_hashes \(network, internal_ad_id, platform_ad_id, media_role, ordinal, sha256, phash, phash_algo, source_url, storage_path, source, created_at\) VALUES \(\?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?, \?\), \(.*\) ON DUPLICATE KEY UPDATE id = id$/);
    expect(params).toHaveLength(24);
    expect(params.slice(0, 11)).toEqual(["facebook", "11", "p11", "creative", 0, SHA_BAD, hex(1), "sscd-simhash-v1", "https://cdn/a.jpg", "fb/a.jpg", "backfill"]);
    expect(params.slice(12, 23)).toEqual(["facebook", "12", "p12", "creative", 1, SHA_OK, null, null, "", "", "ingest"]); // no phash: no algo either
    neverDestructive(text);
    expect(await sweepRepo.recordHashes(sql, [])).toBe(0);
    expect(await sweepRepo.recordHashes(sql, [rows[2]])).toBe(0);
    expect(sql.calls).toHaveLength(1); // nothing to write: no statement
  });

  it("listReview reads one network's queue by primary key; resolveReview only changes a pending row", async () => {
    const sql = sqlSpy(() => []);
    await sweepRepo.listReview(sql, { network: "facebook", status: "pending", afterId: 40, limit: 10 });
    expect(sql.calls[0].params).toEqual(["facebook", "pending", 40]);
    expect(sql.calls[0].text).toMatch(/FROM copyright_review_queue WHERE network = \? AND status = \? AND id > \? ORDER BY id LIMIT 10$/);
    await sweepRepo.listReview(sql, { network: "facebook", status: "whatever", afterId: "x", limit: 99999 });
    expect(sql.calls[1].params).toEqual(["facebook", "pending", 0]);
    expect(sql.calls[1].text).toMatch(/LIMIT 200$/);

    const w = sqlSpy(() => ({ affectedRows: 1 }));
    expect(await sweepRepo.resolveReview(w, { network: "facebook", id: 5, status: "blocked", reviewedBy: "agent", note: "n".repeat(600) })).toBe(true);
    expect(w.calls[0].text).toMatch(/WHERE id = \? AND network = \? AND status = 'pending'$/);
    expect(w.calls[0].params[3]).toHaveLength(512);
    neverDestructive(w.calls[0].text);
    expect(await sweepRepo.resolveReview(sqlSpy(() => ({ affectedRows: 0 })), { network: "facebook", id: 5, status: "allowed", reviewedBy: "a" })).toBe(false);
  });

  it("hasImageExtension: only an image file, ignoring a query string", () => {
    const { hasImageExtension } = sweepSources;
    for (const u of ["https://c/x/1.jpg", "https://c/x/1.JPEG", "https://c/x/1.webp?v=3", "https://c/1.png#a", "https://c/1.avif"]) expect(hasImageExtension(u)).toBe(true);
    for (const u of ["https://c/pasvideos/fb/123", "https://c/pasimages/fb/ads/5555", "https://c/v.mp4", "https://c/x.jpg/", "", null, undefined, 5]) expect(hasImageExtension(u)).toBe(false);
  });
});

// A network with ads and a backfill cursor, all in memory, behind the same functions the backfill calls.
function backfillWorld({ max = 10, ads = {}, images = {}, carousel = {}, hashes = {}, claimable = true, pageSize = 100 } = {}) {
  const w = { max, ads, images, carousel, hashes, cursor: null, saves: [], recorded: [], hashCalls: [], ensureCalls: 0, released: 0, kinds: new Set(), claimable };
  let clock = 0;
  const sources = {
    maxAdId: async () => w.max,
    newAdsPage: async (_s, _src, after, upTo, limit) =>
      Object.keys(w.ads).map(Number).filter((id) => id > after && id <= upTo).sort((a, b) => a - b).slice(0, limit).map((id) => ({ id, platformId: w.ads[id] })),
    variantImages: async (_s, _src, ids) => ids.flatMap((id) => (w.images[id] === undefined ? [] : [].concat(w.images[id]).map((p) => ({ ad_id: id, image_url: p, image_url_original: null })))),
    carouselImages: async (_s, _src, ids) => ids.flatMap((id) => (w.carousel[id] || []).map((p) => ({ ad_id: id, image_url: p, image_url_original: null }))),
    toFetchableUrl: sweepSources.toFetchableUrl,
  };
  const repo = {
    sweepEnsure: async (_s, _n, json, kind) => { w.ensureCalls += 1; w.kinds.add(kind); if (!w.cursor) w.cursor = json; },
    sweepClaim: async (_s, _n, _w, _stale, kind) => { w.kinds.add(kind); return w.claimable ? { state: w.cursor } : null; },
    sweepSave: async (_s, _n, _w, json, err, kind) => { w.kinds.add(kind); w.cursor = json; w.saves.push({ json, err }); return true; },
    sweepRelease: async (_s, _n, _w, kind) => { w.kinds.add(kind); w.released += 1; return true; },
    recordHashes: async (_s, rows) => { w.recorded.push(...rows); return rows.length; },
  };
  const client = { hashUrl: async (url) => { clock += 10; w.hashCalls.push(url); const r = w.hashes[url]; return r === undefined ? { ok: false, outcome: "skip", reason: "x" } : r; } };
  const backfill = new workerMod.ImageBackfill({ client, sourceFor: () => ({}), sources, repo, options: { pageSize, cdnBase: "https://cdn.test", hashVersion: "sscd-simhash-v1" }, log: silent, now: () => new Date(clock) });
  w.state = () => JSON.parse(w.cursor);
  return { w, backfill };
}
const FOREVER = 1e15;

describe("ImageBackfill", () => {
  it("hashes and records every image up to the newest ad, page by page, then is finished and costs nothing more", async () => {
    const { w, backfill } = backfillWorld({
      max: 5, pageSize: 2,
      ads: { 1: "p1", 2: "p2", 3: "p3", 4: "p4", 5: "p5" },
      images: { 1: "m/a.jpg", 2: ["m/b.jpg", "m/c.jpg"], 3: "pasvideos/fb/123", 4: "x/DefaultImage.png", 5: "m/e.jpg" },
      hashes: { [U("m/a.jpg")]: okHash(hex(1).replace(/1$/, "a"), 1), [U("m/b.jpg")]: okHash("b".repeat(64), 2), [U("m/c.jpg")]: okHash("c".repeat(64), 3), [U("m/e.jpg")]: okHash("e".repeat(64), 5) },
    });
    const out = await backfill.run("facebook", {}, { workerId: "w", deadline: FOREVER });
    expect(out).toMatchObject({ hashed: 4, recorded: 4, skipped: 2, done: true, remaining: 0 });
    expect(w.hashCalls).toEqual([U("m/a.jpg"), U("m/b.jpg"), U("m/c.jpg"), U("m/e.jpg")]); // no call for the video id or the default image
    expect(w.recorded[0]).toEqual({
      network: "facebook", internalAdId: 1, platformAdId: "p1", mediaRole: "creative", ordinal: 0, sha256: hex(1).replace(/1$/, "a"), phash: hex(1),
      phashAlgo: "sscd-simhash-v1", sourceUrl: U("m/a.jpg"), storagePath: "m/a.jpg", source: "backfill",
    });
    expect(w.recorded.filter((r) => r.platformAdId === "p2").map((r) => r.ordinal)).toEqual([0, 1]); // two images of one ad: two slots
    expect(w.state()).toEqual({ lastAdId: 5, upToId: 5, done: true, recorded: 4 });
    expect([...w.kinds]).toEqual([workerMod.BACKFILL]); // only its own cursor row
    expect(w.released).toBe(1);

    const again = await backfill.run("facebook", {}, { workerId: "w", deadline: FOREVER });
    expect(again).toMatchObject({ done: true, hashed: 0 });
    expect(w.ensureCalls).toBe(1); // finished: not even a query
    expect(w.hashCalls).toHaveLength(4);
  });

  it("records the carousel images of an ad in their own slots when job.includeCarousel is on, and not otherwise", async () => {
    const make = () => backfillWorld({
      max: 2, ads: { 1: "p1", 2: "p2" }, images: { 1: "m/a.jpg", 2: "m/b.jpg" }, carousel: { 1: ["m/c1.jpg", "m/c2.jpg"] },
      hashes: { [U("m/a.jpg")]: okHash("a".repeat(64), 1), [U("m/b.jpg")]: okHash("b".repeat(64), 2), [U("m/c1.jpg")]: okHash("c".repeat(64), 3), [U("m/c2.jpg")]: okHash("d".repeat(64), 4) },
    });
    const off = make();
    await off.backfill.run("facebook", {}, { workerId: "w", deadline: FOREVER });
    expect(off.w.recorded.map((r) => r.mediaRole)).toEqual(["creative", "creative"]);

    const on = make();
    on.backfill.options.includeCarousel = true;
    await on.backfill.run("facebook", {}, { workerId: "w", deadline: FOREVER });
    expect(on.w.recorded.map((r) => [r.platformAdId, r.mediaRole, r.ordinal])).toEqual([["p1", "creative", 0], ["p2", "creative", 0], ["p1", "carousel", 0], ["p1", "carousel", 1]]); // the main images of the page first, then its carousel
  });

  it("stops at the deadline with its place saved, continues from there, and never goes past the newest ad of its first run", async () => {
    const { w, backfill } = backfillWorld({
      max: 4, pageSize: 1,
      ads: { 1: "p1", 2: "p2", 3: "p3", 4: "p4" },
      images: { 1: "m/1.jpg", 2: "m/2.jpg", 3: "m/3.jpg", 4: "m/4.jpg" },
      hashes: Object.fromEntries([1, 2, 3, 4].map((n) => [U(`m/${n}.jpg`), okHash(String(n).repeat(64), n)])),
    });
    const part = await backfill.run("facebook", {}, { workerId: "w", deadline: 25 }); // each call of the service takes 10 ms of this clock
    expect(part.done).toBeUndefined();
    expect(part.remaining).toBeGreaterThan(0);
    const reached = w.state().lastAdId;
    expect(reached).toBeGreaterThanOrEqual(1);
    expect(reached).toBeLessThan(4);

    w.max = 6; w.ads[5] = "p5"; w.ads[6] = "p6"; w.images[5] = "m/5.jpg"; w.images[6] = "m/6.jpg"; // new ads: the sweep's, not the backfill's
    const rest = await backfill.run("facebook", {}, { workerId: "w", deadline: FOREVER });
    expect(rest.done).toBe(true);
    expect(w.recorded.map((r) => r.platformAdId)).toEqual(["p1", "p2", "p3", "p4"]); // each once, in order, none after id 4
    expect(w.state().upToId).toBe(4);
  });

  it("starts after options.fromId", async () => {
    const { w, backfill } = backfillWorld({ max: 4, ads: { 1: "p1", 2: "p2", 3: "p3", 4: "p4" }, images: { 1: "a.jpg", 2: "b.jpg", 3: "c.jpg", 4: "d.jpg" },
      hashes: Object.fromEntries(["a", "b", "c", "d"].map((n, i) => [U(`${n}.jpg`), okHash(n.repeat(64), i)])) });
    backfill.options.fromId = 2;
    await backfill.run("facebook", {}, { workerId: "w", deadline: FOREVER });
    expect(w.recorded.map((r) => r.platformAdId)).toEqual(["p3", "p4"]);
  });

  it("a page the service failed for entirely stays and is tried again; a page where some images hashed moves on", async () => {
    const down = { ok: false, outcome: "unavailable", reason: "503" };
    const { w, backfill } = backfillWorld({ max: 2, ads: { 1: "p1", 2: "p2" }, images: { 1: "a.jpg", 2: "b.jpg" }, hashes: { [U("a.jpg")]: down, [U("b.jpg")]: down } });
    const failed = await backfill.run("facebook", {}, { workerId: "w", deadline: FOREVER });
    expect(failed.problem).toMatch(/unavailable/);
    expect(w.state().lastAdId).toBe(0);
    expect(w.saves.at(-1).err).toMatch(/unavailable/);
    expect(w.recorded).toEqual([]);

    w.hashes[U("b.jpg")] = okHash("b".repeat(64), 2);
    const partly = await backfill.run("facebook", {}, { workerId: "w", deadline: FOREVER });
    expect(partly).toMatchObject({ hashed: 1, recorded: 1, skipped: 1, done: true });
  });

  it("asks the worker to pause when the key is refused, without moving", async () => {
    const { w, backfill } = backfillWorld({ max: 1, ads: { 1: "p1" }, images: { 1: "a.jpg" }, hashes: { [U("a.jpg")]: { ok: false, outcome: "unauthorized", reason: "no" } } });
    const out = await backfill.run("facebook", {}, { workerId: "w", deadline: FOREVER });
    expect(out.pause).toMatch(/unauthorized/);
    expect(w.state().lastAdId).toBe(0);
    expect(w.recorded).toEqual([]);
  });

  it("never runs without a time budget, does nothing when another worker holds its cursor, and never throws", async () => {
    const none = backfillWorld({ max: 1, ads: { 1: "p1" } });
    expect((await none.backfill.run("facebook", {}, { workerId: "w" })).problem).toMatch(/no time budget/);
    expect(none.w.ensureCalls).toBe(0);
    const held = backfillWorld({ max: 1, ads: { 1: "p1" }, claimable: false });
    expect((await held.backfill.run("facebook", {}, { workerId: "w", deadline: FOREVER })).problem).toMatch(/another worker/);
    const broken = backfillWorld();
    broken.backfill.sources.maxAdId = async () => { throw new Error("db down"); };
    expect((await broken.backfill.run("facebook", {}, { workerId: "w", deadline: FOREVER })).problem).toBe("db down");
  });
});

describe("the sweep records every new image when recordHashes is on", () => {
  const setup = (over = {}) => {
    const t = sweepWorld({ maxId: 10, banned: [], ads: { 11: "p11", 12: "p12" }, images: { 11: "m/a.jpg", 12: "m/b.jpg" },
      hashes: { [U("m/a.jpg")]: okHash(SHA_OK, 1), [U("m/b.jpg")]: okHash(SHA_BAD, 2) }, ...over });
    const recorded = [];
    t.sweeper.repo.recordHashes = vi.fn(async (_s, rows) => { recorded.push(...rows); return rows.length; });
    t.recorded = recorded;
    return t;
  };
  const three = async (t) => { await t.sweeper.sweep("facebook", {}, { workerId: "w" }); t.w.maxId = 12; await t.sweeper.sweep("facebook", {}, { workerId: "w" }); return t.sweeper.sweep("facebook", {}, { workerId: "w" }); };

  it("hashes and records them even while nothing is banned (the default skips them)", async () => {
    const on = setup();
    on.sweeper.options.recordHashes = true;
    const out = await three(on);
    expect(out.checked).toBe(2);
    expect(on.recorded.map((r) => [r.platformAdId, r.source, r.ordinal, r.sha256])).toEqual([["p11", "ingest", 0, SHA_OK], ["p12", "ingest", 0, SHA_BAD]]);
    expect(on.recorded[0]).toMatchObject({ network: "facebook", internalAdId: 11, phash: hex(1), phashAlgo: "sscd-simhash-v1", storagePath: "m/a.jpg", sourceUrl: U("m/a.jpg") });

    const off = setup();
    await three(off);
    expect(off.w.hashCalls).toEqual([]); // nothing banned and recording off: the service is not called
    expect(off.recorded).toEqual([]);
  });

  it("carousel images are checked and recorded only when job.includeCarousel is on, in slots of their own (role 'carousel')", async () => {
    const world = () => setup({
      banned: [bannedImage(7, SHA_BAD)],
      ads: { 11: "p11" }, images: { 11: "m/a.jpg" }, carousel: { 11: ["m/c1.jpg", "m/c2.jpg"] },
      hashes: { [U("m/a.jpg")]: okHash(SHA_OK, 1), [U("m/c1.jpg")]: okHash(SHA_BAD, 2), [U("m/c2.jpg")]: okHash("c".repeat(64), 3) },
    });
    const off = world();
    off.sweeper.options.recordHashes = true;
    await three(off);
    expect(off.w.hashCalls).toEqual([U("m/a.jpg")]); // off by default: the carousel is not even read
    expect(off.recorded.map((r) => r.mediaRole)).toEqual(["creative"]);

    const on = world();
    on.sweeper.options.recordHashes = true;
    on.sweeper.options.includeCarousel = true;
    await three(on);
    expect(on.w.hashCalls).toEqual([U("m/a.jpg"), U("m/c1.jpg"), U("m/c2.jpg")]);
    expect(on.recorded.map((r) => [r.mediaRole, r.ordinal])).toEqual([["creative", 0], ["carousel", 0], ["carousel", 1]]); // the main image keeps its slot
    expect(on.w.queue).toHaveLength(1); // a banned image inside a carousel is queued for review
    expect(on.w.queue[0]).toMatchObject({ platformAdId: "p11", imageUrl: U("m/c1.jpg") });
  });

  it("a source without carouselImages is not asked for the carousel, even when it is on", async () => {
    const t = setup();
    t.sweeper.options.recordHashes = true;
    t.sweeper.options.includeCarousel = true;
    delete t.sweeper.sources.carouselImages;
    await three(t);
    expect(t.w.hashCalls).toEqual([U("m/a.jpg"), U("m/b.jpg")]);
  });

  it("a failing write of the hashes never fails the page: the cursor still moves", async () => {
    const t = setup();
    t.sweeper.options.recordHashes = true;
    t.sweeper.repo.recordHashes = vi.fn(async () => { throw new Error("table missing"); });
    await three(t);
    expect(t.w.state().lastAdId).toBe(12);
  });
});

describe("HashWorker > the backfill gets the time that is left", () => {
  function build({ filled = { network: "facebook", hashed: 3, recorded: 3, skipped: 0 }, step = 0 } = {}) {
    let clock = 1000;
    const backfill = { run: vi.fn(async () => filled) };
    const repo = { findNewAdvertisers: async () => [], createJobs: async () => ({}), claimNext: async () => null };
    const worker = new HashWorker({ networks: ["facebook"], getSql: () => ({}), makeJob: () => ({}), backfill, repo, log: silent, now: () => new Date((clock += step)) });
    return { worker, backfill };
  }

  it("runs after the jobs, only inside a timed pass, with the pass's deadline, and reports what it did", async () => {
    const { worker, backfill } = build();
    const out = await worker.tick({ budgetMs: 60000 });
    expect(backfill.run).toHaveBeenCalledTimes(1);
    const [network, , opts] = backfill.run.mock.calls[0];
    expect(network).toBe("facebook");
    expect(opts.deadline).toBe(1000 + 60000);
    expect(out.backfill).toEqual([{ network: "facebook", hashed: 3, recorded: 3, skipped: 0 }]);
  });

  it("never runs without a time budget", async () => {
    const { worker, backfill } = build();
    await worker.tick();
    expect(backfill.run).not.toHaveBeenCalled();
  });

  it("does not run when the jobs used up the time", async () => {
    const { worker, backfill } = build({ step: 100 }); // the clock moves 100 ms at every look at it
    await worker.tick({ budgetMs: 50 });
    expect(backfill.run).not.toHaveBeenCalled();
  });

  it("a key problem found by the backfill pauses the worker", async () => {
    const { worker } = build({ filled: { network: "facebook", hashed: 0, recorded: 0, skipped: 0, pause: "the key is refused" } });
    const out = await worker.tick({ budgetMs: 60000 });
    expect(out.backfill[0].pause).toMatch(/refused/);
    expect((await worker.tick({ budgetMs: 60000 })).paused).toBe(true);
  });

  it("is quiet when there is nothing to report", async () => {
    const { worker } = build({ filled: { network: "facebook", hashed: 0, recorded: 0, skipped: 0, done: true } });
    expect((await worker.tick({ budgetMs: 60000 })).backfill).toBeUndefined();
  });
});

describe("the review queue (review.list / review.resolve)", () => {
  function build({ rows = [], addOk = true, addThrows = false, hasDb = true } = {}) {
    const table = rows.map((r) => ({ ...r }));
    const jobRepository = {
      listReview: vi.fn(async (_s, q) => table.filter((r) => r.network === q.network && r.status === q.status && r.id > q.afterId).slice(0, q.limit)),
      getReview: vi.fn(async (_s, network, id) => table.find((r) => r.network === network && r.id === id) || null),
      resolveReview: vi.fn(async (_s, q) => { const r = table.find((x) => x.id === q.id && x.network === q.network && x.status === "pending"); if (!r) return false; Object.assign(r, { status: q.status, reviewed_by: q.reviewedBy, note: q.note }); return true; }),
    };
    const blocklist = { add: vi.fn(async () => { if (addThrows) throw new Error("blocklist is not initialised"); return { rejected: [], results: [{ network: "facebook", ok: addOk, entries: [] }] }; }) };
    const api = workerMod.createReview({ jobRepository, blocklist, databaseManager: { getSQL: (n) => (hasDb ? { n } : null) } });
    return { api, table, jobRepository, blocklist };
  }
  const row = (over = {}) => ({ id: 5, network: "facebook", status: "pending", sha256: SHA_BAD, phash: hex(7), phash_algo: "sscd-simhash-v1", blocklist_id: 3, distance: 12, platform_ad_id: "p5", internal_ad_id: "55", image_url: "https://cdn/x.jpg", ...over });

  it("lists the held images of a network, oldest first, with the id to continue from", async () => {
    const { api } = build({ rows: [row({ id: 1 }), row({ id: 2 }), row({ id: 3, status: "allowed" }), row({ id: 4, network: "reddit" })] });
    expect(await api.list({ network: "Facebook" })).toMatchObject({ ok: true, items: [{ id: 1 }, { id: 2 }], next: 2 });
    expect((await api.list({ network: "facebook", status: "allowed" })).items.map((r) => r.id)).toEqual([3]);
    expect(await api.list({ network: "facebook", status: "odd" })).toMatchObject({ ok: false, error: "invalid_status" });
    expect(await api.list({ network: "bad net!" })).toMatchObject({ ok: false, error: "invalid_network" });
    expect(await build({ hasDb: false }).api.list({ network: "facebook" })).toMatchObject({ ok: false, error: "no_database" });
  });

  it("allow marks the row allowed and adds nothing to the blocklist", async () => {
    const { api, table, blocklist } = build({ rows: [row()] });
    expect(await api.resolve({ network: "facebook", id: 5, decision: "allow", reviewedBy: "agent-1", note: "different ad" })).toEqual({ ok: true, id: 5, status: "allowed" });
    expect(table[0]).toMatchObject({ status: "allowed", reviewed_by: "agent-1", note: "different ad" });
    expect(blocklist.add).not.toHaveBeenCalled();
  });

  it("block marks the row blocked and adds the image itself to the blocklist, so an exact copy is refused at ingestion from then on", async () => {
    const { api, table, blocklist } = build({ rows: [row()] });
    const out = await api.resolve({ network: "facebook", id: "5", decision: "block", reviewedBy: "agent-1" });
    expect(out).toEqual({ ok: true, id: 5, status: "blocked", blocklistAdded: true });
    expect(table[0].status).toBe("blocked");
    const [[entry]] = blocklist.add.mock.calls[0];
    expect(entry).toMatchObject({ entryType: "image_hash", network: "facebook", imageSha256: SHA_BAD, imagePhash: hex(7), imagePhashAlgo: "sscd-simhash-v1", addedBy: "agent-1", source: "review", reason: "confirmed copy of blocklist entry 3" });
    expect(JSON.parse(entry.details)).toEqual({ review_id: 5, blocklist_id: 3, ad_id: "p5", internal_ad_id: "55", image_url: "https://cdn/x.jpg", distance: 12 });
  });

  it("if adding the image fails the decision stays saved and it says so; nothing throws", async () => {
    for (const opts of [{ addOk: false }, { addThrows: true }]) {
      const { api, table } = build({ rows: [row()], ...opts });
      const out = await api.resolve({ network: "facebook", id: 5, decision: "block", reviewedBy: "a" });
      expect(out).toMatchObject({ ok: true, status: "blocked", blocklistAdded: false });
      expect(out.message).toMatch(/decision is saved/);
      expect(table[0].status).toBe("blocked");
    }
  });

  it("a decision is never overwritten, a missing item is reported, and bad input writes nothing", async () => {
    const { api, table, jobRepository } = build({ rows: [row({ status: "allowed" })] });
    expect(await api.resolve({ network: "facebook", id: 5, decision: "block", reviewedBy: "a" })).toMatchObject({ ok: false, error: "already_resolved", status: "allowed" });
    expect(table[0].status).toBe("allowed");
    expect(await api.resolve({ network: "facebook", id: 99, decision: "allow", reviewedBy: "a" })).toMatchObject({ ok: false, error: "not_found" });
    jobRepository.resolveReview.mockClear();
    for (const [input, error] of [
      [{ network: "facebook", id: 5, decision: "maybe", reviewedBy: "a" }, "invalid_decision"],
      [{ network: "facebook", id: 5, decision: "allow" }, "reviewed_by_required"],
      [{ network: "facebook", id: 5, decision: "allow", reviewedBy: "  " }, "reviewed_by_required"],
      [{ network: "facebook", id: "five", decision: "allow", reviewedBy: "a" }, "invalid_id"],
      [{ network: "facebook", id: 0, decision: "allow", reviewedBy: "a" }, "invalid_id"],
      [{ network: "x y", id: 5, decision: "allow", reviewedBy: "a" }, "invalid_network"],
      [undefined, "invalid_network"],
    ]) expect(await api.resolve(input)).toMatchObject({ ok: false, error });
    expect(jobRepository.resolveReview).not.toHaveBeenCalled();
  });
});

describe("searchStored: the stored images that are a given banned image", () => {
  const stored = (id, phashN, over = {}) => ({ id, platform_ad_id: `p${id}`, internal_ad_id: String(id), media_role: "creative", ordinal: 0, sha256: String(id % 10).repeat(64), phash: phashN === null ? null : hex(phashN), phash_algo: "sscd-simhash-v1", source_url: `u${id}`, storage_path: `s${id}`, ...over });
  function fakeStore(rows) {
    const calls = [];
    return {
      calls,
      async query(text, params) {
        calls.push({ text: text.replace(/\s+/g, " ").trim(), params });
        if (/WHERE sha256 = \?/.test(text)) return rows.filter((r) => r.sha256 === params[0]).slice(0, 10000);
        const limit = Number(/LIMIT (\d+)$/.exec(text.trim())[1]);
        return rows.filter((r) => r.id > params[0] && r.phash !== null).slice(0, limit);
      },
    };
  }
  const search = workerMod.searchStored;

  it("an exact copy is found by SHA-256 through the index, without reading the store", async () => {
    const sql = fakeStore([stored(11, 1), stored(12, 2), stored(21, 3)]);
    const out = await search(sql, "facebook", { sha256: "1".repeat(64) });
    expect(out.matches.map((m) => [m.platformAdId, m.distance])).toEqual([["p11", 0], ["p21", 0]]);
    expect(sql.calls).toHaveLength(1);
    expect(sql.calls[0].text).toMatch(/^SELECT .* FROM copyright_image_hashes WHERE sha256 = \? AND network = \? LIMIT 1000$/);
    expect(out).toMatchObject({ ok: true, complete: true });
  });

  it("near copies are found by comparing the stored hashes in the application, closest first; another hash version is never compared", async () => {
    const sql = fakeStore([stored(1, 1), stored(2, 0xff), stored(3, 3), stored(4, 0xffffff), stored(5, 7, { phash_algo: "other-v2" }), stored(6, null)]);
    const out = await search(sql, "facebook", { phash: hex(0), maxDistance: 8 });
    expect(out.matches.map((m) => [m.platformAdId, m.distance])).toEqual([["p1", 1], ["p3", 2], ["p2", 8]]);
    expect(out).toMatchObject({ complete: true });
    expect(sql.calls[0].text).toMatch(/WHERE id > \? AND network = \? AND phash IS NOT NULL ORDER BY id LIMIT 5000$/);
    expect(sql.calls.every((c) => !/DELETE|UPDATE|INSERT/i.test(c.text))).toBe(true);
  });

  it("reads the whole store in pages and says whether it finished; stops at the limit or the deadline", async () => {
    const rows = Array.from({ length: 450 }, (_, i) => stored(i + 1, i % 2 === 0 ? 1 : 0xffffffff));
    const all = await search(fakeStore(rows), "facebook", { phash: hex(0), maxDistance: 4, pageSize: 100 });
    expect(all).toMatchObject({ scanned: 450, complete: true });
    expect(all.matches).toHaveLength(225);

    const capped = await search(fakeStore(rows), "facebook", { phash: hex(0), maxDistance: 4, pageSize: 100, limit: 10 });
    expect(capped.matches).toHaveLength(10);
    expect(capped.complete).toBe(false);

    let clock = 0;
    const slow = fakeStore(rows);
    const original = slow.query;
    slow.query = async (...a) => { clock += 10; return original(...a); };
    const late = await search(slow, "facebook", { phash: hex(0), maxDistance: 4, pageSize: 100, deadline: 15 }, () => clock);
    expect(late.complete).toBe(false);
    expect(late.scanned).toBeLessThan(450);
  });

  it("an exact copy found by both ways is listed once, and with nothing to look for it finds nothing", async () => {
    const sql = fakeStore([stored(1, 0, { sha256: "a".repeat(64) })]);
    const both = await search(sql, "facebook", { sha256: "a".repeat(64), phash: hex(0), maxDistance: 4 });
    expect(both.matches).toHaveLength(1);
    expect((await search(fakeStore([stored(1, 0)]), "facebook", {})).matches).toEqual([]);
  });
});

describe("the review and search routes (services/copyrightRequest.js)", () => {
  const expressLib = require("express");
  const { createRouter: makeRouter } = require("../../../src/services/copyrightRequest");

  async function serveReview(opts = {}) {
    const review = opts.review || {
      list: vi.fn(async () => ({ ok: true, items: [{ id: 1 }], next: 1 })),
      resolve: vi.fn(async (q) => ({ ok: true, id: Number(q.id), status: "blocked", blocklistAdded: true })),
    };
    const search = opts.search || vi.fn(async () => ({ ok: true, matches: [{ distance: 0, platformAdId: "p1" }], scanned: 3, complete: true }));
    const app = expressLib();
    app.use(expressLib.json());
    app.use("/c", makeRouter({ settings: { token: "s3cret", rateLimit: { windowMs: 60000, max: 100 }, ...(opts.settings || {}) }, submit: vi.fn(), review, search }));
    const server = await new Promise((resolve) => { const s2 = app.listen(0, "127.0.0.1", () => resolve(s2)); });
    const base = `http://127.0.0.1:${server.address().port}/c`;
    const call = (method, path, body, headers = { "x-copyright-token": "s3cret" }) => fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { call, review, search, close: () => new Promise((r) => server.close(r)) };
  }
  const using = (opts, fn) => async () => { const t = await serveReview(opts); try { await fn(t); } finally { await t.close(); } };

  it("GET /review lists the held images for a network", using({}, async (t) => {
    const res = await t.call("GET", "/review?network=facebook&status=pending&afterId=7&limit=20");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ code: 200, message: "ok", data: { items: [{ id: 1 }], next: 1 } });
    expect(t.review.list).toHaveBeenCalledWith({ network: "facebook", status: "pending", afterId: "7", limit: "20" });
  }));

  it("POST /review/:id decides one, and passes the id, the decision and who decided", using({}, async (t) => {
    const res = await t.call("POST", "/review/5", { network: "facebook", decision: "block", reviewedBy: "agent-1", note: "same ad" });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ id: 5, status: "blocked", blocklistAdded: true });
    expect(t.review.resolve).toHaveBeenCalledWith({ network: "facebook", id: "5", decision: "block", reviewedBy: "agent-1", note: "same ad" });
  }));

  it("maps what the review says to the right status: 404 not found, 409 already decided, 400 bad input, 503 a failure", async () => {
    for (const [error, code] of [["not_found", 404], ["already_resolved", 409], ["invalid_decision", 400], ["failed", 503], ["no_database", 503]]) {
      const t = await serveReview({ review: { list: vi.fn(), resolve: vi.fn(async () => ({ ok: false, error, message: `m ${error}` })) } });
      try {
        const res = await t.call("POST", "/review/5", { network: "facebook", decision: "allow", reviewedBy: "a" });
        expect(res.status).toBe(code);
        expect((await res.json()).message).toBe(`m ${error}`);
      } finally { await t.close(); }
    }
  });

  it("these routes need the token even where the advertiser route is knowingly open (allowPublic)", async () => {
    const t = await serveReview({ settings: { token: "", allowPublic: true } });
    try {
      for (const [m, p, b] of [["GET", "/review?network=facebook"], ["POST", "/review/5", { network: "facebook", decision: "allow", reviewedBy: "a" }], ["POST", "/images/search", { network: "facebook", sha256: "a".repeat(64) }]]) {
        expect((await t.call(m, p, b, {})).status).toBe(503);
      }
      expect(t.review.list).not.toHaveBeenCalled();
      expect(t.review.resolve).not.toHaveBeenCalled();
      expect(t.search).not.toHaveBeenCalled();
    } finally { await t.close(); }
  });

  it("refuses a missing or wrong token on all three", using({}, async (t) => {
    for (const headers of [{}, { "x-copyright-token": "wrong" }]) {
      expect((await t.call("GET", "/review?network=facebook", undefined, headers)).status).toBe(401);
      expect((await t.call("POST", "/review/5", { network: "facebook", decision: "allow", reviewedBy: "a" }, headers)).status).toBe(401);
      expect((await t.call("POST", "/images/search", { network: "facebook", sha256: "a".repeat(64) }, headers)).status).toBe(401);
    }
    expect(t.review.list).not.toHaveBeenCalled();
    expect(t.search).not.toHaveBeenCalled();
  }));

  it("POST /images/search finds the stored copies of a banned image, and checks its input first", using({}, async (t) => {
    const res = await t.call("POST", "/images/search", { network: "Facebook", phash: "f".repeat(64), maxDistance: 48, limit: 50 });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ matches: [{ distance: 0, platformAdId: "p1" }], scanned: 3, complete: true });
    const [network, query] = t.search.mock.calls[0];
    expect(network).toBe("facebook");
    expect(query).toMatchObject({ phash: "f".repeat(64), maxDistance: 48, limit: 50 });
    expect(query.deadline).toBeGreaterThan(Date.now());
    expect((await t.call("POST", "/images/search", { network: "facebook" })).status).toBe(400); // nothing to look for
    expect((await t.call("POST", "/images/search", { network: "bad net!", sha256: "a".repeat(64) })).status).toBe(400);
    expect(t.search).toHaveBeenCalledTimes(1);
  }));
});

// ═════════════ generations, requeue, the results hand-over to B3 ═════════════
describe("generations and requeue (jobRepository)", () => {
  const { jobRepository: real, describeJob, createJobsApi } = require("../../../src/compliance/imagematch/worker");
  const crypto = require("node:crypto");

  function sqlOf(handler = () => ({ affectedRows: 1 })) {
    const calls = [];
    return { calls, async query(text, params) { calls.push({ text: text.replace(/\s+/g, " ").trim(), params }); return handler(text.replace(/\s+/g, " ").trim(), params, calls.length); } };
  }
  const safe = (text) => expect(text).not.toMatch(/\b(DELETE|DROP|TRUNCATE|ALTER)\b/i);

  it("requestRun raises the generation; a waiting or finished job starts clean, a RUNNING one only gets the new generation", async () => {
    const sql = sqlOf();
    expect(await real.requestRun(sql, "facebook", 12)).toBe(true);
    const { text, params } = sql.calls[0];
    expect(text).toMatch(/^UPDATE copyright_image_hash_jobs SET requested_gen = requested_gen \+ 1, requested_at = \?/);
    expect(text).toMatch(/state = IF\(status = 'running', state, NULL\)/);
    expect(text).toMatch(/attempts = IF\(status = 'running', attempts, 0\)/);
    expect(text).toMatch(/status = IF\(status = 'running', 'running', 'pending'\)/);
    // status is assigned last, so every IF before it still sees the old status (UPDATE assignments run left to right)
    expect(text.indexOf("status = IF(status = 'running', 'running'")).toBeGreaterThan(text.indexOf("heartbeat_at = IF"));
    // never the cursor rows of the sweep (0) and the backfill (4294967295)
    expect(text).toMatch(/WHERE network = \? AND blocklist_id = \? AND blocklist_id > 0 AND blocklist_id <= 4294967294$/);
    expect(params.slice(3)).toEqual(["facebook", 12]);
    // the complaint of the new block replaces the job's (so the next run tags its hashes with it); none given leaves it as it is
    expect(text).toMatch(/requested_at = \?, complaint_id = COALESCE\(\?, complaint_id\),/);
    expect(params[1]).toBeNull();
    const withComplaint = sqlOf();
    await real.requestRun(withComplaint, "facebook", 12, "22222222-2222-4222-8222-222222222222");
    expect(withComplaint.calls[0].params[1]).toBe("22222222-2222-4222-8222-222222222222");
    expect(await real.requestRun(sqlOf(() => ({ affectedRows: 0 })), "facebook", 99)).toBe(false);
    safe(text);
  });

  it("finish never lets an older run stand for a newer request: the job goes back to pending and covered_gen stays", async () => {
    const sql = sqlOf();
    await real.finish(sql, 5, "w1", "done");
    const { text } = sql.calls[0];
    expect(text).toMatch(/status = IF\(requested_gen > run_gen, 'pending', \?\)/);
    expect(text).toMatch(/covered_gen = IF\(requested_gen > run_gen OR \? = 0, covered_gen, run_gen\)/);
    expect(text).toMatch(/state = IF\(requested_gen > run_gen, NULL, state\)/);
    expect(text).toMatch(/finished_at = IF\(requested_gen > run_gen, NULL, \?\)/);
    expect(text).not.toMatch(/SET .*requested_gen = /); // finish never changes what was asked for
    expect(text).not.toMatch(/SET .*\brun_gen = /);
    safe(text);
  });

  it("finds the entries blocked again by their COMPLAINT ID: a new complaint is a new block, the same complaint again (a retry) is not", async () => {
    const sql = sqlOf((text, params) => (params[2] === "advertiser" && params[1] === "facebook" ? [{ id: 5, complaint_id: "22222222-2222-4222-8222-222222222222" }] : []));
    expect(await real.findReblocked(sql, "facebook")).toEqual([{ id: 5, complaint_id: "22222222-2222-4222-8222-222222222222" }]);
    expect(sql.calls).toHaveLength(10);
    for (const { text } of sql.calls) {
      expect(text).toMatch(/SELECT b\.id AS id, b\.complaint_id AS complaint_id FROM copyright_blocklist b JOIN copyright_image_hash_jobs j ON j\.network = \? AND j\.blocklist_id = b\.id WHERE b\.network = \? AND b\.entry_type = \? AND b\.status = 'active'/);
      // a different (or new) complaint id -> new block; the same one -> never, even if updated_at moved (null-safe comparison <=>)
      expect(text).toMatch(/AND \(\(b\.complaint_id IS NOT NULL AND NOT \(b\.complaint_id <=> j\.complaint_id\)\) OR \(b\.complaint_id IS NULL AND b\.updated_at > COALESCE\(j\.requested_at, j\.created_at\)\)\) ORDER BY b\.id LIMIT 100$/);
      safe(text);
    }
  });

  it("requestReblocked asks each re-blocked entry for a new run and counts them", async () => {
    const sql = sqlOf((text, params) => {
      if (/^SELECT/.test(text)) return params[2] === "advertiser" ? [{ id: 5, complaint_id: "22222222-2222-4222-8222-222222222222" }, { id: 6, complaint_id: null }] : [];
      return { affectedRows: 1 };
    });
    expect(await real.requestReblocked(sql, "facebook")).toBe(2);
    const updates = sql.calls.filter((c) => /^UPDATE/.test(c.text));
    expect(updates.map((c) => c.params[4])).toEqual([5, 6]);                                      // the blocklist ids
    expect(updates.map((c) => c.params[1])).toEqual(["22222222-2222-4222-8222-222222222222", null]); // each with the complaint that blocked it
  });

  it("resumeLimited continues only a limit_reached job: same generation, saved place kept, image counter back to zero, compare-and-set", async () => {
    const state = JSON.stringify({ owners: { 1: { lastAdId: 900, done: false } }, stats: { requested: 10000, hashed: 9000 } });
    const sql = sqlOf((text) => (/^SELECT/.test(text) ? [{ id: 3, status: "limit_reached", state, progress_seq: 9 }] : { affectedRows: 1 }));
    expect(await real.resumeLimited(sql, "facebook", 7)).toEqual({ ok: true });
    const update = sql.calls[1];
    expect(update.text).toMatch(/SET status = 'pending', attempts = 0, last_error = NULL, finished_at = NULL, claimed_by = NULL/);
    expect(update.text).toMatch(/WHERE id = \? AND status = 'limit_reached' AND progress_seq = \?$/);
    expect(update.text).not.toMatch(/requested_gen|run_gen|covered_gen/); // the same generation goes on
    expect(JSON.parse(update.params[0])).toEqual({ owners: { 1: { lastAdId: 900, done: false } }, stats: { requested: 0, hashed: 9000 } });
    expect(update.params.slice(2)).toEqual([3, 9]);

    const other = (status, st = state) => sqlOf(() => [{ id: 3, status, state: st, progress_seq: 1 }]);
    expect(await real.resumeLimited(other("done"), "facebook", 7)).toEqual({ ok: false, reason: "not_limit_reached" });
    expect(await real.resumeLimited(sqlOf(() => []), "facebook", 7)).toEqual({ ok: false, reason: "no_job" });
    expect(await real.resumeLimited(other("limit_reached", null), "facebook", 7)).toEqual({ ok: false, reason: "no_saved_place" });
    expect(await real.resumeLimited(sqlOf((t) => (/^SELECT/.test(t) ? [{ id: 3, status: "limit_reached", state, progress_seq: 9 }] : { affectedRows: 0 })), "facebook", 7))
      .toEqual({ ok: false, reason: "changed_meanwhile" });
  });

  it("recordJobResults writes identifiers and outcomes, idempotently, in chunks", async () => {
    const sql = sqlOf();
    const rows = Array.from({ length: 450 }, (_, i) => ({ adId: i + 1, platformAdId: `P${i + 1}`, sourceUrl: `fb/adImage/${i + 1}.jpeg`, outcome: i % 2 ? "skipped" : "hashed", reason: i % 2 ? "no stored image" : "", sha256: i % 2 ? null : "a".repeat(64) }));
    rows.push({ adId: "", platformAdId: null, sourceUrl: "cdn.example.com/a.jpg", outcome: "hashed", reason: "", sha256: "b".repeat(64) });
    expect(await real.recordJobResults(sql, rows, { network: "facebook", jobId: 8, blocklistId: 3, generation: 2 })).toBe(451);
    expect(sql.calls).toHaveLength(3); // 200 + 200 + 51
    const { text, params } = sql.calls[0];
    expect(text).toMatch(/^INSERT INTO copyright_image_hash_results \(network, job_id, blocklist_id, generation, platform_ad_id, internal_ad_id, slot_hash, source_url, outcome, reason, sha256, created_at, updated_at\) VALUES/);
    expect(text).toMatch(/ON DUPLICATE KEY UPDATE platform_ad_id = VALUES\(platform_ad_id\), outcome = VALUES\(outcome\)/);
    expect(params.slice(0, 8)).toEqual(["facebook", 8, 3, 2, "P1", "1", crypto.createHash("sha1").update("fb/adImage/1.jpeg").digest("hex"), "fb/adImage/1.jpeg"]);
    const last = sql.calls[2].params.slice(-13);
    expect(last.slice(4, 6)).toEqual([null, ""]); // a media URL hashed on its own: no ad
    expect(params.includes(undefined)).toBe(false);
    expect(await real.recordJobResults(sql, [], { network: "x", jobId: 1, blocklistId: 1, generation: 1 })).toBe(0);
    expect(sql.calls).toHaveLength(3);
    safe(text);
  });

  it("listJobs and listJobResults read by key with a limit, and never return the cursor rows of the sweep and the backfill", async () => {
    const sql = sqlOf(() => []);
    await real.listJobs(sql, { network: "facebook", blocklistId: "7", status: "done", afterId: 4, limit: 99999 });
    const jobs = sql.calls[0];
    expect(jobs.text).toMatch(/WHERE network = \? AND id > \? AND blocklist_id > 0 AND blocklist_id <= 4294967294 AND blocklist_id = \? AND status = \? ORDER BY id LIMIT 200$/);
    expect(jobs.params).toEqual(["facebook", 4, 7, "done"]);
    await real.listJobResults(sql, { network: "facebook", jobId: 8, generation: 2, outcome: "failed", afterId: 0, limit: 5 });
    const results = sql.calls[1];
    expect(results.text).toMatch(/FROM copyright_image_hash_results WHERE network = \? AND job_id = \? AND generation = \? AND id > \? AND outcome = \? ORDER BY id LIMIT 5$/);
    expect(results.params).toEqual(["facebook", 8, 2, 0, "failed"]);
    for (const { text } of sql.calls) { safe(text); expect(text).not.toMatch(/OFFSET|SELECT \*/i); }
  });

  it("describeJob says whether a job covers the LATEST request: only done / no_owner with covered_gen >= requested_gen", () => {
    const row = (over) => ({ id: 1, network: "facebook", blocklist_id: 3, entry_type: "advertiser", advertiser_name: "A", status: "done", attempts: 1, requested_gen: 2, run_gen: 2, covered_gen: 2, state: JSON.stringify({ stats: { hashed: 4, failed: 0, skipped: { "no stored image": 1 } }, owners: { 1: { lastAdId: 50, done: true } } }), ...over });
    expect(describeJob(row())).toMatchObject({ coversLatest: true, coveredGen: 2, requestedGen: 2, entryType: "advertiser", stats: { hashed: 4 }, progress: { 1: { lastAdId: 50, done: true } } });
    expect(describeJob(row({ status: "no_owner" })).coversLatest).toBe(true);
    expect(describeJob(row({ covered_gen: 1 })).coversLatest).toBe(false);   // an older run only
    expect(describeJob(row({ requested_gen: 3, run_gen: 2 })).coversLatest).toBe(false); // blocked again while it was running
    for (const status of ["pending", "running", "failed", "limit_reached", "unresolved"]) expect(describeJob(row({ status })).coversLatest).toBe(false);
    expect(describeJob(row({ state: "{not json" })).stats).toBeNull();
  });

  describe("the jobs API", () => {
    const job = { id: 8, network: "facebook", blocklist_id: 3, entry_type: "url", advertiser_name: "shop.example.com/landing", status: "unresolved", requested_gen: 2, run_gen: 2, covered_gen: 1, state: null };
    const api = (over = {}) => {
      const repo = {
        listJobs: vi.fn(async (_sql, q) => (q.jobId === 404 ? [] : [job])),
        listJobResults: vi.fn(async () => [{ id: 11, platform_ad_id: "A21", internal_ad_id: "21", source_url: "fb/a.jpeg", outcome: "failed", reason: "unavailable: 503", sha256: null, updated_at: "2026-11-03 10:00:00" }]),
        requestRun: vi.fn(async () => true),
        resumeLimited: vi.fn(async () => ({ ok: true })),
        ...over,
      };
      return { api: createJobsApi({ jobRepository: repo, getSql: () => ({ fake: true }) }), repo };
    };

    it("lists jobs with their generations, and checks its input", async () => {
      const { api: a, repo } = api();
      const out = await a.list({ network: "Facebook", blocklistId: "3", status: "unresolved" });
      expect(out).toMatchObject({ ok: true, next: 8, items: [{ id: 8, entryType: "url", status: "unresolved", requestedGen: 2, coveredGen: 1, coversLatest: false }] });
      expect(repo.listJobs.mock.calls[0][1]).toMatchObject({ network: "facebook", blocklistId: "3", status: "unresolved" });
      for (const bad of [{ network: "bad net" }, { network: "facebook", jobId: "x" }, { network: "facebook", blocklistId: -1 }, { network: "facebook", status: "nope" }]) {
        expect((await a.list(bad)).ok).toBe(false);
      }
    });

    it("results default to the job's latest run, can ask for an older one, and tell the run apart", async () => {
      const { api: a, repo } = api();
      const latest = await a.results({ network: "facebook", jobId: "8" });
      expect(repo.listJobResults.mock.calls[0][1]).toMatchObject({ jobId: 8, generation: 2 });
      expect(latest).toMatchObject({ ok: true, generation: 2, latestGeneration: 2, items: [{ platformAdId: "A21", internalAdId: "21", outcome: "failed", reason: "unavailable: 503" }], next: 11 });
      const older = await a.results({ network: "facebook", jobId: 8, generation: "1", outcome: "failed" });
      expect(repo.listJobResults.mock.calls[1][1]).toMatchObject({ generation: 1, outcome: "failed" });
      expect(older).toMatchObject({ generation: 1, latestGeneration: 2 });
      expect((await a.results({ network: "facebook", jobId: 404 })).error).toBe("not_found");
      expect((await a.results({ network: "facebook", jobId: 8, outcome: "weird" })).error).toBe("invalid_outcome");
      expect((await a.results({ network: "facebook", jobId: 8, generation: "0" })).error).toBe("invalid_generation");
      expect((await a.results({ network: "facebook", jobId: "nope" })).error).toBe("invalid_id");
    });

    it("requeue: rerun asks for a new generation; resume only continues a limit_reached job; both check their input", async () => {
      const { api: a, repo } = api();
      expect(await a.requeue({ network: "facebook", blocklistId: 3, mode: "rerun" })).toEqual({ ok: true, mode: "rerun" });
      expect(repo.requestRun).toHaveBeenCalledWith({ fake: true }, "facebook", 3);
      expect(await a.requeue({ network: "facebook", blocklistId: "3", mode: "resume" })).toEqual({ ok: true, mode: "resume" });
      expect((await a.requeue({ network: "facebook", blocklistId: 3, mode: "again" })).error).toBe("invalid_mode");
      expect((await a.requeue({ network: "facebook", blocklistId: 0, mode: "rerun" })).error).toBe("invalid_id");
      expect((await a.requeue({ network: "facebook", blocklistId: 4294967295, mode: "rerun" })).error).toBe("invalid_id"); // the backfill cursor row
      const none = api({ requestRun: vi.fn(async () => false), resumeLimited: vi.fn(async () => ({ ok: false, reason: "not_limit_reached" })) }).api;
      expect((await none.requeue({ network: "facebook", blocklistId: 3, mode: "rerun" })).error).toBe("not_found");
      expect((await none.requeue({ network: "facebook", blocklistId: 3, mode: "resume" })).error).toBe("not_resumable");
    });
  });
});

describe("imagematch/worker > generations in the pass", () => {
  it("passes the entry, the generation and a results sink bound to this run to the job", async () => {
    const t = setup({ entries: [advertiser(1, "shop.example.com/landing", { entry_type: "url" })] });
    const claim = t.repo.claimNext;
    t.repo.claimNext = async (...a) => { const j = await claim(...a); return j && { ...j, run_gen: 4, entry_type: "url" }; };
    t.repo.findNewAdvertisers = async () => [{ id: 1, value: "shop.example.com/landing", complaint_id: null, entry_type: "url" }];
    const original = t.repo.createJobs;
    t.repo.createJobs = async (sql, network, list) => original(sql, network, list);
    t.repo.recordJobResults = vi.fn(async () => 2);
    await t.worker.tick();
    expect(t.runners[0].run.mock.calls[0][0]).toMatchObject({ entry: { type: "url", value: "shop.example.com/landing" }, generation: 4 });
    await t.makeJob.mock.calls[0][0].results.record([{ outcome: "hashed" }]);
    expect(t.repo.recordJobResults).toHaveBeenCalledWith({ fake: true }, [{ outcome: "hashed" }], { network: "facebook", jobId: 1, blocklistId: 1, generation: 4 });
  });

  it("an unresolved job is final (it is not retried) and keeps the reason", async () => {
    const t = setup({ script: () => ({ status: STATUS.UNRESOLVED, network: "facebook", message: "media URL: the ads cannot be searched" }) });
    const out = await t.worker.tick();
    expect(t.jobs[0]).toMatchObject({ status: "unresolved", last_error: "media URL: the ads cannot be searched" });
    expect(out.ran[0].outcome).toBe("unresolved");
    expect((await t.worker.tick()).ran).toHaveLength(0);
  });

  it("looks for re-blocked entries before it makes new jobs, and a failure of that never stops the jobs", async () => {
    const order = [];
    const t = setup();
    const find = t.repo.findNewAdvertisers;
    t.repo.findNewAdvertisers = async (...a) => { order.push("discover"); return find(...a); };
    t.repo.requestReblocked = vi.fn(async () => { order.push("reblocked"); return 1; });
    await t.worker.tick();
    expect(order).toEqual(["reblocked", "discover"]);

    const broken = setup();
    broken.repo.requestReblocked = vi.fn(async () => { throw new Error("no such column: requested_at"); });
    const out = await broken.worker.tick();
    expect(out.ran).toHaveLength(1);
  });
});

describe("the job routes (services/copyrightRequest.js)", () => {
  const expressLib = require("express");
  const { createRouter: makeRouter } = require("../../../src/services/copyrightRequest");

  async function serve(opts = {}) {
    const jobs = opts.jobs || {
      list: vi.fn(async () => ({ ok: true, items: [{ id: 8 }], next: 8 })),
      results: vi.fn(async () => ({ ok: true, job: { id: 8 }, generation: 2, latestGeneration: 2, items: [{ id: 11 }], next: 11 })),
      requeue: vi.fn(async (q) => ({ ok: true, mode: q.mode })),
    };
    const app = expressLib();
    app.use(expressLib.json());
    app.use("/c", makeRouter({ settings: { token: "s3cret", rateLimit: { windowMs: 60000, max: 100 }, ...(opts.settings || {}) }, submit: vi.fn(), review: {}, search: vi.fn(), jobs }));
    const server = await new Promise((resolve) => { const s2 = app.listen(0, "127.0.0.1", () => resolve(s2)); });
    const base = `http://127.0.0.1:${server.address().port}/c`;
    const call = (method, path, body, headers = { "x-copyright-token": "s3cret" }) => fetch(base + path, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { call, jobs, close: () => new Promise((r) => server.close(r)) };
  }
  const using = (opts, fn) => async () => { const t = await serve(opts); try { await fn(t); } finally { await t.close(); } };

  it("GET /jobs lists the jobs", using({}, async (t) => {
    const res = await t.call("GET", "/jobs?network=facebook&blocklistId=3&status=done&afterId=2&limit=10");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ code: 200, message: "ok", data: { items: [{ id: 8 }], next: 8 } });
    expect(t.jobs.list).toHaveBeenCalledWith({ network: "facebook", jobId: undefined, blocklistId: "3", status: "done", afterId: "2", limit: "10" });
  }));

  it("GET /jobs/:id/results gives the images of one run, with the generation", using({}, async (t) => {
    const res = await t.call("GET", "/jobs/8/results?network=facebook&generation=1&outcome=failed");
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ job: { id: 8 }, generation: 2, latestGeneration: 2, items: [{ id: 11 }], next: 11 });
    expect(t.jobs.results).toHaveBeenCalledWith({ network: "facebook", jobId: "8", generation: "1", outcome: "failed", afterId: undefined, limit: undefined });
  }));

  it("POST /jobs/requeue asks for a rerun or a resume", using({}, async (t) => {
    const res = await t.call("POST", "/jobs/requeue", { network: "facebook", blocklistId: 3, mode: "resume" });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ mode: "resume" });
    expect(t.jobs.requeue).toHaveBeenCalledWith({ network: "facebook", blocklistId: 3, mode: "resume" });
  }));

  it("maps the answers to statuses: 404 no such job, 409 not resumable, 400 bad input, 503 a failure", async () => {
    for (const [error, code] of [["not_found", 404], ["not_resumable", 409], ["invalid_mode", 400], ["failed", 503], ["no_database", 503]]) {
      const t = await serve({ jobs: { list: vi.fn(), results: vi.fn(), requeue: vi.fn(async () => ({ ok: false, error, message: `m ${error}` })) } });
      try {
        const res = await t.call("POST", "/jobs/requeue", { network: "facebook", blocklistId: 3, mode: "rerun" });
        expect(res.status).toBe(code);
        expect((await res.json()).message).toBe(`m ${error}`);
      } finally { await t.close(); }
    }
  });

  it("needs the token even where the advertiser route is knowingly open (allowPublic)", async () => {
    const open = await serve({ settings: { token: "", allowPublic: true } });
    try {
      for (const [m, p, b] of [["GET", "/jobs?network=facebook"], ["GET", "/jobs/8/results?network=facebook"], ["POST", "/jobs/requeue", { network: "facebook", blocklistId: 3, mode: "rerun" }]]) {
        expect((await open.call(m, p, b, {})).status).toBe(503);
      }
    } finally { await open.close(); }
    const t = await serve();
    try {
      for (const headers of [{}, { "x-copyright-token": "wrong" }]) {
        expect((await t.call("GET", "/jobs?network=facebook", undefined, headers)).status).toBe(401);
        expect((await t.call("GET", "/jobs/8/results?network=facebook", undefined, headers)).status).toBe(401);
        expect((await t.call("POST", "/jobs/requeue", { network: "facebook", blocklistId: 3, mode: "rerun" }, headers)).status).toBe(401);
      }
      expect(t.jobs.list).not.toHaveBeenCalled();
      expect(t.jobs.results).not.toHaveBeenCalled();
      expect(t.jobs.requeue).not.toHaveBeenCalled();
    } finally { await t.close(); }
  });
});

describe("submitAdvertiser > the same name blocked again", () => {
  const { createIntake } = require("../../../src/compliance/imagematch/worker");
  const COMPLAINT = "33333333-3333-4333-8333-333333333333";
  const build = (jobRepository) => createIntake({
    blocklist: { add: async () => ({ rejected: [], results: [{ network: "facebook", ok: true, entries: [{ blocklistId: 40 }] }] }) },
    sourcesModule: { SOURCES: { facebook: {} }, nameCandidates: () => ["twinkling tree"], findOwners: async () => [], sourceFor: () => ({}) },
    databaseManager: { getSQL: () => ({ fake: true }) },
    jobRepository,
  });

  it("asks at once for a new run of a finished job (the repository decides, by complaint id, whether it is a new block)", async () => {
    const order = [];
    const submit = build({
      createJobs: async () => { order.push("createJobs"); return { created: 0 }; },
      requestReblocked: vi.fn(async () => { order.push("requestReblocked"); return 1; }),
    });
    const out = await submit({ name: "Twinkling Tree", addedBy: "landing-form", complaintId: COMPLAINT });
    expect(out).toMatchObject({ ok: true, complaintId: COMPLAINT, hashing: [{ network: "facebook", queued: true }] });
    expect(order).toEqual(["createJobs", "requestReblocked"]);
  });

  it("a failure of that never turns the request into a failure", async () => {
    const submit = build({ createJobs: async () => ({ created: 0 }), requestReblocked: async () => { throw new Error("no such column: requested_at"); } });
    const out = await submit({ name: "Twinkling Tree", addedBy: "landing-form", complaintId: COMPLAINT });
    expect(out).toMatchObject({ ok: true, hashing: [{ network: "facebook", queued: true }] });
  });
});
