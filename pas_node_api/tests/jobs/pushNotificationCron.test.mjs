import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const cronPath = require.resolve("node-cron");
const cronSchedule = vi.fn();
const cronValidate = vi.fn(() => true);
require.cache[cronPath] = {
  id: cronPath, filename: cronPath, loaded: true,
  exports: { schedule: cronSchedule, validate: cronValidate },
};

const axiosPath = require.resolve("axios");
const axiosGet = vi.fn(async () => ({ data: {} }));
require.cache[axiosPath] = {
  id: axiosPath, filename: axiosPath, loaded: true,
  exports: { get: axiosGet, default: { get: axiosGet } },
};

const loggerPath = require.resolve("../../src/logger");
const childLog = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { createChild: vi.fn(() => childLog) },
};

const configPath = require.resolve("../../src/config");
let configExports = {
  notifications: {
    timezone: "Asia/Kolkata",
    pushSchedule: "1 min",
    emailSchedule: "daily 12:30 AM",
    resetSchedule: "daily 12:30 AM",
    pushEnabled: true, emailEnabled: true, resetEnabled: true, keywordStatusEnabled: true,
  },
};
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true,
  get exports() { return configExports; },
  set exports(v) { configExports = v; },
};

const mailCtrlPath = require.resolve("../../src/services/common/controllers/dailyMailUpdateController");
const sendMailDailyUpdate = vi.fn(async () => {});
require.cache[mailCtrlPath] = {
  id: mailCtrlPath, filename: mailCtrlPath, loaded: true,
  exports: { sendMailDailyUpdate },
};

const pushCtrlPath = require.resolve("../../src/services/common/controllers/pushNotificationController");
const sendPushNotification = vi.fn(async () => {});
const resetDailyKeywordStatus = vi.fn(async () => {});
require.cache[pushCtrlPath] = {
  id: pushCtrlPath, filename: pushCtrlPath, loaded: true,
  exports: { sendPushNotification, resetDailyKeywordStatus },
};

const sutPath = require.resolve("../../src/jobs/pushNotificationCron");
function freshSut() {
  delete require.cache[sutPath];
  return require(sutPath);
}

beforeEach(() => {
  cronSchedule.mockReset(); cronValidate.mockReset().mockReturnValue(true);
  axiosGet.mockReset().mockResolvedValue({ data: {} });
  childLog.debug.mockClear(); childLog.info.mockClear(); childLog.warn.mockClear(); childLog.error.mockClear();
  sendMailDailyUpdate.mockReset().mockResolvedValue();
  sendPushNotification.mockReset().mockResolvedValue();
  resetDailyKeywordStatus.mockReset().mockResolvedValue();
  configExports = {
    notifications: {
      timezone: "Asia/Kolkata",
      pushSchedule: "1 min", emailSchedule: "daily 12:30 AM", resetSchedule: "daily 12:30 AM",
      pushEnabled: true, emailEnabled: true, resetEnabled: true, keywordStatusEnabled: true,
    },
  };
});

