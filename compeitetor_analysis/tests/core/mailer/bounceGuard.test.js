import { describe, it, expect, vi, beforeEach } from "vitest";

const { findOneSpy, updateOneSpy, loggerInfoSpy, loggerErrorSpy } = vi.hoisted(() => ({
  findOneSpy: vi.fn(),
  updateOneSpy: vi.fn(),
  loggerInfoSpy: vi.fn(),
  loggerErrorSpy: vi.fn(),
}));

vi.mock("../../../models/bouncedEmail.js", () => ({
  default: { findOne: findOneSpy, updateOne: updateOneSpy },
}));
vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { info: loggerInfoSpy, error: loggerErrorSpy, warn: vi.fn() },
}));

let bg;
beforeEach(async () => {
  findOneSpy.mockReset();
  updateOneSpy.mockReset();
  loggerInfoSpy.mockReset();
  loggerErrorSpy.mockReset();
  vi.resetModules();
  bg = await import("../../../core/mailer/bounceGuard.js");
});

describe("bounceGuard > isBounceReason", () => {
  it("matches bounce signatures", () => {
    expect(bg.isBounceReason("hard bounce")).toBe(true);
    expect(bg.isBounceReason("550 5.1.1 user unknown")).toBe(true);
    expect(bg.isBounceReason("mailbox unavailable")).toBe(true);
    expect(bg.isBounceReason("invalid recipient")).toBe(true);
  });
  it("returns false for falsy / non-bounce reasons", () => {
    expect(bg.isBounceReason(null)).toBe(false);
    expect(bg.isBounceReason("")).toBe(false);
    expect(bg.isBounceReason("temporary throttle")).toBe(false);
  });
});

describe("bounceGuard > normalizeEmail", () => {
  it("trims + lowercases; null → ''", () => {
    expect(bg.normalizeEmail("  Foo@Bar.COM ")).toBe("foo@bar.com");
    expect(bg.normalizeEmail(null)).toBe("");
  });
});

describe("bounceGuard > isBlacklisted", () => {
  it("empty email → false (no query)", async () => {
    expect(await bg.isBlacklisted("")).toBe(false);
    expect(findOneSpy).not.toHaveBeenCalled();
  });
  it("found → true", async () => {
    findOneSpy.mockReturnValue({ lean: () => Promise.resolve({ _id: "x" }) });
    expect(await bg.isBlacklisted("a@b.c")).toBe(true);
  });
  it("not found → false", async () => {
    findOneSpy.mockReturnValue({ lean: () => Promise.resolve(null) });
    expect(await bg.isBlacklisted("a@b.c")).toBe(false);
  });
  it("lookup error → false (best-effort) + logs", async () => {
    findOneSpy.mockReturnValue({ lean: () => Promise.reject(new Error("db")) });
    expect(await bg.isBlacklisted("a@b.c")).toBe(false);
    expect(loggerErrorSpy).toHaveBeenCalled();
  });
});

describe("bounceGuard > markBounced", () => {
  it("empty email → no-op", async () => {
    await bg.markBounced({ email: "" });
    expect(updateOneSpy).not.toHaveBeenCalled();
  });
  it("upserts the blacklist row + logs (defaults applied)", async () => {
    updateOneSpy.mockResolvedValue({});
    await bg.markBounced({ email: "A@B.c" });
    const [filter, update, opts] = updateOneSpy.mock.calls[0];
    expect(filter).toEqual({ email: "a@b.c" });
    expect(update.$inc.bounce_count).toBe(1);
    expect(opts.upsert).toBe(true);
    expect(loggerInfoSpy).toHaveBeenCalled();
  });
  it("explicit reason/mail_type/source passed through", async () => {
    updateOneSpy.mockResolvedValue({});
    await bg.markBounced({ email: "a@b.c", reason: "bounce", mail_type: "dataReport", source: "failed_reason" });
    expect(updateOneSpy.mock.calls[0][1].$set.source).toBe("failed_reason");
  });
  it("error → caught + logged", async () => {
    updateOneSpy.mockRejectedValue(new Error("nope"));
    await bg.markBounced({ email: "a@b.c" });
    expect(loggerErrorSpy).toHaveBeenCalled();
  });
});

describe("bounceGuard > BLACKLISTED_SKIP_REASON", () => {
  it("is the stable wording", () => {
    expect(bg.BLACKLISTED_SKIP_REASON).toMatch(/previously bounced/);
  });
});
