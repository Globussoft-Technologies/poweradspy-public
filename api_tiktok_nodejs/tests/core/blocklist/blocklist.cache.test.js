import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BlocklistCache } from "../../../core/blocklist/blocklist.cache.js";
import { buildSettings } from "../../../core/blocklist/blocklist.service.js";
import { STATUS } from "../../../core/blocklist/blocklist.constants.js";

const log = { info() {}, warn() {}, error() {} };
const ROWS = [{ id: 1, entry_type: "ad_id", value: "1", identifier_namespace: "platform" }, { id: 2, entry_type: "domain", value: "bad.com" }];

let dir;
let cache;

function makeCache({ loadActive, raw = {} } = {}) {
  const config = buildSettings({ enabled: true, snapshot: { dir }, loadTimeoutMs: 500, ...raw });
  cache = new BlocklistCache({ repository: { loadActive }, config, log });
  return cache;
}

async function begin(c) {
  await c.start();
  c.stop(); // no background timer in tests; refresh is driven by hand
  return c;
}

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "tt-blocklist-")); });
afterEach(() => { cache?.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

describe("blocklist.cache > BlocklistCache", () => {
  it("loads from the database, becomes ready, and saves a copy to disk", async () => {
    const c = await begin(makeCache({ loadActive: vi.fn(async () => ROWS) }));
    expect(c.get()).toMatchObject({ status: STATUS.READY });
    expect(c.get().snapshot.count).toBe(2);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "blocklist-tiktok.json"), "utf8"));
    expect(saved.rows).toHaveLength(2);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("starts from the saved copy when the database is down", async () => {
    await begin(makeCache({ loadActive: async () => ROWS })); // writes the copy
    const c = await begin(makeCache({ loadActive: async () => { throw new Error("db down"); } }));
    expect(c.get()).toMatchObject({ status: STATUS.FROM_FILE, lastError: "db down" });
    expect(c.get().snapshot.count).toBe(2);
  });

  it("does not use a saved ad-ID snapshot without namespace information", async () => {
    fs.writeFileSync(path.join(dir, "blocklist-tiktok.json"), JSON.stringify({ network: "tiktok", rows: [{ id: 1, entry_type: "ad_id", value: "42" }] }));
    const c = await begin(makeCache({ loadActive: async () => { throw new Error("db down"); } }));
    expect(c.get().status).toBe(STATUS.UNAVAILABLE);
  });

  it("is unavailable when the database is down (or the table is missing) and no copy exists", async () => {
    const down = await begin(makeCache({ loadActive: async () => { throw new Error("db down"); } }));
    expect(down.get()).toMatchObject({ status: STATUS.UNAVAILABLE, snapshot: null });
    const missing = await begin(makeCache({ loadActive: async () => { throw new Error("Table 'copyright_blocklist' doesn't exist"); } }));
    expect(missing.get().status).toBe(STATUS.UNAVAILABLE);
  });

  it("keeps the last good list when a later refresh fails, then recovers", async () => {
    let fail = false;
    const c = await begin(makeCache({ loadActive: async () => { if (fail) throw new Error("blip"); return ROWS; } }));
    fail = true;
    await c.refresh();
    expect(c.get()).toMatchObject({ status: STATUS.STALE });
    expect(c.get().snapshot.count).toBe(2);
    fail = false;
    await c.refresh();
    expect(c.get()).toMatchObject({ status: STATUS.READY, lastError: null });
  });

  it("treats an empty refresh after a non-empty list as a failure, unless the guard is off", async () => {
    let rows = ROWS;
    const guarded = await begin(makeCache({ loadActive: async () => rows }));
    rows = [];
    await guarded.refresh();
    expect(guarded.get().status).toBe(STATUS.STALE);
    expect(guarded.get().snapshot.count).toBe(2);

    rows = ROWS;
    const open = await begin(makeCache({ loadActive: async () => rows, raw: { emptyRefreshGuard: false } }));
    rows = [];
    await open.refresh();
    expect(open.get()).toMatchObject({ status: STATUS.READY });
    expect(open.get().snapshot.count).toBe(0);
  });

  it("picks up a removed entry on the next refresh", async () => {
    let rows = ROWS;
    const c = await begin(makeCache({ loadActive: async () => rows }));
    rows = [ROWS[1]];
    await c.refresh();
    expect(c.get().snapshot.byFamily.has("ad_id")).toBe(false);
  });

  it("times out a hung database instead of blocking startup", async () => {
    const c = await begin(makeCache({ loadActive: () => new Promise(() => {}) }));
    expect(c.get().status).toBe(STATUS.UNAVAILABLE);
    expect(c.get().lastError).toMatch(/timed out/);
  });

  it("ignores a corrupt or mismatched saved copy", async () => {
    fs.writeFileSync(path.join(dir, "blocklist-tiktok.json"), "{not json");
    const c = await begin(makeCache({ loadActive: async () => { throw new Error("down"); } }));
    expect(c.get().status).toBe(STATUS.UNAVAILABLE);

    fs.writeFileSync(path.join(dir, "blocklist-tiktok.json"), JSON.stringify({ network: "facebook", rows: ROWS, savedAt: 1 }));
    const c2 = await begin(makeCache({ loadActive: async () => { throw new Error("down"); } }));
    expect(c2.get().status).toBe(STATUS.UNAVAILABLE);
  });

  it("does not write or read a copy when snapshots are disabled", async () => {
    const c = await begin(makeCache({ loadActive: async () => ROWS, raw: { snapshot: { enabled: false, dir } } }));
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(c.get().status).toBe(STATUS.READY);
  });

  it("does not overlap refreshes", async () => {
    let calls = 0;
    let release;
    const gate = new Promise((r) => { release = r; });
    const c = makeCache({ loadActive: async () => { calls += 1; await gate; return ROWS; } });
    const first = c.refresh();
    await c.refresh(); // returns immediately while the first is running
    release();
    await first;
    expect(calls).toBe(1);
  });
});
