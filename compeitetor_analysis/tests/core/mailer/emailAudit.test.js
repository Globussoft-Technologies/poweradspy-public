import { describe, it, expect, vi, beforeEach } from "vitest";

const { logUpdateOne, insertMany, evtCreate, markBouncedSpy, isBounceReasonSpy, loggerInfo, loggerError } = vi.hoisted(() => ({
  logUpdateOne: vi.fn(),
  insertMany: vi.fn(),
  evtCreate: vi.fn(),
  markBouncedSpy: vi.fn(),
  isBounceReasonSpy: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { info: loggerInfo, error: loggerError, warn: vi.fn() },
}));
vi.mock("../../../models/emailSendLog.js", () => ({
  default: { updateOne: logUpdateOne, collection: { insertMany } },
}));
vi.mock("../../../models/emailSendEvent.js", () => ({
  default: { create: evtCreate },
}));
vi.mock("../../../core/mailer/bounceGuard.js", () => ({
  markBounced: markBouncedSpy,
  isBounceReason: isBounceReasonSpy,
}));

let audit;
beforeEach(async () => {
  for (const s of [logUpdateOne, insertMany, evtCreate, markBouncedSpy, isBounceReasonSpy, loggerInfo, loggerError]) s.mockReset();
  logUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  insertMany.mockResolvedValue({});
  evtCreate.mockResolvedValue({});
  isBounceReasonSpy.mockReturnValue(false);
  vi.resetModules();
  audit = await import("../../../core/mailer/emailAudit.js");
});

describe("emailAudit > id helpers", () => {
  it("newSendId returns a uuid-ish string", () => {
    expect(typeof audit.newSendId()).toBe("string");
    expect(audit.newSendId()).not.toBe(audit.newSendId());
  });
  it("dataReportSendId is deterministic per (date,email)", () => {
    const a = audit.dataReportSendId("2025-01-01", "A@B.com");
    const b = audit.dataReportSendId("2025-01-01", "a@b.com");
    expect(a).toBe(b);
    expect(a).toMatch(/^DR-2025-01-01-[0-9a-f]{20}$/);
  });
});

describe("emailAudit > seedQueued", () => {
  it("non-array / empty → no-op", async () => {
    await audit.seedQueued("dataReport", "2025-01-01", null);
    await audit.seedQueued("dataReport", "2025-01-01", []);
    expect(insertMany).not.toHaveBeenCalled();
  });
  it("bulk inserts queued rows + logs", async () => {
    await audit.seedQueued("dataReport", "2025-01-01", ["a@b.c", "d@e.f"]);
    expect(insertMany).toHaveBeenCalledTimes(1);
    expect(insertMany.mock.calls[0][0][0].status).toBe("queued");
    expect(loggerInfo).toHaveBeenCalled();
  });
  it("duplicate-key insert error is swallowed (resume-safe)", async () => {
    insertMany.mockRejectedValueOnce(new Error("E11000"));
    await audit.seedQueued("dataReport", "2025-01-01", ["a@b.c"]);
    expect(loggerInfo).toHaveBeenCalled(); // still logs summary
  });
  it("outer error → caught + logged", async () => {
    // force docs.map to throw by passing a recipient that breaks String()? Instead break col access
    await audit.seedQueued("dataReport", "2025-01-01", [{ toString() { throw new Error("boom"); } }]);
    expect(loggerError).toHaveBeenCalled();
  });
});

