import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Mock helmet and cors BEFORE the SUT loads.
const helmetPath = require.resolve("helmet");
const helmetSpy = vi.fn(() => "helmet-instance");
require.cache[helmetPath] = {
  id: helmetPath, filename: helmetPath, loaded: true,
  exports: helmetSpy,
};

const corsPath = require.resolve("cors");
const corsSpy = vi.fn(() => "cors-instance");
require.cache[corsPath] = {
  id: corsPath, filename: corsPath, loaded: true,
  exports: corsSpy,
};

const configPath = require.resolve("../../src/config");
const fakeConfig = {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  },
};
require.cache[configPath] = {
  id: configPath, filename: configPath, loaded: true,
  exports: fakeConfig,
};

const security = require("../../src/middleware/security");

beforeEach(() => {
  helmetSpy.mockClear();
  corsSpy.mockClear();
});

describe("middleware/security > helmetMiddleware", () => {
  it("invokes helmet with disabled CSP + CORS-friendly defaults", () => {
    const out = security.helmetMiddleware();
    expect(out).toBe("helmet-instance");
    const opts = helmetSpy.mock.calls.at(-1)[0];
    expect(opts.contentSecurityPolicy).toBe(false);
    expect(opts.crossOriginEmbedderPolicy).toBe(false);
    expect(opts.crossOriginResourcePolicy).toBe(false);
    expect(opts.crossOriginOpenerPolicy).toBe(false);
  });
});

describe("middleware/security > corsMiddleware", () => {
  it("origin='*' → origin set to true (browsers reject '*' with credentials)", () => {
    const out = security.corsMiddleware();
    expect(out).toBe("cors-instance");
    const opts = corsSpy.mock.calls.at(-1)[0];
    expect(opts.origin).toBe(true);
    expect(opts.methods).toEqual(["GET", "POST"]);
    expect(opts.allowedHeaders).toEqual([
      "Content-Type", "Cookie", "If-None-Match", "X-Sdui-Client-Version",
    ]);
    expect(opts.exposedHeaders).toEqual(["ETag"]);
    expect(opts.credentials).toBe(true);
  });

  it("non-'*' origin → passes through unchanged (line 20 false branch)", () => {
    fakeConfig.cors.origin = "https://app.example.com";
    try {
      security.corsMiddleware();
      const opts = corsSpy.mock.calls.at(-1)[0];
      expect(opts.origin).toBe("https://app.example.com");
    } finally {
      fakeConfig.cors.origin = "*";
    }
  });

  it("missing allowedHeaders → `|| []` fallback merges with default 3 headers", () => {
    const prev = fakeConfig.cors.allowedHeaders;
    delete fakeConfig.cors.allowedHeaders;
    try {
      security.corsMiddleware();
      const opts = corsSpy.mock.calls.at(-1)[0];
      expect(opts.allowedHeaders).toEqual([
        "Cookie", "If-None-Match", "X-Sdui-Client-Version",
      ]);
    } finally {
      fakeConfig.cors.allowedHeaders = prev;
    }
  });
});
