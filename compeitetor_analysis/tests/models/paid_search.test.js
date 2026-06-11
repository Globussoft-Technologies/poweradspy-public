import { describe, it, expect, vi, beforeEach } from "vitest";

const { schemaCalls, modelCalls } = vi.hoisted(() => ({ schemaCalls: [], modelCalls: [] }));

vi.mock("mongoose", () => {
  const Schema = vi.fn(function (def, opts) { this.def = def; this.opts = opts; schemaCalls.push({ def, opts }); });
  Schema.Types = { ObjectId: "ObjectId" };
  return { default: {
    Schema,
    model: vi.fn((name, schema) => { modelCalls.push({ name, schema }); return { __model: name, schema }; }),
  }};
});

beforeEach(async () => {
  schemaCalls.length = 0;
  modelCalls.length = 0;
  vi.resetModules();
  await import("../../models/paid_search.js");
});

describe("models/paid_search", () => {
  it("schema requires domain_name + keywords", () => {
    const def = schemaCalls[0].def;
    expect(def.domain_name.required).toBe(true);
    expect(def.keywords.required).toBe(true);
  });
  it("registers paid_search model", () => {
    expect(modelCalls[0].name).toBe("paid_search");
  });
});
