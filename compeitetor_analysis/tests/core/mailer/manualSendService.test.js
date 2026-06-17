import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  userFindOne: vi.fn(),
  reqFind: vi.fn(), reqBulkWrite: vi.fn(), reqUpdateMany: vi.fn(),
  compFind: vi.fn(), compBulkWrite: vi.fn(), compUpdateMany: vi.fn(),
  activeCompetitorContacts: vi.fn(),
  sendDataReport: vi.fn(),
  isBlacklisted: vi.fn(),
  newSendId: vi.fn(() => "sid"),
  logSend: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("../../../resources/logs/logger.log.js", () => ({ default: { error: h.loggerError, info: vi.fn(), warn: vi.fn() } }));
vi.mock("../../../models/user_details.js", () => ({ default: { findOne: h.userFindOne } }));
vi.mock("../../../models/competitors_request.js", () => ({ default: { find: h.reqFind, bulkWrite: h.reqBulkWrite, updateMany: h.reqUpdateMany } }));
vi.mock("../../../models/competitors.js", () => ({ default: { find: h.compFind, bulkWrite: h.compBulkWrite, updateMany: h.compUpdateMany } }));
vi.mock("../../../core/Competitors/monitorService.js", () => ({ default: { activeCompetitorContacts: h.activeCompetitorContacts } }));
vi.mock("../../../core/mailer/dataReportEmailService.js", () => ({ default: { sendDataReport: h.sendDataReport } }));
vi.mock("../../../core/mailer/bounceGuard.js", () => ({ isBlacklisted: h.isBlacklisted, BLACKLISTED_SKIP_REASON: "bounced-skip" }));
vi.mock("../../../core/mailer/emailAudit.js", () => ({ newSendId: h.newSendId, logSend: h.logSend }));

const lean = (v) => ({ lean: () => Promise.resolve(v) });

let svc;
beforeEach(async () => {
  for (const k of Object.keys(h)) if (typeof h[k]?.mockReset === "function") h[k].mockReset();
  h.newSendId.mockReturnValue("sid");
  h.isBlacklisted.mockResolvedValue(false);
  h.compFind.mockReturnValue(lean([{ _id: "c1", facebook_status: 1 }]));
  h.reqBulkWrite.mockResolvedValue({});
  h.compBulkWrite.mockResolvedValue({});
  h.reqUpdateMany.mockResolvedValue({});
  h.compUpdateMany.mockResolvedValue({});
  vi.resetModules();
  svc = await import("../../../core/mailer/manualSendService.js");
});

