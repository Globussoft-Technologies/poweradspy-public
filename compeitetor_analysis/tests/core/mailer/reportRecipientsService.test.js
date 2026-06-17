import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  cfg: {},                       // config key -> value (or THROW sentinel)
  moment: { todayKey: "2025-01-10", diffDays: 4 },
  getSubscribedUserEmails: vi.fn(),
  getSubscribedUsers: vi.fn(),
  getContactsBreakdown: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
}));

vi.mock("config", () => ({
  default: { get: (k) => { const v = h.cfg[k]; if (v === "__THROW__") throw new Error("unset"); return v; } },
}));
vi.mock("moment", () => {
  const m = () => ({
    utcOffset: () => m(),
    format: () => h.moment.todayKey,
    diff: () => h.moment.diffDays,
  });
  m.utc = () => m();
  return { default: m };
});
vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { info: h.loggerInfo, error: h.loggerError, warn: vi.fn() },
}));
vi.mock("../../../core/mailer/amemberService.js", () => ({
  getSubscribedUserEmails: h.getSubscribedUserEmails,
  getSubscribedUsers: h.getSubscribedUsers,
}));
vi.mock("../../../core/mailer/sendgridContactsService.js", () => ({
  getContactsBreakdown: h.getContactsBreakdown,
}));

let svc;
beforeEach(async () => {
  h.cfg = {
    daily_report_ramp_start: "__THROW__",
    daily_report_ramp_cap: "__THROW__",
    daily_report_ramp_factor: "__THROW__",
    daily_report_priority: "__THROW__",
    dailyreport: "__THROW__",
  };
  h.moment.todayKey = "2025-01-10";
  h.moment.diffDays = 4;
  h.getSubscribedUserEmails.mockReset().mockResolvedValue({ emails: [], total: 0 });
  h.getSubscribedUsers.mockReset().mockResolvedValue({ users: [], total: 0 });
  h.getContactsBreakdown.mockReset().mockResolvedValue({ suppressions: {} });
  h.loggerInfo.mockReset();
  h.loggerError.mockReset();
  vi.resetModules();
  svc = await import("../../../core/mailer/reportRecipientsService.js");
});

describe("reportRecipientsService > applyRampAndPriority", () => {
  it("ramp disabled (no start/cap) → returns users unchanged, ramp null", () => {
    const users = [{ email: "a@b.c" }];
    expect(svc.applyRampAndPriority(users)).toEqual({ users, ramp: null });
  });

  it("before ramp start (dayN null) → empty + note", () => {
    h.cfg.daily_report_ramp_start = "2025-01-20";
    h.cfg.daily_report_ramp_cap = 100;
    h.moment.todayKey = "2025-01-10"; // < start → rampDayNumber null
    const out = svc.applyRampAndPriority([{ email: "a@b.c" }]);
    expect(out.users).toEqual([]);
    expect(out.ramp.note).toMatch(/before daily_report_ramp_start/);
  });

  it("linear ramp (factor 1) → day N × cap, priority sorted", () => {
    h.cfg.daily_report_ramp_start = "2025-01-01";
    h.cfg.daily_report_ramp_cap = 2;
    h.cfg.daily_report_priority = ["active"];
    h.moment.diffDays = 2; // dayN = 3
    const users = [
      { email: "old@x.c", last_login: "2025-01-01" },
      { email: "new@x.c", last_login: "2025-02-01" },
      { email: "none@x.c" },
    ];
    const out = svc.applyRampAndPriority(users);
    expect(out.ramp.day).toBe(3);
    expect(out.ramp.limit).toBe(6); // 3 × 2
    expect(out.ramp.factor).toBe(1);
    expect(out.users[0].email).toBe("new@x.c"); // most recent login first
  });

  it("geometric ramp (factor ≥ 2) → cap × factor^(N-1)", () => {
    h.cfg.daily_report_ramp_start = "2025-01-01";
    h.cfg.daily_report_ramp_cap = 5;
    h.cfg.daily_report_ramp_factor = 2;
    h.moment.diffDays = 2; // dayN = 3 → 5 × 2^2 = 20
    const out = svc.applyRampAndPriority([{ email: "a@b.c" }]);
    expect(out.ramp.limit).toBe(20);
  });
});

