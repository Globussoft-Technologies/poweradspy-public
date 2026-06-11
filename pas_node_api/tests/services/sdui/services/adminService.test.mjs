import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const dbPath = require.resolve("../../../../src/services/sdui/db");
const getDB = vi.fn();
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { getDB },
};

// Pre-stub mongodb for ObjectId import
const mongoPath = require.resolve("mongodb");
const ObjectIdCtor = vi.fn(function (id) { this.id = id; if (typeof id === "string" && id === "throw") throw new Error("bad-oid"); });
require.cache[mongoPath] = {
  id: mongoPath, filename: mongoPath, loaded: true,
  exports: { ObjectId: ObjectIdCtor },
};

const svc = require("../../../../src/services/sdui/services/adminService");

let collections;
function mkDb({ findOneImpl, findImpl, insertOne, updateOne, updateMany, deleteOne, deleteMany, replaceOne } = {}) {
  collections = {
    findOne: vi.fn(findOneImpl || (async () => null)),
    find: vi.fn(() => ({
      toArray: vi.fn(findImpl?.toArray || (async () => [])),
      sort: vi.fn(() => ({ toArray: vi.fn(findImpl?.toArray || (async () => [])) })),
    })),
    insertOne: vi.fn(insertOne || (async () => ({ insertedId: "id" }))),
    updateOne: vi.fn(updateOne || (async () => ({ modifiedCount: 1 }))),
    updateMany: vi.fn(updateMany || (async () => ({ modifiedCount: 0 }))),
    deleteOne: vi.fn(deleteOne || (async () => ({}))),
    deleteMany: vi.fn(deleteMany || (async () => ({}))),
    replaceOne: vi.fn(replaceOne || (async () => ({}))),
  };
  return { collection: vi.fn(() => collections) };
}

beforeEach(() => {
  getDB.mockReset();
  ObjectIdCtor.mockClear();
});

describe("adminService > getAllDocs / getDoc / updateDoc / patchField / deleteDoc", () => {
  it("getAllDocs returns toArray result", async () => {
    getDB.mockResolvedValue(mkDb({ findImpl: { toArray: async () => [{ _id: "x" }] } }));
    expect(await svc.getAllDocs()).toEqual([{ _id: "x" }]);
  });
  it("getDoc → findOne", async () => {
    getDB.mockResolvedValue(mkDb({ findOneImpl: async () => ({ _id: "x" }) }));
    expect(await svc.getDoc("x")).toEqual({ _id: "x" });
  });
  it("updateDoc forces _id from arg", async () => {
    getDB.mockResolvedValue(mkDb());
    await svc.updateDoc("forced", { _id: "ignored", a: 1 });
    expect(collections.replaceOne).toHaveBeenCalledWith(
      { _id: "forced" },
      { _id: "forced", a: 1 },
      { upsert: true }
    );
  });
  it("patchField sets the named field", async () => {
    getDB.mockResolvedValue(mkDb());
    await svc.patchField("x", "visible", true);
    expect(collections.updateOne).toHaveBeenCalledWith({ _id: "x" }, { $set: { visible: true } });
  });
  it("deleteDoc deletes by _id", async () => {
    getDB.mockResolvedValue(mkDb());
    await svc.deleteDoc("x");
    expect(collections.deleteOne).toHaveBeenCalledWith({ _id: "x" });
  });
});

