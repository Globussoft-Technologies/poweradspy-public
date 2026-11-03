import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);

import { makeConfig } from "./helpers.mjs";

const { BlocklistCache } = require("../../../src/compliance/blocklist/cache");
const { STATUS } = require("../../../src/compliance/blocklist/constants");
const { parseHash } = require("../../../src/compliance/imagematch/matcher");

// Banned image hashes (B2) travel with the list but never endanger it.

const log = { info() {}, warn() {}, error() {} };
const ROWS = [{ id: 1, entry_type: "ad_id", value: "1" }, { id: 2, entry_type: "domain", value: "bad.com" }];
const SHA = "a".repeat(64);
const PHASH = "460e931b54bbbb9667c97c9459eed7c8f2439b62c259c021fefb559058f57304"; // 256 bits, 64 hex characters
const ALGO = "sscd-simhash-v1";
const IMAGE_ROWS = [
  { id: 11, image_sha256: SHA, image_phash: PHASH, image_phash_algo: ALGO },
  { id: 12, image_sha256: "b".repeat(64), image_phash: null, image_phash_algo: null },
];

let dir;
let cache;

function makeCache({ loadActive, loadImageHashes } = {}) {
  const config = makeConfig({ enabled: true, snapshot: { dir }, loadTimeoutMs: 500 });
  const repository = { loadActive, ...(loadImageHashes ? { loadImageHashes } : {}) };
  cache = new BlocklistCache({ repository, getSql: () => ({}), config, log });
  return cache;
}

async function begin(c) {
  await c.start(["reddit"]);
  c.stop();
  return c;
}

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "blocklist-img-")); });
afterEach(() => { cache?.stop(); fs.rmSync(dir, { recursive: true, force: true }); });

describe("blocklist.cache > banned image hashes", () => {
  it("loads them in their own query and exposes { id, sha256, phash (8 words), algo }", async () => {
    const loadImageHashes = vi.fn(async () => IMAGE_ROWS);
    const c = await begin(makeCache({ loadActive: async () => ROWS, loadImageHashes }));
    expect(loadImageHashes).toHaveBeenCalledTimes(1);
    expect(c.get("reddit").imageHashesLoaded).toBe(true);
    expect(c.get("reddit").snapshot.imageHashes).toEqual([
      { id: 11, sha256: SHA, phash: parseHash(PHASH), algo: ALGO },
      { id: 12, sha256: "b".repeat(64), phash: null, algo: null },
    ]);
    expect(c.summary().reddit).toMatchObject({ imageHashes: 2, imageHashesLoaded: true, imageHashesError: null });
  });

  it("a failing image query never stops the ingestion matching list", async () => {
    const c = await begin(makeCache({
      loadActive: async () => ROWS,
      loadImageHashes: async () => { throw new Error("Unknown column image_phash"); },
    }));
    expect(c.get("reddit").status).toBe(STATUS.READY);
    expect(c.get("reddit").snapshot.count).toBe(2);
    expect(c.get("reddit").imageHashesLoaded).toBe(false);
    expect(c.get("reddit").imageHashesError).toMatch(/Unknown column/);
    expect(c.get("reddit").snapshot.imageHashes).toEqual([]);
  });

  it("a hung image query is cut off and also leaves the matching list ready", async () => {
    const c = await begin(makeCache({ loadActive: async () => ROWS, loadImageHashes: () => new Promise(() => {}) }));
    expect(c.get("reddit").status).toBe(STATUS.READY);
    expect(c.get("reddit").imageHashesError).toMatch(/timed out/);
  });

  it("keeps the previous hashes when a later image query fails, and recovers", async () => {
    let fail = false;
    const c = await begin(makeCache({
      loadActive: async () => ROWS,
      loadImageHashes: async () => { if (fail) throw new Error("blip"); return IMAGE_ROWS; },
    }));
    fail = true;
    await c.refreshNetwork("reddit");
    expect(c.get("reddit").snapshot.imageHashes).toHaveLength(2);
    expect(c.get("reddit").imageHashesError).toBe("blip");
    fail = false;
    await c.refreshNetwork("reddit");
    expect(c.get("reddit").imageHashesError).toBeNull();
  });

  it("works with a repository that has no image query: matching is unaffected", async () => {
    const c = await begin(makeCache({ loadActive: async () => ROWS }));
    expect(c.get("reddit").status).toBe(STATUS.READY);
    expect(c.get("reddit").imageHashesLoaded).toBe(false);
    expect(c.get("reddit").snapshot.imageHashes).toEqual([]);
  });

  it("saves them with the copy on disk (the 256-bit hash as its 64 hex characters) and restores them when the database is down", async () => {
    await begin(makeCache({ loadActive: async () => ROWS, loadImageHashes: async () => IMAGE_ROWS }));
    const saved = JSON.parse(fs.readFileSync(path.join(dir, "blocklist-reddit.json"), "utf8"));
    expect(saved.imageHashesLoaded).toBe(true);
    expect(saved.imageHashes[0]).toEqual({ id: 11, sha256: SHA, phash: PHASH, algo: ALGO });
    expect(saved.imageHashes[1]).toEqual({ id: 12, sha256: "b".repeat(64), phash: null, algo: null });

    const c = await begin(makeCache({ loadActive: async () => { throw new Error("db down"); } }));
    expect(c.get("reddit").status).toBe(STATUS.FROM_FILE);
    expect(c.get("reddit").imageHashesLoaded).toBe(true);
    expect(c.get("reddit").snapshot.imageHashes[0].phash).toEqual(parseHash(PHASH));
    expect(c.get("reddit").snapshot.imageHashes[1].phash).toBeNull();
  });

  it("a saved copy from the old 64-bit design is read without the perceptual hash, keeping the exact match", async () => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "blocklist-reddit.json"), JSON.stringify({
      network: "reddit", savedAt: Date.now(), rows: ROWS, imageHashesLoaded: true,
      imageHashes: [{ id: 11, sha256: SHA, phash: "18446744073709551615", algo: "dhash" }],
    }));
    const c = await begin(makeCache({ loadActive: async () => { throw new Error("db down"); } }));
    expect(c.get("reddit").status).toBe(STATUS.FROM_FILE);
    expect(c.get("reddit").snapshot.imageHashes).toEqual([{ id: 11, sha256: SHA, phash: null, algo: null }]);
  });

  it("restores from a copy saved before hashes existed, without claiming they were loaded", async () => {
    fs.writeFileSync(path.join(dir, "blocklist-reddit.json"), JSON.stringify({ network: "reddit", savedAt: 1, rows: ROWS }));
    const c = await begin(makeCache({ loadActive: async () => { throw new Error("down"); } }));
    expect(c.get("reddit").status).toBe(STATUS.FROM_FILE);
    expect(c.get("reddit").snapshot.imageHashes).toEqual([]);
    expect(c.get("reddit").imageHashesLoaded).toBe(false);
  });

  it("a force refresh accepts an empty list (our own revoke of the last entry); a normal refresh does not", async () => {
    let rows = ROWS;
    const c = await begin(makeCache({ loadActive: async () => rows }));
    rows = [];
    await c.refreshNetwork("reddit");
    expect(c.get("reddit").snapshot.count).toBe(2); // the empty-refresh guard kept the old list
    await c.refreshNetwork("reddit", { force: true });
    expect(c.get("reddit").status).toBe(STATUS.READY);
    expect(c.get("reddit").snapshot.count).toBe(0);
  });
});

