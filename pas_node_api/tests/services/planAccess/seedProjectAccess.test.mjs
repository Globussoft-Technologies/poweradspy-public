import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Mock dotenv so the top-level config() doesn't try to read .env
const dotenvPath = require.resolve("dotenv");
require.cache[dotenvPath] = {
  id: dotenvPath, filename: dotenvPath, loaded: true,
  exports: { config: vi.fn(() => ({ parsed: {} })) },
};

// Mock sdui/db to control getDB + closeDB behavior
const dbPath = require.resolve("../../../src/services/sdui/db");
const fakeReplaceOne = vi.fn();
const fakeCollection = vi.fn(() => ({ replaceOne: fakeReplaceOne }));
const fakeDb = vi.fn(() => ({ collection: fakeCollection }));
const fakeAppDb = { client: { db: fakeDb } };
const getDB = vi.fn(async () => fakeAppDb);
const closeDB = vi.fn(async () => {});
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { getDB, closeDB },
};

let logSpy, errSpy, exitSpy;
beforeEach(() => {
  fakeReplaceOne.mockReset();
  getDB.mockReset().mockResolvedValue(fakeAppDb);
  closeDB.mockReset().mockResolvedValue();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {});
});

async function reloadSut() {
  const sutPath = require.resolve("../../../src/services/planAccess/seedProjectAccess");
  delete require.cache[sutPath];
  require("../../../src/services/planAccess/seedProjectAccess");
  // Wait for seed().catch() to complete
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe("services/planAccess/seedProjectAccess (top-level seed)", () => {
  it("upsert INSERT path: logs 'INSERTED' when upsertedCount > 0", async () => {
    fakeReplaceOne.mockResolvedValueOnce({ upsertedCount: 1, modifiedCount: 0 });
    await reloadSut();
    expect(getDB).toHaveBeenCalled();
    expect(fakeReplaceOne).toHaveBeenCalled();
    expect(closeDB).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("INSERTED"));
  });

  it("update path: logs 'UPDATED' when modifiedCount > 0", async () => {
    fakeReplaceOne.mockResolvedValueOnce({ upsertedCount: 0, modifiedCount: 1 });
    await reloadSut();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("UPDATED"));
  });

  it("no-op path: logs 'already up to date' when both counts zero", async () => {
    fakeReplaceOne.mockResolvedValueOnce({ upsertedCount: 0, modifiedCount: 0 });
    await reloadSut();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("already up to date"));
  });

  it("error path: getDB rejects → console.error + process.exit(1)", async () => {
    getDB.mockRejectedValueOnce(new Error("conn-down"));
    await reloadSut();
    expect(errSpy).toHaveBeenCalledWith("Seed failed:", "conn-down");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("doc has expected shape: allowed_plan_ids array, label, category, _id", async () => {
    let captured;
    fakeReplaceOne.mockImplementationOnce(async (filter, doc) => {
      captured = doc;
      return { upsertedCount: 1, modifiedCount: 0 };
    });
    await reloadSut();
    expect(captured._id).toBe("project_access");
    expect(captured.label).toBe("Projects Section Access");
    expect(captured.category).toBe("feature");
    expect(captured.allowed_plan_ids).toEqual(expect.arrayContaining([4, 25, 69]));
    expect(captured.visible).toBe(true);
    expect(captured.created_at).toMatch(/^\d{4}-/);
  });
});
