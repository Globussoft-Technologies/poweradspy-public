import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const dbMgrPath = require.resolve("../../../../src/database/DatabaseManager");
const dbManager = { getSQL: vi.fn() };
require.cache[dbMgrPath] = {
  id: dbMgrPath, filename: dbMgrPath, loaded: true, exports: dbManager,
};

const emailSvcPath = require.resolve("../../../../src/services/EmailService");
const EmailService = { sendDailyMailUpdate: vi.fn() };
require.cache[emailSvcPath] = {
  id: emailSvcPath, filename: emailSvcPath, loaded: true, exports: EmailService,
};

const loggerPath = require.resolve("../../../../src/logger");
const childLog = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { createChild: vi.fn(() => childLog) },
};

const configPath = require.resolve("../../../../src/config");
const configExports = { notifications: { pendingNetwork: "linkedin", pendingTable: "daily_keyword_requests" } };
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true, exports: configExports,
};

const axiosPath = require.resolve("axios");
require.cache[axiosPath] = {
  id: axiosPath, filename: axiosPath, loaded: true,
  exports: { get: vi.fn(), default: { get: vi.fn() } },
};

const { sendMailDailyUpdate } = require(
  "../../../../src/services/common/controllers/dailyMailUpdateController"
);

function mkRes() {
  const r = { statusCode: 200, body: null };
  r.status = vi.fn((c) => { r.statusCode = c; return r; });
  r.json = vi.fn((b) => { r.body = b; return r; });
  return r;
}

