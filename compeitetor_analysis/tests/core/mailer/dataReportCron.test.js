import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  // fs
  readFileSync: vi.fn(), writeFileSync: vi.fn(), mkdirSync: vi.fn(), existsSync: vi.fn(), unlinkSync: vi.fn(),
  // cron
  schedule: vi.fn(),
  // services
  resolveDailyRecipients: vi.fn(), getDataReportStats: vi.fn(), sendDataReport: vi.fn(),
  dataReportSendId: vi.fn(() => "sid"), seedQueued: vi.fn(),
  updateOne: vi.fn(),
  loggerInfo: vi.fn(), loggerError: vi.fn(),
  // config + moment state
  cfg: {}, dateKey: "2026-06-16", hour: 5,
  // on-disk fixtures
  lastRun: {}, cache: {},
}));

vi.mock("node-cron", () => ({ default: { schedule: (...a) => h.schedule(...a) } }));
vi.mock("fs", () => ({ default: {
  readFileSync: (...a) => h.readFileSync(...a),
  writeFileSync: (...a) => h.writeFileSync(...a),
  mkdirSync: (...a) => h.mkdirSync(...a),
  existsSync: (...a) => h.existsSync(...a),
  unlinkSync: (...a) => h.unlinkSync(...a),
} }));
vi.mock("config", () => ({ default: { get: (k) => { const v = h.cfg[k]; if (v === "__THROW__") throw new Error("unset"); return v; } } }));
vi.mock("moment", () => {
  const m = { utcOffset: () => m, format: () => h.dateKey, hour: () => h.hour };
  const moment = () => m;
  moment.utc = () => m;
  return { default: moment };
});
vi.mock("../../../resources/logs/logger.log.js", () => ({ default: { info: h.loggerInfo, error: h.loggerError, warn: vi.fn() } }));
vi.mock("../../../core/mailer/reportRecipientsService.js", () => ({ resolveDailyRecipients: h.resolveDailyRecipients }));
vi.mock("../../../core/mailer/dataReportStatsService.js", () => ({ getDataReportStats: h.getDataReportStats }));
vi.mock("../../../core/mailer/dataReportEmailService.js", () => ({ default: { sendDataReport: h.sendDataReport } }));
vi.mock("../../../core/mailer/emailAudit.js", () => ({ dataReportSendId: h.dataReportSendId, seedQueued: h.seedQueued }));
vi.mock("../../../models/emailRunStatus.js", () => ({ default: { updateOne: h.updateOne } }));

let mod;
async function load() {
  vi.resetModules();
  mod = await import("../../../core/mailer/dataReportCron.js");
  return mod;
}

beforeEach(() => {
  for (const k of ["readFileSync","writeFileSync","mkdirSync","existsSync","unlinkSync","schedule","resolveDailyRecipients","getDataReportStats","sendDataReport","dataReportSendId","seedQueued","updateOne","loggerInfo","loggerError"]) h[k].mockReset();
  h.cfg = { cron: true, daily_report_cron_schedule: "0 3 * * *" };
  h.dateKey = "2026-06-16";
  h.hour = 5;
  h.lastRun = {};
  h.cache = {};
  h.readFileSync.mockImplementation((file) => {
    const f = String(file);
    if (f.includes("last_run")) return JSON.stringify(h.lastRun);
    if (f.includes("cache")) return JSON.stringify(h.cache);
    throw new Error("nofile");
  });
  h.existsSync.mockReturnValue(true);
  h.resolveDailyRecipients.mockResolvedValue({ recipients: ["a@b.c"], source: "amember", totalSubscribed: 1, suppressedExcluded: 0 });
  h.getDataReportStats.mockResolvedValue({ grand: { last24h: 5, total: 10 } });
  h.sendDataReport.mockResolvedValue({});
  h.seedQueued.mockResolvedValue();
  h.updateOne.mockResolvedValue({});
  h.dataReportSendId.mockReturnValue("sid");
});