describe("reportRecipientsService > sortByPriority (via applyRampAndPriority)", () => {
  it("new_user criterion sorts by signup date; missing field sinks", () => {
    h.cfg.daily_report_ramp_start = "2025-01-01";
    h.cfg.daily_report_ramp_cap = 10;
    h.cfg.daily_report_priority = "new_user";
    h.moment.diffDays = 0; // dayN 1, limit 10
    const out = svc.applyRampAndPriority([
      { email: "a@x.c" }, // no added → -1
      { email: "b@x.c", added: "2025-03-01" },
    ]);
    expect(out.users[0].email).toBe("b@x.c");
  });
  it("new_user with no `added` field → -1 (L72 false branch)", () => {
    h.cfg.daily_report_ramp_start = "2025-01-01";
    h.cfg.daily_report_ramp_cap = 10;
    h.cfg.daily_report_priority = ["new_user"];
    h.moment.diffDays = 0;
    const out = svc.applyRampAndPriority([
      { email: "a@x.c" },                       // no added → -1
      { email: "b@x.c", added: "2025-03-01" },  // valid
    ]);
    expect(out.users[0].email).toBe("b@x.c");
  });

  it("unknown criterion → no-op order (score 0)", () => {
    h.cfg.daily_report_ramp_start = "2025-01-01";
    h.cfg.daily_report_ramp_cap = 10;
    h.cfg.daily_report_priority = ["weird"];
    h.moment.diffDays = 0;
    const out = svc.applyRampAndPriority([{ email: "a@x.c" }, { email: "b@x.c" }]);
    expect(out.users.map((u) => u.email)).toEqual(["a@x.c", "b@x.c"]);
  });

  it("priority array with falsy elements → filtered (L34 `p || ''`)", () => {
    h.cfg.daily_report_ramp_start = "2025-01-01";
    h.cfg.daily_report_ramp_cap = 10;
    h.cfg.daily_report_priority = ["active", "", null];
    h.moment.diffDays = 0;
    const out = svc.applyRampAndPriority([{ email: "a@x.c", last_login: "2025-01-01" }]);
    expect(out.ramp.priority).toEqual(["active"]);
  });

  it("invalid date strings score -1 (L68/L71 `Date.parse || -1`)", () => {
    h.cfg.daily_report_ramp_start = "2025-01-01";
    h.cfg.daily_report_ramp_cap = 10;
    h.cfg.daily_report_priority = ["active", "new_user"];
    h.moment.diffDays = 0;
    const out = svc.applyRampAndPriority([
      { email: "bad@x.c", last_login: "not-a-date", added: "also-bad" },
      { email: "good@x.c", last_login: "2025-02-01", added: "2025-02-01" },
    ]);
    expect(out.users[0].email).toBe("good@x.c"); // valid dates rank above NaN→-1
  });

  it("comma-string priority is parsed", () => {
    h.cfg.daily_report_ramp_start = "2025-01-01";
    h.cfg.daily_report_ramp_cap = 10;
    h.cfg.daily_report_priority = "active, new_user";
    h.moment.diffDays = 0;
    const out = svc.applyRampAndPriority([{ email: "a@x.c" }]);
    expect(out.ramp.priority).toEqual(["active", "new_user"]);
  });
});

describe("reportRecipientsService > rampConfig validation (via applyRampAndPriority)", () => {
  it("invalid cap (NaN) → treated as disabled", () => {
    h.cfg.daily_report_ramp_start = "2025-01-01";
    h.cfg.daily_report_ramp_cap = "abc";
    expect(svc.applyRampAndPriority([{ email: "a@b.c" }]).ramp).toBeNull();
  });
  it("factor < 1 → coerced to 1 (linear)", () => {
    h.cfg.daily_report_ramp_start = "2025-01-01";
    h.cfg.daily_report_ramp_cap = 3;
    h.cfg.daily_report_ramp_factor = 0;
    h.moment.diffDays = 1; // dayN 2
    const out = svc.applyRampAndPriority([{ email: "a@b.c" }]);
    expect(out.ramp.factor).toBe(1);
    expect(out.ramp.limit).toBe(6); // 2 × 3 linear
  });
});

