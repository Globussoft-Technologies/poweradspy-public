import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
import crypto from "node:crypto";
const require = createRequire(import.meta.url);

import { makeConfig } from "./helpers.mjs";

const { BlocklistService } = require("../../../src/compliance/blocklist/service");
const { buildSnapshot, buildImageHashes } = require("../../../src/compliance/blocklist/match");
const { idKey } = require("../../../src/compliance/blocklist/repository");
const { STATUS } = require("../../../src/compliance/blocklist/constants");
const { parseHash } = require("../../../src/compliance/imagematch/matcher");

// 256-bit perceptual hashes, as the image-hashing service returns them: 64 hex characters.
const HASH_F = "f".repeat(64);
const HASH_5 = `${"0".repeat(63)}5`;

// What B2, B3 and B6 build on: add() with ids, image_hash entries, revoke(),
// listActive(), getImageHashes() and recordAttempt().

const silent = { info() {}, warn: vi.fn(), error: vi.fn() };
const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
const SHA_A = "a".repeat(64);

function setup({ enforcement = true, networks = ["reddit", "quora"], noSql = [], hashes = [], hashesLoaded = true, status = STATUS.READY, configNetworks } = {}) {
  const config = makeConfig({ enabled: enforcement, networks: configNetworks ?? [] });
  const states = new Map(networks.map((n) => {
    const snapshot = buildSnapshot([]);
    snapshot.imageHashes = hashes;
    return [n, { status, snapshot, imageHashesLoaded: hashesLoaded }];
  }));
  const refreshNetwork = vi.fn(async () => {});
  const cache = enforcement
    ? { networks: [...networks], manages: (n) => states.has(n), get: (n) => states.get(n) || null, summary: () => ({}), refreshNetwork }
    : null;
  const repository = {
    upsertEntries: vi.fn(async () => ({ affected: 1 })),
    findIds: vi.fn(async (sql, rows) => {
      const ids = new Map();
      rows.forEach((r, i) => ids.set(idKey(r.network, r.entry_type, r.value_sha256, r.identifier_namespace), 100 + i));
      return ids;
    }),
    revokeEntries: vi.fn(async (sql, ids) => ({ affected: ids.length })),
    loadActive: vi.fn(async () => [{ id: 1, entry_type: "ad_id", value: "1" }]),
    loadImageHashes: vi.fn(async () => [{ id: 9, image_sha256: SHA_A, image_phash: HASH_5, image_phash_algo: "sscd-simhash-v1" }]),
  };
  const attempts = { record: vi.fn(), queue: [], dropped: 0, rejected: 0 };
  const service = new BlocklistService({
    config, cache, attempts, repository, getSql: (n) => (noSql.includes(n) ? null : { network: n }), log: silent,
  });
  return { service, repository, cache, attempts, refreshNetwork, states };
}

const entry = (over = {}) => ({ entryType: "ad_id", value: "42", addedBy: "tester", ...over });

