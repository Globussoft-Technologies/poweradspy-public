import { describe, it, expect, vi, beforeEach } from "vitest";

const { createPoolSpy, getConnectionSpy, releaseSpy, configGetSpy, loggerErrorSpy } = vi.hoisted(() => ({
  createPoolSpy: vi.fn(),
  getConnectionSpy: vi.fn(),
  releaseSpy: vi.fn(),
  configGetSpy: vi.fn(),
  loggerErrorSpy: vi.fn(),
}));

vi.mock("mysql2/promise", () => ({
  default: { createPool: createPoolSpy },
}));
vi.mock("config", () => ({ default: { get: configGetSpy } }));
vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { info: vi.fn(), error: loggerErrorSpy, warn: vi.fn() },
}));

let pool, testConnection;

beforeEach(async () => {
  createPoolSpy.mockReset();
  getConnectionSpy.mockReset();
  releaseSpy.mockReset();
  configGetSpy.mockReset();
  loggerErrorSpy.mockReset();
  configGetSpy.mockImplementation((k) => `cfg:${k}`);
  createPoolSpy.mockReturnValue({
    getConnection: getConnectionSpy,
  });
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.resetModules();
  ({ pool, testConnection } = await import("../../../resources/database/db.js"));
});

describe("resources/database/db", () => {
  it("createPool called with config-driven host/user/password/database/port at module load", () => {
    expect(createPoolSpy).toHaveBeenCalledTimes(1);
    const opts = createPoolSpy.mock.calls[0][0];
    expect(opts.host).toBe("cfg:DB_HOST");
    expect(opts.connectionLimit).toBe(10);
  });

  it("testConnection: happy path acquires and releases connection", async () => {
    getConnectionSpy.mockResolvedValueOnce({ release: releaseSpy });
    await testConnection();
    expect(getConnectionSpy).toHaveBeenCalled();
    expect(releaseSpy).toHaveBeenCalled();
  });

  it("testConnection: logs and swallows error on getConnection failure", async () => {
    getConnectionSpy.mockRejectedValueOnce(new Error("db-down"));
    await testConnection();
    expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Mysql2 Connection Error: db-down"));
  });
});
