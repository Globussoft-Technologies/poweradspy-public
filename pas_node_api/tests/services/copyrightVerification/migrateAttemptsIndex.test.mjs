import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { migrateOne, INDEX } = require("../../../src/services/copyrightVerification/migrateAttemptsIndex");

/** A fake SQL answering the two information_schema questions; every statement is kept. */
function fakeSql({ table = { est_rows: 120000, data_bytes: 10485760, index_bytes: 2097152 }, hasIndex = false } = {}) {
  const seen = [];
  return {
    seen,
    query: async (text) => {
      seen.push(text.replace(/\s+/g, " ").trim());
      if (/information_schema.tables/.test(text)) return table ? [table] : [];
      if (/information_schema.statistics/.test(text)) return hasIndex ? [{ 1: 1 }] : [];
      return [];
    },
  };
}
const quiet = () => {};

describe("migrateAttemptsIndex", () => {
  it("dry run: prints the table size and the statement, and changes nothing", async () => {
    const sql = fakeSql();
    const lines = [];
    expect(await migrateOne(sql, { print: (l) => lines.push(l) })).toBe("would_add");
    expect(lines.join("\n")).toMatch(/1,20,000 rows, data 10.0 MB/);
    expect(sql.seen.some((q) => q.startsWith("ALTER"))).toBe(false);
  });

  it("--apply: adds the index online, on (network, platform_ad_id)", async () => {
    const sql = fakeSql();
    expect(await migrateOne(sql, { apply: true, print: quiet })).toBe("added");
    expect(sql.seen.at(-1)).toBe(`ALTER TABLE \`copyright_blocked_attempts\` ADD INDEX ${INDEX} (network, platform_ad_id), ALGORITHM=INPLACE, LOCK=NONE`);
  });

  it("leaves an index already there alone, and skips a database without the table", async () => {
    const has = fakeSql({ hasIndex: true });
    expect(await migrateOne(has, { apply: true, print: quiet })).toBe("ok");
    expect(has.seen.some((q) => q.startsWith("ALTER"))).toBe(false);
    const none = fakeSql({ table: null });
    expect(await migrateOne(none, { apply: true, print: quiet })).toBe("missing_table");
    expect(none.seen.some((q) => q.startsWith("ALTER"))).toBe(false);
  });
});
