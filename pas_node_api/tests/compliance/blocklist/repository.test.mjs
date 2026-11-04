import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const repo = require("../../../src/compliance/blocklist/repository");

// These tests pin the SHAPE of the SQL (index-friendly, bounded, batched), so a
// later edit cannot quietly turn a cheap query into an expensive one.

function fakeSql(pagesByScope = {}, writeResult = { affectedRows: 1 }) {
  const calls = [];
  const cursors = {};
  const sql = {
    calls,
    query: vi.fn(async (text, params) => {
      calls.push({ text, params });
      if (/^\s*SELECT/i.test(text)) {
        const scope = params[0];
        const idx = (cursors[scope] = (cursors[scope] ?? -1) + 1);
        return (pagesByScope[scope] || [])[idx] || [];
      }
      return writeResult;
    }),
  };
  return sql;
}

const row = (id) => ({ id, entry_type: "ad_id", value: String(id) });

describe("compliance/blocklist > repository.loadActive", () => {
  it("runs one equality query per scope: the network, then 'all'", async () => {
    const sql = fakeSql();
    await repo.loadActive(sql, "reddit", { pageSize: 100 });
    expect(sql.calls.map((c) => c.params[0])).toEqual(["reddit", "all"]);
  });

  it("uses index-friendly SQL: equality on network and status, ORDER BY id, bounded LIMIT, no IN / OFFSET / SELECT *", async () => {
    const sql = fakeSql();
    await repo.loadActive(sql, "reddit", { pageSize: 250 });
    for (const { text } of sql.calls) {
      expect(text).toMatch(/WHERE\s+network\s*=\s*\?/);
      expect(text).toMatch(/status\s*=\s*'active'/);
      expect(text).toMatch(/id\s*>\s*\?/);
      expect(text).toMatch(/ORDER BY id/);
      expect(text).toMatch(/LIMIT 250\s*$/);
      expect(text).not.toMatch(/\bIN\s*\(/i);
      expect(text).not.toMatch(/OFFSET/i);
      expect(text).not.toMatch(/SELECT\s+\*/i);
      expect(text).toMatch(/SELECT\s+id,\s*entry_type,\s*value/);
    }
  });

  it("leaves the banned images (image_hash) to their own query", async () => {
    const sql = fakeSql();
    await repo.loadActive(sql, "reddit");
    for (const { text, params } of sql.calls) {
      expect(text).toMatch(/entry_type\s*<>\s*\?/);
      expect(params[1]).toBe("image_hash");
    }
  });

  it("pages by primary key: next page starts after the last id, and stops on a short page", async () => {
    const sql = fakeSql({ reddit: [[row(1), row(2)], [row(3)]], all: [[row(9)]] });
    const rows = await repo.loadActive(sql, "reddit", { pageSize: 2 });
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3, 9]);
    expect(sql.calls.map((c) => c.params)).toEqual([
      ["reddit", "image_hash", 0], ["reddit", "image_hash", 2], ["all", "image_hash", 0],
    ]);
  });

  it("an exactly-full last page costs one extra empty query, then stops", async () => {
    const sql = fakeSql({ reddit: [[row(1), row(2)]] });
    await repo.loadActive(sql, "reddit", { pageSize: 2 });
    expect(sql.calls.map((c) => c.params)).toEqual([
      ["reddit", "image_hash", 0], ["reddit", "image_hash", 2], ["all", "image_hash", 0],
    ]);
  });

  it("asks for 'all' only once when the network itself is 'all'", async () => {
    const sql = fakeSql();
    await repo.loadActive(sql, "all");
    expect(sql.calls.map((c) => c.params[0])).toEqual(["all"]);
  });

  it("only ever inlines an integer LIMIT, whatever pageSize it is given", async () => {
    for (const bad of ["abc", 0, -5, null, undefined, "5; DROP TABLE x"]) {
      const sql = fakeSql();
      await repo.loadActive(sql, "reddit", { pageSize: bad });
      for (const { text } of sql.calls) expect(text).toMatch(/LIMIT \d+\s*$/);
    }
  });

  it("a network name goes through a placeholder, never into the SQL text", async () => {
    const sql = fakeSql();
    await repo.loadActive(sql, "x'; DROP TABLE copyright_blocklist; --");
    for (const { text } of sql.calls) expect(text).not.toMatch(/DROP/i);
  });
});

