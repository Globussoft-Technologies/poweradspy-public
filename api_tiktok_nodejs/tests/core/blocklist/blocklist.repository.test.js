import { describe, it, expect, vi, beforeEach } from "vitest";

// Pins the SHAPE of the SQL (index-friendly, bounded, batched), so a later edit
// cannot quietly turn a cheap query into an expensive one.

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock("../../../Sequelize_cli/models/index.js", () => ({
  default: {
    sequelize: { query: queryMock },
    Sequelize: { QueryTypes: { SELECT: "SELECT", INSERT: "INSERT" } },
  },
}));

import { loadActive, insertAttempts } from "../../../core/blocklist/blocklist.repository.js";

const row = (id) => ({ id, entry_type: "ad_id", value: String(id) });

function script(pagesByScope) {
  const cursors = {};
  queryMock.mockImplementation(async (text, { replacements }) => {
    if (/^\s*SELECT/i.test(text)) {
      const scope = replacements[0];
      const idx = (cursors[scope] = (cursors[scope] ?? -1) + 1);
      return (pagesByScope[scope] || [])[idx] || [];
    }
    return [0, 1];
  });
}

// braces: a returned mock would be run by vitest as a cleanup function, with no arguments
beforeEach(() => { queryMock.mockReset(); });

describe("blocklist.repository > loadActive", () => {
  it("runs one equality query per scope: tiktok, then 'all'", async () => {
    script({});
    await loadActive({ pageSize: 100 });
    expect(queryMock.mock.calls.map(([, o]) => o.replacements[0])).toEqual(["tiktok", "all"]);
  });

  it("uses index-friendly SQL: equality on network and status, ORDER BY id, bounded LIMIT, no IN / OFFSET / SELECT *", async () => {
    script({});
    await loadActive({ pageSize: 250 });
    for (const [text, opts] of queryMock.mock.calls) {
      expect(text).toMatch(/WHERE\s+network\s*=\s*\?/);
      expect(text).toMatch(/status\s*=\s*'active'/);
      expect(text).toMatch(/id\s*>\s*\?/);
      expect(text).toMatch(/ORDER BY id/);
      expect(text).toMatch(/LIMIT 250\s*$/);
      expect(text).not.toMatch(/\bIN\s*\(/i);
      expect(text).not.toMatch(/OFFSET/i);
      expect(text).not.toMatch(/SELECT\s+\*/i);
      expect(opts.type).toBe("SELECT");
    }
  });

  it("pages by primary key and stops on a short page", async () => {
    script({ tiktok: [[row(1), row(2)], [row(3)]], all: [[row(9)]] });
    const rows = await loadActive({ pageSize: 2 });
    expect(rows.map((r) => r.id)).toEqual([1, 2, 3, 9]);
    expect(queryMock.mock.calls.map(([, o]) => o.replacements)).toEqual([["tiktok", 0], ["tiktok", 2], ["all", 0]]);
  });

  it("only ever inlines an integer LIMIT, whatever pageSize it is given", async () => {
    for (const bad of ["abc", 0, -5, null, undefined, "5; DROP TABLE x"]) {
      queryMock.mockReset();
      script({});
      await loadActive({ pageSize: bad });
      for (const [text] of queryMock.mock.calls) expect(text).toMatch(/LIMIT \d+\s*$/);
    }
  });
});

describe("blocklist.repository > insertAttempts", () => {
  it("writes a whole batch in ONE multi-row statement", async () => {
    script({});
    const rows = Array.from({ length: 100 }, (_, i) => ({
      network: "tiktok", platform_ad_id: String(i), blocklist_id: 1, match_type: "ad_id",
    }));
    await insertAttempts(rows);
    expect(queryMock).toHaveBeenCalledTimes(1);
    const [text, opts] = queryMock.mock.calls[0];
    expect(text).toMatch(/^\s*INSERT INTO copyright_blocked_attempts/);
    expect(opts.replacements).toHaveLength(900);
    expect(opts.type).toBe("INSERT");
  });

  it("does nothing for an empty batch and truncates over-long values", async () => {
    script({});
    await insertAttempts([]);
    expect(queryMock).not.toHaveBeenCalled();
    await insertAttempts([{ network: "tiktok", platform_ad_id: "a".repeat(999), image_url: "c".repeat(5000), blocklist_id: 1, match_type: "x".repeat(99), source: "s".repeat(999) }]);
    const p = queryMock.mock.calls[0][1].replacements;
    expect([p[1].length, p[3].length, p[5].length, p[7].length]).toEqual([255, 2048, 32, 64]);
  });
});
