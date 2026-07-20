import { describe, it, expect, vi, beforeEach } from "vitest";

const { schemaCalls, modelCalls } = vi.hoisted(() => ({ schemaCalls: [], modelCalls: [] }));

vi.mock("mongoose", () => {
  const Schema = vi.fn(function (def, opts) { this.def = def; this.opts = opts; schemaCalls.push({ def, opts }); });
  Schema.Types = { ObjectId: "ObjectId", Mixed: "Mixed" };
  return { default: {
    Schema,
    model: vi.fn((name, schema) => { modelCalls.push({ name, schema }); return { __model: name, schema }; }),
  }};
});

beforeEach(async () => {
  schemaCalls.length = 0;
  modelCalls.length = 0;
  vi.resetModules();
  await import("../../models/competitors.js");
});

describe("models/competitors", () => {
  it("defines schema with competitor_name required and competitor_url optional (default \"\")", () => {
    const def = schemaCalls[0].def;
    expect(def.competitor_name.required).toBe(true);
    // competitor_url must NOT be `required: true` — Mongoose's required check
    // on a String rejects "" but accepts any other non-empty value regardless
    // of format, which previously made a blank (legitimately optional)
    // website URL fail for any brand-new competitor while garbage text in
    // that same field "passed". See the "Add Competitor Manually" bug fix.
    expect(def.competitor_url.required).not.toBe(true);
    expect(def.competitor_url.default).toBe("");
  });
  it("registers a mongoose model", () => {
    expect(modelCalls.length).toBeGreaterThanOrEqual(1);
  });
});
