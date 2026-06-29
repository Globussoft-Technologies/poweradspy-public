import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const engine = require("../../src/insertion/InsertionEngine");
const logger = require("../../src/logger");

describe("insertion/InsertionEngine > run", () => {
  it("returns batch:false and index 0 for a single ad", async () => {
    const processOne = vi.fn(async () => ({ code: 200, status: "ok" }));
    const out = await engine.run({ ad_id: "a1" }, processOne);
    expect(out).toEqual({ batch: false, result: { code: 200, status: "ok", index: 0 } });
  });

  it("returns batch:true with per-ad results in input order", async () => {
    const processOne = vi.fn(async (ad, index) => ({ code: 200, ad_id: ad.ad_id, index }));
    const out = await engine.run([{ ad_id: "a1" }, { ad_id: "a2" }], processOne);
    expect(out.batch).toBe(true);
    expect(out.results).toEqual([
      { code: 200, ad_id: "a1", index: 0 },
      { code: 200, ad_id: "a2", index: 1 },
    ]);
    expect(out.summary).toEqual({ total: 2, ok: 2, failed: 0 });
  });

  it("counts 4xx results as failed", async () => {
    const processOne = vi.fn(async () => ({ code: 400, status: "rejected", message: "bad" }));
    const out = await engine.run([{ ad_id: "a1" }, { ad_id: "a2" }], processOne);
    expect(out.summary).toEqual({ total: 2, ok: 0, failed: 2 });
    expect(out.results[0]).toMatchObject({ code: 400, index: 0 });
  });

  it("isolates a thrown error to a single ad result", async () => {
    const processOne = vi.fn(async (ad) => {
      if (ad.ad_id === "boom") throw new Error("boom");
      return { code: 200 };
    });
    const out = await engine.run([{ ad_id: "ok" }, { ad_id: "boom" }], processOne);
    expect(out.results[0]).toMatchObject({ code: 200, index: 0 });
    expect(out.results[1]).toMatchObject({
      code: 500,
      status: "server_error",
      index: 1,
      message: "The ad could not be processed due to an unexpected server error.",
    });
    expect(out.summary).toEqual({ total: 2, ok: 1, failed: 1 });
  });
});

describe("insertion/InsertionEngine > rejection logging", () => {
  let warnSpy;
  let infoSpy;

  beforeEach(() => {
    warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    infoSpy = vi.spyOn(logger.insertionRejections, "info").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs rejections via the fallback insertionRejections logger when no request log is passed", async () => {
    const processOne = vi.fn(async () => ({ code: 422, status: "rejected", message: "missing field", field: "ad_id" }));
    await engine.run({ ad_id: "x" }, processOne, { network: "facebook" });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const payload = infoSpy.mock.calls[0][1];
    expect(payload).toMatchObject({
      ad_id: "x",
      network: "facebook",
      code: 422,
      status: "rejected",
      reason: "missing field",
      field: "ad_id",
    });
  });

  it("logs via request-scoped logger.warn when opts.log is provided", async () => {
    const reqLog = { warn: vi.fn(() => {}) };
    const processOne = vi.fn(async () => ({ code: 400, status: "rejected", message: "bad" }));
    await engine.run({ ad_id: "y" }, processOne, { network: "instagram", log: reqLog });
    expect(reqLog.warn).toHaveBeenCalledTimes(1);
    expect(reqLog.warn.mock.calls[0][1]).toMatchObject({ ad_id: "y", network: "instagram", code: 400 });
    expect(warnSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("logs thrown errors via insertionRejections logger", async () => {
    const processOne = vi.fn(async () => { throw new Error("db down"); });
    await engine.run({ ad_id: "z" }, processOne, { network: "gdn" });
    expect(infoSpy).toHaveBeenCalledTimes(1);
    const payload = infoSpy.mock.calls[0][1];
    expect(payload).toMatchObject({ ad_id: "z", network: "gdn", code: 500, status: "server_error", reason: "db down" });
  });
});
