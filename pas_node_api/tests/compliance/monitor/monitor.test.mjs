import { describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const express = require("express");

const { createMonitorService, groupOf } = require("../../../src/compliance/monitor/monitor");
const { createClaimsRouter } = require("../../../src/services/copyrightClaimsRoutes");

const RUN = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPLAINT = "11111111-1111-4111-8111-111111111111";
const silent = { info() {}, warn() {}, error() {} };

/** A fake SQL: every query is recorded; `answer(text, params)` returns the rows (or throws). */
function fakeSql(answer) {
  const seen = [];
  return { seen, query: async (text, params = []) => { seen.push({ text: text.replace(/\s+/g, " ").trim(), params }); return answer(text, params, seen); } };
}
const noTable = () => Object.assign(new Error("Table doesn't exist"), { code: "ER_NO_SUCH_TABLE", errno: 1146 });

function service({ sqls, jobs, networks = Object.keys(sqls) } = {}) {
  return createMonitorService({ networks: () => networks, getSql: (n) => sqls[n] || null, jobs, log: silent });
}

describe("status groups", () => {
  it("groups B3's words and keeps an unknown word visible as 'other'", () => {
    expect(groupOf("succeeded")).toBe("done");
    expect(groupOf("FAILED")).toBe("failed");
    expect(groupOf("in_progress")).toBe("running");
    expect(groupOf("retrying")).toBe("pending");
    expect(groupOf("something_new")).toBe("other");
    expect(groupOf(null)).toBe("other");
  });
});

describe("overview", () => {
  const runsRows = [
    { mode: "execute", status: "succeeded", runs: 3, planned: 30, succeeded: 30, failed: 0, last_at: "2026-11-03 10:00:00" },
    { mode: "execute", status: "failed", runs: 1, planned: 10, succeeded: 4, failed: 6, last_at: "2026-11-04 09:00:00" },
    { mode: "execute", status: "running", runs: 1, planned: 20, succeeded: 5, failed: 0, last_at: "2026-11-04 11:00:00" },
    { mode: "dry_run", status: "succeeded", runs: 7, planned: 700, succeeded: 700, failed: 0, last_at: "2026-11-02 10:00:00" },
  ];
  const answer = (text) => (/copyright_takedown_runs/.test(text) ? runsRows : [{ status: "done", jobs: 4 }, { status: "pending", jobs: 2 }, { status: "failed", jobs: 1 }]);

  it("counts runs and steps per network; a dry run is never counted as deleted", async () => {
    const out = await service({ sqls: { facebook: fakeSql(answer) } }).overview();
    const fb = out.networks[0];
    expect(fb.takedown.runs).toMatchObject({ total: 5, byGroup: { done: 3, failed: 1, running: 1 } });
    expect(fb.takedown.items).toEqual({ planned: 60, deleted: 39, failed: 6, waiting: 15 });
    expect(fb.takedown.dryRuns).toEqual({ total: 7, byStatus: { succeeded: 7 } });
    expect(fb.takedown.lastRunAt).toBe("2026-11-04 11:00:00");
    expect(fb.hashJobs).toEqual({ available: true, total: 7, byStatus: { done: 4, pending: 2, failed: 1 } });
    expect(out.totals.items.deleted).toBe(39);
  });

  it("adds the networks up, and reads only the runs table (never the actions table)", async () => {
    const a = fakeSql(answer); const b = fakeSql(answer);
    const out = await service({ sqls: { facebook: a, instagram: b } }).overview();
    expect(out.totals.items).toEqual({ planned: 120, deleted: 78, failed: 12, waiting: 30 });
    expect(out.totals.hashJobs.total).toBe(14);
    for (const q of [...a.seen, ...b.seen]) {
      expect(q.text).not.toMatch(/copyright_takedown_actions/);
      expect(q.text).toMatch(/^SELECT /);
    }
  });

  it("reports a network whose tables do not exist as unavailable, not as zero, and still shows the others", async () => {
    const out = await service({ sqls: { facebook: fakeSql(answer), reddit: fakeSql(() => { throw noTable(); }) } }).overview();
    const reddit = out.networks.find((n) => n.network === "reddit");
    expect(reddit.takedown).toEqual({ available: false, reason: "no_table" });
    expect(reddit.hashJobs).toEqual({ available: false, reason: "no_table" });
    expect(out.totals.unavailable).toEqual([{ network: "reddit", what: "takedown", reason: "no_table" }, { network: "reddit", what: "hashJobs", reason: "no_table" }]);
    expect(out.totals.items.deleted).toBe(39);
  });

  it("a network without a database connection, and a failing query, are reported without any error text", async () => {
    const out = await service({ sqls: { facebook: fakeSql(() => { throw new Error("secret host db.internal refused"); }) }, networks: ["facebook", "quora"] }).overview();
    expect(out.networks[0].takedown).toEqual({ available: false, reason: "error" });
    expect(out.networks[1].takedown).toEqual({ available: false, reason: "no_database" });
    expect(JSON.stringify(out)).not.toMatch(/secret host/);
  });
});

describe("runs", () => {
  const row = (over = {}) => ({ run_id: RUN, network: "facebook", complaint_id: COMPLAINT, trigger_type: "complaint", mode: "execute", status: "failed", started_at: "2026-11-04 09:00:00", finished_at: null, items_planned: 10, items_succeeded: 4, items_failed: 6, operator: "anij", report_uri: null, proof_uri: null, details: "x".repeat(5000), created_at: "2026-11-04 09:00:00", ...over });

  it("lists one network newest first, with the filters as parameters (never in the text), and shortens long details", async () => {
    const sql = fakeSql(() => [row()]);
    const out = await service({ sqls: { facebook: sql } }).runs({ network: "facebook", status: "failed'; DROP TABLE x;--", mode: "execute", limit: "10" });
    expect(out.ok).toBe(true);
    expect(out.items[0]).toMatchObject({ runId: RUN, status: "failed", group: "failed", itemsFailed: 6 });
    expect(out.items[0].details.length).toBeLessThan(2100);
    const q = sql.seen[0];
    expect(q.text).toMatch(/WHERE network = \? AND status = \? AND mode = \? ORDER BY created_at DESC, run_id DESC LIMIT 10$/);
    expect(q.params).toEqual(["facebook", "failed'; DROP TABLE x;--", "execute"]);
    expect(q.text).not.toMatch(/DROP/);
  });

  it("pages with a cursor made from the last row; a bad cursor is refused", async () => {
    const rows = [row({ created_at: new Date(2026, 10, 4, 9, 30, 5) }), row({ run_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", created_at: new Date(2026, 10, 4, 9, 0, 0) })];
    const sql = fakeSql(() => rows);
    const first = await service({ sqls: { facebook: sql } }).runs({ network: "facebook", limit: "2" });
    expect(first.next).toBe("2026-11-04 09:00:00|bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    await service({ sqls: { facebook: sql } }).runs({ network: "facebook", limit: "2", cursor: first.next });
    expect(sql.seen[1].text).toMatch(/\(created_at < \? OR \(created_at = \? AND run_id < \?\)\)/);
    expect(sql.seen[1].params.slice(-3)).toEqual(["2026-11-04 09:00:00", "2026-11-04 09:00:00", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]);
    expect((await service({ sqls: { facebook: sql } }).runs({ network: "facebook", cursor: "nonsense" })).error).toBe("invalid_cursor");
  });

  it("finds a complaint's runs in every network, merged newest first", async () => {
    const a = fakeSql(() => [row({ created_at: "2026-11-04 09:00:00" })]);
    const b = fakeSql(() => [row({ network: "instagram", run_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", created_at: "2026-11-04 10:00:00" })]);
    const c = fakeSql(() => { throw noTable(); });
    const out = await service({ sqls: { facebook: a, instagram: b, reddit: c } }).runs({ complaintId: COMPLAINT });
    expect(out.items.map((r) => r.network)).toEqual(["instagram", "facebook"]);
    expect(out.unavailable).toEqual(["reddit"]);
  });

  it("refuses a missing network, an unknown network, a bad complaint id and a bad mode", async () => {
    const s = service({ sqls: { facebook: fakeSql(() => []) } });
    expect((await s.runs({})).error).toBe("invalid_network");
    expect((await s.runs({ network: "nope" })).error).toBe("invalid_network");
    expect((await s.runs({ network: "facebook", complaintId: "x" })).error).toBe("invalid_id");
    expect((await s.runs({ network: "facebook", mode: "delete" })).error).toBe("invalid_mode");
  });
});

describe("run logs and failures", () => {
  const action = (id, over = {}) => ({ id, run_id: RUN, network: "facebook", target_type: "ad", target_id: `ad${id}`, internal_ad_id: String(id), target_value: null, target_url: null, system: "sql", operation: "delete", status: "succeeded", error_message: null, details: null, attempts: 1, proof_uri: null, next_retry_at: null, started_at: "2026-11-04 09:00:00", finished_at: "2026-11-04 09:00:01", created_at: "2026-11-04 09:00:00", ...over });
  const runRow = { run_id: RUN, network: "facebook", complaint_id: COMPLAINT, trigger_type: "complaint", mode: "execute", status: "failed", started_at: "2026-11-04 09:00:00", finished_at: null, items_planned: 3, items_succeeded: 2, items_failed: 1, operator: "anij", report_uri: null, proof_uri: null, details: null, created_at: "2026-11-04 09:00:00" };

  function logsSql() {
    return fakeSql((text) => {
      if (/FROM copyright_takedown_runs/.test(text)) return [runRow];
      if (/GROUP BY system, status/.test(text)) return [{ system: "sql", status: "succeeded", steps: 2 }, { system: "elastic", status: "failed", steps: 1 }];
      return [action(1), action(2), action(3, { system: "elastic", status: "failed", error_message: "timeout", attempts: 3, next_retry_at: "2026-11-04 12:00:00" })];
    });
  }

  it("gives the run, the step counts by system and status, and every step with its error", async () => {
    const sql = logsSql();
    const out = await service({ sqls: { facebook: sql } }).runLogs({ network: "facebook", runId: RUN, limit: "3" });
    expect(out.run).toMatchObject({ runId: RUN, status: "failed", itemsFailed: 1 });
    expect(out.steps.byGroup).toEqual({ done: 2, failed: 1 });
    expect(out.steps.bySystem.elastic).toEqual({ total: 1, byStatus: { failed: 1 } });
    expect(out.items[2]).toMatchObject({ id: 3, system: "elastic", status: "failed", group: "failed", errorMessage: "timeout", attempts: 3, nextRetryAt: "2026-11-04 12:00:00" });
    expect(out.next).toBe(3);
    // reads the steps by run id (the run's index), by id order, with a limit
    expect(sql.seen[2].text).toMatch(/FROM copyright_takedown_actions WHERE run_id = \? AND network = \? AND id > \? ORDER BY id LIMIT 3$/);
  });

  it("filters the steps by status and system through parameters", async () => {
    const sql = logsSql();
    await service({ sqls: { facebook: sql } }).runLogs({ network: "facebook", runId: RUN, status: "failed", system: "elastic", afterId: "7" });
    expect(sql.seen[2].params).toEqual([RUN, "facebook", 7, "failed", "elastic"]);
  });

  it("answers not_found for an unknown run and no_table when B3's tables are missing; validates its input", async () => {
    const none = service({ sqls: { facebook: fakeSql((t) => (/copyright_takedown_runs/.test(t) ? [] : [])) } });
    expect((await none.runLogs({ network: "facebook", runId: RUN })).error).toBe("not_found");
    const missing = service({ sqls: { facebook: fakeSql(() => { throw noTable(); }) } });
    expect((await missing.runLogs({ network: "facebook", runId: RUN })).error).toBe("no_table");
    expect((await none.runLogs({ network: "facebook", runId: "x" })).error).toBe("invalid_id");
    expect((await none.runLogs({ network: "../x", runId: RUN })).error).toBe("invalid_network");
  });

  it("failures: the newest failed steps by status, newest first, with a cursor, using only the failed words as parameters", async () => {
    const sql = fakeSql(() => [action(9, { status: "failed", error_message: "boom" }), action(8, { status: "error" })]);
    const out = await service({ sqls: { facebook: sql } }).failures({ network: "facebook", beforeId: "20", limit: "2" });
    expect(out.items.map((i) => i.id)).toEqual([9, 8]);
    expect(out.items[0].runId).toBe(RUN);
    expect(out.next).toBe(8);
    expect(sql.seen[0].text).toMatch(/WHERE status IN \(\?, \?, \?, \?\) AND network = \? AND id < \? ORDER BY id DESC LIMIT 2$/);
    expect(sql.seen[0].params.slice(-2)).toEqual(["facebook", 20]);
  });
});

describe("hash jobs", () => {
  it("passes the hash worker's own answers through, for known networks only", async () => {
    const jobs = { list: vi.fn(async () => ({ ok: true, items: [{ id: 1, status: "done" }], next: 1 })), results: vi.fn(async () => ({ ok: true, items: [], next: null })) };
    const s = service({ sqls: { facebook: fakeSql(() => []) }, jobs });
    expect((await s.hashJobs({ network: "facebook", status: "failed" })).items[0].id).toBe(1);
    expect(jobs.list).toHaveBeenCalledWith({ network: "facebook", status: "failed", afterId: undefined, limit: 50 });
    await s.hashJobResults({ network: "facebook", jobId: "5", outcome: "failed" });
    expect(jobs.results).toHaveBeenCalledWith(expect.objectContaining({ network: "facebook", jobId: "5", outcome: "failed", limit: 200 }));
    expect((await s.hashJobs({ network: "nope" })).error).toBe("invalid_network");
    expect((await service({ sqls: { facebook: fakeSql(() => []) } }).hashJobs({ network: "facebook" })).error).toBe("not_configured");
  });
});

describe("the service never writes", () => {
  it("every query it sends is a SELECT", async () => {
    const sql = fakeSql((t) => (/runs/.test(t) ? [] : []));
    const s = service({ sqls: { facebook: sql }, jobs: { list: async () => ({ ok: true, items: [] }), results: async () => ({ ok: true, items: [] }) } });
    await s.overview(); await s.runs({ network: "facebook" }); await s.runLogs({ network: "facebook", runId: RUN }); await s.failures({ network: "facebook" });
    expect(sql.seen.length).toBeGreaterThan(4);
    for (const q of sql.seen) expect(q.text).toMatch(/^SELECT /);
  });
});

describe("routes", () => {
  const ADMIN = "admin-secret";
  async function serve(monitor) {
    const router = createClaimsRouter({
      settings: { adminToken: ADMIN, statusSecret: "s", homeNetwork: "facebook" },
      requestSettings: { token: "site-secret", rateLimit: { windowMs: 60000, max: 500 } },
      claims: {}, attachments: null, monitor,
    });
    const app = express();
    app.use("/c", router);
    const server = await new Promise((resolve) => { const s = app.listen(0, "127.0.0.1", () => resolve(s)); });
    const base = `http://127.0.0.1:${server.address().port}/c`;
    return { get: (path, headers = { "x-copyright-admin-token": ADMIN }) => fetch(base + path, { headers }), send: (method, path) => fetch(base + path, { method, headers: { "x-copyright-admin-token": ADMIN } }), close: () => new Promise((r) => server.close(r)) };
  }
  const fakeMonitor = (over = {}) => ({
    overview: vi.fn(async () => ({ ok: true, networks: [], totals: { items: { deleted: 1 } }, groups: {} })),
    runs: vi.fn(async () => ({ ok: true, items: [], unavailable: [], next: null })),
    runLogs: vi.fn(async () => ({ ok: true, run: {}, steps: {}, items: [], next: null })),
    failures: vi.fn(async () => ({ ok: true, items: [], next: null })),
    hashJobs: vi.fn(async () => ({ ok: true, items: [], next: null })),
    hashJobResults: vi.fn(async () => ({ ok: true, items: [], next: null })),
    ...over,
  });

  it("needs the admin token (not the WordPress token), and passes the query on", async () => {
    const monitor = fakeMonitor();
    const t = await serve(monitor);
    try {
      expect((await t.get("/admin/monitor/overview", {})).status).toBe(401);
      expect((await t.get("/admin/monitor/overview", { "x-copyright-token": "site-secret" })).status).toBe(401);
      const ok = await t.get("/admin/monitor/overview");
      expect(ok.status).toBe(200);
      expect((await ok.json()).data.totals.items.deleted).toBe(1);
      await t.get("/admin/monitor/runs?network=facebook&status=failed&limit=5");
      expect(monitor.runs).toHaveBeenCalledWith({ network: "facebook", complaintId: undefined, status: "failed", mode: undefined, cursor: undefined, limit: "5" });
      await t.get(`/admin/monitor/runs/${RUN}/logs?network=facebook&afterId=4`);
      expect(monitor.runLogs).toHaveBeenCalledWith(expect.objectContaining({ network: "facebook", runId: RUN, afterId: "4" }));
      await t.get("/admin/monitor/hash-jobs/12/results?network=facebook&outcome=failed");
      expect(monitor.hashJobResults).toHaveBeenCalledWith(expect.objectContaining({ jobId: "12", outcome: "failed" }));
    } finally { await t.close(); }
  });

  it("maps the service's errors to codes without internal detail", async () => {
    const t = await serve(fakeMonitor({
      runs: vi.fn(async () => ({ ok: false, error: "invalid_network", message: "give a network" })),
      runLogs: vi.fn(async () => ({ ok: false, error: "not_found", message: "no such run" })),
      failures: vi.fn(async () => ({ ok: false, error: "no_table", message: "the takedown tables do not exist in that database yet" })),
    }));
    try {
      expect((await t.get("/admin/monitor/runs")).status).toBe(400);
      expect((await t.get(`/admin/monitor/runs/${RUN}/logs?network=facebook`)).status).toBe(404);
      expect((await t.get("/admin/monitor/failures?network=facebook")).status).toBe(503);
    } finally { await t.close(); }
  });

  it("has no route that changes anything: POST, PUT, PATCH and DELETE on the monitor are all 404", async () => {
    const monitor = fakeMonitor();
    const t = await serve(monitor);
    try {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        for (const path of ["/admin/monitor/overview", "/admin/monitor/runs", `/admin/monitor/runs/${RUN}/logs?network=facebook`]) {
          expect((await t.send(method, path)).status).toBe(404);
        }
      }
      expect(monitor.overview).not.toHaveBeenCalled();
    } finally { await t.close(); }
  });
});