describe("pushNotificationCron > parseSchedule branches (via initPushNotificationCron)", () => {
  it("intervals: '1 min' → '* * * * *'", () => {
    const { initPushNotificationCron } = freshSut();
    configExports.notifications.pushSchedule = "1 min";
    initPushNotificationCron();
    expect(cronSchedule.mock.calls[0][0]).toBe("* * * * *");
  });
  it("intervals: '5 min' → '*/5 * * * *'", () => {
    const { initPushNotificationCron } = freshSut();
    configExports.notifications.pushSchedule = "5 min";
    initPushNotificationCron();
    expect(cronSchedule.mock.calls[0][0]).toBe("*/5 * * * *");
  });
  it("intervals: '1 hour' → '0 * * * *'", () => {
    const { initPushNotificationCron } = freshSut();
    configExports.notifications.pushSchedule = "1 hour";
    initPushNotificationCron();
    expect(cronSchedule.mock.calls[0][0]).toBe("0 * * * *");
  });
  it("intervals: '2h' → '0 */2 * * *'", () => {
    const { initPushNotificationCron } = freshSut();
    configExports.notifications.pushSchedule = "2h";
    initPushNotificationCron();
    expect(cronSchedule.mock.calls[0][0]).toBe("0 */2 * * *");
  });
  it("daily PM time → HH adjusted +12", () => {
    const { initDailyMailUpdateCron } = freshSut();
    configExports.notifications.emailSchedule = "2:30 pm";
    initDailyMailUpdateCron();
    expect(cronSchedule.mock.calls[0][0]).toBe("30 14 * * *");
  });
  it("daily 12 AM → HH=0", () => {
    const { initDailyMailUpdateCron } = freshSut();
    configExports.notifications.emailSchedule = "12:30 am";
    initDailyMailUpdateCron();
    expect(cronSchedule.mock.calls[0][0]).toBe("30 0 * * *");
  });
  it("HH:MM without am/pm just used directly", () => {
    const { initDailyMailUpdateCron } = freshSut();
    configExports.notifications.emailSchedule = "13:45";
    initDailyMailUpdateCron();
    expect(cronSchedule.mock.calls[0][0]).toBe("45 13 * * *");
  });
  it("raw 5-field cron pass-through", () => {
    const { initPushNotificationCron } = freshSut();
    configExports.notifications.pushSchedule = "*/10 * * * *";
    initPushNotificationCron();
    expect(cronSchedule.mock.calls[0][0]).toBe("*/10 * * * *");
  });
  it("invalid HH:MM → falls back to default", () => {
    const { initPushNotificationCron } = freshSut();
    configExports.notifications.pushSchedule = "99:99";
    initPushNotificationCron();
    expect(cronSchedule.mock.calls[0][0]).toBe("*/5 * * * *");
  });
  it("non-string schedule → fallback", () => {
    const { initPushNotificationCron } = freshSut();
    configExports.notifications.pushSchedule = null;
    initPushNotificationCron();
    expect(cronSchedule.mock.calls[0][0]).toBe("*/5 * * * *");
  });
  it("gibberish schedule → fallback", () => {
    const { initPushNotificationCron } = freshSut();
    configExports.notifications.pushSchedule = "absolute nonsense";
    initPushNotificationCron();
    expect(cronSchedule.mock.calls[0][0]).toBe("*/5 * * * *");
  });
});

describe("pushNotificationCron > initPushNotificationCron", () => {
  it("noop when pushEnabled=false", () => {
    const { initPushNotificationCron } = freshSut();
    configExports.notifications.pushEnabled = false;
    initPushNotificationCron();
    expect(cronSchedule).not.toHaveBeenCalled();
  });
  it("aborts when validate returns false", () => {
    cronValidate.mockReturnValue(false);
    const { initPushNotificationCron } = freshSut();
    initPushNotificationCron();
    expect(cronSchedule).not.toHaveBeenCalled();
    expect(childLog.error).toHaveBeenCalled();
  });
  it("schedules and on callback invokes sendPushNotification", async () => {
    const { initPushNotificationCron } = freshSut();
    initPushNotificationCron();
    const cb = cronSchedule.mock.calls[0][1];
    await cb();
    expect(sendPushNotification).toHaveBeenCalled();
  });
  it("scheduled callback logs error when sendPushNotification rejects", async () => {
    sendPushNotification.mockRejectedValue(new Error("push-fail"));
    const { initPushNotificationCron } = freshSut();
    initPushNotificationCron();
    await cronSchedule.mock.calls[0][1]();
    expect(childLog.error).toHaveBeenCalledWith("Push notification cron job error", expect.any(Object));
  });
  it("outer try/catch logs error when cron.schedule throws", () => {
    cronSchedule.mockImplementation(() => { throw new Error("sched-fail"); });
    const { initPushNotificationCron } = freshSut();
    initPushNotificationCron();
    expect(childLog.error).toHaveBeenCalledWith("Failed to initialize push notification cron", expect.any(Object));
  });
});

describe("pushNotificationCron > initDailyMailUpdateCron", () => {
  it("noop when emailEnabled=false", () => {
    const { initDailyMailUpdateCron } = freshSut();
    configExports.notifications.emailEnabled = false;
    initDailyMailUpdateCron();
    expect(cronSchedule).not.toHaveBeenCalled();
  });
  it("aborts when validate returns false", () => {
    cronValidate.mockReturnValue(false);
    const { initDailyMailUpdateCron } = freshSut();
    initDailyMailUpdateCron();
    expect(childLog.error).toHaveBeenCalled();
  });
  it("scheduled callback invokes sendMailDailyUpdate", async () => {
    const { initDailyMailUpdateCron } = freshSut();
    initDailyMailUpdateCron();
    await cronSchedule.mock.calls[0][1]();
    expect(sendMailDailyUpdate).toHaveBeenCalled();
  });
  it("scheduled callback logs error when sendMailDailyUpdate rejects", async () => {
    sendMailDailyUpdate.mockRejectedValue(new Error("mail-fail"));
    const { initDailyMailUpdateCron } = freshSut();
    initDailyMailUpdateCron();
    await cronSchedule.mock.calls[0][1]();
    expect(childLog.error).toHaveBeenCalledWith("Daily mail update cron job error", expect.any(Object));
  });
  it("outer try/catch on cron.schedule throw", () => {
    cronSchedule.mockImplementation(() => { throw new Error("e"); });
    const { initDailyMailUpdateCron } = freshSut();
    initDailyMailUpdateCron();
    expect(childLog.error).toHaveBeenCalledWith("Failed to initialize daily mail update cron", expect.any(Object));
  });
});

