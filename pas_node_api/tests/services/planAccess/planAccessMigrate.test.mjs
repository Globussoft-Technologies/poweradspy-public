import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

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
const fakeFindOne = vi.fn();
const fakeUpdateOne = vi.fn();
const fakeInsertOne = vi.fn();
const fakeCollection = vi.fn(() => ({
  findOne: fakeFindOne,
  updateOne: fakeUpdateOne,
  insertOne: fakeInsertOne,
}));
const fakeDb = { collection: fakeCollection, databaseName: "pas_competitors" };
const getDB = vi.fn(async () => fakeDb);
const closeDB = vi.fn(async () => {});
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { getDB, closeDB },
};

// Mock planAccessSeed
const seedPath = require.resolve("../../../src/services/planAccess/planAccessSeed");
require.cache[seedPath] = {
  id: seedPath, filename: seedPath, loaded: true,
  exports: {
    planBillingMetadata: { _id: "plan_billing_metadata", plan_info: { "999": { tier: "Legacy" } } },
    DEFAULT_PLAN_GROUPS: {
      _id: "plan_groups",
      groups: { Free: { plans: [20] }, Basic: { plans: [36] }, Palladium: { plans: [57] } },
    },
  },
};

// Mock restructure2026 — pass-through, no contributions, so this test file exercises
// planAccessMigrate's own merge/diff/apply logic in isolation (restructure2026 itself
// is unit-tested separately in restructure2026.test.mjs).
const restructurePath = require.resolve("../../../src/services/planAccess/restructure2026");
const mergeContributions = vi.fn((docs) => docs);
const getContributionDocs = vi.fn(() => []);
const getPlanIds = vi.fn(() => ({}));
require.cache[restructurePath] = {
  id: restructurePath, filename: restructurePath, loaded: true,
  exports: { mergeContributions, getContributionDocs, getPlanIds, getPlanGroups: vi.fn(() => ({})) },
};

let logSpy, errSpy, exitSpy;
let originalArgv;
beforeEach(() => {
  fsExistsSyncSpy.mockReset().mockReturnValue(true);
  fsReadFileSyncSpy.mockReset();
  fakeFindOne.mockReset();
  fakeUpdateOne.mockReset().mockResolvedValue({ matchedCount: 1, modifiedCount: 1, upsertedCount: 0 });
  fakeInsertOne.mockReset().mockResolvedValue({ insertedId: "x" });
  getDB.mockReset().mockResolvedValue(fakeDb);
  closeDB.mockReset().mockResolvedValue();
  mergeContributions.mockReset().mockImplementation((docs) => docs);
  getContributionDocs.mockReset().mockReturnValue([]);
  getPlanIds.mockReset().mockReturnValue({});
  logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {});
  originalArgv = process.argv;
});

async function reloadSut(argvExtra = []) {
  process.argv = [...originalArgv.slice(0, 2), ...argvExtra];
  const sutPath = require.resolve("../../../src/services/planAccess/planAccessMigrate");
  delete require.cache[sutPath];
  require("../../../src/services/planAccess/planAccessMigrate");
  for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r));
}

