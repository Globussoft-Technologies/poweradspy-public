import { describe, it, expect, vi, beforeEach } from "vitest";

const { schemaCalls, modelCalls, indexCalls } = vi.hoisted(() => ({
  schemaCalls: [],
  modelCalls: [],
  indexCalls: [],
}));

vi.mock("mongoose", () => {
  function Schema(def, opts) {
    this.def = def;
    this.opts = opts;
    this.index = vi.fn((fields, options) => { indexCalls.push({ fields, options }); });
    schemaCalls.push(this);
  }
  Schema.Types = { ObjectId: "ObjectId" };
  return { default: {
    Schema,
    model: vi.fn((name, schema) => { modelCalls.push({ name, schema }); return { __model: name, schema }; }),
  }};
});

beforeEach(async () => {
  schemaCalls.length = 0;
  modelCalls.length = 0;
  indexCalls.length = 0;
  vi.resetModules();
  await import("../../models/jobTokenState.js");
});

describe("models/jobTokenState", () => {
  it("schema requires user_id and content_ref_id", () => {
    const def = schemaCalls[0].def;
    expect(def.user_id.required).toBe(true);
    expect(def.content_ref_id.required).toBe(true);
  });
  it("registers a compound unique index on (user_id, content_ref_id)", () => {
    expect(indexCalls).toContainEqual({
      fields: { user_id: 1, content_ref_id: 1 },
      options: { unique: true },
    });
  });
  it("registers ai_token_sync_state model", () => {
    expect(modelCalls[0].name).toBe("ai_token_sync_state");
  });
});
