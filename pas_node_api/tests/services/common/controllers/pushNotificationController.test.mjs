import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// ── Pre-stub dbManager ───────────────────────────────────────────────────────
const dbmPath = require.resolve("../../../../src/database/DatabaseManager");
const fakeDbm = { getSQL: vi.fn() };
require.cache[dbmPath] = {
  id: dbmPath, filename: dbmPath, loaded: true, exports: fakeDbm,
};

// ── Pre-stub firebaseService ─────────────────────────────────────────────────
const fbPath = require.resolve("../../../../src/services/FirebaseService");
const fakeFb = { sendNotification: vi.fn() };
require.cache[fbPath] = {
  id: fbPath, filename: fbPath, loaded: true, exports: fakeFb,
};

// ── Pre-stub logger ──────────────────────────────────────────────────────────
const logChild = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const loggerPath = require.resolve("../../../../src/logger");
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { createChild: vi.fn(() => logChild) },
};

// ── Pre-stub config ──────────────────────────────────────────────────────────
const configPath = require.resolve("../../../../src/config");
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true,
  exports: {
    notifications: {
      pendingNetwork: "linkedin",
      tokenNetwork: "facebook",
      pendingTable: "daily_keyword_requests",
      tokenTable: "am_user_action",
      inAppTable: "ad_notifications",
    },
  },
};

// ── Pre-stub axios (imported but unused in tested paths) ─────────────────────
const axiosPath = require.resolve("axios");
require.cache[axiosPath] = {
  id: axiosPath, filename: axiosPath, loaded: true, exports: { default: {} },
};

const sutPath = require.resolve("../../../../src/services/common/controllers/pushNotificationController");
delete require.cache[sutPath];
const sut = require(sutPath);

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}
function fakeSql(impl) {
  return { query: vi.fn(impl) };
}

beforeEach(() => {
  fakeDbm.getSQL.mockReset();
  fakeFb.sendNotification.mockReset().mockResolvedValue();
  logChild.info.mockReset();
  logChild.warn.mockReset();
  logChild.error.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  delete process.env.APP_URL;
});

