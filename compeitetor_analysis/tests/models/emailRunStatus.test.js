import { describe, it, expect, vi, beforeEach } from "vitest";

const { schemaCalls, modelCalls, registry, indexCalls } = vi.hoisted(() => ({
  schemaCalls: [],
  modelCalls: [],
  indexCalls: [],
  registry: { models: {} },
}));

vi.mock("mongoose", () => {
  function Schema(def, opts) {
    this.def = def;
    this.opts = opts;
    this.index = (spec, options) => { indexCalls.push({ spec, options }); };
    schemaCalls.push({ def, opts });
  }
  Schema.Types = { ObjectId: "ObjectId", Mixed: "Mixed" };
  return {
    default: {
      Schema,
      model: vi.fn((name, schema) => { modelCalls.push({ name, schema }); return { __model: name, schema }; }),
      get models() { return registry.models; },
    },
  };
});

beforeEach(() => {
  schemaCalls.length = 0;
  modelCalls.length = 0;
  indexCalls.length = 0;
  registry.models = {};
  vi.resetModules();
});

describe("models/emailRunStatus", () => {
  it("defines schema, indexes, and registers the model", async () => {
    const mod = await import("../../models/emailRunStatus.js");
    expect(schemaCalls[0].def.mail_type.required).toBe(true);
    expect(schemaCalls[0].def.date.required).toBe(true);
    expect(schemaCalls[0].def.status.default).toBe("idle");
    expect(schemaCalls[0].opts.collection).toBe("email_run_status");
    // two index() calls: compound + TTL
    expect(indexCalls.length).toBe(2);
    expect(indexCalls[1].options.expireAfterSeconds).toBe(60 * 60 * 24 * 60);
    expect(modelCalls[0].name).toBe("email_run_status");
    expect(mod.default).toBeTruthy();
  });

  it("reuses cached model when already registered", async () => {
    registry.models = { email_run_status: { __cached: 1 } };
    const mod = await import("../../models/emailRunStatus.js");
    expect(mod.default).toEqual({ __cached: 1 });
    expect(modelCalls.length).toBe(0);
  });
});