describe("pushNotificationCron > initDailyResetCron", () => {
  it("noop when resetEnabled=false", () => {
    const { initDailyResetCron } = freshSut();
    configExports.notifications.resetEnabled = false;
    initDailyResetCron();
    expect(cronSchedule).not.toHaveBeenCalled();
  });
  it("aborts when validate returns false", () => {
    cronValidate.mockReturnValue(false);
    const { initDailyResetCron } = freshSut();
    initDailyResetCron();
    expect(childLog.error).toHaveBeenCalled();
  });
  it("scheduled callback invokes resetDailyKeywordStatus", async () => {
    const { initDailyResetCron } = freshSut();
    initDailyResetCron();
    await cronSchedule.mock.calls[0][1]();
    expect(resetDailyKeywordStatus).toHaveBeenCalled();
  });
  it("scheduled callback logs error when reset rejects", async () => {
    resetDailyKeywordStatus.mockRejectedValue(new Error("reset-fail"));
    const { initDailyResetCron } = freshSut();
    initDailyResetCron();
    await cronSchedule.mock.calls[0][1]();
    expect(childLog.error).toHaveBeenCalledWith("Daily reset cron job error", expect.any(Object));
  });
  it("outer try/catch on cron.schedule throw", () => {
    cronSchedule.mockImplementation(() => { throw new Error("e"); });
    const { initDailyResetCron } = freshSut();
    initDailyResetCron();
    expect(childLog.error).toHaveBeenCalledWith("Failed to initialize daily reset cron", expect.any(Object));
  });
});

describe("pushNotificationCron > initUpdateKeywordStatusCron", () => {
  it("noop when keywordStatusEnabled=false", () => {
    const { initUpdateKeywordStatusCron } = freshSut();
    configExports.notifications.keywordStatusEnabled = false;
    initUpdateKeywordStatusCron();
    expect(cronSchedule).not.toHaveBeenCalled();
  });
  it("scheduled callback hits LINKEDIN_API_URL endpoint", async () => {
    process.env.LINKEDIN_API_URL = "http://linkedin.local";
    const { initUpdateKeywordStatusCron } = freshSut();
    initUpdateKeywordStatusCron();
    await cronSchedule.mock.calls[0][1]();
    expect(axiosGet).toHaveBeenCalledWith(
      "http://linkedin.local/api/v1/update-requested-keyword-status",
      expect.objectContaining({ timeout: 60000 })
    );
    delete process.env.LINKEDIN_API_URL;
  });
  it("default URL when env unset", async () => {
    delete process.env.LINKEDIN_API_URL;
    const { initUpdateKeywordStatusCron } = freshSut();
    initUpdateKeywordStatusCron();
    await cronSchedule.mock.calls[0][1]();
    expect(axiosGet.mock.calls[0][0]).toContain("localhost:4000");
  });
  it("axios throw logged", async () => {
    axiosGet.mockRejectedValue(new Error("net-fail"));
    const { initUpdateKeywordStatusCron } = freshSut();
    initUpdateKeywordStatusCron();
    await cronSchedule.mock.calls[0][1]();
    expect(childLog.error).toHaveBeenCalledWith("Update keyword status cron job error", expect.any(Object));
  });
  it("outer try/catch on cron.schedule throw", () => {
    cronSchedule.mockImplementation(() => { throw new Error("e"); });
    const { initUpdateKeywordStatusCron } = freshSut();
    initUpdateKeywordStatusCron();
    expect(childLog.error).toHaveBeenCalledWith("Failed to initialize update keyword status cron", expect.any(Object));
  });
});

describe("pushNotificationCron > timezone default", () => {
  it("uses Asia/Kolkata when notifications.timezone missing", () => {
    configExports = { notifications: { pushSchedule: "1 min" } };
    const { initPushNotificationCron } = freshSut();
    initPushNotificationCron();
    expect(cronSchedule.mock.calls[0][2]).toEqual({ timezone: "Asia/Kolkata" });
  });
  it("uses notifications.timezone when set", () => {
    configExports = { notifications: { timezone: "UTC", pushSchedule: "1 min" } };
    const { initPushNotificationCron } = freshSut();
    initPushNotificationCron();
    expect(cronSchedule.mock.calls[0][2]).toEqual({ timezone: "UTC" });
  });
});
