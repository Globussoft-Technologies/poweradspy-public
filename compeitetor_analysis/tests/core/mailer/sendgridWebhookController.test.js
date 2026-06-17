import { describe, it, expect, vi, beforeEach } from "vitest";

const { configGet, verifySpy, createPublicKeySpy, applyWebhookEventSpy, loggerInfo, loggerError } = vi.hoisted(() => ({
  configGet: vi.fn(),
  verifySpy: vi.fn(),
  createPublicKeySpy: vi.fn(),
  applyWebhookEventSpy: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("config", () => ({ default: { get: configGet } }));
vi.mock("crypto", () => ({
  default: {
    verify: verifySpy,
    createPublicKey: createPublicKeySpy,
    randomUUID: () => "uuid",
  },
}));
vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { info: loggerInfo, error: loggerError, warn: vi.fn() },
}));
vi.mock("../../../core/mailer/emailAudit.js", () => ({
  applyWebhookEvent: applyWebhookEventSpy,
}));

let ctrl;
beforeEach(async () => {
  for (const s of [configGet, verifySpy, createPublicKeySpy, applyWebhookEventSpy, loggerInfo, loggerError]) s.mockReset();
  configGet.mockImplementation(() => { throw new Error("not set"); }); // default: no key → verification skipped
  vi.resetModules();
  ({ handleSendgridWebhook: ctrl } = await import("../../../core/mailer/sendgridWebhookController.js"));
});

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe("sendgridWebhookController > handleSendgridWebhook", () => {
  it("no public key → verification skipped, processes array of events, 200", async () => {
    const res = mockRes();
    await ctrl({ headers: {}, body: [{ event: "delivered" }, { event: "open" }] }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ received: 2 });
    expect(applyWebhookEventSpy).toHaveBeenCalledTimes(2);
    expect(loggerInfo.mock.calls[0][0]).toContain("(unverified)");
  });

  it("single object body → wrapped to one event", async () => {
    const res = mockRes();
    await ctrl({ headers: {}, body: { event: "bounce" } }, res);
    expect(res.json).toHaveBeenCalledWith({ received: 1 });
  });

  it("empty/falsy body → zero events", async () => {
    const res = mockRes();
    await ctrl({ headers: {}, body: null }, res);
    expect(res.json).toHaveBeenCalledWith({ received: 0 });
  });

  it("key set + valid signature → processed", async () => {
    configGet.mockReturnValue("BASE64KEY");
    createPublicKeySpy.mockReturnValue({ key: "pub" });
    verifySpy.mockReturnValue(true);
    const res = mockRes();
    await ctrl({
      headers: { "x-twilio-email-event-webhook-signature": "sig", "x-twilio-email-event-webhook-timestamp": "123" },
      rawBody: Buffer.from("[]"),
      body: [{ event: "delivered" }],
    }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(verifySpy).toHaveBeenCalled();
  });

  it("key set + invalid signature → 403", async () => {
    configGet.mockReturnValue("BASE64KEY");
    createPublicKeySpy.mockReturnValue({ key: "pub" });
    verifySpy.mockReturnValue(false);
    const res = mockRes();
    await ctrl({
      headers: { "x-twilio-email-event-webhook-signature": "sig", "x-twilio-email-event-webhook-timestamp": "123" },
      body: [{ event: "delivered" }],
    }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(applyWebhookEventSpy).not.toHaveBeenCalled();
  });

  it("key set but signature/timestamp headers missing → ok:false → 403", async () => {
    configGet.mockReturnValue("BASE64KEY");
    const res = mockRes();
    await ctrl({ headers: {}, body: [{ event: "delivered" }] }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("key set but createPublicKey throws → caught → 403", async () => {
    configGet.mockReturnValue("BASE64KEY");
    createPublicKeySpy.mockImplementation(() => { throw new Error("bad key"); });
    const res = mockRes();
    await ctrl({
      headers: { "x-twilio-email-event-webhook-signature": "sig", "x-twilio-email-event-webhook-timestamp": "123" },
      body: [{ event: "delivered" }],
    }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(loggerError).toHaveBeenCalled();
  });

  it("key set, no rawBody → falls back to JSON.stringify(body)", async () => {
    configGet.mockReturnValue("BASE64KEY");
    createPublicKeySpy.mockReturnValue({ key: "pub" });
    verifySpy.mockReturnValue(true);
    const res = mockRes();
    await ctrl({
      headers: { "x-twilio-email-event-webhook-signature": "sig", "x-twilio-email-event-webhook-timestamp": "123" },
      body: [{ event: "open" }],
    }, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("rawBody as a string → Buffer.from(raw) branch", async () => {
    configGet.mockReturnValue("BASE64KEY");
    createPublicKeySpy.mockReturnValue({ key: "pub" });
    verifySpy.mockReturnValue(true);
    const res = mockRes();
    await ctrl({
      headers: { "x-twilio-email-event-webhook-signature": "sig", "x-twilio-email-event-webhook-timestamp": "123" },
      rawBody: "[]", // string, not Buffer → exercises Buffer.from(raw)
      body: [{ event: "delivered" }],
    }, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("empty-string key → null pem → verification skipped", async () => {
    configGet.mockReturnValue("");
    const res = mockRes();
    await ctrl({ headers: {}, body: [{ event: "delivered" }] }, res);
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
