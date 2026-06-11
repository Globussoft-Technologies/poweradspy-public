import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const wrapAsync = require("../../utils/async-handler");

describe("utils/async-handler > wrapAsync", () => {
  it("returns a function that wraps the supplied handler", () => {
    const wrapped = wrapAsync(async () => undefined);
    expect(typeof wrapped).toBe("function");
    expect(wrapped.length).toBe(3); // (req, res, next)
  });

  it("forwards req/res/next to the wrapped handler", async () => {
    const inner = vi.fn(async () => undefined);
    const wrapped = wrapAsync(inner);
    const req = {}, res = {}, next = vi.fn();
    await wrapped(req, res, next);
    expect(inner).toHaveBeenCalledWith(req, res, next);
  });

  it("calls next() with the rejection when the handler rejects", async () => {
    const err = new Error("boom");
    const inner = async () => { throw err; };
    const wrapped = wrapAsync(inner);
    const next = vi.fn();
    wrapped({}, {}, next);
    // Wait for the promise chain
    await new Promise((r) => setImmediate(r));
    expect(next).toHaveBeenCalledWith(err);
  });

  it("does NOT call next when the handler resolves cleanly", async () => {
    const wrapped = wrapAsync(async () => "ok");
    const next = vi.fn();
    wrapped({}, {}, next);
    await new Promise((r) => setImmediate(r));
    expect(next).not.toHaveBeenCalled();
  });

  it("accepts a synchronous handler too (Promise.resolve wraps the return value)", async () => {
    const wrapped = wrapAsync(() => "sync-ok");
    const next = vi.fn();
    wrapped({}, {}, next);
    await new Promise((r) => setImmediate(r));
    expect(next).not.toHaveBeenCalled();
  });
});