describe("dependencies > add() writes and returns ids", () => {
  it("validates namespaces and defaults source ad IDs to platform", async () => {
    const { service, repository } = setup({ networks: ["reddit"] });
    const result = await service.add([
      entry({ value: "1", network: "reddit" }),
      entry({ value: "2", identifierNamespace: "internal", network: "reddit" }),
      entry({ value: "3", identifierNamespace: "none", network: "reddit" }),
      entry({ entryType: "domain", value: "example.com", identifierNamespace: "internal", network: "reddit" }),
    ]);
    expect(result.rejected).toHaveLength(2);
    expect(repository.upsertEntries.mock.calls[0][1].map((r) => r.identifier_namespace)).toEqual(["platform", "internal"]);
  });
  it("writes an 'all' entry to every managed network and reports each result with the entry ids", async () => {
    const { service, repository, refreshNetwork } = setup({ noSql: ["quora"] });
    const out = await service.add([entry({ reason: "t" })]);
    expect(out.rejected).toEqual([]);
    expect(out.results[0]).toMatchObject({ network: "reddit", ok: true, count: 1 });
    expect(out.results[0].entries).toEqual([
      { entryType: "ad_id", identifierNamespace: "platform", value: "42", valueSha256: sha("ad_id:42"), blocklistId: 100 },
    ]);
    expect(out.results[1]).toEqual({ network: "quora", ok: false, count: 1, error: "no SQL connection", entries: [] });
    expect(repository.upsertEntries).toHaveBeenCalledTimes(1);
    expect(refreshNetwork).toHaveBeenCalledWith("reddit", { force: true, images: "incremental" });
    expect(repository.upsertEntries.mock.calls[0][1][0]).toMatchObject({ network: "all", entry_type: "ad_id", added_by: "tester" });
  });

  it("returns one id per entry, in order, for B3 / B6 link tables", async () => {
    const { service } = setup({ networks: ["reddit"] });
    const out = await service.add([entry({ value: "1" }), entry({ entryType: "domain", value: "bad.com" }), entry({ value: "3" })]);
    expect(out.results[0].entries.map((e) => e.blocklistId)).toEqual([100, 101, 102]);
    expect(out.results[0].entries.map((e) => e.entryType)).toEqual(["ad_id", "domain", "ad_id"]);
  });

  it("a network-specific entry goes only to that network", async () => {
    const { service, repository } = setup();
    await service.add([entry({ entryType: "domain", value: "https://www.bad.com/x", network: "Reddit" })]);
    expect(repository.upsertEntries).toHaveBeenCalledTimes(1);
    expect(repository.upsertEntries.mock.calls[0][1][0]).toMatchObject({ network: "reddit", value: "https://www.bad.com/x" });
  });

  it("gives the same hash to values that normalize the same", async () => {
    const { service, repository } = setup();
    await service.add([
      entry({ entryType: "image_url", value: "https://CDN.x.com/a.jpg?x=1", network: "reddit" }),
      entry({ entryType: "url", value: "http://www.cdn.x.com/a.jpg", network: "reddit" }),
    ]);
    const written = repository.upsertEntries.mock.calls[0][1];
    expect(written[0].value_sha256).toBe(written[1].value_sha256);
  });

  it("rejects unusable entries without writing them, saying why", async () => {
    const { service, repository } = setup();
    const out = await service.add([
      { entryType: "image_hash", addedBy: "t" },
      entry({ value: "  " }),
      entry({ entryType: "nope" }),
      null,
    ]);
    expect(out.rejected).toHaveLength(4);
    expect(out.rejected[0].reason).toMatch(/imageSha256/);
    expect(repository.upsertEntries).not.toHaveBeenCalled();
  });

  it("requires addedBy (the table column is NOT NULL) and trims it", async () => {
    const { service, repository } = setup();
    const out = await service.add([
      { entryType: "ad_id", value: "1" },
      entry({ value: "2", addedBy: "   " }),
      entry({ value: "3", addedBy: 42 }),
      entry({ value: "4", addedBy: "  anij  ", network: "reddit" }),
    ]);
    expect(out.rejected.map((r) => r.reason)).toEqual(Array(3).fill("addedBy is required (who is adding this block)"));
    expect(repository.upsertEntries.mock.calls[0][1]).toHaveLength(1);
    expect(repository.upsertEntries.mock.calls[0][1][0]).toMatchObject({ value: "4", added_by: "anij" });
  });

  it("accepts a value of exactly the 2048-character column size and rejects a longer one instead of cutting it", async () => {
    const { service, repository } = setup({ networks: ["reddit"] });
    const base = "https://cdn.example.com/";
    const exact = `${base}${"a".repeat(2048 - base.length)}`;
    const tooLong = `${exact}b`;
    const out = await service.add([entry({ entryType: "url", value: exact }), entry({ entryType: "url", value: tooLong })]);
    expect(repository.upsertEntries.mock.calls[0][1]).toHaveLength(1);
    expect(repository.upsertEntries.mock.calls[0][1][0].value).toBe(exact);
    expect(out.rejected).toHaveLength(1);
    expect(out.rejected[0].reason).toBe("value is longer than 2048 characters (the column limit)");
  });

  it("reports a write whose ids could not be read as safe to re-run", async () => {
    const { service, repository } = setup({ networks: ["reddit"] });
    repository.findIds.mockRejectedValueOnce(new Error("db blip"));
    const out = await service.add([entry()]);
    expect(out.results[0].ok).toBe(false);
    expect(out.results[0].error).toMatch(/written, but the entry ids could not be read \(safe to re-run\): db blip/);
  });

  it("one failing network does not stop the others", async () => {
    const { service, repository } = setup();
    repository.upsertEntries.mockRejectedValueOnce(new Error("reddit down"));
    const out = await service.add([entry()]);
    expect(out.results.map((r) => [r.network, r.ok])).toEqual([["reddit", false], ["quora", true]]);
  });

  it("works while enforcement is off: uses the configured networks and refreshes nothing", async () => {
    const { service, repository } = setup({ enforcement: false, configNetworks: ["reddit", "quora"] });
    const out = await service.add([entry()]);
    expect(out.results.map((r) => r.network)).toEqual(["reddit", "quora"]);
    expect(out.results.every((r) => r.ok)).toBe(true);
    expect(repository.upsertEntries).toHaveBeenCalledTimes(2);
  });

  it("throws when it has no repository (not initialised)", async () => {
    const service = new BlocklistService({ config: makeConfig({}), log: silent });
    await expect(service.add([entry()])).rejects.toThrow(/not initialised/);
    await expect(service.revoke([], { removedBy: "x" })).rejects.toThrow(/not initialised/);
    await expect(service.listActive("reddit")).rejects.toThrow(/not initialised/);
  });
});