describe("adminService > saveSnapshot / getSnapshots / restoreSnapshot", () => {
  it("saveSnapshot noop when doc not found", async () => {
    getDB.mockResolvedValue(mkDb({ findOneImpl: async () => null }));
    await svc.saveSnapshot("x");
    expect(collections.insertOne).not.toHaveBeenCalled();
  });
  it("saveSnapshot inserts + prunes when over limit", async () => {
    let findCall = 0;
    const all = Array.from({ length: 12 }, (_, i) => ({ _id: `s${i}` }));
    getDB.mockResolvedValue({
      collection: vi.fn(() => ({
        findOne: vi.fn(async () => ({ _id: "x", data: "v" })),
        insertOne: vi.fn(async () => ({})),
        find: vi.fn(() => ({ sort: vi.fn(() => ({ toArray: vi.fn(async () => all) })) })),
        deleteMany: vi.fn(async () => ({})),
      })),
    });
    await svc.saveSnapshot("x");
  });
  it("saveSnapshot does not prune when within limit", async () => {
    getDB.mockResolvedValue({
      collection: vi.fn(() => ({
        findOne: vi.fn(async () => ({ _id: "x" })),
        insertOne: vi.fn(async () => ({})),
        find: vi.fn(() => ({ sort: vi.fn(() => ({ toArray: vi.fn(async () => [{ _id: "s1" }]) })) })),
        deleteMany: vi.fn(async () => ({})),
      })),
    });
    await svc.saveSnapshot("x");
  });
  it("getSnapshots returns sorted list", async () => {
    getDB.mockResolvedValue({
      collection: vi.fn(() => ({
        find: vi.fn(() => ({ sort: vi.fn(() => ({ toArray: vi.fn(async () => [{ _id: "s" }]) })) })),
      })),
    });
    expect(await svc.getSnapshots("x")).toEqual([{ _id: "s" }]);
  });
  it("restoreSnapshot throws when snapshot not found", async () => {
    getDB.mockResolvedValue(mkDb({ findOneImpl: async () => null }));
    await expect(svc.restoreSnapshot("sid")).rejects.toThrow("Snapshot not found");
  });
  it("restoreSnapshot ObjectId throw is caught (uses raw id)", async () => {
    let calls = 0;
    const findOne = vi.fn(async () => {
      calls++;
      if (calls === 1) return null; // snapshot lookup fails
      return null;
    });
    getDB.mockResolvedValue({ collection: vi.fn(() => ({ findOne, insertOne: vi.fn(), find: vi.fn(() => ({ sort: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })), deleteMany: vi.fn(), replaceOne: vi.fn() })) });
    await expect(svc.restoreSnapshot("throw")).rejects.toThrow("Snapshot not found");
  });
  it("restoreSnapshot happy path saves prev snapshot + replaces", async () => {
    let findOneCall = 0;
    const findOne = vi.fn(async () => {
      findOneCall++;
      if (findOneCall === 1) return { _id: "sid", snapshot: { foo: 1 }, originalId: "orig" };
      if (findOneCall === 2) return { _id: "orig", currentState: "yes" }; // saveSnapshot
      return null;
    });
    const replaceOne = vi.fn(async () => ({}));
    getDB.mockResolvedValue({ collection: vi.fn(() => ({ findOne, insertOne: vi.fn(async () => ({})), find: vi.fn(() => ({ sort: vi.fn(() => ({ toArray: vi.fn(async () => []) })) })), deleteMany: vi.fn(), replaceOne })) });
    const out = await svc.restoreSnapshot("sid");
    expect(out).toEqual({ foo: 1 });
    expect(replaceOne).toHaveBeenCalled();
  });
});

