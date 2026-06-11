import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { fetchAgentData } = require("../../src/agent-config-data");

function mockRes() {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

let consoleErrSpy;

beforeEach(() => {
  consoleErrSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  delete process.env.WS_URL;
  delete process.env.API_KEY;
});

afterEach(() => {
  consoleErrSpy.mockRestore();
});

describe("src/agent-config-data > fetchAgentData", () => {
  it("returns env-based wsUrl + apiKey when both set", async () => {
    process.env.WS_URL = "wss://app.test/ws";
    process.env.API_KEY = "secret-key";
    const res = mockRes();
    await fetchAgentData({}, res);
    expect(res.json).toHaveBeenCalledWith({
      wsUrl: "wss://app.test/ws",
      apiKey: "secret-key",
    });
  });

  it("returns 'not set' placeholders when env vars are missing", async () => {
    const res = mockRes();
    await fetchAgentData({}, res);
    expect(res.json).toHaveBeenCalledWith({
      wsUrl: "WS_URL not set",
      apiKey: "API_KEY not set",
    });
  });

  it("returns 500 when res.json throws (outer catch)", async () => {
    const res = mockRes();
    res.json.mockImplementationOnce(() => { throw new Error("boom"); });
    await fetchAgentData({}, res);
    expect(consoleErrSpy).toHaveBeenCalledWith(
      "Error fetching agent data:",
      expect.any(Error)
    );
    expect(res.status).toHaveBeenCalledWith(500);
    // The second json call (after status(500)) returns the error envelope
    expect(res.json).toHaveBeenLastCalledWith({
      message: "Internal Server Error",
    });
  });
});
