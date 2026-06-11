import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Pre-mock https + config + logger BEFORE the SUT loads
const httpsPath = require.resolve("https");
const httpsRequestSpy = vi.fn();
require.cache[httpsPath] = {
  id: httpsPath, filename: httpsPath, loaded: true,
  exports: { request: httpsRequestSpy },
};

const configPath = require.resolve("../../src/config");
const fakeConfig = {
  isDev: false,
  admin: { telegramBotToken: "BOT", telegramChatId: "CHAT" },
};
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true, exports: fakeConfig,
};

const loggerPath = require.resolve("../../src/logger");
const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { createChild: () => fakeLogger },
};

const { sendTelegramAlert } = require("../../src/utils/telegram");

function makeFakeReq() {
  const handlers = {};
  return {
    on: vi.fn((evt, fn) => { handlers[evt] = fn; }),
    write: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn(),
    handlers,
  };
}

beforeEach(() => {
  httpsRequestSpy.mockReset();
  fakeLogger.warn.mockClear();
  fakeLogger.error.mockClear();
  fakeConfig.isDev = false;
  fakeConfig.admin = { telegramBotToken: "BOT", telegramChatId: "CHAT" };
});

describe("utils/telegram > sendTelegramAlert", () => {
  it("skips silently when isDev=true", () => {
    fakeConfig.isDev = true;
    sendTelegramAlert("hi");
    expect(httpsRequestSpy).not.toHaveBeenCalled();
  });

  it("warns + skips when config.admin missing", () => {
    fakeConfig.admin = null;
    sendTelegramAlert("hi");
    expect(fakeLogger.warn).toHaveBeenCalledWith(
      "Telegram alert skipped — missing config",
      expect.objectContaining({ hasAdmin: false })
    );
    expect(httpsRequestSpy).not.toHaveBeenCalled();
  });

  it("warns + skips when telegramBotToken missing", () => {
    fakeConfig.admin = { telegramChatId: "CHAT" };
    sendTelegramAlert("hi");
    expect(fakeLogger.warn).toHaveBeenCalled();
    expect(httpsRequestSpy).not.toHaveBeenCalled();
  });

  it("warns + skips when telegramChatId missing", () => {
    fakeConfig.admin = { telegramBotToken: "BOT" };
    sendTelegramAlert("hi");
    expect(fakeLogger.warn).toHaveBeenCalled();
    expect(httpsRequestSpy).not.toHaveBeenCalled();
  });

  it("happy path: posts to api.telegram.org with the message and 200 response", () => {
    const req = makeFakeReq();
    httpsRequestSpy.mockImplementationOnce((opts, cb) => {
      // Simulate 200 success
      const res = { statusCode: 200, on: vi.fn((e, fn) => { if (e === "data") fn(); }) };
      cb(res);
      return req;
    });
    sendTelegramAlert("hello");
    const opts = httpsRequestSpy.mock.calls[0][0];
    expect(opts.hostname).toBe("api.telegram.org");
    expect(opts.path).toBe("/botBOT/sendMessage");
    expect(opts.method).toBe("POST");
    expect(req.write).toHaveBeenCalledWith(expect.stringContaining('"text":"hello"'));
    expect(req.end).toHaveBeenCalled();
    expect(fakeLogger.warn).not.toHaveBeenCalled();
  });

  it("logs warn when Telegram API status != 200", () => {
    const req = makeFakeReq();
    httpsRequestSpy.mockImplementationOnce((opts, cb) => {
      const res = { statusCode: 500, on: vi.fn((e, fn) => { if (e === "data") fn(); }) };
      cb(res);
      return req;
    });
    sendTelegramAlert("x");
    expect(fakeLogger.warn).toHaveBeenCalledWith("Telegram API error: status 500");
  });

  it("logs error on req 'error' event", () => {
    const req = makeFakeReq();
    httpsRequestSpy.mockImplementationOnce(() => req);
    sendTelegramAlert("x");
    req.handlers.error(new Error("dns-fail"));
    expect(fakeLogger.error).toHaveBeenCalledWith("Failed to send Telegram alert: dns-fail");
  });

  it("on 'timeout' event: destroys req + logs warn", () => {
    const req = makeFakeReq();
    httpsRequestSpy.mockImplementationOnce(() => req);
    sendTelegramAlert("x");
    req.handlers.timeout();
    expect(req.destroy).toHaveBeenCalled();
    expect(fakeLogger.warn).toHaveBeenCalledWith("Telegram request timed out");
  });
});
