import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const require = createRequire(import.meta.url);

import { makeConfig } from "./helpers.mjs";

const { BlocklistService } = require("../../../src/compliance/blocklist/service");
const { BlocklistCache } = require("../../../src/compliance/blocklist/cache");
const blocklist = require("../../../src/compliance/blocklist/service");
const { idKey } = require("../../../src/compliance/blocklist/repository");
const { parseHash } = require("../../../src/compliance/imagematch/matcher");

// The flows B3, B2 and B6 run on top of B1, using the REAL cache and service on an
// in-memory copy of the copyright_blocklist table (one table per network database).

function memoryRepository() {
  const dbs = new Map(); // database slug -> rows
  const table = (sql) => {
    if (!dbs.has(sql.db)) dbs.set(sql.db, { rows: [], nextId: 1 });
    return dbs.get(sql.db);
  };
  const visible = (t, network) => t.rows.filter((r) => r.status === "active" && (r.network === network || r.network === "all"));
  return {
    dbs,
    async loadActive(sql, network) {
      return visible(table(sql), network).filter((r) => r.entry_type !== "image_hash")
        .map((r) => ({ id: r.id, entry_type: r.entry_type, value: r.value }));
    },
    async loadImageHashes(sql, network) {
      return visible(table(sql), network).filter((r) => r.entry_type === "image_hash")
        .map((r) => ({ id: r.id, image_sha256: r.image_sha256, image_phash: r.image_phash, image_phash_algo: r.image_phash_algo }));
    },
    async upsertEntries(sql, entries) {
      const t = table(sql);
      for (const e of entries) {
        const existing = t.rows.find((r) => r.network === e.network && r.entry_type === e.entry_type && r.value_sha256 === e.value_sha256);
        if (existing) Object.assign(existing, e, { status: "active", removed_at: null, removed_by: null });
        else t.rows.push({ id: t.nextId++, ...e, status: "active", removed_at: null, removed_by: null });
      }
      return { affected: entries.length };
    },
    async findIds(sql, rows) {
      const t = table(sql);
      const ids = new Map();
      for (const r of rows) {
        const f = t.rows.find((x) => x.network === r.network && x.entry_type === r.entry_type && x.value_sha256 === r.value_sha256);
        if (f) ids.set(idKey(r.network, r.entry_type, r.value_sha256), f.id);
      }
      return ids;
    },
    async revokeEntries(sql, ids, { removedBy }) {
      let affected = 0;
      for (const r of table(sql).rows) {
        if (ids.includes(r.id) && r.status === "active") { r.status = "revoked"; r.removed_by = removedBy; r.removed_at = "now"; affected += 1; }
      }
      return { affected };
    },
  };
}

const silent = { info() {}, warn() {}, error() {} };
let dir;
let repository;
let cache;
let service;
let attempts;

async function start({ enforcement = true, networks = ["reddit", "quora"] } = {}) {
  repository = memoryRepository();
  const config = makeConfig({ enabled: enforcement, snapshot: { dir }, networks });
  const getSql = (n) => ({ db: n });
  cache = enforcement ? new BlocklistCache({ repository, getSql, config, log: silent }) : null;
  attempts = { record: vi.fn(), queue: [], dropped: 0, rejected: 0 };
  service = new BlocklistService({ config, cache, attempts: enforcement ? attempts : null, repository, getSql, log: silent });
  if (cache) { await cache.start(networks); cache.stop(); }
  blocklist._setServiceForTests(service);
}

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), "blocklist-flow-")); });
afterEach(() => { cache?.stop(); blocklist._setServiceForTests(null); fs.rmSync(dir, { recursive: true, force: true }); });

const blockedAd = { ad_id: "bad-1", post_owner: "Fine Co" };
const cleanAd = { ad_id: "ok-1", post_owner: "Fine Co" };