describe("pushNotificationController > registerToken", () => {
  it("400 when userId missing", async () => {
    const res = mockRes();
    await sut.registerToken({ body: { fcmToken: "t" } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it("400 when fcmToken missing", async () => {
    const res = mockRes();
    await sut.registerToken({ body: { userId: 1 } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it("503 when token DB unavailable", async () => {
    fakeDbm.getSQL.mockReturnValue(null);
    const res = mockRes();
    await sut.registerToken({ body: { userId: 1, fcmToken: "abc" }, user: { email: "x@y.z" } }, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });
  it("200 success path", async () => {
    fakeDbm.getSQL.mockReturnValue(fakeSql(async () => [{ affectedRows: 1 }]));
    const res = mockRes();
    await sut.registerToken({ body: { userId: 1, fcmToken: "abcdefghijklmnopqrstuvwxyz" }, user: { email: "x@y.z" } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 200 }));
  });
  it("200 success when req.user is undefined", async () => {
    fakeDbm.getSQL.mockReturnValue(fakeSql(async () => [{ affectedRows: 1 }]));
    const res = mockRes();
    await sut.registerToken({ body: { userId: 1, fcmToken: "abcdefghijklmnopqrstuvwxyz" } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 200 }));
  });
  it("500 when DB query throws", async () => {
    fakeDbm.getSQL.mockReturnValue(fakeSql(async () => { throw new Error("db-down"); }));
    const res = mockRes();
    await sut.registerToken({ body: { userId: 1, fcmToken: "abc" } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("pushNotificationController > sendPushNotification", () => {
  it("400 on invalid action", async () => {
    const res = mockRes();
    await sut.sendPushNotification({ params: { action: "5" } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
  it("400 on invalid action, no res → null returned", async () => {
    const out = await sut.sendPushNotification({ params: { action: "5" } }, undefined);
    expect(out).toBeNull();
  });
  it("503 when token DB unavailable", async () => {
    fakeDbm.getSQL.mockReturnValue(null);
    const res = mockRes();
    await sut.sendPushNotification({ params: { action: "0" } }, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });
  it("503 when token DB unavailable + no res → null", async () => {
    fakeDbm.getSQL.mockReturnValue(null);
    const out = await sut.sendPushNotification({ params: { action: "0" } }, undefined);
    expect(out).toBeNull();
  });
  it("503 when pending DB unavailable (action 0)", async () => {
    fakeDbm.getSQL
      .mockReturnValueOnce(fakeSql(async () => [[]])) // token DB
      .mockReturnValueOnce(null); // pending DB
    const res = mockRes();
    await sut.sendPushNotification({ params: { action: "0" } }, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });
  it("503 when pending DB unavailable + no res → null", async () => {
    fakeDbm.getSQL
      .mockReturnValueOnce(fakeSql(async () => [[]]))
      .mockReturnValueOnce(null);
    const out = await sut.sendPushNotification({ params: { action: "0" } }, undefined);
    expect(out).toBeNull();
  });
  it("200 'No pending notifications' when empty rows", async () => {
    fakeDbm.getSQL
      .mockReturnValueOnce(fakeSql(async () => [[]]))
      .mockReturnValueOnce(fakeSql(async () => [[]]));
    const res = mockRes();
    await sut.sendPushNotification({ params: { action: "0" } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "No pending notifications" }));
  });
  it("no-res cron mode: returns {processed:0} when no pending", async () => {
    fakeDbm.getSQL
      .mockReturnValueOnce(fakeSql(async () => [[]]))
      .mockReturnValueOnce(fakeSql(async () => [[]]));
    const out = await sut.sendPushNotification({ params: { action: "0" } }, undefined);
    expect(out).toEqual({ processed: 0 });
  });
  it("no-res cron mode: defaults action to '0'", async () => {
    fakeDbm.getSQL
      .mockReturnValueOnce(fakeSql(async () => [[]]))
      .mockReturnValueOnce(fakeSql(async () => [[]]));
    const out = await sut.sendPushNotification(undefined, undefined);
    expect(out).toEqual({ processed: 0 });
  });
  it("processes pending: ads found, sends Firebase, updates status", async () => {
    const tokenSql = fakeSql(async (q) => {
      if (q.includes("SELECT am_id")) return [[{ am_id: 7, fcm_token: "fcm-7" }]];
      return [{ affectedRows: 1 }];
    });
    const pendingSql = fakeSql(async (q) => {
      if (q.startsWith("SELECT")) {
        return [[{
          id: 100, user_id: 7, keyword: "shoes", type: 0, email: "x@y.z",
          google_status: 2, facebook_status: 9, instagram_status: 9, native_status: 9,
        }]];
      }
      return [{ affectedRows: 1 }];
    });
    fakeDbm.getSQL.mockImplementation((net) => net === "facebook" ? tokenSql : pendingSql);
    const res = mockRes();
    await sut.sendPushNotification({ params: { action: "0" } }, res);
    expect(fakeFb.sendNotification).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ processed: 1 }));
  });
  it("processes pending: cron mode returns {processed: N}", async () => {
    const tokenSql = fakeSql(async (q) => {
      if (q.includes("SELECT am_id")) return [[{ am_id: 7, fcm_token: "fcm-7" }]];
      return [{ affectedRows: 1 }];
    });
    const pendingSql = fakeSql(async (q) => {
      if (q.startsWith("SELECT")) {
        return [[{
          id: 100, user_id: 7, keyword: "shoes", type: 1,
          google_status: 9, facebook_status: 9, instagram_status: 9, native_status: 9,
        }]];
      }
      return [{ affectedRows: 1 }];
    });
    fakeDbm.getSQL.mockImplementation((net) => net === "facebook" ? tokenSql : pendingSql);
    const out = await sut.sendPushNotification({ params: { action: "0" } }, undefined);
    expect(out).toEqual({ processed: 1 });
  });
  it("processes pending: missing FCM token → skip (continue)", async () => {
    const tokenSql = fakeSql(async (q) => {
      if (q.includes("SELECT am_id")) return [[]];
      return [{ affectedRows: 1 }];
    });
    const pendingSql = fakeSql(async (q) => {
      if (q.startsWith("SELECT")) {
        return [[{ id: 1, user_id: 99, keyword: "foo", type: 0,
          google_status: 9, facebook_status: 9, instagram_status: 9, native_status: 9 }]];
      }
      return [{ affectedRows: 1 }];
    });
    fakeDbm.getSQL.mockImplementation((net) => net === "facebook" ? tokenSql : pendingSql);
    const res = mockRes();
    await sut.sendPushNotification({ params: { action: "0" } }, res);
    expect(fakeFb.sendNotification).not.toHaveBeenCalled();
  });
  it("processes pending: domain type (2) uses domain URL", async () => {
    const tokenSql = fakeSql(async (q) => q.includes("SELECT am_id") ? [[{ am_id: 1, fcm_token: "t" }]] : [{ affectedRows: 1 }]);
    const pendingSql = fakeSql(async (q) => q.startsWith("SELECT")
      ? [[{ id: 1, user_id: 1, keyword: "x.com", type: 2, google_status: 9, facebook_status: 9, instagram_status: 9, native_status: 9 }]]
      : [{ affectedRows: 1 }]);
    fakeDbm.getSQL.mockImplementation((net) => net === "facebook" ? tokenSql : pendingSql);
    process.env.APP_URL = "https://example.com";
    await sut.sendPushNotification({ params: { action: "0" } }, mockRes());
    const args = fakeFb.sendNotification.mock.calls[0];
    expect(args[4]).toContain("/domain/x.com");
  });
  it("processes pending: bogus type (>2) falls back to keyword", async () => {
    const tokenSql = fakeSql(async (q) => q.includes("SELECT am_id") ? [[{ am_id: 1, fcm_token: "t" }]] : [{ affectedRows: 1 }]);
    const pendingSql = fakeSql(async (q) => q.startsWith("SELECT")
      ? [[{ id: 1, user_id: 1, keyword: "x", type: 9, google_status: 9, facebook_status: 9, instagram_status: 9, native_status: 9 }]]
      : [{ affectedRows: 1 }]);
    fakeDbm.getSQL.mockImplementation((net) => net === "facebook" ? tokenSql : pendingSql);
    await sut.sendPushNotification({ params: { action: "0" } }, mockRes());
    const args = fakeFb.sendNotification.mock.calls[0];
    expect(args[4]).toContain("/key/x");
  });
  it("dead FCM token → cleared from token table", async () => {
    let cleared = false;
    const tokenSql = fakeSql(async (q) => {
      if (q.includes("SELECT am_id")) return [[{ am_id: 7, fcm_token: "dead" }]];
      if (q.includes("SET fcm_token = NULL")) { cleared = true; return [{ affectedRows: 1 }]; }
      return [{ affectedRows: 1 }];
    });
    const pendingSql = fakeSql(async (q) => q.startsWith("SELECT")
      ? [[{ id: 1, user_id: 7, keyword: "k", type: 0, google_status: 9, facebook_status: 9, instagram_status: 9, native_status: 9 }]]
      : [{ affectedRows: 1 }]);
    fakeDbm.getSQL.mockImplementation((net) => net === "facebook" ? tokenSql : pendingSql);
    fakeFb.sendNotification.mockRejectedValueOnce(new Error("registration-token-not-registered"));
    await sut.sendPushNotification({ params: { action: "0" } }, mockRes());
    expect(cleared).toBe(true);
  });
  it("dead FCM token: clear query throws → caught and logged", async () => {
    const tokenSql = fakeSql(async (q) => {
      if (q.includes("SELECT am_id")) return [[{ am_id: 7, fcm_token: "dead" }]];
      if (q.includes("SET fcm_token = NULL")) throw new Error("clear-fail");
      return [{ affectedRows: 1 }];
    });
    const pendingSql = fakeSql(async (q) => q.startsWith("SELECT")
      ? [[{ id: 1, user_id: 7, keyword: "k", type: 0, google_status: 9, facebook_status: 9, instagram_status: 9, native_status: 9 }]]
      : [{ affectedRows: 1 }]);
    fakeDbm.getSQL.mockImplementation((net) => net === "facebook" ? tokenSql : pendingSql);
    fakeFb.sendNotification.mockRejectedValueOnce(new Error("not a valid FCM registration token"));
    await sut.sendPushNotification({ params: { action: "0" } }, mockRes());
    expect(logChild.error).toHaveBeenCalledWith("Failed to clear invalid FCM token", expect.any(Object));
  });
  it("non-dead-token error → logged but processing continues", async () => {
    const tokenSql = fakeSql(async (q) => q.includes("SELECT am_id") ? [[{ am_id: 7, fcm_token: "ok" }]] : [{ affectedRows: 1 }]);
    const pendingSql = fakeSql(async (q) => q.startsWith("SELECT")
      ? [[{ id: 1, user_id: 7, keyword: "k", type: 0, google_status: 9, facebook_status: 9, instagram_status: 9, native_status: 9 }]]
      : [{ affectedRows: 1 }]);
    fakeDbm.getSQL.mockImplementation((net) => net === "facebook" ? tokenSql : pendingSql);
    fakeFb.sendNotification.mockRejectedValueOnce(new Error("transient-network"));
    await sut.sendPushNotification({ params: { action: "0" } }, mockRes());
    expect(logChild.error).toHaveBeenCalledWith("Error processing notification", expect.any(Object));
  });
  it("action=1 returns 200 OK", async () => {
    fakeDbm.getSQL.mockReturnValue(fakeSql(async () => [{ affectedRows: 0 }]));
    const res = mockRes();
    await sut.sendPushNotification({ params: { action: "1" } }, res);
    expect(res.json).toHaveBeenCalledWith({ code: 200, message: "OK" });
  });
  it("action=1 + no res → null", async () => {
    fakeDbm.getSQL.mockReturnValue(fakeSql(async () => [{ affectedRows: 0 }]));
    const out = await sut.sendPushNotification({ params: { action: "1" } }, undefined);
    expect(out).toBeNull();
  });
  it("unexpected throw → 500", async () => {
    fakeDbm.getSQL.mockImplementation(() => { throw new Error("boom"); });
    const res = mockRes();
    await sut.sendPushNotification({ params: { action: "0" } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
  it("unexpected throw + no res → null", async () => {
    fakeDbm.getSQL.mockImplementation(() => { throw new Error("boom"); });
    const out = await sut.sendPushNotification({ params: { action: "0" } }, undefined);
    expect(out).toBeNull();
  });
  it("non-array pendingNotifications coerced to fallback", async () => {
    fakeDbm.getSQL
      .mockReturnValueOnce(fakeSql(async () => [[]])) // token sql for first call
      .mockReturnValueOnce(fakeSql(async () => "not-array")); // pending returns non-array
    const res = mockRes();
    await sut.sendPushNotification({ params: { action: "0" } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "No pending notifications" }));
  });
});

describe("pushNotificationController > getPendingNotifications", () => {
  it("401 when no userId", async () => {
    const res = mockRes();
    await sut.getPendingNotifications({ user: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });
  it("503 when token DB unavailable", async () => {
    fakeDbm.getSQL.mockReturnValue(null);
    const res = mockRes();
    await sut.getPendingNotifications({ user: { id: 7 } }, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });
  it("200 with notifications + attachTypes hit pending DB", async () => {
    const tokenSql = fakeSql(async () => [[{ id: 1, ad_id: 50, post_owner: "k", notification_content: "c" }]]);
    const pendingSql = fakeSql(async () => [[{ id: 50, type: 1 }]]);
    fakeDbm.getSQL.mockImplementation((net) => net === "facebook" ? tokenSql : pendingSql);
    const res = mockRes();
    await sut.getPendingNotifications({ user: { id: 7 } }, res);
    const r = res.json.mock.calls[0][0];
    expect(r.code).toBe(200);
    expect(r.data[0].type).toBe(1);
  });
  it("uses req.user.user_id when id missing", async () => {
    const tokenSql = fakeSql(async () => [[]]);
    fakeDbm.getSQL.mockReturnValue(tokenSql);
    const res = mockRes();
    await sut.getPendingNotifications({ user: { user_id: 5 } }, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 200 }));
  });
  it("500 on thrown error", async () => {
    fakeDbm.getSQL.mockReturnValue(fakeSql(async () => { throw new Error("err"); }));
    const res = mockRes();
    await sut.getPendingNotifications({ user: { id: 7 } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("pushNotificationController > getAllNotifications", () => {
  it("401 when no userId", async () => {
    const res = mockRes();
    await sut.getAllNotifications({ user: {}, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });
  it("503 when token DB unavailable", async () => {
    fakeDbm.getSQL.mockReturnValue(null);
    const res = mockRes();
    await sut.getAllNotifications({ user: { id: 7 }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });
  it("200 with pagination defaults", async () => {
    const tokenSql = fakeSql(async (q) => {
      if (q.includes("COUNT(*)")) return [{ count: 42 }];
      return [[{ id: 1, ad_id: 1, post_owner: "k" }]];
    });
    fakeDbm.getSQL.mockImplementation((net) => net === "facebook" ? tokenSql : fakeSql(async () => [[]]));
    const res = mockRes();
    await sut.getAllNotifications({ user: { id: 7 }, body: { skip: 0, limit: 10 } }, res);
    const r = res.json.mock.calls[0][0];
    expect(r.count).toBe(42);
  });
  it("count missing → 0", async () => {
    const tokenSql = fakeSql(async (q) => {
      if (q.includes("COUNT(*)")) return [{}];
      return [[]];
    });
    fakeDbm.getSQL.mockReturnValue(tokenSql);
    const res = mockRes();
    await sut.getAllNotifications({ user: { id: 7 }, body: {} }, res);
    expect(res.json.mock.calls[0][0].count).toBe(0);
  });
  it("500 on thrown error", async () => {
    fakeDbm.getSQL.mockReturnValue(fakeSql(async () => { throw new Error("err"); }));
    const res = mockRes();
    await sut.getAllNotifications({ user: { id: 7 }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("pushNotificationController > markNotificationAsRead", () => {
  it("401 when no userId", async () => {
    const res = mockRes();
    await sut.markNotificationAsRead({ user: {}, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });
  it("503 when DB unavailable", async () => {
    fakeDbm.getSQL.mockReturnValue(null);
    const res = mockRes();
    await sut.markNotificationAsRead({ user: { id: 1 }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });
  it("404 when notification doesn't exist", async () => {
    fakeDbm.getSQL.mockReturnValue(fakeSql(async () => []));
    const res = mockRes();
    await sut.markNotificationAsRead({ user: { id: 1 }, body: { notificationId: 9 } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
  it("200 when marked via notificationId", async () => {
    fakeDbm.getSQL.mockReturnValue(fakeSql(async (q) => {
      if (q.startsWith("SELECT")) return [{ id: 9 }];
      return [{ affectedRows: 1 }];
    }));
    const res = mockRes();
    await sut.markNotificationAsRead({ user: { id: 1 }, body: { notificationId: 9 } }, res);
    expect(res.json).toHaveBeenCalledWith({ code: 200, message: "Notification marked as read" });
  });
  it("200 when marked via adId (notificationId absent)", async () => {
    fakeDbm.getSQL.mockReturnValue(fakeSql(async (q) => {
      if (q.startsWith("SELECT")) return [{ id: 9 }];
      return [{ affectedRows: 1 }];
    }));
    const res = mockRes();
    await sut.markNotificationAsRead({ user: { id: 1 }, body: { adId: 22 } }, res);
    expect(res.json).toHaveBeenCalledWith({ code: 200, message: "Notification marked as read" });
  });
  it("500 on thrown error", async () => {
    fakeDbm.getSQL.mockReturnValue(fakeSql(async () => { throw new Error("err"); }));
    const res = mockRes();
    await sut.markNotificationAsRead({ user: { id: 1 }, body: { notificationId: 9 } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("pushNotificationController > resetDailyKeywordStatus", () => {
  it("503 when pending DB unavailable", async () => {
    fakeDbm.getSQL.mockReturnValue(null);
    const res = mockRes();
    await sut.resetDailyKeywordStatus({}, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });
  it("503 when no res → null", async () => {
    fakeDbm.getSQL.mockReturnValue(null);
    const out = await sut.resetDailyKeywordStatus({}, undefined);
    expect(out).toBeNull();
  });
  it("200 with affectedRows", async () => {
    fakeDbm.getSQL.mockReturnValue(fakeSql(async () => ({ affectedRows: 17 })));
    const res = mockRes();
    await sut.resetDailyKeywordStatus({}, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ affectedRows: 17 }));
  });
  it("affectedRows on result[0]", async () => {
    fakeDbm.getSQL.mockReturnValue(fakeSql(async () => [{ affectedRows: 4 }]));
    const res = mockRes();
    await sut.resetDailyKeywordStatus({}, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ affectedRows: 4 }));
  });
  it("cron mode → returns {affectedRows: N}", async () => {
    fakeDbm.getSQL.mockReturnValue(fakeSql(async () => ({ affectedRows: 2 })));
    const out = await sut.resetDailyKeywordStatus({}, undefined);
    expect(out).toEqual({ affectedRows: 2 });
  });
  it("500 on thrown error", async () => {
    fakeDbm.getSQL.mockReturnValue(fakeSql(async () => { throw new Error("up"); }));
    const res = mockRes();
    await sut.resetDailyKeywordStatus({}, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
  it("500 + no res → null", async () => {
    fakeDbm.getSQL.mockReturnValue(fakeSql(async () => { throw new Error("up"); }));
    const out = await sut.resetDailyKeywordStatus({}, undefined);
    expect(out).toBeNull();
  });
  it("affectedRows missing → 0", async () => {
    fakeDbm.getSQL.mockReturnValue(fakeSql(async () => ({})));
    const res = mockRes();
    await sut.resetDailyKeywordStatus({}, res);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ affectedRows: 0 }));
  });
});

describe("pushNotificationController > attachTypes (via getPendingNotifications)", () => {
  it("warn logged when pending query throws", async () => {
    const tokenSql = fakeSql(async () => [[{ id: 1, ad_id: 50 }]]);
    const pendingSql = fakeSql(async () => { throw new Error("pend-fail"); });
    fakeDbm.getSQL.mockImplementation((net) => net === "facebook" ? tokenSql : pendingSql);
    const res = mockRes();
    await sut.getPendingNotifications({ user: { id: 7 } }, res);
    expect(logChild.warn).toHaveBeenCalledWith("attachTypes: could not resolve notification types", expect.any(Object));
    expect(res.json.mock.calls[0][0].data[0].type).toBe(0); // fallback
  });
  it("notifications without ad_id default to type 0", async () => {
    const tokenSql = fakeSql(async () => [[{ id: 1, ad_id: null }]]);
    fakeDbm.getSQL.mockReturnValue(tokenSql);
    const res = mockRes();
    await sut.getPendingNotifications({ user: { id: 7 } }, res);
    expect(res.json.mock.calls[0][0].data[0].type).toBe(0);
  });
  it("pendingSql null → no query attempt, fallback type 0", async () => {
    const tokenSql = fakeSql(async () => [[{ id: 1, ad_id: 50 }]]);
    fakeDbm.getSQL.mockImplementation((net) => net === "facebook" ? tokenSql : null);
    const res = mockRes();
    await sut.getPendingNotifications({ user: { id: 7 } }, res);
    expect(res.json.mock.calls[0][0].data[0].type).toBe(0);
  });
});

describe("pushNotificationController > config-fallback module init (lines 13-18)", () => {
  it("ident()/network/table fallbacks fire when config.notifications absent and table names invalid", () => {
    // Re-cache config with no notifications + invalid table names so every
    // module-level `|| 'X'` (lines 14-15) and `ident()` regex-fail (lines 16-18) fires.
    const prevCfg = require.cache[configPath].exports;
    require.cache[configPath].exports = {
      notifications: {
        // pendingNetwork/tokenNetwork undefined → || 'linkedin' / || 'facebook'
        pendingTable: "bad; DROP",
        tokenTable: "also bad",
        inAppTable: "spaces in name",
      },
    };
    delete require.cache[sutPath];
    const reloaded = require(sutPath);
    expect(typeof reloaded.resetDailyKeywordStatus).toBe("function");
    require.cache[configPath].exports = prevCfg;
    delete require.cache[sutPath];
  });
});