describe("emailAudit > logSend", () => {
  it("no doc / no send_id → no-op", async () => {
    await audit.logSend(null);
    await audit.logSend({});
    expect(logUpdateOne).not.toHaveBeenCalled();
  });
  it("upserts row (lowercases to)", async () => {
    await audit.logSend({ send_id: "s1", to: "Foo@Bar.com", status: "sent" });
    expect(logUpdateOne.mock.calls[0][0]).toEqual({ send_id: "s1" });
    expect(logUpdateOne.mock.calls[0][1].$set.to).toBe("foo@bar.com");
  });
  it("failed + bounce reason → markBounced (inline feeder)", async () => {
    isBounceReasonSpy.mockReturnValue(true);
    await audit.logSend({ send_id: "s1", to: "x@y.z", status: "failed", failure_reason: "user unknown" });
    expect(markBouncedSpy).toHaveBeenCalledWith(expect.objectContaining({ source: "failed_reason" }));
  });
  it("failed but not a bounce reason → no markBounced", async () => {
    isBounceReasonSpy.mockReturnValue(false);
    await audit.logSend({ send_id: "s1", to: "x@y.z", status: "failed", failure_reason: "throttled" });
    expect(markBouncedSpy).not.toHaveBeenCalled();
  });
  it("updateOne throws → caught + logged", async () => {
    logUpdateOne.mockRejectedValueOnce(new Error("db"));
    await audit.logSend({ send_id: "s1", to: "x@y.z", status: "sent" });
    expect(loggerError).toHaveBeenCalled();
  });
});

