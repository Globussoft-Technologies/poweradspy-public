import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { hideAds, getHiddenPostOwners, unHide } = require(
  "../../../../src/services/quora/controllers/hideAdsController"
);

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
beforeEach(() => fakeLogger.error.mockClear());

function mkDb(queryImpl) {
  return { sql: { query: vi.fn(queryImpl) } };
}

describe("services/quora/controllers/hideAdsController > hideAds", () => {
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

  it("200 with insertId on successful insert", async () => {
    const db = mkDb(async () => ({ insertId: 42 }));
    const out = await hideAds(
      { body: { user_id: "u", post_owner_id: "po", ad_id: "a", type: 1 } }, db, fakeLogger
    );
    expect(out).toEqual({ code: 200, message: "data inserted successfully", data: 42 });
    expect(db.sql.query.mock.calls[0][1]).toEqual(["u", "po", "a", 1]);
  });

  it("400 when insertId is 0", async () => {
    const db = mkDb(async () => ({ insertId: 0 }));
    const out = await hideAds({ body: { user_id: "u", type: 2 } }, db, fakeLogger);
    expect(out).toEqual({ code: 400, message: "data not inserted", data: null });
  });

  it("null defaults for missing post_owner_id and ad_id", async () => {
    const db = mkDb(async () => ({ insertId: 7 }));
    await hideAds({ body: { user_id: "u", type: 3 } }, db, fakeLogger);
    expect(db.sql.query.mock.calls[0][1]).toEqual(["u", null, null, 3]);
  });

  it("401 + logger.error on SQL throw", async () => {
    const db = mkDb(async () => { throw new Error("sql-down"); });
    const out = await hideAds({ body: { user_id: "u", type: 1 } }, db, fakeLogger);
    expect(out.code).toBe(401);
    expect(out.message).toBe("sql-down");
    expect(fakeLogger.error).toHaveBeenCalled();
  });
});

describe("services/quora/controllers/hideAdsController > getHiddenPostOwners", () => {
  it("400 when user_id missing", async () => {
    expect(await getHiddenPostOwners({ body: {} }, {}, fakeLogger))
      .toEqual({ code: 400, message: "Missing required param: user_id" });
  });

  it("503 when db.sql missing", async () => {
    expect(await getHiddenPostOwners({ body: { user_id: "u" } }, { sql: null }, fakeLogger))
      .toEqual({ code: 503, message: "SQL connection not available" });
  });

  it("400 when empty rows", async () => {
    const db = mkDb(async () => []);
    expect(await getHiddenPostOwners({ body: { user_id: "u" } }, db, fakeLogger))
      .toEqual({ code: 400, message: "no data found", data: null, addata: null, favorite: null });
  });

  it("400 when null rows", async () => {
    const db = mkDb(async () => null);
    const out = await getHiddenPostOwners({ body: { user_id: "u" } }, db, fakeLogger);
    expect(out.code).toBe(400);
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
    const out = await getHiddenPostOwners({ body: { user_id: "u" } }, db, fakeLogger);
    expect(out.code).toBe(401);
    expect(fakeLogger.error).toHaveBeenCalled();
  });
});

describe("services/quora/controllers/hideAdsController > unHide", () => {
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

  it("type=3 happy path with string type", async () => {
    const db = mkDb(async () => ({ affectedRows: 5 }));
    const out = await unHide(
      { body: { user_id: "u", ad_id: "a", type: "3" } }, db, fakeLogger
    );
    expect(out.data).toBe(5);
  });

  it("0 affected → 400 'data not deleted'", async () => {
    const db = mkDb(async () => ({ affectedRows: 0 }));
    const out = await unHide(
      { body: { user_id: "u", post_owner_id: "po", type: 1 } }, db, fakeLogger
    );
    expect(out).toEqual({ code: 400, message: "data not deleted", data: null });
  });

  it("affectedRows missing → defaults to 0 (?. fallback)", async () => {
    const db = mkDb(async () => null);
    const out = await unHide(
      { body: { user_id: "u", post_owner_id: "po", type: 1 } }, db, fakeLogger
    );
    expect(out.code).toBe(400);
  });

  it("500 + logger.error on SQL throw", async () => {
    const db = mkDb(async () => { throw new Error("delete-fail"); });
    const out = await unHide(
      { body: { user_id: "u", post_owner_id: "po", type: 1 } }, db, fakeLogger
    );
    expect(out).toEqual({ code: 500, message: "Error in Quora unHide", error: "delete-fail" });
    expect(fakeLogger.error).toHaveBeenCalled();
  });
});