describe("services/planAccess/planAccessMigrate (config.json-driven, additive-only)", () => {
  it("missing plan_config.json → console.error + process.exit(1)", async () => {
    fsExistsSyncSpy.mockReturnValueOnce(false);
    await reloadSut();
    expect(errSpy).toHaveBeenCalledWith("plan_config.json not found at", expect.any(String));
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("dry run (no --apply): plans changes but writes nothing", async () => {
    fsReadFileSyncSpy.mockReturnValueOnce(JSON.stringify([{ _id: "filter_a", allowed_plan_ids: [1, 2] }]));
    fakeFindOne.mockResolvedValueOnce({ _id: "filter_a", allowed_plan_ids: [1] }); // missing '2'
    await reloadSut([]);
    expect(fakeUpdateOne).not.toHaveBeenCalled();
    expect(fakeInsertOne).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining("DRY RUN ONLY"));
  });

  it("--apply: doc missing live entirely → insertOne, never replaceOne", async () => {
    fsReadFileSyncSpy.mockReturnValueOnce(JSON.stringify([{ _id: "brand_new_doc", allowed_plan_ids: [1] }]));
    fakeFindOne.mockResolvedValueOnce(null);
    await reloadSut(["--apply"]);
    expect(fakeInsertOne).toHaveBeenCalledWith({ _id: "brand_new_doc", allowed_plan_ids: [1] });
  });

  it("--apply: array field missing an element live → $addToSet with $each, never overwrites the whole array", async () => {
    fsReadFileSyncSpy.mockReturnValueOnce(JSON.stringify([{ _id: "gender", allowed_plan_ids: [1, 2, 3] }]));
    getContributionDocs.mockReturnValue([{ _id: "gender", allowed_plan_ids: [1, 2, 3] }]);
    fakeFindOne.mockResolvedValueOnce({ _id: "gender", allowed_plan_ids: [1, 2, 99] }); // has extra live-only value 99
    await reloadSut(["--apply"]);
    expect(fakeUpdateOne).toHaveBeenCalledWith(
      { _id: "gender" },
      { $addToSet: { allowed_plan_ids: { $each: [3] } } }
    );
  });

  it("does not replay legacy base arrays into existing docs", async () => {
    fsReadFileSyncSpy.mockReturnValueOnce(JSON.stringify([{ _id: "gender", allowed_plan_ids: [1, 2, 3] }]));
    fakeFindOne.mockImplementation(async ({ _id }) => {
      if (_id === "gender") return { _id, allowed_plan_ids: [1, 99] };
      if (_id === "plan_billing_metadata") return { _id, plan_info: { "999": { tier: "Legacy" } } };
      if (_id === "plan_groups") return { _id, groups: { Free: { plans: [20] }, Basic: { plans: [36] }, Palladium: { plans: [57] } } };
      return null;
    });

    await reloadSut(["--apply"]);

    expect(fakeUpdateOne.mock.calls.some(([filter]) => filter._id === "gender")).toBe(false);
  });

  it("--apply: object-map field only sets keys absent live, never overwrites an existing key's value", async () => {
    fsReadFileSyncSpy.mockReturnValueOnce(JSON.stringify([
      { _id: "competitor_limits", plan_limits: { "101": { brandLimit: 1 }, "5": { brandLimit: 999 } } },
    ]));
    getContributionDocs.mockReturnValue([
      { _id: "competitor_limits", plan_limits: { "101": { brandLimit: 1 }, "5": { brandLimit: 999 } } },
    ]);
    // live already has "5" with a DIFFERENT (real, diverged) value — must not be touched.
    fakeFindOne.mockResolvedValueOnce({ _id: "competitor_limits", plan_limits: { "5": { brandLimit: 3 } } });
    await reloadSut(["--apply"]);
    expect(fakeUpdateOne).toHaveBeenCalledWith(
      { _id: "competitor_limits" },
      { $set: { "plan_limits.101": { brandLimit: 1 } } } // only the missing key, "5" excluded
    );
  });

  it("no changes needed → doc is a no-op, not counted or written", async () => {
    fsReadFileSyncSpy.mockReturnValueOnce(JSON.stringify([{ _id: "static_doc" }])); // no arrays/maps at all
    // Every doc this run touches (static_doc + the seed's plan_billing_metadata/plan_groups)
    // must resolve as already-identical live, so this test truly asserts "nothing to do".
    fakeFindOne.mockImplementation(async ({ _id }) => {
      if (_id === "static_doc") return { _id: "static_doc" };
      if (_id === "plan_billing_metadata") return { _id: "plan_billing_metadata", plan_info: { "999": { tier: "Legacy" } } };
      if (_id === "plan_groups") return { _id: "plan_groups", groups: { Free: { plans: [20] }, Basic: { plans: [36] }, Palladium: { plans: [57] } } };
      return null;
    });
    await reloadSut(["--apply"]);
    expect(fakeUpdateOne).not.toHaveBeenCalled();
    expect(fakeInsertOne).not.toHaveBeenCalled();
  });

  it("appends planAccessSeed's plan_billing_metadata + plan_groups when absent from JSON", async () => {
    fsReadFileSyncSpy.mockReturnValueOnce(JSON.stringify([{ _id: "some_filter" }]));
    fakeFindOne.mockResolvedValue(null); // everything missing live → all insertOne
    await reloadSut(["--apply"]);
    const insertedIds = fakeInsertOne.mock.calls.map((c) => c[0]._id);
    expect(insertedIds).toEqual(expect.arrayContaining(["some_filter", "plan_billing_metadata", "plan_groups"]));
  });

  it("calls restructure2026's mergeContributions on the assembled source docs", async () => {
    fsReadFileSyncSpy.mockReturnValueOnce(JSON.stringify([{ _id: "some_filter" }]));
    fakeFindOne.mockResolvedValue(null);
    await reloadSut([]);
    expect(mergeContributions).toHaveBeenCalledTimes(1);
  });

  it("additively grants both open-beta features to legacy paid + configured current plans", async () => {
    fsReadFileSyncSpy.mockReturnValueOnce(JSON.stringify([
      { _id: "market_trends", stage: "beta", allowed_plan_ids: null },
      { _id: "keyword_explorer", stage: "beta", allowed_plan_ids: null },
    ]));
    getPlanIds.mockReturnValue({ basic: 72, basicYearly: 76 });
    fakeFindOne.mockImplementation(async ({ _id }) => {
      if (_id === "market_trends" || _id === "keyword_explorer") return { _id, allowed_plan_ids: [999] };
      if (_id === "plan_billing_metadata") return { _id, plan_info: { "999": { tier: "Legacy" } } };
      if (_id === "plan_groups") return { _id, groups: { Free: { plans: [20] }, Basic: { plans: [36] }, Palladium: { plans: [57] } } };
      return null;
    });

    await reloadSut(["--apply"]);

    for (const featureId of ["market_trends", "keyword_explorer"]) {
      expect(fakeUpdateOne).toHaveBeenCalledWith(
        { _id: featureId },
        { $addToSet: {
          allowed_plan_ids: { $each: [36, 57, 72, 76] },
          migration_versions: { $each: ["open_beta_paid_plans_v1"] },
        } },
      );
    }
  });

  it("preserves a live null open-beta setting instead of narrowing it", async () => {
    fsReadFileSyncSpy.mockReturnValueOnce(JSON.stringify([
      { _id: "market_trends", stage: "beta", allowed_plan_ids: null },
    ]));
    fakeFindOne.mockImplementation(async ({ _id }) => {
      if (_id === "market_trends") return { _id, allowed_plan_ids: null };
      if (_id === "plan_billing_metadata") return { _id, plan_info: { "999": { tier: "Legacy" } } };
      if (_id === "plan_groups") return { _id, groups: { Free: { plans: [20] }, Basic: { plans: [36] }, Palladium: { plans: [57] } } };
      return null;
    });

    await reloadSut(["--apply"]);

    expect(fakeUpdateOne).toHaveBeenCalledWith(
      { _id: "market_trends" },
      { $addToSet: { migration_versions: { $each: ["open_beta_paid_plans_v1"] } } },
    );
  });

  it("does not re-enable a beta plan disabled in admin after the rollout", async () => {
    fsReadFileSyncSpy.mockReturnValueOnce(JSON.stringify([
      { _id: "market_trends", stage: "beta", allowed_plan_ids: null },
    ]));
    getPlanIds.mockReturnValue({ basic: 72, basicYearly: 76 });
    fakeFindOne.mockImplementation(async ({ _id }) => {
      if (_id === "market_trends") {
        return { _id, allowed_plan_ids: [36, 57, 76], migration_versions: ["open_beta_paid_plans_v1"] };
      }
      if (_id === "plan_billing_metadata") return { _id, plan_info: { "999": { tier: "Legacy" } } };
      if (_id === "plan_groups") return { _id, groups: { Free: { plans: [20] }, Basic: { plans: [36] }, Palladium: { plans: [57] } } };
      return null;
    });

    await reloadSut(["--apply"]);

    expect(fakeUpdateOne.mock.calls.some(([filter]) => filter._id === "market_trends")).toBe(false);
  });

  it("getDB rejects → error path logs + exits(1)", async () => {
    fsReadFileSyncSpy.mockReturnValueOnce(JSON.stringify([]));
    getDB.mockRejectedValueOnce(new Error("db-down"));
    await reloadSut([]);
    expect(errSpy).toHaveBeenCalledWith("Migration failed:", "db-down");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