describe("dependencies > add() image_hash entries (B2)", () => {
  const hashEntry = (over = {}) => ({ entryType: "image_hash", imageSha256: SHA_A, addedBy: "b2", network: "reddit", ...over });
  const written = async (over) => {
    const { service, repository } = setup();
    const out = await service.add([hashEntry(over)]);
    return { out, row: repository.upsertEntries.mock.calls[0]?.[1]?.[0] };
  };

  it("stores value = the lowercase sha256 and value_sha256 = sha256(value), as the schema script documents", async () => {
    const { row } = await written({ imageSha256: SHA_A.toUpperCase() });
    expect(row).toMatchObject({ entry_type: "image_hash", value: SHA_A, image_sha256: SHA_A, value_sha256: sha(SHA_A) });
  });

  it("accepts the 256-bit perceptual hash as 64 hex characters, in any case, and stores it lowercase", async () => {
    for (const phash of [HASH_F, HASH_F.toUpperCase(), `  ${HASH_5}  `, "0".repeat(64)]) {
      const { row } = await written({ imagePhash: phash, imagePhashAlgo: "SSCD-SimHash-v1" });
      expect(row.image_phash).toBe(phash.trim().toLowerCase());
      expect(row.image_phash_algo).toBe("sscd-simhash-v1");
    }
  });

  it("stores an image with no perceptual hash (exact match only) and no algorithm", async () => {
    const { row } = await written({ imagePhashAlgo: "sscd-simhash-v1" });
    expect(row.image_phash).toBeNull();
    expect(row.image_phash_algo).toBeNull();
  });

  it("rejects bad hashes with a reason", async () => {
    for (const [over, reason] of [
      [{ imageSha256: "abc" }, /imageSha256/],
      [{ imageSha256: "g".repeat(64) }, /imageSha256/],
      [{ imageSha256: undefined }, /imageSha256/],
      [{ imagePhash: HASH_5 }, /imagePhashAlgo is required/],
      [{ imagePhash: HASH_5, imagePhashAlgo: "a b" }, /imagePhashAlgo is required/],
      [{ imagePhash: HASH_5, imagePhashAlgo: "x".repeat(17) }, /imagePhashAlgo is required/],
      [{ imagePhash: "5", imagePhashAlgo: "sscd-simhash-v1" }, /64 hex characters/],
      [{ imagePhash: 5n, imagePhashAlgo: "sscd-simhash-v1" }, /64 hex characters/],
      [{ imagePhash: 18446744073709551615n, imagePhashAlgo: "dhash" }, /64 hex characters/],
      [{ imagePhash: "18446744073709551615", imagePhashAlgo: "dhash" }, /64 hex characters/],
      [{ imagePhash: HASH_5.slice(1), imagePhashAlgo: "sscd-simhash-v1" }, /64 hex characters/],
      [{ imagePhash: `${HASH_5}0`, imagePhashAlgo: "sscd-simhash-v1" }, /64 hex characters/],
      [{ imagePhash: `${"g"}${HASH_5.slice(1)}`, imagePhashAlgo: "sscd-simhash-v1" }, /64 hex characters/],
      [{ imagePhash: {}, imagePhashAlgo: "sscd-simhash-v1" }, /64 hex characters/],
    ]) {
      const { out, row } = await written(over);
      expect(row).toBeUndefined();
      expect(out.rejected[0].reason).toMatch(reason);
    }
  });

  it("returns the id of an image_hash entry like any other", async () => {
    const { service } = setup({ networks: ["reddit"] });
    const out = await service.add([hashEntry({ network: "all" })]);
    expect(out.results[0].entries[0]).toMatchObject({ entryType: "image_hash", value: SHA_A, blocklistId: 100 });
  });
});

