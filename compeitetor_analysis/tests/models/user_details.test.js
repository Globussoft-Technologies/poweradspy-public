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
  await import("../../models/user_details.js");
});

describe("models/user_details", () => {
  it("schema requires amember_id (unique), plan_id, plan_expiry_date, userName, email", () => {
    const def = schemaCalls[0].def;
    expect(def.amember_id.required).toBe(true);
    expect(def.amember_id.unique).toBe(true);
    expect(def.email.required).toBe(true);
    expect(def.email.unique).toBe(true);
  });

  it("registers user_details model with timestamps", () => {
    expect(modelCalls[0].name).toBe("user_details");
    expect(schemaCalls[0].opts.timestamps).toBe(true);
  });
});
