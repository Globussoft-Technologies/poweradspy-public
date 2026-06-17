import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  cfg: {},
  sgSend: vi.fn(),
  sgSetApiKey: vi.fn(),
  getDataReportStats: vi.fn(),
  newSendId: vi.fn(() => "sid"),
  logSend: vi.fn(),
  isBlacklisted: vi.fn(),
  loggerInfo: vi.fn(),
  loggerError: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("fs", () => ({ default: { readFileSync: (...a) => h.readFileSync(...a) } }));
vi.mock("@sendgrid/mail", () => ({ default: { send: h.sgSend, setApiKey: h.sgSetApiKey } }));
vi.mock("config", () => ({ default: { get: (k) => { const v = h.cfg[k]; if (v === "__THROW__") throw new Error("unset"); return v; } } }));
vi.mock("../../../resources/logs/logger.log.js", () => ({ default: { info: h.loggerInfo, error: h.loggerError, warn: vi.fn() } }));
vi.mock("../../../core/mailer/dataReportStatsService.js", () => ({ getDataReportStats: h.getDataReportStats }));
vi.mock("../../../core/mailer/emailAudit.js", () => ({ newSendId: h.newSendId, logSend: h.logSend }));
vi.mock("../../../core/mailer/bounceGuard.js", () => ({ isBlacklisted: h.isBlacklisted, BLACKLISTED_SKIP_REASON: "bounced-skip" }));

const TEMPLATE = "{{greeting}}|{{grandLast24h}}|{{activePlatforms}}|{{topPlatform}}|{{allTimeTracked}}|{{platformRowsHtml}}|{{ctaUrl}}|{{unsubscribe_link}}|{{logoUrl}}|{{dateLabel}}|{{generatedAt}}|{{createProjectUrl}}|{{manageUrl}}";

const statsFixture = () => ({
  grand: { last24h: 1500000, total: 12000000 },
  platforms: [
    { key: "facebook", label: "Facebook", ok: true, last24h: 1000000, total: 8000000 },
    { key: "tiktok", ok: true, last24h: 500, total: 4000000 },           // no label → fallback; small number
    { key: "google", ok: false, last24h: 999, total: 1 },                 // ok:false → filtered
    { key: "zzz", ok: true, last24h: 0, total: 0 },                       // below threshold → filtered
  ],
});

async function load() {
  vi.resetModules();
  return (await import("../../../core/mailer/dataReportEmailService.js")).default;
}

beforeEach(() => {
  h.cfg = {
    SENDGRID_API_KEY: "K", SENDGRID_FROM: "from@x.c",
    assets_base_url: "http://assets/", assets_mode: "inline",
    app_url: "http://app/", DATA_REPORT_MIN_ADS: 1,
  };
  h.sgSend.mockReset().mockResolvedValue([{ statusCode: 202, headers: { "x-message-id": "mid-1" } }]);
  h.sgSetApiKey.mockReset();
  h.getDataReportStats.mockReset().mockResolvedValue(statsFixture());
  h.newSendId.mockReset().mockReturnValue("sid");
  h.logSend.mockReset().mockResolvedValue();
  h.isBlacklisted.mockReset().mockResolvedValue(false);
  h.loggerInfo.mockReset();
  h.loggerError.mockReset();
  h.readFileSync.mockReset().mockImplementation((p) => {
    if (String(p).includes("dataReport.html")) return TEMPLATE;
    return Buffer.from("imgbytes");
  });
});

