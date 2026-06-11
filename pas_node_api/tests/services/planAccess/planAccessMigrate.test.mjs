import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// Mock dotenv
const dotenvPath = require.resolve("dotenv");
require.cache[dotenvPath] = {
  id: dotenvPath, filename: dotenvPath, loaded: true,
  exports: { config: vi.fn(() => ({ parsed: {} })) },
};

// Mock fs
const fsPath = require.resolve("fs");
const fsExistsSyncSpy = vi.fn();
const fsReadFileSyncSpy = vi.fn();
require.cache[fsPath] = {
  id: fsPath, filename: fsPath, loaded: true,
  exports: { existsSync: fsExistsSyncSpy, readFileSync: fsReadFileSyncSpy },
};

// Mock sdui/db
const dbPath = require.resolve("../../../src/services/sdui/db");
const fakeReplaceOne = vi.fn();
const fakeFindOne = vi.fn();
const fakeUpdateOne = vi.fn();
const fakeCountDocuments = vi.fn();
const fakeCollection = vi.fn(() => ({
  replaceOne: fakeReplaceOne,
  findOne: fakeFindOne,
  updateOne: fakeUpdateOne,
  countDocuments: fakeCountDocuments,
}));
const fakeDb = vi.fn(() => ({
  collection: fakeCollection,
  databaseName: "pas_dev",
}));
const fakeAppDb = { client: { db: fakeDb } };
const getDB = vi.fn(async () => fakeAppDb);
const closeDB = vi.fn(async () => {});
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { getDB, closeDB },
};

// Mock planAccessSeed (optional — may not exist on disk)
const seedPath = require.resolve("../../../src/services/planAccess/seedProjectAccess"); // a real existing file under the same dir
const planAccessSeedFakePath = seedPath.replace("seedProjectAccess", "planAccessSeed");
require.cache[planAccessSeedFakePath] = {
  id: planAccessSeedFakePath, filename: planAccessSeedFakePath, loaded: true,
  exports: { planBillingMetadata: { _id: "plan_billing_metadata", v: 1 } },
};

let logSpy, errSpy, warnSpy, exitSpy;
beforeEach(() => {
  fsExistsSyncSpy.mockReset().mockReturnValue(true);
  fsReadFileSyncSpy.mockReset();
  fakeReplaceOne.mockReset();
  fakeFindOne.mockReset();
  fakeUpdateOne.mockReset();
  fakeCountDocuments.mockReset().mockResolvedValue(0);
  getDB.mockReset().mockResolvedValue(fakeAppDb);
  closeDB.mockReset().mockResolvedValue();
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {});
});

async function reloadSut() {
  const sutPath = require.resolve("../../../src/services/planAccess/planAccessMigrate");
  delete require.cache[sutPath];
  require("../../../src/services/planAccess/planAccessMigrate");
  // Wait microtasks for migrate() async chain
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
}

