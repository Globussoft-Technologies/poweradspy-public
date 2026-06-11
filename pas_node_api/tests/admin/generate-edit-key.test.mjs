import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Pre-mock readline so the SUT's top-level createInterface doesn't try to
// read from real stdin. Capture the registered 'line' handler so we can
// invoke it from tests to exercise the process.exit path.
const readlinePath = require.resolve("readline");
const captured = { lineHandler: null };
const fakeRL = {
  on: vi.fn((event, fn) => { if (event === "line") captured.lineHandler = fn; }),
};
require.cache[readlinePath] = {
  id: readlinePath, filename: readlinePath, loaded: true,
  exports: { createInterface: vi.fn(() => fakeRL) },
};

let consoleLogSpy, exitSpy;
beforeEach(() => {
  consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {});
  // Re-require to invoke top-level side effects fresh
  const sutPath = require.resolve("../../src/admin/generate-edit-key");
  delete require.cache[sutPath];
  require("../../src/admin/generate-edit-key");
});

describe("admin/generate-edit-key", () => {
  it("on load: prints PAS EDIT ACCESS KEY block + a base64.hex key", () => {
    const logs = consoleLogSpy.mock.calls.flat().join("\n");
    expect(logs).toContain("PAS EDIT ACCESS KEY");
    expect(logs).toContain("System Profile");
    expect(logs).toContain("Username");
    expect(logs).toContain("Hostname");
    expect(logs).toContain("OS");
    expect(logs).toContain("Your Edit Access Key is");
    // Key format: base64payload.hexhash
    const keyMatch = logs.match(/[A-Za-z0-9+/=]+\.[a-f0-9]{64}/);
    expect(keyMatch).not.toBeNull();
  });

  it("readline 'line' handler triggers process.exit(0)", () => {
    expect(typeof captured.lineHandler).toBe("function");
    captured.lineHandler();
    expect(exitSpy).toHaveBeenCalledWith(0);
  });
});
