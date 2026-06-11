import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Mock the compression package and the local config BEFORE the SUT requires them.
const compressionPath = require.resolve("compression");
const compressionSpy = vi.fn(() => "compression-middleware-instance");
compressionSpy.filter = vi.fn(() => true);
require.cache[compressionPath] = {
  id: compressionPath, filename: compressionPath, loaded: true,
  exports: compressionSpy,
};

const configPath = require.resolve("../../src/config");
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true,
  exports: { compression: { threshold: 1024 } },
};

const compressionMiddleware = require("../../src/middleware/compression");

describe("middleware/compression", () => {
  it("returns the result of compression() with threshold from config", () => {
    const out = compressionMiddleware();
    expect(out).toBe("compression-middleware-instance");
    expect(compressionSpy).toHaveBeenCalled();
    const opts = compressionSpy.mock.calls[0][0];
    expect(opts.threshold).toBe(1024);
    expect(typeof opts.filter).toBe("function");
  });

  it("filter returns false when x-no-compression header is present (line 10 true branch)", () => {
    compressionMiddleware();
    const opts = compressionSpy.mock.calls.at(-1)[0];
    const req = { headers: { "x-no-compression": "1" } };
    expect(opts.filter(req, {})).toBe(false);
  });

  it("filter delegates to compression.filter when no x-no-compression header (line 10 false branch)", () => {
    compressionMiddleware();
    const opts = compressionSpy.mock.calls.at(-1)[0];
    const req = { headers: {} };
    compressionSpy.filter.mockReturnValueOnce("delegated");
    expect(opts.filter(req, {})).toBe("delegated");
    expect(compressionSpy.filter).toHaveBeenCalledWith(req, {});
  });
});