describe("services/planAccess/planAccessMigrate", () => {
  it("missing plan_config.json → console.error + process.exit(1)", async () => {
    fsExistsSyncSpy.mockReturnValueOnce(false);
    await reloadSut();
    expect(errSpy).toHaveBeenCalledWith("plan_config.json not found at", expect.any(String));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("happy path: loads JSON docs + appends seed billingMetadata + upserts each + patches incomplete SDUI docs", async () => {
    fsReadFileSyncSpy.mockReturnValueOnce(JSON.stringify([
      { _id: "filter_a", category: "filter" },
      { _id: "filter_b", category: "filter" },
    ]));
    fakeReplaceOne.mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 });
    fakeFindOne
      .mockResolvedValueOnce({ _id: "verified", allowed_plan_ids: [20] })  // patchable
      .mockResolvedValueOnce({ _id: "image_size", allowed_plan_ids: [] });  // empty array still patchable (length <= 1)
    fakeUpdateOne.mockResolvedValue({});
    fakeCountDocuments.mockResolvedValue(3);

    await reloadSut();

    // 3 docs upserted (2 JSON + 1 billing metadata)
    expect(fakeReplaceOne).toHaveBeenCalledTimes(3);
    // 2 patches issued
    expect(fakeUpdateOne).toHaveBeenCalledTimes(2);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("PATCHED   verified"));
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("PATCHED   image_size"));
    expect(closeDB).toHaveBeenCalled();
  });

  it("billing metadata already in JSON → skip duplicate append", async () => {
    fsReadFileSyncSpy.mockReturnValueOnce(JSON.stringify([
      { _id: "plan_billing_metadata", v: 999 }, // already present
    ]));
    fakeReplaceOne.mockResolvedValue({ upsertedCount: 0, modifiedCount: 0 });
    fakeFindOne.mockResolvedValue(null);
    await reloadSut();
    expect(fakeReplaceOne).toHaveBeenCalledTimes(1);
  });

  it("planAccessSeed has no planBillingMetadata → billingMetadataDoc null, no append", async () => {
    require.cache[planAccessSeedFakePath].exports = {}; // no planBillingMetadata
    try {
      fsReadFileSyncSpy.mockReturnValueOnce(JSON.stringify([{ _id: "x" }]));
      fakeReplaceOne.mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 });
      fakeFindOne.mockResolvedValue(null);
      await reloadSut();
      expect(fakeReplaceOne).toHaveBeenCalledTimes(1);
    } finally {
      require.cache[planAccessSeedFakePath].exports = {
        planBillingMetadata: { _id: "plan_billing_metadata", v: 1 },
      };
    }
  });
  it("planAccessSeed access throws → console.warn fallback (line 46)", async () => {
    // Define exports with a getter on planBillingMetadata that throws.
    // The SUT's `seed.planBillingMetadata` accessor will trigger the throw,
    // entering the catch block that warns.
    const original = require.cache[planAccessSeedFakePath].exports;
    Object.defineProperty(require.cache[planAccessSeedFakePath], "exports", {
      configurable: true,
      get() {
        const e = {};
        Object.defineProperty(e, "planBillingMetadata", {
          get() { throw new Error("seed-blew-up"); },
        });
        return e;
      },
    });
    try {
      fsReadFileSyncSpy.mockReturnValueOnce(JSON.stringify([{ _id: "x" }]));
      fakeReplaceOne.mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 });
      fakeFindOne.mockResolvedValue(null);
      await reloadSut();
      expect(warnSpy).toHaveBeenCalledWith(
        "Could not load planAccessSeed.js:",
        "seed-blew-up"
      );
    } finally {
      // restore plain data exports
      Object.defineProperty(require.cache[planAccessSeedFakePath], "exports", {
        configurable: true, writable: true, value: original,
      });
    }
  });

  it("verified findOne returns null → no patch issued (line 92 first operand false)", async () => {
    fsReadFileSyncSpy.mockReturnValueOnce(JSON.stringify([]));
    fakeReplaceOne.mockResolvedValue({});
    fakeFindOne.mockResolvedValue(null); // doc not found
    await reloadSut();
    expect(fakeUpdateOne).not.toHaveBeenCalled();
  });

  it("verified found but allowed_plan_ids has >1 entries → no patch (line 92 length check false)", async () => {
    fsReadFileSyncSpy.mockReturnValueOnce(JSON.stringify([]));
    fakeReplaceOne.mockResolvedValue({});
    fakeFindOne
      .mockResolvedValueOnce({ _id: "verified", allowed_plan_ids: [1, 2] })
      .mockResolvedValueOnce({ _id: "image_size", allowed_plan_ids: [1, 2] });
    await reloadSut();
    expect(fakeUpdateOne).not.toHaveBeenCalled();
  });

  it("upserted=0, modified=0 → unchanged counter incremented (line 77 false branch)", async () => {
    fsReadFileSyncSpy.mockReturnValueOnce(JSON.stringify([{ _id: "x" }]));
    fakeReplaceOne.mockResolvedValue({ upsertedCount: 0, modifiedCount: 0 });
    fakeFindOne.mockResolvedValue(null);
    await reloadSut();
    expect(fakeReplaceOne).toHaveBeenCalledTimes(2); // 1 json + 1 billing metadata
  });

  it("getDB rejects → migration error path logs + exits(1)", async () => {
    fsReadFileSyncSpy.mockReturnValueOnce(JSON.stringify([]));
    getDB.mockRejectedValueOnce(new Error("db-down"));
    await reloadSut();
    expect(errSpy).toHaveBeenCalledWith("Migration failed:", "db-down");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