describe("manualSendService > sendCompetitorMailForEmail", () => {
  it("empty/falsy email → findUserByEmail returns null → user_not_found (no query)", async () => {
    const out = await svc.sendCompetitorMailForEmail("");
    expect(out.code).toBe("user_not_found");
    expect(h.userFindOne).not.toHaveBeenCalled();
  });

  it("snapshotState throws before assignment → finally restoreState(null) is a no-op", async () => {
    h.userFindOne.mockResolvedValueOnce({ _id: "u1", email: "a@b.c" });
    h.reqFind.mockReturnValue(lean([{ _id: "r1", monitoring: ["c1"], email_status: 0 }]));
    h.compFind.mockImplementation(() => { throw new Error("snap boom"); });
    const out = await svc.sendCompetitorMailForEmail("a@b.c");
    expect(out.code).toBe("send_failed");
    // restoreState(null) returns early (snapshot never assigned) → no bulkWrite
    expect(h.compBulkWrite).not.toHaveBeenCalled();
  });

  it("restore applies `?? 0` fallbacks for null statuses + null email_status", async () => {
    h.userFindOne.mockResolvedValueOnce({ _id: "u1", email: "a@b.c" });
    h.reqFind.mockReturnValue(lean([{ _id: "r1", monitoring: ["c1"], email_status: null }]));
    // snapshot comp doc with ALL statuses null → restore uses `?? 0` on every field
    h.compFind.mockReturnValue(lean([{ _id: "c1", facebook_status: null, instagram_status: null, google_status: null, youtube_status: null }]));
    h.activeCompetitorContacts.mockImplementation(async (req, res) => { res.send({ body: { data: [{ email: "a@b.c", mailStatus: "sent" }] } }); });
    const out = await svc.sendCompetitorMailForEmail("a@b.c");
    expect(out.ok).toBe(true);
    const compUpdate = h.compBulkWrite.mock.calls[0][0][0].updateOne.update.$set;
    expect(compUpdate.facebook_status).toBe(0); // null ?? 0
    const reqUpdate = h.reqBulkWrite.mock.calls[0][0][0].updateOne.update.$set;
    expect(reqUpdate.email_status).toBe(0); // null ?? 0
  });

  it("user not found (exact + regex both null) → user_not_found", async () => {
    h.userFindOne.mockResolvedValue(null);
    const out = await svc.sendCompetitorMailForEmail("x@y.z");
    expect(out).toEqual({ ok: false, code: "user_not_found", error: "user not found in db" });
    expect(h.userFindOne).toHaveBeenCalledTimes(2); // exact then regex
  });

  it("blacklisted → logs skipped + returns blacklisted", async () => {
    h.userFindOne.mockResolvedValueOnce({ _id: "u1", email: "a@b.c", userName: "Al" });
    h.isBlacklisted.mockResolvedValue(true);
    const out = await svc.sendCompetitorMailForEmail("a@b.c");
    expect(out.code).toBe("blacklisted");
    expect(h.logSend).toHaveBeenCalledWith(expect.objectContaining({ status: "skipped", mail_type: "competitorUpdate" }));
  });

  it("blacklisted + logSend throws → still returns blacklisted (swallowed)", async () => {
    h.userFindOne.mockResolvedValueOnce({ _id: "u1", email: "a@b.c" });
    h.isBlacklisted.mockResolvedValue(true);
    h.logSend.mockRejectedValue(new Error("log fail"));
    const out = await svc.sendCompetitorMailForEmail("a@b.c");
    expect(out.code).toBe("blacklisted");
  });

  it("no requests → no_requests", async () => {
    h.userFindOne.mockResolvedValueOnce({ _id: "u1", email: "a@b.c" });
    h.reqFind.mockReturnValue(lean([]));
    const out = await svc.sendCompetitorMailForEmail("a@b.c");
    expect(out.code).toBe("no_requests");
  });

  it("happy: targeted pipeline reports 'sent' → ok:true; restores snapshot", async () => {
    h.userFindOne.mockResolvedValueOnce({ _id: "u1", email: "A@B.c" });
    h.reqFind.mockReturnValue(lean([{ _id: "r1", monitoring: ["c1", "c1"], email_status: 1 }]));
    h.activeCompetitorContacts.mockImplementation(async (req, res) => {
      res.send({ statusCode: 200, body: { data: [{ email: "a@b.c", mailStatus: "sent" }] } });
    });
    const out = await svc.sendCompetitorMailForEmail("A@B.c");
    expect(out.ok).toBe(true);
    expect(out.code).toBe("sent");
    expect(h.compBulkWrite).toHaveBeenCalled(); // restore ran
    expect(h.reqBulkWrite).toHaveBeenCalled();
  });

  it("pipeline reports a non-sent status for the user → ok:false code=status", async () => {
    h.userFindOne.mockResolvedValueOnce({ _id: "u1", email: "a@b.c" });
    h.reqFind.mockReturnValue(lean([{ _id: "r1", monitoring: ["c1"], email_status: 0 }]));
    h.activeCompetitorContacts.mockImplementation(async (req, res) => {
      res.status(200).json({ data: [{ email: "a@b.c", mailStatus: "skipped" }] });
    });
    const out = await svc.sendCompetitorMailForEmail("a@b.c");
    expect(out.ok).toBe(false);
    expect(out.code).toBe("skipped");
  });

  it("pipeline returns no data → 'no_work'", async () => {
    h.userFindOne.mockResolvedValueOnce({ _id: "u1", email: "a@b.c" });
    h.reqFind.mockReturnValue(lean([{ _id: "r1", monitoring: [], email_status: 0 }]));
    h.activeCompetitorContacts.mockImplementation(async (req, res) => { res.send({ body: { data: [] } }); });
    const out = await svc.sendCompetitorMailForEmail("a@b.c");
    expect(out.code).toBe("no_work");
  });

  it("pipeline returns data but not this user → 'unknown'", async () => {
    h.userFindOne.mockResolvedValueOnce({ _id: "u1", email: "a@b.c" });
    h.reqFind.mockReturnValue(lean([{ _id: "r1", monitoring: ["c1"], email_status: 0 }]));
    h.activeCompetitorContacts.mockImplementation(async (req, res) => { res.send({ body: { data: [{ email: "other@x.y", mailStatus: "sent" }] } }); });
    const out = await svc.sendCompetitorMailForEmail("a@b.c");
    expect(out.code).toBe("unknown");
  });

  it("non-object send payload → wrapped; restore error is swallowed", async () => {
    h.userFindOne.mockResolvedValueOnce({ _id: "u1", email: "a@b.c" });
    h.reqFind.mockReturnValue(lean([{ _id: "r1", monitoring: ["c1"], email_status: 0 }]));
    h.activeCompetitorContacts.mockImplementation(async (req, res) => { res.send("plain-string"); });
    h.compBulkWrite.mockRejectedValue(new Error("restore boom"));
    const out = await svc.sendCompetitorMailForEmail("a@b.c");
    expect(out.code).toBe("no_work"); // body undefined → data [] → no_work
    expect(h.loggerError).toHaveBeenCalled(); // restore error logged
  });

  it("pipeline throws → send_failed; restore still runs", async () => {
    h.userFindOne.mockResolvedValueOnce({ _id: "u1", email: "a@b.c" });
    h.reqFind.mockReturnValue(lean([{ _id: "r1", monitoring: ["c1"], email_status: 0 }]));
    h.activeCompetitorContacts.mockRejectedValue(new Error("pipeline boom"));
    const out = await svc.sendCompetitorMailForEmail("a@b.c");
    expect(out.code).toBe("send_failed");
    expect(h.loggerError).toHaveBeenCalled();
  });

  it("exact lookup misses, regex fallback finds the user", async () => {
    h.userFindOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ _id: "u9", email: "a@b.c" });
    h.reqFind.mockReturnValue(lean([{ _id: "r1", monitoring: ["c1"], email_status: 0 }]));
    h.activeCompetitorContacts.mockImplementation(async (req, res) => { res.send({ body: { data: [{ email: "a@b.c", mailStatus: "sent" }] } }); });
    const out = await svc.sendCompetitorMailForEmail("a@b.c");
    expect(out.ok).toBe(true);
  });

  it("snapshot reqs empty → restore skips request bulkWrite (L82 false)", async () => {
    h.userFindOne.mockResolvedValueOnce({ _id: "u1", email: "a@b.c" });
    // 1st find = user requests (non-empty); 2nd find (snapshot) = empty
    h.reqFind.mockReturnValueOnce(lean([{ _id: "r1", monitoring: ["c1"], email_status: 0 }]))
             .mockReturnValueOnce(lean([]));
    h.activeCompetitorContacts.mockImplementation(async (req, res) => { res.send({ body: { data: [{ email: "a@b.c", mailStatus: "sent" }] } }); });
    await svc.sendCompetitorMailForEmail("a@b.c");
    expect(h.reqBulkWrite).not.toHaveBeenCalled(); // reqs empty
  });

  it("request with no monitoring field → `|| []` fallback (L175)", async () => {
    h.userFindOne.mockResolvedValueOnce({ _id: "u1", email: "a@b.c" });
    h.reqFind.mockReturnValue(lean([{ _id: "r1", email_status: 0 }])); // no monitoring
    h.activeCompetitorContacts.mockImplementation(async (req, res) => { res.send({ body: { data: [] } }); });
    const out = await svc.sendCompetitorMailForEmail("a@b.c");
    expect(out.code).toBe("no_work");
  });

  it("pipeline sets no body → `captured?.body || {}` fallback (L185)", async () => {
    h.userFindOne.mockResolvedValueOnce({ _id: "u1", email: "a@b.c" });
    h.reqFind.mockReturnValue(lean([{ _id: "r1", monitoring: ["c1"], email_status: 0 }]));
    h.activeCompetitorContacts.mockImplementation(async (req, res) => { res.status(200); }); // no body
    const out = await svc.sendCompetitorMailForEmail("a@b.c");
    expect(out.code).toBe("no_work");
  });

  it("data item with no email → `d?.email || ''` fallback (L187)", async () => {
    h.userFindOne.mockResolvedValueOnce({ _id: "u1", email: "a@b.c" });
    h.reqFind.mockReturnValue(lean([{ _id: "r1", monitoring: ["c1"], email_status: 0 }]));
    h.activeCompetitorContacts.mockImplementation(async (req, res) => { res.send({ body: { data: [{ mailStatus: "sent" }] } }); });
    const out = await svc.sendCompetitorMailForEmail("a@b.c");
    expect(out.code).toBe("unknown"); // no matching email
  });

  it("empty competitorIds + requestIds → snapshot/forceActive/restore skip those collections", async () => {
    h.userFindOne.mockResolvedValueOnce({ _id: "u1", email: "a@b.c" });
    h.reqFind.mockReturnValue(lean([{ _id: "r1", monitoring: [], email_status: 0 }])); // no competitors
    h.activeCompetitorContacts.mockImplementation(async (req, res) => { res.send({ body: { data: [] } }); });
    await svc.sendCompetitorMailForEmail("a@b.c");
    // competitorIds empty → Competitors.find not called for snapshot, updateMany not called
    expect(h.compUpdateMany).not.toHaveBeenCalled();
  });
});

