import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── Mock logger (silence) ────────────────────────────────────────────────────
const loggerPath = require.resolve("../../utils/logger");
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
};

// ── Mock mongoose so mongoose.connection.db.collection(name) is controllable ──
const mongoosePath = require.resolve("mongoose");
const cols = {};
const dbObj = { collection: vi.fn((name) => cols[name] || mkCol()) };
const mongooseMock = { connection: { db: dbObj } };
require.cache[mongoosePath] = {
  id: mongoosePath, filename: mongoosePath, loaded: true, exports: mongooseMock,
};

// A chainable cursor that satisfies find().sort().skip().limit().toArray()
// AND find().sort().toArray().
function cursor(data) {
  const c = {
    sort: () => c,
    skip: () => c,
    limit: () => c,
    toArray: () => Promise.resolve(data),
  };
  return c;
}
// aggregate() that returns queued results per call (then [] forever).
function aggQueue(...results) {
  const fn = vi.fn();
  results.forEach((r) => fn.mockReturnValueOnce({ toArray: () => Promise.resolve(r) }));
  fn.mockReturnValue({ toArray: () => Promise.resolve([]) });
  return fn;
}
function mkCol(opts = {}) {
  return {
    aggregate: opts.aggregate || aggQueue(),
    find: vi.fn(() => cursor(opts.find || [])),
    countDocuments: vi.fn(() => Promise.resolve(opts.count ?? 0)),
    findOne: vi.fn(() => Promise.resolve(opts.findOne ?? null)),
  };
}
function setCol(name, col) { cols[name] = col; }

const ea = require("../../src/email-analytics");

function mockReq(query = {}, params = {}) { return { query, params }; }
function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

beforeEach(() => {
  for (const k of Object.keys(cols)) delete cols[k];
  dbObj.collection.mockClear();
});

const LOG = "email_send_log";
const EVT = "email_send_events";