describe("compliance/blocklist > repository.loadImageHashes", () => {
  it("reads only image_hash rows, with the 256-bit hash as the CHAR(64) text it is stored as", async () => {
    const sql = fakeSql();
    await repo.loadImageHashes(sql, "reddit", { pageSize: 100 });
    expect(sql.calls.map((c) => c.params[0])).toEqual(["reddit", "all"]);
    for (const { text, params } of sql.calls) {
      expect(text).toMatch(/SELECT id, image_sha256, image_phash, image_phash_algo/);
      expect(text).not.toMatch(/CAST/);
      expect(text).toMatch(/entry_type\s*=\s*\?/);
      expect(params[1]).toBe("image_hash");
      expect(text).toMatch(/WHERE\s+network\s*=\s*\?/);
      expect(text).toMatch(/ORDER BY id/);
      expect(text).not.toMatch(/\bIN\s*\(/i);
      expect(text).not.toMatch(/OFFSET/i);
    }
  });

  it("afterId reads only the rows added after that id, in both scopes, and ignores a bad value", async () => {
    const sql = fakeSql();
    await repo.loadImageHashes(sql, "reddit", { pageSize: 100, afterId: 500 });
    expect(sql.calls.map((c) => c.params)).toEqual([["reddit", "image_hash", 500], ["all", "image_hash", 500]]);
    for (const { text } of sql.calls) expect(text).toMatch(/id > \?/);
    const bad = fakeSql();
    await repo.loadImageHashes(bad, "reddit", { afterId: -3 });
    await repo.loadImageHashes(bad, "reddit", { afterId: "7" });
    expect(bad.calls.every((c) => c.params[2] === 0)).toBe(true);
  });

  it("pages by primary key like loadActive", async () => {
    const PHASH = "460e931b54bbbb9667c97c9459eed7c8f2439b62c259c021fefb559058f57304";
    const hash = (id) => ({ id, image_sha256: "a".repeat(64), image_phash: PHASH, image_phash_algo: "sscd-simhash-v1" });
    const sql = fakeSql({ reddit: [[hash(1), hash(2)], [hash(3)]] });
    const rows = await repo.loadImageHashes(sql, "reddit", { pageSize: 2 });
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3]);
    expect(rows[0].image_phash).toBe(PHASH); // passed through untouched, as text
  });
});

