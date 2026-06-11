import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const dbmPath = require.resolve("../../../../src/database/DatabaseManager");
const fakeDbm = { getSQL: vi.fn() };
require.cache[dbmPath] = {
  id: dbmPath, filename: dbmPath, loaded: true, exports: fakeDbm,
};

const loggerPath = require.resolve("../../../../src/logger");
const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { createChild: () => fakeLogger },
};

const { getNotifications, markNotificationsRead } = require("../../../../src/services/common/controllers/notificationController");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

beforeEach(() => {
  fakeDbm.getSQL.mockReset();
  fakeLogger.error.mockClear();
});

describe("services/common/notificationController > getNotifications", () => {
  it("401 when no user id", async () => {
    const res = mockRes();
    await getNotifications({}, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("503 when SQL DB unavailable", async () => {
    fakeDbm.getSQL.mockReturnValueOnce(null);
    const res = mockRes();
    await getNotifications({ user: { id: 1 } }, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it("happy path: returns rows + unreadCount", async () => {
    const rows = [{ id: 1, keyword: "k" }, { id: 2, keyword: "k2" }];
    fakeDbm.getSQL.mockReturnValueOnce({ query: vi.fn().mockResolvedValueOnce(rows) });
    const res = mockRes();
    await getNotifications({ user: { id: 5 } }, res);
    expect(res.json).toHaveBeenCalledWith({
      code: 200, message: "ok", data: rows, meta: { unreadCount: 2 },
    });
  });

  it("null rows → empty array fallback (line 43 `|| []`)", async () => {
    fakeDbm.getSQL.mockReturnValueOnce({ query: vi.fn().mockResolvedValueOnce(null) });
    const res = mockRes();
    await getNotifications({ user: { id: 5 } }, res);
    expect(res.json.mock.calls[0][0].data).toEqual([]);
    expect(res.json.mock.calls[0][0].meta.unreadCount).toBe(0);
  });

  it("uses user.user_id when user.id missing", async () => {
    fakeDbm.getSQL.mockReturnValueOnce({ query: vi.fn().mockResolvedValueOnce([]) });
    const res = mockRes();
    await getNotifications({ user: { user_id: 9 } }, res);
    expect(res.json).toHaveBeenCalled();
  });

  it("500 on DB throw", async () => {
    fakeDbm.getSQL.mockReturnValueOnce({ query: vi.fn().mockRejectedValueOnce(new Error("db-down")) });
    const res = mockRes();
    await getNotifications({ user: { id: 1 } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(fakeLogger.error).toHaveBeenCalled();
  });
});

describe("services/common/notificationController > markNotificationsRead", () => {
  it("401 when no user id", async () => {
    const res = mockRes();
    await markNotificationsRead({ body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("503 when SQL DB unavailable", async () => {
    fakeDbm.getSQL.mockReturnValueOnce(null);
    const res = mockRes();
    await markNotificationsRead({ user: { id: 1 }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it("ids array provided: builds parameterized UPDATE with placeholders", async () => {
    const query = vi.fn().mockResolvedValueOnce([]);
    fakeDbm.getSQL.mockReturnValueOnce({ query });
    const res = mockRes();
    await markNotificationsRead({ user: { id: 1 }, body: { ids: [10, 20, 30] } }, res);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("id IN (?,?,?)");
    expect(params).toEqual([1, 10, 20, 30]);
    expect(res.json).toHaveBeenCalledWith({ code: 200, message: "Notifications marked as read" });
  });

  it("ids array empty: marks all unread (no IN clause)", async () => {
    const query = vi.fn().mockResolvedValueOnce([]);
    fakeDbm.getSQL.mockReturnValueOnce({ query });
    const res = mockRes();
    await markNotificationsRead({ user: { id: 1 }, body: { ids: [] } }, res);
    expect(query.mock.calls[0][0]).not.toContain("IN");
    expect(query.mock.calls[0][1]).toEqual([1]);
  });

  it("no body → req.body || {} fallback fires; marks all unread", async () => {
    const query = vi.fn().mockResolvedValueOnce([]);
    fakeDbm.getSQL.mockReturnValueOnce({ query });
    const res = mockRes();
    await markNotificationsRead({ user: { id: 1 } }, res);
    expect(query.mock.calls[0][1]).toEqual([1]);
  });

  it("ids not array → marks all unread (line 72 false)", async () => {
    const query = vi.fn().mockResolvedValueOnce([]);
    fakeDbm.getSQL.mockReturnValueOnce({ query });
    const res = mockRes();
    await markNotificationsRead({ user: { id: 1 }, body: { ids: "not-array" } }, res);
    expect(query.mock.calls[0][0]).not.toContain("IN");
  });

  it("500 on DB throw", async () => {
    fakeDbm.getSQL.mockReturnValueOnce({ query: vi.fn().mockRejectedValueOnce(new Error("up")) });
    const res = mockRes();
    await markNotificationsRead({ user: { id: 1 }, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(fakeLogger.error).toHaveBeenCalled();
  });
});
