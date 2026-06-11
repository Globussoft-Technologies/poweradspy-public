import { describe, it, expect, vi, beforeEach } from "vitest";

const { syncSpy, loggerInfoSpy, loggerErrorSpy } = vi.hoisted(() => ({
  syncSpy: vi.fn(),
  loggerInfoSpy: vi.fn(),
  loggerErrorSpy: vi.fn(),
}));

vi.mock("../../../Sequelize/models/index.js", () => ({
  default: { sequelize: { sync: syncSpy } },
}));
vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { info: loggerInfoSpy, error: loggerErrorSpy, warn: vi.fn() },
}));

let DbConnect;

beforeEach(async () => {
  syncSpy.mockReset();
  loggerInfoSpy.mockReset();
  loggerErrorSpy.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.resetModules();
  ({ default: DbConnect } = await import("../../../resources/database/mysqlconnection.js"));
});

describe("resources/database/mysqlconnection > DbConnect.initialize", () => {
  it("happy: sequelize.sync resolves and logger.info called", async () => {
    syncSpy.mockResolvedValueOnce({ ok: true });
    const c = new DbConnect();
    await c.initialize();
    expect(loggerInfoSpy).toHaveBeenCalledWith("Mysql database connected");
  });

  it("sequelize.sync returns falsy → no info log, no throw", async () => {
    syncSpy.mockResolvedValueOnce(null);
    const c = new DbConnect();
    await c.initialize();
    expect(loggerInfoSpy).not.toHaveBeenCalled();
  });

  it("sync throws → logs error and rethrows", async () => {
    syncSpy.mockRejectedValueOnce(new Error("connect-fail"));
    const c = new DbConnect();
    await expect(c.initialize()).rejects.toThrow("connect-fail");
    expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining("connect-fail"));
  });
});
