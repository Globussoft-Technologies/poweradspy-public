import { describe, it, expect, vi, beforeEach } from "vitest";

const { sendEmailSpy } = vi.hoisted(() => ({ sendEmailSpy: vi.fn() }));

vi.mock("../../../core/mailer/emailService.js", () => ({
  default: { sendEmail: sendEmailSpy },
}));

let emailController;

beforeEach(async () => {
  sendEmailSpy.mockReset();
  vi.resetModules();
  ({ default: emailController } = await import("../../../core/mailer/emailController.js"));
});

describe("core/mailer/emailController > sendEmail", () => {
  it("delegates to emailService.sendEmail with the same req/res", async () => {
    sendEmailSpy.mockResolvedValueOnce({ ok: true });
    const req = { body: {} }; const res = {};
    const out = await emailController.sendEmail(req, res);
    expect(sendEmailSpy).toHaveBeenCalledWith(req, res);
    expect(out).toEqual({ ok: true });
  });
});
