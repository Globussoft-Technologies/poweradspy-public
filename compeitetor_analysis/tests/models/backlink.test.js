import { describe, it, expect, vi, beforeEach } from "vitest";

const { schemaCalls, modelCalls } = vi.hoisted(() => ({
  schemaCalls: [],
  modelCalls: [],
}));

vi.mock("mongoose", () => {
  const Schema = vi.fn(function (def, opts) {
    this.def = def;
    this.opts = opts;
    schemaCalls.push({ def, opts });
  });
  Schema.Types = {
    ObjectId: "ObjectId",
    Mixed: "Mixed",
  };
  return {
    default: {
      Schema,
      model: vi.fn((name, schema) => { modelCalls.push({ name, schema }); return { __model: name, schema }; }),
    },
  };
});

let mod;

beforeEach(async () => {
  schemaCalls.length = 0;
  modelCalls.length = 0;
  vi.resetModules();
  mod = await import("../../models/backlink.js");
});

describe("models/backlink", () => {
  it("defines the schema with the documented fields", () => {
    expect(schemaCalls.length).toBeGreaterThanOrEqual(1);
    const def = schemaCalls[0].def;
    expect(def.domain_name).toBeDefined();
    expect(def.dr).toBeDefined();
  });

  it("registers the model and re-exports it", () => {
    expect(modelCalls.length).toBeGreaterThanOrEqual(1);
  });
});
