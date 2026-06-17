import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  sendDataReportBulk: vi.fn(),
  sendDataReport: vi.fn(),
  getDataReportStats: vi.fn(),
  getSubscribedContacts: vi.fn(),
  getContactsBreakdown: vi.fn(),
  resolveDailyRecipients: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("../../../core/mailer/dataReportEmailService.js", () => ({
  default: { sendDataReportBulk: h.sendDataReportBulk, sendDataReport: h.sendDataReport },
}));
vi.mock("../../../core/mailer/dataReportStatsService.js", () => ({ getDataReportStats: h.getDataReportStats }));
vi.mock("../../../core/mailer/sendgridContactsService.js", () => ({
  getSubscribedContacts: h.getSubscribedContacts, getContactsBreakdown: h.getContactsBreakdown,
}));
vi.mock("../../../core/mailer/reportRecipientsService.js", () => ({ resolveDailyRecipients: h.resolveDailyRecipients }));
vi.mock("../../../resources/logs/logger.log.js", () => ({ default: { error: h.loggerError, info: vi.fn(), warn: vi.fn() } }));

let ctrl;
beforeEach(async () => {
  for (const k of Object.keys(h)) h[k].mockReset();
  vi.resetModules();
  ({ default: ctrl } = await import("../../../core/mailer/dataReportController.js"));
});

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe("dataReportController > send", () => {
  it("no recipients → 400", async () => {
    const res = mockRes();
    await ctrl.send({ body: { to: ["", "  "] } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it("single email + defaults → bulk send", async () => {
    h.sendDataReportBulk.mockResolvedValue({ sent: ["a@b.c"], failed: [], stats: {} });
    const res = mockRes();
    await ctrl.send({ body: { to: "a@b.c" } }, res);
    expect(h.sendDataReportBulk).toHaveBeenCalledWith({ recipients: ["a@b.c"], name: "there", hours: 24 });
    expect(res.status).toHaveBeenCalledWith(200);
  });
  it("array emails + name/hours", async () => {
    h.sendDataReportBulk.mockResolvedValue({ sent: ["a@b.c", "d@e.f"], failed: [], stats: {} });
    const res = mockRes();
    await ctrl.send({ body: { to: ["a@b.c", "d@e.f"], name: "Joe", hours: 48 } }, res);
    expect(h.sendDataReportBulk).toHaveBeenCalledWith({ recipients: ["a@b.c", "d@e.f"], name: "Joe", hours: 48 });
  });
  it("error → 500", async () => {
    h.sendDataReportBulk.mockRejectedValue(new Error("boom"));
    const res = mockRes();
    await ctrl.send({ body: { to: "a@b.c" } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(h.loggerError).toHaveBeenCalled();
  });
  it("no body → `req.body || {}` → 400 (L54)", async () => {
    const res = mockRes();
    await ctrl.send({}, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("dataReportController > sendTest", () => {
  it("no to → 400", async () => {
    const res = mockRes();
    await ctrl.sendTest({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it("no body → `req.body || {}` → 400 (L81)", async () => {
    const res = mockRes();
    await ctrl.sendTest({}, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it("success", async () => {
    h.sendDataReport.mockResolvedValue({ statusCode: 202, msgId: "m1", stats: {} });
    const res = mockRes();
    await ctrl.sendTest({ body: { to: "a@b.c" } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(h.sendDataReport).toHaveBeenCalledWith({ to: "a@b.c", name: "there", hours: 24 });
  });
  it("error → 500", async () => {
    h.sendDataReport.mockRejectedValue(new Error("x"));
    const res = mockRes();
    await ctrl.sendTest({ body: { to: "a@b.c" } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("dataReportController > stats", () => {
  it("success with hours from query", async () => {
    h.getDataReportStats.mockResolvedValue({ grand: {} });
    const res = mockRes();
    await ctrl.stats({ query: { hours: "12" } }, res);
    expect(h.getDataReportStats).toHaveBeenCalledWith({ hours: 12 });
    expect(res.status).toHaveBeenCalledWith(200);
  });
  it("default hours when absent", async () => {
    h.getDataReportStats.mockResolvedValue({});
    const res = mockRes();
    await ctrl.stats({ query: {} }, res);
    expect(h.getDataReportStats).toHaveBeenCalledWith({ hours: 24 });
  });
  it("error → 500", async () => {
    h.getDataReportStats.mockRejectedValue(new Error("es"));
    const res = mockRes();
    await ctrl.stats({ query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("dataReportController > contacts", () => {
  const breakdown = () => ({
    totalContacts: 100, subscribedCount: 90, suppressed: 10,
    suppressions: {
      bounced: { count: 3, emails: [
        { email: "a@x.c", created: 1700000000, reason: "550" },          // seconds → *1000 (2023-11-14)
        { email: "b@x.c", created: 1500000000000 },                       // ms (2017-07-14); no reason
        { email: "e@x.c", created: "not-a-number" },                      // NaN → "unknown" (L19)
      ] },
      blocks: { count: 0, error: "blk-fail" },                           // error branch
      invalid_emails: { count: 1, emails: [{ email: "c@x.c", created: null }] }, // null → "unknown"
    },
  });

  it("fresh fetch (cache miss) → full payload with daily grouping", async () => {
    h.getContactsBreakdown.mockResolvedValue(breakdown());
    const res = mockRes();
    await ctrl.contacts({ query: { fresh: "true" } }, res);
    const p = res.json.mock.calls[0][0];
    expect(p.cached).toBe(false);
    expect(p.totalContacts).toBe(100);
    expect(Array.isArray(p.daily)).toBe(true);
    expect(p.daily.some((d) => d.date === "unknown")).toBe(true);
    expect(p.suppressions.blocks.error).toBe("blk-fail");
  });

  it("second call serves from cache (cached:true)", async () => {
    h.getContactsBreakdown.mockResolvedValue(breakdown());
    await ctrl.contacts({ query: {} }, mockRes());     // populate cache
    const res = mockRes();
    await ctrl.contacts({ query: {} }, res);           // cached
    expect(res.json.mock.calls[0][0].cached).toBe(true);
    expect(h.getContactsBreakdown).toHaveBeenCalledTimes(1);
  });

  it("emails=false → counts only (daily + suppressions stripped)", async () => {
    h.getContactsBreakdown.mockResolvedValue(breakdown());
    const res = mockRes();
    await ctrl.contacts({ query: { emails: "false" } }, res);
    const p = res.json.mock.calls[0][0];
    expect(p.suppressions.bounced).toEqual({ count: 3 });
    expect(p.daily[0].emails).toBeUndefined();
  });

  it("error → 500", async () => {
    h.getContactsBreakdown.mockRejectedValue(new Error("sg"));
    const res = mockRes();
    await ctrl.contacts({ query: { fresh: "true" } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("buildDailyExcluded tolerates a suppression list with no emails", async () => {
    h.getContactsBreakdown.mockResolvedValue({ totalContacts: 1, subscribedCount: 1, suppressed: 0, suppressions: { bounced: { count: 0 } } });
    const res = mockRes();
    await ctrl.contacts({ query: { fresh: "true" } }, res);
    expect(res.json.mock.calls[0][0].daily).toEqual([]);
  });
  it("breakdown with no suppressions key → `|| {}` fallbacks (L28/L144)", async () => {
    h.getContactsBreakdown.mockResolvedValue({ totalContacts: 1, subscribedCount: 1, suppressed: 0 }); // no suppressions
    const res = mockRes();
    await ctrl.contacts({ query: { fresh: "true" } }, res);
    const p = res.json.mock.calls[0][0];
    expect(p.daily).toEqual([]);
    expect(p.suppressions).toEqual({});
  });
});

describe("dataReportController > recipients", () => {
  it("counts only by default", async () => {
    h.resolveDailyRecipients.mockResolvedValue({ source: "amember", recipients: ["a@b.c"], totalSubscribed: 5, suppressedExcluded: 1 });
    const res = mockRes();
    await ctrl.recipients({ query: {} }, res);
    const p = res.json.mock.calls[0][0];
    expect(p.recipientCount).toBe(1);
    expect(p.emails).toBeUndefined();
  });
  it("emails=true includes the list", async () => {
    h.resolveDailyRecipients.mockResolvedValue({ source: "override", recipients: ["a@b.c"], totalSubscribed: 1, suppressedExcluded: 0 });
    const res = mockRes();
    await ctrl.recipients({ query: { emails: "true" } }, res);
    expect(res.json.mock.calls[0][0].emails).toEqual(["a@b.c"]);
  });
  it("error → 500", async () => {
    h.resolveDailyRecipients.mockRejectedValue(new Error("rcp"));
    const res = mockRes();
    await ctrl.recipients({ query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("dataReportController > subscribers", () => {
  it("success", async () => {
    h.getSubscribedContacts.mockResolvedValue({ subscribed: ["a@b.c"], totalContacts: 2, unsubscribed: 1 });
    const res = mockRes();
    await ctrl.subscribers({}, res);
    expect(res.json.mock.calls[0][0].count).toBe(1);
  });
  it("error → 500", async () => {
    h.getSubscribedContacts.mockRejectedValue(new Error("sg"));
    const res = mockRes();
    await ctrl.subscribers({}, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
