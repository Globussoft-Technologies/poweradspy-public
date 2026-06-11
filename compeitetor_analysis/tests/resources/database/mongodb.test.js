import { describe, it, expect, vi, beforeEach } from "vitest";

const { mongooseConnectSpy, configGetSpy, loggerInfoSpy, loggerErrorSpy, processExitSpy } = vi.hoisted(() => ({
  mongooseConnectSpy: vi.fn(),
  configGetSpy: vi.fn(),
  loggerInfoSpy: vi.fn(),
  loggerErrorSpy: vi.fn(),
  processExitSpy: vi.fn(),
}));

vi.mock("mongoose", () => ({
  default: { connect: mongooseConnectSpy },
}));
vi.mock("config", () => ({ default: { get: configGetSpy } }));
vi.mock("../../../resources/logs/logger.log.js", () => ({
  default: { info: loggerInfoSpy, error: loggerErrorSpy, warn: vi.fn() },
}));

let connectDB;
let origExit;

beforeEach(async () => {
  mongooseConnectSpy.mockReset();
  configGetSpy.mockReset();
  loggerInfoSpy.mockReset();
  loggerErrorSpy.mockReset();
  processExitSpy.mockReset();
  configGetSpy.mockReturnValue("mongodb://test/db");
  origExit = process.exit;
  process.exit = processExitSpy;
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.resetModules();
  ({ connectDB } = await import("../../../resources/database/mongodb.js"));
});

describe("resources/database/mongodb > connectDB", () => {
  it("happy: logs MongoDB connected host", async () => {
    mongooseConnectSpy.mockResolvedValueOnce({ connection: { host: "host1" } });
    await connectDB();
    expect(loggerInfoSpy).toHaveBeenCalledWith(expect.stringContaining("MongoDB Connected: host1"));
  });

  it("error: logs and calls process.exit(1)", async () => {
    mongooseConnectSpy.mockRejectedValueOnce(new Error("nope"));
    await connectDB();
    expect(loggerErrorSpy).toHaveBeenCalledWith(expect.stringContaining("MongoDB Connection Error: nope"));
    expect(processExitSpy).toHaveBeenCalledWith(1);
    process.exit = origExit;
  });
});
