import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const requestIdMiddleware = require("../../src/middleware/requestId");

function mockReqRes(headers = {}) {
  const req = { headers };
  const res = { setHeader: vi.fn() };
  return { req, res };
}

describe("middleware/requestId", () => {
  it("exports a factory that returns a (req, res, next) middleware", () => {
    expect(typeof requestIdMiddleware).toBe("function");
    const mw = requestIdMiddleware();
    expect(typeof mw).toBe("function");
    expect(mw.length).toBe(3);
  });

  it("uses x-request-id header when present", () => {
    const mw = requestIdMiddleware();
    const { req, res } = mockReqRes({ "x-request-id": "abc-123" });
    const next = vi.fn();
    mw(req, res, next);
    expect(req.id).toBe("abc-123");
    expect(req.requestId).toBe("abc-123");
    expect(res.setHeader).toHaveBeenCalledWith("X-Request-Id", "abc-123");
    expect(next).toHaveBeenCalled();
  });

  it("generates a UUID when no x-request-id header is provided", () => {
    const mw = requestIdMiddleware();
    const { req, res } = mockReqRes({});
    const next = vi.fn();
    mw(req, res, next);
    // crypto.randomUUID() returns a 36-char string
    expect(req.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(req.requestId).toBe(req.id);
    expect(res.setHeader).toHaveBeenCalledWith("X-Request-Id", req.id);
    expect(next).toHaveBeenCalled();
  });
});
