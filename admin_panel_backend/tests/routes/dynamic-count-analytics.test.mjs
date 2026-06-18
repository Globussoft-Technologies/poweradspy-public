import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Stub es-connections so the src import doesn't try to connect to ES.
const esConnPath = require.resolve("../../es-connections/connection");
require.cache[esConnPath] = {
  id: esConnPath, filename: esConnPath, loaded: true,
  exports: vi.fn(),
};

// Pre-load src + monkey-patch BEFORE the router loads.
const srcModule = require("../../src/dynamic-count-analytics");
const handler = vi.fn();
srcModule.dynamicCountFilter = handler;

const router = require("../../routes/dynamic-count-analytics");

describe("routes/dynamic-count-analytics > registration", () => {
  it("exports an Express router", () => {
    expect(typeof router).toBe("function");
    expect(Array.isArray(router.stack)).toBe(true);
  });

  it("registers POST /get-count with the audit middleware then dynamicCountFilter", () => {
    const layer = router.stack.find((l) => l.route && l.route.path === "/get-count");
    expect(layer).toBeDefined();
    expect(layer.route.methods.post).toBe(true);
    const handlers = layer.route.stack;
    expect(handlers[0].handle).toBe(router.auditLog);          // audit runs first
    expect(handlers[handlers.length - 1].handle).toBe(handler); // then the controller
  });

  it("registers exactly one route on the router", () => {
    const routes = router.stack.filter((l) => l.route);
    expect(routes).toHaveLength(1);
  });
});

describe("routes/dynamic-count-analytics > auditLog middleware", () => {
  it("wraps res.json (still sends), and calls next()", () => {
    process.env.GET_COUNT_LOG_DISABLED = "1"; // don't write files in this unit test
    const sent = [];
    const res = { statusCode: 200, json: (b) => { sent.push(b); return res; } };
    const next = vi.fn();
    router.auditLog({ headers: {}, body: { network: "facebook" } }, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    const out = res.json({ ok: 1 });          // call the wrapped json
    expect(sent).toEqual([{ ok: 1 }]);         // original json still ran
    expect(out).toBe(res);                     // chainable return preserved
    delete process.env.GET_COUNT_LOG_DISABLED;
  });
});