describe("dataReportCron > runDailyReport", () => {
  it("fresh full run: fetches recipients+stats, sends, writes last-run, clears cache", async () => {
    const { runDailyReport } = await load();
    await runDailyReport("test");
    expect(h.resolveDailyRecipients).toHaveBeenCalled();
    expect(h.getDataReportStats).toHaveBeenCalled();
    expect(h.seedQueued).toHaveBeenCalledWith("dataReport", "2026-06-16", ["a@b.c"]);
    expect(h.sendDataReport).toHaveBeenCalledWith(expect.objectContaining({ to: "a@b.c", send_id: "sid" }));
    expect(h.unlinkSync).toHaveBeenCalled(); // cache deleted
    const lastRunWrite = h.writeFileSync.mock.calls.find((c) => String(c[0]).includes("last_run"));
    expect(lastRunWrite).toBeTruthy();
    expect(h.updateOne).toHaveBeenCalled(); // setRunStatus
  });

  it("already completed for today → skip", async () => {
    h.lastRun = { date: "2026-06-16" };
    const { runDailyReport } = await load();
    await runDailyReport("test");
    expect(h.resolveDailyRecipients).not.toHaveBeenCalled();
    expect(h.loggerInfo).toHaveBeenCalledWith(expect.stringContaining("already completed"));
  });

  it("concurrent invocation → second sees running flag and skips", async () => {
    let release;
    h.resolveDailyRecipients.mockReturnValue(new Promise((r) => { release = () => r({ recipients: ["a@b.c"], source: "x", totalSubscribed: 1, suppressedExcluded: 0 }); }));
    const { runDailyReport } = await load();
    const p1 = runDailyReport("first");
    const p2 = runDailyReport("second");
    await p2; // returns immediately via running guard
    expect(h.loggerInfo).toHaveBeenCalledWith(expect.stringContaining("already in progress"));
    release();
    await p1;
  });

  it("resume from cache: reuses recipients+stats, skips already-sent", async () => {
    h.cache = { date: "2026-06-16", recipients: ["a@b.c"], stats: { grand: { last24h: 1, total: 2 } }, sent: ["A@B.c"] };
    const { runDailyReport } = await load();
    await runDailyReport("test");
    expect(h.resolveDailyRecipients).not.toHaveBeenCalled();
    expect(h.getDataReportStats).not.toHaveBeenCalled();
    expect(h.sendDataReport).not.toHaveBeenCalled(); // a@b.c already sent (case-insensitive)
    expect(h.loggerInfo).toHaveBeenCalledWith(expect.stringContaining("reusing cached recipients"));
    expect(h.loggerInfo).toHaveBeenCalledWith(expect.stringContaining("reusing cached stats"));
  });

  it("same-day cache missing `sent` key → `|| []` fallback", async () => {
    h.cache = { date: "2026-06-16", recipients: ["a@b.c"], stats: { grand: { last24h: 1, total: 2 } } }; // no `sent`
    const { runDailyReport } = await load();
    await runDailyReport("test");
    expect(h.sendDataReport).toHaveBeenCalledWith(expect.objectContaining({ to: "a@b.c" })); // nothing sent yet → mails
  });

  it("no recipients → marks done, no send", async () => {
    h.resolveDailyRecipients.mockResolvedValue({ recipients: [], source: "x", totalSubscribed: 0, suppressedExcluded: 0 });
    const { runDailyReport } = await load();
    await runDailyReport("test");
    expect(h.sendDataReport).not.toHaveBeenCalled();
    expect(h.loggerInfo).toHaveBeenCalledWith(expect.stringContaining("no recipients"));
    expect(h.updateOne).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ $set: expect.objectContaining({ note: "no recipients" }) }), expect.anything());
  });

  it("send loop: failures counted + progress persisted every 20", async () => {
    const recips = Array.from({ length: 20 }, (_, i) => `u${i}@x.c`);
    h.resolveDailyRecipients.mockResolvedValue({ recipients: recips, source: "x", totalSubscribed: 20, suppressedExcluded: 0 });
    h.sendDataReport.mockImplementation(({ to }) => to === "u5@x.c" ? Promise.reject(new Error("boom")) : Promise.resolve({}));
    const { runDailyReport } = await load();
    await runDailyReport("test");
    expect(h.sendDataReport).toHaveBeenCalledTimes(20);
    expect(h.loggerError).toHaveBeenCalledWith(expect.stringContaining("send failed u5@x.c"));
    expect(h.loggerInfo).toHaveBeenCalledWith(expect.stringContaining("progress 20/20"));
  });

  it("error mid-run → caught, logged, cache kept (no last-run write)", async () => {
    h.getDataReportStats.mockRejectedValue(new Error("es-down"));
    const { runDailyReport } = await load();
    await runDailyReport("test");
    expect(h.loggerError).toHaveBeenCalledWith(expect.stringContaining("run error"));
    const lastRunWrite = h.writeFileSync.mock.calls.find((c) => String(c[0]).includes("last_run"));
    expect(lastRunWrite).toBeFalsy();
  });

  it("setRunStatus failure is swallowed (logged, run continues)", async () => {
    h.updateOne.mockRejectedValue(new Error("mongo-down"));
    const { runDailyReport } = await load();
    await runDailyReport("test");
    expect(h.loggerError).toHaveBeenCalledWith(expect.stringContaining("run-status write failed"));
    expect(h.sendDataReport).toHaveBeenCalled(); // still proceeded
  });

  it("writeJson failure is swallowed (logged)", async () => {
    h.writeFileSync.mockImplementation(() => { throw new Error("disk-full"); });
    const { runDailyReport } = await load();
    await runDailyReport("test");
    expect(h.loggerError).toHaveBeenCalledWith(expect.stringContaining("write failed"));
  });

  it("deleteFile: missing cache file → no unlink", async () => {
    h.existsSync.mockReturnValue(false);
    const { runDailyReport } = await load();
    await runDailyReport("test");
    expect(h.unlinkSync).not.toHaveBeenCalled();
  });

  it("deleteFile failure is swallowed (logged)", async () => {
    h.unlinkSync.mockImplementation(() => { throw new Error("locked"); });
    const { runDailyReport } = await load();
    await runDailyReport("test");
    expect(h.loggerError).toHaveBeenCalledWith(expect.stringContaining("delete failed"));
  });

  it("corrupt json on disk → readJson returns {} (treated as empty/fresh)", async () => {
    h.readFileSync.mockReturnValue("{ not json");
    const { runDailyReport } = await load();
    await runDailyReport("test");
    expect(h.resolveDailyRecipients).toHaveBeenCalled(); // fresh run proceeded
  });
});

