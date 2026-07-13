import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { validateAiMeta } = require("../../../../src/services/common/helpers/aiMetaValidator");

// Real v1.6 shape (AI_META_API_PAYLOAD_SPEC §4): category classification (name + ids)
// now lives entirely inside ai_meta.
const FULL = {
  ad_type: "promotional",
  intent: ["conversion", "awareness", "lead_generation"],
  hook: ["urgency", "social_proof", "scarcity"],
  offering_type: "product",
  offering: "printer parts",
  caption: "A hand holding printer parts against a white background.",
  roa: {
    intent: "The 'Open' button indicates a call to action for conversion.",
    hook: "The large number suggests scarcity and urgency.",
    offering_type: "The text indicates a product offering.",
    offering: "The text 'printer parts' specifies the product.",
  },
  colors: ["#FFFFFF", "#C9A227"],
  category: "Retail",
  category_id: "1234",
  sub_category: "Specialty Stores",
  subcategory_id: "12340001",
};

const errFields = (r) => r.errors.map((e) => e.field);

describe("aiMetaValidator v1.5 > happy path", () => {
  it("accepts the full spec §4 example with no errors", () => {
    const r = validateAiMeta(FULL);
    expect(r.errors).toEqual([]);
    expect(r.storedFields).toEqual(expect.arrayContaining([
      "ad_type", "offering_type", "intent", "hook", "colors", "offering", "caption", "roa",
    ]));
    // Removed fields never appear (v1.5 dropped brand + celebrity too)
    expect(r.storedFields).not.toEqual(expect.arrayContaining(["status", "product_type", "language", "ocr", "object", "brand_logos", "brand", "celebrity"]));
  });
  it("offers omitted is fine (most ads)", () => {
    expect(validateAiMeta(FULL).errors).toEqual([]);
    expect("offers" in validateAiMeta(FULL).normalized).toBe(false);
  });
  it("removed fields (brand/celebrity) are ignored, not errored", () => {
    const r = validateAiMeta({ ...FULL, brand: "Nike", celebrity: ["Someone"] });
    expect(r.errors).toEqual([]);
    expect("brand" in r.normalized).toBe(false);
    expect("celebrity" in r.normalized).toBe(false);
  });
});

describe("aiMetaValidator v1.5 > required core (no status relaxation)", () => {
  it("flags all four required fields when empty", () => {
    const r = validateAiMeta({});
    expect(errFields(r)).toEqual(expect.arrayContaining([
      "ai_meta.ad_type", "ai_meta.offering_type", "ai_meta.intent", "ai_meta.hook",
    ]));
  });
  it("does NOT require a status field anymore", () => {
    const r = validateAiMeta(FULL);
    expect(errFields(r)).not.toContain("ai_meta.status");
  });
});

describe("aiMetaValidator v1.4 > offering_type (renamed from product_type)", () => {
  it("accepts product|service|both", () => {
    for (const v of ["product", "service", "both"]) {
      expect(validateAiMeta({ ...FULL, offering_type: v }).errors).toEqual([]);
    }
  });
  it("rejects an old v1.1 product_type value on offering_type", () => {
    expect(errFields(validateAiMeta({ ...FULL, offering_type: "physical_product" }))).toContain("ai_meta.offering_type");
  });
  it("a payload sending the OLD product_type field (and no offering_type) fails", () => {
    const { offering_type, ...noOffering } = FULL;
    const r = validateAiMeta({ ...noOffering, product_type: "physical_product" });
    expect(errFields(r)).toContain("ai_meta.offering_type");
  });
});

describe("aiMetaValidator v1.4 > colors (hex palette)", () => {
  it("accepts hex from the 16-value palette (case-insensitive, normalized upper)", () => {
    const r = validateAiMeta({ ...FULL, colors: ["#ffffff", "#c9a227"] });
    expect(r.errors).toEqual([]);
    expect(r.normalized.colors).toEqual(["#FFFFFF", "#C9A227"]);
  });
  it("rejects named-word colors (the old v1.1 vocab)", () => {
    expect(errFields(validateAiMeta({ ...FULL, colors: ["blue", "white"] }))).toEqual(
      expect.arrayContaining(["ai_meta.colors[0]", "ai_meta.colors[1]"]));
  });
  it("rejects a hex not in the fixed palette", () => {
    expect(errFields(validateAiMeta({ ...FULL, colors: ["#123456"] }))).toContain("ai_meta.colors[0]");
  });
  it("rejects >3 colors; allows empty", () => {
    expect(errFields(validateAiMeta({ ...FULL, colors: ["#000000", "#FFFFFF", "#808080", "#C0C0C0"] }))).toContain("ai_meta.colors");
    expect(validateAiMeta({ ...FULL, colors: [] }).errors).toEqual([]);
  });
});