describe("dataReportEmailService > sendDataReport", () => {
  it("no recipient → throws", async () => {
    const svc = await load();
    await expect(svc.sendDataReport({})).rejects.toThrow(/Missing recipient/);
  });

  it("computes stats + sends; returns statusCode/msgId; logs sent", async () => {
    const svc = await load();
    const out = await svc.sendDataReport({ to: "a@b.c", name: "Joe" });
    expect(out.statusCode).toBe(202);
    expect(out.msgId).toBe("mid-1");
    expect(h.sgSend).toHaveBeenCalled();
    expect(h.logSend).toHaveBeenCalledWith(expect.objectContaining({ status: "sent" }));
  });

  it("uses supplied stats (skips getDataReportStats)", async () => {
    const svc = await load();
    await svc.sendDataReport({ to: "a@b.c", stats: statsFixture() });
    expect(h.getDataReportStats).not.toHaveBeenCalled();
  });

  it("blacklisted recipient → skip log + throws", async () => {
    h.isBlacklisted.mockResolvedValue(true);
    const svc = await load();
    await expect(svc.sendDataReport({ to: "a@b.c" })).rejects.toThrow(/bounced-skip/);
    expect(h.logSend).toHaveBeenCalledWith(expect.objectContaining({ status: "skipped" }));
  });

  it("sgMail.send throws → logs failed + rethrows", async () => {
    h.sgSend.mockRejectedValue(new Error("sg-down"));
    const svc = await load();
    await expect(svc.sendDataReport({ to: "a@b.c" })).rejects.toThrow("sg-down");
    expect(h.logSend).toHaveBeenCalledWith(expect.objectContaining({ status: "failed" }));
  });

  it("send response without msg-id headers → msgId '(no-msg-id)' → null logged", async () => {
    h.sgSend.mockResolvedValue([{ statusCode: 202, headers: {} }]);
    const svc = await load();
    const out = await svc.sendDataReport({ to: "a@b.c" });
    expect(out.msgId).toBe("(no-msg-id)");
    expect(h.logSend).toHaveBeenCalledWith(expect.objectContaining({ sendgrid_message_id: null }));
  });

  it("send response as a non-array object", async () => {
    h.sgSend.mockResolvedValue({ status: 200, headers: { "X-Message-Id": "mid-2" } });
    const svc = await load();
    const out = await svc.sendDataReport({ to: "a@b.c" });
    expect(out.statusCode).toBe(200);
    expect(out.msgId).toBe("mid-2");
  });
});

describe("dataReportEmailService > sendDataReportBulk", () => {
  it("no recipients → throws", async () => {
    const svc = await load();
    await expect(svc.sendDataReportBulk({ recipients: ["", "  "] })).rejects.toThrow(/No recipients/);
  });

  it("single string recipient", async () => {
    const svc = await load();
    const out = await svc.sendDataReportBulk({ recipients: "a@b.c", name: "Al" });
    expect(out.sent).toHaveLength(1);
  });

  it("array: one ok, one failing → split sent/failed", async () => {
    h.sgSend.mockImplementation((opts) => opts.to === "bad@x.c" ? Promise.reject(new Error("boom")) : Promise.resolve([{ statusCode: 202, headers: { "x-message-id": "m" } }]));
    const svc = await load();
    const out = await svc.sendDataReportBulk({ recipients: ["a@b.c", "bad@x.c"], name: "Al" });
    expect(out.sent).toHaveLength(1);
    expect(out.failed).toHaveLength(1);
    expect(h.loggerError).toHaveBeenCalled();
  });
});