describe("dataReportCron > initDataReportCron", () => {
  it("disabled (cron false) → no schedule", async () => {
    h.cfg.cron = false;
    const { initDataReportCron } = await load();
    initDataReportCron();
    expect(h.schedule).not.toHaveBeenCalled();
    expect(h.loggerInfo).toHaveBeenCalledWith(expect.stringContaining("disabled"));
  });

  it("config.get(cron) throws → treated as disabled", async () => {
    h.cfg.cron = "__THROW__";
    const { initDataReportCron } = await load();
    initDataReportCron();
    expect(h.schedule).not.toHaveBeenCalled();
  });

  it("enabled + past trigger + not done → schedules and catches up", async () => {
    h.hour = 5; // >= 3
    h.lastRun = {}; // not done today
    const { initDataReportCron } = await load();
    initDataReportCron();
    expect(h.schedule).toHaveBeenCalledWith("0 3 * * *", expect.any(Function), { timezone: "Asia/Kolkata" });
    expect(h.loggerInfo).toHaveBeenCalledWith(expect.stringContaining("catching up"));
    await Promise.resolve(); // let the catchup microtask settle
  });

  it("scheduled callback invokes runDailyReport", async () => {
    h.hour = 1; // < 3 → no catchup so we isolate the schedule callback
    const { initDataReportCron } = await load();
    initDataReportCron();
    const cb = h.schedule.mock.calls[0][1];
    await cb();
    expect(h.resolveDailyRecipients).toHaveBeenCalled();
  });

  it("past trigger but already done → no catchup", async () => {
    h.hour = 5;
    h.lastRun = { date: "2026-06-16" };
    const { initDataReportCron } = await load();
    initDataReportCron();
    expect(h.loggerInfo).not.toHaveBeenCalledWith(expect.stringContaining("catching up"));
  });

  it("before trigger hour → no catchup", async () => {
    h.hour = 1; // < 3
    const { initDataReportCron } = await load();
    initDataReportCron();
    expect(h.loggerInfo).not.toHaveBeenCalledWith(expect.stringContaining("catching up"));
  });

  it("non-single-hour schedule → triggerHour falls back to 0", async () => {
    h.cfg.daily_report_cron_schedule = "0 */6 * * *";
    h.hour = 0;
    const { initDataReportCron } = await load();
    initDataReportCron();
    expect(h.schedule).toHaveBeenCalledWith("0 */6 * * *", expect.any(Function), expect.anything());
    expect(h.loggerInfo).toHaveBeenCalledWith(expect.stringContaining("catching up")); // hour 0 >= 0
    await Promise.resolve();
  });

  it("schedule config missing → falls back to default '0 3 * * *'", async () => {
    h.cfg.daily_report_cron_schedule = "";
    h.hour = 1;
    const { initDataReportCron } = await load();
    initDataReportCron();
    expect(h.schedule).toHaveBeenCalledWith("0 3 * * *", expect.any(Function), expect.anything());
  });

  it("schedule config throws → falls back to default", async () => {
    h.cfg.daily_report_cron_schedule = "__THROW__";
    h.hour = 1;
    const { initDataReportCron } = await load();
    initDataReportCron();
    expect(h.schedule).toHaveBeenCalledWith("0 3 * * *", expect.any(Function), expect.anything());
  });
});