describe("emailAudit > applyWebhookEvent", () => {
  it("delivered → status update guarded by queued/sent", async () => {
    await audit.applyWebhookEvent({ event: "delivered", send_id: "s1", timestamp: 1700000000, email: "a@b.c" });
    expect(evtCreate).toHaveBeenCalled();
    expect(logUpdateOne).toHaveBeenCalledWith(
      expect.objectContaining({ send_id: "s1", status: { $in: ["queued", "sent"] } }),
      expect.any(Object),
    );
  });
  it("open with guard blocked → falls back to alwaysSet (opened_at)", async () => {
    logUpdateOne.mockResolvedValueOnce({ modifiedCount: 0 }); // guard blocked
    await audit.applyWebhookEvent({ event: "open", send_id: "s1" });
    // second updateOne uses alwaysSet
    expect(logUpdateOne).toHaveBeenCalledTimes(2);
  });
  it("click → status upgrade + click bookkeeping (with url)", async () => {
    await audit.applyWebhookEvent({ event: "click", send_id: "s1", url: "http://x.com/a" });
    // one updateOne for status (guarded), one for click bookkeeping
    const lastCall = logUpdateOne.mock.calls[logUpdateOne.mock.calls.length - 1][1];
    expect(lastCall.$inc.click_count).toBe(1);
    expect(lastCall.$addToSet.clicked_urls).toBe("http://x.com/a");
  });
  it("click with no url → no $addToSet", async () => {
    await audit.applyWebhookEvent({ event: "click", send_id: "s1" });
    const lastCall = logUpdateOne.mock.calls[logUpdateOne.mock.calls.length - 1][1];
    expect(lastCall.$addToSet).toBeUndefined();
  });
  it("bounce → status set + markBounced (webhook feeder)", async () => {
    await audit.applyWebhookEvent({ event: "bounce", send_id: "s1", email: "x@y.z", reason: "550" });
    expect(markBouncedSpy).toHaveBeenCalledWith(expect.objectContaining({ source: "webhook" }));
  });
  it("dropped with bounce reason → markBounced", async () => {
    isBounceReasonSpy.mockReturnValue(true);
    await audit.applyWebhookEvent({ event: "dropped", send_id: "s1", email: "x@y.z", reason: "user unknown" });
    expect(markBouncedSpy).toHaveBeenCalled();
  });
  it("spamreport → status spam (no guard)", async () => {
    await audit.applyWebhookEvent({ event: "spamreport", send_id: "s1" });
    expect(logUpdateOne).toHaveBeenCalledWith({ send_id: "s1" }, { $set: { status: "spam" } });
  });
  it("unsubscribe → status unsubscribed", async () => {
    await audit.applyWebhookEvent({ event: "unsubscribe", send_id: "s1" });
    expect(logUpdateOne).toHaveBeenCalledWith({ send_id: "s1" }, { $set: { status: "unsubscribed" } });
  });
  it("processed (default) → event stored, no status update", async () => {
    await audit.applyWebhookEvent({ event: "processed", send_id: "s1" });
    expect(evtCreate).toHaveBeenCalled();
    expect(logUpdateOne).not.toHaveBeenCalled();
  });
  it("no send_id → correlate by sg_message_id prefix", async () => {
    await audit.applyWebhookEvent({ event: "delivered", sg_message_id: "abc.123", timestamp: 1700000000 });
    const filter = logUpdateOne.mock.calls[0][0];
    expect(filter.sendgrid_message_id).toBeInstanceOf(RegExp);
  });
  it("no send_id and no sg_message_id → no status update (filter null)", async () => {
    await audit.applyWebhookEvent({ event: "delivered" });
    expect(logUpdateOne).not.toHaveBeenCalled();
  });
  it("create throws → caught + logged", async () => {
    evtCreate.mockRejectedValueOnce(new Error("db"));
    await audit.applyWebhookEvent({ event: "delivered", send_id: "s1" });
    expect(loggerError).toHaveBeenCalled();
  });

  it("bounce with no type/reason → 'hard'/'bounced' fallbacks", async () => {
    await audit.applyWebhookEvent({ event: "bounce", send_id: "s1", email: "x@y.z" });
    const set = logUpdateOne.mock.calls[0][1].$set;
    expect(set.bounce_type).toBe("hard");
    expect(set.failure_reason).toBe("bounced");
    expect(markBouncedSpy).toHaveBeenCalledWith(expect.objectContaining({ reason: "bounced" }));
  });

  it("dropped with no reason → 'dropped' fallback (no bounce)", async () => {
    isBounceReasonSpy.mockReturnValue(false);
    await audit.applyWebhookEvent({ event: "dropped", send_id: "s1" });
    expect(logUpdateOne.mock.calls[0][1].$set.failure_reason).toBe("dropped");
    expect(markBouncedSpy).not.toHaveBeenCalled();
  });

  it("click with no timestamp → uses new Date()", async () => {
    await audit.applyWebhookEvent({ event: "click", send_id: "s1", url: "http://x.com" });
    const last = logUpdateOne.mock.calls[logUpdateOne.mock.calls.length - 1][1];
    expect(last.$set.last_clicked_at).toBeInstanceOf(Date);
  });

  it("click WITH timestamp → derives ts from it", async () => {
    await audit.applyWebhookEvent({ event: "click", send_id: "s1", url: "http://x.com", timestamp: 1700000000 });
    const last = logUpdateOne.mock.calls[logUpdateOne.mock.calls.length - 1][1];
    expect(last.$set.last_clicked_at.getTime()).toBe(1700000000 * 1000);
  });

  it("no event field → event_type '' and no status update", async () => {
    await audit.applyWebhookEvent({ send_id: "s1" });
    expect(evtCreate).toHaveBeenCalled();
    expect(logUpdateOne).not.toHaveBeenCalled();
  });

  it("send_id + mail_type via custom_args; email present", async () => {
    await audit.applyWebhookEvent({ event: "bounce", custom_args: { send_id: "s9", mail_type: "dataReport" }, email: "z@z.z", reason: "550" });
    expect(logUpdateOne.mock.calls[0][0]).toEqual(expect.objectContaining({ send_id: "s9" }));
    expect(markBouncedSpy).toHaveBeenCalledWith(expect.objectContaining({ mail_type: "dataReport", email: "z@z.z" }));
  });

  it("bounce with no email → recipient null fallback", async () => {
    await audit.applyWebhookEvent({ event: "bounce", send_id: "s1", reason: "550" });
    expect(markBouncedSpy).toHaveBeenCalledWith(expect.objectContaining({ email: null }));
  });

  it("logSend without 'to' → skips lowercase + bounce check", async () => {
    isBounceReasonSpy.mockReturnValue(true);
    await audit.logSend({ send_id: "s1", status: "failed", failure_reason: "user unknown" });
    expect(markBouncedSpy).not.toHaveBeenCalled(); // no `to` → feeder skipped
  });
});