describe("dependencies > revoke()", () => {
  it("soft-removes by { network, blocklistId }, grouped per database, and refreshes", async () => {
    const { service, repository, refreshNetwork } = setup();
    const out = await service.revoke(
      [{ network: "reddit", blocklistId: 1 }, { network: "Reddit", blocklistId: "2" }, { network: "quora", blocklistId: 7 }],
      { removedBy: "anij" }
    );
    expect(out.invalid).toEqual([]);
    expect(out.results).toEqual([
      { network: "reddit", ok: true, requested: 2, revoked: 2 },
      { network: "quora", ok: true, requested: 1, revoked: 1 },
    ]);
    expect(repository.revokeEntries.mock.calls[0].slice(1)).toEqual([[1, 2], { removedBy: "anij" }]);
    expect(refreshNetwork).toHaveBeenCalledWith("reddit", { force: true, images: "full" });
  });

  it("records who approved a reversal next to who removed it (B5)", async () => {
    const { service, repository } = setup();
    await service.revoke([{ network: "reddit", blocklistId: 1 }], { removedBy: "owner", approvedBy: "ceo" });
    expect(repository.revokeEntries.mock.calls[0][2]).toEqual({ removedBy: "owner (approved by ceo)" });
  });

  it("requires removedBy, and reports bad refs instead of guessing", async () => {
    const { service, repository } = setup();
    await expect(service.revoke([{ network: "reddit", blocklistId: 1 }], {})).rejects.toThrow(/removedBy is required/);
    await expect(service.revoke([{ network: "reddit", blocklistId: 1 }], { removedBy: "  " })).rejects.toThrow(/removedBy is required/);
    const out = await service.revoke(
      [{ blocklistId: 1 }, { network: "reddit" }, { network: "reddit", blocklistId: 0 }, { network: "reddit", blocklistId: 1.5 }, null],
      { removedBy: "x" }
    );
    expect(out.invalid).toHaveLength(5);
    expect(repository.revokeEntries).not.toHaveBeenCalled();
  });

  it("reports a network with no connection and still handles the rest", async () => {
    const { service } = setup({ noSql: ["quora"] });
    const out = await service.revoke([{ network: "quora", blocklistId: 1 }, { network: "reddit", blocklistId: 2 }], { removedBy: "x" });
    expect(out.results).toEqual([
      { network: "quora", ok: false, requested: 1, error: "no SQL connection" },
      { network: "reddit", ok: true, requested: 1, revoked: 1 },
    ]);
  });
});

describe("dependencies > listActive() (B6)", () => {
  it("reads the active entries and the banned images from the database, not the cache", async () => {
    const { service, repository } = setup();
    const out = await service.listActive("reddit");
    expect(out.entries).toEqual([{ id: 1, entry_type: "ad_id", value: "1" }]);
    expect(out.imageHashes[0]).toMatchObject({ id: 9, image_sha256: SHA_A, image_phash: HASH_5 });
    expect(repository.loadActive).toHaveBeenCalledWith({ network: "reddit" }, "reddit", { pageSize: 5000 });
  });

  it("throws when the network has no connection", async () => {
    const { service } = setup({ noSql: ["reddit"] });
    await expect(service.listActive("reddit")).rejects.toThrow(/no SQL connection/);
  });
});

