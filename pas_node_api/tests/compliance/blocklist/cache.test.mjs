import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);

const { BlocklistCache } = require("../../../src/compliance/blocklist/cache");
import { makeConfig } from "./helpers.mjs";
const { STATUS } = require("../../../src/compliance/blocklist/constants");

const log = { info() {}, warn() {}, error() {} };
const ROWS = [{ id: 1, entry_type: "ad_id", value: "1" }, { id: 2, entry_type: "domain", value: "bad.com" }];

let dir;
let cache;

function makeCache({ loadActive, getSql = () => ({}), raw = {} } = {}) {
  const config = makeConfig({ enabled: true, snapshot: { dir }, loadTimeoutMs: 500, ...raw });
  cache = new BlocklistCache({ repository: { loadActive }, getSql, config, log });
  return cache;
}

async function begin(c, networks = ["reddit"]) {
  await c.start(networks);
  c.stop(); // no background timer in tests; refresh is driven by hand
  return c;
}

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "blocklist-test-")); });
afterEach(() => { cache?.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

describe("compliance/blocklist > BlocklistCache", () => {
  it("loads from the database, becomes ready, and saves a copy to disk", async () => {
    const c = await begin(makeCache({ loadActive: vi.fn(async () => ROWS) }));
    expect(c.get("reddit")).toMatchObject({ status: STATUS.READY });
    expect(c.get("reddit").snapshot.count).toBe(2);
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "blocklist-reddit.json"), "utf8"));
    expect(saved.rows).toHaveLength(2);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });

  it("starts from the saved copy when the database is down", async () => {
    await begin(makeCache({ loadActive: async () => ROWS })); // writes the copy
    const c = await begin(makeCache({ loadActive: async () => { throw new Error("db down"); } }));
    expect(c.get("reddit")).toMatchObject({ status: STATUS.FROM_FILE, lastError: "db down" });
    expect(c.get("reddit").snapshot.count).toBe(2);
  });

  it("is unavailable when the database is down and no copy exists", async () => {
    const c = await begin(makeCache({ loadActive: async () => { throw new Error("db down"); } }));
    expect(c.get("reddit")).toMatchObject({ status: STATUS.UNAVAILABLE, snapshot: null });
  });

  it("is unavailable when the table is missing or there is no connection", async () => {
    const missing = await begin(makeCache({ loadActive: async () => { throw new Error("Table 'copyright_blocklist' doesn't exist"); } }));
    expect(missing.get("reddit").status).toBe(STATUS.UNAVAILABLE);
    const noConn = await begin(makeCache({ loadActive: async () => ROWS, getSql: () => null }));
    expect(noConn.get("reddit")).toMatchObject({ status: STATUS.UNAVAILABLE, lastError: "no SQL connection" });
  });

  it("keeps the last good list when a later refresh fails, then recovers", async () => {
    let fail = false;
    const c = await begin(makeCache({ loadActive: async () => { if (fail) throw new Error("blip"); return ROWS; } }));
    fail = true;
    await c.refreshNetwork("reddit");
    expect(c.get("reddit")).toMatchObject({ status: STATUS.STALE });
    expect(c.get("reddit").snapshot.count).toBe(2);
    fail = false;
    await c.refreshNetwork("reddit");
    expect(c.get("reddit")).toMatchObject({ status: STATUS.READY, lastError: null });
  });

  it("treats an empty refresh after a non-empty list as a failure", async () => {
    let rows = ROWS;
    const c = await begin(makeCache({ loadActive: async () => rows }));
    rows = [];
    await c.refreshNetwork("reddit");
    expect(c.get("reddit").status).toBe(STATUS.STALE);
    expect(c.get("reddit").snapshot.count).toBe(2);
  });

  it("accepts an empty refresh when the guard is off", async () => {
    let rows = ROWS;
    const c = await begin(makeCache({ loadActive: async () => rows, raw: { emptyRefreshGuard: false } }));
    rows = [];
    await c.refreshNetwork("reddit");
    expect(c.get("reddit")).toMatchObject({ status: STATUS.READY });
    expect(c.get("reddit").snapshot.count).toBe(0);
  });

  it("picks up a removed entry on the next refresh", async () => {
    let rows = ROWS;
    const c = await begin(makeCache({ loadActive: async () => rows }));
    rows = [ROWS[1]];
    await c.refreshNetwork("reddit");
    expect(c.get("reddit").snapshot.byFamily.has("ad_id")).toBe(false);
  });

  it("times out a hung database instead of blocking startup", async () => {
    const c = await begin(makeCache({ loadActive: () => new Promise(() => {}) }));
    expect(c.get("reddit").status).toBe(STATUS.UNAVAILABLE);
    expect(c.get("reddit").lastError).toMatch(/timed out/);
  });

  it("keeps networks independent", async () => {
    const c = await begin(makeCache({
      loadActive: async (sql, network) => { if (network === "quora") throw new Error("down"); return ROWS; },
    }), ["reddit", "quora"]);
    expect(c.get("reddit").status).toBe(STATUS.READY);
    expect(c.get("quora").status).toBe(STATUS.UNAVAILABLE);
  });

  it("ignores a corrupt or mismatched saved copy", async () => {
    fs.writeFileSync(path.join(dir, "blocklist-reddit.json"), "{not json");
    const c = await begin(makeCache({ loadActive: async () => { throw new Error("down"); } }));
    expect(c.get("reddit").status).toBe(STATUS.UNAVAILABLE);

    fs.writeFileSync(path.join(dir, "blocklist-reddit.json"), JSON.stringify({ network: "quora", rows: ROWS, savedAt: 1 }));
    const c2 = await begin(makeCache({ loadActive: async () => { throw new Error("down"); } }));
    expect(c2.get("reddit").status).toBe(STATUS.UNAVAILABLE);
  });

  it("refuses unsafe network names for file paths", () => {
    const c = makeCache({ loadActive: async () => ROWS });
    expect(c.filePath("../etc/passwd")).toBeNull();
    expect(c.filePath("reddit")).toMatch(/blocklist-reddit\.json$/);
  });

  it("does not write or read a copy when snapshots are disabled", async () => {
    const c = await begin(makeCache({ loadActive: async () => ROWS, raw: { snapshot: { enabled: false, dir } } }));
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(c.get("reddit").status).toBe(STATUS.READY);
  });

  it("does not overlap refreshes", async () => {
    let calls = 0;
    let release;
    const gate = new Promise((r) => { release = r; });
    const c = makeCache({ loadActive: async () => { calls += 1; await gate; return ROWS; } });
    c.networks = ["reddit"];
    c.states.set("reddit", { status: STATUS.UNAVAILABLE, snapshot: null, loadedAt: null, lastError: null });
    const first = c.refreshAll();
    await c.refreshAll(); // returns immediately while the first is running
    release();
    await first;
    expect(calls).toBe(1);
  });
});