describe("workflow > B3 takedown: add the blocks, then undo them", () => {
  it("add() returns each entry's id, and the ads are rejected at once, on every network", async () => {
    await start();
    const out = await blocklist.add([
      { entryType: "ad_id", value: "bad-1", addedBy: "takedown:anij", reason: "complaint 1" },
      { entryType: "advertiser", value: "Bad Co", addedBy: "takedown:anij" },
      { entryType: "domain", value: "bad.com", addedBy: "takedown:anij" },
    ]);
    expect(out.results.map((r) => [r.network, r.ok])).toEqual([["reddit", true], ["quora", true]]);
    const reddit = out.results[0].entries;
    expect(reddit.map((e) => e.blocklistId)).toEqual([1, 2, 3]); // what B3 stores in its link table
    expect(reddit.every((e) => Number.isInteger(e.blocklistId))).toBe(true);

    for (const network of ["reddit", "quora"]) {
      expect(blocklist.guard(blockedAd, network)).toMatchObject({ code: 422 });
      expect(blocklist.guard({ ad_id: "x", post_owner: "BAD co" }, network)).toMatchObject({ code: 422 });
      expect(blocklist.guard({ ad_id: "x", destination_url: "https://shop.bad.com/p" }, network)).toMatchObject({ code: 422 });
      expect(blocklist.guard(cleanAd, network)).toBeNull();
    }
  });

  it("the ids from add() are exactly what revoke() takes, and the ad is allowed again", async () => {
    await start();
    const added = await blocklist.add([{ entryType: "ad_id", value: "bad-1", addedBy: "takedown:anij" }]);
    const refs = added.results.map((r) => ({ network: r.network, blocklistId: r.entries[0].blocklistId }));
    expect(blocklist.guard(blockedAd, "reddit")).not.toBeNull();

    const out = await blocklist.revoke(refs, { removedBy: "owner", approvedBy: "ceo" });
    expect(out.results.every((r) => r.ok && r.revoked === 1)).toBe(true);
    expect(blocklist.guard(blockedAd, "reddit")).toBeNull();
    expect(blocklist.guard(blockedAd, "quora")).toBeNull();
  });

  it("revoking the LAST entry takes effect immediately (the empty-refresh guard does not hold it back)", async () => {
    await start({ networks: ["reddit"] });
    const added = await blocklist.add([{ entryType: "ad_id", value: "bad-1", addedBy: "t", network: "reddit" }]);
    await blocklist.revoke([{ network: "reddit", blocklistId: added.results[0].entries[0].blocklistId }], { removedBy: "t" });
    expect(blocklist.guard(blockedAd, "reddit")).toBeNull();
  });

  it("revoked rows are kept (soft removal) with who removed them, and re-adding re-activates the same row", async () => {
    await start({ networks: ["reddit"] });
    const first = await blocklist.add([{ entryType: "ad_id", value: "bad-1", addedBy: "a", network: "reddit" }]);
    const id = first.results[0].entries[0].blocklistId;
    await blocklist.revoke([{ network: "reddit", blocklistId: id }], { removedBy: "owner", approvedBy: "ceo" });

    const row = repository.dbs.get("reddit").rows[0];
    expect(row).toMatchObject({ status: "revoked", removed_by: "owner (approved by ceo)" });
    expect(repository.dbs.get("reddit").rows).toHaveLength(1); // never deleted

    const again = await blocklist.add([{ entryType: "ad_id", value: "bad-1", addedBy: "b", network: "reddit" }]);
    expect(again.results[0].entries[0].blocklistId).toBe(id);   // same row, not a duplicate
    expect(repository.dbs.get("reddit").rows).toHaveLength(1);
    expect(row).toMatchObject({ status: "active", removed_by: null, added_by: "b" });
    expect(blocklist.guard(blockedAd, "reddit")).not.toBeNull();
  });

  it("adding the same entry twice keeps one row and the same id", async () => {
    await start({ networks: ["reddit"] });
    const one = await blocklist.add([{ entryType: "url", value: "https://CDN.x.com/a.jpg?s=1", addedBy: "a", network: "reddit" }]);
    const two = await blocklist.add([{ entryType: "image_url", value: "http://www.cdn.x.com/a.jpg", addedBy: "a", network: "reddit" }]);
    expect(repository.dbs.get("reddit").rows.filter((r) => r.entry_type === "url")).toHaveLength(1);
    expect(one.results[0].entries[0].blocklistId).toBeGreaterThan(0);
    expect(two.results[0].entries[0].blocklistId).toBeGreaterThan(0);
  });
});

