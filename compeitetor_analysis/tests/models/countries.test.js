import { describe, it, expect, vi, beforeEach } from "vitest";

const { executeSpy } = vi.hoisted(() => ({ executeSpy: vi.fn() }));

vi.mock("../../resources/database/db.js", () => ({ pool: { execute: executeSpy } }));

let getAllCountries;

beforeEach(async () => {
  executeSpy.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.resetModules();
  ({ getAllCountries } = await import("../../models/countries.js"));
});

describe("models/countries > getAllCountries", () => {
  it("returns rows on success", async () => {
    executeSpy.mockResolvedValueOnce([[{ id: 1, name: "India" }]]);
    const rows = await getAllCountries();
    expect(rows).toEqual([{ id: 1, name: "India" }]);
    expect(executeSpy).toHaveBeenCalledWith(expect.stringContaining("SELECT id,name FROM countries"));
  });

  it("on db error, logs and rethrows the original error", async () => {
    executeSpy.mockRejectedValueOnce(new Error("connection-lost"));
    // Issue #207 is fixed: the SUT now imports `logger`, logs the error, and
    // rethrows the original error (no more ReferenceError).
    await expect(getAllCountries()).rejects.toThrow(/connection-lost/);
  });
});
