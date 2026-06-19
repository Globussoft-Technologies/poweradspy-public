import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { checkFbUser, fbUserData } = require("../../../../src/services/facebook/userCheck/service");
const { userChk, adsData } = require("../../../../src/services/facebook/controllers/userCheckController");
const { xorEncryptDecrypt } = require("../../../../src/insertion/helpers/payloadCrypto");
const config = require("../../../../src/config");

const fakeLogger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
beforeEach(() => fakeLogger.error.mockClear());

function makeDb(opts = {}) {
  const calls = { insertUser: null, updateUser: null, insertCountry: 0 };
  const sql = {
    query: vi.fn(async (q, p = []) => {
      if (opts.throwOn && opts.throwOn.test(q)) throw new Error("sql-boom");
      if (/FROM country_only/.test(q)) return opts.country ? [{ id: opts.country }] : [];
      if (/INSERT INTO country_only/.test(q)) { calls.insertCountry += 1; return { insertId: 888 }; }
      if (/FROM facebook_users/.test(q)) return opts.user ? [{ id: 7 }] : [];
      if (/INSERT INTO facebook_users/.test(q)) { calls.insertUser = { q, p }; return { insertId: 99 }; }
      if (/UPDATE facebook_users/.test(q)) { calls.updateUser = { q, p }; return { affectedRows: 1 }; }
      return [];
    }),
  };
  return { db: { sql }, calls };
}

const enc = (obj) => xorEncryptDecrypt(Buffer.from(JSON.stringify(obj), "utf8"), config.insertion.decryptionKey).toString("base64");
const colsOf = (q) => q.match(/\(([^)]*)\)\s*VALUES/)[1].split(",").map((c) => c.trim().replace(/`/g, ""));

// ── user-chk : checkFbUser ─────────────────────────────────────────────────────
describe("services/facebook/userCheck > checkFbUser (user-chk)", () => {
  it("503 when db.sql is missing", async () => {
    expect((await checkFbUser({ body: {} }, {}, fakeLogger)).code).toBe(503);
  });

  it("403 Parameter missing when facebook_id absent", async () => {
    const { db } = makeDb();
    expect(await checkFbUser({ body: { platform: "10" } }, db, fakeLogger)).toEqual({ code: 403, message: "Parameter missing", data: null });
  });

  it("200 with count:1 when the user exists", async () => {
    const { db } = makeDb({ user: true });
    expect(await checkFbUser({ body: { facebook_id: "615", platform: "10" } }, db, fakeLogger)).toEqual({ code: 200, message: "data found successfully", count: 1 });
  });

  it("400 User not found when the user does not exist", async () => {
    const { db } = makeDb();
    expect(await checkFbUser({ body: { facebook_id: "615", platform: "10" } }, db, fakeLogger)).toEqual({ code: 400, message: "User not found", count: 0, data: null });
  });

  it("decrypts the data payload", async () => {
    const { db } = makeDb({ user: true });
    const out = await checkFbUser({ body: { data: enc({ facebook_id: "615" }) } }, db, fakeLogger);
    expect(out.code).toBe(200);
  });
});

// ── ads-data : fb_user_data ─────────────────────────────────────────────────────
describe("services/facebook/userCheck > fbUserData (ads-data)", () => {
  it("503 when db.sql is missing", async () => {
    expect((await fbUserData({ body: {} }, {}, fakeLogger)).code).toBe(503);
  });

  it("400 when facebook_id is missing", async () => {
    const { db } = makeDb();
    expect(await fbUserData({ body: { platform: "10" } }, db, fakeLogger)).toEqual({ code: 400, message: "please provide facebookId first" });
  });

  it("new user → 200, keeps current_country NAME and adds current_country_id, strips platform, uppercases Gender", async () => {
    const { db, calls } = makeDb({ country: 0 });
    const out = await fbUserData(
      { body: { facebook_id: "615", current_country: "India", name: "Matt", Gender: "male", age: "25", platform: "10", system_id: "GLB-1" } },
      db, fakeLogger,
    );
    expect(out).toEqual({ code: 200, message: "data added successfully" });
    expect(calls.insertCountry).toBe(1);
    expect(calls.insertUser.q).not.toMatch(/platform/);
    const cols = colsOf(calls.insertUser.q);
    expect(cols).toContain("current_country");
    expect(cols).toContain("current_country_id");
    expect(calls.insertUser.p[cols.indexOf("current_country")]).toBe("India"); // name kept
    expect(calls.insertUser.p[cols.indexOf("current_country_id")]).toBe(888);  // id added
    expect(calls.insertUser.p[cols.indexOf("Gender")]).toBe("MALE");
  });

  it("existing user → 201, updates exactly the 7 demographic columns", async () => {
    const { db, calls } = makeDb({ country: 5, user: true });
    const out = await fbUserData(
      { body: { facebook_id: "615", current_country: "India", name: "Matt2", Gender: "female", age: "30", relationship_status: "single", others_places_lived: "NY", platform: "10" } },
      db, fakeLogger,
    );
    expect(out).toEqual({ code: 201, message: "data updated" });
    expect(calls.insertUser).toBeNull();
    const setCols = calls.updateUser.q.match(/SET (.*?) WHERE/)[1].split(",").map((s) => s.trim().split(" ")[0].replace(/`/g, ""));
    expect(setCols).toEqual(["name", "others_places_lived", "Gender", "age", "relationship_status", "current_country", "current_country_id"]);
    expect(calls.updateUser.p[calls.updateUser.p.length - 1]).toBe("615"); // WHERE facebook_id
  });

  it("reuses an existing country_only id", async () => {
    const { db, calls } = makeDb({ country: 12 });
    await fbUserData({ body: { facebook_id: "1", current_country: "India", platform: "10" } }, db, fakeLogger);
    expect(calls.insertCountry).toBe(0);
    const cols = colsOf(calls.insertUser.q);
    expect(calls.insertUser.p[cols.indexOf("current_country_id")]).toBe(12);
  });

  it("202 + logs on any DB error (PHP try/catch contract)", async () => {
    const { db } = makeDb({ throwOn: /facebook_users/ });
    const out = await fbUserData({ body: { facebook_id: "615", current_country: "India", platform: "10" } }, db, fakeLogger);
    expect(out).toEqual({ code: 202, message: "Error occured in function fb_user_data" });
    expect(fakeLogger.error).toHaveBeenCalled();
  });

  it("decrypts the data payload (platform == 3)", async () => {
    const { db, calls } = makeDb({ country: 5 });
    const out = await fbUserData({ body: { platform: 3, data: enc({ facebook_id: "777", current_country: "India", name: "enc" }) } }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(calls.insertUser).toBeTruthy();
  });
});

describe("services/facebook/controllers/userCheckController", () => {
  it("userChk delegates to checkFbUser", async () => {
    const { db } = makeDb();
    expect((await userChk({ body: { platform: "10" } }, db, fakeLogger)).code).toBe(403);
  });
  it("adsData delegates to fbUserData", async () => {
    const { db } = makeDb();
    expect((await adsData({ body: { platform: "10" } }, db, fakeLogger)).code).toBe(400);
  });
});
