import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const CircuitBreaker = require("../../src/utils/circuitBreaker");

describe("utils/circuitBreaker", () => {
  it("constructor uses default thresholds when options omitted", () => {
    const cb = new CircuitBreaker(vi.fn());
    expect(cb.state).toBe("CLOSED");
    expect(cb.failureThreshold).toBe(5);
    expect(cb.resetTimeout).toBe(30000);
    expect(cb.failureCount).toBe(0);
    expect(cb.lastFailureTime).toBeNull();
  });

  it("constructor respects custom options", () => {
    const cb = new CircuitBreaker(vi.fn(), { failureThreshold: 2, resetTimeout: 100 });
    expect(cb.failureThreshold).toBe(2);
    expect(cb.resetTimeout).toBe(100);
  });

  it("fire() returns action result on success and stays CLOSED", async () => {
    const action = vi.fn(async (x) => x * 2);
    const cb = new CircuitBreaker(action);
    const out = await cb.fire(21);
    expect(out).toBe(42);
    expect(cb.state).toBe("CLOSED");
    expect(cb.failureCount).toBe(0);
  });

  it("fire() rethrows on action failure; failureCount increments", async () => {
    const cb = new CircuitBreaker(vi.fn(async () => { throw new Error("fail"); }), { failureThreshold: 3 });
    await expect(cb.fire()).rejects.toThrow("fail");
    expect(cb.failureCount).toBe(1);
    expect(cb.state).toBe("CLOSED"); // still closed below threshold
  });

  it("opens after failureThreshold consecutive failures", async () => {
    const cb = new CircuitBreaker(vi.fn(async () => { throw new Error("x"); }), { failureThreshold: 2 });
    await expect(cb.fire()).rejects.toThrow();
    await expect(cb.fire()).rejects.toThrow();
    expect(cb.state).toBe("OPEN");
  });

  it("fire() throws 'Circuit Breaker is OPEN' when OPEN within reset window", async () => {
    const cb = new CircuitBreaker(vi.fn(), { failureThreshold: 1, resetTimeout: 30000 });
    cb.state = "OPEN";
    cb.lastFailureTime = Date.now();
    await expect(cb.fire()).rejects.toThrow("Circuit Breaker is OPEN");
  });

  it("transitions OPEN → HALF_OPEN when resetTimeout has elapsed", async () => {
    const action = vi.fn(async () => "ok");
    const cb = new CircuitBreaker(action, { resetTimeout: 100 });
    cb.state = "OPEN";
    cb.lastFailureTime = Date.now() - 200; // past the reset window
    const out = await cb.fire();
    expect(out).toBe("ok");
    expect(cb.state).toBe("CLOSED"); // success in HALF_OPEN re-closes
  });

  it("failure in HALF_OPEN trips back to OPEN immediately (line 43 first operand)", async () => {
    const cb = new CircuitBreaker(vi.fn(async () => { throw new Error("x"); }), { failureThreshold: 100, resetTimeout: 0 });
    cb.state = "HALF_OPEN";
    cb.lastFailureTime = Date.now() - 1; // not used here since state already HALF_OPEN
    await expect(cb.fire()).rejects.toThrow();
    expect(cb.state).toBe("OPEN");
  });

  it("onSuccess explicit call resets failureCount + closes state", () => {
    const cb = new CircuitBreaker(vi.fn());
    cb.failureCount = 5;
    cb.state = "OPEN";
    cb.onSuccess();
    expect(cb.failureCount).toBe(0);
    expect(cb.state).toBe("CLOSED");
  });
});
