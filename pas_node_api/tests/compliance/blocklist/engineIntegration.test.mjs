import { describe, it, expect, vi, afterEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const engine = require("../../../src/insertion/InsertionEngine");
const blocklist = require("../../../src/compliance/blocklist/service");
const { BlocklistService } = require("../../../src/compliance/blocklist/service");
const { buildSnapshot } = require("../../../src/compliance/blocklist/match");
import { makeConfig } from "./helpers.mjs";
const { STATUS } = require("../../../src/compliance/blocklist/constants");

const log = { info() {}, warn() {}, error() {} };

function install(rows, { status = STATUS.READY, raw = {} } = {}) {
  const config = makeConfig({ enabled: true, ...raw });
  const states = new Map([["reddit", { status, snapshot: status === STATUS.UNAVAILABLE ? null : buildSnapshot(rows) }]]);
  const cache = { networks: ["reddit"], manages: (n) => states.has(n), get: (n) => states.get(n), summary: () => ({}) };
  const attempts = { record: vi.fn(), queue: [], dropped: 0 };
  blocklist._setServiceForTests(new BlocklistService({ config, cache, attempts, log }));
  return attempts;
}

afterEach(() => blocklist._setServiceForTests(null));

describe("compliance/blocklist > InsertionEngine integration", () => {
  const rows = [{ id: 7, entry_type: "ad_id", value: "bad-1" }];

  it("rejects a blocked ad before the pipeline runs: nothing stored or uploaded, one attempt logged", async () => {
    const attempts = install(rows);
    const processOne = vi.fn(async () => ({ code: 200, status: "ok" }));
    const out = await engine.run({ ad_id: "bad-1" }, processOne, { network: "reddit" });
    expect(processOne).not.toHaveBeenCalled();
    expect(out.result).toMatchObject({ code: 422, status: "rejected", index: 0 });
    expect(attempts.record).toHaveBeenCalledTimes(1);
  });

  it("lets a clean ad through to the pipeline", async () => {
    install(rows);
    const processOne = vi.fn(async () => ({ code: 200, status: "ok" }));
    const out = await engine.run({ ad_id: "fine" }, processOne, { network: "reddit" });
    expect(processOne).toHaveBeenCalledTimes(1);
    expect(out.result).toMatchObject({ code: 200 });
  });

  it("in a batch, rejects only the blocked ads and keeps input order", async () => {
    install(rows);
    const processOne = vi.fn(async (ad) => ({ code: 200, ad_id: ad.ad_id }));
    const out = await engine.run(
      [{ ad_id: "a" }, { ad_id: "bad-1" }, { ad_id: "b" }, { ad_id: "bad-1" }],
      processOne,
      { network: "reddit" }
    );
    expect(processOne).toHaveBeenCalledTimes(2);
    expect(out.results.map((r) => r.code)).toEqual([200, 422, 200, 422]);
    expect(out.results.map((r) => r.index)).toEqual([0, 1, 2, 3]);
    expect(out.summary).toEqual({ total: 4, ok: 2, failed: 2 });
  });

  it("does not apply to delete endpoints (applyPostOwnerRejection: false)", async () => {
    install(rows);
    const processOne = vi.fn(async () => ({ code: 200, status: "ok" }));
    await engine.run({ ad_id: "bad-1" }, processOne, { network: "reddit", applyPostOwnerRejection: false });
    expect(processOne).toHaveBeenCalledTimes(1);
  });

  it("fail closed: rejects with 503 when the list is unavailable", async () => {
    install([], { status: STATUS.UNAVAILABLE });
    const processOne = vi.fn(async () => ({ code: 200 }));
    const out = await engine.run({ ad_id: "x" }, processOne, { network: "reddit" });
    expect(processOne).not.toHaveBeenCalled();
    expect(out.result).toMatchObject({ code: 503, status: "server_error" });
  });

  it("does not touch ads for a network it does not manage, or when not initialised", async () => {
    install(rows);
    const processOne = vi.fn(async () => ({ code: 200 }));
    await engine.run({ ad_id: "bad-1" }, processOne, { network: "facebook" });
    expect(processOne).toHaveBeenCalledTimes(1);

    blocklist._setServiceForTests(null);
    await engine.run({ ad_id: "bad-1" }, processOne, { network: "reddit" });
    expect(processOne).toHaveBeenCalledTimes(2);
  });

  it("runs the existing owner deny-list first and leaves its behavior alone", async () => {
    install(rows);
    const networks = require("../../../src/config/networks");
    const original = networks.google.insertion.rejectedPostOwnerNames;
    networks.google.insertion.rejectedPostOwnerNames = ["Legacy Bad"];
    try {
      const processOne = vi.fn(async () => ({ code: 200 }));
      const out = await engine.run({ ad_id: "ok", post_owner: "legacy bad" }, processOne, { network: "google" });
      expect(processOne).not.toHaveBeenCalled();
      expect(out.result).toMatchObject({ code: 422, field: "post_owner" });
    } finally {
      networks.google.insertion.rejectedPostOwnerNames = original;
    }
  });

  it("when enabled but startup crashed, follows the fail mode instead of silently allowing", async () => {
    const processOne = vi.fn(async () => ({ code: 200 }));
    // a network list that has a length but is not iterable makes cache.start() throw
    const broken = (failMode) => ({ ...makeConfig({ enabled: true, failMode }), networks: { length: 1 } });

    blocklist._setServiceForTests(null);
    await blocklist.init({ config: broken("closed") });
    expect(blocklist.status()).toMatchObject({ enabled: true, failMode: "closed", startupError: expect.any(String) });
    const closed = await engine.run({ ad_id: "x" }, processOne, { network: "reddit" });
    expect(closed.result).toMatchObject({ code: 503 });
    expect(processOne).not.toHaveBeenCalled();
    await blocklist.shutdown();

    blocklist._setServiceForTests(null);
    await blocklist.init({ config: broken("open") });
    await engine.run({ ad_id: "x" }, processOne, { network: "reddit" });
    expect(processOne).toHaveBeenCalledTimes(1);
    await blocklist.shutdown();
  });

  it("when disabled (the default), init does nothing and ads pass", async () => {
    blocklist._setServiceForTests(null);
    await blocklist.init({ config: makeConfig({ enabled: false }) });
    expect(blocklist.status()).toMatchObject({ enabled: false });
    const processOne = vi.fn(async () => ({ code: 200 }));
    await engine.run({ ad_id: "bad-1" }, processOne, { network: "reddit" });
    expect(processOne).toHaveBeenCalledTimes(1);
  });
});
