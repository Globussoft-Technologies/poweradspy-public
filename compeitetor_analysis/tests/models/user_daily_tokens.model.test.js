import { describe, it, expect, vi, beforeEach } from "vitest";

const { schemaCalls, modelCalls, indexCalls, configGetSpy } = vi.hoisted(() => ({
  schemaCalls: [],
  modelCalls: [],
  indexCalls: [],
  configGetSpy: vi.fn(),
}));

vi.mock("mongoose", () => {
  function Schema(def, opts) {
    this.def = def;
    this.opts = opts;
    this.index = vi.fn((fields, options) => indexCalls.push({ fields, options }));
    schemaCalls.push(this);
  }
  Schema.Types = { ObjectId: "ObjectId" };
  return { default: {
    Schema,
    model: vi.fn((name, schema) => { modelCalls.push({ name, schema }); return { __model: name, schema }; }),
  }};
});
vi.mock("config", () => ({ default: { get: configGetSpy } }));

beforeEach(async () => {
  schemaCalls.length = 0;
  modelCalls.length = 0;
  indexCalls.length = 0;
  configGetSpy.mockReset();
  configGetSpy.mockReturnValue(50);
  vi.resetModules();
  await import("../../models/user_daily_tokens.model.js");
});

describe("models/user_daily_tokens.model", () => {
  it("reads MAXIMUM_TOKEN_COUNt limit from config at module load", () => {
    expect(configGetSpy).toHaveBeenCalledWith("MAXIMUM_TOKEN_COUNt");
    expect(schemaCalls[0].def.limit.default).toBe(50);
  });

  it("registers compound unique index on (user_id, date)", () => {
    expect(indexCalls).toContainEqual({
      fields: { user_id: 1, date: 1 },
      options: { unique: true },
    });
  });

  it("registers user_daily_tokens model", () => {
    expect(modelCalls[0].name).toBe("user_daily_tokens");
  });
});
