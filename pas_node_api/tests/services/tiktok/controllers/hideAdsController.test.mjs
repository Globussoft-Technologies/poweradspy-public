import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { hideAds, getHiddenPostOwners, unHide } = require(
  "../../../../src/services/tiktok/controllers/hideAdsController"
);

const fakeLogger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
beforeEach(() => fakeLogger.error.mockClear());

function mkDb(queryImpl) {
  return { sql: { query: vi.fn(queryImpl) } };
}

describe("services/tiktok/controllers/hideAdsController > hideAds", () => {
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

  it("returns existing id when record already exists (dedup branch)", async () => {
    let call = 0;
    const db = mkDb(async () => {
      call++;
      // type=2 runs a DELETE (call 1) before the dedup SELECT (call 2),
      // so the existing record must be returned on the 2nd query.
      return call === 2 ? [{ id: 77 }] : { insertId: 999 };
    });
    const out = await hideAds(
      { body: { user_id: "u", ad_id: "a", type: 2 } }, db, fakeLogger
    );
    expect(out).toEqual({ code: 200, message: "data inserted successfully", data: 77 });
    expect(db.sql.query).toHaveBeenCalledTimes(2); // DELETE + SELECT; insert never reached
  });

  it("inserts and returns 200 with insertId when no existing record", async () => {
    let call = 0;
    const db = mkDb(async () => {
      call++;
      return call === 1 ? [] : { insertId: 42 };
    });
    const out = await hideAds(
      { body: { user_id: "u", post_owner_id: "po", ad_id: "a", type: 1 } }, db, fakeLogger
    );
    expect(out).toEqual({ code: 200, message: "data inserted successfully", data: 42 });
  });

  it("400 when insertId is 0", async () => {
    let call = 0;
    const db = mkDb(async () => {
      call++;
      return call === 1 ? [] : { insertId: 0 };
    });
    const out = await hideAds({ body: { user_id: "u", type: 1 } }, db, fakeLogger);
    expect(out).toEqual({ code: 400, message: "data not inserted", data: null });
  });

  it("401 + logger.error on SQL throw", async () => {
    const db = mkDb(async () => { throw new Error("sql-down"); });
    const out = await hideAds({ body: { user_id: "u", type: 1 } }, db, fakeLogger);
    expect(out.code).toBe(401);
    expect(out.message).toBe("sql-down");
    expect(fakeLogger.error).toHaveBeenCalled();
  });

  it("existing record but empty array falls through to insert", async () => {
    let call = 0;
    const db = mkDb(async () => {
      call++;
      return call === 1 ? null : { insertId: 7 };
    });
    const out = await hideAds(
      { body: { user_id: "u", ad_id: null, type: 3 } }, db, fakeLogger
    );
    expect(out.data).toBe(7);
  });
});

describe("services/tiktok/controllers/hideAdsController > getHiddenPostOwners", () => {
  it("400 when user_id missing", async () => {
    expect(await getHiddenPostOwners({ body: {} }, {}, fakeLogger))
      .toEqual({ code: 400, message: "Missing required param: user_id" });
  });

  it("503 when db.sql missing", async () => {
    expect(await getHiddenPostOwners({ body: { user_id: "u" } }, { sql: null }, fakeLogger))
      .toEqual({ code: 503, message: "SQL connection not available" });
  });

  it("400 when no rows returned (empty)", async () => {
    const db = mkDb(async () => []);
    const out = await getHiddenPostOwners({ body: { user_id: "u" } }, db, fakeLogger);
    expect(out).toEqual({
      code: 400, message: "no data found", data: null, addata: null, favorite: null,
    });
  });

  it("400 when query returns null", async () => {
    const db = mkDb(async () => null);
    const out = await getHiddenPostOwners({ body: { user_id: "u" } }, db, fakeLogger);
    expect(out.code).toBe(400);
  });

  it("200 with sorted buckets for type 1/2/3", async () => {
    const db = mkDb(async () => [
      { type: 1, post_owner_id: "po1", ad_id: null },
      { type: 1, post_owner_id: "po2", ad_id: null },
      { type: 2, post_owner_id: null, ad_id: "ad1" },
      { type: 3, post_owner_id: null, ad_id: "fav1" },
      { type: 99, post_owner_id: "x", ad_id: "y" }, // unknown type → silently ignored
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

describe("services/tiktok/controllers/hideAdsController > unHide", () => {
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
    const db = mkDb(async () => ({ affectedRows: 1 }));
    const out = await unHide({ body: { user_id: "u", type: "1" } }, db, fakeLogger);
    expect(out).toEqual({ code: 400, message: "Missing post_owner_id for type=1" });
  });

  it("type=2 without ad_id → 400", async () => {
    const db = mkDb(async () => ({ affectedRows: 1 }));
    const out = await unHide({ body: { user_id: "u", type: 2 } }, db, fakeLogger);
    expect(out).toEqual({ code: 400, message: "Missing ad_id for type=2/3" });
  });

  it("type=3 without ad_id → 400", async () => {
    const db = mkDb(async () => ({ affectedRows: 1 }));
    const out = await unHide({ body: { user_id: "u", type: 3 } }, db, fakeLogger);
    expect(out).toEqual({ code: 400, message: "Missing ad_id for type=2/3" });
  });

  it("invalid type → 400", async () => {
    const db = mkDb(async () => ({ affectedRows: 1 }));
    const out = await unHide({ body: { user_id: "u", type: 99 } }, db, fakeLogger);
    expect(out).toEqual({ code: 400, message: "Invalid type. Must be 1, 2, or 3" });
  });

  it("type=1 happy path: deletes by post_owner_id, returns affected count", async () => {
    const db = mkDb(async () => ({ affectedRows: 3 }));
    const out = await unHide(
      { body: { user_id: "u", post_owner_id: "po", type: 1 } }, db, fakeLogger
    );
    expect(out).toEqual({ code: 200, message: "data deleted successfully", data: 3 });
    expect(db.sql.query.mock.calls[0][0]).toContain("post_owner_id");
  });

  it("type=2 happy path: deletes by ad_id", async () => {
    const db = mkDb(async () => ({ affectedRows: 1 }));
    const out = await unHide(
      { body: { user_id: "u", ad_id: "a", type: 2 } }, db, fakeLogger
    );
    expect(out.code).toBe(200);
    expect(db.sql.query.mock.calls[0][1]).toEqual(["u", "a", 2]);
  });

  it("type=3 happy path", async () => {
    const db = mkDb(async () => ({ affectedRows: 5 }));
    const out = await unHide(
      { body: { user_id: "u", ad_id: "a", type: "3" } }, db, fakeLogger
    );
    expect(out.code).toBe(200);
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
    expect(out).toEqual({ code: 500, message: "Error in unHide", error: "delete-fail" });
    expect(fakeLogger.error).toHaveBeenCalled();
  });
});
