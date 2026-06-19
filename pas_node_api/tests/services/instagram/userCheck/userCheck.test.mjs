import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const { checkUser } = require("../../../../src/services/instagram/userCheck/service");
const { userChk } = require("../../../../src/services/instagram/controllers/userCheckController");
const { xorEncryptDecrypt } = require("../../../../src/insertion/helpers/payloadCrypto");
const config = require("../../../../src/config");

const fakeLogger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
beforeEach(() => fakeLogger.error.mockClear());

// Build a mock db.sql whose query() routes on the SQL text.
// opts: { country?: id-of-existing-country_only, user?: existing-user, throwOn?: regex }
function makeDb(opts = {}) {
  const calls = { insertUser: null, updateUser: null, insertCountry: 0 };
  const sql = {
    query: vi.fn(async (q, p = []) => {
      if (opts.throwOn && opts.throwOn.test(q)) throw new Error("sql-boom");
      if (/FROM instagram_country_only/.test(q)) return opts.country ? [{ id: opts.country }] : [];
      if (/INSERT INTO instagram_country_only/.test(q)) { calls.insertCountry += 1; return { insertId: 555 }; }
      if (/FROM instagram_user/.test(q)) return opts.user ? [{ id: 5, instagram_username: "old" }] : [];
      if (/INSERT INTO instagram_user/.test(q)) { calls.insertUser = { q, p }; return { insertId: 42 }; }
      if (/UPDATE instagram_user/.test(q)) { calls.updateUser = { q, p }; return { affectedRows: 1 }; }
      return [];
    }),
  };
  return { db: { sql }, calls };
}

const enc = (obj) => xorEncryptDecrypt(Buffer.from(JSON.stringify(obj), "utf8"), config.insertion.decryptionKey).toString("base64");

describe("services/instagram/userCheck > checkUser", () => {
  it("503 when db.sql is missing", async () => {
    const out = await checkUser({ body: {} }, {}, fakeLogger);
    expect(out.code).toBe(503);
  });

  it("400 when instagram_id is missing", async () => {
    const { db } = makeDb();
    const out = await checkUser({ body: { platform: "10", current_country: "India" } }, db, fakeLogger);
    expect(out).toEqual({ code: 400, message: "please provide instagramId first" });
  });

  it("new user → 200, inserts a new country, strips platform, stores id in current_country and name in country", async () => {
    const { db, calls } = makeDb({ country: 0 }); // no existing country
    const out = await checkUser(
      { body: { instagram_id: "126", current_country: "India", instagram_username: "matt", name: "M", platform: "10", system_id: "GLB-132" } },
      db, fakeLogger,
    );
    expect(out).toEqual({ code: 200, message: "data added successfully" });
    expect(calls.insertCountry).toBe(1);
    expect(calls.insertUser).toBeTruthy();
    expect(calls.insertUser.q).not.toMatch(/platform/);
    expect(calls.insertUser.q).not.toMatch(/\bdata\b/);
    // current_country column carries the resolved id (555); country column carries the name.
    const cols = calls.insertUser.q.match(/\(([^)]*)\)\s*VALUES/)[1].split(",").map((c) => c.trim().replace(/`/g, ""));
    expect(cols).toContain("current_country");
    expect(cols).toContain("country");
    const idx = (name) => cols.indexOf(name);
    expect(calls.insertUser.p[idx("current_country")]).toBe(555);
    expect(calls.insertUser.p[idx("country")]).toBe("India");
  });

  it("reuses an existing country_only id instead of inserting", async () => {
    const { db, calls } = makeDb({ country: 9 });
    await checkUser({ body: { instagram_id: "1", current_country: "India", platform: "10" } }, db, fakeLogger);
    expect(calls.insertCountry).toBe(0);
    const cols = calls.insertUser.q.match(/\(([^)]*)\)\s*VALUES/)[1].split(",").map((c) => c.trim().replace(/`/g, ""));
    expect(calls.insertUser.p[cols.indexOf("current_country")]).toBe(9);
  });

  it("existing user → 201, updates instagram_username only", async () => {
    const { db, calls } = makeDb({ country: 9, user: true });
    const out = await checkUser({ body: { instagram_id: "126", instagram_username: "matt2", platform: "10" } }, db, fakeLogger);
    expect(out).toEqual({ code: 201, message: "data updated successfully" });
    expect(calls.insertUser).toBeNull();
    expect(calls.updateUser.q).toMatch(/SET instagram_username = \?/);
    expect(calls.updateUser.p).toEqual(["matt2", "126"]);
  });

  it("uppercases gender before insert", async () => {
    const { db, calls } = makeDb({ country: 9 });
    await checkUser({ body: { instagram_id: "1", current_country: "India", gender: "male", platform: "10" } }, db, fakeLogger);
    const cols = calls.insertUser.q.match(/\(([^)]*)\)\s*VALUES/)[1].split(",").map((c) => c.trim().replace(/`/g, ""));
    expect(calls.insertUser.p[cols.indexOf("gender")]).toBe("MALE");
  });

  it("401 + logs when country resolution fails", async () => {
    const { db } = makeDb({ throwOn: /instagram_country_only/ });
    const out = await checkUser({ body: { instagram_id: "1", current_country: "India", platform: "10" } }, db, fakeLogger);
    expect(out).toEqual({ code: 401, message: "sql error" });
    expect(fakeLogger.error).toHaveBeenCalled();
  });

  it("401 + logs when the user upsert throws", async () => {
    const { db } = makeDb({ country: 9, throwOn: /instagram_user/ });
    const out = await checkUser({ body: { instagram_id: "1", current_country: "India", platform: "10" } }, db, fakeLogger);
    expect(out.code).toBe(401);
    expect(fakeLogger.error).toHaveBeenCalled();
  });

  it("decrypts an encrypted `data` payload (platform == 3 path)", async () => {
    const { db, calls } = makeDb({ country: 9 });
    const out = await checkUser({ body: { platform: 3, data: enc({ instagram_id: "777", current_country: "India", instagram_username: "enc" }) } }, db, fakeLogger);
    expect(out.code).toBe(200);
    expect(calls.insertUser).toBeTruthy();
  });
});

describe("services/instagram/controllers/userCheckController > userChk", () => {
  it("delegates to the service", async () => {
    const { db } = makeDb();
    const out = await userChk({ body: { platform: "10" } }, db, fakeLogger);
    expect(out).toEqual({ code: 400, message: "please provide instagramId first" });
  });
});
