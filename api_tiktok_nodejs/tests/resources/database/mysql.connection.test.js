import { describe, it, expect, vi, beforeEach } from "vitest";

const { syncSpy, loggerInfoSpy, loggerErrorSpy } = vi.hoisted(() => ({
  syncSpy: vi.fn(),
  loggerInfoSpy: vi.fn(),
  loggerErrorSpy: vi.fn(),
}));

vi.mock("../../../Sequelize_cli/models/index.js", () => ({
  default: { sequelize: { sync: syncSpy } },
}));

vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { info: loggerInfoSpy, error: loggerErrorSpy },
}));

let DbConnect;

beforeEach(async () => {
  vi.resetModules();
  syncSpy.mockReset();
  loggerInfoSpy.mockClear();
  loggerErrorSpy.mockClear();
  ({ default: DbConnect } = await import(
    "../../../resources/database/mysql.connection.js"
  ));
});

describe("resources/database/mysql.connection > DbConnect", () => {
  it("exports a class with an initialize method", () => {
    expect(typeof DbConnect).toBe("function");
    const inst = new DbConnect();
    expect(typeof inst.initialize).toBe("function");
  });

  it("calls sequelize.sync({ force: false, logging: false }) and logs success when connection is truthy", async () => {
    syncSpy.mockResolvedValueOnce({ truthy: true });
    const inst = new DbConnect();
    await inst.initialize();
    expect(syncSpy).toHaveBeenCalledWith({ force: false, logging: false });
    expect(loggerInfoSpy).toHaveBeenCalledWith("Mysql database connected");
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });

  it("does NOT log info when sync resolves with a falsy value", async () => {
    syncSpy.mockResolvedValueOnce(null);
    const inst = new DbConnect();
    await inst.initialize();
    expect(syncSpy).toHaveBeenCalledTimes(1);
    expect(loggerInfoSpy).not.toHaveBeenCalled();
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });

  it("logs the error message and rethrows when sync rejects", async () => {
    const err = new Error("connection refused");
    syncSpy.mockRejectedValueOnce(err);
    const inst = new DbConnect();
    await expect(inst.initialize()).rejects.toThrow("connection refused");
    expect(loggerErrorSpy).toHaveBeenCalledWith(
      "My sql connection error :connection refused"
    );
  });
});
