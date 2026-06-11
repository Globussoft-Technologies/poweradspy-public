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

  it("on db error, logs and throws (latent bug: logger not imported)", async () => {
    executeSpy.mockRejectedValueOnce(new Error("connection-lost"));
    // The SUT's catch tries to call `logger.error(...)` but does not import
    // `logger`, so it actually throws ReferenceError. Issue:
    // https://github.com/Globussoft-Technologies/poweradspy/issues/207
    await expect(getAllCountries()).rejects.toThrow(/logger is not defined/);
  });
});