describe("dependencies > getImageHashes() (B2)", () => {
  const banned = buildImageHashes([{ id: 1, image_sha256: SHA_A, image_phash: HASH_F, image_phash_algo: "SSCD-SimHash-v1" }]);

  it("hands B2 the banned images in memory, the 256-bit hash as 8 words", () => {
    const { service } = setup({ hashes: banned });
    const out = service.getImageHashes("reddit");
    expect(out).toMatchObject({ available: true, status: STATUS.READY });
    expect(out.hashes).toEqual([{ id: 1, sha256: SHA_A, phash: parseHash(HASH_F), algo: "sscd-simhash-v1" }]);
    expect(out.hashes[0].phash).toBeInstanceOf(Uint32Array);
    expect(out.hashes[0].phash).toHaveLength(8);
  });

  it("says when the list cannot be trusted, so B2 can apply its own fail mode", () => {
    expect(setup({ hashes: banned, hashesLoaded: false }).service.getImageHashes("reddit").available).toBe(false);
    expect(setup({ hashes: banned, status: STATUS.UNAVAILABLE }).service.getImageHashes("reddit").available).toBe(false);
    expect(setup().service.getImageHashes("facebook")).toEqual({ available: false, status: "unmanaged", hashes: [] });
    expect(setup({ enforcement: false }).service.getImageHashes("reddit")).toEqual({ available: false, status: "unmanaged", hashes: [] });
  });

  it("a saved or stale list is still usable", () => {
    for (const status of [STATUS.STALE, STATUS.FROM_FILE]) {
      expect(setup({ hashes: banned, status }).service.getImageHashes("reddit").available).toBe(true);
    }
  });
});

describe("dependencies > recordAttempt() (B2)", () => {
  it("logs a rejection through the shared batched writer", () => {
    const { service, attempts } = setup();
    const ok = service.recordAttempt({
      network: "reddit", platformAdId: 1234, advertiser: "Bad Co", imageUrl: "https://x.com/a.jpg",
      blocklistId: 9, matchType: "phash", distance: 3, source: "b2:ingest",
    });
    expect(ok).toBe(true);
    expect(attempts.record).toHaveBeenCalledWith({
      network: "reddit", platform_ad_id: "1234", advertiser: "Bad Co", image_url: "https://x.com/a.jpg",
      blocklist_id: 9, match_type: "phash", distance: 3, source: "b2:ingest",
    });
  });

  it("refuses unusable input and never throws", () => {
    const { service, attempts } = setup();
    for (const bad of [
      undefined, {}, { network: "reddit", matchType: "phash" }, { network: "reddit", blocklistId: 0, matchType: "x" },
      { network: "reddit", blocklistId: 1.5, matchType: "x" }, { network: "reddit", blocklistId: "1", matchType: "x" },
      { network: "", blocklistId: 1, matchType: "x" }, { network: "reddit", blocklistId: 1 },
    ]) expect(service.recordAttempt(bad)).toBe(false);
    expect(attempts.record).not.toHaveBeenCalled();
  });

  it("keeps distance only when it is an integer from 0 to 256 (the bits of a hash)", () => {
    const { service, attempts } = setup();
    for (const [distance, expected] of [[0, 0], [255, 255], [256, 256], [257, null], [-1, null], [1.5, null], ["3", null], [undefined, null]]) {
      service.recordAttempt({ network: "reddit", blocklistId: 1, matchType: "phash", distance });
      expect(attempts.record.mock.calls.at(-1)[0].distance).toBe(expected);
    }
  });

  it("is a no-op when attempt logging is off", () => {
    const service = new BlocklistService({ config: makeConfig({}), log: silent });
    expect(service.recordAttempt({ network: "reddit", blocklistId: 1, matchType: "phash" })).toBe(false);
  });
});
