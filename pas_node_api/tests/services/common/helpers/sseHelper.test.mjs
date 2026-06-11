import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { sendEvent, runFetcher, streamInsights, INSIGHT_TIMEOUT_MS } = require("../../../../src/services/common/helpers/sseHelper");

const fakeLogger = { warn: vi.fn(), error: vi.fn(), info: vi.fn() };

function mockReq() {
  const handlers = {};
  return {
    on: vi.fn((evt, fn) => { handlers[evt] = fn; }),
    handlers,
  };
}

function mockRes() {
  const writes = [];
  return {
    writableEnded: false,
    writeHead: vi.fn(),
    write: vi.fn((chunk) => { writes.push(chunk); }),
    end: vi.fn(function () { this.writableEnded = true; }),
    _writes: writes,
  };
}

beforeEach(() => {
  fakeLogger.warn.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("services/common/helpers/sseHelper > sendEvent", () => {
  it("writes formatted SSE chunk when res not ended", () => {
    const res = mockRes();
    sendEvent(res, "lcs", { code: 200, data: 1 });
    expect(res.write).toHaveBeenCalledWith(`event: lcs\ndata: {"code":200,"data":1}\n\n`);
  });

  it("skips write when res.writableEnded", () => {
    const res = mockRes();
    res.writableEnded = true;
    sendEvent(res, "x", {});
    expect(res.write).not.toHaveBeenCalled();
  });
});

describe("services/common/helpers/sseHelper > runFetcher", () => {
  it("resolves with fetcher result on success", async () => {
    const entry = { key: "k1", fn: vi.fn().mockResolvedValueOnce({ code: 200, data: { x: 1 } }) };
    const p = runFetcher(entry, { body: {} }, {}, fakeLogger);
    const out = await p;
    expect(out).toEqual({ key: "k1", code: 200, data: { x: 1 } });
  });

  it("resolves with 500/error on fetcher rejection", async () => {
    const entry = { key: "k2", fn: vi.fn().mockRejectedValueOnce(new Error("boom")) };
    const p = runFetcher(entry, { body: {} }, {}, fakeLogger);
    const out = await p;
    expect(out).toEqual({ key: "k2", code: 500, data: null, error: "boom" });
    expect(fakeLogger.warn).toHaveBeenCalledWith("Insight [k2] failed", { error: "boom" });
  });

  it("resolves with 408/Timed out when fetcher exceeds INSIGHT_TIMEOUT_MS", async () => {
    let resolveFn;
    const entry = { key: "k3", fn: vi.fn(() => new Promise((r) => { resolveFn = r; })) };
    const p = runFetcher(entry, { body: {} }, {}, fakeLogger);
    vi.advanceTimersByTime(INSIGHT_TIMEOUT_MS + 1);
    const out = await p;
    expect(out).toEqual({ key: "k3", code: 408, data: null, error: "Timed out" });
    expect(fakeLogger.warn).toHaveBeenCalledWith(expect.stringContaining("timed out"));
    // Late resolution does NOT double-resolve
    resolveFn({ code: 200 });
  });

  it("late fetcher reject after timeout is ignored (settled guard)", async () => {
    let rejectFn;
    const entry = { key: "k4", fn: vi.fn(() => new Promise((_, rej) => { rejectFn = rej; })) };
    const p = runFetcher(entry, { body: {} }, {}, fakeLogger);
    vi.advanceTimersByTime(INSIGHT_TIMEOUT_MS + 1);
    const out = await p;
    expect(out.code).toBe(408);
    // Now reject after the timeout — should be a no-op
    rejectFn(new Error("late"));
  });
});

describe("services/common/helpers/sseHelper > streamInsights", () => {
  it("empty registry → sends 'done' with 'No insights applicable' and ends", () => {
    const req = mockReq();
    const res = mockRes();
    streamInsights(req, res, [], {}, {}, fakeLogger);
    expect(res.writeHead).toHaveBeenCalledWith(200, expect.objectContaining({
      "Content-Type": "text/event-stream",
    }));
    expect(res._writes.some((w) => w.includes("No insights applicable"))).toBe(true);
    expect(res.end).toHaveBeenCalled();
  });

  it("filters out non-applicable entries via condition", async () => {
    const req = mockReq();
    const res = mockRes();
    const registry = [
      { key: "a", fn: vi.fn().mockResolvedValue({ code: 200 }), payload: () => ({}), condition: () => false },
      { key: "b", fn: vi.fn().mockResolvedValue({ code: 200 }), payload: () => ({}) },
    ];
    streamInsights(req, res, registry, {}, {}, fakeLogger);
    await vi.advanceTimersByTimeAsync(0);
    expect(registry[0].fn).not.toHaveBeenCalled();
    expect(registry[1].fn).toHaveBeenCalled();
  });

  it("happy path: fires fetchers in parallel, streams events, then 'done'", async () => {
    const req = mockReq();
    const res = mockRes();
    const registry = [
      { key: "a", fn: vi.fn().mockResolvedValue({ code: 200, data: 1 }), payload: () => ({}) },
      { key: "b", fn: vi.fn().mockResolvedValue({ code: 200, data: 2 }), payload: () => ({}) },
    ];
    streamInsights(req, res, registry, {}, {}, fakeLogger);
    // Let promises resolve
    await vi.advanceTimersByTimeAsync(0);
    expect(res._writes.some((w) => w.startsWith("event: a"))).toBe(true);
    expect(res._writes.some((w) => w.startsWith("event: b"))).toBe(true);
    expect(res._writes.some((w) => w.includes("All insights complete"))).toBe(true);
    expect(res.end).toHaveBeenCalled();
  });

  it("safety timeout closes stream if fetchers stall", () => {
    const req = mockReq();
    const res = mockRes();
    const registry = [
      { key: "stuck", fn: vi.fn(() => new Promise(() => {})), payload: () => ({}) },
    ];
    streamInsights(req, res, registry, {}, {}, fakeLogger);
    vi.advanceTimersByTime(INSIGHT_TIMEOUT_MS + 5000 + 1);
    expect(fakeLogger.warn).toHaveBeenCalledWith(expect.stringContaining("safety timeout"));
    expect(res._writes.some((w) => w.includes("Stream timeout"))).toBe(true);
    expect(res.end).toHaveBeenCalled();
  });

  it("safety timeout: if res already ended, doesn't double-send 'done'", () => {
    const req = mockReq();
    const res = mockRes();
    res.writableEnded = true; // simulate already-ended res
    const registry = [
      { key: "stuck", fn: vi.fn(() => new Promise(() => {})), payload: () => ({}) },
    ];
    streamInsights(req, res, registry, {}, {}, fakeLogger);
    vi.advanceTimersByTime(INSIGHT_TIMEOUT_MS + 5000 + 1);
    expect(res._writes).toHaveLength(0);
  });

  it("client disconnect (req.close): clears safety timer + ends res if not already ended", () => {
    const req = mockReq();
    const res = mockRes();
    const registry = [
      { key: "stuck", fn: vi.fn(() => new Promise(() => {})), payload: () => ({}) },
    ];
    streamInsights(req, res, registry, {}, {}, fakeLogger);
    req.handlers.close();
    expect(res.end).toHaveBeenCalled();
  });

  it("client disconnect when res already ended → no-op end", () => {
    const req = mockReq();
    const res = mockRes();
    const registry = [
      { key: "stuck", fn: vi.fn(() => new Promise(() => {})), payload: () => ({}) },
    ];
    streamInsights(req, res, registry, {}, {}, fakeLogger);
    res.writableEnded = true;
    req.handlers.close();
    expect(res.end).not.toHaveBeenCalled();
  });

  it("sendEvent .catch path: covers final 'all complete' fallback when sendEvent rejects", async () => {
    // sendEvent itself is synchronous and doesn't return a promise, so the
    // .then() never rejects unless we tamper with res.write. Tamper to make
    // write throw — which will propagate through sendEvent's call → up via the
    // synchronous .then callback to the .catch handler.
    const req = mockReq();
    const res = mockRes();
    let writeCount = 0;
    res.write = vi.fn(() => {
      writeCount++;
      if (writeCount === 1) throw new Error("write-fail");
    });
    const registry = [
      { key: "a", fn: vi.fn().mockResolvedValue({ code: 200 }), payload: () => ({}) },
    ];
    streamInsights(req, res, registry, {}, {}, fakeLogger);
    await vi.advanceTimersByTimeAsync(0);
    expect(fakeLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("SSE event send failed for [a]"),
      expect.any(Object)
    );
  });

  it(".catch with completed < total: falsy branch of `if (completed === total)`", async () => {
    // Three entries: 'a' and 'b' fail (write throws), 'c' succeeds.
    // Microtask order under the promise machinery:
    //   'a'.then throws → 'a'.catch queued
    //   'b'.then throws → 'b'.catch queued
    //   'c'.then succeeds → completed=1 (1 !== 3, falsy of line 90)
    //   'a'.catch → completed=2 (2 !== 3, FALSY of line 98) ← this is the branch
    //   'b'.catch → completed=3 (3 === 3, truthy of line 98)
    const req = mockReq();
    const res = mockRes();
    res.write = vi.fn((chunk) => {
      if (chunk.startsWith("event: a") || chunk.startsWith("event: b")) {
        throw new Error("write-fail");
      }
    });
    const registry = [
      { key: "a", fn: vi.fn().mockResolvedValue({ code: 200 }), payload: () => ({}) },
      { key: "b", fn: vi.fn().mockResolvedValue({ code: 200 }), payload: () => ({}) },
      { key: "c", fn: vi.fn().mockResolvedValue({ code: 200 }), payload: () => ({}) },
    ];
    streamInsights(req, res, registry, {}, {}, fakeLogger);
    await vi.advanceTimersByTimeAsync(0);
    expect(fakeLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("SSE event send failed for [a]"),
      expect.any(Object)
    );
    expect(fakeLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("SSE event send failed for [b]"),
      expect.any(Object)
    );
    expect(res.end).toHaveBeenCalled();
  });

  it(".catch with res.writableEnded=true: falsy branch of `if (!res.writableEnded)`", async () => {
    // Force write to set writableEnded=true AND throw on first call, so the
    // .catch branch runs with res.writableEnded=true → falsy branch hit.
    const req = mockReq();
    const res = mockRes();
    res.write = vi.fn(() => {
      res.writableEnded = true;
      throw new Error("write-fail");
    });
    const registry = [
      { key: "only", fn: vi.fn().mockResolvedValue({ code: 200 }), payload: () => ({}) },
    ];
    streamInsights(req, res, registry, {}, {}, fakeLogger);
    await vi.advanceTimersByTimeAsync(0);
    expect(fakeLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("SSE event send failed for [only]"),
      expect.any(Object)
    );
    // res.end NOT called because the inner !writableEnded guard skipped it
    expect(res.end).not.toHaveBeenCalled();
  });

  it("runFetcher timeout fires after settled=true (line 23 settled-guard branch)", async () => {
    // Race: stub clearTimeout so the timer is NOT cancelled by the resolve path.
    // Then advance time so the timer callback runs while settled=true → early return.
    const clearSpy = vi.spyOn(globalThis, "clearTimeout").mockImplementation(() => {});
    try {
      const entry = { key: "race", fn: vi.fn().mockResolvedValue({ code: 200 }) };
      const p = runFetcher(entry, { body: {} }, {}, fakeLogger);
      const out = await p; // resolves via .then, sets settled=true
      expect(out.code).toBe(200);
      const warnsBefore = fakeLogger.warn.mock.calls.length;
      // Now fire the timer that wasn't cleared — settled is true, so the callback
      // should hit `if (settled) return;` without logging a timeout warning.
      vi.advanceTimersByTime(INSIGHT_TIMEOUT_MS + 1);
      const timeoutWarn = fakeLogger.warn.mock.calls
        .slice(warnsBefore)
        .some(([msg]) => typeof msg === "string" && msg.includes("timed out"));
      expect(timeoutWarn).toBe(false);
    } finally {
      clearSpy.mockRestore();
    }
  });
});