describe("compliance/blocklist > repository writes", () => {
  it("insertAttempts writes a whole batch in ONE multi-row statement", async () => {
    const sql = fakeSql();
    const rows = Array.from({ length: 100 }, (_, i) => ({
      network: "reddit", platform_ad_id: String(i), advertiser: null, image_url: null,
      blocklist_id: 1, match_type: "ad_id", distance: null, source: "t",
    }));
    await repo.insertAttempts(sql, rows);
    expect(sql.calls).toHaveLength(1);
    expect(sql.calls[0].text).toMatch(/^\s*INSERT INTO copyright_blocked_attempts/);
    expect((sql.calls[0].text.match(/\(\?, \?, \?, \?, \?, \?, \?, \?, \?\)/g) || []).length).toBe(100);
    expect(sql.calls[0].params).toHaveLength(900);
  });

  it("insertAttempts, upsertEntries and revokeEntries do nothing for an empty batch", async () => {
    const sql = fakeSql();
    await repo.insertAttempts(sql, []);
    await repo.upsertEntries(sql, []);
    await repo.revokeEntries(sql, [], { removedBy: "x" });
    expect(sql.query).not.toHaveBeenCalled();
  });

  it("insertAttempts truncates over-long values instead of failing the whole batch", async () => {
    const sql = fakeSql();
    await repo.insertAttempts(sql, [{
      network: "reddit", platform_ad_id: "a".repeat(999), advertiser: "b".repeat(999), image_url: "c".repeat(5000),
      blocklist_id: 1, match_type: "x".repeat(99), distance: null, source: "s".repeat(999),
    }]);
    const p = sql.calls[0].params;
    expect([p[1].length, p[2].length, p[3].length, p[5].length, p[7].length]).toEqual([255, 255, 2048, 32, 64]);
  });

  it("upsertEntries stores a value up to the full 2048-character column without cutting it", async () => {
    const sql = fakeSql();
    const url = `https://cdn.example.com/${"a".repeat(2048 - "https://cdn.example.com/".length)}`;
    expect(url).toHaveLength(2048);
    await repo.upsertEntries(sql, [{ network: "all", entry_type: "url", value: url, value_sha256: "a".repeat(64), added_by: "t" }]);
    expect(sql.calls[0].params[2]).toBe(url);
    expect(repo.VALUE_MAX).toBe(2048);
  });

  it("insertAttempts keeps a row whose ASCII-only columns hold other characters (a bad row cannot sink the batch)", async () => {
    const sql = fakeSql();
    await repo.insertAttempts(sql, [{
      network: "reddit", platform_ad_id: "ad-é中-1", advertiser: "Café ☕", image_url: "https://x.com/é.jpg",
      blocklist_id: 1, match_type: "ad_id", distance: null, source: "insertion:réddit",
    }]);
    const p = sql.calls[0].params;
    expect(p[1]).toBe("ad-??-1");          // ASCII column: replaced
    expect(p[7]).toBe("insertion:r?ddit");  // ASCII column: replaced
    expect(p[2]).toBe("Café ☕");            // utf8mb4 column: kept as is
    expect(p[3]).toBe("https://x.com/é.jpg");
  });

  it("upsertEntries is one idempotent multi-row statement that re-activates, never duplicates", async () => {
    const sql = fakeSql();
    const entries = [
      { network: "all", entry_type: "ad_id", value: "1", value_sha256: "a".repeat(64), added_by: "tester" },
      { network: "all", entry_type: "domain", value: "bad.com", value_sha256: "b".repeat(64), added_by: "x".repeat(300) },
    ];
    await repo.upsertEntries(sql, entries);
    expect(sql.calls).toHaveLength(1);
    const { text, params } = sql.calls[0];
    expect(text).toMatch(/ON DUPLICATE KEY UPDATE/);
    expect(text).toMatch(/status = 'active'/);
    expect(params).toHaveLength(34);
    expect(params.filter((v) => v === "active")).toHaveLength(2);
    expect(text).toMatch(/added_by/);
    expect(text).toMatch(/removed_at = NULL, removed_by = NULL/);
    const oneRow = `(${Array(17).fill("?").join(", ")})`;
    expect(text.split(oneRow).length - 1).toBe(2); // 17 placeholders per entry, 2 entries
    expect(params[12]).toBe("tester");
    expect(params[29]).toHaveLength(128); // added_by is cut to the column size
    expect([params[16], params[33]]).toEqual(["platform", "none"]);
    expect(params.includes(undefined)).toBe(false); // the driver rejects undefined binds
  });

  it("upsertEntries writes an image_hash entry's hashes, the 256-bit one as its 64 hex characters", async () => {
    const sql = fakeSql();
    const phash = "460e931b54bbbb9667c97c9459eed7c8f2439b62c259c021fefb559058f57304";
    await repo.upsertEntries(sql, [{
      network: "reddit", entry_type: "image_hash", value: "c".repeat(64), value_sha256: "d".repeat(64), added_by: "b2",
      image_sha256: "c".repeat(64), image_phash_algo: "sscd-simhash-v1", image_phash: phash,
    }]);
    const { text, params } = sql.calls[0];
    expect(params.slice(13, 16)).toEqual(["c".repeat(64), "sscd-simhash-v1", phash]);
    expect(text).toMatch(/image_sha256 = VALUES\(image_sha256\)/);
    expect(text).toMatch(/image_phash = VALUES\(image_phash\)/);
  });

  it("upsertEntries keeps its ASCII-only columns safe", async () => {
    const sql = fakeSql();
    await repo.upsertEntries(sql, [{
      network: "reddit", entry_type: "ad_id", value: "1", value_sha256: "a".repeat(64), added_by: "tester", source: "seed-é",
    }]);
    expect(sql.calls[0].params[5]).toBe("seed-?");
  });
});