describe("reportRecipientsService > getDailyReportOverride", () => {
  it("unset → null", () => {
    expect(svc.getDailyReportOverride()).toBeNull();
  });
  it("array of emails → cleaned + deduped", () => {
    h.cfg.dailyreport = ["A@B.com", "a@b.com", "bad", "c@d.com"];
    expect(svc.getDailyReportOverride()).toEqual(["a@b.com", "c@d.com"]);
  });
  it("comma string → split + cleaned", () => {
    h.cfg.dailyreport = "x@y.z, q@r.s , junk";
    expect(svc.getDailyReportOverride()).toEqual(["x@y.z", "q@r.s"]);
  });
  it("empty string → null", () => {
    h.cfg.dailyreport = "";
    expect(svc.getDailyReportOverride()).toBeNull();
  });
  it("no valid emails after cleaning → null", () => {
    h.cfg.dailyreport = ["nope", "also-bad"];
    expect(svc.getDailyReportOverride()).toBeNull();
  });
  it("non-array/non-string value → [] → null (L143 final branch)", () => {
    h.cfg.dailyreport = 12345; // number → neither array nor string
    expect(svc.getDailyReportOverride()).toBeNull();
  });
  it("array with falsy element → `e || ''` skipped (L145)", () => {
    h.cfg.dailyreport = [null, "a@b.c"];
    expect(svc.getDailyReportOverride()).toEqual(["a@b.c"]);
  });
});

