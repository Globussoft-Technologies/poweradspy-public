import { describe, it, expect, vi, beforeEach } from "vitest";

const { sendCompetitorMailForEmail, sendDataReportForEmail, loggerError } = vi.hoisted(() => ({
  sendCompetitorMailForEmail: vi.fn(),
  sendDataReportForEmail: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("../../../core/mailer/manualSendService.js", () => ({
  sendCompetitorMailForEmail,
  sendDataReportForEmail,
}));
vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { error: loggerError, info: vi.fn(), warn: vi.fn() },
}));

let ctrl;
beforeEach(async () => {
  sendCompetitorMailForEmail.mockReset();
  sendDataReportForEmail.mockReset();
  loggerError.mockReset();
  vi.resetModules();
  ({ default: ctrl } = await import("../../../core/mailer/manualSendController.js"));
});

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.send = vi.fn(() => res);
  return res;
}
const j = (res) => JSON.stringify(res.send.mock.calls[0][0]);

describe("manualSendController > sendCompetitor", () => {
  it("missing email → validation fail", async () => {
    const res = mockRes();
    await ctrl.sendCompetitor({ body: {} }, res);
    expect(j(res).toLowerCase()).toContain("email is required");
    expect(sendCompetitorMailForEmail).not.toHaveBeenCalled();
  });
  it("user_not_found → 404", async () => {
    sendCompetitorMailForEmail.mockResolvedValue({ ok: false, code: "user_not_found" });
    const res = mockRes();
    await ctrl.sendCompetitor({ body: { email: "a@b.c" } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
  it("no_requests → 400", async () => {
    sendCompetitorMailForEmail.mockResolvedValue({ ok: false, code: "no_requests", error: "none" });
    const res = mockRes();
    await ctrl.sendCompetitor({ body: { email: "a@b.c" } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it("other failure → userFailResp", async () => {
    sendCompetitorMailForEmail.mockResolvedValue({ ok: false, code: "send_error", error: "boom" });
    const res = mockRes();
    await ctrl.sendCompetitor({ body: { email: "a@b.c" } }, res);
    expect(j(res).toLowerCase()).toContain("failed");
  });
  it("ok → success", async () => {
    sendCompetitorMailForEmail.mockResolvedValue({ ok: true, sentTo: "a@b.c", code: "sent", response: {} });
    const res = mockRes();
    await ctrl.sendCompetitor({ body: { email: "a@b.c" } }, res);
    expect(j(res)).toContain("a@b.c");
  });
  it("throw → failResp + logs", async () => {
    sendCompetitorMailForEmail.mockRejectedValue(new Error("explode"));
    const res = mockRes();
    await ctrl.sendCompetitor({ body: { email: "a@b.c" } }, res);
    expect(loggerError).toHaveBeenCalled();
    expect(j(res).toLowerCase()).toContain("unexpected");
  });
  it("no_requests with no error → default reason string (L43 fallback)", async () => {
    sendCompetitorMailForEmail.mockResolvedValue({ ok: false, code: "no_requests" });
    const res = mockRes();
    await ctrl.sendCompetitor({ body: { email: "a@b.c" } }, res);
    expect(j(res)).toContain("user has no competitor requests");
  });
  it("other failure with no error → uses code (L49 fallback)", async () => {
    sendCompetitorMailForEmail.mockResolvedValue({ ok: false, code: "send_error" });
    const res = mockRes();
    await ctrl.sendCompetitor({ body: { email: "a@b.c" } }, res);
    expect(j(res)).toContain("send_error");
  });
});

describe("manualSendController > sendDataReport", () => {
  it("missing email → validation fail", async () => {
    const res = mockRes();
    await ctrl.sendDataReport({ body: {} }, res);
    expect(j(res).toLowerCase()).toContain("email is required");
  });
  it("not ok → userFailResp", async () => {
    sendDataReportForEmail.mockResolvedValue({ ok: false, code: "err", error: "x" });
    const res = mockRes();
    await ctrl.sendDataReport({ body: { email: "a@b.c" } }, res);
    expect(j(res).toLowerCase()).toContain("failed");
  });
  it("ok → success (passes name/hours)", async () => {
    sendDataReportForEmail.mockResolvedValue({ ok: true, sentTo: "a@b.c", statusCode: 202, msgId: "m1" });
    const res = mockRes();
    await ctrl.sendDataReport({ body: { email: "a@b.c", name: "Joe", hours: 24 } }, res);
    expect(sendDataReportForEmail).toHaveBeenCalledWith("a@b.c", { name: "Joe", hours: 24 });
    expect(j(res)).toContain("a@b.c");
  });
  it("throw → failResp + logs", async () => {
    sendDataReportForEmail.mockRejectedValue(new Error("explode"));
    const res = mockRes();
    await ctrl.sendDataReport({ body: { email: "a@b.c" } }, res);
    expect(loggerError).toHaveBeenCalled();
  });
  it("not ok with no error → uses code (L79 fallback)", async () => {
    sendDataReportForEmail.mockResolvedValue({ ok: false, code: "gen_error" });
    const res = mockRes();
    await ctrl.sendDataReport({ body: { email: "a@b.c" } }, res);
    expect(j(res)).toContain("gen_error");
  });
});