describe("workflow > B2 image matching: banned images, attempts", () => {
  const SHA = "c".repeat(64);
  // The 256-bit perceptual hash of the image-hashing service: 64 hex characters.
  const PHASH = "460e931b54bbbb9667c97c9459eed7c8f2439b62c259c021fefb559058f57304";
  const ALGO = "sscd-simhash-v1";

  it("a banned image is available in memory right after add(), with its exact 256-bit hash", async () => {
    await start({ networks: ["reddit"] });
    expect(blocklist.getImageHashes("reddit")).toMatchObject({ available: true, hashes: [] });

    const out = await blocklist.add([{
      entryType: "image_hash", imageSha256: SHA, imagePhash: PHASH, imagePhashAlgo: ALGO, addedBy: "b2:test", network: "reddit",
    }]);
    const id = out.results[0].entries[0].blocklistId;

    const got = blocklist.getImageHashes("reddit");
    expect(got.available).toBe(true);
    expect(got.hashes).toEqual([{ id, sha256: SHA, phash: parseHash(PHASH), algo: ALGO }]);
  });

  it("B1's ad matching ignores the banned images (they are B2's)", async () => {
    await start({ networks: ["reddit"] });
    await blocklist.add([{ entryType: "image_hash", imageSha256: SHA, addedBy: "b2", network: "reddit" }]);
    expect(blocklist.guard({ ad_id: SHA, image_url: SHA, post_owner: SHA }, "reddit")).toBeNull();
  });

  it("an 'all' banned image reaches every network, and revoke removes it again (test cleanup)", async () => {
    await start();
    const out = await blocklist.add([{ entryType: "image_hash", imageSha256: SHA, addedBy: "b2" }]);
    expect(blocklist.getImageHashes("reddit").hashes).toHaveLength(1);
    expect(blocklist.getImageHashes("quora").hashes).toHaveLength(1);

    await blocklist.revoke(out.results.map((r) => ({ network: r.network, blocklistId: r.entries[0].blocklistId })), { removedBy: "b2" });
    expect(blocklist.getImageHashes("reddit").hashes).toEqual([]);
    expect(blocklist.getImageHashes("quora").hashes).toEqual([]);
  });

  it("B2 logs its rejections through the same writer", async () => {
    await start({ networks: ["reddit"] });
    const added = await blocklist.add([{ entryType: "image_hash", imageSha256: SHA, imagePhash: PHASH, imagePhashAlgo: ALGO, addedBy: "b2", network: "reddit" }]);
    const blocklistId = added.results[0].entries[0].blocklistId;
    expect(blocklist.recordAttempt({ network: "reddit", platformAdId: "ad-9", imageUrl: "https://x.com/i.jpg", blocklistId, matchType: "phash", distance: 2, source: "b2:ingest" })).toBe(true);
    expect(attempts.record).toHaveBeenCalledWith(expect.objectContaining({ blocklist_id: blocklistId, match_type: "phash", distance: 2 }));
  });
});

describe("workflow > B6 audit: read everything that is active", () => {
  it("listActive() returns the entries and the banned images for a network, from the database", async () => {
    await start({ networks: ["reddit"] });
    await blocklist.add([
      { entryType: "ad_id", value: "bad-1", addedBy: "t", network: "reddit" },
      { entryType: "domain", value: "bad.com", addedBy: "t" },
      { entryType: "image_hash", imageSha256: "d".repeat(64), imagePhash: `${"0".repeat(63)}5`, imagePhashAlgo: "sscd-simhash-v1", addedBy: "t", network: "reddit" },
    ]);
    const out = await blocklist.listActive("reddit");
    expect(out.entries.map((e) => e.entry_type).sort()).toEqual(["ad_id", "domain"]);
    // the 256-bit hash comes back as its 64 hex characters, exactly as stored
    expect(out.imageHashes).toEqual([expect.objectContaining({
      image_sha256: "d".repeat(64), image_phash: `${"0".repeat(63)}5`, image_phash_algo: "sscd-simhash-v1",
    })]);
  });

  it("does not list revoked entries", async () => {
    await start({ networks: ["reddit"] });
    const added = await blocklist.add([{ entryType: "ad_id", value: "bad-1", addedBy: "t", network: "reddit" }]);
    await blocklist.revoke([{ network: "reddit", blocklistId: added.results[0].entries[0].blocklistId }], { removedBy: "t" });
    expect((await blocklist.listActive("reddit")).entries).toEqual([]);
  });
});