describe("dataReportEmailService > renderTemplate branches (via send)", () => {
  it("name present → 'Good morning, <name>'; topPlatform from highest", async () => {
    const svc = await load();
    await svc.sendDataReport({ to: "a@b.c", name: "Riya" });
    const html = h.sgSend.mock.calls[0][0].html;
    expect(html).toContain("Good morning, Riya");
    expect(html).toContain("Facebook"); // top platform row
  });

  it("no app_url → links collapse to '#'; no name → 'Good morning'", async () => {
    h.cfg.app_url = "__THROW__"; // config.get throws → appUrl ""
    const svc = await load();
    await svc.sendDataReport({ to: "a@b.c" });
    const html = h.sgSend.mock.calls[0][0].html;
    expect(html).toContain("Good morning|");
    expect(html).toContain("#"); // cta/manage urls are '#'
  });

  it("k-range numbers + platform with no label/strip/icon (fallbacks) + grand.last24h 0", async () => {
    h.getDataReportStats.mockResolvedValue({
      grand: { last24h: 0, total: 50000 }, // total 50k (>=10k, 0 dec); grand 0 → pctToday 0
      platforms: [
        { key: "custom", ok: true, last24h: 5000, total: 5000 }, // not in LABELS/STRIP/ICONS; 5k (<10k, 1 dec); dot icon
      ],
    });
    const svc = await load();
    await svc.sendDataReport({ to: "a@b.c" });
    const html = h.sgSend.mock.calls[0][0].html;
    expect(html).toContain("custom"); // label fell back to key
    expect(html).toContain("5k");
    expect(html).toContain("50k");
  });

  it("stats with empty grand → meta `?? 0` fallbacks", async () => {
    const svc = await load();
    await svc.sendDataReport({ to: "a@b.c", stats: { grand: {}, platforms: [] } });
    expect(h.logSend).toHaveBeenCalledWith(expect.objectContaining({ meta: { todayTotal: 0, allTime: 0 } }));
  });

  it("send resp without statusCode/status → '?' fallback", async () => {
    h.sgSend.mockResolvedValue([{ headers: { "x-message-id": "m" } }]);
    const svc = await load();
    const out = await svc.sendDataReport({ to: "a@b.c" });
    expect(out.statusCode).toBe("?");
  });

  it("send rejects with a non-Error (no .message) → 'send error' logged", async () => {
    h.sgSend.mockRejectedValue({ notAnError: true });
    const svc = await load();
    await expect(svc.sendDataReport({ to: "a@b.c" })).rejects.toBeTruthy();
    expect(h.logSend).toHaveBeenCalledWith(expect.objectContaining({ status: "failed", failure_reason: "send error" }));
  });

  it("renderTemplate with no email → unsubscribe `email || ''` fallback", async () => {
    const svc = await load();
    const html = svc.renderTemplate(statsFixture(), { name: "X" }); // no email
    expect(html).toContain("unsubscribe-page?email=&"); // empty email in the link
  });

  it("no platforms above threshold → empty rows + topPlatform '—'", async () => {
    h.getDataReportStats.mockResolvedValue({ grand: { last24h: 0, total: 0 }, platforms: [{ key: "x", ok: false, last24h: 0, total: 0 }] });
    const svc = await load();
    await svc.sendDataReport({ to: "a@b.c" });
    const html = h.sgSend.mock.calls[0][0].html;
    expect(html).toContain("—"); // em dash for no top platform
  });
});

describe("dataReportEmailService > asset + config branches (module load)", () => {
  it("assets_mode='url' → assetUrl uses URLs (no fs read for icons)", async () => {
    h.cfg.assets_mode = "url";
    const svc = await load();
    await svc.sendDataReport({ to: "a@b.c" });
    const html = h.sgSend.mock.calls[0][0].html;
    expect(html).toContain("http://assets/"); // logo via URL
  });

  it("assets config unset → defaults (inline mode, localhost base)", async () => {
    h.cfg.assets_base_url = "__THROW__";
    h.cfg.assets_mode = "__THROW__";
    const svc = await load();
    await svc.sendDataReport({ to: "a@b.c" });
    expect(h.sgSend).toHaveBeenCalled();
  });

  it("fileToDataUri readFileSync error → '' (logged)", async () => {
    h.readFileSync.mockImplementation((p) => {
      if (String(p).includes("dataReport.html")) return TEMPLATE;
      throw new Error("no file");
    });
    const svc = await load();
    await svc.sendDataReport({ to: "a@b.c" });
    expect(h.loggerError).toHaveBeenCalled(); // fileToDataUri failures logged at module load
  });

  it("DATA_REPORT_MIN_ADS non-numeric → default 0 path", async () => {
    h.cfg.DATA_REPORT_MIN_ADS = "abc"; // Number → NaN → both checks fail → default 0
    const svc = await load();
    await svc.sendDataReport({ to: "a@b.c" });
    expect(h.sgSend).toHaveBeenCalled();
  });

  it("DATA_REPORT_MIN_ADS empty string → 0 via first path", async () => {
    h.cfg.DATA_REPORT_MIN_ADS = "";
    const svc = await load();
    await svc.sendDataReport({ to: "a@b.c" });
    expect(h.sgSend).toHaveBeenCalled();
  });
});
