import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const dbPath = require.resolve("../../../../src/services/sdui/db");
const getDB = vi.fn();
const closeDB = vi.fn(async () => {});
require.cache[dbPath] = {
  id: dbPath, filename: dbPath, loaded: true,
  exports: { getDB, closeDB },
};

const sutPath = require.resolve("../../../../src/services/sdui/seed/migrate_add_tiktok");
function freshSut() {
  delete require.cache[sutPath];
  return require(sutPath);
}

beforeEach(() => {
  getDB.mockReset();
  closeDB.mockReset();
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("migrate_add_tiktok > module load + exports", () => {
  it("exports migrate function when not run directly", () => {
    const m = freshSut();
    expect(typeof m.migrate).toBe("function");
  });
});

describe("migrate_add_tiktok > migrate()", () => {
  function mkDb(updateImpls) {
    let i = 0;
    return { collection: () => ({ updateOne: vi.fn(async (filter, update, opts) => updateImpls[i++] || {}) }) };
  }

  it("happy path: all 4 updates succeed", async () => {
    getDB.mockResolvedValue(mkDb([
      { modifiedCount: 1 },
      { modifiedCount: 1 },
      { modifiedCount: 1 },
      { modifiedCount: 1 },
    ]));
    const { migrate } = freshSut();
    await migrate();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("complete!"));
  });

  it("step 1: matchedCount>0 but modifiedCount=0 → 'not modified' warn", async () => {
    getDB.mockResolvedValue(mkDb([
      { modifiedCount: 0, matchedCount: 1 },
      { modifiedCount: 0 },
      { modifiedCount: 0 },
      { modifiedCount: 0 },
    ]));
    const { migrate } = freshSut();
    await migrate();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("not modified"));
  });

  it("step 1: doc NOT found", async () => {
    getDB.mockResolvedValue(mkDb([
      { modifiedCount: 0, matchedCount: 0 },
      { modifiedCount: 0 },
      { modifiedCount: 0 },
      { modifiedCount: 0 },
    ]));
    const { migrate } = freshSut();
    await migrate();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("platforms doc NOT found"));
  });

  it("step 2/3/4: skipped messages when modifiedCount=0", async () => {
    getDB.mockResolvedValue(mkDb([
      { modifiedCount: 1 },
      { modifiedCount: 0 },
      { modifiedCount: 0 },
      { modifiedCount: 0 },
    ]));
    const { migrate } = freshSut();
    await migrate();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("TikTok option already exists"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Image ad type already has tiktok"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Video ad type already has tiktok"));
  });

  it("step 2/3/4: all succeed messages", async () => {
    getDB.mockResolvedValue(mkDb([
      { modifiedCount: 0, matchedCount: 0 },
      { modifiedCount: 1 },
      { modifiedCount: 1 },
      { modifiedCount: 1 },
    ]));
    const { migrate } = freshSut();
    await migrate();
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("[2/4] TikTok option (tt) added"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("[3/4] tiktok added to Image"));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("[4/4] tiktok added to Video"));
  });
});
