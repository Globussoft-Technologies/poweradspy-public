import { describe, it, expect, vi } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { persistAiMeta, NET_SQL } = require(
  "../../../../src/services/common/helpers/aiMetaSqlWriter"
);

const NORMALIZED = {
  ad_type: "promotional",
  intent: ["conversion"],
  hook: ["social_proof"],
  offering_type: "product",
  offering: "printer parts",
  caption: "A hand holding printer parts.",
  roa: { intent: "CTA present." },
  colors: ["#FFFFFF"],
  category: "Retail",
  sub_category: "eCommerce",
};

/**
 * Fake mysql2 connection recording every execute(sql, params). `handlers` maps a
 * substring of the SQL to the [rows|result] it should resolve to; the ad-id lookup
 * and category-name lookup are matched by substring.
 */
function mkConn({ adRow = [{ id: 42 }], catRows = [], insertId = 99, throwOn } = {}) {
  const calls = [];
  const conn = {
    calls,
    beginTransaction: vi.fn(async () => {}),
    commit: vi.fn(async () => {}),
    rollback: vi.fn(async () => {}),
    release: vi.fn(() => {}),
    execute: vi.fn(async (sql, params) => {
      calls.push({ sql, params });
      if (throwOn && sql.includes(throwOn)) throw new Error("sql-boom");
      if (/FROM `\w+_ad`|FROM `\w+_ads`|FROM `google_text_ad`/.test(sql) && /WHERE ad_id/.test(sql)) {
        return [adRow];
      }
      if (/FROM `\w+_category`/.test(sql)) return [catRows];
      if (/^INSERT INTO `\w+_category`/.test(sql)) return [{ insertId }];
      // meta upsert + UPDATE ad set category_id
      return [{ affectedRows: 1, insertId }];
    }),
  };
  return conn;
}

function mkSql(conn) {
  return { getConnection: vi.fn(async () => conn) };
}