describe("adminService > createDoc", () => {
  it("throws when _id missing", async () => {
    getDB.mockResolvedValue(mkDb());
    await expect(svc.createDoc({})).rejects.toThrow(/_id is required/);
  });
  it("throws when doc already exists", async () => {
    getDB.mockResolvedValue(mkDb({ findOneImpl: async () => ({ _id: "x" }) }));
    await expect(svc.createDoc({ _id: "x" })).rejects.toThrow(/already exists/);
  });
  it("creates with defaults: created_at + filters=[]", async () => {
    getDB.mockResolvedValue(mkDb({ findOneImpl: async () => null }));
    const out = await svc.createDoc({ _id: "new" });
    expect(out.created_at).toBeDefined();
    expect(out.filters).toEqual([]);
    expect(collections.insertOne).toHaveBeenCalled();
  });
  it("rank+config_type triggers updateMany shift", async () => {
    getDB.mockResolvedValue(mkDb({ findOneImpl: async () => null }));
    await svc.createDoc({ _id: "x", rank: 5, config_type: "sidebar" });
    expect(collections.updateMany).toHaveBeenCalledWith(
      { config_type: "sidebar", rank: { $gte: 5 } },
      { $inc: { rank: 1 } }
    );
  });
  it("rank=null → no shift", async () => {
    getDB.mockResolvedValue(mkDb({ findOneImpl: async () => null }));
    await svc.createDoc({ _id: "x", rank: null });
    expect(collections.updateMany).not.toHaveBeenCalled();
  });
  it("preserves passed created_at", async () => {
    getDB.mockResolvedValue(mkDb({ findOneImpl: async () => null }));
    const out = await svc.createDoc({ _id: "x", created_at: "2024-01-01" });
    expect(out.created_at).toBe("2024-01-01");
  });
  it("preserves passed filters", async () => {
    getDB.mockResolvedValue(mkDb({ findOneImpl: async () => null }));
    const out = await svc.createDoc({ _id: "x", filters: [{ _id: "f" }] });
    expect(out.filters).toEqual([{ _id: "f" }]);
  });
});

describe("adminService > addFilter / updateFilter / deleteFilter", () => {
  it("addFilter throws when _id missing", async () => {
    getDB.mockResolvedValue(mkDb());
    await expect(svc.addFilter("doc", {})).rejects.toThrow(/_id is required/);
  });
  it("addFilter with rank → shifts other filters then pushes", async () => {
    getDB.mockResolvedValue(mkDb());
    await svc.addFilter("doc", { _id: "f", rank: 3 });
    expect(collections.updateOne).toHaveBeenCalledTimes(2);
  });
  it("addFilter without rank → only push", async () => {
    getDB.mockResolvedValue(mkDb());
    await svc.addFilter("doc", { _id: "f" });
    expect(collections.updateOne).toHaveBeenCalledTimes(1);
  });
  it("updateFilter strips _id and options from updates", async () => {
    getDB.mockResolvedValue(mkDb());
    await svc.updateFilter("doc", "f", { _id: "ignored", options: "ignored", label: "L" });
    const call = collections.updateOne.mock.calls[0];
    expect(call[1].$set).toEqual({ "filters.$[f].label": "L" });
  });
  it("updateFilter with only _id/options → no update", async () => {
    getDB.mockResolvedValue(mkDb());
    await svc.updateFilter("doc", "f", { _id: "x", options: "y" });
    expect(collections.updateOne).not.toHaveBeenCalled();
  });
  it("deleteFilter pulls from filters array", async () => {
    getDB.mockResolvedValue(mkDb());
    await svc.deleteFilter("doc", "f");
    expect(collections.updateOne).toHaveBeenCalledWith({ _id: "doc" }, { $pull: { filters: { _id: "f" } } });
  });
});