describe("reportRecipientsService > getReportRecipients", () => {
  it("ramp OFF path: aMember emails minus suppressions", async () => {
    h.getSubscribedUserEmails.mockResolvedValue({ emails: ["a@b.c", "x@y.z"], total: 2 });
    h.getContactsBreakdown.mockResolvedValue({ suppressions: { bounced: { emails: [{ email: "x@y.z" }] } } });
    const out = await svc.getReportRecipients();
    expect(out.recipients).toEqual(["a@b.c"]);
    expect(out.suppressedExcluded).toBe(1);
  });
  it("ramp OFF: suppression lookup fails → full list, logs", async () => {
    h.getSubscribedUserEmails.mockResolvedValue({ emails: ["a@b.c"], total: 1 });
    h.getContactsBreakdown.mockRejectedValue(new Error("sg-down"));
    const out = await svc.getReportRecipients();
    expect(out.recipients).toEqual(["a@b.c"]);
    expect(h.loggerError).toHaveBeenCalled();
  });
  it("ramp OFF: applySuppressions=false → no suppression call", async () => {
    h.getSubscribedUserEmails.mockResolvedValue({ emails: ["a@b.c"], total: 1 });
    const out = await svc.getReportRecipients({ applySuppressions: false });
    expect(out.recipients).toEqual(["a@b.c"]);
    expect(h.getContactsBreakdown).not.toHaveBeenCalled();
  });
  it("ramp ON path: rich users, suppress, ramp-cap", async () => {
    h.cfg.daily_report_ramp_start = "2025-01-01";
    h.cfg.daily_report_ramp_cap = 1;
    h.moment.diffDays = 0; // dayN 1 → limit 1
    h.getSubscribedUsers.mockResolvedValue({ users: [{ email: "a@b.c" }, { email: "x@y.z" }], total: 2 });
    h.getContactsBreakdown.mockResolvedValue({ suppressions: { spam: { emails: [{ email: "x@y.z" }] } } });
    const out = await svc.getReportRecipients();
    expect(out.recipients).toEqual(["a@b.c"]); // x suppressed, then cap 1
    expect(out.ramp.selected).toBe(1);
  });
  it("ramp ON: suppression failure logged, proceeds", async () => {
    h.cfg.daily_report_ramp_start = "2025-01-01";
    h.cfg.daily_report_ramp_cap = 10;
    h.moment.diffDays = 0;
    h.getSubscribedUsers.mockResolvedValue({ users: [{ email: "a@b.c" }], total: 1 });
    h.getContactsBreakdown.mockRejectedValue(new Error("sg-down"));
    const out = await svc.getReportRecipients();
    expect(out.recipients).toEqual(["a@b.c"]);
    expect(h.loggerError).toHaveBeenCalled();
  });
  it("ramp ON: applySuppressions=false + no priority → '(none)' log (L177/L193)", async () => {
    h.cfg.daily_report_ramp_start = "2025-01-01";
    h.cfg.daily_report_ramp_cap = 10;
    h.moment.diffDays = 0;
    h.getSubscribedUsers.mockResolvedValue({ users: [{ email: "a@b.c" }], total: 1 });
    const out = await svc.getReportRecipients({ applySuppressions: false });
    expect(out.recipients).toEqual(["a@b.c"]);
    expect(h.getContactsBreakdown).not.toHaveBeenCalled();
    expect(h.loggerInfo.mock.calls.some((c) => String(c[0]).includes("(none)"))).toBe(true);
  });
  it("ramp ON: breakdown with no suppressions key / empty emails (L180/L181 fallbacks)", async () => {
    h.cfg.daily_report_ramp_start = "2025-01-01";
    h.cfg.daily_report_ramp_cap = 10;
    h.moment.diffDays = 0;
    h.getSubscribedUsers.mockResolvedValue({ users: [{ email: "a@b.c" }], total: 1 });
    h.getContactsBreakdown.mockResolvedValue({ suppressions: { bounced: {} } }); // emails undefined → `|| []`
    const out = await svc.getReportRecipients();
    expect(out.recipients).toEqual(["a@b.c"]);
  });
  it("ramp OFF: breakdown with empty emails (L213/L214 fallbacks)", async () => {
    h.getSubscribedUserEmails.mockResolvedValue({ emails: ["a@b.c"], total: 1 });
    h.getContactsBreakdown.mockResolvedValue({ suppressions: { spam: {} } }); // emails undefined → `|| []`
    const out = await svc.getReportRecipients();
    expect(out.recipients).toEqual(["a@b.c"]);
  });
  it("ramp ON: breakdown with no suppressions key → `|| {}` (L181)", async () => {
    h.cfg.daily_report_ramp_start = "2025-01-01";
    h.cfg.daily_report_ramp_cap = 10;
    h.moment.diffDays = 0;
    h.getSubscribedUsers.mockResolvedValue({ users: [{ email: "a@b.c" }], total: 1 });
    h.getContactsBreakdown.mockResolvedValue({}); // no suppressions key → `|| {}`
    const out = await svc.getReportRecipients();
    expect(out.recipients).toEqual(["a@b.c"]);
  });
  it("ramp OFF: breakdown with no suppressions key → `|| {}` (L214)", async () => {
    h.getSubscribedUserEmails.mockResolvedValue({ emails: ["a@b.c"], total: 1 });
    h.getContactsBreakdown.mockResolvedValue({}); // no suppressions key
    const out = await svc.getReportRecipients();
    expect(out.recipients).toEqual(["a@b.c"]);
  });
});

describe("reportRecipientsService > resolveDailyRecipients", () => {
  it("override present → uses it", async () => {
    h.cfg.dailyreport = ["a@b.c"];
    const out = await svc.resolveDailyRecipients();
    expect(out).toMatchObject({ recipients: ["a@b.c"], source: "override" });
  });
  it("no override → aMember path", async () => {
    h.getSubscribedUserEmails.mockResolvedValue({ emails: ["z@z.z"], total: 1 });
    const out = await svc.resolveDailyRecipients();
    expect(out.source).toBe("amember");
    expect(out.recipients).toEqual(["z@z.z"]);
  });
});
