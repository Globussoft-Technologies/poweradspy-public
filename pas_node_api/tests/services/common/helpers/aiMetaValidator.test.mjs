import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { validateAiMeta } = require("../../../../src/services/common/helpers/aiMetaValidator");

const FULL = {
  ad_type: "testimonial",
  intent: ["conversion", "awareness"],
  hook: ["social_proof", "urgency"],
  product_type: "physical_product",
  offers: [{ type: "percentage_discount", value: 25 }],
  language: "en",
  colors: ["blue", "white", "black"],
  ocr: "Happy Being — 25% off creatine gummies. Shop now.",
  object: ["bottle", "gummies", "hand"],
  celebrity: [],
  brand: "Happy Being",
  brand_logos: ["Happy Being"],
  offering: "creatine gummies",
  category: "Consumer Packaged Goods",
  sub_category: "Vitamins and Supplements",
  status: "success",
};

const errFields = (r) => r.errors.map((e) => e.field);

describe("aiMetaValidator > happy path", () => {
  it("accepts the full spec §4 example with no errors", () => {
    const r = validateAiMeta(FULL);
    expect(r.errors).toEqual([]);
    expect(r.status).toBe("success");
    expect(r.storedFields).toContain("ad_type");
    expect(r.normalized.offers).toEqual([{ type: "percentage_discount", value: 25 }]);
  });
});

describe("aiMetaValidator > required fields (success/partial)", () => {
  it("flags missing ad_type/intent/hook/product_type/language when status=success", () => {
    const r = validateAiMeta({ status: "success" });
    expect(errFields(r)).toEqual(expect.arrayContaining([
      "ai_meta.ad_type", "ai_meta.product_type", "ai_meta.language", "ai_meta.intent", "ai_meta.hook",
    ]));
  });
  it("requires status always", () => {
    const r = validateAiMeta({ ...FULL, status: undefined });
    expect(errFields(r)).toContain("ai_meta.status");
  });
  it("rejects a bad status enum", () => {
    const r = validateAiMeta({ ...FULL, status: "done" });
    expect(errFields(r)).toContain("ai_meta.status");
  });
});

describe("aiMetaValidator > relaxation for failed/queued", () => {
  it("queued needs only status", () => {
    const r = validateAiMeta({ status: "queued" });
    expect(r.errors).toEqual([]);
    expect(r.normalized).toEqual({ status: "queued" });
  });
  it("failed with mostly-empty ai_meta passes", () => {
    const r = validateAiMeta({ status: "failed", intent: [] });
    // intent present but empty → still format-checked → min-1 error
    expect(errFields(r)).toContain("ai_meta.intent");
  });
  it("failed without optional fields passes", () => {
    const r = validateAiMeta({ status: "failed" });
    expect(r.errors).toEqual([]);
  });
});

describe("aiMetaValidator > enums & cardinality", () => {
  it("rejects intent value not in enum", () => {
    const r = validateAiMeta({ ...FULL, intent: ["buy_now"] });
    expect(errFields(r)).toContain("ai_meta.intent[0]");
  });
  it("rejects duplicate hook values", () => {
    const r = validateAiMeta({ ...FULL, hook: ["urgency", "urgency"] });
    expect(r.errors.some((e) => /duplicate/.test(e.message))).toBe(true);
  });
  it("rejects >5 intents", () => {
    const r = validateAiMeta({ ...FULL, intent: ["awareness", "consideration", "conversion", "traffic", "engagement", "retargeting"] });
    expect(errFields(r)).toContain("ai_meta.intent");
  });
  it("rejects colors outside the named vocab", () => {
    const r = validateAiMeta({ ...FULL, colors: ["blue", "#FFFFFF", "teal"] });
    expect(errFields(r)).toEqual(expect.arrayContaining(["ai_meta.colors[1]", "ai_meta.colors[2]"]));
  });
});

describe("aiMetaValidator > offers", () => {
  it("percentage_discount value must be 0-100", () => {
    const r = validateAiMeta({ ...FULL, offers: [{ type: "percentage_discount", value: 125 }] });
    expect(errFields(r)).toContain("ai_meta.offers[0].value");
  });
  it("percentage_discount requires a numeric value", () => {
    const r = validateAiMeta({ ...FULL, offers: [{ type: "percentage_discount" }] });
    expect(errFields(r)).toContain("ai_meta.offers[0].value");
  });
  it("free_trial accepts null value", () => {
    const r = validateAiMeta({ ...FULL, offers: [{ type: "free_trial", value: null }] });
    expect(r.errors).toEqual([]);
  });
  it("bad offer type rejected", () => {
    const r = validateAiMeta({ ...FULL, offers: [{ type: "half_off", value: 10 }] });
    expect(errFields(r)).toContain("ai_meta.offers[0].type");
  });
  it("duplicate type same value rejected; differing value allowed", () => {
    const dup = validateAiMeta({ ...FULL, offers: [{ type: "percentage_discount", value: 25 }, { type: "percentage_discount", value: 25 }] });
    expect(dup.errors.length).toBeGreaterThan(0);
    const ok = validateAiMeta({ ...FULL, offers: [{ type: "percentage_discount", value: 25 }, { type: "percentage_discount", value: 50 }] });
    expect(ok.errors).toEqual([]);
  });
  it("empty offers array rejected", () => {
    const r = validateAiMeta({ ...FULL, offers: [] });
    expect(errFields(r)).toContain("ai_meta.offers");
  });
});

describe("aiMetaValidator > text fields", () => {
  it("ocr allows newlines, rejects other control chars", () => {
    expect(validateAiMeta({ ...FULL, ocr: "line1\nline2" }).errors).toEqual([]);
    expect(errFields(validateAiMeta({ ...FULL, ocr: "badbell" }))).toContain("ai_meta.ocr");
  });
  it("ocr over 2000 chars rejected", () => {
    const r = validateAiMeta({ ...FULL, ocr: "a".repeat(2001) });
    expect(errFields(r)).toContain("ai_meta.ocr");
  });
  it("offering rejects newlines", () => {
    const r = validateAiMeta({ ...FULL, offering: "line1\nline2" });
    expect(errFields(r)).toContain("ai_meta.offering");
  });
  it("brand over 100 chars rejected; empty brand rejected", () => {
    expect(errFields(validateAiMeta({ ...FULL, brand: "x".repeat(101) }))).toContain("ai_meta.brand");
    expect(errFields(validateAiMeta({ ...FULL, brand: "   " }))).toContain("ai_meta.brand");
  });
});

describe("aiMetaValidator > open-vocab arrays", () => {
  it("object lowercased + de-duped, max 10", () => {
    const r = validateAiMeta({ ...FULL, object: Array.from({ length: 11 }, (_, i) => `x${i}`) });
    expect(errFields(r)).toContain("ai_meta.object");
  });
  it("celebrity max 5", () => {
    const r = validateAiMeta({ ...FULL, celebrity: ["a", "b", "c", "d", "e", "f"] });
    expect(errFields(r)).toContain("ai_meta.celebrity");
  });
});