describe("aiMetaSqlWriter > persistAiMeta", () => {
  it("skips when network unknown", async () => {
    const r = await persistAiMeta({ sql: mkSql(mkConn()), network: "myspace", adId: "1", normalized: NORMALIZED });
    expect(r.sql_status).toBe("skipped");
  });

  it("skips when no SQL connection", async () => {
    const r = await persistAiMeta({ sql: null, network: "facebook", adId: "1", normalized: NORMALIZED });
    expect(r.sql_status).toBe("skipped");
  });

  it("skips when normalized missing", async () => {
    const r = await persistAiMeta({ sql: mkSql(mkConn()), network: "facebook", adId: "1", normalized: null });
    expect(r.sql_status).toBe("skipped");
  });

  it("ad_not_found when public ad_id has no SQL row (rolls back)", async () => {
    const conn = mkConn({ adRow: [] });
    const r = await persistAiMeta({ sql: mkSql(conn), network: "facebook", adId: "nope", normalized: NORMALIZED });
    expect(r.sql_status).toBe("ad_not_found");
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });

  it("stored + category dual-write for a network WITH a category table (facebook, new name inserts)", async () => {
    const conn = mkConn({ adRow: [{ id: 42 }], catRows: [] /* not found → insert */, insertId: 555 });
    const r = await persistAiMeta({ sql: mkSql(conn), network: "facebook", adId: "pub-1", normalized: NORMALIZED, logger: { info: vi.fn(), warn: vi.fn() } });
    expect(r).toMatchObject({ sql_status: "stored", sql_ad_row_id: 42, category_synced: true });
    expect(conn.commit).toHaveBeenCalled();

    // meta upsert targets facebook_ad_ai_meta with the fk + all fields
    const upsert = conn.calls.find((c) => c.sql.includes("INSERT INTO `facebook_ad_ai_meta`"));
    expect(upsert).toBeTruthy();
    expect(upsert.sql).toContain("ON DUPLICATE KEY UPDATE");
    // fk id first, then scalars, then JSON strings
    expect(upsert.params[0]).toBe(42);
    expect(upsert.params).toContain("promotional");    // ad_type scalar
    expect(upsert.params).toContain(JSON.stringify(["conversion"])); // intent JSON

    // category resolve → insert → UPDATE facebook_ad.category_id = 555
    const catInsert = conn.calls.find((c) => c.sql.startsWith("INSERT INTO `facebook_category`"));
    expect(catInsert.params).toEqual(["Retail"]);
    const adUpdate = conn.calls.find((c) => c.sql.includes("UPDATE `facebook_ad` SET category_id"));
    expect(adUpdate.params).toEqual([555, 42]);
  });

  it("reuses existing category id when the name already exists (no insert)", async () => {
    const conn = mkConn({ adRow: [{ id: 7 }], catRows: [{ id: 300 }] });
    const r = await persistAiMeta({ sql: mkSql(conn), network: "native", adId: "pub-2", normalized: NORMALIZED });
    expect(r.category_synced).toBe(true);
    expect(conn.calls.some((c) => c.sql.startsWith("INSERT INTO `native_category`"))).toBe(false);
    const adUpdate = conn.calls.find((c) => c.sql.includes("UPDATE `native_ad` SET category_id"));
    expect(adUpdate.params).toEqual([300, 7]);
  });

  it("network WITHOUT a category table (google) → meta upsert only, no category write", async () => {
    const conn = mkConn({ adRow: [{ id: 11 }] });
    const r = await persistAiMeta({ sql: mkSql(conn), network: "google", adId: "pub-3", normalized: NORMALIZED });
    expect(r).toMatchObject({ sql_status: "stored", category_synced: false });
    expect(conn.calls.some((c) => c.sql.includes("google_text_ad_ai_meta"))).toBe(true);
    // no category-table resolve or ad.category_id update for google
    expect(conn.calls.some((c) => c.sql.includes("SET category_id"))).toBe(false);
    expect(conn.calls.some((c) => /FROM `\w+_category`/.test(c.sql))).toBe(false);
    expect(NET_SQL.google.categoryTable).toBeNull();
  });

  it("no category in payload → meta upsert only, category_synced false", async () => {
    const conn = mkConn({ adRow: [{ id: 8 }] });
    const { category, sub_category, ...noCat } = NORMALIZED;
    const r = await persistAiMeta({ sql: mkSql(conn), network: "facebook", adId: "pub-4", normalized: noCat });
    expect(r.category_synced).toBe(false);
    expect(conn.calls.some((c) => c.sql.includes("UPDATE `facebook_ad` SET category_id"))).toBe(false);
  });

  it("JSON columns bind NULL (not the string 'null') when a field is absent", async () => {
    const conn = mkConn({ adRow: [{ id: 5 }] });
    const minimal = { ad_type: "promotional", intent: ["conversion"], hook: ["social_proof"], offering_type: "service" };
    await persistAiMeta({ sql: mkSql(conn), network: "google", adId: "pub-5", normalized: minimal });
    const upsert = conn.calls.find((c) => c.sql.includes("_ai_meta"));
    // colors/offers/roa absent → bound as SQL NULL
    expect(upsert.params).toContain(null);
    expect(upsert.params).not.toContain("null");
  });

  it("error mid-transaction → rollback + error status (non-throwing)", async () => {
    const conn = mkConn({ adRow: [{ id: 1 }], throwOn: "INSERT INTO `facebook_ad_ai_meta`" });
    const warn = vi.fn();
    const r = await persistAiMeta({ sql: mkSql(conn), network: "facebook", adId: "pub-6", normalized: NORMALIZED, logger: { warn } });
    expect(r.sql_status).toBe("error");
    expect(r.sql_error).toBeTruthy();
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it("getConnection failure → error status, no throw", async () => {
    const sql = { getConnection: vi.fn(async () => { throw new Error("pool-empty"); }) };
    const r = await persistAiMeta({ sql, network: "facebook", adId: "1", normalized: NORMALIZED });
    expect(r.sql_status).toBe("error");
    expect(r.sql_error).toContain("getConnection");
  });
});