describe("compliance/blocklist > repository.findIds", () => {
  const rowOf = (network, entry_type, n) => ({ network, entry_type, value_sha256: String(n).padStart(64, "0") });

  it("looks ids up through the unique key (network, entry_type, value_sha256), one query per type", async () => {
    const sql = fakeSql();
    sql.query.mockImplementation(async (text, params) => {
      sql.calls.push({ text, params });
      return [{ id: 7, value_sha256: params[3] }];
    });
    const ids = await repo.findIds(sql, [rowOf("all", "ad_id", 1), rowOf("all", "domain", 2), rowOf("reddit", "ad_id", 3)]);
    expect(sql.calls).toHaveLength(3);
    for (const { text } of sql.calls) {
      expect(text).toMatch(/WHERE network = \? AND entry_type = \?/);
      expect(text).toMatch(/value_sha256 IN \(\?\)/);
      expect(text).not.toMatch(/SELECT\s+\*/i);
    }
    expect(ids.get(repo.idKey("all", "ad_id", rowOf("all", "ad_id", 1).value_sha256))).toBe(7);
    expect(ids.size).toBe(3);
  });

  it("splits a large set into chunks of 500", async () => {
    const sql = fakeSql();
    sql.query.mockImplementation(async (text, params) => { sql.calls.push({ text, params }); return []; });
    await repo.findIds(sql, Array.from({ length: 1200 }, (_, i) => rowOf("all", "ad_id", i)));
    expect(sql.calls.map((c) => c.params.length - 3)).toEqual([500, 500, 200]);
  });

  it("returns ids as numbers and ignores duplicate rows in the input", async () => {
    const sql = fakeSql();
    sql.query.mockImplementation(async () => [{ id: "42", value_sha256: rowOf("all", "ad_id", 1).value_sha256 }]);
    const ids = await repo.findIds(sql, [rowOf("all", "ad_id", 1), rowOf("all", "ad_id", 1)]);
    expect(ids.get(repo.idKey("all", "ad_id", rowOf("all", "ad_id", 1).value_sha256))).toBe(42);
  });

  it("keeps equal-looking internal and platform ids separate when finding row IDs", async () => {
    const hash = "a".repeat(64);
    const sql = { query: vi.fn(async (_text, params) => [{ id: params[2] === "internal" ? 11 : 22, value_sha256: hash }]) };
    const ids = await repo.findIds(sql, [
      { network: "facebook", entry_type: "ad_id", identifier_namespace: "internal", value_sha256: hash },
      { network: "facebook", entry_type: "ad_id", identifier_namespace: "platform", value_sha256: hash },
    ]);
    expect(ids.get(repo.idKey("facebook", "ad_id", hash, "internal"))).toBe(11);
    expect(ids.get(repo.idKey("facebook", "ad_id", hash, "platform"))).toBe(22);
    expect(sql.query).toHaveBeenCalledTimes(2);
  });
});

describe("compliance/blocklist > repository.revokeEntries", () => {
  it("soft-removes only ids that are still active, with who and when, never deleting", async () => {
    const sql = fakeSql({}, { affectedRows: 3 });
    const out = await repo.revokeEntries(sql, [1, 2, 3], { removedBy: "anij" });
    expect(out).toEqual({ affected: 3 });
    const { text, params } = sql.calls[0];
    expect(text).toMatch(/^\s*UPDATE copyright_blocklist/);
    expect(text).toMatch(/status = 'revoked'/);
    expect(text).toMatch(/AND status = 'active'/);
    expect(text).not.toMatch(/DELETE/i);
    expect(params.slice(1, 2)).toEqual(["anij"]);
    expect(params.slice(3)).toEqual([1, 2, 3]);
  });

  it("drops invalid and repeated ids, and chunks large sets", async () => {
    const sql = fakeSql({}, { affectedRows: 1 });
    await repo.revokeEntries(sql, [5, 5, "6", 0, -1, 1.5, NaN, "x", null], { removedBy: "x" });
    expect(sql.calls[0].params.slice(3)).toEqual([5, 6]);

    const big = fakeSql({}, { affectedRows: 1 });
    await repo.revokeEntries(big, Array.from({ length: 1100 }, (_, i) => i + 1), { removedBy: "x" });
    expect(big.calls.map((c) => c.params.length - 3)).toEqual([500, 500, 100]);
  });
});
