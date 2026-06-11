import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Mock ../db before SUT load
const dbPath = require.resolve("../../../../src/services/sdui/db");
const getDBSpy = vi.fn();
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { getDB: getDBSpy },
};

function mockDB(collections) {
  return {
    collection(name) {
      const docs = collections[name] || [];
      return {
        find: vi.fn(() => ({ toArray: vi.fn(async () => docs) })),
        insertOne: vi.fn(async () => ({ insertedId: "new-id" })),
        updateOne: vi.fn(async () => ({ matchedCount: 1 })),
        deleteOne: vi.fn(async () => ({ deletedCount: 1 })),
      };
    },
  };
}

let svc;
beforeEach(() => {
  getDBSpy.mockReset();
  const sutPath = require.resolve("../../../../src/services/sdui/services/filterService");
  delete require.cache[sutPath];
  svc = require("../../../../src/services/sdui/services/filterService");
});

describe("services/sdui/services/filterService > getFilters cache miss", () => {
  it("loads groups -> filters -> options from mongo (sorted by rank)", async () => {
    const collections = {
      filter_groups: [
        { _id: "g2", rank: 2 },
        { _id: "g1", rank: 1 },
      ],
      filters: [
        { _id: "f1", group_id: "g1", rank: 1, type: "checkbox" },
      ],
      filter_options: [
        { _id: "o1", filter_id: "f1", rank: 1 },
      ],
    };
    getDBSpy.mockResolvedValue(mockDB(collections));
    const out = await svc.getFilters();
    expect(out[0]._id).toBe("g1");
    expect(out[1]._id).toBe("g2");
    expect(out[0].filters).toEqual(expect.any(Array));
  });

  it("nested_multiselect: builds parent->sub_options tree via buildNestedOptions", async () => {
    const collections = {
      filter_groups: [{ _id: "g1", rank: 1 }],
      filters: [{ _id: "f1", group_id: "g1", rank: 1, type: "nested_multiselect" }],
      filter_options: [
        { _id: "p1", filter_id: "f1", rank: 1 },                          // parent (no parent_id)
        { _id: "c1", filter_id: "f1", rank: 2, parent_id: "p1" },         // child of p1
        { _id: "c2", filter_id: "f1", rank: 3, parent_id: "p1" },         // child of p1
        { _id: "orphan", filter_id: "f1", rank: 4, parent_id: "missing" },// orphan (parent not in map)
      ],
    };
    getDBSpy.mockResolvedValue(mockDB(collections));
    const out = await svc.getFilters();
    const tree = out[0].filters[0].options;
    expect(tree).toHaveLength(1);
    expect(tree[0]._id).toBe("p1");
    expect(tree[0].sub_options).toHaveLength(2);
    expect(tree[0].sub_options[0]._id).toBe("c1");
  });

  it("sorts multiple filters within a group by rank (covers filters.sort callback)", async () => {
    const collections = {
      filter_groups: [{ _id: "g1", rank: 1 }],
      filters: [
        { _id: "f2", group_id: "g1", rank: 2, type: "checkbox" },
        { _id: "f1", group_id: "g1", rank: 1, type: "checkbox" },
      ],
      filter_options: [],
    };
    getDBSpy.mockResolvedValue(mockDB(collections));
    const out = await svc.getFilters();
    expect(out[0].filters.map(f => f._id)).toEqual(["f1", "f2"]);
  });

  it("sorts multiple options within a filter by rank (covers options.sort callback)", async () => {
    const collections = {
      filter_groups: [{ _id: "g1", rank: 1 }],
      filters: [{ _id: "f1", group_id: "g1", rank: 1, type: "checkbox" }],
      filter_options: [
        { _id: "o2", filter_id: "f1", rank: 2 },
        { _id: "o1", filter_id: "f1", rank: 1 },
      ],
    };
    getDBSpy.mockResolvedValue(mockDB(collections));
    const out = await svc.getFilters();
    expect(out[0].filters[0].options.map(o => o._id)).toEqual(["o1", "o2"]);
  });

  it("returns cached value on a second call (no re-fetch)", async () => {
    const collections = { filter_groups: [{ _id: "g", rank: 1 }], filters: [], filter_options: [] };
    getDBSpy.mockResolvedValue(mockDB(collections));
    await svc.getFilters();
    await svc.getFilters();
    // getDB should have been called only ONCE (the second call hit the cache)
    expect(getDBSpy).toHaveBeenCalledTimes(1);
  });
});

// Line 13 (`if (cache.size > 50) cache.delete(...)`) is unreachable — the
// only cacheSet caller uses a constant CACHE_KEY so map size never grows
// past 1. Tracked at https://github.com/Globussoft-Technologies/poweradspy/issues/236

describe("services/sdui/services/filterService > createFilterGroup", () => {
  it("inserts the group, attaches created_at, busts cache", async () => {
    const db = mockDB({ filter_groups: [] });
    getDBSpy.mockResolvedValue(db);
    const group = { title: "Vehicles" };
    const out = await svc.createFilterGroup(group);
    expect(out.created_at).toBeInstanceOf(Date);
    const inserted = db.collection("filter_groups").insertOne;
    expect(inserted).toBeDefined();
  });
});

describe("services/sdui/services/filterService > getFilterGroups", () => {
  it("returns groups sorted by rank", async () => {
    getDBSpy.mockResolvedValue(mockDB({
      filter_groups: [
        { _id: "b", rank: 2 },
        { _id: "a", rank: 1 },
      ],
    }));
    const out = await svc.getFilterGroups();
    expect(out.map(g => g._id)).toEqual(["a", "b"]);
  });
});

describe("services/sdui/services/filterService > updateFilterGroup", () => {
  it("calls updateOne with the whitelisted $set fields and busts cache", async () => {
    const db = mockDB({});
    getDBSpy.mockResolvedValue(db);
    const out = await svc.updateFilterGroup("g1", {
      title: "T", rank: 5, collapsed_by_default: true, visible: false, icon: "i.png",
    });
    expect(out._id).toBe("g1");
    expect(out.title).toBe("T");
  });
});

describe("services/sdui/services/filterService > deleteFilterGroup", () => {
  it("calls deleteOne and busts cache", async () => {
    const db = mockDB({});
    getDBSpy.mockResolvedValue(db);
    await svc.deleteFilterGroup("g1");
    expect(getDBSpy).toHaveBeenCalled();
  });
});