describe("blocklist.cache > banned images are read incrementally", () => {
  const later = (n) => ({ id: n, image_sha256: String(n % 10).repeat(64), image_phash: PHASH, image_phash_algo: ALGO });
  let now;
  beforeEach(() => { now = 1_000_000; vi.spyOn(Date, "now").mockImplementation(() => now); });
  afterEach(() => vi.restoreAllMocks());

  function timed({ rows = ROWS, images }) {
    const loadImageHashes = vi.fn(async (_sql, _network, opts) => images(opts));
    const config = makeConfig({ enabled: true, snapshot: { dir }, loadTimeoutMs: 500, imageRefreshSeconds: 60, imageFullReloadSeconds: 900 });
    cache = new BlocklistCache({ repository: { loadActive: async () => rows, loadImageHashes }, getSql: () => ({}), config, log });
    return { c: cache, loadImageHashes };
  }

  it("reads all of them once, then nothing until imageRefreshSeconds, then only the rows after the last id", async () => {
    let table = [...IMAGE_ROWS];
    const { c, loadImageHashes } = timed({ images: (o) => table.filter((r) => r.id > (o.afterId || 0)) });
    await begin(c);
    expect(loadImageHashes.mock.calls[0][2].afterId).toBe(0);
    expect(c.get("reddit").snapshot.imageHashes).toHaveLength(2);

    now += 30_000;
    await c.refreshNetwork("reddit");
    expect(loadImageHashes).toHaveBeenCalledTimes(1); // too soon: no image query at all

    table.push(later(13), later(14));
    now += 31_000;
    await c.refreshNetwork("reddit");
    expect(loadImageHashes).toHaveBeenCalledTimes(2);
    expect(loadImageHashes.mock.calls[1][2].afterId).toBe(12); // only what is new
    expect(c.get("reddit").snapshot.imageHashes.map((h) => h.id)).toEqual([11, 12, 13, 14]);
    expect(c.get("reddit").imageHashesLoaded).toBe(true);
  });

  it("keeps the very same array when nothing new arrived, so the matcher's index is not rebuilt", async () => {
    const { c } = timed({ images: (o) => IMAGE_ROWS.filter((r) => r.id > (o.afterId || 0)) });
    await begin(c);
    const before = c.get("reddit").snapshot.imageHashes;
    now += 61_000;
    await c.refreshNetwork("reddit");
    expect(c.get("reddit").snapshot.imageHashes).toBe(before);
  });

  it("reads everything again after imageFullReloadSeconds, which drops a removed image", async () => {
    let table = [...IMAGE_ROWS];
    const { c, loadImageHashes } = timed({ images: (o) => table.filter((r) => r.id > (o.afterId || 0)) });
    await begin(c);
    table = [IMAGE_ROWS[0]]; // 12 was revoked
    now += 61_000;
    await c.refreshNetwork("reddit");
    expect(c.get("reddit").snapshot.imageHashes).toHaveLength(2); // an incremental read cannot see a removal
    now += 900_000;
    await c.refreshNetwork("reddit");
    expect(loadImageHashes.mock.calls.at(-1)[2].afterId).toBe(0);
    expect(c.get("reddit").snapshot.imageHashes.map((h) => h.id)).toEqual([11]);
  });

  it("images: 'incremental' (after an add) reads the new ones at once, 'full' (after a revoke) reads all at once", async () => {
    let table = [...IMAGE_ROWS];
    const { c, loadImageHashes } = timed({ images: (o) => table.filter((r) => r.id > (o.afterId || 0)) });
    await begin(c);
    table.push(later(15));
    await c.refreshNetwork("reddit", { force: true, images: "incremental" }); // no time has passed
    expect(loadImageHashes.mock.calls.at(-1)[2].afterId).toBe(12);
    expect(c.get("reddit").snapshot.imageHashes.map((h) => h.id)).toEqual([11, 12, 15]);
    table = table.filter((r) => r.id !== 12);
    await c.refreshNetwork("reddit", { force: true, images: "full" });
    expect(loadImageHashes.mock.calls.at(-1)[2].afterId).toBe(0);
    expect(c.get("reddit").snapshot.imageHashes.map((h) => h.id)).toEqual([11, 15]);
  });

  it("a failed incremental read keeps the images it has and is tried again on the next refresh", async () => {
    let fail = false;
    const { c, loadImageHashes } = timed({ images: (o) => { if (fail) throw new Error("db"); return IMAGE_ROWS.filter((r) => r.id > (o.afterId || 0)); } });
    await begin(c);
    fail = true;
    now += 61_000;
    await c.refreshNetwork("reddit");
    expect(c.get("reddit").snapshot.imageHashes).toHaveLength(2);
    expect(c.get("reddit").imageHashesError).toMatch(/db/);
    fail = false;
    await c.refreshNetwork("reddit"); // not 60 s later, but the last check failed so it is not counted
    expect(loadImageHashes).toHaveBeenCalledTimes(3);
    expect(c.get("reddit").imageHashesError).toBeNull();
  });

  it("does not rebuild or rewrite an unchanged list, and does when something changed", async () => {
    let rows = ROWS;
    const { c } = timed({ rows: undefined, images: (o) => IMAGE_ROWS.filter((r) => r.id > (o.afterId || 0)) });
    c.repository.loadActive = async () => rows;
    await begin(c);
    const save = vi.spyOn(c, "saveFile");
    const snapshot = c.get("reddit").snapshot;
    now += 61_000;
    await c.refreshNetwork("reddit");
    expect(c.get("reddit").snapshot).toBe(snapshot);
    expect(save).not.toHaveBeenCalled();

    rows = [...ROWS, { id: 3, entry_type: "domain", value: "worse.com" }];
    await c.refreshNetwork("reddit");
    expect(c.get("reddit").snapshot).not.toBe(snapshot);
    expect(c.get("reddit").snapshot.count).toBe(3);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("without the image timers every refresh reads every banned image, as before", async () => {
    const loadImageHashes = vi.fn(async () => IMAGE_ROWS);
    await begin(makeCache({ loadActive: async () => ROWS, loadImageHashes }));
    await cache.refreshNetwork("reddit");
    await cache.refreshNetwork("reddit");
    expect(loadImageHashes).toHaveBeenCalledTimes(3);
    expect(loadImageHashes.mock.calls.every((c) => !c[2].afterId)).toBe(true);
  });
});
