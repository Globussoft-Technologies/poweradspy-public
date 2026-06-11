import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { hideAds, getHiddenPostOwners, unHide } = require(
  "../../../../src/services/facebook/controllers/hideAdsController"
);

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
beforeEach(() => {
  fakeLogger.error.mockClear();
  fakeLogger.warn.mockClear();
});

function mkDb(queryImpl) {
  return { sql: { query: vi.fn(queryImpl) } };
}

describe("services/facebook/controllers/hideAdsController > hideAds", () => {
  it("400 when user_id missing", async () => {
    expect(await hideAds({ body: { type: 1 } }, {}, fakeLogger))
      .toEqual({ code: 400, message: "Missing required params: user_id, type" });
  });
  it("400 when type missing", async () => {
    expect(await hideAds({ body: { user_id: "u" } }, {}, fakeLogger))
      .toEqual({ code: 400, message: "Missing required params: user_id, type" });
  });
  it("503 when db.sql missing", async () => {
    expect(await hideAds({ body: { user_id: "u", type: 1 } }, { sql: null }, fakeLogger))
      .toEqual({ code: 503, message: "SQL connection not available" });
  });

  it("type=1 insert, lcs_status=0", async () => {
    const db = mkDb(async () => ({ insertId: 42 }));
    const out = await hideAds(
      { body: { user_id: "u", post_owner_id: "po", ad_id: "a", type: 1 } }, db, fakeLogger
    );
    expect(out).toEqual({ code: 200, message: "data inserted successfully", data: 42 });
    expect(db.sql.query.mock.calls[0][1]).toEqual(["u", "po", "a", 1, 0]);
  });

  it("type=3 with ad_id: lcs_status=1 when FEED + ad_url", async () => {
    let call = 0;
    const db = mkDb(async () => {
      call++;
      if (call === 1) return [{ ad_position: "FEED", ad_url: "https://x" }];
      return { insertId: 5 };
    });
    const out = await hideAds(
      { body: { user_id: "u", post_owner_id: "po", ad_id: "a", type: 3 } }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(db.sql.query.mock.calls[1][1]).toEqual(["u", "po", "a", 3, 1]);
  });

  it("type=3 with ad_id: lcs_status=2 when ad_position != FEED", async () => {
    let call = 0;
    const db = mkDb(async () => {
      call++;
      if (call === 1) return [{ ad_position: "RHS", ad_url: "https://x" }];
      return { insertId: 5 };
    });
    await hideAds({ body: { user_id: "u", ad_id: "a", type: 3 } }, db, fakeLogger);
    expect(db.sql.query.mock.calls[1][1]).toEqual(["u", null, "a", 3, 2]);
  });

  it("type=3 with ad_id: lcs_status=2 when ad_url null", async () => {
    let call = 0;
    const db = mkDb(async () => {
      call++;
      if (call === 1) return [{ ad_position: "FEED", ad_url: null }];
      return { insertId: 5 };
    });
    await hideAds({ body: { user_id: "u", ad_id: "a", type: 3 } }, db, fakeLogger);
    expect(db.sql.query.mock.calls[1][1]).toEqual(["u", null, "a", 3, 2]);
  });

  it("type=3 with ad_id but adData missing → lcs_status stays 0", async () => {
    let call = 0;
    const db = mkDb(async () => {
      call++;
      if (call === 1) return [];
      return { insertId: 5 };
    });
    await hideAds({ body: { user_id: "u", ad_id: "a", type: 3 } }, db, fakeLogger);
    expect(db.sql.query.mock.calls[1][1][4]).toBe(0);
  });

  it("type=3 ad-data SQL throw → logger.warn, lcs_status=0, still inserts", async () => {
    let call = 0;
    const db = mkDb(async () => {
      call++;
      if (call === 1) throw new Error("ad-data-fail");
      return { insertId: 5 };
    });
    const out = await hideAds({ body: { user_id: "u", ad_id: "a", type: 3 } }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(fakeLogger.warn).toHaveBeenCalledWith("Could not fetch ad data for lcs_status", { error: "ad-data-fail" });
    expect(db.sql.query.mock.calls[1][1][4]).toBe(0);
  });

  it("type=3 without ad_id → no pre-fetch query", async () => {
    const db = mkDb(async () => ({ insertId: 7 }));
    await hideAds({ body: { user_id: "u", type: 3 } }, db, fakeLogger);
    expect(db.sql.query).toHaveBeenCalledTimes(1);
  });

  it("400 when insertId=0", async () => {
    const db = mkDb(async () => ({ insertId: 0 }));
    expect(await hideAds({ body: { user_id: "u", type: 2 } }, db, fakeLogger))
      .toEqual({ code: 400, message: "data not inserted", data: null });
  });

  it("null defaults for missing post_owner_id/ad_id", async () => {
    const db = mkDb(async () => ({ insertId: 7 }));
    await hideAds({ body: { user_id: "u", type: 1 } }, db, fakeLogger);
    expect(db.sql.query.mock.calls[0][1]).toEqual(["u", null, null, 1, 0]);
  });

  it("401 + logger.error on insert SQL throw", async () => {
    const db = mkDb(async () => { throw new Error("sql-down"); });
    const out = await hideAds({ body: { user_id: "u", type: 1 } }, db, fakeLogger);
    expect(out.code).toBe(401);
    expect(out.message).toBe("sql-down");
    expect(fakeLogger.error).toHaveBeenCalled();
  });
});

describe("services/facebook/controllers/hideAdsController > getHiddenPostOwners", () => {
  it("400 when user_id missing", async () => {
    expect(await getHiddenPostOwners({ body: {} }, {}, fakeLogger))
      .toEqual({ code: 400, message: "Missing required param: user_id" });
  });
  it("503 when db.sql missing", async () => {
    expect(await getHiddenPostOwners({ body: { user_id: "u" } }, { sql: null }, fakeLogger))
      .toEqual({ code: 503, message: "SQL connection not available" });
  });
  it("400 when no rows", async () => {
    expect(await getHiddenPostOwners({ body: { user_id: "u" } }, mkDb(async () => []), fakeLogger))
      .toEqual({ code: 400, message: "no data found", data: null, addata: null, favorite: null });
  });
  it("400 when null rows", async () => {
    expect((await getHiddenPostOwners({ body: { user_id: "u" } }, mkDb(async () => null), fakeLogger)).code).toBe(400);
  });
  it("200 buckets type 1/2/3, ignores unknown", async () => {
    const db = mkDb(async () => [
      { type: 1, post_owner_id: "po1", ad_id: null },
      { type: 1, post_owner_id: "po2", ad_id: null },
      { type: 2, post_owner_id: null, ad_id: "ad1" },
      { type: 3, post_owner_id: null, ad_id: "fav1" },
      { type: 99, post_owner_id: "x", ad_id: "y" },
    ]);
    const out = await getHiddenPostOwners({ body: { user_id: "u" } }, db, fakeLogger);
    expect(out).toEqual({
      code: 200, message: "data retrieved",
      data: ["po1", "po2"],
      addata: ["ad1"],
      favorite: ["fav1"],
    });
  });
  it("401 on SQL throw", async () => {
    const db = mkDb(async () => { throw new Error("err"); });
    expect((await getHiddenPostOwners({ body: { user_id: "u" } }, db, fakeLogger)).code).toBe(401);
    expect(fakeLogger.error).toHaveBeenCalled();
  });
});

describe("services/facebook/controllers/hideAdsController > unHide", () => {
  it("400 when user_id missing", async () => {
    expect(await unHide({ body: { type: 1 } }, {}, fakeLogger))
      .toEqual({ code: 400, message: "Missing required params: user_id, type" });
  });
  it("400 when type missing", async () => {
    expect(await unHide({ body: { user_id: "u" } }, {}, fakeLogger))
      .toEqual({ code: 400, message: "Missing required params: user_id, type" });
  });
  it("503 when db.sql missing", async () => {
    expect(await unHide({ body: { user_id: "u", type: 1 } }, { sql: null }, fakeLogger))
      .toEqual({ code: 503, message: "SQL connection not available" });
  });
  it("type=1 without post_owner_id → 400", async () => {
    expect(await unHide({ body: { user_id: "u", type: "1" } }, mkDb(async () => ({})), fakeLogger))
      .toEqual({ code: 400, message: "Missing post_owner_id for type=1" });
  });
  it("type=2 without ad_id → 400", async () => {
    expect(await unHide({ body: { user_id: "u", type: 2 } }, mkDb(async () => ({})), fakeLogger))
      .toEqual({ code: 400, message: "Missing ad_id for type=2/3" });
  });
  it("type=3 without ad_id → 400", async () => {
    expect(await unHide({ body: { user_id: "u", type: 3 } }, mkDb(async () => ({})), fakeLogger))
      .toEqual({ code: 400, message: "Missing ad_id for type=2/3" });
  });
  it("invalid type → 400", async () => {
    expect(await unHide({ body: { user_id: "u", type: 99 } }, mkDb(async () => ({})), fakeLogger))
      .toEqual({ code: 400, message: "Invalid type. Must be 1, 2, or 3" });
  });
  it("type=1 happy path", async () => {
    const db = mkDb(async () => ({ affectedRows: 3 }));
    const out = await unHide(
      { body: { user_id: "u", post_owner_id: "po", type: 1 } }, db, fakeLogger
    );
    expect(out).toEqual({ code: 200, message: "data deleted successfully", data: 3 });
    expect(db.sql.query.mock.calls[0][1]).toEqual(["u", "po"]);
  });
  it("type=2 happy path", async () => {
    const db = mkDb(async () => ({ affectedRows: 1 }));
    const out = await unHide(
      { body: { user_id: "u", ad_id: "a", type: 2 } }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(db.sql.query.mock.calls[0][1]).toEqual(["u", "a", 2]);
  });
  it("type=3 happy path WITH ES cleanup (hits found, delete called)", async () => {
    const sqlQuery = vi.fn(async () => ({ affectedRows: 5 }));
    const esSearch = vi.fn(async () => ({ hits: { hits: [{ _id: "es-1" }] } }));
    const esDelete = vi.fn(async () => ({}));
    const db = { sql: { query: sqlQuery }, elastic: { search: esSearch, delete: esDelete } };
    const out = await unHide(
      { body: { user_id: "u", ad_id: "a", type: "3" } }, db, fakeLogger
    );
    expect(out.data).toBe(5);
    expect(esDelete).toHaveBeenCalledWith({ index: "facebook_ad_recommended_activity", id: "es-1" });
  });
  it("type=3 ES body.hits fallback shape", async () => {
    const sqlQuery = vi.fn(async () => ({ affectedRows: 1 }));
    const esSearch = vi.fn(async () => ({ body: { hits: { hits: [{ _id: "es-2" }] } } }));
    const esDelete = vi.fn(async () => ({}));
    const db = { sql: { query: sqlQuery }, elastic: { search: esSearch, delete: esDelete } };
    await unHide({ body: { user_id: "u", ad_id: "a", type: 3 } }, db, fakeLogger);
    expect(esDelete).toHaveBeenCalledWith({ index: "facebook_ad_recommended_activity", id: "es-2" });
  });
  it("type=3 ES 0 hits → no delete called", async () => {
    const sqlQuery = vi.fn(async () => ({ affectedRows: 1 }));
    const esSearch = vi.fn(async () => ({ hits: { hits: [] } }));
    const esDelete = vi.fn();
    const db = { sql: { query: sqlQuery }, elastic: { search: esSearch, delete: esDelete } };
    await unHide({ body: { user_id: "u", ad_id: "a", type: 3 } }, db, fakeLogger);
    expect(esDelete).not.toHaveBeenCalled();
  });
  it("type=3 without elastic → no ES side effects", async () => {
    const db = mkDb(async () => ({ affectedRows: 1 }));
    const out = await unHide(
      { body: { user_id: "u", ad_id: "a", type: 3 } }, db, fakeLogger
    );
    expect(out.code).toBe(200);
  });
  it("type=3 ES search throw → logger.warn, SQL still runs", async () => {
    const sqlQuery = vi.fn(async () => ({ affectedRows: 1 }));
    const esSearch = vi.fn(async () => { throw new Error("es-down"); });
    const db = { sql: { query: sqlQuery }, elastic: { search: esSearch, delete: vi.fn() } };
    const out = await unHide({ body: { user_id: "u", ad_id: "a", type: 3 } }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(fakeLogger.warn).toHaveBeenCalledWith("ES activity cleanup failed", { error: "es-down" });
  });
  it("0 affected → 400 'data not deleted'", async () => {
    const db = mkDb(async () => ({ affectedRows: 0 }));
    expect(await unHide(
      { body: { user_id: "u", post_owner_id: "po", type: 1 } }, db, fakeLogger
    )).toEqual({ code: 400, message: "data not deleted", data: null });
  });
  it("affectedRows missing → defaults to 0", async () => {
    const db = mkDb(async () => null);
    expect((await unHide(
      { body: { user_id: "u", post_owner_id: "po", type: 1 } }, db, fakeLogger
    )).code).toBe(400);
  });
  it("500 + logger.error on SQL throw", async () => {
    const db = mkDb(async () => { throw new Error("delete-fail"); });
    const out = await unHide(
      { body: { user_id: "u", post_owner_id: "po", type: 1 } }, db, fakeLogger
    );
    expect(out).toEqual({ code: 500, message: "Error in unHide", error: "delete-fail" });
    expect(fakeLogger.error).toHaveBeenCalled();
  });
});