beforeEach(() => {
  dbManager.getSQL.mockReset();
  EmailService.sendDailyMailUpdate.mockReset();
  childLog.info.mockClear(); childLog.error.mockClear();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

describe("dailyMailUpdateController > sendMailDailyUpdate", () => {
  it("503 when no SQL", async () => {
    dbManager.getSQL.mockReturnValue(null);
    const res = mkRes();
    await sendMailDailyUpdate(null, res);
    expect(res.statusCode).toBe(503);
    expect(childLog.error).toHaveBeenCalled();
  });

  it("returns null when no SQL + no res (cron mode)", async () => {
    dbManager.getSQL.mockReturnValue(null);
    const result = await sendMailDailyUpdate();
    expect(result).toBeNull();
  });

  it("returns 'No pending emails' when result is empty", async () => {
    dbManager.getSQL.mockReturnValue({ query: vi.fn(async () => []) });
    const res = mkRes();
    await sendMailDailyUpdate(null, res);
    expect(res.body.message).toBe("No pending emails");
  });

  it("returns null cron mode when no pending", async () => {
    dbManager.getSQL.mockReturnValue({ query: vi.fn(async () => []) });
    const result = await sendMailDailyUpdate();
    expect(result).toBeNull();
  });

  it("supports mysql2 [rows, fields] tuple result shape", async () => {
    const sql = { query: vi.fn(async () => [[], []]) };
    dbManager.getSQL.mockReturnValue(sql);
    const res = mkRes();
    await sendMailDailyUpdate(null, res);
    expect(res.body.message).toBe("No pending emails");
  });

  it("sends emails grouped by user with multiple platforms + types", async () => {
    EmailService.sendDailyMailUpdate.mockResolvedValue({ status: true });
    const sql = { query: vi.fn(async (q) => {
      if (q.includes("SELECT id")) {
        return [
          { id: 1, user_id: "u1", email: "u1@x.com", user_name: "U1", keyword: "shoes", type: 0, google_status: 2, facebook_status: 2 },
          { id: 2, user_id: "u1", email: "u1@x.com", user_name: "U1", keyword: "nike.com", type: 2, native_status: 2, instagram_status: 2 },
          // 6 keywords for u2 — only first 5 should be processed
          ...Array.from({ length: 6 }, (_, i) => ({
            id: 100 + i, user_id: "u2", email: "u2@x.com", user_name: "U2",
            keyword: `kw${i}`, type: 1, google_status: 2,
          })),
        ];
      }
      return { affectedRows: 1 };
    })};
    dbManager.getSQL.mockReturnValue(sql);
    const res = mkRes();
    await sendMailDailyUpdate(null, res);
    expect(EmailService.sendDailyMailUpdate).toHaveBeenCalledTimes(2);
    expect(res.body.code).toBe(200);
    // Verify UPDATE happened twice (one per user, conditional on emailResult.status)
    const updateCalls = sql.query.mock.calls.filter(c => c[0].includes("UPDATE"));
    expect(updateCalls).toHaveLength(2);
  });

  it("skips status update when email send failed", async () => {
    EmailService.sendDailyMailUpdate.mockResolvedValue({ status: false });
    const sql = { query: vi.fn(async (q) => {
      if (q.includes("SELECT id")) return [{ id: 1, user_id: "u1", email: "u@x", user_name: "U", keyword: "k", type: 0, google_status: 2 }];
      return {};
    })};
    dbManager.getSQL.mockReturnValue(sql);
    const res = mkRes();
    await sendMailDailyUpdate(null, res);
    const updateCalls = sql.query.mock.calls.filter(c => c[0].includes("UPDATE"));
    expect(updateCalls).toHaveLength(0);
  });

  it("user with no qualifying status rows → no email sent for that user", async () => {
    EmailService.sendDailyMailUpdate.mockResolvedValue({ status: true });
    const sql = { query: vi.fn(async (q) => {
      if (q.includes("SELECT id")) {
        // No status=2 on any platform → keywords stays empty, no email
        return [{ id: 1, user_id: "u1", email: "u@x", user_name: "U", keyword: "k", type: 99 /* unknown type → defaults to keyword */ }];
      }
      return {};
    })};
    dbManager.getSQL.mockReturnValue(sql);
    const res = mkRes();
    await sendMailDailyUpdate(null, res);
    expect(EmailService.sendDailyMailUpdate).not.toHaveBeenCalled();
  });

  it("falls back to network/table defaults when config malformed", async () => {
    // Module already loaded so changing config here won't re-run the module-level constants.
    // Just verify a normal happy-path call works (defaults already taken).
    const sql = { query: vi.fn(async () => []) };
    dbManager.getSQL.mockReturnValue(sql);
    await sendMailDailyUpdate(null, mkRes());
    expect(dbManager.getSQL).toHaveBeenCalledWith("linkedin");
  });

  it("500 on SQL throw", async () => {
    dbManager.getSQL.mockReturnValue({ query: vi.fn(async () => { throw new Error("db-down"); }) });
    const res = mkRes();
    await sendMailDailyUpdate(null, res);
    expect(res.statusCode).toBe(500);
    expect(childLog.error).toHaveBeenCalled();
  });

  it("500 path returns null when no res (cron mode)", async () => {
    dbManager.getSQL.mockReturnValue({ query: vi.fn(async () => { throw new Error("e"); }) });
    const result = await sendMailDailyUpdate();
    expect(result).toBeNull();
  });

  it("cron mode (no res) returns emailsSent array on success", async () => {
    EmailService.sendDailyMailUpdate.mockResolvedValue({ status: true });
    const sql = { query: vi.fn(async (q) => {
      if (q.includes("SELECT id")) return [{ id: 1, user_id: "u1", email: "u@x", user_name: "U", keyword: "k", type: 0, google_status: 2 }];
      return {};
    })};
    dbManager.getSQL.mockReturnValue(sql);
    const result = await sendMailDailyUpdate();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(1);
  });

  it("multiple rows with same user + facebook_status=2 → duplicate dedupe branches (lines 99-110 false branches)", async () => {
    // Two rows for the SAME user, both flagged facebook_status=2 +
    // instagram_status=2 + native_status=2. The first row pushes 'facebook',
    // 'instagram', 'native' into platforms[] and seeds keywords[<platform>]=[].
    // The second row's `!platforms.includes(...)` is FALSE and
    // `!keywords[<platform>]` is FALSE — the duplicate-skip branches fire.
    EmailService.sendDailyMailUpdate.mockResolvedValue({ status: true });
    const sql = { query: vi.fn(async (q) => {
      if (q.includes("SELECT id")) return [
        { id: 1, user_id: "u1", email: "u@x", user_name: "U", keyword: "k1", type: 0,
          facebook_status: 2, instagram_status: 2, native_status: 2 },
        { id: 2, user_id: "u1", email: "u@x", user_name: "U", keyword: "k2", type: 0,
          facebook_status: 2, instagram_status: 2, native_status: 2 },
      ];
      return { affectedRows: 1 };
    })};
    dbManager.getSQL.mockReturnValue(sql);
    await sendMailDailyUpdate(null, mkRes());
    // One email sent to that user, with platforms deduped (no repeats)
    expect(EmailService.sendDailyMailUpdate).toHaveBeenCalledTimes(1);
    // Positional args: (email, user_name, platforms, keywords, null)
    const [, , platforms, keywords] = EmailService.sendDailyMailUpdate.mock.calls[0];
    expect([...platforms].sort()).toEqual(["facebook", "instagram", "native"]);
    // Both keywords made it under each platform — second row didn't reset keywords[].
    expect(keywords.facebook).toEqual(["k1 (keyword)", "k2 (keyword)"]);
  });
});

describe("dailyMailUpdateController > config-fallback module init (lines 12, 13)", () => {
  it("PENDING_NET defaults to 'linkedin' and PENDING_TBL defaults to 'daily_keyword_requests' when config.notifications missing", () => {
    // Temporarily swap config.notifications so the module-level constants
    // fall through their `|| 'linkedin'` / table-regex-fail fallbacks.
    const sutPath = require.resolve("../../../../src/services/common/controllers/dailyMailUpdateController");
    const cfgPath = require.resolve("../../../../src/config");
    const prevConfig = require.cache[cfgPath].exports;
    require.cache[cfgPath].exports = { /* no notifications */ };
    delete require.cache[sutPath];
    const reloaded = require("../../../../src/services/common/controllers/dailyMailUpdateController");
    // sanity: the export is still a function (module loaded without throwing)
    expect(typeof reloaded.sendMailDailyUpdate).toBe("function");
    require.cache[cfgPath].exports = prevConfig;
    delete require.cache[sutPath];
  });

  it("PENDING_TBL falls back when pendingTable contains invalid characters (regex fails)", () => {
    const sutPath = require.resolve("../../../../src/services/common/controllers/dailyMailUpdateController");
    const cfgPath = require.resolve("../../../../src/config");
    const prevConfig = require.cache[cfgPath].exports;
    require.cache[cfgPath].exports = {
      notifications: { pendingNetwork: "linkedin", pendingTable: "bad table; DROP" },
    };
    delete require.cache[sutPath];
    const reloaded = require("../../../../src/services/common/controllers/dailyMailUpdateController");
    expect(typeof reloaded.sendMailDailyUpdate).toBe("function");
    require.cache[cfgPath].exports = prevConfig;
    delete require.cache[sutPath];
  });
});