describe("workflow > the writes do not depend on enforcement being switched on", () => {
  it("add / revoke / listActive work with enforcement off, and ads are not blocked", async () => {
    await start({ enforcement: false });
    const added = await blocklist.add([{ entryType: "ad_id", value: "bad-1", addedBy: "takedown" }]);
    expect(added.results.map((r) => r.network)).toEqual(["reddit", "quora"]);
    expect(added.results.every((r) => r.ok && r.entries[0].blocklistId > 0)).toBe(true);
    expect(blocklist.guard(blockedAd, "reddit")).toBeNull(); // not enforcing

    expect((await blocklist.listActive("reddit")).entries).toHaveLength(1);
    const out = await blocklist.revoke(added.results.map((r) => ({ network: r.network, blocklistId: r.entries[0].blocklistId })), { removedBy: "x" });
    expect(out.results.every((r) => r.ok && r.revoked === 1)).toBe(true);
  });

  it("before init(), writes say so and reads degrade safely", async () => {
    blocklist._setServiceForTests(null);
    await expect(blocklist.add([])).rejects.toThrow(/not initialised/);
    await expect(blocklist.revoke([], { removedBy: "x" })).rejects.toThrow(/not initialised/);
    await expect(blocklist.listActive("reddit")).rejects.toThrow(/not initialised/);
    expect(blocklist.getImageHashes("reddit")).toEqual({ available: false, status: "uninitialised", hashes: [] });
    expect(blocklist.recordAttempt({ network: "reddit", blocklistId: 1, matchType: "x" })).toBe(false);
    expect(blocklist.guard(blockedAd, "reddit")).toBeNull();
  });
});

describe("workflow > the landing-page entry point on the real service", () => {
  const { createIntake } = require("../../../src/compliance/imagematch/worker");

  it("submitAdvertiser blocks the name on every network at once, with its spellings, and queues the hashing", async () => {
    await start();
    const jobs = [];
    const submit = createIntake({
      blocklist,
      databaseManager: { getSQL: (n) => ({ db: n }) },
      sourcesModule: {
        SOURCES: { reddit: {} },
        sourceFor: (n) => ({ n }),
        nameCandidates: (name) => [name.toLowerCase()],
        findOwners: async () => [{ id: 3, name: "Twinkling Tree", ads_count: 5000 }],
      },
      jobRepository: { createJobs: async (sql, network, list) => { jobs.push({ network, list }); return { created: 1 }; } },
    });
    expect(blocklist.guard({ ad_id: "n1", post_owner: "Twinkling Tree" }, "reddit")).toBeNull();

    const out = await submit({ name: "Twinkling Tree", addedBy: "landing-form" });
    expect(out).toMatchObject({ ok: true, totalAds: 5000, failed: [], blocked: [{ network: "reddit" }, { network: "quora" }] });
    expect(jobs).toEqual([{ network: "reddit", list: [{ id: out.blocked[0].blocklistId, value: "Twinkling Tree", complaint_id: out.complaintId, entry_type: "advertiser" }] }]);

    for (const network of ["reddit", "quora"]) {
      expect(blocklist.guard({ ad_id: "n2", post_owner: "TWINKLING TREE" }, network)).toMatchObject({ code: 422 });
      expect(blocklist.guard({ ad_id: "n3", post_owner: "TwinklingTree" }, network)).toMatchObject({ code: 422 }); // spelling variant
      expect(blocklist.guard({ ad_id: "n4", post_owner: "Fine Co" }, network)).toBeNull();
    }
    // the same name again changes nothing: the same entry ids come back
    const again = await submit({ name: "twinkling  tree", addedBy: "landing-form" });
    expect(again.blocked.map((b) => b.blocklistId)).toEqual(out.blocked.map((b) => b.blocklistId));
  });
});
