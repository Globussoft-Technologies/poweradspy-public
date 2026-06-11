import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Mock collaborators
const dbPath = require.resolve("../../../../src/services/sdui/db");
const fakeGetDB = vi.fn();
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { getDB: fakeGetDB },
};

const seedDataPath = require.resolve("../../../../src/services/sdui/seed/seedData");
const fakeBuildSDUIDocuments = vi.fn();
require.cache[seedDataPath] = {
  id: seedDataPath, filename: seedDataPath, loaded: true,
  exports: { buildSDUIDocuments: fakeBuildSDUIDocuments },
};

const loggerPath = require.resolve("../../../../src/logger");
const fakeLogger = {
  info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
};
require.cache[loggerPath] = {
  id: loggerPath, filename: loggerPath, loaded: true,
  exports: { createChild: () => fakeLogger },
};

const { seedDatabase } = require("../../../../src/services/sdui/seed/seeder");

function mockDb({ existingCatDoc = null, findOneThrows = false } = {}) {
  const collections = {};
  return {
    collection: vi.fn((name) => {
      if (!collections[name]) {
        collections[name] = {
          findOne: findOneThrows
            ? vi.fn(async () => { throw new Error("find-fail"); })
            : vi.fn(async () => existingCatDoc),
          drop: vi.fn(async () => true),
          insertMany: vi.fn(async () => ({ insertedCount: 0 })),
        };
      }
      return collections[name];
    }),
    _collections: collections,
  };
}

beforeEach(() => {
  fakeGetDB.mockReset();
  fakeBuildSDUIDocuments.mockReset();
  fakeLogger.info.mockClear();
});

describe("services/sdui/seed/seeder", () => {
  it("happy path: drops, builds, inserts, logs", async () => {
    const db = mockDb();
    fakeGetDB.mockResolvedValueOnce(db);
    fakeBuildSDUIDocuments.mockReturnValueOnce([{ _id: "a" }, { _id: "b" }]);
    await seedDatabase();
    expect(db._collections.sdui_config.drop).toHaveBeenCalled();
    expect(db._collections.sdui_config.insertMany).toHaveBeenCalledWith([
      { _id: "a" }, { _id: "b" },
    ]);
    expect(fakeLogger.info).toHaveBeenCalledWith(expect.stringContaining("2 documents"));
  });

  it("preserves category options when an existing category doc has them", async () => {
    const preserved = [{ key: "tech" }, { key: "sport" }];
    const db = mockDb({
      existingCatDoc: { _id: "category", filters: [{ options: preserved }] },
    });
    fakeGetDB.mockResolvedValueOnce(db);
    const catDoc = { _id: "category", filters: [{ options: [] }] };
    fakeBuildSDUIDocuments.mockReturnValueOnce([catDoc, { _id: "other" }]);
    await seedDatabase();
    expect(catDoc.filters[0].options).toBe(preserved);
  });

  it("existing category doc with no options → preservation skipped (line 23 false branch)", async () => {
    const db = mockDb({
      existingCatDoc: { _id: "category", filters: [{ options: [] }] }, // empty
    });
    fakeGetDB.mockResolvedValueOnce(db);
    const catDoc = { _id: "category", filters: [{ options: [{ key: "fresh" }] }] };
    fakeBuildSDUIDocuments.mockReturnValueOnce([catDoc]);
    await seedDatabase();
    expect(catDoc.filters[0].options).toEqual([{ key: "fresh" }]);
  });

  it("existing category doc missing filters → optional chain falls through", async () => {
    const db = mockDb({ existingCatDoc: { _id: "category" } });
    fakeGetDB.mockResolvedValueOnce(db);
    fakeBuildSDUIDocuments.mockReturnValueOnce([{ _id: "other" }]);
    await expect(seedDatabase()).resolves.toBeUndefined();
  });

  it("findOne throws → swallowed by try/catch, seed continues", async () => {
    const db = mockDb({ findOneThrows: true });
    fakeGetDB.mockResolvedValueOnce(db);
    fakeBuildSDUIDocuments.mockReturnValueOnce([{ _id: "a" }]);
    await expect(seedDatabase()).resolves.toBeUndefined();
    expect(db._collections.sdui_config.insertMany).toHaveBeenCalled();
  });

  it("drop rejection is swallowed (line 29 .catch handler)", async () => {
    const collections = {};
    const db = {
      collection: vi.fn((name) => {
        if (!collections[name]) {
          collections[name] = {
            findOne: vi.fn(async () => null),
            drop: vi.fn(() => Promise.reject(new Error("not-exists"))),
            insertMany: vi.fn(async () => ({})),
          };
        }
        return collections[name];
      }),
    };
    fakeGetDB.mockResolvedValueOnce(db);
    fakeBuildSDUIDocuments.mockReturnValueOnce([{ _id: "x" }]);
    await expect(seedDatabase()).resolves.toBeUndefined();
    expect(collections.sdui_config.insertMany).toHaveBeenCalled();
  });

  it("preserves category options but built docs lack a category doc (line 35 false branch)", async () => {
    const db = mockDb({
      existingCatDoc: { _id: "category", filters: [{ options: [{ key: "tech" }] }] },
    });
    fakeGetDB.mockResolvedValueOnce(db);
    // No category doc in built docs → catDoc is undefined → skip restoration
    fakeBuildSDUIDocuments.mockReturnValueOnce([{ _id: "other" }]);
    await expect(seedDatabase()).resolves.toBeUndefined();
  });
});