describe("aiMetaValidator v1.4 > offers", () => {
  it("percentage_discount value must be 0-100", () => {
    expect(errFields(validateAiMeta({ ...FULL, offers: [{ type: "percentage_discount", value: 125 }] }))).toContain("ai_meta.offers[0].value");
  });
  it("percentage_discount requires a numeric value", () => {
    expect(errFields(validateAiMeta({ ...FULL, offers: [{ type: "percentage_discount" }] }))).toContain("ai_meta.offers[0].value");
  });
  it("non-discount type forces value to null", () => {
    const r = validateAiMeta({ ...FULL, offers: [{ type: "free_trial", value: 5 }] });
    expect(r.errors).toEqual([]);
    expect(r.normalized.offers[0]).toEqual({ type: "free_trial", value: null });
  });
  it("bad offer type rejected; empty offers array rejected", () => {
    expect(errFields(validateAiMeta({ ...FULL, offers: [{ type: "half_off" }] }))).toContain("ai_meta.offers[0].type");
    expect(errFields(validateAiMeta({ ...FULL, offers: [] }))).toContain("ai_meta.offers");
  });
});

describe("aiMetaValidator v1.5 > caption + roa", () => {
  it("caption stored; empty caption omitted; >200 rejected", () => {
    expect(validateAiMeta({ ...FULL, caption: "A blue banner." }).normalized.caption).toBe("A blue banner.");
    expect("caption" in validateAiMeta({ ...FULL, caption: "   " }).normalized).toBe(false);
    expect(errFields(validateAiMeta({ ...FULL, caption: "x".repeat(201) }))).toContain("ai_meta.caption");
  });
  it("roa keeps only known non-empty sub-fields; all-empty → omitted", () => {
    const r = validateAiMeta({ ...FULL, roa: { intent: "why", bogus: "ignored", hook: "" } });
    expect(r.errors).toEqual([]);
    expect(r.normalized.roa).toEqual({ intent: "why" });
    expect("roa" in validateAiMeta({ ...FULL, roa: { intent: "", hook: "" } }).normalized).toBe(false);
  });
  it("roa sub-field over 200 chars rejected", () => {
    expect(errFields(validateAiMeta({ ...FULL, roa: { intent: "x".repeat(201) } }))).toContain("ai_meta.roa.intent");
  });
});

describe("aiMetaValidator v1.6 > category classification group (ids inside ai_meta)", () => {
  it("accepts a full category + 4/8-char id pair", () => {
    const r = validateAiMeta(FULL);
    expect(r.errors).toEqual([]);
    expect(r.normalized).toMatchObject({
      category: "Retail", category_id: "1234",
      sub_category: "Specialty Stores", subcategory_id: "12340001",
    });
  });
  it("whole group is optional — absent means uncategorized, no error", () => {
    const { category, category_id, sub_category, subcategory_id, ...noCat } = FULL;
    const r = validateAiMeta(noCat);
    expect(r.errors).toEqual([]);
    expect("category" in r.normalized).toBe(false);
    expect("category_id" in r.normalized).toBe(false);
  });
  it("category without category_id is rejected (and vice versa), and drops the half-pair", () => {
    const { category_id, ...noId } = FULL;
    const r = validateAiMeta(noId);
    expect(errFields(r)).toContain("ai_meta.category_id");
    expect("category" in r.normalized).toBe(false);   // half-pair not persisted
    const { category, ...noName } = FULL;
    expect(errFields(validateAiMeta(noName))).toContain("ai_meta.category");
  });
  it("category shorter than 5 / category_id not exactly 4 chars rejected", () => {
    expect(errFields(validateAiMeta({ ...FULL, category: "Ab", category_id: "12" }))).toEqual(
      expect.arrayContaining(["ai_meta.category", "ai_meta.category_id"]));
  });
  it("subcategory_id must be 8 chars and start with category_id", () => {
    expect(errFields(validateAiMeta({ ...FULL, subcategory_id: "999" }))).toContain("ai_meta.subcategory_id");
    expect(errFields(validateAiMeta({ ...FULL, subcategory_id: "99990001" }))).toContain("ai_meta.subcategory_id");
  });
  it("sub_category requires both its id and a parent category", () => {
    const { subcategory_id, ...noSubId } = FULL;
    expect(errFields(validateAiMeta(noSubId))).toContain("ai_meta.subcategory_id");
    const bare = { ad_type: "promotional", intent: ["conversion"], hook: ["urgency"], offering_type: "product", sub_category: "X", subcategory_id: "12340001" };
    expect(errFields(validateAiMeta(bare))).toContain("ai_meta.category");
  });
});

describe("aiMetaValidator v1.5 > enums & cardinality", () => {
  it("rejects intent value not in enum", () => {
    expect(errFields(validateAiMeta({ ...FULL, intent: ["buy_now"] }))).toContain("ai_meta.intent[0]");
  });
  it("rejects >5 intents and duplicate hooks", () => {
    expect(errFields(validateAiMeta({ ...FULL, intent: ["awareness", "consideration", "conversion", "traffic", "engagement", "retargeting"] }))).toContain("ai_meta.intent");
    expect(validateAiMeta({ ...FULL, hook: ["urgency", "urgency"] }).errors.some((e) => /duplicate/.test(e.message))).toBe(true);
  });
});
