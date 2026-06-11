import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const {
  axiosPostSpy,
  scheduleSpy,
  getUpdatesSpy,
  loggerInfoSpy,
  loggerErrorSpy,
} = vi.hoisted(() => ({
  axiosPostSpy: vi.fn(),
  scheduleSpy: vi.fn(),
  getUpdatesSpy: vi.fn(),
  loggerInfoSpy: vi.fn(),
  loggerErrorSpy: vi.fn(),
}));

vi.mock("axios", () => ({
  default: { post: axiosPostSpy },
}));

vi.mock("node-cron", () => ({
  default: { schedule: scheduleSpy },
  schedule: scheduleSpy,
}));

vi.mock("../../utils/elasticSearch.js", () => ({
  getUpdates: getUpdatesSpy,
}));

vi.mock("../../resources/logs/logger.log.js", () => ({
  default: { info: loggerInfoSpy, error: loggerErrorSpy },
}));

vi.mock("config", () => ({
  default: {
    get: (key) => {
      if (key === "teligram_bot_token") return "BOT-TOK";
      if (key === "teligram_chat_id") return "CHAT-99";
      throw new Error(`unstubbed config: ${key}`);
    },
  },
}));

let runCronJob;
let consoleErrSpy;

beforeEach(async () => {
  vi.resetModules();
  axiosPostSpy.mockReset();
  scheduleSpy.mockClear();
  getUpdatesSpy.mockReset();
  loggerInfoSpy.mockClear();
  loggerErrorSpy.mockClear();
  consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  ({ runCronJob } = await import("../../utils/cronJob.js"));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("utils/cronJob > runCronJob", () => {
  it("registers a cron schedule at '0 10 * * *' Asia/Kolkata", async () => {
    await runCronJob();
    expect(scheduleSpy).toHaveBeenCalledWith(
      "0 10 * * *",
      expect.any(Function),
      { timezone: "Asia/Kolkata" }
    );
  });

  it("scheduled callback logs, fetches updates, and posts them to Telegram on success", async () => {
    await runCronJob();
    getUpdatesSpy.mockResolvedValueOnce("daily digest");
    axiosPostSpy.mockResolvedValueOnce({ data: { ok: true } });
    const cb = scheduleSpy.mock.calls[0][1];
    await cb();
    // give the inner async pipeline a tick to settle
    await new Promise((r) => setImmediate(r));
    expect(loggerInfoSpy).toHaveBeenCalledWith("Running the Cron Job");
    expect(getUpdatesSpy).toHaveBeenCalled();
    expect(axiosPostSpy).toHaveBeenCalledWith(
      "https://api.telegram.org/botBOT-TOK/sendMessage",
      { chat_id: "CHAT-99", text: "daily digest" }
    );
    expect(loggerInfoSpy).toHaveBeenCalledWith("Message sent to Telegram");
  });

  it("logs to console.error + logger.error when sendToTelegram axios.post throws", async () => {
    await runCronJob();
    getUpdatesSpy.mockResolvedValueOnce("digest");
    const err = new Error("telegram-down");
    axiosPostSpy.mockRejectedValueOnce(err);
    const cb = scheduleSpy.mock.calls[0][1];
    await cb();
    await new Promise((r) => setImmediate(r));
    expect(consoleErrSpy).toHaveBeenCalledWith("Failed to send message:", err);
    expect(loggerErrorSpy).toHaveBeenCalledWith("Failed to send message:", err);
  });

  it("logs to console.error + logger.error when getUpdates throws (outer runScheduledTask catch)", async () => {
    await runCronJob();
    const err = new Error("es-down");
    getUpdatesSpy.mockRejectedValueOnce(err);
    const cb = scheduleSpy.mock.calls[0][1];
    await cb();
    await new Promise((r) => setImmediate(r));
    expect(consoleErrSpy).toHaveBeenCalledWith("Error in scheduled task:", err);
    expect(loggerErrorSpy).toHaveBeenCalledWith("Error in scheduled task:", err);
  });
});
