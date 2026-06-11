import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const logger = require("../../utils/logger");

describe("utils/logger > winston logger config", () => {
  it("exports a winston logger with debug level", () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
    expect(logger.level).toBe("debug");
  });

  it("uses exactly one File transport", () => {
    expect(Array.isArray(logger.transports)).toBe(true);
    expect(logger.transports).toHaveLength(1);
    const t = logger.transports[0];
    expect(t.name).toBe("file");
  });

  it("File transport is configured with maxsize=5MB and maxFiles=5", () => {
    const t = logger.transports[0];
    expect(t.maxsize).toBe(1024 * 1024 * 5);
    expect(t.maxFiles).toBe(5);
  });

  it("File transport filename points at logs/server.log", () => {
    const t = logger.transports[0];
    expect(t.filename).toBe("server.log");
    expect(t.dirname).toMatch(/[/\\]logs$/);
  });
});
