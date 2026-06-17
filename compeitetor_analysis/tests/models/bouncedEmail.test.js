import { describe, it, expect, vi, beforeEach } from "vitest";

const { schemaCalls, modelCalls, registry } = vi.hoisted(() => ({
  schemaCalls: [],
  modelCalls: [],
  registry: { models: {} },
}));

vi.mock("mongoose", () => {
  function Schema(def, opts) {
    this.def = def;
    this.opts = opts;
    this.index = vi.fn();
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
  registry.models = {};
  vi.resetModules();
});

describe("models/bouncedEmail", () => {
  it("defines the schema + registers the model when not already registered", async () => {
    const mod = await import("../../models/bouncedEmail.js");
    expect(schemaCalls.length).toBe(1);
    const def = schemaCalls[0].def;
    expect(def.email.required).toBe(true);
    expect(def.email.unique).toBe(true);
    expect(def.source.enum).toEqual(["webhook", "failed_reason"]);
    expect(schemaCalls[0].opts.collection).toBe("bounced_emails");
    expect(modelCalls[0].name).toBe("bounced_email");
    expect(mod.default).toBeTruthy();
  });

  it("reuses the already-registered model (mongoose.models cache branch)", async () => {
    registry.models = { bounced_email: { __cached: true } };
    const mod = await import("../../models/bouncedEmail.js");
    expect(mod.default).toEqual({ __cached: true });
    expect(modelCalls.length).toBe(0); // model() not called when cached
  });

  it("default factories produce dates/count", async () => {
    await import("../../models/bouncedEmail.js");
    const def = schemaCalls[0].def;
    expect(def.first_bounced_at.default()).toBeInstanceOf(Date);
    expect(def.last_bounced_at.default()).toBeInstanceOf(Date);
    expect(def.bounce_count.default).toBe(1);
  });
});