describe("manualSendService > sendDataReportForEmail", () => {
  it("empty email → empty_email (falsy rawEmail → `|| ''`)", async () => {
    const out = await svc.sendDataReportForEmail("");
    expect(out.code).toBe("empty_email");
  });
  it("whitespace email → empty_email (trims to '')", async () => {
    const out = await svc.sendDataReportForEmail("   ");
    expect(out.code).toBe("empty_email");
  });
  it("blacklisted → skipped log + blacklisted", async () => {
    h.isBlacklisted.mockResolvedValue(true);
    const out = await svc.sendDataReportForEmail("a@b.c", { name: "Joe" });
    expect(out.code).toBe("blacklisted");
    expect(h.logSend).toHaveBeenCalledWith(expect.objectContaining({ mail_type: "dataReport" }));
  });
  it("blacklisted + logSend throws → still blacklisted", async () => {
    h.isBlacklisted.mockResolvedValue(true);
    h.logSend.mockRejectedValue(new Error("x"));
    const out = await svc.sendDataReportForEmail("a@b.c");
    expect(out.code).toBe("blacklisted");
  });
  it("success → ok with statusCode/msgId (defaults name='there', hours=24)", async () => {
    h.sendDataReport.mockResolvedValue({ statusCode: 202, msgId: "m1" });
    const out = await svc.sendDataReportForEmail("a@b.c", {});
    expect(out.ok).toBe(true);
    expect(h.sendDataReport).toHaveBeenCalledWith({ to: "a@b.c", name: "there", hours: 24 });
  });
  it("explicit name/hours passed through", async () => {
    h.sendDataReport.mockResolvedValue({ statusCode: 202 });
    await svc.sendDataReportForEmail("a@b.c", { name: "Al", hours: 48 });
    expect(h.sendDataReport).toHaveBeenCalledWith({ to: "a@b.c", name: "Al", hours: 48 });
  });
  it("sendDataReport throws → send_failed", async () => {
    h.sendDataReport.mockRejectedValue(new Error("sg-down"));
    const out = await svc.sendDataReportForEmail("a@b.c");
    expect(out.code).toBe("send_failed");
    expect(h.loggerError).toHaveBeenCalled();
  });
});