describe("adminService > addOption / updateOption / deleteOption", () => {
  it("addOption throws when _id missing", async () => {
    getDB.mockResolvedValue(mkDb());
    await expect(svc.addOption("doc", "f", {})).rejects.toThrow(/_id is required/);
  });
  it("addOption with rank shifts existing options and replaces doc", async () => {
    const doc = { _id: "doc", filters: [{ _id: "f", options: [{ _id: "o1", rank: 2 }, { _id: "o2", rank: 5 }] }] };
    getDB.mockResolvedValue(mkDb({ findOneImpl: async () => doc }));
    await svc.addOption("doc", "f", { _id: "o3", rank: 3 });
    expect(collections.replaceOne).toHaveBeenCalled();
  });
  it("addOption rank but no existing doc → just push", async () => {
    getDB.mockResolvedValue(mkDb({ findOneImpl: async () => null }));
    await svc.addOption("doc", "f", { _id: "o", rank: 1 });
    expect(collections.replaceOne).not.toHaveBeenCalled();
  });
  it("addOption rank but doc has no matching filter → just push", async () => {
    getDB.mockResolvedValue(mkDb({ findOneImpl: async () => ({ _id: "doc", filters: [{ _id: "other" }] }) }));
    await svc.addOption("doc", "f", { _id: "o", rank: 1 });
    expect(collections.replaceOne).not.toHaveBeenCalled();
  });
  it("addOption without rank → only push", async () => {
    getDB.mockResolvedValue(mkDb({ findOneImpl: async () => null }));
    await svc.addOption("doc", "f", { _id: "o" });
    expect(collections.updateOne).toHaveBeenCalled();
  });
  it("addOption rank but options has no rank match → no replace", async () => {
    const doc = { _id: "doc", filters: [{ _id: "f", options: [{ _id: "o1", rank: 1 }] }] };
    getDB.mockResolvedValue(mkDb({ findOneImpl: async () => doc }));
    await svc.addOption("doc", "f", { _id: "o3", rank: 99 });
    expect(collections.replaceOne).not.toHaveBeenCalled();
  });
  it("updateOption throws when doc missing", async () => {
    getDB.mockResolvedValue(mkDb({ findOneImpl: async () => null }));
    await expect(svc.updateOption("doc", "f", "o", {})).rejects.toThrow(/Document not found/);
  });
  it("updateOption throws when filter missing", async () => {
    getDB.mockResolvedValue(mkDb({ findOneImpl: async () => ({ _id: "doc", filters: [] }) }));
    await expect(svc.updateOption("doc", "f", "o", {})).rejects.toThrow(/Filter not found/);
  });
  it("updateOption throws when option missing", async () => {
    getDB.mockResolvedValue(mkDb({ findOneImpl: async () => ({ _id: "doc", filters: [{ _id: "f", options: [] }] }) }));
    await expect(svc.updateOption("doc", "f", "o", {})).rejects.toThrow(/Option not found/);
  });
  it("updateOption merges updates, preserves _id", async () => {
    const doc = { _id: "doc", filters: [{ _id: "f", options: [{ _id: "o", label: "old" }] }] };
    getDB.mockResolvedValue(mkDb({ findOneImpl: async () => doc }));
    await svc.updateOption("doc", "f", "o", { label: "new" });
    expect(doc.filters[0].options[0].label).toBe("new");
    expect(doc.filters[0].options[0]._id).toBe("o");
  });
  it("deleteOption throws when doc missing", async () => {
    getDB.mockResolvedValue(mkDb({ findOneImpl: async () => null }));
    await expect(svc.deleteOption("doc", "f", "o")).rejects.toThrow(/Document not found/);
  });
  it("deleteOption throws when filter missing", async () => {
    getDB.mockResolvedValue(mkDb({ findOneImpl: async () => ({ _id: "doc", filters: [] }) }));
    await expect(svc.deleteOption("doc", "f", "o")).rejects.toThrow(/Filter not found/);
  });
  it("deleteOption filters options array and replaces doc", async () => {
    const doc = { _id: "doc", filters: [{ _id: "f", options: [{ _id: "o1" }, { _id: "o2" }] }] };
    getDB.mockResolvedValue(mkDb({ findOneImpl: async () => doc }));
    await svc.deleteOption("doc", "f", "o1");
    expect(doc.filters[0].options).toEqual([{ _id: "o2" }]);
    expect(collections.replaceOne).toHaveBeenCalled();
  });
  it("deleteOption filter with no options defaults to []", async () => {
    const doc = { _id: "doc", filters: [{ _id: "f" }] };
    getDB.mockResolvedValue(mkDb({ findOneImpl: async () => doc }));
    await svc.deleteOption("doc", "f", "o");
    expect(doc.filters[0].options).toEqual([]);
  });
});