describe("email-analytics > summary", () => {
  it("happy path: aggregates per type + total, unsubscribes, clicks, rates", async () => {
    setCol(LOG, {
      aggregate: aggQueue(
        [
          { _id: { mail_type: "competitorUpdate", status: "delivered" }, c: 8 },
          { _id: { mail_type: "competitorUpdate", status: "opened" }, c: 2 },
          { _id: { mail_type: "dataReport", status: "bounced" }, c: 1 },
          { _id: { mail_type: "dataReport", status: "sent" }, c: 5 },
          { _id: { mail_type: "unknownType", status: "sent" }, c: 99 }, // ignored (not in byType)
        ],
        [
          { _id: "competitorUpdate", emails: 3, clicks: 7 },
          { _id: "weird", emails: 1, clicks: 1 }, // not in byType → only total
        ],
      ),
      find: vi.fn(() => cursor([])),
      countDocuments: vi.fn(() => Promise.resolve(0)),
      findOne: vi.fn(() => Promise.resolve(null)),
    });
    setCol(EVT, mkCol({ count: 4 })); // unsubscribe events
    const req = mockReq({ mail_type: "competitorUpdate", days: "30", fresh: "true" });
    const res = mockRes();
    await ea.summary(req, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0].body;
    expect(body.byType.competitorUpdate.delivered).toBe(8);
    expect(body.byType.competitorUpdate.unsubscribed).toBe(4);
    expect(body.byType.competitorUpdate.clicked).toBe(3);
    expect(body.total.clicks).toBe(8); // 7 + 1
    expect(body.byType.competitorUpdate.accepted).toBeGreaterThan(0);
    expect(body.byType.competitorUpdate.deliveryRate).toBeGreaterThan(0);
  });

  it("date range window (startDate + date-only endDate) + invalid mail_type", async () => {
    setCol(LOG, mkCol({ aggregate: aggQueue([], []), count: 0 }));
    setCol(EVT, mkCol({ count: 0 }));
    const req = mockReq({ mail_type: "nope", startDate: "2025-01-01", endDate: "2025-01-31" });
    const res = mockRes();
    await ea.summary(req, res);
    const body = res.json.mock.calls[0][0].body;
    expect(body.window.key).toContain("r:");
    // accepted=0 → rates default to 0 (withRates else branch)
    expect(body.total.deliveryRate).toBe(0);
    expect(body.total.bounceRate).toBe(0);
  });

  it("cache hit on second call (no bypass)", async () => {
    const agg = aggQueue([], []);
    setCol(LOG, { aggregate: agg, find: vi.fn(() => cursor([])), countDocuments: vi.fn(() => Promise.resolve(0)), findOne: vi.fn() });
    setCol(EVT, mkCol({ count: 0 }));
    const req = mockReq({ days: "7" }); // no fresh → cacheable
    await ea.summary(req, mockRes());
    const callsAfterFirst = agg.mock.calls.length;
    await ea.summary(mockReq({ days: "7" }), mockRes()); // same key → cache hit
    expect(agg.mock.calls.length).toBe(callsAfterFirst); // not re-aggregated
  });

  it("error → 500", async () => {
    setCol(LOG, {
      aggregate: vi.fn(() => ({ toArray: () => Promise.reject(new Error("boom")) })),
      find: vi.fn(() => cursor([])), countDocuments: vi.fn(), findOne: vi.fn(),
    });
    const res = mockRes();
    await ea.summary(mockReq({ fresh: "true" }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("no params → default days window (windowFrom `|| 30`, days-path key)", async () => {
    setCol(LOG, mkCol({ aggregate: aggQueue([], []), count: 0 }));
    setCol(EVT, mkCol({ count: 0 }));
    const res = mockRes();
    await ea.summary(mockReq({ fresh: "true" }), res); // no days, no range
    expect(res.json.mock.calls[0][0].body.window.key).toBe("d:30");
  });

  it("startDate only (endDate absent) range window", async () => {
    setCol(LOG, mkCol({ aggregate: aggQueue([], []), count: 0 }));
    setCol(EVT, mkCol({ count: 0 }));
    const res = mockRes();
    await ea.summary(mockReq({ startDate: "2025-02-01", fresh: "true" }), res);
    expect(res.json.mock.calls[0][0].body.window.createdAt.$gte).toBeInstanceOf(Date);
  });

  it("endDate only + datetime endDate (no whole-day bump)", async () => {
    setCol(LOG, mkCol({ aggregate: aggQueue([], []), count: 0 }));
    setCol(EVT, mkCol({ count: 0 }));
    const res = mockRes();
    await ea.summary(mockReq({ endDate: "2025-02-28T08:00:00", fresh: "true" }), res);
    const ca = res.json.mock.calls[0][0].body.window.createdAt;
    expect(ca.$lte).toBeInstanceOf(Date);
    expect(ca.$gte).toBeUndefined();
  });

  it("status row with an unknown status is ignored for total too (st-in-total false)", async () => {
    setCol(LOG, {
      aggregate: aggQueue(
        [{ _id: { mail_type: "competitorUpdate", status: "weirdstatus" }, c: 3 }],
        [],
      ),
      find: vi.fn(() => cursor([])), countDocuments: vi.fn(() => Promise.resolve(0)), findOne: vi.fn(),
    });
    setCol(EVT, mkCol({ count: 0 }));
    const res = mockRes();
    await ea.summary(mockReq({ fresh: "true" }), res);
    // weirdstatus is neither in byType skeleton nor total → both stay 0
    expect(res.json.mock.calls[0][0].body.total.sent).toBe(0);
  });
});

describe("email-analytics > log", () => {
  it("regular log: filters mail_type/status/search/hasClicks=true/date range", async () => {
    const col = mkCol({ find: [{ send_id: "s1", to: "a@b.c" }], count: 1 });
    setCol(LOG, col);
    const req = mockReq({
      page: "2", limit: "5", mail_type: "dataReport", status: "delivered",
      search: " foo ", hasClicks: "true", startDate: "2025-01-01", endDate: "2025-01-31",
    });
    const res = mockRes();
    await ea.log(req, res);
    const body = res.json.mock.calls[0][0].body;
    expect(body.data.length).toBe(1);
    expect(body.page).toBe(2);
    const q = col.find.mock.calls[0][0];
    expect(q.mail_type).toBe("dataReport");
    expect(q.status).toBe("delivered");
    expect(q.click_count).toEqual({ $gt: 0 });
    expect(q.to).toBeInstanceOf(RegExp);
  });

  it("hasClicks=false branch + datetime endDate (no whole-day bump)", async () => {
    const col = mkCol({ find: [], count: 0 });
    setCol(LOG, col);
    const req = mockReq({ hasClicks: "false", endDate: "2025-01-31T10:00:00" });
    await ea.log(req, mockRes());
    const q = col.find.mock.calls[0][0];
    expect(q.click_count).toEqual({ $not: { $gt: 0 } });
  });

  it("limit clamps to 200, page floors to 1", async () => {
    const col = mkCol({ find: [], count: 0 });
    setCol(LOG, col);
    const res = mockRes();
    await ea.log(mockReq({ page: "-3", limit: "9999" }), res);
    const body = res.json.mock.calls[0][0].body;
    expect(body.page).toBe(1);
    expect(body.limit).toBe(200);
  });

  it("status=unsubscribed → events path with search + date range, maps rows", async () => {
    setCol(EVT, {
      find: vi.fn(() => cursor([
        { send_id: "x1", email: "u@e.c", mail_type: null, event_ts: "t1", createdAt: "c1", reason: "why", sg_message_id: "m1", event_type: "unsubscribe" },
        { event_id: "ev2", email: "v@e.c", event_ts: "t2", event_type: "group_unsubscribe" }, // fallbacks
      ])),
      countDocuments: vi.fn(() => Promise.resolve(2)),
      aggregate: aggQueue(), findOne: vi.fn(),
    });
    const req = mockReq({ status: "unsubscribed", search: "u", startDate: "2025-01-01", endDate: "2025-01-31" });
    const res = mockRes();
    await ea.log(req, res);
    const body = res.json.mock.calls[0][0].body;
    expect(body.data[0]).toMatchObject({ send_id: "x1", to: "u@e.c", status: "unsubscribed", failure_reason: "why", sendgrid_message_id: "m1" });
    expect(body.data[1]).toMatchObject({ send_id: "ev2", failure_reason: "group unsubscribe", sendgrid_message_id: null });
    expect(body.totalRecords).toBe(2);
  });

  it("error → 500", async () => {
    setCol(LOG, { find: vi.fn(() => { throw new Error("x"); }), countDocuments: vi.fn(), aggregate: aggQueue(), findOne: vi.fn() });
    const res = mockRes();
    await ea.log(mockReq({}), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("regular log with no filters at all (all filter branches false)", async () => {
    const col = mkCol({ find: [], count: 0 });
    setCol(LOG, col);
    await ea.log(mockReq({}), mockRes());
    expect(col.find.mock.calls[0][0]).toEqual({}); // empty query — no filters applied
  });

  it("unsubscribe path with no search/dates + datetime endDate + plain unsubscribe reason fallback", async () => {
    setCol(EVT, {
      find: vi.fn(() => cursor([
        { send_id: "p1", email: "p@e.c", event_ts: "t", event_type: "unsubscribe" }, // no reason, not group → "unsubscribe"
      ])),
      countDocuments: vi.fn(() => Promise.resolve(1)),
      aggregate: aggQueue(), findOne: vi.fn(),
    });
    // no search, no startDate; only a datetime endDate (covers L165 true + L167 datetime-false)
    const res = mockRes();
    await ea.log(mockReq({ status: "unsubscribed", endDate: "2025-01-31T12:00:00" }), res);
    expect(res.json.mock.calls[0][0].body.data[0].failure_reason).toBe("unsubscribe");
  });

  it("unsubscribe path with no filters whatsoever", async () => {
    setCol(EVT, { find: vi.fn(() => cursor([])), countDocuments: vi.fn(() => Promise.resolve(0)), aggregate: aggQueue(), findOne: vi.fn() });
    const res = mockRes();
    await ea.log(mockReq({ status: "unsubscribed" }), res);
    expect(res.json.mock.calls[0][0].body.totalRecords).toBe(0);
  });

  it("unsubscribe path with startDate only (endDate-absent branch)", async () => {
    const col = { find: vi.fn(() => cursor([])), countDocuments: vi.fn(() => Promise.resolve(0)), aggregate: aggQueue(), findOne: vi.fn() };
    setCol(EVT, col);
    await ea.log(mockReq({ status: "unsubscribed", startDate: "2025-01-01" }), mockRes());
    expect(col.find.mock.calls[0][0].createdAt.$gte).toBeInstanceOf(Date);
    expect(col.find.mock.calls[0][0].createdAt.$lte).toBeUndefined();
  });

  it("regular log with startDate only (endDate-absent branch)", async () => {
    const col = mkCol({ find: [], count: 0 });
    setCol(LOG, col);
    await ea.log(mockReq({ startDate: "2025-01-01" }), mockRes());
    expect(col.find.mock.calls[0][0].createdAt.$lte).toBeUndefined();
  });
});

describe("email-analytics > detail", () => {
  it("found → returns log + events", async () => {
    setCol(LOG, mkCol({ findOne: { send_id: "s1" } }));
    setCol(EVT, mkCol({ find: [{ event_type: "delivered" }] }));
    const res = mockRes();
    await ea.detail(mockReq({}, { send_id: "s1" }), res);
    const body = res.json.mock.calls[0][0].body;
    expect(body.log.send_id).toBe("s1");
    expect(body.events.length).toBe(1);
  });
  it("not found → 404", async () => {
    setCol(LOG, mkCol({ findOne: null }));
    const res = mockRes();
    await ea.detail(mockReq({}, { send_id: "nope" }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
  it("error → 500", async () => {
    setCol(LOG, { findOne: vi.fn(() => Promise.reject(new Error("e"))), aggregate: aggQueue(), find: vi.fn(), countDocuments: vi.fn() });
    const res = mockRes();
    await ea.detail(mockReq({}, { send_id: "s1" }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("email-analytics > calendar", () => {
  it("builds per-day status map (mail_type set, fresh)", async () => {
    setCol(LOG, mkCol({
      aggregate: aggQueue([
        { _id: { d: "2025-01-02", status: "delivered" }, c: 3 },
        { _id: { d: "2025-01-02", status: "bounced" }, c: 1 },
        { _id: { d: "2025-01-01", status: "weirdstatus" }, c: 9 }, // status not in map skeleton → only total
      ]),
    }));
    const res = mockRes();
    await ea.calendar(mockReq({ mail_type: "dataReport", days: "15", fresh: "true" }), res);
    const body = res.json.mock.calls[0][0].body;
    const day2 = body.daysData.find((d) => d.date === "2025-01-02");
    expect(day2.delivered).toBe(3);
    expect(day2.bounced).toBe(1);
    const day1 = body.daysData.find((d) => d.date === "2025-01-01");
    expect(day1.total).toBe(9); // weirdstatus folded into total only
  });
  it("no mail_type → match without mail_type (mt-false branch)", async () => {
    const agg = aggQueue([]);
    setCol(LOG, { aggregate: agg, find: vi.fn(), countDocuments: vi.fn(), findOne: vi.fn() });
    const res = mockRes();
    await ea.calendar(mockReq({ days: "5", fresh: "true", mail_type: "zzz" }), res); // invalid → mt=""
    expect(res.status).toHaveBeenCalledWith(200);
    expect(agg.mock.calls[0][0][0].$match.mail_type).toBeUndefined();
  });
  it("error → 500", async () => {
    setCol(LOG, { aggregate: vi.fn(() => ({ toArray: () => Promise.reject(new Error("c")) })), find: vi.fn(), countDocuments: vi.fn(), findOne: vi.fn() });
    const res = mockRes();
    await ea.calendar(mockReq({ fresh: "true" }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("email-analytics > breakdown", () => {
  it("returns top reasons (mail_type set)", async () => {
    setCol(LOG, mkCol({
      aggregate: aggQueue([
        { _id: { status: "failed", reason: "smtp" }, c: 5 },
        { _id: { status: "bounced", reason: "blocked" }, c: 2 },
      ]),
    }));
    const res = mockRes();
    await ea.breakdown(mockReq({ mail_type: "competitorUpdate", days: "30", fresh: "true" }), res);
    const body = res.json.mock.calls[0][0].body;
    expect(body.reasons[0]).toEqual({ status: "failed", reason: "smtp", count: 5 });
  });
  it("no mail_type → match without mail_type (mt-false branch)", async () => {
    setCol(LOG, mkCol({ aggregate: aggQueue([]) }));
    const res = mockRes();
    await ea.breakdown(mockReq({ days: "5", fresh: "true" }), res); // no mail_type
    expect(res.status).toHaveBeenCalledWith(200);
  });
  it("error → 500", async () => {
    setCol(LOG, { aggregate: vi.fn(() => ({ toArray: () => Promise.reject(new Error("b")) })), find: vi.fn(), countDocuments: vi.fn(), findOne: vi.fn() });
    const res = mockRes();
    await ea.breakdown(mockReq({ fresh: "true" }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("email-analytics > runStatus", () => {
  it("run doc present → uses its total/status/timestamps", async () => {
    setCol("email_run_status", mkCol({ findOne: { total: 100, status: "running", startedAt: "s", completedAt: null } }));
    setCol(LOG, mkCol({ count: 40 }));
    const res = mockRes();
    await ea.runStatus(mockReq({ mail_type: "dataReport" }), res);
    const body = res.json.mock.calls[0][0].body;
    expect(body.total).toBe(100);
    expect(body.status).toBe("running");
    expect(body.percent).toBe(40);
    expect(body.startedAt).toBe("s");
  });
  it("no run doc + queued present → fallback total + 'running' status", async () => {
    setCol("email_run_status", mkCol({ findOne: null }));
    // processed=10, processing=5 → total 15, status running
    const logc = { aggregate: aggQueue(), find: vi.fn(), findOne: vi.fn(), countDocuments: vi.fn() };
    logc.countDocuments.mockResolvedValueOnce(10).mockResolvedValueOnce(5);
    setCol(LOG, logc);
    const res = mockRes();
    await ea.runStatus(mockReq({ mail_type: "dataReport" }), res);
    const body = res.json.mock.calls[0][0].body;
    expect(body.total).toBe(15);
    expect(body.status).toBe("running");
    expect(body.processed).toBe(10);
  });
  it("no run doc + nothing queued → idle + percent 0", async () => {
    setCol("email_run_status", mkCol({ findOne: null }));
    const logc = { aggregate: aggQueue(), find: vi.fn(), findOne: vi.fn(), countDocuments: vi.fn() };
    logc.countDocuments.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
    setCol(LOG, logc);
    const res = mockRes();
    await ea.runStatus(mockReq({ mail_type: "badtype" }), res); // invalid → defaults to dataReport
    const body = res.json.mock.calls[0][0].body;
    expect(body.status).toBe("idle");
    expect(body.percent).toBe(0);
    expect(body.mail_type).toBe("dataReport");
  });
  it("error → 500", async () => {
    setCol("email_run_status", { findOne: vi.fn(() => Promise.reject(new Error("r"))), aggregate: aggQueue(), find: vi.fn(), countDocuments: vi.fn() });
    const res = mockRes();
    await ea.runStatus(mockReq({}), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
